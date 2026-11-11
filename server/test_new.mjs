import * as C from "./core.mjs";
import * as E from "./engine.mjs";
import assert from "node:assert/strict";
const rng = E.mulberry32(777), rand = () => rng();
const now = Date.UTC(2026, 10, 11, 3, 0, 0);
const mk = () => { const P = C.freshState(now); C.CARDS.forEach(c => P.owned[c.id] = 1); C.setTeam(P, [1, 2, 3]); return P; };
// normState: 旧状態の補完
const old = { v: 1, packs: 1, mp: 0, owned: {}, team: [], points: 0, day: "2026-11-11", stats: { packs: 0, w: 0, l: 0, d: 0 } };
C.normState(old); assert.equal(old.v, 2); assert(old.ach && old.boss && old.trip && old.ch && old.stats.boss === 0);
// 首領: 日付で固定・毎日変わりうる・1日1回・日次対戦数に入らない
const b1 = C.bossFor("2026-11-11"), b1b = C.bossFor("2026-11-11"), b2 = C.bossFor("2026-11-12");
assert.deepEqual(b1.ids, b1b.ids); assert.equal(b1.ids.length, 3); assert(new Set(b1.ids).size === 3);
const P = mk(); let s = C.battleStart(P, now, rand, { boss: true });
assert.deepEqual(s.B, b1.ids); assert.equal(P.battlesToday, 0); assert.equal(s.mode, "boss");
assert.throws(() => C.battleStart(P, now, rand, { boss: true }), e => e.code === "boss_done");
const pk0 = P.packs, mp0 = P.mp, pts0 = P.points; const r = C.battleFinish(P, now, []);
assert.equal(P.points, pts0); assert.equal(r.mode, "boss"); assert.equal(P.boss.res, r.res);
if (r.res === 1) { assert.equal(P.packs, pk0 + 2); assert.equal(P.mp, mp0 + 10); } else assert.equal(P.mp, mp0 + 3);
// 首領戦の離脱は挑戦権を消費するがptは減らない
const F = mk(); F.points = 50; C.battleStart(F, now, rand, { boss: true }); const ff = C.forfeitPending(F, now); assert.equal(ff.pts, 0); assert.equal(F.points, 50);
assert.throws(() => C.battleStart(F, now, rand, { boss: true }), e => e.code === "boss_done");
// 翌日は再挑戦可
C.battleStart(F, now + 24 * 3600e3, rand, { boss: true });
// 挑戦: 自分以外のチーム・1日3回・同じ相手は1日1回・低ポイント相手は+4
const H = mk(); H.points = 100;
const tgt = (pub, pts) => ({ pub, name: "テスト", team: [10, 20, 30], points: pts });
assert.throws(() => C.battleStart(H, now, rand, { ch: { pub: "x", name: "a", team: [1, 2], points: 0 } }), e => e.code === "bad_target");
let wins = 0, lowChecked = false;
for (let i = 0; i < 200 && !lowChecked; i++) {
  const X = mk(); X.points = 100; C.battleStart(X, now, rand, { ch: tgt("aaaaaaaaaa", 10) });
  assert.equal(X.battlesToday, 1); assert.deepEqual(X.ch.ids, ["aaaaaaaaaa"]);
  assert.throws(() => C.battleStart(X, now, rand, { ch: tgt("aaaaaaaaaa", 10) }), e => e.code === "ch_done");
  const res = C.battleFinish(X, now, []); if (res.res === 1) { assert.equal(res.pts, 4); assert.equal(X.stats.ch, 1); lowChecked = true; }
}
assert(lowChecked);
{ const X = mk(); X.points = 30; C.battleStart(X, now, rand, { ch: tgt("bbbbbbbbbb", 100) }); for (let i = 0; i < 20; i++) { const Y = mk(); Y.points = 30; C.battleStart(Y, now, rand, { ch: tgt("cccccccccc", 100) }); const q = C.battleFinish(Y, now, []); if (q.res === 1) { assert.equal(q.pts, 12); break; } } }
{ const X = mk(); for (let i = 0; i < 3; i++) { C.battleStart(X, now, rand, { ch: tgt("p" + i + "xxxxxxxxx", 0) }); C.battleFinish(X, now, []); }
  assert.throws(() => C.battleStart(X, now, rand, { ch: tgt("zzzzzzzzzz", 0) }), e => e.code === "ch_limit");
  C.tick(X, now + 24 * 3600e3); assert.equal(X.ch.ids.length, 0); }
// 旅: 1日1回
const T = mk(); const tr = C.trip(T, now, rand); assert(T.owned[tr.id]); assert.equal(T.mp, C.CFG.TRIP_MP);
assert.throws(() => C.trip(T, now, rand), e => e.code === "trip_done"); C.trip(T, now + 24 * 3600e3, rand); assert.equal(T.trip.n, 2);
assert.throws(() => C.trip(C.freshState(now), now, rand), e => e.code === "no_cards");
// 名前
const N = C.freshState(now); assert.equal(C.setName(N, now, "  タビ ビト  ").name, "タビ ビト");
assert.throws(() => C.setName(N, now, "<b>x</b>"), e => e.code === "bad_name"); assert.throws(() => C.setName(N, now, ""), e => e.code === "bad_name");
assert.throws(() => C.setName(N, now, "あ".repeat(13)), e => e.code === "bad_name"); assert.throws(() => C.setName(N, now, "https://x.y"), e => e.code === "bad_name");
assert.throws(() => C.setName(N, now, "別の名前"), e => e.code === "name_limit"); C.setName(N, now + 24 * 3600e3, "別の名前");
// 実績
const A = C.freshState(now); assert.equal(C.checkAch(A, now).length, 0);
C.CARDS.forEach(c => A.owned[c.id] = 1); A.stats.packs = 60; A.stats.w = 55; A.points = 320; A.stats.boss = 1; A.stats.ch = 1; A.trip.n = 7;
const got = C.checkAch(A, now); assert.equal(got.length, C.ACH.length, "all ach"); assert.equal(C.checkAch(A, now).length, 0);
const pk = C.ACH.reduce((a, x) => a + (x.r.packs || 0), 0), mpR = C.ACH.reduce((a, x) => a + (x.r.mp || 0), 0);
assert.equal(A.packs, 3 + pk); assert.equal(A.mp, mpR); C.invariant(A);
assert.equal(new Set(C.ACH.map(x => x.id)).size, C.ACH.length);
// view に新項目
const v = C.view(A, now); assert(v.boss.ids.length === 3 && v.trip && v.ch && v.ach && typeof v.name === "string");
console.log("NEW CORE TESTS OK");
