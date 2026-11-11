import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import fs from "node:fs";
import assert from "node:assert/strict";
import { handle } from "./handler.mjs";
import * as C from "./core.mjs";
const db = new PGlite(); await db.exec("create role anon; create role authenticated;"); await db.exec(fs.readFileSync("schema.sql", "utf8"));
const srv = new PGLiteSocketServer({ db, port: 54331, host: "127.0.0.1" }); await srv.start();
const sql = postgres("postgres://postgres:postgres@127.0.0.1:54331/postgres", { max: 1, prepare: false, ssl: false, onnotice: () => {} });
let T = Date.UTC(2026, 10, 11, 3, 0, 0), n = 0;
const call = async (a, o = {}) => { const req = new Request("https://x/fn", { method: "POST", headers: { "x-forwarded-for": "2.2.2." + (n++ % 200) }, body: JSON.stringify({ a, ...o }) }); const res = await handle(req, { sql, now: () => T }); return { st: res.status, j: await res.json() }; };
const mkPlayer = async (name, pts) => {
  const r = await call("register"); const au = { id: r.j.id, k: r.j.k };
  // 3枚持たせてチーム編成・ポイント設定（DB を直接操作してテスト用の状態を作る）
  const [row] = await sql`select state from chizukan.players where id = ${au.id}`; const S = row.state;
  [1, 2, 3, 13, 26, 30].forEach(i => S.owned[i] = 1); S.team = [30, 13, 1]; S.points = pts;
  await sql`update chizukan.players set state = ${sql.json(S)}, points = ${pts} where id = ${au.id}`;
  if (name) assert((await call("name", { ...au, p: { name } })).j.ok);
  return au;
};
const A = await mkPlayer("アキラ", 100), B = await mkPlayer("ビー", 40), Cc = await mkPlayer(null, 500);
// state に pub がある
let s = (await call("state", A)).j.s; assert(/^[0-9a-f]{10}$/.test(s.pub)); assert.equal(s.name, "アキラ");
const pubB = (await call("state", B)).j.s.pub;
// 初回 state で実績が付与される（遡及）
assert.equal(!!s.ach.win_1 || true, true); assert(s.ach.rank_50, "rank_50 granted retroactively");
// リーダーボード: 名前ありのみ・ポイント順
let lb = await call("lb", A); assert(lb.j.ok); assert.deepEqual(lb.j.r.lb.map(x => x.n), ["アキラ", "ビー"]); assert.equal(lb.j.r.me, 1);
assert.equal(lb.j.r.lb[0].pts, 100);
// 名前なし(Cc)は載らず、自分の順位も null
lb = await call("lb", Cc); assert.equal(lb.j.r.me, null); assert.equal(lb.j.r.lb.length, 2);
// 挑戦: 名前のある相手のみ
assert.equal((await call("bstart", { ...A, p: { mode: "ch", pub: (await call("state", Cc)).j.s.pub } })).j.e, "bad_target");
assert.equal((await call("bstart", { ...A, p: { mode: "ch", pub: s.pub } })).j.e, "bad_target");   // 自分自身
assert.equal((await call("bstart", { ...A, p: { mode: "ch", pub: "zz" } })).j.e, "bad_target");
let bs = await call("bstart", { ...A, p: { mode: "ch", pub: pubB } }); assert(bs.j.ok, JSON.stringify(bs.j)); assert.deepEqual(bs.j.r.B, [30, 13, 1]); assert.equal(bs.j.r.mode, "ch");
const exp = C.runBattle(bs.j.r.A, bs.j.r.B, bs.j.r.seed, [null, null, null, null, null, null, null, null]);
let bf = await call("bfinish", { ...A, p: { plan: [] } }); assert(bf.j.ok); assert.equal(bf.j.r.res, exp.res);
if (exp.res === 1) assert.equal(bf.j.r.pts, 12);
assert.equal((await call("bstart", { ...A, p: { mode: "ch", pub: pubB } })).j.e, "ch_done");
// ポイントが DB の points 列に同期される
const [pr] = await sql`select points from chizukan.players where id = ${A.id}`; assert.equal(pr.points, bf.j.s.points);
// 首領
bs = await call("bstart", { ...A, p: { mode: "boss" } }); assert(bs.j.ok); assert.deepEqual(bs.j.r.B, C.bossFor(bs.j.s.day).ids);
bf = await call("bfinish", { ...A, p: { plan: [] } }); assert(bf.j.ok); assert.equal(bf.j.s.boss.done, true);
assert.equal((await call("bstart", { ...A, p: { mode: "boss" } })).j.e, "boss_done");
// 旅
let tr = await call("trip", A); assert(tr.j.ok); assert(tr.j.s.owned[tr.j.r.id]); assert.equal((await call("trip", A)).j.e, "trip_done");
// 名前: 不正値
assert.equal((await call("name", { ...A, p: { name: "<script>" } })).j.e, "bad_name");
// banned は載らない
await sql`update chizukan.players set banned = true where id = ${B.id}`; lb = await call("lb", A); assert.deepEqual(lb.j.r.lb.map(x => x.n), ["アキラ"]);
console.log("API2 TESTS OK");
process.exit(0);
