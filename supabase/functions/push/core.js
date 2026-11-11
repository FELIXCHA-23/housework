// 순수 로직(DOM·네트워크 없음). 앱과 Edge Function이 같은 파일을 씁니다.
export const DAY = 86400000;

export const DEFAULT_CONFIG = {
  names: { A: 'CSB', B: 'YSR' },
  anchor: '2026-11-09', // 1주차 시작(월)
  chores: [
    { id: 'dinner', name: '저녁 식사 준비', min: 40, per: 5, base: 'A' },
    { id: 'dishes', name: '설거지', min: 20, per: 7, base: 'B' },
    { id: 'laundry', name: '빨래 (세탁·널기·개기)', min: 60, per: 2, base: 'A' },
    { id: 'vacuum', name: '청소기', min: 30, per: 2, base: 'B' },
    { id: 'mop', name: '바닥 걸레질', min: 30, per: 1, base: 'A' },
    { id: 'toilet', name: '화장실 청소', min: 30, per: 1, base: 'B' },
    { id: 'recycle', name: '분리수거', min: 15, per: 2, base: 'B' },
    { id: 'food', name: '음식물 쓰레기', min: 5, per: 4, base: 'B' },
    { id: 'shop', name: '장보기', min: 60, per: 1, base: 'B' },
    { id: 'trash', name: '쓰레기통 비우기', min: 5, per: 3, base: 'B' },
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
