/**
 * The two rules a poker bot may never break, asserted against BOTH brains —
 * the one in index.html that cash tables run, and the one in
 * functions/pokerEngine.js that the server engine runs.
 *
 *   1. Sizing comes from the POT. "The pot is 1000 and it bets 1" must be
 *      impossible: any raise either adds at least a quarter of the pot, or is
 *      an all-in, or is not made at all.
 *   2. No pair, no draw, no big pot. A hand with neither a made pair nor a
 *      real draw never puts 40%+ of a stack in — that is the hand that goes
 *      all-in with nothing and then catches runner-runner.
 *
 * Run: node bot.rules.test.js
 */
"use strict";
const fs = require("fs");
const assert = require("assert");
const C = require("./functions/pokerCore");
const E = require("./functions/pokerEngine").__engineInternals;

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const cut = (a, b) => {
  const i = html.indexOf(a); const j = html.indexOf(b, i);
  assert.ok(i >= 0 && j > i, "could not find " + a);
  return html.slice(i, j);
};
const clientBrain = new Function("pokerDeck", "bestScoreFull", "round2", "GAME_CARDS",
  cut("const deckWithout = known =>", "const simRealEquity =") + "\nreturn botPokerMove;")(
  C.pokerDeck, C.bestScoreFull, C.round2, C.GAME_CARDS);

const card = (val, suit) => ({val, suit, id: val + suit});
let pass = 0; let fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("PASS  " + name); } else { fail++; console.log("FAIL  " + name + (extra ? "  " + extra : "")); }
};

/* Both brains asked the same question, answering {kind, to} where `to` is the
   total bet the seat would have out after acting. */
const askClient = (board, mine, potAmt, oppBet, stack) => {
  const g = {phase: board.length === 5 ? "river" : board.length === 4 ? "turn" : "flop",
    board, pots: [{amount: potAmt, eligible: []}], highestBet: oppBet, minRaise: 1,
    currentGameType: "NLH", handBB: 1, activeTurnUid: "me"};
  const t = {settings: {blinds: 0.5}, players: {
    me: {uid: "me", status: "active", bet: 0, stack},
    opp: {uid: "opp", status: "active", bet: oppBet, stack: 9999}}};
  const mv = clientBrain(g, t, {uid: "me", status: "active", bet: 0, stack, cards: mine}) || {type: "call"};
  return {kind: mv.type, to: mv.type === "raise" ? mv.amt : oppBet};
};
const askServer = (board, mine, potAmt, oppBet, stack) => {
  const S = {id: "t", settings: {blinds: 0.5, baseGameType: "NLH", maxPlayers: 6},
    players: {me: {uid: "me", seatIndex: 0, status: "active", bet: 0, stack, isBot: true},
      opp: {uid: "opp", seatIndex: 1, status: "active", bet: oppBet, stack: 9999, isBot: true}},
    gameState: {phase: board.length === 5 ? "river" : board.length === 4 ? "turn" : "flop",
      board, pots: [{amount: potAmt, eligible: []}], highestBet: oppBet, minRaise: 1,
      currentGameType: "NLH", activeTurnUid: "me"},
    priv: {me: mine}, table: {}, raw: {}, effects: [], now: 17e11};
  const mv = E.botAction(S, "me") || {action: "call"};
  return {kind: mv.action, to: mv.action === "raise" ? mv.amount : oppBet};
};
const BRAINS = [["client (index.html)", askClient], ["server (pokerEngine)", askServer]];

/* --- rule 1: a token raise into a big pot is impossible ------------------ */
{
  const board = [card("Q", "♠"), card("J", "♠"), card("2", "♦"), card("7", "♣")];
  const hands = [
    ["a monster", [card("A", "♠"), card("K", "♠")]],
    ["top pair", [card("Q", "♥"), card("J", "♦")]],
    ["nothing", [card("5", "♥"), card("4", "♦")]],
  ];
  BRAINS.forEach(([name, ask]) => {
    let worst = null;
    hands.forEach(([label, mine]) => {
      for (let i = 0; i < 300; i++) {
        const mv = ask(board, mine, 1000, 1, 5000);
        if (mv.kind !== "raise") continue;
        const added = mv.to - 1;                    // on top of the 1 he bet
        const allIn = mv.to >= 5000 - 0.01;
        if (!allIn && added < 1001 * 0.25 && (worst === null || added < worst.added)) {
          worst = {label, added, to: mv.to};
        }
      }
    });
    check(`${name}: never raises to a token amount (pot 1000, he bet 1)`, worst === null,
      worst ? `raised to ${worst.to} with ${worst.label}` : "");
  });
}

/* --- rule 2: no pair, no draw, no big pot -------------------------------- */
{
  // rainbow, disconnected board; 5-4 offsuit has no pair, no straight draw,
  // no flush draw — the definition of a hand with no business in a big pot.
  const board = [card("K", "♠"), card("9", "♦"), card("2", "♣")];
  const mine = [card("5", "♥"), card("4", "♦")];
  BRAINS.forEach(([name, ask]) => {
    let commits = 0;
    for (let i = 0; i < 300; i++) {
      const mv = ask(board, mine, 60, 80, 100);      // he bets 80 of our 100
      if (mv.kind !== "fold") commits++;
    }
    check(`${name}: folds no-pair-no-draw facing 80% of its stack`, commits === 0,
      `committed ${commits}/300 times`);
  });
  // ...but a real draw is allowed to continue: same board with a flush draw
  const drawBoard = [card("K", "♠"), card("9", "♠"), card("2", "♣")];
  const drawHand = [card("7", "♠"), card("6", "♠")];
  BRAINS.forEach(([name, ask]) => {
    let played = 0;
    for (let i = 0; i < 300; i++) {
      const mv = ask(drawBoard, drawHand, 200, 60, 150);
      if (mv.kind !== "fold") played++;
    }
    check(`${name}: a flush draw is still allowed to play`, played > 0, `folded all 300`);
  });
}

/* --- rule 3: the god guard, and the line it must never cross ------------- */
{
  // Turn: A K 9 4 rainbow. The bot holds KQ — a real pair, so the "no pair no
  // draw" rule alone would let it play. The opponent holds AA: the bot is
  // drawing dead. On a bots-only table the guard must see that and fold.
  const board = [card("A", "\u2660"), card("K", "\u2666"), card("9", "\u2663"), card("4", "\u2665")];
  const mine = [card("K", "\u2663"), card("Q", "\u2660")];
  const nuts = [card("A", "\u2665"), card("A", "\u2666")];
  const table = (humanSeated, guard) => {
    const S = {id: "t", settings: {blinds: 0.5, baseGameType: "NLH", maxPlayers: 6,
      ...(guard === undefined ? {} : {botGodGuard: guard})},
    players: {me: {uid: "me", seatIndex: 0, status: "active", bet: 0, stack: 100, isBot: true},
      opp: {uid: "opp", seatIndex: 1, status: "active", bet: 70, stack: 100, isBot: !humanSeated}},
    gameState: {phase: "turn", board, pots: [{amount: 60, eligible: []}], highestBet: 70,
      minRaise: 1, currentGameType: "NLH", activeTurnUid: "me"},
    priv: {me: mine, opp: nuts}, table: {}, raw: {}, effects: [], now: 17e11};
    let folds = 0;
    for (let i = 0; i < 120; i++) {
      const mv = E.botAction(S, "me") || {action: "call"};
      if (mv.action === "fold") folds++;
    }
    return folds;
  };
  check("god guard: bots-only table folds a drawing-dead stack-off", table(false) === 120,
    `folded ${table(false)}/120`);
  // With a human at the table the guard is off — the bot must decide blind,
  // which on this board means it does NOT always fold. If this ever starts
  // folding 120/120 too, a bot is reading a human's cards.
  check("god guard: OFF the moment a human is seated", table(true) < 120,
    `folded ${table(true)}/120 with a human seated — check the botsOnly gate`);
  check("god guard: can be switched off per table", table(false, false) < 120,
    `botGodGuard:false still folded ${table(false, false)}/120`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
