import * as C from "./core.mjs"; import assert from "node:assert";
let seed = 3; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
assert.equal(C.pickupFor("2026-11"), "東南アジア"); assert.equal(C.pickupFor("2026-12"), "日本"); assert.equal(C.pickupFor("2027-01"), "韓国");
const T = Date.UTC(2026, 10, 12, 3); const S = C.freshState(T);
let sea = 0, tot = 0; for (let i = 0; i < 3000; i++) { S.packs = 1; for (const c of C.openPack(S, T, rand).cards) { tot++; if (C.BY_ID[c.id].area === "東南アジア") sea++; } }
const base = 30 / 230, f = sea / tot; console.log("SEA share", f.toFixed(3), "base", base.toFixed(3)); assert.ok(f > 0.3 && f < 0.42);
assert.equal(C.view(S, T).pickup.area, "東南アジア");
C.setTeam(S, [1, 6, 9]);
let r = C.battleStart(S, T, rand); let fin = C.battleFinish(S, T, [], [2, 0, 1]); assert.deepEqual(S.history[0].A, [9, 1, 6]);
const ref = C.runBattle([9, 1, 6], S.history[0].B, S.history[0].seed, C.cleanPlan([]), { g: null }); assert.equal(ref.res, fin.res); assert.equal(ref.rounds, fin.rounds);
r = C.battleStart(S, T, rand); C.battleFinish(S, T, [], [0, 0, 1]); assert.deepEqual(S.history[0].A, [1, 6, 9]);
r = C.battleStart(S, T, rand); C.battleFinish(S, T, [], "x"); assert.deepEqual(S.history[0].A, [1, 6, 9]);
console.log("v8 OK");
