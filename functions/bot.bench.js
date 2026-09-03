/**
 * Bot benchmark — runs the pure server engine (no Firestore) with seats driven
 * by different policies and reports who wins.
 *
 *   node bot.bench.js [sngs=150] [cashHands=3000] [budgetMs=60]
 *
 * Policies:
 *   v2      — the new shared brain (botBrain.js)
 *   legacy  — the OLD client bot (index.html botPokerMove before v2), ported 1:1
 *   human   — a "value bettor": raises good hands, bets big when strong, folds
 *             to aggression with air, calls with medium. The archetype that
 *             beat the old bots 10-0.
 *   station — calls almost everything (never folds a pair)
 *   maniac  — bets/raises most streets regardless of cards
 */
"use strict";
const E = require("./pokerEngine").__engineInternals;
const C = require("./pokerCore");
const B = require("./botBrain");
const args = process.argv.slice(2);
const SNGS = Number(args[0]) || 150;
const CASH_HANDS = Number(args[1]) || 3000;
const BUDGET = Number(args[2]) || 60;
const round2 = C.round2;
const rnd = Math.random;
const brain = B.create({evaluate5Cards: C.evaluate5Cards, getCombinations: C.getCombinations, bestScoreFull: C.bestScoreFull, HOLE_ORD: C.HOLE_ORD, SUITS: C.SUITS, CARD_VALUES: C.CARD_VALUES, rnd, budgetMs: BUDGET});

/* ---------- helpers shared by the scripted opponents ---------- */
const deckWithout = (known) => { const ids = new Set(known.map((c) => c.id)); return C.pokerDeck().filter((c) => !ids.has(c.id)); };
const scoreNow = (hole, board) => {
  if (board.length < 3) return 0;
  let best = 0; C.getCombinations(hole.concat(board), 5).forEach((c) => { const s = C.evaluate5Cards(c); if (s > best) best = s; }); return best;
};
const hsPct = (hole, board) => { // percentile of my made hand vs. random holdings on this board
  if (board.length < 3) return 0.5;
  const deck = deckWithout(hole.concat(board)); const my = scoreNow(hole, board); let n = 0, below = 0;
  for (let i = 0; i < 160; i++) { const a = deck[Math.floor(rnd() * deck.length)]; let b = deck[Math.floor(rnd() * deck.length)]; while (b.id === a.id) b = deck[Math.floor(rnd() * deck.length)]; const s = scoreNow([a, b], board); n++; if (s < my) below++; else if (s === my) below += 0.5; }
  return below / n;
};
const simMyEquity = (my, board, oppN) => { // the OLD bot's equity (vs. random hands)
  let score = 0; const iters = 120;
  for (let i = 0; i < iters; i++) {
    const deck = deckWithout(my.concat(board)); const opps = []; for (let o = 0; o < oppN; o++) opps.push(deck.splice(0, 2));
    const fb = board.slice(); while (fb.length < 5) fb.push(deck.pop());
    const mine = C.bestScoreFull(my, fb, "NLH"); let lose = false, tie = false;
    for (const oc of opps) { const s = C.bestScoreFull(oc, fb, "NLH"); if (s > mine) { lose = true; break; } if (s === mine) tie = true; }
    if (!lose) score += tie ? 0.5 : 1;
  }
  return score / iters;
};
const potOf = (S) => round2((S.gameState.pots || []).reduce((s, p) => s + p.amount, 0) + Object.values(S.players).reduce((s, p) => s + (p.bet || 0), 0));

/* ---------- OLD client bot, ported 1:1 from index.html (pre-v2) ---------- */
const botPreflopTier = (cards) => {
  const vs = cards.map((c) => C.HOLE_ORD[c.val] || 0).sort((a, b) => b - a);
  const suited = cards[0].suit === cards[1].suit;
  if (vs[0] === vs[1]) return vs[0] >= 10 ? 3 : 2;
  const gap = vs[0] - vs[1];
  if (vs[0] === 14 && vs[1] >= 12) return 3;
  if (vs[0] >= 12 && vs[1] >= 10 || vs[0] === 14 && suited) return 2;
  if (vs[0] === 14 || gap <= 1 && vs[1] >= 5 || gap <= 3 && suited && vs[1] >= 4 || vs[0] >= 10 && vs[1] >= 8) return 1;
  return 0;
};
const legacyMove = (S, uid) => {
  const g = S.gameState, b = S.players[uid], cards = S.priv[uid];
  const bb = blindsBB(S);
  const toCall = round2(Math.max(0, (g.highestBet || 0) - (b.bet || 0)));
  const potNow = potOf(S); const stack = b.stack || 0;
  const snap = (x) => Math.max(bb, Math.round(x / bb) * bb);
  const raiseTo = (x) => { const min = round2((g.highestBet || 0) + (g.minRaise || bb)); return round2(Math.min(Math.max(snap(x), min), stack + (b.bet || 0))); };
  const oppN = Math.max(1, Object.values(S.players).filter((p) => p.status === "active" && p.uid !== uid).length);
  const r = rnd();
  if (g.phase === "preflop") {
    if (toCall > 0 && stack <= bb * 1.5) return {type: "call"};
    const tier = botPreflopTier(cards); const shortStack = stack <= bb * 12; const bigRaise = toCall > bb * 3.5;
    const isPair = cards[0].val === cards[1].val;
    if (isPair && toCall > 0 && toCall <= Math.min(stack * 0.15, bb * 8) && tier < 3) return {type: "call"};
    if (tier === 0) return toCall <= 0 ? {type: "call"} : {type: "fold"};
    if (tier === 1) {
      if (toCall <= 0) return r < 0.12 ? {type: "raise", amt: raiseTo(bb * 2.5)} : {type: "call"};
      if (toCall > stack * 0.3) return {type: "fold"};
      if (toCall <= bb * 2.5) return r < 0.75 ? {type: "call"} : {type: "fold"};
      return r < 0.12 ? {type: "call"} : {type: "fold"};
    }
    if (tier === 2) {
      if (shortStack && toCall >= stack * 0.35) return r < 0.55 ? {type: "call"} : {type: "fold"};
      if (toCall > stack * 0.35) return r < 0.1 ? {type: "call"} : {type: "fold"};
      if (toCall <= 0) return r < 0.45 ? {type: "raise", amt: raiseTo(bb * (2.5 + r))} : {type: "call"};
      if (bigRaise) return r < 0.55 ? {type: "call"} : {type: "fold"};
      return r < 0.3 ? {type: "raise", amt: raiseTo((g.highestBet || bb) * 3)} : {type: "call"};
    }
    if (shortStack) return {type: "raise", amt: round2(stack + (b.bet || 0))};
    if (toCall <= 0) return r < 0.8 ? {type: "raise", amt: raiseTo(bb * (2.8 + r))} : {type: "call"};
    return r < 0.7 ? {type: "raise", amt: raiseTo((g.highestBet || bb) * (2.7 + r * 0.8))} : {type: "call"};
  }
  const eq = simMyEquity(cards, g.board || [], Math.min(3, oppN));
  const potOdds = toCall > 0 ? toCall / (potNow + toCall) : 0;
  const committed = potNow > 0 && stack <= potNow * 0.6;
  if (toCall <= 0) {
    const river = g.phase === "river";
    if (eq > 0.9) return (river ? r < 0.05 : r < 0.15) ? {type: "call"} : {type: "raise", amt: raiseTo((b.bet || 0) + potNow * (0.65 + r * 0.35))};
    if (eq > 0.78) return (river ? r < 0.12 : r < 0.25) ? {type: "call"} : {type: "raise", amt: raiseTo((b.bet || 0) + potNow * (0.55 + r * 0.3))};
    if (eq > 0.55) return r < 0.5 ? {type: "raise", amt: raiseTo((b.bet || 0) + potNow * (0.4 + r * 0.25))} : {type: "call"};
    return r < 0.11 ? {type: "raise", amt: raiseTo((b.bet || 0) + potNow * 0.55)} : {type: "call"};
  }
  if (toCall >= stack) return eq > Math.max(0.42, potOdds) ? {type: "call"} : {type: "fold"};
  if (eq > potOdds + 0.18 && eq > 0.62) { if (r < 0.3) return {type: "raise", amt: raiseTo((g.highestBet || 0) + Math.min(potNow, (g.highestBet || bb) * 1.6))}; return {type: "call"}; }
  if (eq > potOdds + 0.02) return {type: "call"};
  if (committed && eq > potOdds - 0.06) return {type: "call"};
  return r < 0.07 ? {type: "raise", amt: raiseTo((g.highestBet || 0) + potNow * 0.7)} : {type: "fold"};
};

/* ---------- scripted humans ---------- */
const humanMove = (style) => (S, uid) => {
  const g = S.gameState, b = S.players[uid], cards = S.priv[uid];
  const bb = blindsBB(S);
  const toCall = round2(Math.max(0, (g.highestBet || 0) - (b.bet || 0)));
  const pot = potOf(S); const stack = b.stack || 0; const r = rnd();
  const raiseTo = (x) => { const min = round2((g.highestBet || 0) + (g.minRaise || bb)); return round2(Math.min(Math.max(Math.round(x / bb) * bb, min), stack + (b.bet || 0))); };
  const bet = (frac) => ({type: "raise", amt: raiseTo((b.bet || 0) + toCall + Math.max(pot, bb * 2) * frac)});
  if (g.phase === "preflop") {
    const pct = brain.chenPct(cards);
    if (toCall > 0 && stack <= bb * 1.5) return {type: "call"};
    if (style === "maniac") return toCall < stack * 0.5 && r < 0.7 ? {type: "raise", amt: raiseTo(Math.max(bb * 3, (g.highestBet || bb) * 3))} : (pct > 0.3 || toCall === 0 ? {type: "call"} : {type: "fold"});
    if (pct >= 0.94) return toCall >= stack * 0.5 ? {type: "call"} : {type: "raise", amt: raiseTo(Math.max(bb * 3, (g.highestBet || bb) * 3))};
    if (toCall >= stack * 0.45) return pct >= 0.85 ? {type: "call"} : {type: "fold"};
    if (toCall > bb * 4) return pct >= 0.8 ? {type: "call"} : {type: "fold"};
    if (toCall <= 0) return pct >= 0.75 ? {type: "raise", amt: raiseTo(bb * 3)} : {type: "call"};
    if (style === "station") return pct >= 0.25 ? {type: "call"} : {type: "fold"};
    if (pct >= 0.75 && toCall <= bb * 1.5) return {type: "raise", amt: raiseTo(bb * 3)};
    return pct >= 0.5 || (toCall <= bb && pct >= 0.3) ? {type: "call"} : {type: "fold"};
  }
  const hs = hsPct(cards, g.board || []);
  const river = g.phase === "river";
  if (style === "maniac") {
    if (toCall >= stack) return hs >= 0.35 ? {type: "call"} : {type: "fold"};
    if (r < 0.6 && toCall < stack * 0.6) return bet(0.8);
    return hs >= 0.3 || toCall === 0 ? {type: "call"} : {type: "fold"};
  }
  if (style === "station") {
    if (toCall <= 0) return hs >= 0.8 ? bet(0.6) : {type: "call"};
    if (toCall >= stack) return hs >= 0.35 ? {type: "call"} : {type: "fold"};
    return hs >= 0.2 ? {type: "call"} : {type: "fold"};
  }
  // value bettor
  if (toCall <= 0) {
    if (hs >= 0.75) return bet(0.7 + r * 0.3);
    if (hs >= 0.5 && r < 0.6) return bet(0.5);
    if (river && r < 0.1) return bet(0.6);
    return {type: "call"};
  }
  if (toCall >= stack) return hs >= 0.6 ? {type: "call"} : {type: "fold"};
  if (hs >= 0.85) return r < 0.7 ? bet(1.0) : {type: "call"};
  if (hs >= 0.45) return toCall <= pot * 1.2 ? {type: "call"} : {type: "fold"};
  return {type: "fold"};
};

/* ---------- engine driving ---------- */
function blindsBB(S) { return (Number(S.settings.blinds) || 0.5) * 2 * (S._lvlMult || 1); }
const POL = {
  v2: (S, uid) => brain.decide({g: S.gameState, players: S.players, history: S.table.history || [], me: S.players[uid], cards: S.priv[uid] || [], bb: blindsBB(S), gameType: "NLH", spin: !!S.settings.spinMode, tableId: S.id}),
  legacy: legacyMove,
  human: humanMove("value"),
  station: humanMove("station"),
  maniac: humanMove("maniac"),
};
function act(S, uid) {
  const p = S.players[uid]; const g = S.gameState;
  const mv = POL[p.policy](S, uid) || {type: "call"};
  const toCall = round2(Math.max(0, g.highestBet - (p.bet || 0)));
  if (mv.type === "raise" && mv.amt > (p.bet || 0) + 0.001 && mv.amt > g.highestBet) E.applyAction(S, uid, "raise", round2(mv.amt), false);
  else if (mv.type === "fold" && toCall > 0) E.applyAction(S, uid, "fold", undefined, false);
  else E.applyAction(S, uid, "call", undefined, false);
}
function playHand(S) {
  if (E.startHand(S) !== "dealt") return false;
  let guard = 0;
  while (S.gameState.phase !== "showdown" && guard++ < 200) {
    const g = S.gameState;
    if (g.allInReveal) { g.ritOffer = null; S.now += 1500; E.advancePhase(S); continue; }
    if (!g.activeTurnUid) { S.now += 1500; E.advancePhase(S); continue; }
    act(S, g.activeTurnUid);
  }
  S.now += 6000;
  return true;
}
function mkState(seats, stack, blinds, spin) {
  const players = {};
  seats.forEach((pol, i) => { const uid = pol + i; players[uid] = {uid, name: pol.toUpperCase() + i, seatIndex: i, stack, bet: 0, status: "active", isBot: pol !== "human" && pol !== "station" && pol !== "maniac", cards: [], cardCount: 0, buyTotal: stack, policy: pol}; });
  return {id: "bench", settings: {blinds, baseGameType: "NLH", rakePercent: 0, actionTime: 30, spinMode: !!spin, runTwice: false}, players, gameState: {phase: "waiting"}, table: {clubId: "main", history: [], handCount: 0}, raw: {}, priv: {}, deck: null, now: 1700000000000, effects: []};
}

/* ---------- 1) Spin-like SNG: 3 seats, 1000 chips, blinds double every 12 hands ---------- */
function sng(seats) {
  const S = mkState(seats, 1000, 10, true);
  let hands = 0, lvl = 1;
  while (hands < 400) {
    S._lvlMult = lvl; S.settings.blinds = 10 * lvl;
    Object.values(S.players).forEach((p) => { if (p.status === "busted" || p.stack <= 0) { p.status = "out"; } else if (p.status !== "out") p.status = "active"; });
    const alive = Object.values(S.players).filter((p) => p.status !== "out" && p.stack > 0);
    if (alive.length <= 1) return alive[0] ? alive[0].policy : null;
    if (!playHand(S)) return null;
    hands++;
    if (hands % 12 === 0) lvl = Math.min(lvl * 2, 64);
  }
  const best = Object.values(S.players).sort((a, b) => b.stack - a.stack)[0];
  return best.policy;
}
function runSng(label, seats, n) {
  const wins = {}; const t0 = Date.now();
  for (let i = 0; i < n; i++) { const w = sng(seats.slice().sort(() => rnd() - 0.5)); if (w) wins[w] = (wins[w] || 0) + 1; }
  const tot = Object.values(wins).reduce((a, b) => a + b, 0) || 1;
  const parts = Object.keys(wins).sort().map((k) => `${k}: ${(wins[k] / tot * 100).toFixed(0)}%`);
  console.log(`SNG ${label} (${n} games, ${((Date.now() - t0) / 1000).toFixed(0)}s): ${parts.join("  ")}`);
  return wins;
}

/* ---------- 2) Heads-up cash: 100bb, rebuy when short; bb/100 per policy ---------- */
function cash(seats, hands) {
  const S = mkState(seats, 200, 1, false);
  const net = {}; seats.forEach((p) => net[p] = 0);
  const start = {}; Object.values(S.players).forEach((p) => start[p.uid] = p.stack);
  let played = 0;
  while (played < hands) {
    Object.values(S.players).forEach((p) => {
      if (p.stack < 50) { net[p.policy] += p.stack - start[p.uid]; p.stack = 200; start[p.uid] = 200; }
      if (p.stack > 500) { net[p.policy] += p.stack - start[p.uid]; p.stack = 200; start[p.uid] = 200; }
      p.status = "active";
    });
    if (!playHand(S)) break;
    played++;
  }
  Object.values(S.players).forEach((p) => { net[p.policy] += p.stack - start[p.uid]; });
  return {net, played};
}
function runCash(label, seats, hands) {
  const t0 = Date.now();
  const {net, played} = cash(seats, hands);
  const parts = Object.keys(net).map((k) => `${k}: ${(net[k] / 2 / played * 100).toFixed(1)} bb/100`); // bb = 2 chips
  console.log(`CASH ${label} (${played} hands, ${((Date.now() - t0) / 1000).toFixed(0)}s): ${parts.join("  ")}`);
}

console.log(`bot bench — brain v${B.VERSION}, budget ${BUDGET}ms/decision\n`);
runCash("v2 vs human", ["v2", "human"], CASH_HANDS);
runCash("legacy vs human", ["legacy", "human"], CASH_HANDS);
runCash("v2 vs legacy", ["v2", "legacy"], CASH_HANDS);
runCash("v2 vs station", ["v2", "station"], Math.floor(CASH_HANDS / 2));
runCash("v2 vs maniac", ["v2", "maniac"], Math.floor(CASH_HANDS / 2));
console.log("");
runSng("human + 2×v2", ["human", "v2", "v2"], SNGS);
runSng("human + 2×legacy", ["human", "legacy", "legacy"], SNGS);
runSng("v2 + 2×legacy", ["v2", "legacy", "legacy"], SNGS);
