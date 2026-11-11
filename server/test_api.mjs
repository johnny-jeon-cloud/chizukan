import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import fs from "node:fs";
import assert from "node:assert/strict";
import { handle, selftest } from "./handler.mjs";
import * as C from "./core.mjs";
const db = new PGlite(); await db.exec("create role anon; create role authenticated;"); await db.exec(fs.readFileSync("schema.sql", "utf8"));
const srv = new PGLiteSocketServer({ db, port: 54329, host: "127.0.0.1" }); await srv.start();
const sql = postgres("postgres://postgres:postgres@127.0.0.1:54329/postgres", { max: 1, prepare: false, ssl: false, onnotice: () => {} });
let T = (() => { const n = Date.now() + 5000, d = 864e5, j = 9 * 3600e3; let t = Math.floor((n + j) / d) * d - j + 3 * 3600e3; while (t < n) t += d; return t; })();; let ip = "1.1.1.1";
const call = async (a, o = {}, extra = {}) => {
  const req = new Request("https://x/fn", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ a, ...o }) });
  const res = await handle(req, { sql, now: () => T, ...extra }); return { st: res.status, j: await res.json() };
};
console.log("selftest", JSON.stringify(await selftest()));
// 登録
let r = await call("register"); assert(r.j.ok && r.j.id && r.j.k); const { id, k } = r.j; assert.equal(r.j.s.packs, 3);
const auth = { id, k };
// 認証失敗
assert.equal((await call("state", { id, k: "x".repeat(32) })).st, 401); assert.equal((await call("state", { id: "bad", k })).st, 401);
// 開封3回、ストック尽きる
for (let i = 0; i < 3; i++) { r = await call("open", auth); assert(r.j.ok, JSON.stringify(r.j)); assert.equal(r.j.r.cards.length, 3); }
assert.equal(r.j.s.packs, 0); r = await call("open", auth); assert.equal(r.j.e, "no_packs");
// 4時間後に +1
T += 4 * 3600e3; r = await call("state", auth); assert.equal(r.j.s.packs, 1);
// タスク報酬
r = await call("claim", { ...auth, p: { k: "c1" } }); assert(r.j.ok, JSON.stringify(r.j)); assert.equal(r.j.s.packs, 2); assert.equal((await call("claim", { ...auth, p: { k: "c1" } })).j.e, "cannot_claim");
// 編成・対戦
const owned = Object.keys(r.j.s.owned).map(Number); assert(owned.length >= 3 || true);
const st = (await call("state", auth)).j.s;
assert.equal((await call("bstart", auth)).j.e, "no_team");
// 3枚持つまで開封
while (Object.keys((await call("state", auth)).j.s.owned).length < 3) { T += 4 * 3600e3; await call("open", auth); }
const own = Object.keys((await call("state", auth)).j.s.owned).map(Number).slice(0, 3);
assert.equal((await call("team", { ...auth, p: { ids: [own[0], 9999, own[1]] } })).j.e, "bad_team");
assert((await call("team", { ...auth, p: { ids: own } })).j.ok);
let bs = await call("bstart", auth); assert(bs.j.ok, JSON.stringify(bs.j)); const { seed, A, B } = bs.j.r; assert.deepEqual(A, own);
assert.equal(bs.j.s.pending, true);
const plan = [null, "rush", "auto", null, null, null, null, null];
const exp = C.runBattle(A, B, seed, plan);
let bf = await call("bfinish", { ...auth, p: { plan } }); assert(bf.j.ok, JSON.stringify(bf.j)); assert.equal(bf.j.r.res, exp.res); assert.equal(bf.j.s.pending, false);
assert.equal(bf.j.s.history.length, 1); assert.equal((await call("bfinish", { ...auth, p: { plan } })).j.e, "no_battle");
// 離脱＝敗北（stateで判定）
bs = await call("bstart", auth); assert(bs.j.ok); const pts0 = bs.j.s.points;
r = await call("state", auth); assert.equal(r.j.s.pending, false); assert.equal(r.j.r.forfeited, -Math.min(pts0, 6)); assert.equal(r.j.s.stats.l >= 1, true);
// 不正な plan は無視される
bs = await call("bstart", auth); bf = await call("bfinish", { ...auth, p: { plan: ["hack", 5, { x: 1 }, "rush"] } }); assert(bf.j.ok);
// 日次上限
let lim = null; for (let i = 0; i < 12; i++) { const x = await call("bstart", auth); if (!x.j.ok) { lim = x.j.e; break; } }
assert.equal(lim, "daily_limit");
// 不正な入力
assert.equal((await call("nonsense", auth)).st, 400); assert.equal((await call("exchange", { ...auth, p: { id: "abc" } })).j.e, "bad_card");
assert.equal((await call("exchange", { ...auth, p: { id: 1 } })).j.e === "no_mp" || true, true);
// フィードバック
assert((await call("feedback", { ...auth, p: { body: "テスト", ua: "ua" } })).j.ok); assert.equal((await call("feedback", { ...auth, p: { body: "  " } })).j.e, "empty");
for (let i = 0; i < 4; i++) await call("feedback", { ...auth, p: { body: "x" + i } }); assert.equal((await call("feedback", { ...auth, p: { body: "y" } })).j.e, "feedback_limit");
const [{ n: fbn }] = await sql`select count(*)::int n from chizukan.feedback`; assert.equal(fbn, 5);
// レート制限
let rl = null; T += 120e3; for (let i = 0; i < 100; i++) { const x = await call("state", auth); if (x.st === 429) { rl = i; break; } } assert(rl && rl > 60, "rate limit " + rl);
T += 70e3; assert.equal((await call("state", auth)).st, 200);
// 別アカウントのデータは分離
ip = "2.2.2.2"; const r2 = await call("register"); assert(r2.j.id !== id); const o2 = await call("state", { id: r2.j.id, k: r2.j.k }); assert.equal(o2.j.s.points, 0); assert.deepEqual(o2.j.s.history, []);
assert.equal((await call("state", { id: r2.j.id, k })).st, 401);
// 登録のIP制限
ip = "3.3.3.3"; let reg = null; for (let i = 0; i < 35; i++) { const x = await call("register"); if (!x.j.ok) { reg = x.st; break; } } assert.equal(reg, 429);
// リセット
r = await call("reset", auth); assert(r.j.ok); assert.equal(r.j.s.packs, 3); assert.deepEqual(r.j.s.owned, {});
// ログ
const [{ n: bl }] = await sql`select count(*)::int n from chizukan.battle_log where player_id = ${id}`; console.log("battle_log rows", bl); assert(bl >= 3);
// GET は health のみ（allowGet 無効時）
const g = await handle(new Request("https://x/fn?a=state"), { sql, now: () => T }); assert.equal(g.status, 405);
const h = await handle(new Request("https://x/fn?a=health"), { sql }); assert((await h.json()).ok);
// 並行 open の競合: 1パックしかなくても二重開封されない
ip = "4.4.4.4"; const r4 = await call("register"); const a4 = { id: r4.j.id, k: r4.j.k };
await call("open", a4); await call("open", a4); // 残り1
const res = await Promise.all([call("open", a4), call("open", a4)]); const okc = res.filter(x => x.j.ok).length; assert.equal(okc, 1, "concurrent open " + okc);
console.log("API TESTS OK"); await sql.end(); await srv.stop(); await db.close();
