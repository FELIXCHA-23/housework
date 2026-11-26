// 장보기 항목의 가격 후보를 컬리(식품)·다이소몰(비식품)에서 조회해 메모(n)로 갱신. GitHub Actions가 30분마다 실행.
// DRY=1 이면 저장하지 않고 결과만 출력.
import fs from 'node:fs';
const cfgjs = fs.readFileSync(new URL('../site/config.js', import.meta.url), 'utf8');
const cfgv = (k) => (cfgjs.match(new RegExp(k + ": '([^']*)'")) || [])[1];
const URL_ = cfgv('URL'), ANON = cfgv('ANON'), KEY = cfgv('KEY');
const DRY = !!process.env.DRY;
const H = { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const rpc = async (fn, args) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify({ p_key: KEY, ...args }) }); const t = await r.text(); if (!r.ok) throw new Error(`${fn} ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : null; };
const getj = async (u) => { const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 70)}`); return r.json(); };

// 항목 이름에 맞는 검색 조건(없으면 이름으로 자동 검색). must: 이름에 꼭 들어갈 말, pref: 있으면 이것만, bad: 제외
const SPECS = [
  { m: /^현미쌀/, s: 'kurly', q: ['현미쌀'], must: '현미', pref: '(3|4|5)\\s?kg', bad: 'DOG|CAT|누룽지|뻥튀기|과자|쌀국수|떡', n: 3 },
  { m: /^계란/, s: 'kurly', q: ['계란 30구', '달걀 30구'], must: '계란|달걀|유정란|등급란|특란|대란', pref: '30구|15구\\s*\\*\\s*2|15구\\s*x\\s*2', bad: '메추리|오리|훈제|구운|맥반석|보관함|트레이|케이스|용기|초란|왕란', n: 3, unit: 30 },
  { m: /^양배추/, s: 'kurly', q: ['양배추'], must: '양배추', pref: '한통|1통|1개|\\d\\.?\\d*kg', bad: 'DOG|CAT|강아지|고양이|소스|샐러드|치즈|즙|양념|분말|가루|스낵|칩|튀김|볶음|김치|피클|장난감|킁킁|슬라이스|채', n: 3 },
  { m: /^양상추/, s: 'kurly', q: ['양상추'], must: '양상추', pref: '1입|2입|통', bad: '소스|샐러드|믹스|DOG|CAT|즙', n: 3 },
  { m: /^양파/, s: 'kurly', q: ['양파'], must: '양파', pref: '(4|5|6)입|1\\.5kg|2kg|1kg|1망', bad: '소스|즙|장아찌|링|튀김|DOG|CAT|가루|분말|볶음|김치|스낵|칩', n: 3 },
  { m: /^불닭소스/, s: 'kurly', q: ['삼양 불닭소스', '불닭소스'], must: '불닭', bad: 'DOG|CAT|강아지|라면|볶음면|짜장|까르보|탕면|미역|참치|후랑크|칩|떡볶이|컵|비빔', n: 3 },
  { m: /^감자/, s: 'kurly', q: ['감자'], must: '감자', pref: '(1|2|3)\\s?kg', bad: '소스|고구마|옹심이|수제비|튀김|채|칩|스낵|DOG|CAT|가루|분말|볶음|전', n: 3 },
  { m: /^미니곽티슈/, s: 'daiso', q: ['미니곽티슈', '미니 티슈'], must: '미니.*티슈|티슈.*미니', bad: '케이스|포켓|물티슈|비데|인덕션|휴대|여행', n: 4 },
  { m: /^속옷\s?세탁망/, s: 'daiso', q: ['원형 세탁망', '속옷 세탁망'], must: '세탁망', pref: '원형|원통|브래지어', bad: '사각|여행|토트|쿠션|이중|반원|입체|하트|메쉬파우치', n: 5 },
];
const autoSpec = (it) => { const b = it.t.replace(/\(.*?\)/g, ' ').replace(/[0-9.,~\-]+\s*(kg|g|ml|l|개|구|입|망|봉|팩|장|통)?/gi, ' ').replace(/\s+/g, ' ').trim() || it.t; const w = b.split(' ')[0];
  return { s: it.c === 'non' ? 'daiso' : 'kurly', q: [b], must: w, bad: 'DOG|CAT|강아지|고양이|장난감|케이스|거치대|홀더|걸이|보관함|커버|받침|리필통|디스펜서', n: 3, auto: true }; };

async function kurly(q) { const d = (await getj(`https://api.kurly.com/search/v4/sites/market/normal-search?keyword=${encodeURIComponent(q)}&sort_type=4&page=1`)).data;
  const sec = (d.listSections || []).find((x) => x.view?.sectionCode === 'PRODUCT_LIST'); return (sec?.data?.items || []).filter((i) => !i.isSoldOut && i.discountedPrice && !i.isMultiplePrice).map((i) => ({ id: 'k' + i.no, name: i.name, price: i.discountedPrice })); }
async function daiso(q) { const d = await getj(`https://www.daisomall.co.kr/ssn/search/Search?searchTerm=${encodeURIComponent(q)}`); const out = [];
  for (const g of d.resultSet?.result || []) for (const x of g.resultDocuments || []) { const no = x.pdNo || x.PD_NO, name = x.pdNm || x.PDNM, price = Number(x.pdPrc || x.PD_PRC); if (no && name && price && !/^B\d/.test(String(no))) out.push({ id: 'd' + no, name, price }); } return out; }

async function lookup(spec) {
  const seen = new Map();
  for (const q of spec.q) { try { for (const c of await (spec.s === 'daiso' ? daiso(q) : kurly(q))) if (!seen.has(c.id)) seen.set(c.id, c); } catch (e) { console.error('  조회 실패', spec.s, q, e.message); } }
  let l = [...seen.values()].filter((c) => (!spec.must || new RegExp(spec.must, 'i').test(c.name)) && !(spec.bad && new RegExp(spec.bad, 'i').test(c.name)));
  if (spec.pref) { const p = l.filter((c) => new RegExp(spec.pref, 'i').test(c.name)); if (p.length) l = p; }
  return l.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name)).slice(0, spec.n || 3);
}
const won = (n) => n.toLocaleString('ko-KR') + '원';
const stamp = () => { const k = new Date(Date.now() + 9 * 3600000); return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`; };
const lineOf = (c, spec) => `${won(c.price)} ${c.name.replace(/\s+/g, ' ').trim().slice(0, 52)}${spec.unit ? ` (개당 ${won(Math.round(c.price / spec.unit))})` : ''}`;

const data = await rpc('hw_get', {}); const shop = data.config.shop || [];
const updates = new Map(); const now = Date.now();
for (const it of shop.filter((x) => !x.done)) {
  const spec = SPECS.find((s) => s.m.test(it.t)) || autoSpec(it);
  const cands = await lookup(spec);
  if (!cands.length) { console.log(`- ${it.t}: 후보 없음(기존 유지)`); continue; }
  const lines = cands.map((c) => lineOf(c, spec)); const label = spec.s === 'daiso' ? '다이소몰' : '컬리';
  const old = (it.n || '').split('\n'); const same = old.slice(1).join('\n') === lines.join('\n');
  const oldAge = (() => { const m = /(\d+)\/(\d+) (\d+):(\d+)/.exec(old[0] || ''); if (!m) return Infinity; const k = new Date(now + 9 * 3600000); const t = Date.UTC(k.getUTCFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]); return (k.getTime() - t) / 60000; })();
  console.log(`- ${it.t} [${label}${spec.auto ? ' 자동' : ''}] ${same ? (oldAge > 120 ? '변동 없음(확인 시각만 갱신)' : '변동 없음') : '가격/후보 변경'}`); lines.forEach((l) => console.log('    ' + l));
  if (same && oldAge <= 120) continue;
  updates.set(it.id, [`${label} ${stamp()} 기준${spec.auto ? ' (자동 검색)' : ''}`, ...lines].join('\n').slice(0, 400));
}
if (!updates.size) { console.log('저장할 변경 없음'); process.exit(0); }
if (DRY) { console.log(`DRY: ${updates.size}개 갱신 예정`); process.exit(0); }
// 저장 직전에 최신 설정을 다시 읽어 메모만 바꿈(다른 변경을 덮어쓰지 않게)
const fresh = (await rpc('hw_get', {})).config; let n = 0;
for (const it of fresh.shop || []) if (!it.done && updates.has(it.id)) { it.n = updates.get(it.id); n++; }
await rpc('hw_save_config', { p_data: fresh }); console.log(`저장 완료: ${n}개 항목 가격 갱신`);
