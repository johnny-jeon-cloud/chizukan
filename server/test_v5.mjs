import * as C from "./core.mjs"; import * as E from "./engine.mjs";
import assert from "node:assert";
let seed = 11; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const T = Date.UTC(2026, 10, 11, 3);
const S = C.freshState(T); C.tick(S, T);
[1, 6, 9].forEach(i => S.owned[i] = 1); C.setTeam(S, [1, 6, 9]);
// 向導
assert.throws(() => C.setGuide(S, "zzz")); C.setGuide(S, "sea"); assert.equal(C.view(S, T).guide, "sea");
const base = E.prepTeams([1, 6, 9].map(i => C.BY_ID[i]), [4, 5, 8].map(i => C.BY_ID[i]), {}), g = E.prepTeams([1, 6, 9].map(i => C.BY_ID[i]), [4, 5, 8].map(i => C.BY_ID[i]), { g: "sea" });
assert.equal(g.A[0].atk, E.roundHalfEven(base.A[0].atk * 1.08)); assert.equal(g.A[1].atk, base.A[1].atk); assert.deepEqual(g.B, base.B);
const sw = E.prepTeams([1, 6, 9].map(i => C.BY_ID[i]), [4, 5, 8].map(i => C.BY_ID[i]), { rule: "swap" }); assert.equal(sw.B[0].atk, base.B[0].def);
let r = C.battleStart(S, T, rand); assert.equal(r.g, "sea"); let f = C.battleFinish(S, T, []); assert.equal(S.history[0].g, "sea");
// 乱闘
assert.equal(C.weekId(Date.UTC(2026, 10, 8, 14, 59)) !== C.weekId(Date.UTC(2026, 10, 8, 15, 0)), true); // 日曜→月曜(JST)
const bt = S.battlesToday, pt = S.points, xp = S.track.xp;
let won = false, n = 0;
while (!won && n++ < 40) { r = C.battleStart(S, T, rand, { brawl: true }); assert.equal(r.mode, "brawl"); assert.equal(r.rule, C.view(S, T).brawl.rule); f = C.battleFinish(S, T, "x"); if (f.res === 1) { won = true; assert.deepEqual(f.reward, C.CFG.BRAWL_WIN); } }
if (won) { r = C.battleStart(S, T, rand, { brawl: true }); f = C.battleFinish(S, T, []); assert.equal(f.reward, null); }
assert.equal(S.battlesToday, bt); assert.equal(S.points, pt); assert.equal(S.track.xp, xp);
C.tick(S, T + 8 * 864e5 - 30 * 864e5 * 0); 
// 闘技場
const T2 = T; assert.throws(() => C.battleStart(S, T2, rand, { arena: true }));
C.arenaStart(S, T2, rand); assert.throws(() => C.arenaStart(S, T2, rand));
let v = C.view(S, T2).arena; assert.equal(v.offer.length, 3); assert.throws(() => C.arenaPick(S, 5));
for (let i = 0; i < 3; i++) C.arenaPick(S, i); assert.throws(() => C.arenaPick(S, 0));
v = C.view(S, T2).arena; assert.equal(v.picks.length, 3); assert.equal(v.offer, null);
let guard = 0, mp0 = S.mp, pk0 = S.packs;
while (!S.arena.done && guard++ < 10) { r = C.battleStart(S, T2, rand, { arena: true }); assert.deepEqual(r.A, S.arena.picks); f = C.battleFinish(S, T2, []); }
assert.ok(S.arena.done); assert.deepEqual(f.reward, C.CFG.ARENA_REWARD[S.arena.w]); assert.equal(S.mp, mp0 + f.reward.mp);
assert.throws(() => C.battleStart(S, T2, rand, { arena: true })); assert.throws(() => C.arenaStart(S, T2, rand));
C.arenaStart(S, T2 + 864e5, rand); for (let i = 0; i < 3; i++) C.arenaPick(S, 0);
C.battleStart(S, T2 + 864e5, rand, { arena: true }); C.forfeitPending(S, T2 + 864e5); assert.equal(S.arena.l, 1);
C.invariant(S); console.log("v5 OK");
