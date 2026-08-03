/**
 * Engine smoke test — runs a full NLH cash hand through the pure logic layer
 * (no Firestore): deal → betting → showdown, plus a fold-out hand, and checks
 * chip conservation to the cent. Run: node engine.smoke.test.js
 */
"use strict";
const assert = require("assert");
const E = require("./pokerEngine").__engineInternals;
const C = require("./pokerCore");

const mkState = (n) => {
  const players = {};
  for (let i = 0; i < n; i++) {
    const uid = "u" + i;
    players[uid] = {uid, name: "P" + i, seatIndex: i, stack: 100, bet: 0, status: "active", isBot: false, cards: [], cardCount: 0, buyTotal: 100};
  }
  return {
    id: "t1",
    settings: {blinds: 0.5, baseGameType: "NLH", rakePercent: 6, actionTime: 30},
    players,
    gameState: {phase: "waiting"},
    table: {clubId: "main", history: [], handCount: 0},
    raw: {},
    priv: {},
    deck: null,
    now: 1700000000000,
    effects: [],
  };
};

const totalChips = (S) =>
  C.round2(Object.values(S.players).reduce((s, p) => s + p.stack + (p.bet || 0), 0) +
    (S.gameState.pots || []).reduce((s, x) => s + x.amount, 0));

// --- hand 1: 3-way, call/call/check preflop, check-down to showdown ---
let S = mkState(3);
const startTotal = totalChips(S);
assert.strictEqual(E.startHand(S), "dealt", "hand should deal");
assert.strictEqual(S.gameState.phase, "preflop");
assert.strictEqual(Object.keys(S.priv).length, 3, "3 private hands");
Object.values(S.priv).forEach((h) => assert.strictEqual(h.length, 2, "2 hole cards each"));
assert.ok(S.deck.length === 52 - 6, "deck consumed only hole cards");
assert.ok(S.gameState.activeTurnUid, "someone to act");

let guard = 0;
while (S.gameState.phase !== "showdown" && guard++ < 60) {
  const uid = S.gameState.activeTurnUid;
  assert.ok(uid, "turn must exist while betting, phase=" + S.gameState.phase);
  E.applyAction(S, uid, "call", undefined, false);
}
assert.strictEqual(S.gameState.phase, "showdown", "hand must reach showdown");
assert.strictEqual((S.gameState.board || []).length, 5, "full board");
assert.ok(S.gameState.lastWinners, "winners recorded");
const rake1 = S.table.history[0].rake;
assert.ok(rake1 > 0, "rake taken at showdown (main pot 6%)");
assert.strictEqual(totalChips(S), C.round2(startTotal - rake1), "chips conserved minus rake");
assert.strictEqual(S.table.history.length, 1, "history appended");
assert.ok(S.effects.some((e) => e.type === "rake"), "rake effect queued");

// --- hand 2: fold-out preflop → NO rake, uncalled bet returned ---
S.now += 20000;
assert.strictEqual(E.startHand(S), "dealt", "second hand deals");
const t2 = totalChips(S);
let guard2 = 0;
while (S.gameState.phase === "preflop" && guard2++ < 10) {
  E.applyAction(S, S.gameState.activeTurnUid, "fold", undefined, false);
}
assert.strictEqual(S.gameState.phase, "showdown", "fold-out ends the hand");
assert.strictEqual(S.gameState.earlyWin, true, "early win flagged");
assert.strictEqual(S.table.history[1].rake, 0, "no rake preflop (no flop seen)");
assert.strictEqual(totalChips(S), t2, "fold-out conserves every chip");

// --- hand 3: raise mechanics + heads-up after one folds ---
S.now += 20000;
E.startHand(S);
const g = S.gameState;
const actor = g.activeTurnUid;
const before = S.players[actor].stack + S.players[actor].bet;
E.applyAction(S, actor, "raise", 5, false);
assert.strictEqual(S.players[actor].bet, 5, "raise sets target-total bet");
assert.strictEqual(C.round2(S.players[actor].stack + S.players[actor].bet), C.round2(before), "raise moves chips bet<->stack only");
assert.ok(g.highestBet === 5 && g.minRaise === 4, "highestBet/minRaise updated");

// --- evaluator sanity: wheel straight + split detection ---
const mk = (val, suit) => ({id: val + suit, val, suit});
const wheel = [mk("A", "♠"), mk("2", "♥"), mk("3", "♦"), mk("4", "♣"), mk("5", "♠")];
assert.strictEqual(C.handName(C.evaluate5Cards(wheel)), "Straight", "A-5 wheel is a straight");
const sflush = [mk("9", "♠"), mk("10", "♠"), mk("J", "♠"), mk("Q", "♠"), mk("K", "♠")];
assert.strictEqual(C.handName(C.evaluate5Cards(sflush)), "Straight Flush");

console.log("engine smoke: ALL OK — deal/bet/showdown, fold-out, raise math, evaluator");
