// 순수 로직(DOM·네트워크 없음). 앱과 Edge Function이 같은 파일을 씁니다.
export const DAY = 86400000;

export const DEFAULT_CONFIG = {
  names: { A: 'CSB', B: 'YSR' },
  anchor: '2026-11-09', // 1주차 시작(월)
  m73: true, // 주7회→주3회 변환 완료 표시
  chores: [
    { id: 'bed', name: '침대·이불 정리, 침실 환기', min: 5, per: 3, base: 'A' },
    { id: 'tidy', name: '벗어놓은 옷·물건 정리', min: 5, per: 3, base: 'A' },
    { id: 'living', name: '거실·소파·테이블 정리', min: 10, per: 3, base: 'A' },
    { id: 'counter', name: '식탁·조리대·싱크대 정리', min: 10, per: 3, base: 'B' },
    { id: 'dishes', name: '설거지 및 식기 정리', min: 20, per: 3, base: 'B' },
    { id: 'trash', name: '음식물·일반쓰레기 처리', min: 5, per: 3, base: 'B' },
    { id: 'bathquick', name: '욕실·세면대 간단 정리', min: 5, per: 3, base: 'B' },
    { id: 'entry', name: '현관·신발 정리', min: 5, per: 3, base: 'B' },
    { id: 'vacuum', name: '청소기·로봇청소기 돌리기', min: 30, per: 2, base: 'B' },
    { id: 'mop', name: '바닥 물걸레질', min: 30, per: 1, base: 'A' },
    { id: 'dust', name: '먼지 제거 및 가구 닦기', min: 20, per: 1, base: 'A' },
    { id: 'tools', name: '청소도구 세척·관리', min: 10, per: 1, base: 'B' },
    { id: 'menu', name: '식사 메뉴 결정 및 식사 계획', min: 15, per: 1, base: 'A' },
    { id: 'cook', name: '식재료 손질 및 요리', min: 40, per: 5, base: 'A' },
    { id: 'serve', name: '식사 차리기', min: 10, per: 5, base: 'A' },
    { id: 'fridge', name: '음식 보관 및 냉장고 정리', min: 15, per: 1, base: 'A' },
    { id: 'stock', name: '냉장고·생필품 재고 확인, 장보기 목록 작성', min: 15, per: 1, base: 'A' },
    { id: 'stove', name: '가스레인지·인덕션 청소', min: 15, per: 1, base: 'A' },
    { id: 'sort', name: '빨래 모으기·종류별 분류', min: 5, per: 2, base: 'A' },
    { id: 'wash', name: '세탁기 돌리기', min: 5, per: 2, base: 'A' },
    { id: 'dry', name: '빨래 널기·건조기 돌리기', min: 15, per: 2, base: 'A' },
    { id: 'fold', name: '빨래 개기', min: 15, per: 2, base: 'A' },
    { id: 'closet', name: '옷·속옷·수건 정리', min: 10, per: 2, base: 'A' },
    { id: 'sink', name: '세면대·거울 청소', min: 10, per: 1, base: 'B' },
    { id: 'toilet', name: '변기 청소', min: 10, per: 1, base: 'B' },
    { id: 'shower', name: '욕조·샤워부스 청소', min: 20, per: 1, base: 'B' },
    { id: 'bathfloor', name: '욕실 바닥·타일 청소', min: 15, per: 1, base: 'B' },
    { id: 'towel', name: '수건·욕실매트 교체 및 세탁', min: 5, per: 1, base: 'B' },
    { id: 'trashbag', name: '일반쓰레기 봉투 교체·배출', min: 5, per: 2, base: 'B' },
    { id: 'foodbin', name: '음식물쓰레기통 세척', min: 5, per: 1, base: 'B' },
    { id: 'paper', name: '종이·박스 분리배출', min: 10, per: 1, base: 'B' },
    { id: 'plastic', name: '플라스틱·캔·유리 분리배출', min: 10, per: 1, base: 'B' },
    { id: 'rinse', name: '재활용품 세척 및 정리', min: 10, per: 1, base: 'B' },
    { id: 'order', name: '가격 비교·온라인 장보기', min: 20, per: 1, base: 'B' },
    { id: 'shop', name: '직접 장보기', min: 60, per: 1, base: 'B' },
    { id: 'parcel', name: '택배 확인 및 물건 정리', min: 10, per: 2, base: 'B' },
  ],
};

export const cloneDefault = () => JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// 'YYYY-MM-DD' <-> UTC 자정 ms (날짜 계산 전용, 타임존 영향 없음)
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const fmtYmd = (ms) => new Date(ms).toISOString().slice(0, 10);

// 한국 시간 기준 "오늘" (기기 타임존과 무관)
export function kstNow(nowMs = Date.now()) {
  const k = new Date(nowMs + 9 * 3600000);
  return { ymd: k.toISOString().slice(0, 10), dow: ((k.getUTCDay() + 6) % 7) + 1, hour: k.getUTCHours() }; // dow: 월=1 … 일=7
}

export const mondayOf = (ymd) => { const ms = parseYmd(ymd); const dow = ((new Date(ms).getUTCDay() + 6) % 7); return fmtYmd(ms - dow * DAY); };
export const addDays = (ymd, n) => fmtYmd(parseYmd(ymd) + n * DAY);

// 주차 번호(시작 주=1, 이전 주는 0, -1 …)
export const weekNo = (wk, anchor) => Math.round((parseYmd(wk) - parseYmd(mondayOf(anchor))) / (7 * DAY)) + 1;
export const wkFromNo = (n, anchor) => addDays(mondayOf(anchor), (n - 1) * 7);

// 홀수 주=기본 담당, 짝수 주=A↔B 교대
export function ownerOf(chore, n) {
  const odd = ((n % 2) + 2) % 2 === 1;
  return odd ? chore.base : (chore.base === 'A' ? 'B' : 'A');
}

export function weekLoad(cfg, wk) {
  const n = weekNo(wk, cfg.anchor);
  const load = { A: 0, B: 0 };
  for (const c of cfg.chores) load[ownerOf(c, n)] += c.min * c.per;
  return load;
}

export const choresOf = (cfg, wk, who) => {
  const n = weekNo(wk, cfg.anchor);
  return cfg.chores.filter((c) => ownerOf(c, n) === who);
};

// 오늘(dow=1..7)까지 했어야 하는 횟수: floor(주당횟수 × dow / 7)  → 일요일엔 전부
export const dueBy = (per, dow) => Math.floor((per * dow) / 7);

// checks: { [chore]: done }  (해당 주)
export function pendingToday(cfg, wk, who, checks, dow) {
  let total = 0; const items = [];
  for (const c of choresOf(cfg, wk, who)) {
    const left = Math.max(0, dueBy(c.per, dow) - (checks[c.id] || 0));
    if (left > 0) { total += left; items.push({ name: c.name, left }); }
  }
  return { total, items };
}

export function weeklyDigest(cfg, wk, who) {
  const list = choresOf(cfg, wk, who);
  const minutes = list.reduce((s, c) => s + c.min * c.per, 0);
  return { n: weekNo(wk, cfg.anchor), list, minutes };
}

export const other = (who) => (who === 'A' ? 'B' : 'A');
export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

// 설정 검증/정규화 (저장 전)
export function sanitizeConfig(c) {
  const d = cloneDefault();
  const out = {
    names: { A: String(c?.names?.A ?? d.names.A).trim().slice(0, 12) || 'A', B: String(c?.names?.B ?? d.names.B).trim().slice(0, 12) || 'B' },
    anchor: /^\d{4}-\d{2}-\d{2}$/.test(c?.anchor) ? mondayOf(c.anchor) : d.anchor,
    chores: [],
  };
  if (c?.m73) out.m73 = true;
  out.shop = sanitizeShop(c?.shop);
  out.help = sanitizeHelp(c?.help);
  out.hlog = sanitizeHlog(c?.hlog);
  const seen = new Set();
  for (const x of c?.chores || []) {
    let id = String(x.id || '').replace(/[^\w-]/g, '').slice(0, 24) || 'c' + Math.random().toString(36).slice(2, 8);
    while (seen.has(id)) id += 'x';
    seen.add(id);
    out.chores.push({
      id,
      name: String(x.name ?? '').trim().slice(0, 40) || '이름 없음',
      min: Math.min(999, Math.max(0, Math.round(Number(x.min) || 0))),
      per: Math.min(14, Math.max(1, Math.round(Number(x.per) || 1))),
      base: x.base === 'B' ? 'B' : 'A',
    });
  }
  return out;
}

// 같이 쓰는 장보기 목록: [{ id, t, c:'food'|'non'(식품/비식품), by:'A'|'B', at:'YYYY-MM-DD', done, dwk:'산 주의 월요일' }]
export function sanitizeShop(list) {
  const out = []; const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const id = String(x?.id || '').replace(/[^\w-]/g, '').slice(0, 24); const t = String(x?.t ?? '').trim().slice(0, 40);
    if (!id || !t || seen.has(id)) continue; seen.add(id);
    const it = { id, t, by: x.by === 'B' ? 'B' : 'A', c: x.c === 'non' ? 'non' : 'food', at: /^\d{4}-\d{2}-\d{2}$/.test(x.at) ? x.at : '', done: !!x.done };
    const n = String(x.n ?? '').trim().slice(0, 400); if (n) it.n = n; // 메모(가격 후보 등)
    if (it.done && /^\d{4}-\d{2}-\d{2}$/.test(x.dwk)) it.dwk = x.dwk;
    out.push(it);
    if (out.length >= 200) break;
  }
  return out;
}
// 지난주(또는 그 전)에 산 것은 자동으로 정리
export const pruneShop = (list, wkNow) => list.filter((x) => !(x.done && x.dwk && x.dwk < wkNow));

// 도와준 체크 기록: { 'YYYY-MM-DD|집안일id': [칸번호, ...] }  (담당이 아닌 사람이 대신 체크한 칸)
export function sanitizeHelp(h) {
  const out = {};
  if (h && typeof h === 'object') for (const [k, v] of Object.entries(h)) {
    if (!/^\d{4}-\d{2}-\d{2}\|[\w-]{1,24}$/.test(k) || !Array.isArray(v)) continue;
    const a = [...new Set(v.map(Number).filter((i) => Number.isInteger(i) && i >= 1 && i <= 14))].sort((x, y) => x - y);
    if (a.length) out[k] = a;
  }
  const keys = Object.keys(out).sort(); // 오래된 것부터 정리
  for (const k of keys.slice(0, Math.max(0, keys.length - 1500))) delete out[k];
  return out;
}
// 체크 수가 prev→next로 바뀔 때 기록 갱신: 늘어난 칸은 helper가 했으면 기록, 아니면 기록 제거. 줄어든 칸은 기록 제거.
export function applyHelp(help, wk, id, prev, next, helper) {
  const k = wk + '|' + id; const cur = new Set(help[k] || []);
  if (next > prev) { for (let i = prev + 1; i <= next; i++) { if (helper) cur.add(i); else cur.delete(i); } }
  else for (let i = next + 1; i <= prev; i++) cur.delete(i);
  const out = { ...help }; if (cur.size) out[k] = [...cur].sort((a, b) => a - b); else delete out[k]; return out;
}
export const pruneHelp = (help, wkNow) => { const min = addDays(wkNow, -182); return Object.fromEntries(Object.entries(help || {}).filter(([k]) => k.slice(0, 10) >= min)); };
export const helpCount = (help, wk, list, checks) => list.reduce((a, c) => a + (help?.[wk + '|' + c.id] || []).filter((i) => i <= Math.min(checks[c.id] || 0, c.per)).length, 0);

// 도움 기록(영구 보관): [{ wk, c:집안일id, i:칸번호, n:이름, m:1회 분, by:'A'|'B'(도와준 사람), at:'YYYY-MM-DDTHH:MM'(한국시간) }]
export function sanitizeHlog(list) {
  const out = []; const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const wk = String(x?.wk || ''), c = String(x?.c || '').replace(/[^\w-]/g, '').slice(0, 24), i = Number(x?.i), at = String(x?.at || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wk) || !c || !Number.isInteger(i) || i < 1 || i > 14 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) continue;
    const k = wk + '|' + c + '|' + i; if (seen.has(k)) continue; seen.add(k);
    out.push({ wk, c, i, n: String(x.n ?? '').slice(0, 40), m: Math.min(999, Math.max(0, Math.round(Number(x.m) || 0))), by: x.by === 'B' ? 'B' : 'A', at });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.slice(-1000);
}
export const kstStamp = (nowMs = Date.now()) => new Date(nowMs + 9 * 3600000).toISOString().slice(0, 16);
// 체크 수 prev→next: 도와준 사람이 늘리면 기록 추가, 줄이면(해제) 그 칸의 기록 삭제
export function applyHlog(log, o) {
  let out = log.filter((e) => !(e.wk === o.wk && e.c === o.id && e.i > o.next && o.next < o.prev));
  if (o.next > o.prev && o.helper) for (let i = o.prev + 1; i <= o.next; i++) if (!out.some((e) => e.wk === o.wk && e.c === o.id && e.i === i)) out.push({ wk: o.wk, c: o.id, i, n: o.name, m: o.min, by: o.by, at: o.at });
  return out;
}
// 기간별 요약: range 'week'|'month'|'all', today 'YYYY-MM-DD'
export function helpSummary(log, range, today) {
  const inR = (e) => range === 'all' || (range === 'month' ? e.at.slice(0, 7) === today.slice(0, 7) : mondayOf(e.at.slice(0, 10)) === mondayOf(today));
  const list = log.filter(inR).sort((a, b) => (a.at < b.at ? 1 : -1));
  const sum = { A: { n: 0, m: 0 }, B: { n: 0, m: 0 } };
  for (const e of list) { sum[e.by].n++; sum[e.by].m += e.m; }
  return { list, sum };
}
