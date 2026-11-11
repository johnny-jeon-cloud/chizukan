import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import fs from "node:fs"; import http from "node:http";
import { handle } from "./handler.mjs";
const db = new PGlite(); await db.exec("create role anon; create role authenticated;"); await db.exec(fs.readFileSync("schema.sql", "utf8"));
const srv = new PGLiteSocketServer({ db, port: 54330, host: "127.0.0.1" }); await srv.start();
const sql = postgres("postgres://postgres:postgres@127.0.0.1:54330/postgres", { max: 1, prepare: false, ssl: false, onnotice: () => {} });
let offset = 0;   // /__skew?ms=  で時刻を進められる
http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const u = new URL(rq.url, "http://x");
  if (u.pathname === "/__grant") { const j = JSON.parse(Buffer.concat(chunks).toString()); const [row] = await sql`select state from chizukan.players where id = ${j.id}`; const S = row.state; Object.assign(S, j.patch);
    await sql`update chizukan.players set state = ${sql.json(S)}, points = ${S.points | 0} where id = ${j.id}`; rs.end("ok"); return; }
  if (u.pathname === "/__skew") { offset += +u.searchParams.get("ms"); rs.end("ok " + offset); return; }
  const req = new Request("http://x/fn" + u.search, { method: rq.method, headers: { "x-forwarded-for": "9.9.9." + (Math.random() * 250 | 0), "content-type": rq.headers["content-type"] || "" }, body: ["GET", "HEAD"].includes(rq.method) ? undefined : Buffer.concat(chunks) });
  const res = await handle(req, { sql, now: () => Date.now() + offset, allowGet: true });
  rs.writeHead(res.status, Object.fromEntries(res.headers)); rs.end(Buffer.from(await res.arrayBuffer()));
}).listen(8787, "127.0.0.1", () => console.log("dev api on 8787"));
