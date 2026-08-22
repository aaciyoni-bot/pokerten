/**
 * Bot arena — measures whether a bot is actually good, in bb/100.
 *
 * "The bots are dumb" is a feeling; this turns it into a number. Six seats
 * play thousands of real hands through the engine. Every seat can run a
 * different brain, so a change is judged by whether it wins more against the
 * same opposition, not by whether the code reads smarter.
 *
 * Reference opponents (deliberately exploitable, so a decent brain must beat
 * them by a clear margin):
 *   station — calls everything, never folds
 *   nit     — plays only premium hands, folds to any real pressure
 *   maniac  — raises constantly with anything
 *
 * Run: node bot.arena.js [hands] [brainA] [brainB]
 */
"use strict";
const E = require("./pokerEngine").__engineInternals;
const C = require("./pokerCore");

const HANDS = Number(process.argv[2]) || 3000;
const SEATS = 6;
const BB = 1;            // blinds 0.5/1
const START = 100 * BB;  // 100bb stacks, topped back up each hand

let seed = 424242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* ------------------------------ reference brains ------------------------ */
const station = (S, uid) => ({action: "call"});

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
  const eq = E.equityOf(cards, g.board || [], 1, "NLH");
  if (toCall <= 0) return (eq || 0) > 0.8 ? {action: "raise", amount: C.round2(g.highestBet + 3 * BB)} : {action: "call"};
  return (eq || 0) > 0.85 ? {action: "call"} : {action: "fold"};
};

const maniac = (S, uid) => {
  const g = S.gameState; const b = S.players[uid];
  const toCall = C.round2(Math.max(0, g.highestBet - (b.bet || 0)));
  if (rnd() < 0.55) {
    const target = C.round2(Math.min(g.highestBet + (g.minRaise || BB) + BB * 3, b.stack + (b.bet || 0)));
    if (target > g.highestBet) return {action: "raise", amount: target};
  }
  return toCall >= b.stack ? {action: "call"} : {action: "call"};
};

const BRAINS = {hero: E.botAction, station, nit, maniac};

/* ------------------------------ the arena ------------------------------- */
const seatBrain = [];           // brain name per seat
const NAME_A = process.argv[3] || "hero";
const NAME_B = process.argv[4] || "station";
for (let i = 0; i < SEATS; i++) seatBrain.push(i % 2 === 0 ? NAME_A : NAME_B);

const mk = (uid, seatIndex) => ({uid, name: uid, seatIndex, stack: START, bet: 0,
  status: "active", isBot: true, cards: [], cardCount: 0, buyTotal: START});

const S = {
  id: "arena",
  settings: {blinds: BB / 2, baseGameType: "NLH", rakePercent: 0, actionTime: 30, maxPlayers: SEATS},
  players: {}, gameState: {phase: "waiting"},
  table: {clubId: "main", history: [], handCount: 0},
  raw: {}, priv: {}, deck: null, now: 1700000000000, effects: [],
};
for (let i = 0; i < SEATS; i++) S.players["u" + i] = mk("u" + i, i);

const won = {};                 // net chips per seat, across all hands
Object.keys(S.players).forEach((u) => { won[u] = 0; });

let dealt = 0; let handsWithAction = 0;
for (let h = 0; h < HANDS; h++) {
  // fresh 100bb in front of everyone: we are measuring decisions, not variance
  // in stack depth, and nobody should ever be short or absent.
  Object.values(S.players).forEach((p) => {
    p.stack = START; p.bet = 0; p.status = "active"; p.cards = []; p.buyTotal = START;
  });
  S.gameState = {phase: "waiting"};
  S.priv = {}; S.effects = []; S.now += 20000;
  // rotate the button so position is shared out evenly
  S.gameState.dealerUid = "u" + (h % SEATS);

  if (E.startHand(S) !== "dealt") continue;
  dealt++;
  let guard = 0; let acted = 0;
  while (S.gameState.phase !== "showdown" && guard++ < 300) {
    const uid = S.gameState.activeTurnUid;
    if (!uid) { E.advancePhase(S); continue; }
    const p = S.players[uid];
    if (!p) { E.advancePhase(S); continue; }
    const brain = BRAINS[seatBrain[p.seatIndex]];
    let mv;
    try { mv = brain(S, uid) || {action: "call"}; } catch (e) { mv = {action: "call"}; }
    E.applyAction(S, uid, mv.action, mv.amount, false);
    acted++;
  }
  if (acted > SEATS) handsWithAction++;
  Object.values(S.players).forEach((p) => { won[p.uid] += (p.stack + (p.bet || 0)) - START; });
}

/* ------------------------------ the verdict ----------------------------- */
const byBrain = {};
Object.values(S.players).forEach((p) => {
  const n = seatBrain[p.seatIndex];
  byBrain[n] = byBrain[n] || {chips: 0, seats: 0};
  byBrain[n].chips += won[p.uid];
  byBrain[n].seats++;
});
console.log(`${dealt} hands dealt, ${handsWithAction} with post-blind action, ${SEATS} seats\n`);
Object.entries(byBrain).forEach(([n, v]) => {
  const handsPerSeat = dealt;                    // every seat sees every hand
  const bb100 = (v.chips / v.seats) / handsPerSeat / BB * 100;
  console.log(`  ${n.padEnd(9)} ${v.seats} seats   net ${v.chips.toFixed(0).padStart(8)}bb   ${bb100 >= 0 ? "+" : ""}${bb100.toFixed(1)} bb/100`);
});
const names = Object.keys(byBrain);
if (names.length === 2) {
  const [a, b] = names.map((n) => (byBrain[n].chips / byBrain[n].seats) / dealt / BB * 100);
  console.log(`\n  ${names[0]} beats ${names[1]} by ${(a - b).toFixed(1)} bb/100`);
}
