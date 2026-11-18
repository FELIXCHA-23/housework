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
