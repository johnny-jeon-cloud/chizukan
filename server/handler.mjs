// Chizukan API ハンドラ（Edge Function と Node テストで共用）。
import * as C from "./core.mjs";
import * as E from "./engine.mjs";

const SCHEMA = "chizukan";
const MAX_BODY = 4096, RATE_N = 90, RATE_WIN_MS = 60e3, REG_PER_IP_DAY = 30, FEEDBACK_PER_DAY = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cryptoRand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
function safeEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } }); }
const err = (code, msg, status = 200) => json({ ok: false, e: code, m: msg || code }, status);

// 配備の自己診断: 規則エンジン・カードデータが意図どおりか指紋を返す
export async function selftest() {
  const A = [1, 2, 3], B = [4, 5, 6];
  const res = C.runBattle(A, B, 987654321, [null, "rush", "auto", "swap", "guard", null, null, null]);
  return { rules: E.RULES_VERSION, cards: C.CARDS.length, cardsSha: (await sha256(C.cardsDigest())).slice(0, 16), battleSha: (await sha256(JSON.stringify([res.res, res.rounds, res.ha, res.hb]))).slice(0, 16) };
}

export async function handle(req, deps) {
  const { sql } = deps, now = (deps.now || Date.now)(), rand = deps.rand || cryptoRand, allowGet = !!deps.allowGet;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  let body;
  if (req.method === "GET") {
    if (url.searchParams.get("a") === "health") return json({ ok: true, ...(await selftest()) });
    if (!allowGet) return err("method", "POST only", 405);
    try { body = { a: url.searchParams.get("a"), id: url.searchParams.get("id"), k: url.searchParams.get("k"), p: JSON.parse(url.searchParams.get("p") || "{}") }; } catch { return err("bad_request", "bad p", 400); }
  } else if (req.method === "POST") {
    const text = await req.text();
    if (text.length > MAX_BODY) return err("too_large", "too large", 413);
    try { body = JSON.parse(text); } catch { return err("bad_request", "invalid json", 400); }
  } else return err("method", "method", 405);
  if (!body || typeof body !== "object" || typeof body.a !== "string") return err("bad_request", "bad request", 400);
  const a = body.a, p = body.p && typeof body.p === "object" ? body.p : {};

  try {
    if (a === "register") {
      const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
      const ipHash = (await sha256("czk|" + ip)).slice(0, 24);
      const [{ n }] = await sql`select count(*)::int as n from chizukan.players where ip_hash = ${ipHash} and created_at > now() - interval '1 day'`;
      if (n >= REG_PER_IP_DAY) return err("rate_limited", "しばらくしてからもう一度お試しください", 429);
      const secret = b64url(crypto.getRandomValues(new Uint8Array(24)));
      const S = C.freshState(now);
      const [row] = await sql`insert into chizukan.players (secret_hash, state, ip_hash) values (${await sha256("k|" + secret)}, ${sql.json(S)}, ${ipHash}) returning id`;
      return json({ ok: true, id: row.id, k: secret, s: C.view(S, now), r: {} });
    }

    const id = String(body.id || ""), k = String(body.k || "");
    if (!UUID.test(id) || k.length < 20 || k.length > 64) return err("auth", "認証に失敗しました", 401);
    const kh = await sha256("k|" + k);

    const out = await sql.begin(async tx => {
      const [row] = await tx`select id, pubid, secret_hash, state, win_start, win_n, banned from chizukan.players where id = ${id} for update`;
      if (!row || !safeEq(row.secret_hash, kh)) return { status: 401, e: "auth", m: "認証に失敗しました" };
      if (row.banned) return { status: 403, e: "banned", m: "このアカウントは利用できません" };
      const inWin = now - new Date(row.win_start).getTime() < RATE_WIN_MS, wn = inWin ? row.win_n + 1 : 1;
      if (wn > RATE_N) { await tx`update chizukan.players set win_n = ${wn} where id = ${id}`; return { status: 429, e: "rate_limited", m: "操作が多すぎます。少し待ってください" }; }

      const S = C.normState(row.state); let r = {}, ff = null;
      C.tick(S, now);
      if (a === "state") { ff = S.pending ? C.forfeitPending(S, now) : null; if (ff) r.forfeited = ff.pts; }
      else if (a === "open") r = C.openPack(S, now, rand);
      else if (a === "exchange") r = C.exchange(S, now, Number(p.id));
      else if (a === "claim") r = C.claim(S, now, String(p.k));
      else if (a === "team") r = C.setTeam(S, p.ids);
      else if (a === "bstart") {
        const hadPending = !!S.pending && S.pending;
        let opt = {};
        if (p.mode === "boss") opt = { boss: true };
        else if (p.mode === "prac") opt = { prac: Number(p.lv) };
        else if (p.mode === "ch") {
          const pub = String(p.pub || "");
          if (!/^[0-9a-f]{10}$/.test(pub)) throw new C.GameError("bad_target", "この相手には挑戦できません");
          const [t] = await tx`select id, pubid, pname, points, state->'team' as team from chizukan.players where pubid = ${pub} and banned = false`;
          if (!t || t.id === id || !t.pname) throw new C.GameError("bad_target", "この相手には挑戦できません");
          opt = { ch: { pub, name: t.pname, team: t.team, points: t.points } };
        }
        r = C.battleStart(S, now, rand, opt);
        if (r.forfeited !== null && hadPending) ff = { p: hadPending, pts: r.forfeited };
      }
      else if (a === "bfinish") r = C.battleFinish(S, now, p.plan);
      else if (a === "trip") r = C.trip(S, now, rand);
      else if (a === "name") r = C.setName(S, now, p.name);
      else if (a === "back") r = C.setBack(S, String(p.id));
      else if (a === "deck") r = C.setDeck(S, p.i);
      else if (a === "lb") {
        const rows = await tx`select pubid, pname, points from chizukan.players where pname is not null and not banned and points > 0 order by points desc, updated_at asc limit ${C.CFG.LB_SIZE}`;
        const [{ n }] = await tx`select count(*)::int as n from chizukan.players where points > ${S.points} and pname is not null and not banned`;
        r = { lb: rows.map((x, i) => ({ rk: i + 1, pub: x.pubid, n: x.pname, pts: x.points })), me: S.name ? n + 1 : null };
      }
      else if (a === "reset") { const f = C.freshState(now); Object.keys(S).forEach(x => delete S[x]); Object.assign(S, f); }
      else if (a === "feedback") {
        const text = String(p.body || "").trim().slice(0, 1000);
        if (!text) throw new C.GameError("empty", "内容を入力してください");
        const [{ n }] = await tx`select count(*)::int as n from chizukan.feedback where player_id = ${id} and created_at > now() - interval '1 day'`;
        if (n >= FEEDBACK_PER_DAY) throw new C.GameError("feedback_limit", "本日の送信上限です");
        await tx`insert into chizukan.feedback (player_id, body, ua, rules_ver) values (${id}, ${text}, ${String(p.ua || "").slice(0, 200)}, ${E.RULES_VERSION})`;
      }
      else return { status: 400, e: "bad_action", m: "unknown action" };

      const newAch = a === "reset" ? [] : C.checkAch(S, now); if (newAch.length) r.ach = newAch;
      const lvUp = a === "reset" ? [] : C.trackTick(S); if (lvUp.length) r.lv = lvUp;
      C.invariant(S);
      if (ff) await tx`insert into chizukan.battle_log (player_id, seed, team_a, team_b, plan, res, rounds, pts, rules_ver, forfeit) values (${id}, ${ff.p.seed}, ${ff.p.A}, ${ff.p.B}, ${tx.json([])}, -1, 0, ${ff.pts}, ${E.RULES_VERSION}, true)`;
      if (a === "bfinish") { const h = r.entry; await tx`insert into chizukan.battle_log (player_id, seed, team_a, team_b, plan, res, rounds, pts, rules_ver, mode) values (${id}, ${h.seed}, ${h.A}, ${h.B}, ${tx.json(h.pa)}, ${h.res}, ${h.rounds}, ${h.pts}, ${h.rv}, ${h.mode || "n"})`; delete r.entry; }
      await tx`update chizukan.players set state = ${tx.json(S)}, points = ${S.points}, pname = ${S.name || null}, updated_at = now(), last_seen = now(), win_start = ${inWin ? row.win_start : new Date(now)}, win_n = ${wn} where id = ${id}`;
      return { status: 200, ok: true, s: Object.assign(C.view(S, now), { pub: row.pubid }), r };
    });
    if (out.ok) return json({ ok: true, s: out.s, r: out.r });
    return err(out.e, out.m, out.status);
  } catch (e) {
    if (e instanceof C.GameError) return err(e.code, e.message);
    console.error("chizukan error", e && e.message);
    return err("server", "サーバーでエラーが発生しました", 500);
  }
}
