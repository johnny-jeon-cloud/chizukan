// Chizukan サーバー側ゲームロジック（純関数）。DB・HTTP には依存しない。
import * as E from "./engine.mjs";
import { CARD_ROWS } from "./cards.mjs";

export const CFG = {
  RATES: { N: 55, R: 28, SR: 13, SSR: 4 },
  PACK_SIZE: 3, GRANT_MIN: 240, STOCK_CAP: 3, GOLD_N: 10, DAILY_BATTLES: 10, START_PACKS: 3,
  DUP_PTS: { N: 1, R: 3, SR: 10, SSR: 30 }, EXCH_COST: { N: 10, R: 30, SR: 100, SSR: 300 },
  WIN_PTS: 12, LOSS_PTS: 6, HISTORY_MAX: 10, SAMPLES: 1500,
};
const JST = 9 * 3600e3;
const SKILLS = new Set(["swap", "guard", "rush", "auto"]);

export const CARDS = CARD_ROWS.map(r => ({ id: r[0], rar: r[1], attr: r[2], area: r[3], atk: r[4], hp: r[5], def: r[6] }));
export const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
const BYRAR = {}; CARDS.forEach(c => (BYRAR[c.rar] = BYRAR[c.rar] || []).push(c));

export function cardsDigest() {
  return CARDS.map(c => `${c.id}:${c.rar}:${c.atk}:${c.hp}:${c.def}:${c.attr}:${c.area}`).join(";");
}

export function jstDay(now) { return new Date(now + JST).toISOString().slice(0, 10); }
const emptyTasks = () => ({ opened: 0, battles: 0, c1: false, c2: false });

export function freshState(now) {
  return { v: 1, packs: CFG.START_PACKS, lastGrant: now, pity: 0, mp: 0, owned: {}, team: [], points: 0, day: jstDay(now),
    battlesToday: 0, tasks: emptyTasks(), history: [], stats: { packs: 0, w: 0, l: 0, d: 0 }, pending: null };
}

export function tick(S, now) {
  const iv = CFG.GRANT_MIN * 60e3;
  if (S.day !== jstDay(now)) { S.day = jstDay(now); S.battlesToday = 0; S.tasks = emptyTasks(); }
  if (S.packs >= CFG.STOCK_CAP) S.lastGrant = now;
  else {
    const n = Math.floor((now - S.lastGrant) / iv);
    if (n > 0) { S.packs = Math.min(CFG.STOCK_CAP, S.packs + n); S.lastGrant = S.packs >= CFG.STOCK_CAP ? now : S.lastGrant + n * iv; }
    if (S.lastGrant > now) S.lastGrant = now;
  }
}

// クライアントに返す公開ビュー（pending の中身は返さない）
export function view(S, now) {
  return { packs: S.packs, lastGrant: S.lastGrant, pity: S.pity, mp: S.mp, owned: S.owned, team: S.team, points: S.points,
    day: S.day, battlesToday: S.battlesToday, tasks: S.tasks, history: S.history, stats: S.stats, pending: !!S.pending, now };
}

export class GameError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const fail = (code, msg) => { throw new GameError(code, msg); };

function rollRarity(rand) {
  let r = rand() * 100;
  for (const k of ["N", "R", "SR", "SSR"]) { if (r < CFG.RATES[k]) return k; r -= CFG.RATES[k]; }
  return "N";
}
const pick = (a, rand) => a[Math.floor(rand() * a.length)];

export function openPack(S, now, rand) {
  tick(S, now);
  if (S.packs <= 0) fail("no_packs", "パックのストックがありません");
  S.packs--; S.stats.packs++; S.tasks.opened++;
  const rars = []; for (let i = 0; i < CFG.PACK_SIZE; i++) rars.push(rollRarity(rand));
  const hasHigh = rars.some(r => r === "SR" || r === "SSR");
  const gold = S.pity >= CFG.GOLD_N - 1;
  if (gold && !hasHigh) rars[CFG.PACK_SIZE - 1] = rand() * (CFG.RATES.SR + CFG.RATES.SSR) < CFG.RATES.SR ? "SR" : "SSR";
  S.pity = gold ? 0 : S.pity + 1;
  const cards = rars.map(r => {
    const c = pick(BYRAR[r], rand), isNew = !S.owned[c.id];
    S.owned[c.id] = (S.owned[c.id] || 0) + 1;
    const pts = isNew ? 0 : CFG.DUP_PTS[c.rar]; S.mp += pts;
    return { id: c.id, isNew, pts };
  });
  return { cards, gold };
}

export function exchange(S, now, id) {
  tick(S, now);
  const c = BY_ID[id]; if (!c) fail("bad_card");
  if (S.owned[c.id]) fail("already_owned", "すでに持っているカードです");
  const cost = CFG.EXCH_COST[c.rar];
  if (S.mp < cost) fail("no_mp", "地図ポイントが足りません");
  S.mp -= cost; S.owned[c.id] = 1;
  return { cards: [{ id: c.id, isNew: true, pts: 0 }], gold: false };
}

export function claim(S, now, k) {
  tick(S, now);
  if (k === "c1" && S.tasks.opened >= 1 && !S.tasks.c1) { S.tasks.c1 = true; S.packs++; }
  else if (k === "c2" && S.tasks.battles >= 3 && !S.tasks.c2) { S.tasks.c2 = true; S.packs++; }
  else fail("cannot_claim", "受け取れる報酬がありません");
  return {};
}

export function setTeam(S, ids) {
  if (!Array.isArray(ids) || ids.length > 3) fail("bad_team");
  const t = ids.map(Number);
  if (new Set(t).size !== t.length || !t.every(id => S.owned[id])) fail("bad_team", "持っていないカードは編成できません");
  S.team = t;
  return {};
}

// CPU 対戦相手: 目標パーセンタイルの強さのチームを無作為標本から選ぶ
export function makeOpponent(points, rnd) {
  const ids = CARDS.map(c => c.id), teams = [];
  for (let i = 0; i < CFG.SAMPLES; i++) {
    const a = ids.slice(); for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; }
    const t = a.slice(0, 3); teams.push({ t, p: E.teamPower(t.map(x => BY_ID[x])) });
  }
  teams.sort((x, y) => x.p - y.p);
  const target = Math.min(0.995, Math.max(0.15, 0.2 + points / 480 + (rnd() - 0.5) * 0.1));
  const o = teams[Math.min(teams.length - 1, Math.floor(target * teams.length))];
  return { ids: o.t, name: "CPU-" + String(Math.floor(rnd() * 9000) + 1000) };
}

function addHistory(S, h) { S.history.unshift(h); S.history = S.history.slice(0, CFG.HISTORY_MAX); }

// 途中離脱（リロード等）は敗北扱い。ポイントは 0 未満にならない。
export function forfeitPending(S, now) {
  const p = S.pending; if (!p) return null;
  S.pending = null;
  const pts = -Math.min(S.points, CFG.LOSS_PTS);
  S.points += pts; S.stats.l++;
  addHistory(S, { t: now, seed: p.seed, A: p.A, B: p.B, pa: [], res: -1, rounds: 0, pts, rv: E.RULES_VERSION, name: p.name, forfeit: true });
  return { pts, p };
}

export function battleStart(S, now, rand) {
  tick(S, now);
  const ff = S.pending ? forfeitPending(S, now) : null;
  if (S.team.length !== 3 || !S.team.every(id => S.owned[id])) fail("no_team", "先に3枚の編成を選んでください");
  if (S.battlesToday >= CFG.DAILY_BATTLES) fail("daily_limit", "今日の対戦回数の上限です");
  const o = makeOpponent(S.points, rand);
  const seed = Math.floor(rand() * 4294967296);
  S.battlesToday++; S.tasks.battles++;
  S.pending = { seed, A: S.team.slice(), B: o.ids, name: o.name, t: now };
  return { seed, A: S.pending.A, B: S.pending.B, name: o.name, forfeited: ff ? ff.pts : null };
}

export function cleanPlan(plan) {
  const out = [];
  for (let i = 0; i < E.MAX_ROUNDS; i++) { const x = Array.isArray(plan) ? plan[i] : null; out.push(SKILLS.has(x) ? x : null); }
  return out;
}

export function runBattle(A, B, seed, plan) {
  const ta = E.applySynergy(A.map(i => BY_ID[i])), tb = E.applySynergy(B.map(i => BY_ID[i]));
  return E.battle(ta, tb, E.makeRoller(seed), E.HP_MULT, E.MAX_ROUNDS, { a: plan, b: "auto" });
}

export function battleFinish(S, now, plan) {
  const p = S.pending; if (!p) fail("no_battle", "進行中の対戦がありません");
  const pa = cleanPlan(plan), res = runBattle(p.A, p.B, p.seed, pa);
  S.pending = null;
  const p0 = S.points; let pts = 0;
  if (res.res === 1) { pts = CFG.WIN_PTS; S.stats.w++; }
  else if (res.res === -1) { pts = -Math.min(S.points, CFG.LOSS_PTS); S.stats.l++; } else S.stats.d++;
  S.points += pts;
  const h = { t: now, seed: p.seed, A: p.A, B: p.B, pa, res: res.res, rounds: res.rounds, pts, rv: E.RULES_VERSION, name: p.name };
  addHistory(S, h);
  return { res: res.res, rounds: res.rounds, how: res.how, pts, p0, points: S.points, entry: h };
}

// 状態値の最終サニタイズ（DB に書く前の不変条件チェック）
export function invariant(S) {
  const ok = Number.isInteger(S.packs) && S.packs >= 0 && Number.isInteger(S.points) && S.points >= 0 && Number.isInteger(S.mp) && S.mp >= 0
    && Object.keys(S.owned).every(k => BY_ID[k] && S.owned[k] >= 1) && S.team.length <= 3;
  if (!ok) throw new GameError("corrupt", "状態が不正です");
}
