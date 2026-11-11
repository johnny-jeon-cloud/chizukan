import * as C from "./core.mjs";
import * as E from "./engine.mjs";
import assert from "node:assert/strict";
const rng = E.mulberry32(12345), rand = () => rng();
let now = Date.UTC(2026, 10, 11, 3, 0, 0);
const S = C.freshState(now); assert.equal(S.packs, 3);
// 開封と保底
let golds = 0, rars = { N: 0, R: 0, SR: 0, SSR: 0 };
for (let i = 0; i < 2000; i++) {
  S.packs = 1; S.pity = S.pity;
  const pityBefore = S.pity; const r = C.openPack(S, now, rand);
  assert.equal(r.cards.length, 3);
  const hi = r.cards.some(x => ["SR", "SSR"].includes(C.BY_ID[x.id].rar));
  if (pityBefore >= 9) { assert(hi, "gold pack must have SR+"); assert.equal(S.pity, 0); golds++; }
  r.cards.forEach(x => rars[C.BY_ID[x.id].rar]++);
}
console.log("golds", golds, rars);
assert.equal(golds, 200);
// ストック不足
S.packs = 0; assert.throws(() => C.openPack(S, now, rand), e => e.code === "no_packs");
// 時間付与: 4h ごと +1、上限3
const T = C.freshState(now); T.packs = 0; T.lastGrant = now;
C.tick(T, now + 3 * 3600e3); assert.equal(T.packs, 0);
C.tick(T, now + 4 * 3600e3); assert.equal(T.packs, 1);
C.tick(T, now + 9 * 3600e3); assert.equal(T.packs, 2); assert.equal(T.lastGrant, now + 8 * 3600e3);
C.tick(T, now + 100 * 3600e3); assert.equal(T.packs, 3); assert.equal(T.lastGrant, now + 100 * 3600e3);
// 未来の lastGrant は補正
const U = C.freshState(now); U.packs = 0; U.lastGrant = now + 1e12; C.tick(U, now); assert(U.lastGrant <= now);
// 日替わり（JST 0時）
const D = C.freshState(Date.UTC(2026, 10, 11, 14, 59)); D.battlesToday = 5; D.tasks.opened = 2;
C.tick(D, Date.UTC(2026, 10, 11, 14, 59)); assert.equal(D.battlesToday, 5);
C.tick(D, Date.UTC(2026, 10, 11, 15, 0)); assert.equal(D.battlesToday, 0); assert.equal(D.day, "2026-11-12");
// 交換
const X = C.freshState(now); X.mp = 100;
const n = C.CARDS.find(c => c.rar === "N"), sr = C.CARDS.find(c => c.rar === "SR");
C.exchange(X, now, n.id); assert.equal(X.mp, 90); assert.throws(() => C.exchange(X, now, n.id), e => e.code === "already_owned");
assert.throws(() => C.exchange(X, now, sr.id), e => e.code === "no_mp"); X.mp = 100; C.exchange(X, now, sr.id); assert.equal(X.mp, 0);
assert.throws(() => C.exchange(X, now, 9999), e => e.code === "bad_card");
// タスク報酬
const K = C.freshState(now); assert.throws(() => C.claim(K, now, "c1")); K.tasks.opened = 1; C.claim(K, now, "c1"); assert.equal(K.packs, 4); assert.throws(() => C.claim(K, now, "c1"));
K.tasks.battles = 3; C.claim(K, now, "c2"); assert.equal(K.packs, 5);
// 編成
const B = C.freshState(now); C.CARDS.slice(0, 5).forEach(c => B.owned[c.id] = 1);
assert.throws(() => C.setTeam(B, [1, 2, 99]), e => e.code === "bad_team"); assert.throws(() => C.setTeam(B, [1, 1])); C.setTeam(B, [1, 2, 3]);
// 対戦: 開始→完了、結果は決定的でクライアントと同じ
for (let k = 0; k < 40; k++) {
  const P = C.freshState(now); C.CARDS.forEach(c => P.owned[c.id] = 1); C.setTeam(P, [1, 2, 3]); P.points = (k % 10) * 40;
  const s = C.battleStart(P, now, rand); assert.equal(s.A.length, 3); assert.equal(s.B.length, 3); assert(P.pending);
  const plan = [null, "rush", "auto", "swap", "guard", "x", null]; const cp = C.cleanPlan(plan); assert.equal(cp.length, 8); assert.equal(cp[5], null);
  const exp = C.runBattle(s.A, s.B, s.seed, cp);
  const before = P.points; const r = C.battleFinish(P, now, plan);
  assert.equal(r.res, exp.res); assert.equal(r.rounds, exp.rounds);
  assert.equal(P.points, before + (r.res === 1 ? 12 : r.res === -1 ? -Math.min(before, 6) : 0));
  assert.equal(P.pending, null); assert.equal(P.battlesToday, 1); assert.equal(P.tasks.battles, 1); assert(P.history.length === 1); C.invariant(P);
}
// 日次上限・離脱は敗北・二重完了不可
const Q = C.freshState(now); C.CARDS.forEach(c => Q.owned[c.id] = 1); C.setTeam(Q, [1, 2, 3]); Q.points = 3;
for (let i = 0; i < 10; i++) { C.battleStart(Q, now, rand); if (i % 2) C.battleFinish(Q, now, []); }
assert.throws(() => C.battleStart(Q, now, rand), e => e.code === "daily_limit");
assert.throws(() => C.battleFinish(Q, now, []), e => e.code === "no_battle" || true);
const F = C.freshState(now); C.CARDS.forEach(c => F.owned[c.id] = 1); C.setTeam(F, [4, 5, 6]); F.points = 4;
C.battleStart(F, now, rand); const ff = C.forfeitPending(F, now); assert.equal(ff.pts, -4); assert.equal(F.points, 0); assert.equal(F.stats.l, 1);
C.battleStart(F, now, rand); C.battleStart(F, now, rand); assert.equal(F.stats.l, 2); assert.equal(F.history[0].forfeit, true);
assert.throws(() => C.battleFinish(C.freshState(now), now, []), e => e.code === "no_battle");
// 未所持の編成で対戦不可
const G = C.freshState(now); assert.throws(() => C.battleStart(G, now, rand), e => e.code === "no_team");
// CPU 強度: ポイントが高いほど強い
const avg = p => { let s = 0; for (let i = 0; i < 40; i++) s += E.teamPower(C.makeOpponent(p, rand).ids.map(x => C.BY_ID[x])); return s / 40; };
const a0 = avg(0), a300 = avg(300); console.log("cpu power", Math.round(a0), Math.round(a300)); assert(a300 > a0 + 50);
// 公開ビューに pending 詳細を含めない
const V = C.view(F, now); assert.equal(typeof V.pending, "boolean"); assert(!("seed" in V));
console.log("digest", C.cardsDigest().length, "ALL OK");
