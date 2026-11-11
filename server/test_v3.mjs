import * as C from "./core.mjs";
import * as E from "./engine.mjs";
import assert from "node:assert/strict";
const now = Date.UTC(2026, 10, 11, 3, 0, 0);
const mk = () => { const P = C.freshState(now); C.CARDS.forEach(c => P.owned[c.id] = 1); return P; };
const card = (o) => Object.assign({ id: 1, rar: "N", attr: "都市", area: "日本", atk: 50, hp: 60, def: 20, kw: null }, o);
const fixed = () => 1.0;
// --- 特技 ---
const kws = new Set(C.CARDS.filter(c => c.kw).map(c => c.kw)); assert.equal(kws.size, 4);
assert(C.CARDS.every(c => (c.rar === "SR" || c.rar === "SSR") === !!c.kw));
{ // 聖盾: 最初の被弾を無効、2回目は通る
  const A = [card({ atk: 40, hp: 100 })], B = [card({ rar: "SR", kw: "shield", atk: 10, hp: 100 })];
  const r = E.battle(A, B, fixed, 1, 8, { a: "x", b: "x" });
  assert.equal(r.log[0].blkB, true); assert.equal(r.log[0].da, 0); assert.equal(r.log[0].hb[0], 100);
  assert(r.log[1].da > 0 && !r.log[1].blkB);
}
{ // 貫通: 同条件でダメージが増える
  const mk2 = kw => E.battle([card({ atk: 60, kw })], [card({ def: 60, hp: 500 })], fixed, 1, 1, {}).log[0].da;
  assert(mk2("pierce") > mk2(null)); assert.equal(mk2("pierce") - mk2(null), 15);
}
{ // 遺言: 撃破されたとき相手に ATK×0.6
  const A = [card({ rar: "SR", kw: "rattle", atk: 50, hp: 5, def: 0 }), card({ hp: 100 })], B = [card({ atk: 90, hp: 200 })];
  const e = E.battle(A, B, fixed, 1, 1, {}).log[0];
  assert.equal(e.koA, true); assert.equal(e.drA, 30); assert.equal(e.hb[0], 200 - e.da - 30);
}
{ // 凱旋: 撃破後 15% 回復
  const A = [card({ rar: "SR", kw: "triumph", atk: 200, hp: 100, def: 0 })], B = [card({ hp: 1, atk: 30 }), card({ hp: 100 })];
  const e = E.battle(A, B, fixed, 1, 1, {}).log[0];
  assert.equal(e.koB, true); assert.equal(e.tvA, 15); assert(e.ha[0] <= 100);
}
// 決定性（同じ seed で同じログ）
{ const T1 = [C.BY_ID[110], C.BY_ID[6], C.BY_ID[9]], T2 = [C.BY_ID[168], C.BY_ID[30], C.BY_ID[2]];
  const x = E.battle(T1, T2, E.makeRoller(5), 1, 8, { a: "auto", b: "auto" }), y = E.battle(T1, T2, E.makeRoller(5), 1, 8, { a: "auto", b: "auto" });
  assert.equal(JSON.stringify(x.log), JSON.stringify(y.log)); }
// --- ランク/シーズン ---
assert.equal(C.rankOf(0), 0); assert.equal(C.rankOf(19), 0); assert.equal(C.rankOf(20), 1); assert.equal(C.rankOf(5000), 6);
{ const S = mk(); C.tick(S, now); assert.equal(S.season.id, "2026-11"); S.points = 330; S.season.best = 400;
  const p0 = S.packs, m0 = S.mp; C.tick(S, now + 40 * 864e5);   // 12月下旬ではなく翌々月に跨ぐ
  assert.equal(S.sLast.id, "2026-11"); assert.equal(S.sLast.tier, 5); assert.equal(S.packs, p0 + 2);
  assert.equal(S.mp, m0 + 50); assert.equal(S.points, 165); assert.equal(S.season.best, 165); assert.equal(S.season.id, C.jstDay(now + 40 * 864e5).slice(0, 7));
  const v = C.view(S, now + 40 * 864e5); assert.equal(v.season.tier, 3); assert(v.season.days >= 1 && v.season.days <= 31); }
{ // 同じ月ならリセットしない / 旧状態の補完
  const S = mk(); C.tick(S, now); S.points = 100; C.tick(S, now + 864e5); assert.equal(S.points, 100); assert.equal(S.sLast, null);
  const old = { v: 2, packs: 0, mp: 0, owned: {}, team: [], points: 77, day: "2026-11-11", tasks: { opened: 1, battles: 0, c1: false, c2: false }, stats: {} };
  C.normState(old); C.tick(old, now); assert.equal(old.season.best, 77); assert.deepEqual(old.tasks.qc, []); assert.equal(old.back, "default"); }
{ // 勝利で best 更新
  const S = mk(); C.setTeam(S, [110, 168, 171]); C.tick(S, now); S.points = 0;
  const rnd = E.mulberry32(1), rand = () => rnd(); let got = false;
  for (let i = 0; i < 6 && !got; i++) { C.battleStart(S, now, rand, {}); const r = C.battleFinish(S, now, ["auto", "auto", "auto", "auto", "auto", "auto", "auto", "auto"]); if (r.res === 1) got = true; S.battlesToday = 0; }
  assert(got); assert.equal(S.season.best, Math.max(S.season.best, S.points)); assert(S.season.best >= 12); assert(S.tasks.wins >= 1); }
// --- クエスト ---
{ const d1 = C.questsFor("2026-11-11"), d1b = C.questsFor("2026-11-11"); assert.deepEqual(d1.map(q => q.id), d1b.map(q => q.id));
  assert.equal(d1.length, 3); assert.equal(new Set(d1.map(q => q.id)).size, 3);
  for (let d = 1; d <= 30; d++) { const q = C.questsFor("2026-11-" + String(d).padStart(2, "0")); assert(q.some(x => x.id.startsWith("q_win")), "daily has a battle quest"); }
  const S = mk(); C.tick(S, now); const list = C.questsFor(S.day);
  assert.throws(() => C.claim(S, now, list[0].id), e => e.code === "cannot_claim");
  // 条件を満たして受け取る→二重受け取り不可→全部で追加パック
  S.tasks.wins = 9; S.tasks.opened = 9; S.tasks.battles = 9; S.trip = { day: S.day, n: 1, last: 1 }; S.boss = { day: S.day, res: 1 }; S.ch = { day: S.day, ids: ["aaaaaaaaaa"] };
  const p0 = S.packs, m0 = S.mp; let sumMp = 0;
  for (const q of list) { C.claim(S, now, q.id); sumMp += q.mp; assert.throws(() => C.claim(S, now, q.id), e => e.code === "cannot_claim"); }
  assert.equal(S.mp, m0 + sumMp); assert.equal(S.packs, p0 + 1); assert(S.tasks.qc.includes("bonus"));
  assert.throws(() => C.claim(S, now, "q_nope"), e => e.code === "cannot_claim");
  // 翌日は進捗とクレームがリセット
  C.tick(S, now + 864e5); assert.deepEqual(S.tasks.qc, []); assert.equal(S.tasks.wins, 0); }
// --- 裏面 ---
{ const S = mk(); C.tick(S, now); assert.throws(() => C.setBack(S, "gold"), e => e.code === "back_locked");
  assert.throws(() => C.setBack(S, "x"), e => e.code === "bad_back"); assert.throws(() => C.setBack(S, "__proto__"), e => e.code === "bad_back");
  C.checkAch(S, now);   // 全カード所持 → dex_100 など解放
  C.setBack(S, "gold"); assert.equal(S.back, "gold"); C.setBack(S, "default"); assert.equal(S.back, "default");
  C.invariant(S); }
console.log("v3 OK");
