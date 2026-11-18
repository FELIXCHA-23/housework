import assert from 'node:assert/strict';
import * as C from '../site/core.js';
const cfg = C.cloneDefault();
// 1주차(2026-11-09) 홀수: A 350, B 355
assert.deepEqual(C.weekLoad(cfg, '2026-11-09'), { A: 600, B: 590 });
// 2주차 짝수: 교대 → A 355, B 350
assert.deepEqual(C.weekLoad(cfg, '2026-11-16'), { A: 590, B: 600 });
assert.deepEqual(C.weekLoad(cfg, '2026-11-23'), { A: 600, B: 590 });
assert.equal(C.weekNo('2026-11-09', cfg.anchor), 1);
assert.equal(C.weekNo('2026-11-16', cfg.anchor), 2);
assert.equal(C.weekNo('2026-11-02', cfg.anchor), 0);
assert.equal(C.ownerOf({ base: 'A' }, 0), 'B');   // 0주차(짝수)
assert.equal(C.ownerOf({ base: 'A' }, -1), 'A');  // 음수 홀수
assert.equal(C.mondayOf('2026-11-15'), '2026-11-09'); // 일요일 → 그 주 월요일
assert.equal(C.mondayOf('2026-11-09'), '2026-11-09');
// KST: UTC 15:00 = KST 00:00 다음날
assert.deepEqual(C.kstNow(Date.UTC(2026, 10, 10, 15, 0)), { ymd: '2026-11-11', dow: 3, hour: 0 });
assert.equal(C.kstNow(Date.UTC(2026, 10, 15, 14, 59)).dow, 7); // 일요일 23:59 KST
// 오늘까지 안 한 일: 수요일(3), A(1주차): 매일 3개×3 + 요리·차리기 floor(15/7)=2씩 → 13
assert.equal(C.pendingToday(cfg, '2026-11-09', 'A', {}, 3).total, 13);
assert.equal(C.pendingToday(cfg, '2026-11-09', 'A', { cook: 2, serve: 5 }, 3).total, 9);
for (const w of ['A', 'B']) assert.equal(C.pendingToday(cfg, '2026-11-09', w, {}, 7).total, C.choresOf(cfg, '2026-11-09', w).reduce((s, c) => s + c.per, 0));
assert.equal(C.pendingToday(cfg, '2026-11-09', 'B', Object.fromEntries(cfg.chores.map((c) => [c.id, c.per])), 7).total, 0);
// sanitize
const s = C.sanitizeConfig({ names: { A: '  ', B: 'x' }, anchor: '2026-11-12', chores: [{ id: 'a', name: '', min: -5, per: 0, base: 'Z' }, { id: 'a', name: 'k', min: 3.4, per: 99 }] });
assert.equal(s.names.A, 'A'); assert.equal(s.anchor, '2026-11-09');
assert.deepEqual(s.chores.map((c) => [c.id, c.min, c.per, c.base]), [['a', 0, 1, 'A'], ['ax', 3, 14, 'A']]);
console.log('core ok');
