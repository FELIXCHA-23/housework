import * as C from './core.js';
import { grpOf, GORDER } from './groups.js';

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
  key: null, who: null, shopCat: ls.get('hw_shopcat') === 'non' ? 'non' : 'food', tab: ls.get('hw_tab') || 'chores', cfg: null, checks: {}, wk: C.mondayOf(C.kstNow().ymd),
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
  if (!S.cfg.m73 && data.config) { // 일회성: 주 7회 항목을 주 3회로
    const next = { ...S.cfg, m73: true, chores: S.cfg.chores.map((c) => (c.per === 7 ? { ...c, per: 3 } : c)) };
    const r = await rpc('hw_save_config', { p_data: next }); if (!r.error) S.cfg = C.sanitizeConfig(next);
  }
  { const wkNow = C.mondayOf(C.kstNow().ymd); if (C.pruneShop(S.cfg.shop || [], wkNow).length !== (S.cfg.shop || []).length) mutateShop((l) => C.pruneShop(l, wkNow), true); }
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
  const ae = document.activeElement, keep = ae && ae.matches?.('.shopadd input') ? { v: ae.value, s: ae.selectionStart } : null; // 입력 중 동기화돼도 글자 유지
  const st = window.scrollY; app.innerHTML = S.tab === 'shop' ? shopScreen() : mainScreen(); window.scrollTo(0, st);
  if (keep) { const i = $('.shopadd input'); if (i) { i.value = keep.v; i.focus(); try { i.setSelectionRange(keep.s, keep.s); } catch { /* noop */ } } }
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
    const dOf = (c) => Math.min(checks[c.id] || 0, c.per);
    const shown = S.filter === 'left' ? list.filter((c) => dOf(c) < c.per) : S.filter === 'zero' ? list.filter((c) => dOf(c) === 0) : list;
    const mine = S.who === s; // 본인 담당만 체크·해제 가능
    const rowHtml = (c) => {
      const d = dOf(c);
      const pip = (i) => `<button class="pipbtn${mine ? '' : ' help'}" data-act="pip" data-o="${s}" data-c="${esc(c.id)}" data-i="${i}" aria-pressed="${i <= d}" aria-label="${esc(c.name)} ${i}번째"><span class="pip${i <= d ? ' on' : ''}${i <= d && S.fresh.has(c.id + ':' + i) ? ' draw' : ''}">${i <= d ? CHECK_SVG : ''}</span></button>`;
      const pips = Array.from({ length: c.per }, (_, i) => pip(i + 1)).join('');
      const inline = c.per <= 3;
      return `<div class="chore${d >= c.per ? ' full' : ''}"><div class="row"><div class="nmb"><span class="nm">${esc(c.name)}</span><span class="meta">${c.min}분${c.per === 1 ? '' : ` × ${c.per} · ${d}/${c.per}`}</span></div>${inline ? `<span class="pg">${pips}</span>` : ''}</div>${inline ? '' : `<div class="pips">${pips}</div>`}</div>`;
    };
    // 묶음별 제목(진행률 + 이번 주 한 번도 안 한 개수) + 항목들. 제목을 누르면 접힘
    const rows = GORDER.map((g) => {
      const mem = shown.filter((c) => grpOf(c.name) === g); if (!mem.length) return '';
      const all = list.filter((c) => grpOf(c.name) === g);
      const gd = all.reduce((a, c) => a + dOf(c), 0), gt = all.reduce((a, c) => a + c.per, 0), zero = all.filter((c) => dOf(c) === 0).length;
      const k = s + '|' + g, open = !(S.gfold || {})[k];
      return `<div class="grp${open ? '' : ' shut'}" aria-expanded="${open}" data-act="gfold" data-k="${esc(k)}" role="button" tabindex="0"><span class="gn">${g}</span><span class="gs">${zero ? `<em>${zero}개 안 함</em>` : ''}<span class="gp"><b>${gd}</b>/${gt}</span><i class="gchev" aria-hidden="true"></i></span></div>${open ? `<div class="gbody">${mem.map(rowHtml).join('')}</div>` : ''}`;
    }).join('');
    const hidden = list.length - shown.length;
    const folded = S.who !== s && !(S.unfold || {})[s]; // 상대방 카드는 기본으로 접어 둠
    return `<section class="card person ${s.toLowerCase()}${folded ? ' folded' : ''}"><div class="head"${S.who !== s ? ` data-act="fold" data-w="${s}" role="button" tabindex="0"` : ''}><div><h2><span class="dot"></span>${esc(nm(s))}${S.who === s ? '<span class="me">나</span>' : ''}</h2>${lastTxt(s)}</div>
      <span class="prog"><b>${done}</b>/${sumPer}회 · ${C.fmtMin(doneMin)}${S.who !== s ? `<i class="chev">${folded ? '▾' : '▴'}</i>` : ''}</span></div><div class="meter"><i style="width:${sumPer ? (done / sumPer) * 100 : 0}%"></i></div>${rows || `<div class="empty">${list.length ? (S.filter === 'zero' ? '이번 주 안 한 항목이 없어요 🎉' : '남은 일이 없어요 🎉') : '이번 주 담당이 없어요'}</div>`}${hidden && rows ? `<div class="hid">완료한 ${hidden}개 숨김</div>` : ''}</section>`;
  };
  const order = S.who === 'B' ? ['B', 'A'] : ['A', 'B'];
  const [, wm, wd] = wk.split('-').map(Number);
  const wlabel = `${wm}월 ${['첫째', '둘째', '셋째', '넷째', '다섯째'][Math.ceil(wd / 7) - 1]}주`;
  const todayYmd = C.kstNow().ymd;
  const days = '월화수목금토일'.split('').map((w, i) => { const y = C.addDays(wk, i);
    return `<div class="day${y === todayYmd ? ' today' : ''}"><span class="dw">${w}</span><span class="dn">${Number(y.slice(8))}</span></div>`; }).join('');
  return `<div class="wrap"><div class="apptitle">집안일 임무분담제</div>${tabs()}<header class="top"><span style="width:44px;flex:none" aria-hidden="true"></span><button class="iconbtn" data-act="prev" aria-label="이전 주">‹</button>
    <div class="nav"><div class="weektitle"><b>${wlabel}${S.online ? '' : '<span class="pill off">오프라인</span>'}</b></div></div>
    <button class="iconbtn" data-act="next" aria-label="다음 주">›</button><button class="iconbtn" data-act="settings" aria-label="설정">⚙︎</button></header>
    <div class="days">${days}</div>
    <div class="seg filt" role="group" aria-label="보기">${[['all', '전체'], ['left', '남은 것만'], ['zero', '안 한 것']].map(([v, l]) => `<button data-act="filter" data-v="${v}" class="${(S.filter || 'all') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${isNow ? '' : '<div class="today"><button data-act="today">이번 주로 돌아가기</button></div>'}
    <section class="card sum"><div class="names"><div class="who"><span class="nm">${esc(nm('A'))}</span><span class="mn a">${load.A}<small>분</small></span></div>
      <div class="who"><span class="nm">${esc(nm('B'))}</span><span class="mn b">${load.B}<small>분</small></span></div></div>
      <div class="bar" role="img" aria-label="${esc(nm('A'))} ${Math.round(pa)}%, ${esc(nm('B'))} ${Math.round(100 - pa)}%"><i class="a" style="width:${pa}%"></i><i class="b" style="width:${100 - pa}%"></i></div>
      <div class="diff">${gap === 0 ? '<b>딱 균형</b>이에요' : `차이 <b>${gap}분</b> · ${esc(nm(heavier))} 쪽이 더 많아요`} <span style="opacity:.7">(${Math.round(pa)} : ${Math.round(100 - pa)})</span></div></section>
    ${order.map(person).join('')}</div>`;
}

// ───────── 장보기 (둘이 같이 쓰는 목록)
const tabs = () => { const n = (S.cfg.shop || []).filter((x) => !x.done).length;
  return `<div class="seg tabs" role="tablist">${[['chores', '집안일'], ['shop', `장보기${n ? ` <span class="cnt">${n}</span>` : ''}`]].map(([v, l]) => `<button role="tab" data-act="tab" data-v="${v}" aria-selected="${(S.tab || 'chores') === v}" class="${(S.tab || 'chores') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`; };
function shopScreen() {
  const list = S.cfg.shop || [], todo = list.filter((x) => !x.done), done = list.filter((x) => x.done);
  const row = (x) => `<div class="srow${x.done ? ' on' : ''}"><button class="sck" data-act="shoptog" data-id="${esc(x.id)}" aria-pressed="${x.done}" aria-label="${esc(x.t)} ${x.done ? '안 산 걸로' : '샀음'}"><span class="pip${x.done ? ' on' : ''}">${x.done ? CHECK_SVG : ''}</span></button>
    <span class="st">${esc(x.t)}${x.n ? `<small class="sn">${esc(x.n)}</small>` : ''}</span><span class="sby ${x.by.toLowerCase()}">${esc(nm(x.by))}</span><button class="sx" data-act="shopdel" data-id="${esc(x.id)}" aria-label="${esc(x.t)} 삭제">×</button></div>`;
  const cat = S.shopCat || 'food';
  const sec = (c, title, emoji) => { const l = todo.filter((x) => (x.c || 'food') === c); if (!l.length) return '';
    return `<div class="shoph cat ${c}"><span><i>${emoji}</i>${title}</span><em>${l.length}</em></div><section class="card shop">${l.map(row).join('')}</section>`; };
  const body = sec('food', '식품', '🥬') + sec('non', '비식품', '🧻');
  return `<div class="wrap"><div class="apptitle">집안일 임무분담제</div>${tabs()}
    <form class="shopadd" data-act="shopadd"><div class="seg catseg" role="group" aria-label="종류">${[['food', '식품'], ['non', '비식품']].map(([v, l]) => `<button type="button" data-act="shopcat" data-v="${v}" aria-pressed="${cat === v}" class="${cat === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="addrow"><input type="text" name="t" placeholder="${cat === 'food' ? '식품 (예: 우유 2개)' : '비식품 (예: 휴지)'}" maxlength="40" autocomplete="off" enterkeyhint="done" aria-label="살 것"><button class="btn primary" type="submit">추가</button></div></form>
    ${body || '<section class="card shop"><div class="empty">살 게 없어요. 위에 적으면 상대 폰에도 바로 보여요.</div></section>'}
    ${done.length ? `<div class="shoph"><span>산 것 ${done.length}개</span><button data-act="shopclear">산 것 지우기</button></div><section class="card shop">${done.map(row).join('')}</section>` : ''}
    <p class="note">체크한 건 다음 주 월요일에 자동으로 지워지고, 안 산 건 그대로 남아요.</p>
    ${list.length ? `<button class="btn danger${S.shopArmed ? ' armed' : ''}" data-act="shopall" style="margin-top:12px">${S.shopArmed ? '정말 다 지울까요? 한 번 더 누르세요' : '목록 전체 비우기'}</button>` : ''}</div>`;
}
// 서버 최신본에 같은 변경을 적용해서 저장(둘이 동시에 고쳐도 서로 덮어쓰지 않게)
async function mutateShop(fn, quiet) {
  S.cfg.shop = fn([...(S.cfg.shop || [])]); if (!quiet) render();
  S.pending++;
  try {
    const { data, error } = await rpc('hw_get'); if (error) throw error;
    const fresh = C.sanitizeConfig(data.config || S.cfg); fresh.shop = C.sanitizeShop(fn(fresh.shop || []));
    const r = await rpc('hw_save_config', { p_data: fresh }); if (r.error) throw r.error;
    S.cfg = fresh;
  } catch (e) { if (isAuthErr(e)) onError(e); else toast('저장 실패 — 연결을 확인해 주세요'); S.dirty = true; }
  S.pending--; if (S.pending === 0 && S.dirty) { S.dirty = false; refresh(); } else if (S.view !== 'settings') render();
}

// ───────── 설정(편집)
function openSettings() { S.openRow = null; S.setWho = S.who; S.draft = JSON.parse(JSON.stringify(S.cfg)); S.view = 'settings'; S.armed = false; getPush().then((p) => { S.push = p; if (S.view === 'settings') renderSettings(); }); S.sheetIn = true; setTimeout(() => { S.sheetIn = false; }, 400); renderSettings(); window.scrollTo(0, 0); }
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
  // 한 줄 목록: 이름 · 1회 분 · 주당 횟수가 한눈에. 줄을 누르면 그 자리에서 편집.
  const stepper = (i, f, v, unit, step, min, max) => `<div class="stp"><button class="sbtn" data-act="step" data-i="${i}" data-f="${f}" data-d="${-step}" data-min="${min}" data-max="${max}" aria-label="빼기">−</button><input type="number" inputmode="numeric" data-f="${f}" value="${v}" min="${min}" max="${max}"><span class="unit">${unit}</span><button class="sbtn" data-act="step" data-i="${i}" data-f="${f}" data-d="${step}" data-min="${min}" data-max="${max}" aria-label="더하기">+</button></div>`;
  const erow = (c, i) => {
    const open = S.openRow === i, to = c.base === 'A' ? 'B' : 'A';
    const line = `<button class="li" data-act="row" data-i="${i}" aria-expanded="${open}"><span class="lnm">${esc(c.name)}</span><span class="lmeta"><b>${Number(c.min) || 0}</b>분 · 주 <b>${Number(c.per) || 0}</b>회</span></button>`;
    if (!open) return `<div class="erow" data-i="${i}">${line}</div>`;
    return `<div class="erow open" data-i="${i}">${line}<div class="edit"><input type="text" data-f="name" value="${esc(c.name)}" aria-label="집안일 이름" maxlength="40">
      <div class="editgrid"><label>1회</label>${stepper(i, 'min', c.min, '분', 5, 0, 999)}<label>주당</label>${stepper(i, 'per', c.per, '회', 1, 1, 14)}</div>
      <div class="row2"><button class="btn sm" data-act="swap" data-i="${i}">→ ${esc(d.names[to])}</button><button class="btn sm danger" data-act="del" data-i="${i}">삭제</button><button class="btn sm" data-act="row" data-i="${i}">접기</button></div></div></div>`;
  };
  // 사람(탭) → 묶음(제목) → 한 줄 목록. 한 번에 한 사람만 보여서 화면이 좁아도 읽기 편함.
  const tw = S.setWho || S.who || 'A';
  const mine = d.chores.map((c, i) => [c, i]).filter(([c]) => c.base === tw);
  const sumMin = (arr) => arr.reduce((a, [c]) => a + (Number(c.min) || 0) * (Number(c.per) || 0), 0);
  const ptab = (w) => { const l = d.chores.filter((c) => c.base === w); const m = l.reduce((a, c) => a + (Number(c.min) || 0) * (Number(c.per) || 0), 0);
    return `<button role="tab" data-act="setwho" data-v="${w}" aria-selected="${tw === w}" class="ptab ${w.toLowerCase()}${tw === w ? ' on' : ''}"><b>${esc(d.names[w])}</b><span>${l.length}개 · ${C.fmtMin(m)}</span></button>`; };
  const groups = GORDER.map((g) => { const mem = mine.filter(([c]) => grpOf(c.name) === g); if (!mem.length) return '';
    return `<div class="sgh"><span>${g}</span><span>${mem.length}개 · ${C.fmtMin(sumMin(mem))}</span></div>${mem.map(([c, i]) => erow(c, i)).join('')}`; }).join('');
  const chores = `<div class="ptabs" role="tablist">${ptab('A')}${ptab('B')}</div><div class="slist ${tw.toLowerCase()}">${groups || '<div class="empty">담당이 없어요</div>'}</div>
    <button class="btn addbtn" data-act="add" data-b="${tw}">+ ${esc(d.names[tw])} 집안일 추가</button>`;
    $('#app').innerHTML = `<div class="wrap${S.sheetIn ? ' sheet-in' : ''}"><header class="top"><button class="iconbtn" data-act="back" aria-label="뒤로">‹</button><div class="nav"><div class="weektitle"><b>설정</b></div></div><span style="width:44px"></span></header>
  <h3>알림</h3><section class="card">${pushHtml}</section>
  <h3>내 정보</h3><section class="card"><div class="row2" style="align-items:center;justify-content:space-between"><span>이 기기: <b>${esc(nm(S.who))}</b></span><button class="btn sm" data-act="chwho">바꾸기</button></div></section>
  <h3>화면</h3><section class="card"><div class="seg" role="group" aria-label="화면 모드">${[['auto', '자동'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></section>
  <h3>이름</h3><section class="card"><div class="grid3" style="grid-template-columns:1fr 1fr"><div class="field"><label>A</label><input type="text" data-n="A" value="${esc(d.names.A)}" maxlength="12"></div><div class="field"><label>B</label><input type="text" data-n="B" value="${esc(d.names.B)}" maxlength="12"></div></div></section>
  <h3>담당 (총 ${d.chores.length}개)</h3><section class="card setcard">${chores}
  <p class="note">홀수 주 담당 기준이에요. 짝수 주엔 서로 바뀌어요. 줄을 누르면 고칠 수 있어요.</p></section>
  <h3>주차</h3><section class="card"><p class="note" style="margin:0 0 10px">지금 기준 1주차 시작: <b>${md(d.anchor)}</b> (${d.anchor.slice(0, 4)})</p><button class="btn" data-act="restart">이번 주를 1주차로 다시 시작</button></section>
  <h3>초기화</h3><section class="card"><button class="btn danger${S.armed ? ' armed' : ''}" data-act="reset">${S.armed ? '정말 전부 초기화 — 한 번 더 누르세요' : '전체 초기화'}</button><p class="note">모든 체크 기록을 지우고 집안일·이름을 처음 값으로 되돌려요.</p></section>
  <div class="savebar"><button class="btn" data-act="back">취소</button><button class="btn primary" data-act="save">저장</button></div></div>`;
}
async function saveCfg(cfg, msg) {
  const clean = C.sanitizeConfig(cfg);
  { const f = await rpc('hw_get'); clean.shop = C.sanitizeShop(f.data?.config?.shop ?? S.cfg.shop); } // 편집 중 바뀐 장보기 목록을 덮어쓰지 않게
  const { error } = await rpc('hw_save_config', { p_data: clean });
  if (error) { if (isAuthErr(error)) return onError(error); return toast('저장 실패 — 연결을 확인해 주세요'); }
  closeSheet(() => { S.cfg = clean; S.draft = null; S.view = 'main'; toast(msg || '저장했어요'); render(); refresh(); });
}

// ───────── 이벤트(위임)
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'pip') {
    const c =S.cfg.chores.find((x) => x.id === el.dataset.c); const i = +el.dataset.i; const cur = Math.min((S.checks[S.wk] || {})[c.id] || 0, c.per);
    if (el.dataset.o !== S.who && i > cur) toast('도와주기 체크 🤝');
    return setCheck(c, i <= cur ? i - 1 : i);
  }
  if (a === 'fold') { (S.unfold ||= {})[el.dataset.w] = !S.unfold[el.dataset.w]; return render(); }
  if (a === 'gfold') { (S.gfold ||= {})[el.dataset.k] = !S.gfold[el.dataset.k]; return render(); }
  if (a === 'filter') { S.filter = el.dataset.v; ls.set('hw_filter', S.filter); return render(); }
  if (a === 'tab') { S.tab = el.dataset.v; ls.set('hw_tab', S.tab); window.scrollTo(0, 0); return render(); }
  if (a === 'shopcat') { S.shopCat = el.dataset.v; ls.set('hw_shopcat', S.shopCat); return render(); }
  if (a === 'shoptog') { const id = el.dataset.id, x = (S.cfg.shop || []).find((i) => i.id === id); if (!x) return; const v = !x.done, wkNow = C.mondayOf(C.kstNow().ymd);
    return mutateShop((l) => l.map((i) => (i.id === id ? { ...i, done: v, dwk: v ? wkNow : undefined } : i))); }
  if (a === 'shopdel') { const id = el.dataset.id; return mutateShop((l) => l.filter((i) => i.id !== id)); }
  if (a === 'shopclear') return mutateShop((l) => l.filter((i) => !i.done));
  if (a === 'shopall') {
    if (!S.shopArmed) { S.shopArmed = true; render(); setTimeout(() => { if (S.shopArmed) { S.shopArmed = false; render(); } }, 4000); return; }
    S.shopArmed = false; const ids = new Set((S.cfg.shop || []).map((i) => i.id)); return mutateShop((l) => l.filter((i) => !ids.has(i.id)));
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
  if (a === 'setwho') { S.setWho = el.dataset.v; S.openRow = null; return renderSettings(); }
  if (a === 'row') { const i = +el.dataset.i; S.openRow = S.openRow === i ? null : i; renderSettings(); return document.querySelector(`.erow[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' }); }
  if (a === 'step') { const c = S.draft.chores[+el.dataset.i], f = el.dataset.f; c[f] = Math.min(+el.dataset.max, Math.max(+el.dataset.min, (Number(c[f]) || 0) + +el.dataset.d)); return renderSettings(); }
  if (a === 'swap') { const c = S.draft.chores[+el.dataset.i]; c.base = c.base === 'A' ? 'B' : 'A'; return renderSettings(); }
  if (a === 'add') { S.draft.chores.push({ id: 'c' + Math.random().toString(36).slice(2, 8), name: '새 집안일', min: 10, per: 1, base: el.dataset.b === 'B' ? 'B' : 'A' }); S.openRow = S.draft.chores.length - 1; renderSettings(); const r = document.querySelector(`.erow[data-i="${S.draft.chores.length - 1}"]`); r?.scrollIntoView({ block: 'center' }); return r?.querySelector('input')?.select(); }
  if (a === 'del') { S.draft.chores.splice(+el.dataset.i, 1); S.openRow = null; return renderSettings(); }
  if (a === 'restart') { S.draft.anchor = C.mondayOf(C.kstNow().ymd); S.wk = S.draft.anchor; return saveCfg(S.draft, '이번 주가 1주차가 됐어요'); }
  if (a === 'save') return saveCfg(S.draft);
  if (a === 'reset') {
    if (!S.armed) { S.armed = true; renderSettings(); setTimeout(() => { if (S.armed) { S.armed = false; if (S.view === 'settings') renderSettings(); } }, 4000); return; }
    S.armed = false;
    const { error } = await rpc('hw_reset', { p_data: { ...C.cloneDefault(), shop: S.cfg.shop || [] } });
    if (error) return toast('초기화 실패 — 연결을 확인해 주세요');
    S.cfg = { ...C.cloneDefault(), shop: S.cfg.shop || [] }; S.checks = {}; S.draft = null; S.view = 'main'; S.wk = C.mondayOf(C.kstNow().ymd); toast('초기화했어요'); render(); return;
  }
});
document.addEventListener('input', (e) => {
  const t = e.target; if (!S.draft) return;
  if (t.dataset.n) { S.draft.names[t.dataset.n] = t.value; return; }
  const row = t.closest('.erow'); if (!row || !t.dataset.f) return;
  const c = S.draft.chores[+row.dataset.i]; c[t.dataset.f] = t.dataset.f === 'name' || t.dataset.f === 'base' ? t.value : (t.value === '' ? '' : Number(t.value));
  const li = row.querySelector('.li'); if (li) { li.querySelector('.lnm').textContent = c.name; li.querySelector('.lmeta').innerHTML = `<b>${Number(c.min) || 0}</b>분 · 주 <b>${Number(c.per) || 0}</b>회`; }
});
document.addEventListener('change', (e) => { if (e.target.dataset?.n) renderSettings(); });
document.addEventListener('submit', (e) => {
  const sf = e.target.closest('form[data-act="shopadd"]');
  if (sf) { e.preventDefault(); const inp = sf.querySelector('input'); const t = inp.value.trim(); if (!t) return;
    const item = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: t.slice(0, 40), c: S.shopCat || 'food', by: S.who, at: C.kstNow().ymd, done: false };
    inp.value = ''; mutateShop((l) => [...l, item]); return; }
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
  S.filter = ['left', 'zero'].includes(ls.get('hw_filter')) ? ls.get('hw_filter') : 'all';
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
