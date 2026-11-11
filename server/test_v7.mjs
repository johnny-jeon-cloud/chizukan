import * as C from "./core.mjs"; import assert from "node:assert";
let seed = 5; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const T = Date.UTC(2026, 10, 12, 3); const S = C.freshState(T);
[1, 6, 9].forEach(i => S.owned[i] = 1); C.setTeam(S, [1, 6, 9]);
// 友だち
assert.throws(() => C.friendAdd(S, "zz", "aaaaaaaaaa")); assert.throws(() => C.friendAdd(S, "aaaaaaaaaa", "aaaaaaaaaa"));
C.friendAdd(S, "bbbbbbbbbb", "aaaaaaaaaa"); assert.throws(() => C.friendAdd(S, "bbbbbbbbbb", "aaaaaaaaaa"));
assert.throws(() => C.battleStart(S, T, rand, { fr: { pub: "cccccccccc", team: [4, 5, 8] } }));
assert.throws(() => C.battleStart(S, T, rand, { fr: { pub: "bbbbbbbbbb", team: [4, 5] } }));
const bt = S.battlesToday, xp = S.track.xp, pt = S.points;
let r = C.battleStart(S, T, rand, { fr: { pub: "bbbbbbbbbb", name: "トモ", team: [4, 5, 8] } }); assert.equal(r.mode, "fr"); assert.deepEqual(r.B, [4, 5, 8]);
let f = C.battleFinish(S, T, []); assert.equal(f.pts, 0); assert.equal(S.battlesToday, bt); assert.equal(S.track.xp, xp); assert.equal(S.points, pt); assert.equal(S.stats.fr, 1);
C.friendDel(S, "bbbbbbbbbb"); assert.equal(S.friends.length, 0);
// クイズ
const q = C.quizFor(S.day); assert.equal(q.opts.length, 4); assert.ok(q.opts.includes(q.t)); assert.equal(new Set(q.opts).size, 4);
assert.ok(q.opts.every(i => C.BY_ID[i].area === C.BY_ID[q.t].area)); assert.deepEqual(C.quizFor(S.day), q);
assert.throws(() => C.quizAnswer(S, T, 99999)); const mp = S.mp;
const wrong = q.opts.find(i => i !== q.t); let a = C.quizAnswer(S, T, wrong); assert.equal(a.ok, false); assert.equal(S.mp, mp + 1);
assert.throws(() => C.quizAnswer(S, T, q.t)); assert.equal(C.view(S, T).quiz.done, true);
a = C.quizAnswer(S, T + 864e5, C.quizFor(C.jstDay(T + 864e5)).t); assert.equal(a.ok, true);
// 戦績
let w = 0; for (let i = 0; i < 6; i++) { C.battleStart(S, T + 864e5, rand); f = C.battleFinish(S, T + 864e5, []); if (f.res === 1) w++; }
assert.equal(S.use[1][0], 6); assert.equal(S.use[1][1], w); assert.ok(S.stats.best >= S.stats.streak); assert.ok(S.stats.best <= w);
C.invariant(S); console.log("v7 OK");
