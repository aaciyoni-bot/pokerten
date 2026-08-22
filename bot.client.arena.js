/**
 * The cash tables run the brain that lives in index.html, not the one in
 * functions/. This runs THAT brain — extracted from index.html so it cannot
 * drift — through the same arena, so "the bots are smarter" is a number for
 * the tables the owner actually plays on.
 *
 * Run: node bot.client.arena.js [hands] [opponent]
 */
"use strict";
const fs = require("fs");
const assert = require("assert");
const E = require("./functions/pokerEngine").__engineInternals;
const C = require("./functions/pokerCore");

const html = fs.readFileSync(process.env.RK_HTML || (__dirname + "/index.html"), "utf8");
const cut = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `could not find ${from}`);
  return html.slice(a, b);
};
const brainSrc = cut("const deckWithout = known =>", "const simRealEquity =");
const clientBrain = new Function("pokerDeck", "bestScoreFull", "round2", "GAME_CARDS",
  brainSrc + "\nreturn botPokerMove;")(C.pokerDeck, C.bestScoreFull, C.round2, C.GAME_CARDS);

const HANDS = Number(process.argv[2]) || 600;
const OPP = process.argv[3] || "nit";
const SEATS = 6; const BB = 1; const START = 100;

let seed = 424242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// the client brain speaks (gameState, table, botSeat) and answers {type, amt}
const hero = (S, uid) => {
  const t = {settings: S.settings, players: S.players};
  const b = {...S.players[uid], cards: (S.priv && S.priv[uid]) || []};
  const mv = clientBrain(S.gameState, t, b) || {type: "call"};
  if (mv.type === "raise" && mv.amt > (b.bet || 0) + 0.001 && mv.amt > S.gameState.highestBet) {
    return {action: "raise", amount: C.round2(mv.amt)};
  }
  return {action: mv.type === "raise" ? "call" : mv.type};
};

const nit = (S, uid) => {
  const g = S.gameState; const b = S.players[uid];
  const cards = (S.priv && S.priv[uid]) || [];
  const toCall = C.round2(Math.max(0, g.highestBet - (b.bet || 0)));
  const RV = {2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14};
  const vs = cards.map((c) => RV[c.val] || 0).sort((a, b2) => b2 - a);
  const premium = cards.length === 2 && (vs[0] === vs[1] ? vs[0] >= 10 : vs[0] === 14 && vs[1] >= 12);
  if (g.phase === "preflop") {
    if (!premium) return toCall > 0 ? {action: "fold"} : {action: "call"};
    return {action: "raise", amount: C.round2(g.highestBet + 3 * BB)};
  }
  const eq = E.equityOf(cards, g.board || [], 1, "NLH", 1);
  if (toCall <= 0) return (eq || 0) > 0.8 ? {action: "raise", amount: C.round2(g.highestBet + 3 * BB)} : {action: "call"};
  return (eq || 0) > 0.85 ? {action: "call"} : {action: "fold"};
};
const station = () => ({action: "call"});
const BRAINS = {hero, nit, station};

const mk = (uid, seatIndex) => ({uid, name: uid, seatIndex, stack: START, bet: 0,
  status: "active", isBot: true, cards: [], cardCount: 0, buyTotal: START});
const S = {
  id: "arena", settings: {blinds: BB / 2, baseGameType: "NLH", rakePercent: 0, actionTime: 30, maxPlayers: SEATS},
  players: {}, gameState: {phase: "waiting"},
  table: {clubId: "main", history: [], handCount: 0},
  raw: {}, priv: {}, deck: null, now: 1700000000000, effects: [],
};
for (let i = 0; i < SEATS; i++) S.players["u" + i] = mk("u" + i, i);
const seatBrain = [];
for (let i = 0; i < SEATS; i++) seatBrain.push(i % 2 === 0 ? "hero" : OPP);

const won = {};
Object.keys(S.players).forEach((u) => { won[u] = 0; });
let dealt = 0;
for (let h = 0; h < HANDS; h++) {
  Object.values(S.players).forEach((p) => {
    p.stack = START; p.bet = 0; p.status = "active"; p.cards = []; p.buyTotal = START;
  });
  S.gameState = {phase: "waiting", dealerUid: "u" + (h % SEATS)};
  S.priv = {}; S.effects = []; S.now += 20000;
  if (E.startHand(S) !== "dealt") continue;
  dealt++;
  let guard = 0;
  while (S.gameState.phase !== "showdown" && guard++ < 300) {
    const uid = S.gameState.activeTurnUid;
    if (!uid) { E.advancePhase(S); continue; }
    const p = S.players[uid];
    if (!p) { E.advancePhase(S); continue; }
    let mv;
    try { mv = BRAINS[seatBrain[p.seatIndex]](S, uid) || {action: "call"}; } catch (e) { mv = {action: "call"}; }
    E.applyAction(S, uid, mv.action, mv.amount, false);
  }
  Object.values(S.players).forEach((p) => { won[p.uid] += (p.stack + (p.bet || 0)) - START; });
}

const byBrain = {};
Object.values(S.players).forEach((p) => {
  const n = seatBrain[p.seatIndex];
  byBrain[n] = byBrain[n] || {chips: 0, seats: 0};
  byBrain[n].chips += won[p.uid];
  byBrain[n].seats++;
});
console.log(`client brain (index.html) vs ${OPP} — ${dealt} hands\n`);
Object.entries(byBrain).forEach(([n, v]) => {
  const bb100 = (v.chips / v.seats) / dealt / BB * 100;
  console.log(`  ${n.padEnd(9)} ${v.seats} seats   ${bb100 >= 0 ? "+" : ""}${bb100.toFixed(1)} bb/100`);
});
