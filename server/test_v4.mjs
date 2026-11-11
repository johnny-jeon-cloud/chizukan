import * as C from "./core.mjs";
import assert from "node:assert";
let seed = 7; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const T = Date.UTC(2026, 10, 11, 3);
const S = C.freshState(T); C.tick(S, T);
for (let i = 0; i < 3; i++) C.openPack(S, T, rand);
assert.equal(S.track.xp, 30);
const ids = Object.keys(S.owned).map(Number); while (ids.length < 6) { S.owned[C.CARDS[ids.length * 9].id] = 1; ids.push(C.CARDS[(ids.length) * 9].id); }
const own = Object.keys(S.owned).map(Number);
C.setTeam(S, own.slice(0, 3)); assert.deepEqual(S.decks[0], own.slice(0, 3));
C.setDeck(S, 1); assert.deepEqual(S.team, []); C.setTeam(S, own.slice(3, 6));
C.setDeck(S, 0); assert.deepEqual(S.team, own.slice(0, 3)); assert.deepEqual(S.decks[1], own.slice(3, 6));
assert.throws(() => C.setDeck(S, 3));
// 練習: 何も変動しない
const b0 = S.battlesToday, p0 = S.points, x0 = S.track.xp, w0 = S.tasks.wins;
for (const lv of [0, 1, 2]) { const r = C.battleStart(S, T, rand, { prac: lv }); assert.equal(r.mode, "prac"); const f = C.battleFinish(S, T, ["auto"]); assert.equal(f.pts, 0); }
assert.equal(S.battlesToday, b0); assert.equal(S.points, p0); assert.equal(S.track.xp, x0); assert.equal(S.tasks.wins, w0);
C.battleStart(S, T, rand, { prac: 0 }); const ff = C.forfeitPending(S, T); assert.equal(ff.pts, 0); assert.equal(S.stats.l, 0);
assert.throws(() => C.battleStart(S, T, rand, { prac: 5 }));
// 通常戦でXP
C.battleStart(S, T, rand); const f = C.battleFinish(S, T, ["auto"]); assert.equal(S.track.xp, x0 + (f.res === 1 ? 30 : 15));
// トラック
S.track.xp = 520; const pk = S.packs, mp = S.mp; const up = C.trackTick(S);
assert.equal(up.length, 5); assert.equal(S.track.lv, 5); assert.equal(S.packs, pk + 1); assert.equal(S.mp, mp + 5 * 4 + 10);
assert.equal(C.trackTick(S).length, 0);
S.track.xp = 99999; C.trackTick(S); assert.equal(S.track.lv, 30); assert.equal(C.view(S, T).track.next, null);
// シーズン切替でリセット
C.tick(S, Date.UTC(2026, 11, 2, 3)); assert.equal(S.track.xp, 0); assert.equal(S.track.lv, 0);
// 旧状態の移行
const old = C.normState({ team: [1, 2, 3], owned: { 1: 1, 2: 1, 3: 1 }, points: 5, tasks: {}, stats: {}, day: "2026-11-11" });
assert.deepEqual(old.decks, [[1, 2, 3], [], []]); assert.equal(old.track.xp, 0);
C.invariant(S); console.log("v4 OK");
