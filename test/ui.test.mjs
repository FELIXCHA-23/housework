import { chromium } from 'playwright-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { cloneDefault } from '../site/core.js';
process.env.NO_PROXY = 'localhost,127.0.0.1';
const root = path.resolve('site'); const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = new URL(q.url, 'http://x').pathname; const f = path.join(root, p === '/' ? 'index.html' : p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(5173);
const OUT = '/tmp/claude-0/shots'; fs.mkdirSync(OUT, { recursive: true });

const db = { config: cloneDefault(), checks: [], calls: [] };
const KEY = 'secret123';
const handle = (fn, a) => {
  if (a.p_key !== KEY) return { err: { code: '28000', message: 'unauthorized' } };
  db.calls.push([fn, a]);
  if (fn === 'hw_get') return { ok: { config: db.config, checks: db.checks.filter((c) => c.done > 0), now: new Date() } };
  if (fn === 'hw_set_check') { const c = db.checks.find((x) => x.wk === a.p_wk && x.chore === a.p_chore); if (c) c.done = a.p_done; else db.checks.push({ wk: a.p_wk, chore: a.p_chore, done: a.p_done }); return { ok: null }; }
  if (fn === 'hw_save_config') { db.config = a.p_data; return { ok: null }; }
  if (fn === 'hw_reset') { db.config = a.p_data; db.checks = []; return { ok: null }; }
  return { ok: null };
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const mk = async (scheme) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await ctx.route('**/rest/v1/rpc/*', async (route) => { const fn = route.request().url().split('/').pop(); const r = handle(fn, JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: r.err ? 400 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.err || r.ok) }); });
  await ctx.route('**/rest/v1/rpc/*', (r) => r.fallback()); // placeholder
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.error('PAGEERROR', e.message); process.exitCode = 1; }); return [ctx, pg];
};
const [ctx, pg] = await mk('light');
// 1) 키 없이 → 키 입력 화면
await pg.goto('http://localhost:5173/'); await pg.waitForSelector('input[name=k]');
await pg.screenshot({ path: `${OUT}/0-key.png` });
// 잘못된 키
await pg.fill('input[name=k]', 'wrong'); await pg.click('button[type=submit]'); await pg.waitForSelector('.err');
// 2) 올바른 키(URL)
await pg.goto(`http://localhost:5173/?k=${KEY}`); await pg.waitForSelector('.who-btn');
assert.equal((await pg.textContent('.who-btn.a')).trim(), '나는 CSB');
await pg.screenshot({ path: `${OUT}/1-who.png` });
await pg.click('.who-btn.a'); await pg.waitForSelector('.sum');
const txt = await pg.textContent('.sum'); assert.match(txt, /CSB350분YSR355분/.test(txt.replace(/\s/g, '')) ? /./ : /x^/);
assert.match(await pg.textContent('.weektitle'), /1주차/); // 오늘 2026-11-11(수) → 1주차 (시스템 시계 기준)
await pg.screenshot({ path: `${OUT}/2-main-light.png`, fullPage: true });
// 3) 체크: 설거지(B) 3번째 pip → 3, 한번 더 눌러 2로
await pg.click('.person.b .chore:has-text("설거지") .pipbtn[data-i="3"]');
await pg.waitForFunction(() => document.querySelector('.person.b .chore .meta')?.textContent.includes('3/7'));
assert.deepEqual(db.checks[0], { wk: '2026-11-09', chore: 'dishes', done: 3 });
assert.equal(db.calls.at(-1)[1].p_who, 'A');
await pg.click('.person.b .chore:has-text("설거지") .pipbtn[data-i="3"]');
await pg.waitForFunction(() => document.querySelector('.person.b .chore .meta')?.textContent.includes('2/7'));
assert.equal(db.checks[0].done, 2);
// 4) 주 이동: 2주차는 교대 → A 355 / B 350
await pg.click('[data-act=next]'); await pg.waitForFunction(() => document.querySelector('.weektitle b').textContent.includes('2주차'));
assert.match((await pg.textContent('.sum')).replace(/\s/g, ''), /CSB355분YSR350분/);
assert.equal(await pg.locator('.person.a .chore').count(), 7); // A가 B 기본 목록 담당
await pg.screenshot({ path: `${OUT}/3-week2.png` });
await pg.click('[data-act=today]');
// 5) 설정: 이름·집안일 추가/수정/삭제 → 저장
await pg.click('[data-act=settings]'); await pg.waitForSelector('.savebar');
await pg.screenshot({ path: `${OUT}/4-settings.png`, fullPage: true });
await pg.click('[data-act=add]'); const last = pg.locator('.erow').last();
await last.locator('[data-f=name]').fill('창문 닦기'); await last.locator('[data-f=min]').fill('25'); await last.locator('[data-f=per]').fill('2'); await last.locator('[data-f=base]').selectOption('B');
await pg.locator('.erow').first().locator('[data-act=del]').click(); // 저녁 식사 삭제
await pg.click('.savebar [data-act=save]'); await pg.waitForSelector('.sum');
assert.equal(db.config.chores.length, 10); assert.ok(db.config.chores.some((c) => c.name === '창문 닦기' && c.min === 25 && c.per === 2 && c.base === 'B'));
assert.ok(!db.config.chores.some((c) => c.id === 'dinner'));
// 6) 전체 초기화는 2번 눌러야 동작
await pg.click('[data-act=settings]'); const before = db.calls.length;
await pg.click('[data-act=reset]'); assert.equal(db.calls.length, before); assert.match(await pg.textContent('[data-act=reset]'), /한 번 더/);
await pg.click('[data-act=reset]'); await pg.waitForSelector('.sum');
assert.equal(db.config.chores.length, 10); assert.ok(db.config.chores.some((c) => c.id === 'dinner')); assert.equal(db.checks.length, 0);
// 7) 푸시 미지원 안내(헤드리스 크롬은 지원 → 상태 문구만 확인) + 1주차 재시작
await pg.click('[data-act=settings]'); await pg.waitForSelector('.status');
console.log('push status:', (await pg.textContent('.status')).trim());
await pg.click('[data-act=restart]'); await pg.waitForSelector('.sum');
assert.equal(db.config.anchor, '2026-11-09'); // 오늘이 11/11이므로 이번 주 월요일=11/9
// 8) 잘못된 키 저장 상태 → 키 화면으로 복귀
await pg.evaluate(() => localStorage.setItem('hw_key', 'bad')); await pg.goto('http://localhost:5173/'); await pg.waitForSelector('input[name=k]'); await pg.waitForSelector('.err');
await ctx.close();
// 9) 다크 모드 스크린샷 + 체크 일부 완료 상태
const [c2, p2] = await mk('dark');
db.checks = [{ wk: '2026-11-09', chore: 'dishes', done: 4 }, { wk: '2026-11-09', chore: 'dinner', done: 2 }, { wk: '2026-11-09', chore: 'mop', done: 1 }];
await p2.goto(`http://localhost:5173/?k=${KEY}`); await p2.evaluate(() => localStorage.setItem('hw_who', 'B')); await p2.reload(); await p2.waitForSelector('.sum');
await p2.screenshot({ path: `${OUT}/5-main-dark.png`, fullPage: true });
const manifestHref = await p2.getAttribute('#manifest', 'href'); console.log('manifest:', manifestHref.slice(0, 12));
console.log('ui ok'); await b.close(); srv.close();
