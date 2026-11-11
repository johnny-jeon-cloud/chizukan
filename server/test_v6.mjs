import * as C from "./core.mjs"; import * as E from "./engine.mjs"; import assert from "node:assert";
const card = o => Object.assign({ id: 1, rar: "N", attr: "都市", area: "日本", atk: 50, hp: 60, def: 20, kw: null }, o), fixed = () => 1;
// 堅守: 1回だけ30%軽減
let r = E.battle([card({ atk: 50, hp: 500 })], [card({ kw: "sturdy", atk: 10, hp: 500 })], fixed, 1, 2, {});
assert.equal(r.log[0].da, E.roundHalfEven(40 * 0.7)); assert.equal(r.log[0].gdB, true); assert.equal(r.log[1].da, 40); assert.equal(r.log[1].gdB, false);
// 鋭利
const d = kw => E.battle([card({ atk: 60, kw })], [card({ def: 60, hp: 500 })], fixed, 1, 1, {}).log[0].da;
assert.equal(d(null), 30); assert.equal(d("keen"), 36); assert.equal(d("pierce"), 45);
// 意地
r = E.battle([card({ kw: "spite", atk: 40, hp: 5, def: 0 }), card({ hp: 100 })], [card({ atk: 90, hp: 200 })], fixed, 1, 1, {});
assert.equal(r.log[0].drA, 10);
// 鼓舞
r = E.battle([card({ kw: "cheer", atk: 200, hp: 100, def: 0 })], [card({ hp: 1, atk: 30 }), card({ hp: 100 })], fixed, 1, 1, {});
assert.equal(r.log[0].tvA, 6);
assert(C.CARDS.every(c => c.kw)); const n = {}; C.CARDS.forEach(c => n[c.kw] = (n[c.kw] || 0) + 1); console.log(n);
// 強さの分布が壊れていないか: 上位チーム vs 下位チームの勝率
let w = 0; const top = [1, 110, 30].map(i => C.BY_ID[i]), low = [25, 134, 191].map(i => C.BY_ID[i]);
for (let s = 0; s < 200; s++) if (C.runBattle([1, 110, 30], [25, 134, 191], s, "auto").res === 1) w++;
assert.equal(w, 200); console.log("v6 OK");
