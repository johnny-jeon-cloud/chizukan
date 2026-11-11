// Chizukan サーバー側ゲームロジック（純関数）。DB・HTTP には依存しない。
import * as E from "./engine.mjs";
import { CARD_ROWS } from "./cards.mjs";

export const CFG = {
  RATES: { N: 55, R: 28, SR: 13, SSR: 4 },
  PACK_SIZE: 3, GRANT_MIN: 240, STOCK_CAP: 3, GOLD_N: 10, DAILY_BATTLES: 10, START_PACKS: 3,
  DUP_PTS: { N: 1, R: 3, SR: 10, SSR: 30 }, EXCH_COST: { N: 10, R: 30, SR: 100, SSR: 300 },
  WIN_PTS: 12, LOSS_PTS: 6, HISTORY_MAX: 10, SAMPLES: 1500,
  CH_PER_DAY: 3, CH_LOW_WIN: 4, BOSS_WIN: { packs: 2, mp: 10 }, BOSS_TRY_MP: 3, TRIP_MP: 2, LB_SIZE: 20,
  RANKS: [0, 20, 50, 100, 180, 300, 500],   // 端末の RANKS（見習い〜伝説）と同じしきい値
  SEASON_REWARD: [{ packs: 0, mp: 3 }, { packs: 0, mp: 5 }, { packs: 1, mp: 10 }, { packs: 1, mp: 20 }, { packs: 2, mp: 30 }, { packs: 2, mp: 50 }, { packs: 3, mp: 80 }],
  QUEST_N: 3, QUEST_BONUS_PACKS: 1,
};
const JST = 9 * 3600e3;
const SKILLS = new Set(["swap", "guard", "rush", "auto"]);

export const CARDS = CARD_ROWS.map(r => ({ id: r[0], rar: r[1], attr: r[2], area: r[3], atk: r[4], hp: r[5], def: r[6], kw: E.kwFor(r[0], r[1]) }));
export const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
const BYRAR = {}; CARDS.forEach(c => (BYRAR[c.rar] = BYRAR[c.rar] || []).push(c));

export function cardsDigest() {
  return CARDS.map(c => `${c.id}:${c.rar}:${c.atk}:${c.hp}:${c.def}:${c.attr}:${c.area}`).join(";");
}

export function jstDay(now) { return new Date(now + JST).toISOString().slice(0, 10); }
const emptyTasks = () => ({ opened: 0, battles: 0, c1: false, c2: false, wins: 0, qc: [] });
const emptyCh = day => ({ day, ids: [] });

export function freshState(now) {
  return normState({ v: 2, packs: CFG.START_PACKS, lastGrant: now, pity: 0, mp: 0, owned: {}, team: [], points: 0, day: jstDay(now),
    battlesToday: 0, tasks: emptyTasks(), history: [], stats: { packs: 0, w: 0, l: 0, d: 0 }, pending: null });
}

// 旧バージョンの状態に新しい項目を補う（読み込み時に毎回呼ぶ）
export function normState(S) {
  S.v = 2;
  S.stats = Object.assign({ packs: 0, w: 0, l: 0, d: 0 }, S.stats); S.stats.boss = S.stats.boss || 0; S.stats.ch = S.stats.ch || 0;
  if (typeof S.name !== "string") S.name = "";
  if (!S.ach || typeof S.ach !== "object") S.ach = {};
  if (!S.boss || typeof S.boss !== "object") S.boss = { day: "", res: null };
  if (!S.trip || typeof S.trip !== "object") S.trip = { day: "", n: 0, last: 0 };
  if (!S.ch || typeof S.ch !== "object" || !Array.isArray(S.ch.ids)) S.ch = emptyCh(S.day);
  if (typeof S.nameDay !== "string") S.nameDay = "";
  S.tasks = Object.assign(emptyTasks(), S.tasks); if (!Array.isArray(S.tasks.qc)) S.tasks.qc = [];
  if (!S.season || typeof S.season !== "object") S.season = { id: "", best: S.points | 0 };
  if (!S.sLast || typeof S.sLast !== "object") S.sLast = null;
  if (typeof S.back !== "string") S.back = "default";
  return S;
}

export function rankOf(points) { let t = 0; CFG.RANKS.forEach((r, i) => { if (points >= r) t = i; }); return t; }
const seasonId = now => jstDay(now).slice(0, 7);
// 月が変わったら、前シーズンの最高段位に応じた報酬を付与しポイントを半分に（ソフトリセット）
function seasonTick(S, now) {
  const id = seasonId(now);
  if (!S.season.id) { S.season = { id, best: S.points }; return; }
  if (S.season.id === id) return;
  const t = rankOf(S.season.best), rw = CFG.SEASON_REWARD[t];
  S.packs += rw.packs; S.mp += rw.mp;
  S.sLast = { id: S.season.id, tier: t, packs: rw.packs, mp: rw.mp, best: S.season.best };
  S.points = Math.floor(S.points / 2);
  S.season = { id, best: S.points };
}
export function tick(S, now) {
  const iv = CFG.GRANT_MIN * 60e3;
  if (S.day !== jstDay(now)) { S.day = jstDay(now); S.battlesToday = 0; S.tasks = emptyTasks(); }
  if (!S.ch || S.ch.day !== S.day) S.ch = emptyCh(S.day);
  seasonTick(S, now);
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
    day: S.day, battlesToday: S.battlesToday, tasks: S.tasks, history: S.history, stats: S.stats, pending: !!S.pending, now,
    name: S.name, ach: S.ach, boss: { done: S.boss.day === S.day, res: S.boss.day === S.day ? S.boss.res : null, ids: bossFor(S.day).ids },
    trip: { done: S.trip.day === S.day, n: S.trip.n, last: S.trip.last }, season: { id: S.season.id, best: S.season.best, tier: rankOf(S.points), bestTier: rankOf(S.season.best), days: daysLeft(now) }, sLast: S.sLast, quests: questView(S), back: S.back, ch: { n: S.ch.ids.length, max: CFG.CH_PER_DAY, ids: S.ch.ids } };
}

function daysLeft(now) { const d = new Date(now + JST), y = d.getUTCFullYear(), m = d.getUTCMonth(); return Math.round((Date.UTC(y, m + 1, 1) - Date.UTC(y, m, d.getUTCDate())) / 864e5); }

// ---- 毎日のクエスト（全員同じ日替わり3つ） ----
const QUESTS = [
  { id: "q_win2", goal: 2, mp: 6, p: S => S.tasks.wins },
  { id: "q_win4", goal: 4, mp: 10, p: S => S.tasks.wins },
  { id: "q_pack2", goal: 2, mp: 5, p: S => S.tasks.opened },
  { id: "q_bat5", goal: 5, mp: 8, p: S => S.tasks.battles },
  { id: "q_trip", goal: 1, mp: 4, p: S => (S.trip.day === S.day ? 1 : 0) },
  { id: "q_boss", goal: 1, mp: 6, p: S => (S.boss.day === S.day ? 1 : 0) },
  { id: "q_ch", goal: 1, mp: 6, p: S => S.ch.ids.length },
];
export function questsFor(day) {
  const rnd = E.mulberry32(hashStr("q|" + day)), a = QUESTS.slice();
  for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; }
  const t = a.slice(0, CFG.QUEST_N), hasWin = t.some(q => q.id === "q_win2" || q.id === "q_win4");
  if (!hasWin) t[0] = QUESTS[0];   // 最低1つは対戦系
  return t;
}
function questView(S) { return { list: questsFor(S.day).map(q => ({ id: q.id, goal: q.goal, mp: q.mp, prog: Math.min(q.goal, q.p(S)), claimed: S.tasks.qc.includes(q.id) })), bonus: CFG.QUEST_BONUS_PACKS, bonusDone: S.tasks.qc.includes("bonus") }; }

// ---- カードの裏面（実績で解放） ----
export const BACKS = { default: null, sakura: "dex_25", indigo: "win_10", gold: "dex_50", seal: "boss_win", night: "rank_300", world: "dex_100" };
export function setBack(S, id) {
  if (!Object.prototype.hasOwnProperty.call(BACKS, id)) fail("bad_back", "不明な裏面です");
  if (BACKS[id] && !S.ach[BACKS[id]]) fail("back_locked", "まだ解放されていません");
  S.back = id; return {};
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
  else if (typeof k === "string" && k.startsWith("q_")) {
    const q = questsFor(S.day).find(x => x.id === k);
    if (!q || S.tasks.qc.includes(k) || q.p(S) < q.goal) fail("cannot_claim", "受け取れる報酬がありません");
    S.tasks.qc.push(k); S.mp += q.mp;
    if (questsFor(S.day).every(x => S.tasks.qc.includes(x.id)) && !S.tasks.qc.includes("bonus")) { S.tasks.qc.push("bonus"); S.packs += CFG.QUEST_BONUS_PACKS; }
  }
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

// 目標パーセンタイルの強さのチームを無作為標本から選ぶ
function sampleTeam(rnd, target, samples) {
  const ids = CARDS.map(c => c.id), teams = [];
  for (let i = 0; i < samples; i++) {
    const a = ids.slice(); for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; }
    const t = a.slice(0, 3); teams.push({ t, p: E.teamPower(t.map(x => BY_ID[x])) });
  }
  teams.sort((x, y) => x.p - y.p);
  return teams[Math.min(teams.length - 1, Math.floor(target * teams.length))];
}
export function makeOpponent(points, rnd) {
  const target = Math.min(0.995, Math.max(0.15, 0.2 + points / 480 + (rnd() - 0.5) * 0.1));
  const o = sampleTeam(rnd, target, CFG.SAMPLES);
  return { ids: o.t, name: "CPU-" + String(Math.floor(rnd() * 9000) + 1000) };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const BOSS_CACHE = new Map();
// 今日の首領: 日付から決まる固定チーム（全員同じ）。強さは上位 約93〜97%
export function bossFor(day) {
  if (BOSS_CACHE.has(day)) return BOSS_CACHE.get(day);
  const rnd = E.mulberry32(hashStr("boss|" + day + "|" + CARDS.length));
  const o = sampleTeam(rnd, 0.93 + rnd() * 0.04, 800), b = { ids: o.t, name: "BOSS" };
  if (BOSS_CACHE.size > 8) BOSS_CACHE.clear();
  BOSS_CACHE.set(day, b); return b;
}

function addHistory(S, h) { S.history.unshift(h); S.history = S.history.slice(0, CFG.HISTORY_MAX); }

// 途中離脱（リロード等）は敗北扱い。ポイントは 0 未満にならない。首領戦はポイント変動なし（挑戦権は消費済み）。
export function forfeitPending(S, now) {
  const p = S.pending; if (!p) return null;
  S.pending = null;
  const mode = p.mode || "n";
  let pts = 0;
  if (mode !== "boss") { pts = -Math.min(S.points, CFG.LOSS_PTS); S.points += pts; S.stats.l++; }
  addHistory(S, { t: now, seed: p.seed, A: p.A, B: p.B, pa: [], res: -1, rounds: 0, pts, rv: E.RULES_VERSION, name: p.name, forfeit: true, mode });
  return { pts, p };
}

// opt: {} 通常 / {boss:true} 今日の首領 / {ch:{pub,name,team,points}} 他のプレイヤーのチームへの挑戦
export function battleStart(S, now, rand, opt = {}) {
  tick(S, now);
  if (S.team.length !== 3 || !S.team.every(id => S.owned[id])) fail("no_team", "先に3枚の編成を選んでください");
  let B, name, mode = "n", pub = null, tp = 0;
  if (opt.boss) {
    if (S.boss.day === S.day) fail("boss_done", "今日の首領戦はすでに挑戦済みです");
    mode = "boss"; const b = bossFor(S.day); B = b.ids; name = "BOSS";
  } else if (opt.ch) {
    const c = opt.ch;
    if (!c || !Array.isArray(c.team) || c.team.length !== 3 || !c.team.every(id => BY_ID[id])) fail("bad_target", "この相手には挑戦できません");
    if (S.ch.ids.includes(c.pub)) fail("ch_done", "この相手には今日すでに挑戦しました");
    if (S.ch.ids.length >= CFG.CH_PER_DAY) fail("ch_limit", "今日の挑戦回数の上限です");
    if (S.battlesToday >= CFG.DAILY_BATTLES) fail("daily_limit", "今日の対戦回数の上限です");
    mode = "ch"; pub = c.pub; B = c.team.slice(); name = String(c.name || "").slice(0, 12) || "挑戦者"; tp = c.points | 0;
  } else {
    if (S.battlesToday >= CFG.DAILY_BATTLES) fail("daily_limit", "今日の対戦回数の上限です");
    const o = makeOpponent(S.points, rand); B = o.ids; name = o.name;
  }
  const ff = S.pending ? forfeitPending(S, now) : null;   // 前の未完了対戦の敗北処理（検証を通ってから）
  const seed = Math.floor(rand() * 4294967296);
  if (mode === "boss") S.boss = { day: S.day, res: null };
  else { S.battlesToday++; S.tasks.battles++; if (mode === "ch") S.ch.ids.push(pub); }
  S.pending = { seed, A: S.team.slice(), B, name, t: now, mode, pub, tp };
  return { seed, A: S.pending.A, B, name, mode, forfeited: ff ? ff.pts : null };
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
  const pa = cleanPlan(plan), res = runBattle(p.A, p.B, p.seed, pa), mode = p.mode || "n";
  S.pending = null;
  const p0 = S.points; let pts = 0, reward = null;
  if (mode === "boss") {
    if (res.res === 1) { S.stats.boss++; reward = Object.assign({}, CFG.BOSS_WIN); S.packs += reward.packs; S.mp += reward.mp; }
    else { reward = { packs: 0, mp: CFG.BOSS_TRY_MP }; S.mp += reward.mp; }
    S.boss = { day: S.day, res: res.res };
  } else {
    if (res.res === 1) { pts = mode === "ch" && p.tp * 2 < p0 ? CFG.CH_LOW_WIN : CFG.WIN_PTS; S.stats.w++; if (mode === "ch") S.stats.ch++; }
    else if (res.res === -1) { pts = -Math.min(S.points, CFG.LOSS_PTS); S.stats.l++; } else S.stats.d++;
    S.points += pts; if (S.points > S.season.best) S.season.best = S.points;
  }
  if (res.res === 1) S.tasks.wins++;
  const h = { t: now, seed: p.seed, A: p.A, B: p.B, pa, res: res.res, rounds: res.rounds, pts, rv: E.RULES_VERSION, name: p.name, mode };
  addHistory(S, h);
  return { res: res.res, rounds: res.rounds, how: res.how, pts, p0, points: S.points, entry: h, mode, reward };
}

// 今日の旅: 1日1回、持っているカードの1枚が旅に出て地図ポイントを持ち帰る
export function trip(S, now, rand) {
  tick(S, now);
  if (S.trip.day === S.day) fail("trip_done", "今日の旅はすでに出発しました");
  const ids = Object.keys(S.owned).map(Number).sort((a, b) => a - b);
  if (!ids.length) fail("no_cards", "カードがありません");
  const id = ids[Math.floor(rand() * ids.length)];
  S.trip = { day: S.day, n: S.trip.n + 1, last: id }; S.mp += CFG.TRIP_MP;
  return { id, mp: CFG.TRIP_MP };
}

const NAME_RE = /^[\p{L}\p{N}_ \-]{1,12}$/u;
export function setName(S, now, name) {
  tick(S, now);
  const n = String(name || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!NAME_RE.test(n)) fail("bad_name", "名前は12文字以内の文字・数字・スペース・_・-で入力してください");
  if (S.name && S.name !== n && S.nameDay === S.day) fail("name_limit", "名前の変更は1日1回までです");
  if (S.name !== n) S.nameDay = S.day;
  S.name = n; return { name: n };
}

// ---- 実績（サーバーが判定・報酬付与。条件は状態から再計算できる） ----
const ownN = S => Object.keys(S.owned).length;
const ownRar = (S, ...rs) => CARDS.filter(c => S.owned[c.id] && rs.includes(c.rar)).length;
const areaDone = (S, a) => CARDS.filter(c => c.area === a).every(c => S.owned[c.id]);
const pct = (S, f) => ownN(S) >= Math.ceil(CARDS.length * f);
export const ACH = [
  { id: "first_pack", r: { mp: 2 }, t: S => S.stats.packs >= 1 },
  { id: "packs_10", r: { packs: 1 }, t: S => S.stats.packs >= 10 },
  { id: "packs_50", r: { packs: 1, mp: 10 }, t: S => S.stats.packs >= 50 },
  { id: "dex_25", r: { mp: 10 }, t: S => pct(S, 0.25) },
  { id: "dex_50", r: { packs: 1, mp: 10 }, t: S => pct(S, 0.5) },
  { id: "dex_100", r: { packs: 2, mp: 50 }, t: S => ownN(S) >= CARDS.length },
  { id: "ssr_1", r: { mp: 10 }, t: S => ownRar(S, "SSR") >= 1 },
  { id: "sr_5", r: { mp: 10 }, t: S => ownRar(S, "SR", "SSR") >= 5 },
  { id: "area_jp", r: { packs: 1 }, t: S => areaDone(S, "日本") },
  { id: "area_kr", r: { packs: 1 }, t: S => areaDone(S, "韓国") },
  { id: "area_cn", r: { packs: 1 }, t: S => areaDone(S, "中国") },
  { id: "area_tw", r: { packs: 1 }, t: S => areaDone(S, "台湾") },
  { id: "win_1", r: { mp: 3 }, t: S => S.stats.w >= 1 },
  { id: "win_10", r: { packs: 1 }, t: S => S.stats.w >= 10 },
  { id: "win_50", r: { packs: 2 }, t: S => S.stats.w >= 50 },
  { id: "rank_50", r: { mp: 10 }, t: S => S.points >= 50 },
  { id: "rank_300", r: { packs: 1, mp: 30 }, t: S => S.points >= 300 },
  { id: "boss_win", r: { packs: 1 }, t: S => S.stats.boss >= 1 },
  { id: "ch_win", r: { mp: 5 }, t: S => S.stats.ch >= 1 },
  { id: "trip_7", r: { mp: 15 }, t: S => S.trip.n >= 7 },
];
// 新しく達成した実績を記録して報酬を付与し、[{id,r}] を返す
export function checkAch(S, now) {
  const out = [];
  for (const a of ACH) {
    if (S.ach[a.id] || !a.t(S)) continue;
    S.ach[a.id] = now; S.packs += a.r.packs || 0; S.mp += a.r.mp || 0; out.push({ id: a.id, r: a.r });
  }
  return out;
}

// 状態値の最終サニタイズ（DB に書く前の不変条件チェック）
export function invariant(S) {
  const ok = Number.isInteger(S.packs) && S.packs >= 0 && Number.isInteger(S.points) && S.points >= 0 && Number.isInteger(S.mp) && S.mp >= 0
    && Object.keys(S.owned).every(k => BY_ID[k] && S.owned[k] >= 1) && S.team.length <= 3 && S.name.length <= 24;
  if (!ok) throw new GameError("corrupt", "状態が不正です");
}
