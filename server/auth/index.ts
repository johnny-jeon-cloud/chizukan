// Chizukan ログイン（メール／Google）。Supabase Auth のトークンを検証し、進行状況（chizukan.players）をログインに結びつける。
// 本体の chizukan 関数とは独立。ゲームの状態は返さない（端末は続けて state を取りに行く）。
import postgres from "npm:postgres@3.4.5";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false, idle_timeout: 20, connect_timeout: 10 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function safeEq(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
const err = (e: string, m: string, status = 200) => json({ ok: false, e, m }, status);

async function verifyToken(t: string): Promise<string | null> {
  try {
    const r = await fetch(Deno.env.get("SUPABASE_URL") + "/auth/v1/user", { headers: { authorization: "Bearer " + t, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } });
    if (!r.ok) return null;
    const j = await r.json(); return UUID.test((j && j.id) || "") ? j.id : null;
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return err("method", "POST only", 405);
  let body: any;
  try { const text = await req.text(); if (text.length > 8192) return err("too_large", "too large", 413); body = JSON.parse(text); } catch { return err("bad_request", "invalid json", 400); }
  if (!body || typeof body !== "object") return err("bad_request", "bad request", 400);
  const p = body.p && typeof body.p === "object" ? body.p : {};
  try {
    const tok = String(p.t || "");
    if (tok.length < 20 || tok.length > 4096) return err("bad_request", "bad token", 400);
    const uid = await verifyToken(tok);
    if (!uid) return err("login", "ログインを確認できませんでした。もう一度お試しください", 401);
    const cid = String(body.id || ""), ck = String(body.k || "");
    const hasCred = UUID.test(cid) && ck.length >= 20 && ck.length <= 64, ckh = hasCred ? await sha256("k|" + ck) : "";
    const secret = b64url(crypto.getRandomValues(new Uint8Array(24))), sh = await sha256("k|" + secret);
    const out: any = await sql.begin(async (tx: any) => {
      let cur: any = null;
      if (hasCred) { const [row] = await tx`select id, secret_hash, banned, auth_uid from chizukan.players where id = ${cid} for update`; if (row && safeEq(row.secret_hash, ckh) && !row.banned) cur = row; }
      const [ex] = await tx`select id, banned from chizukan.players where auth_uid = ${uid} for update`;
      if (ex) {
        if (ex.banned) return { status: 403, e: "banned", m: "このアカウントは利用できません" };
        if (cur && cur.id === ex.id) return { ok: true, id: ex.id, k: null, mode: "same" };
        if (cur && !p.sw) return { ok: true, need: "switch" };
        await tx`update chizukan.players set secret_hash = ${sh}, last_seen = now() where id = ${ex.id}`;
        return { ok: true, id: ex.id, k: secret, mode: "found" };
      }
      if (!cur) return { status: 200, e: "no_account", m: "このログインに結びついた進行状況がありません" };
      if (cur.auth_uid) return { status: 200, e: "linked_other", m: "この進行状況は別のログインに結びついています" };
      await tx`update chizukan.players set auth_uid = ${uid}, last_seen = now() where id = ${cur.id}`;
      return { ok: true, id: cur.id, k: null, mode: "linked" };
    });
    if (!out.ok) return err(out.e, out.m, out.status);
    if (out.need) return json({ ok: true, need: out.need });
    return json({ ok: true, id: out.id, k: out.k, mode: out.mode });
  } catch (e) {
    console.error("chizukan-auth error", e && (e as Error).message);
    return err("server", "サーバーでエラーが発生しました", 500);
  }
});
