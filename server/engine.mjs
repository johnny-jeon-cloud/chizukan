// Chizukan 戦闘エンジン（規則 v0.7 候補）。HP×1・最大8回合・スキル（交代／防御／強攻）。
const RULES_VERSION = "v1.0";
const HP_MULT = 1;
const MAX_ROUNDS = 8;
const SKILL_USES = 3;
// 特性（R以上）: 属性ごとに1つ。海洋=先手／山岳=不動／都市=繁栄／歴史=再生
const TRAIT = { "海洋": "first", "山岳": "stand", "都市": "boom", "歴史": "regen" };
const TRAIT_JP = { first: "先手", stand: "不動", boom: "繁栄", regen: "再生" };
const TRAIT_DESC = { first: "先に攻撃し、倒せば反撃を受けない（先手同士は同時）", stand: "受けるダメージ×0.85", boom: "与えるダメージ×1.08", regen: "毎回合の終わりに最大HPの8%回復" };
// 特技（SR/SSR）: 聖盾=最初の被弾を1回無効／貫通=相手DEFの影響を半減／遺言=撃破時に相手へATK×0.6の固定ダメージ／凱旋=撃破後HPを15%回復
const KW_LIST = ["shield", "pierce", "rattle", "triumph"];
const KW_JP = { shield: "聖盾", pierce: "貫通", rattle: "遺言", triumph: "凱旋" };
const KW_DESC = { shield: "最初に受けるダメージを1回無効にする", pierce: "相手のDEFによる軽減が半分になる", rattle: "撃破されたとき、相手にATK×0.6の固定ダメージ", triumph: "相手を撃破したとき最大HPの15%回復" };
function kwFor(id, rar) { return rar === "SR" || rar === "SSR" ? KW_LIST[(id * 7 + 3) % 4] : null; }
function kwOf(c) { return c.kw || null; }
function traitOf(c) { return c.rar && c.rar !== "N" ? TRAIT[c.attr] || null : null; }
// 地域連携: 同地域2枚→その2枚のATK+5%／3枚→全員ATK+10%・HP+10%。補正後のカード（コピー）を返す。
function applySynergy(cards) {
  const cnt = {}; cards.forEach(c => { cnt[c.area] = (cnt[c.area] || 0) + 1; });
  return cards.map(c => {
    const n = cnt[c.area];
    if (n < 2) return Object.assign({}, c, { syn: 0 });
    const f = n >= 3 ? 1.1 : 1.05, g = n >= 3 ? 1.1 : 1;
    return Object.assign({}, c, { atk: roundHalfEven(c.atk * f), hp: roundHalfEven(c.hp * g), syn: n });
  });
}
function synText(cards) {
  const cnt = {}; cards.forEach(c => { cnt[c.area] = (cnt[c.area] || 0) + 1; });
  const k = Object.keys(cnt).filter(a => cnt[a] >= 2)[0]; if (!k) return "";
  return cnt[k] >= 3 ? `地域連携 ${k}×3：ATK+10%・HP+10%` : `地域連携 ${k}×2：ATK+5%`;
}
const BEAT = { "海洋": "都市", "都市": "山岳", "山岳": "歴史", "歴史": "海洋" };
function attrMult(a, d) {
  if (BEAT[a] === d) return 1.25;
  if (BEAT[d] === a) return 0.8;
  return 1.0;
}
function roundHalfEven(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRoller(seed) {
  const r = mulberry32(seed);
  return () => 0.9 + 0.2 * r();
}
// スキル: swap=控えの生存カードと入れ替え（その回合から交代後が戦う）／guard=受けるダメージ×0.5／rush=与ダメ×1.5・受ダメ×1.25
// 各陣営は合計 SKILL_USES 回まで・1回合1つ。
function firstAlive(h, except) { for (let i = 0; i < h.length; i++) if (i !== except && h[i] > 0) return i; return -1; }
function calcDmg(a, b, roll, mine, theirs) {
  let d = a.atk * attrMult(a.attr, b.attr) * roll - (kwOf(a) === "pierce" ? 0.25 : 0.5) * b.def;
  if (traitOf(a) === "boom") d *= 1.08;
  if (traitOf(b) === "stand") d *= 0.85;
  if (mine === "rush") d *= 1.5;
  if (theirs === "guard") d *= 0.5;
  if (theirs === "rush") d *= 1.25;
  return Math.max(1, roundHalfEven(d));
}
// 自動方針（AI／スキップ時）。状態だけで決まるので再現可能。
function autoAct(side, ours, theirs, hOurs, hTheirs, i, j, used, maxOurs) {
  if (used >= SKILL_USES) return null;
  const a = ours[i], b = theirs[j];
  const m = attrMult(a.attr, b.attr);
  if (m < 1) {
    const k = firstAlive(hOurs, i);
    if (k >= 0 && attrMult(ours[k].attr, b.attr) > 1) return "swap";
  }
  const dealt = calcDmg(a, b, 1, "rush", null);
  if (dealt >= hTheirs[j] && calcDmg(a, b, 1, null, null) < hTheirs[j]) return "rush";
  const taken = calcDmg(b, a, 1, null, null);
  if (hOurs[i] / maxOurs[i] < 0.5 && taken >= hOurs[i] * 0.6 && taken * 0.5 < hOurs[i]) return "guard";
  return null;
}
// plans: {a:[...], b:[...]}。配列の要素: "swap"|"guard"|"rush"|null|"auto"。配列より後ろは null（plan が "auto" 文字列なら全回合 auto）。
function battle(A, B, roll, hpMult = HP_MULT, cap = MAX_ROUNDS, plans = {}) {
  const ha = A.map(c => c.hp * hpMult), hb = B.map(c => c.hp * hpMult);
  const mxA = ha.slice(), mxB = hb.slice();
  const maxA = ha.reduce((s, x) => s + x, 0), maxB = hb.reduce((s, x) => s + x, 0);
  const shA = A.map(c => kwOf(c) !== "shield"), shB = B.map(c => kwOf(c) !== "shield");   // true=聖盾なし／使用済み
  let ia = 0, ib = 0, ua = 0, ub = 0;
  const log = [];
  const pick = (pl, r) => pl === "auto" ? "auto" : (pl && pl[r - 1]) || null;
  for (let r = 1; r <= cap; r++) {
    let sa = pick(plans.a, r), sb = pick(plans.b, r);
    if (sa === "auto") sa = autoAct("a", A, B, ha, hb, ia, ib, ua, mxA);
    if (sb === "auto") sb = autoAct("b", B, A, hb, ha, ib, ia, ub, mxB);
    const fromA = ia, fromB = ib;
    if (sa && ua >= SKILL_USES) sa = null;
    if (sb && ub >= SKILL_USES) sb = null;
    if (sa === "swap") { const k = firstAlive(ha, ia); if (k < 0) sa = null; else ia = k; }
    if (sb === "swap") { const k = firstAlive(hb, ib); if (k < 0) sb = null; else ib = k; }
    if (sa) ua++; if (sb) ub++;
    const a = A[ia], b = B[ib];
    const da = calcDmg(a, b, roll(), sa, sb);
    const db = calcDmg(b, a, roll(), sb, sa);
    let daa = da, dbb = db, fk = 0, blkA = false, blkB = false, drA = 0, drB = 0, tvA = 0, tvB = 0;
    const hitB = () => { if (!shB[ib] && daa > 0) { shB[ib] = true; daa = 0; blkB = true; } hb[ib] -= daa; };
    const hitA = () => { if (!shA[ia] && dbb > 0) { shA[ia] = true; dbb = 0; blkA = true; } ha[ia] -= dbb; };
    const fa1 = traitOf(a) === "first", fb1 = traitOf(b) === "first";
    if (fa1 && !fb1) { hitB(); if (hb[ib] <= 0) { dbb = 0; fk = 1; } else hitA(); }
    else if (fb1 && !fa1) { hitA(); if (ha[ia] <= 0) { daa = 0; fk = -1; } else hitB(); }
    else { hitB(); hitA(); }
    const killB = hb[ib] <= 0, killA = ha[ia] <= 0;
    let reA = 0, reB = 0;
    if (traitOf(a) === "regen" && ha[ia] > 0) { const nh = Math.min(mxA[ia], ha[ia] + Math.max(1, Math.round(mxA[ia] * 0.08))); reA = nh - ha[ia]; ha[ia] = nh; }
    if (traitOf(b) === "regen" && hb[ib] > 0) { const nh = Math.min(mxB[ib], hb[ib] + Math.max(1, Math.round(mxB[ib] * 0.08))); reB = nh - hb[ib]; hb[ib] = nh; }
    // 遺言（相手が生きている場合のみ・連鎖しない）／凱旋
    const rA = killA && !killB && kwOf(a) === "rattle" ? Math.max(1, roundHalfEven(a.atk * 0.6)) : 0;
    const rB = killB && !killA && kwOf(b) === "rattle" ? Math.max(1, roundHalfEven(b.atk * 0.6)) : 0;
    if (rA) { drA = rA; hb[ib] -= rA; }
    if (rB) { drB = rB; ha[ia] -= rB; }
    if (killB && ha[ia] > 0 && kwOf(a) === "triumph") { const nh = Math.min(mxA[ia], ha[ia] + Math.max(1, roundHalfEven(mxA[ia] * 0.15))); tvA = nh - ha[ia]; ha[ia] = nh; }
    if (killA && hb[ib] > 0 && kwOf(b) === "triumph") { const nh = Math.min(mxB[ib], hb[ib] + Math.max(1, roundHalfEven(mxB[ib] * 0.15))); tvB = nh - hb[ib]; hb[ib] = nh; }
    const entry = { fk, reA, reB, blkA, blkB, drA, drB, tvA, tvB, round: r, ia, ib, fromA, fromB, actA: sa, actB: sb, da: daa, db: dbb, aAttr: attrMult(a.attr, b.attr), bAttr: attrMult(b.attr, a.attr), koA: false, koB: false };
    if (hb[ib] <= 0) { const k = firstAlive(hb, -1); if (k >= 0) { ib = k; } entry.koB = true; }
    if (ha[ia] <= 0) { const k = firstAlive(ha, -1); if (k >= 0) { ia = k; } entry.koA = true; }
    entry.nia = ia; entry.nib = ib;
    entry.ha = ha.slice(); entry.hb = hb.slice();
    log.push(entry);
    const deadA = ha.every(x => x <= 0), deadB = hb.every(x => x <= 0);
    if (deadA || deadB) {
      return { rounds: r, how: "wipe", res: (deadA && deadB) ? 0 : (deadB ? 1 : -1), ha, hb, maxA, maxB, log, ua, ub };
    }
  }
  const fa = ha.reduce((s, x) => s + Math.max(0, x), 0) / maxA;
  const fb = hb.reduce((s, x) => s + Math.max(0, x), 0) / maxB;
  const res = Math.abs(fa - fb) < 1e-12 ? 0 : (fa > fb ? 1 : -1);
  return { rounds: cap, how: "t10", res, ha, hb, maxA, maxB, fa, fb, log, ua, ub };
}
function teamPower(T) { return T.reduce((s, c) => s + c.atk + c.hp + c.def, 0); }
export { kwFor, kwOf, KW_JP, KW_DESC, applySynergy, synText, traitOf, TRAIT_JP, TRAIT_DESC, battle, makeRoller, mulberry32, roundHalfEven, attrMult, teamPower, HP_MULT, MAX_ROUNDS, RULES_VERSION, SKILL_USES };
