import * as C from './core.js';

const { URL: SB_URL, ANON, VAPID } = window.HW;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } },
};
const sb = window.supabase.createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 10 } } });

const S = {
  key: null, who: null, cfg: null, checks: {}, wk: C.mondayOf(C.kstNow().ymd),
  view: 'main', draft: null, online: true, pending: 0, dirty: false, keyError: false,
  push: { supported: false }, armed: false, busy: false,
};

// ───────── 유틸
S.fresh = new Set();
const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="M3.5 8.5l3 3 6-7"/></svg>';
const SPIN = '<span class="spin" aria-hidden="true"></span>';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// 시트(설정 화면) 닫기: Ease in으로 내려간 뒤 다음 화면
function closeSheet(next) {
  const w = $('#app > .wrap');
  if (!w || reduced()) return next();
  w.classList.add('sheet-out'); setTimeout(next, 220);
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const md = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${m}/${d}`; };
const nm = (s) => S.cfg.names[s];
const urlKey = () => { const u = new URL(location.href); return u.searchParams.get('k') || new URLSearchParams(location.hash.slice(1)).get('k'); };

function applyTheme() {
  const t = ls.get('hw_theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-color').setAttribute('content', dark ? '#0e1013' : '#f4f5f7');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ───────── 서버 통신 (모든 호출은 비밀 키 검사 RPC)
const rpc = (fn, args = {}) => sb.rpc(fn, { p_key: S.key, ...args });
function isAuthErr(e) { return e && (e.code === '28000' || /unauthorized/i.test(e.message || '')); }
function onError(e) {
  if (isAuthErr(e)) { S.keyError = true; ls.del('hw_key'); S.key = null; render(); return; }
  if (S.online) { S.online = false; render(); }
}

function applyServer(data) {
  S.cfg = data.config ? C.sanitizeConfig(data.config) : C.cloneDefault();
  S.checks = {}; S.last = data.last || {};
  for (const k of data.checks || []) (S.checks[k.wk] ||= {})[k.chore] = k.done;
}
async function refresh() {
  if (!S.key) return;
  if (S.pending > 0) { S.dirty = true; return; }
  const { data, error } = await rpc('hw_get');
  if (error) return onError(error);
  S.online = true; S.keyError = false;
  applyServer(data); ls.set('hw_cache', JSON.stringify(data));
  if (S.view !== 'settings') render(); else renderPartialOnline();
}
// 사람별 마지막 체크 시각 (KST)
function lastTxt(s) {
  const t = S.last && S.last[s]; if (!t) return '';
  const k = (ms) => new Date(ms + 9 * 3600e3); // KST를 UTC 필드로
  const d = k(Date.parse(t)), n = k(Date.now()), p2 = (x) => String(x).padStart(2, '0');
  const same = d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
  const day = same ? '오늘' : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `<div class="last">마지막 체크 ${day} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}</div>`;
}
function renderPartialOnline() { /* 설정 편집 중엔 화면을 다시 그리지 않음 */ }

async function setCheck(chore, next) {
  const wk = S.wk; const cur = (S.checks[wk] ||= {});
  const prev = cur[chore.id] || 0; if (next === prev) return;
  for (let i = prev + 1; i <= next; i++) S.fresh.add(chore.id + ':' + i); // 새로 체크된 칸만 애니메이션
  cur[chore.id] = next; S.pending++; render(); S.fresh.clear();
  const { error } = await rpc('hw_set_check', { p_wk: wk, p_chore: chore.id, p_done: next, p_who: S.who });
  S.pending--;
  if (error) { cur[chore.id] = prev; if (isAuthErr(error)) onError(error); else { toast('저장 실패 — 연결을 확인해 주세요'); S.online = false; } render(); }
  else if (S.pending === 0 && S.dirty) { S.dirty = false; refresh(); }
}

// ───────── 실시간 (변경 신호를 받으면 다시 불러옴) + 보조 폴링
let channel, poll, debounce;
async function startRealtime() {
  if (channel || !S.key) return;
  const topic = 'hw-' + (await sha256hex(S.key)).slice(0, 16);
  channel = sb.channel(topic).on('broadcast', { event: 'sync' }, () => { clearTimeout(debounce); debounce = setTimeout(refresh, 150); }).subscribe();
  clearInterval(poll); poll = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
addEventListener('online', refresh);

// ───────── 푸시
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const b64u = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
let swReg;
async function getPush() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const p = { supported, ios: isIOS, standalone: standalone(), perm: supported ? Notification.permission : 'unsupported', subscribed: false };
  if (supported) { try { const reg = swReg || await navigator.serviceWorker.ready; p.subscribed = !!(await reg.pushManager.getSubscription()); } catch { /* noop */ } }
  return p;
}
async function pushSubscribe() {
  const reg = swReg || await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID) });
  const { error } = await rpc('hw_subscribe', { p_who: S.who, p_sub: sub.toJSON() });
  if (error) throw error;
}
async function enablePush() {
  S.busy = true; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') toast('알림이 허용되지 않았어요');
    else { await pushSubscribe(); toast('알림을 켰어요'); }
  } catch (e) { toast('알림을 켜지 못했어요: ' + (e.message || e)); }
  S.busy = false; S.push = await getPush(); render();
}
async function disablePush() {
  try {
    const reg = swReg || await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { await rpc('hw_unsubscribe', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
    toast('이 기기 알림을 껐어요');
  } catch (e) { toast('실패: ' + (e.message || e)); }
  S.push = await getPush(); render();
}
async function testPush() {
  S.busy = true; render();
  try { await pushSubscribe(); const { error } = await rpc('hw_test', { p_who: S.who }); if (error) throw error; toast('테스트 알림을 보냈어요 (몇 초 안에 도착)'); }
  catch (e) { toast('보내지 못했어요: ' + (e.message || e)); }
  S.busy = false; render();
}

// ───────── 화면
function render() {
  const app = $('#app');
  if (!S.key) return (app.innerHTML = keyScreen());
  if (!S.cfg) return (app.innerHTML = `<div class="wrap"><div class="center"><h1>집안일 임무분담제</h1><p class="note">${SPIN}불러오는 중…</p></div></div>`);
  if (!S.who) return (app.innerHTML = whoScreen());
  if (S.view === 'settings') return renderSettings();
  const st = window.scrollY; app.innerHTML = mainScreen(); window.scrollTo(0, st);
  if (!S.introDone) { app.firstElementChild.classList.add('intro'); S.introDone = true; } // 첫 화면에서만 Stagger
}
const keyScreen = () => `<div class="wrap"><form class="center" data-act="key"><h1>집안일</h1><p class="note">공유받은 주소로 들어오면 자동으로 열려요. 아니라면 비밀 키를 입력해 주세요.</p>
  <input type="password" name="k" placeholder="비밀 키" autocomplete="off" autocapitalize="off" required>${S.keyError ? '<div class="err">키가 맞지 않아요.</div>' : ''}
  <button class="btn primary" type="submit">들어가기</button></form></div>`;
const whoScreen = () => `<div class="wrap"><div class="center"><h1>누구세요?</h1><p class="note">이 기기에 저장돼요. 나중에 설정에서 바꿀 수 있어요.</p>
  <button class="who-btn a" data-act="who" data-v="A">나는 ${esc(nm('A'))}</button><button class="who-btn b" data-act="who" data-v="B">나는 ${esc(nm('B'))}</button></div></div>`;

function mainScreen() {
  const cfg = S.cfg, wk = S.wk, n = C.weekNo(wk, cfg.anchor), isNow = wk === C.mondayOf(C.kstNow().ymd);
  const load = C.weekLoad(cfg, wk), tot = load.A + load.B, pa = tot ? (load.A / tot) * 100 : 50;
  const gap = Math.abs(load.A - load.B), heavier = load.A > load.B ? 'A' : 'B';
  const checks = S.checks[wk] || {};
  const person = (s) => {
    const list = C.choresOf(cfg, wk, s); const sumPer = list.reduce((a, c) => a + c.per, 0);
    const done = list.reduce((a, c) => a + Math.min(checks[c.id] || 0, c.per), 0);
    const doneMin = list.reduce((a, c) => a + Math.min(checks[c.id] || 0, c.per) * c.min, 0);
    const rows = list.map((c) => {
      const d = Math.min(checks[c.id] || 0, c.per);
      const pip = (i) => `<button class="pipbtn${c.per === 1 ? ' solo' : ''}" data-act="pip" data-c="${esc(c.id)}" data-i="${i}" aria-pressed="${i <= d}" aria-label="${esc(c.name)} ${i}번째"><span class="pip${i <= d ? ' on' : ''}${i <= d && S.fresh.has(c.id + ':' + i) ? ' draw' : ''}">${i <= d ? CHECK_SVG : ''}</span></button>`;
      const pips = Array.from({ length: c.per }, (_, i) => pip(i + 1)).join('');
      return `<div class="chore${d >= c.per ? ' full' : ''}"><div class="row"><span class="nm">${esc(c.name)}</span><span class="meta">${c.min}분 × ${c.per}${c.per === 1 ? '' : ` · ${d}/${c.per}`}</span>${c.per === 1 ? pips : ''}</div>${c.per > 1 ? `<div class="pips">${pips}</div>` : ''}</div>`;
    }).join('');
    return `<section class="card person ${s.toLowerCase()}"><div class="head"><div><h2><span class="dot"></span>${esc(nm(s))}${S.who === s ? '<span class="me">나</span>' : ''}</h2>${lastTxt(s)}</div>
      <span class="prog"><b>${done}</b>/${sumPer}회 · ${C.fmtMin(doneMin)}</span></div><div class="meter"><i style="width:${sumPer ? (done / sumPer) * 100 : 0}%"></i></div>${rows || '<div class="empty">이번 주 담당이 없어요</div>'}</section>`;
  };
  const order = S.who === 'B' ? ['B', 'A'] : ['A', 'B'];
  const [, wm, wd] = wk.split('-').map(Number);
  const wlabel = `${wm}월 ${['첫째', '둘째', '셋째', '넷째', '다섯째'][Math.ceil(wd / 7) - 1]}주`;
  const todayYmd = C.kstNow().ymd;
  const days = '월화수목금토일'.split('').map((w, i) => { const y = C.addDays(wk, i);
    return `<div class="day${y === todayYmd ? ' today' : ''}"><span class="dw">${w}</span><span class="dn">${Number(y.slice(8))}</span></div>`; }).join('');
  return `<div class="wrap"><div class="apptitle">집안일 임무분담제</div><header class="top"><span style="width:44px;flex:none" aria-hidden="true"></span><button class="iconbtn" data-act="prev" aria-label="이전 주">‹</button>
    <div class="nav"><div class="weektitle"><b>${wlabel}${S.online ? '' : '<span class="pill off">오프라인</span>'}</b></div></div>
    <button class="iconbtn" data-act="next" aria-label="다음 주">›</button><button class="iconbtn" data-act="settings" aria-label="설정">⚙︎</button></header>
    <div class="days">${days}</div>
    ${isNow ? '' : '<div class="today"><button data-act="today">이번 주로 돌아가기</button></div>'}
    <section class="card sum"><div class="names"><div class="who"><span class="nm">${esc(nm('A'))}</span><span class="mn a">${load.A}<small>분</small></span></div>
      <div class="who"><span class="nm">${esc(nm('B'))}</span><span class="mn b">${load.B}<small>분</small></span></div></div>
      <div class="bar" role="img" aria-label="${esc(nm('A'))} ${Math.round(pa)}%, ${esc(nm('B'))} ${Math.round(100 - pa)}%"><i class="a" style="width:${pa}%"></i><i class="b" style="width:${100 - pa}%"></i></div>
      <div class="diff">${gap === 0 ? '<b>딱 균형</b>이에요' : `차이 <b>${gap}분</b> · ${esc(nm(heavier))} 쪽이 더 많아요`} <span style="opacity:.7">(${Math.round(pa)} : ${Math.round(100 - pa)})</span></div></section>
    ${order.map(person).join('')}</div>`;
}

// ───────── 설정(편집)
function openSettings() { S.draft = JSON.parse(JSON.stringify(S.cfg)); S.view = 'settings'; S.armed = false; getPush().then((p) => { S.push = p; if (S.view === 'settings') renderSettings(); }); S.sheetIn = true; setTimeout(() => { S.sheetIn = false; }, 400); renderSettings(); window.scrollTo(0, 0); }
function renderSettings() {
  const d = S.draft, p = S.push, theme = ls.get('hw_theme') || 'auto';
  let pushHtml;
  if (!p.supported) {
    pushHtml = p.ios && !p.standalone
      ? `<div class="status bad"><i></i>알림 사용 불가 (브라우저 탭)</div><p class="note">아이폰은 <b>홈 화면에 추가한 앱</b>에서만 알림을 켤 수 있어요 (iOS 16.4 이상). Safari 공유 버튼 → "홈 화면에 추가" 후 그 아이콘으로 다시 열어 주세요.</p>`
      : `<div class="status bad"><i></i>이 기기는 푸시 알림을 지원하지 않아요</div><p class="note">${p.ios ? 'iOS 16.4 이상으로 업데이트하면 알림을 쓸 수 있어요. ' : ''}알림 없이도 앱은 그대로 동작해요.</p>`;
  } else if (p.perm === 'denied') {
    pushHtml = `<div class="status bad"><i></i>알림이 차단돼 있어요</div><p class="note">${p.ios ? '아이폰 설정 → 알림 → 집안일' : '브라우저 사이트 설정'}에서 알림을 허용한 뒤 다시 열어 주세요.</p>`;
  } else if (p.perm === 'granted' && p.subscribed) {
    pushHtml = `<div class="status ok"><i></i>이 기기 알림 켜짐 (${esc(nm(S.who))})</div><div class="row2"><button class="btn primary" data-act="test" ${S.busy ? 'disabled' : ''}>${S.busy ? SPIN : ''}테스트 푸시 보내기</button><button class="btn sm" data-act="pushoff">끄기</button></div>`;
  } else {
    pushHtml = `<div class="status"><i></i>알림 꺼짐</div><button class="btn primary" data-act="pushon" ${S.busy ? 'disabled' : ''}>${S.busy ? SPIN : ''}알림 켜기</button><p class="note">체크 알림, 월요일 09:00 이번 주 담당, 매일 20:00 남은 일을 받아요.</p>`;
  }
  const chores = d.chores.map((c, i) => `<div class="erow" data-i="${i}"><div class="l"><input type="text" data-f="name" value="${esc(c.name)}" aria-label="집안일 이름" maxlength="40"><button class="iconbtn" data-act="del" data-i="${i}" aria-label="삭제">🗑</button></div>
    <div class="grid3"><div class="field"><label>1회 분</label><input type="number" inputmode="numeric" min="0" max="999" data-f="min" value="${c.min}"></div>
    <div class="field"><label>주당 횟수</label><input type="number" inputmode="numeric" min="1" max="14" data-f="per" value="${c.per}"></div>
    <div class="field"><label>기본 담당</label><select data-f="base"><option value="A"${c.base === 'A' ? ' selected' : ''}>${esc(d.names.A)} (A)</option><option value="B"${c.base === 'B' ? ' selected' : ''}>${esc(d.names.B)} (B)</option></select></div></div></div>`).join('');
  const dl = C.weekLoad(d, S.wk);
  $('#app').innerHTML = `<div class="wrap${S.sheetIn ? ' sheet-in' : ''}"><header class="top"><button class="iconbtn" data-act="back" aria-label="뒤로">‹</button><div class="nav"><div class="weektitle"><b>설정</b></div></div><span style="width:44px"></span></header>
  <h3>알림</h3><section class="card">${pushHtml}</section>
  <h3>내 정보</h3><section class="card"><div class="row2" style="align-items:center;justify-content:space-between"><span>이 기기: <b>${esc(nm(S.who))}</b></span><button class="btn sm" data-act="chwho">바꾸기</button></div></section>
  <h3>화면</h3><section class="card"><div class="seg" role="group" aria-label="화면 모드">${[['auto', '자동'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></section>
  <h3>이름</h3><section class="card"><div class="grid3" style="grid-template-columns:1fr 1fr"><div class="field"><label>A</label><input type="text" data-n="A" value="${esc(d.names.A)}" maxlength="12"></div><div class="field"><label>B</label><input type="text" data-n="B" value="${esc(d.names.B)}" maxlength="12"></div></div></section>
  <h3>집안일 (${d.chores.length}개 · 홀수 주 기준 ${dl.A} / ${dl.B}분)</h3><section class="card">${chores || '<div class="empty">집안일이 없어요</div>'}<button class="btn" data-act="add" style="margin-top:8px">+ 집안일 추가</button>
  <p class="note">홀수 주는 "기본 담당" 그대로, 짝수 주는 A↔B가 바뀌어요.</p></section>
  <h3>주차</h3><section class="card"><p class="note" style="margin:0 0 10px">지금 기준 1주차 시작: <b>${md(d.anchor)}</b> (${d.anchor.slice(0, 4)})</p><button class="btn" data-act="restart">이번 주를 1주차로 다시 시작</button></section>
  <h3>초기화</h3><section class="card"><button class="btn danger${S.armed ? ' armed' : ''}" data-act="reset">${S.armed ? '정말 전부 초기화 — 한 번 더 누르세요' : '전체 초기화'}</button><p class="note">모든 체크 기록을 지우고 집안일·이름을 처음 값으로 되돌려요.</p></section>
  <div class="savebar"><button class="btn" data-act="back">취소</button><button class="btn primary" data-act="save">저장</button></div></div>`;
}
async function saveCfg(cfg, msg) {
  const clean = C.sanitizeConfig(cfg);
  const { error } = await rpc('hw_save_config', { p_data: clean });
  if (error) { if (isAuthErr(error)) return onError(error); return toast('저장 실패 — 연결을 확인해 주세요'); }
  closeSheet(() => { S.cfg = clean; S.draft = null; S.view = 'main'; toast(msg || '저장했어요'); render(); refresh(); });
}

// ───────── 이벤트(위임)
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'pip') {
    const c = S.cfg.chores.find((x) => x.id === el.dataset.c); const i = +el.dataset.i; const cur = Math.min((S.checks[S.wk] || {})[c.id] || 0, c.per);
    return setCheck(c, i <= cur ? i - 1 : i);
  }
  if (a === 'prev') { S.wk = C.addDays(S.wk, -7); return render(); }
  if (a === 'next') { S.wk = C.addDays(S.wk, 7); return render(); }
  if (a === 'today') { S.wk = C.mondayOf(C.kstNow().ymd); return render(); }
  if (a === 'settings') return openSettings();
  if (a === 'back') return closeSheet(() => { S.view = 'main'; S.draft = null; render(); });
  if (a === 'who') { S.who = el.dataset.v; ls.set('hw_who', S.who); render(); getPush().then(async (p) => { if (p.subscribed && p.perm === 'granted') { try { await pushSubscribe(); } catch { /* noop */ } } }); return; }
  if (a === 'chwho') { S.who = null; ls.del('hw_who'); S.view = 'main'; return render(); }
  if (a === 'theme') { ls.set('hw_theme', el.dataset.v); applyTheme(); return renderSettings(); }
  if (a === 'pushon') return enablePush();
  if (a === 'pushoff') return disablePush();
  if (a === 'test') return testPush();
  if (a === 'add') { S.draft.chores.push({ id: 'c' + Math.random().toString(36).slice(2, 8), name: '새 집안일', min: 10, per: 1, base: 'A' }); renderSettings(); const r = [...document.querySelectorAll('.erow')].pop(); r?.scrollIntoView({ block: 'center' }); return r?.querySelector('input')?.select(); }
  if (a === 'del') { S.draft.chores.splice(+el.dataset.i, 1); return renderSettings(); }
  if (a === 'restart') { S.draft.anchor = C.mondayOf(C.kstNow().ymd); S.wk = S.draft.anchor; return saveCfg(S.draft, '이번 주가 1주차가 됐어요'); }
  if (a === 'save') return saveCfg(S.draft);
  if (a === 'reset') {
    if (!S.armed) { S.armed = true; renderSettings(); setTimeout(() => { if (S.armed) { S.armed = false; if (S.view === 'settings') renderSettings(); } }, 4000); return; }
    S.armed = false;
    const { error } = await rpc('hw_reset', { p_data: C.cloneDefault() });
    if (error) return toast('초기화 실패 — 연결을 확인해 주세요');
    S.cfg = C.cloneDefault(); S.checks = {}; S.draft = null; S.view = 'main'; S.wk = C.mondayOf(C.kstNow().ymd); toast('초기화했어요'); render(); return;
  }
});
document.addEventListener('input', (e) => {
  const t = e.target; if (!S.draft) return;
  if (t.dataset.n) { S.draft.names[t.dataset.n] = t.value; return; }
  const row = t.closest('.erow'); if (!row || !t.dataset.f) return;
  const c = S.draft.chores[+row.dataset.i]; c[t.dataset.f] = t.dataset.f === 'name' || t.dataset.f === 'base' ? t.value : (t.value === '' ? '' : Number(t.value));
});
document.addEventListener('change', (e) => { if (e.target.dataset?.n) renderSettings(); });
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-act="key"]'); if (!f) return; e.preventDefault();
  const k = new FormData(f).get('k').trim(); if (!k) return;
  ls.set('hw_key', k); location.replace(location.pathname + '?k=' + encodeURIComponent(k));
});

// ───────── PWA: 홈 화면 추가 시 비밀 키가 포함된 시작 주소를 쓰도록 매니페스트를 동적으로 생성
async function dynamicManifest() {
  try {
    const m = await (await fetch('manifest.webmanifest')).json(); const base = new URL('./', location.href);
    m.start_url = new URL('./?k=' + encodeURIComponent(S.key), base).href; m.scope = base.href; m.id = base.href;
    m.icons = m.icons.map((i) => ({ ...i, src: new URL(i.src, base).href }));
    $('#manifest').href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
  } catch { /* 정적 매니페스트 사용 */ }
}

// ───────── 시작
(async function init() {
  applyTheme();
  const uk = urlKey(); if (uk) ls.set('hw_key', uk);
  S.key = window.HW.KEY || uk || ls.get('hw_key'); S.who = ls.get('hw_who');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
  try { const c = JSON.parse(ls.get('hw_cache') || 'null'); if (c) applyServer(c); } catch { /* noop */ }
  render();
  if (!S.key) return;
  dynamicManifest();
  await refresh(); startRealtime();
  // 이미 알림을 켠 기기는 구독 정보를 서버에 최신으로 맞춰 둠(만료·교체 대비)
  if (S.who && S.key) { const p = await getPush(); if (p.subscribed && p.perm === 'granted') pushSubscribe().catch(() => {}); }
})();
