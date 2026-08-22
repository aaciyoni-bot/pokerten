/**
 * PokerTen — server-authoritative poker engine (cash + Spin & Cash).
 *
 * The server deals, counts and pays; clients only send requests and render.
 * Protocol + behavior are a faithful port of the client engine in index.html
 * (line refs per block). Tournaments stay on the client engine for now
 * (index.html:15633 hardcodes serverEngine:false for them) and are rejected.
 *
 * State layout:
 *   tables/{id}                 — public doc (no deck, no live hole cards)
 *   tables/{id}/priv/{uid}      — {cards: Card[]} readable only by that uid
 *   tables/{id}/priv/_engine    — {deck: Card[]} server-only
 *
 * Every game mutation runs in a Firestore transaction over these docs, so
 * concurrent pkTick callers (every viewer, ~4s) collapse to one winner.
 */
"use strict";

const crypto = require("crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {getFirestore} = require("firebase-admin/firestore");
const C = require("./pokerCore");
const round2 = C.round2;

let _db = null;
const db = () => (_db = _db || getFirestore());

// index.html:1048-1049 — keep in sync with the client list.
const GOD_EMAILS = ["aaci.yoni@gmail.com", "info.bagso@gmail.com", "avi057278@gmail.com", "khnby749@gmail.com", "bykhn3234@gmail.com", "easymarcelos@gmail.com"];
const SUPER_ADMIN_EMAIL = "aaci.yoni@gmail.com";
const isGodEmail = (e) => GOD_EMAILS.includes(String(e || "").toLowerCase().trim());

const BETTING = ["preflop", "flop", "turn", "river"]; // index.html:8951
const rnd = () => crypto.randomInt(0, 1000000) / 1000000; // CSPRNG in [0,1)

// CSPRNG Fisher–Yates over the client's deck builder (index.html:2114-2126).
function shuffledDeck() {
  const deck = [];
  for (const suit of C.SUITS) {
    for (const val of C.CARD_VALUES) deck.push({id: `${val}${suit}`, val, suit});
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ============================ pure game logic ============================
 * S = { settings, players, gameState, table, priv, deck, now }
 *   table: the remaining top-level doc fields we touch (spin*, history, handCount, clubId)
 *   priv:  {uid: Card[]} hole cards (server truth)
 * Transforms mutate S and push side-effects into S.effects:
 *   {type:'credit', uid, amount, fields?}          — membership wallet credit
 *   {type:'gameLog', entries:[{uid,username,profit,rake}]}
 *   {type:'rake', rake, uids}                      — distributeRake port
 * ======================================================================= */

const activesOf = (pl) => Object.values(pl).filter((p) => p.status === "active").sort((a, b) => a.seatIndex - b.seatIndex);
const bbOf = (settings) => (Number(settings.blinds) || 0.5) * 2;
const clonePlayers = (pl) => {
  const out = {};
  Object.entries(pl || {}).forEach(([k, p]) => out[k] = {...p, cards: [...(p.cards || [])]});
  return out;
};

// Spin blind escalation: no client timer exists (index.html §10), so the
// server doubles blinds every spinLevelSec from spinStartAt, capped at 2^12.
function spinLevel(S) {
  if (!S.settings.spinMode || !S.table.spinStartAt) return 0;
  const per = Math.max(30, Number(S.settings.spinLevelSec) || 180) * 1000;
  return Math.min(12, Math.max(0, Math.floor((S.now - S.table.spinStartAt) / per)));
}
function blindsOf(S) {
  const base = Number(S.settings.blinds) || 0.5;
  const sb = S.settings.spinMode ? round2(base * Math.pow(2, spinLevel(S))) : base;
  return {sb, bb: round2(sb * 2)};
}

// index.html:9067-9073
function firstAfterDealer(S) {
  const acts = activesOf(S.players).filter((p) => p.stack > 0);
  if (!acts.length) return null;
  const dealer = S.players[S.gameState.dealerUid];
  const dSeat = dealer ? dealer.seatIndex : -1;
  const after = acts.filter((p) => p.seatIndex > dSeat).concat(acts.filter((p) => p.seatIndex <= dSeat));
  return after[0] ? after[0].uid : null;
}

// startHand port — index.html:9494-9563. Returns 'dealt'|'dc'|'waiting'.
function startHand(S, forcedGameType) {
  const g0 = S.gameState || {};
  const pl = clonePlayers(S.players);
  Object.values(pl).forEach((p) => {
    if (p.sitOutNext) {
      p.sitOut = true;
      p.sitOutAt = S.now;
      p.sitAuto = false;
      p.sitOutNext = false;
    }
    if (p.leaveReq && !S.table.tournamentId) p.sitOut = true;
    p.cards = [];
    p.cardCount = 0;
    p.bet = 0;
    p.actionText = "";
    p.hasActed = false;
    p.reveal = false;
    p.status = p.stack > 0 ?
      (p.sitOut && !S.table.tournamentId ? "sitout" : "active") :
      (["busted", "out"].includes(p.status) ? p.status : "sitout");
  });
  S.players = pl;
  S.priv = {}; // fresh hands only for this hand's actives
  const actives = activesOf(pl);
  if (actives.length < 2) {
    S.gameState = {...g0, phase: "waiting", activeTurnUid: null, turnStartedAt: null, board: [], pots: [], allInReveal: false, earlyWin: false, ritOffer: null, ritAgree: null, board2: null, rabbit: null};
    return "waiting";
  }
  const uids = actives.map((p) => p.uid);
  const dealerUid = uids[(uids.indexOf(g0.dealerUid) + 1) % uids.length];
  let dcUid = g0.dcUid || null;
  let dcAnchor = g0.dcAnchor || null;
  if (S.settings.isDealerChoice) { // index.html:9534-9544
    const n = uids.length;
    if (!dcUid || !dcAnchor || !uids.includes(dcUid) || !uids.includes(dcAnchor)) {
      dcAnchor = dealerUid;
      dcUid = uids[(uids.indexOf(dealerUid) - 1 + n) % n];
    } else if (dealerUid === dcAnchor) {
      dcUid = uids[(uids.indexOf(dcUid) - 1 + n) % n];
    }
  } else {
    dcUid = null;
    dcAnchor = null;
  }
  S.gameState = {...g0, dealerUid, dcUid, dcAnchor, board: [], pots: [], lastWinners: null, lastWinAmount: 0, allInReveal: false, earlyWin: false, ritOffer: null, ritAgree: null, board2: null, rabbit: null};
  if (S.settings.isDealerChoice && dealerUid === dcUid) {
    S.gameState.phase = "dc_selection";
    S.gameState.activeTurnUid = null;
    S.gameState.turnStartedAt = S.now;
    return "dc";
  }
  const gt = forcedGameType || (S.settings.isDealerChoice ? (S.gameState.currentGameType || S.settings.baseGameType) : S.settings.baseGameType) || "NLH";
  executeDeal(S, gt);
  return "dealt";
}

// executeDeal port — index.html:9380-9468.
function executeDeal(S, gameType) {
  const pl = S.players;
  const {sb: sbAmt, bb: bbAmt} = blindsOf(S);
  // pending top-ups first (index.html:9385-9392)
  const maxBuy = Math.max(Number(S.settings.maxBuyIn) || 0, (Number(S.settings.maxBuyInBB) || 0) * bbAmt);
  Object.values(pl).forEach((p) => {
    if (["busted", "out"].includes(p.status) || !(p.pendingTopUp > 0)) return;
    const room = maxBuy > 0 ? Math.max(0, round2(maxBuy - p.stack)) : round2(p.pendingTopUp);
    const add = Math.min(round2(p.pendingTopUp), room);
    p.stack = round2(p.stack + add);
    p.pendingTopUp = 0;
  });
  const actives = activesOf(pl);
  const deck = shuffledDeck();
  const n = C.GAME_CARDS[gameType] || 2;
  actives.forEach((p) => {
    const hand = C.sortHoleCards(deck.splice(0, n)); // FRONT of the deck (index.html:9396)
    S.priv[p.uid] = hand;
    p.cards = []; // never public
    p.cardCount = n;
    p.bet = 0;
    p.hasActed = false;
    p.actionText = "";
  });
  S.table.handCount = (Number(S.table.handCount) || 0) + 1;
  const bombOn = Number(S.settings.bombEvery) > 0 && S.table.handCount % Number(S.settings.bombEvery) === 0;
  const aofN = S.settings.aofEvery === "orbit" ? actives.length : Number(S.settings.aofEvery) || 0;
  const aofOn = aofN > 0 && S.table.handCount % aofN === 0;
  // antes (index.html:9411-9416); bomb pot uses bombAnte×BB from everyone instead
  const anteAmt = bombOn ? round2((Number(S.settings.bombAnte) || 2) * bbAmt) : round2(Number(S.settings.ante) || 0);
  let anteTotal = 0;
  if (anteAmt > 0) {
    actives.forEach((p) => {
      const pay = Math.min(anteAmt, p.stack);
      p.stack = round2(p.stack - pay);
      anteTotal = round2(anteTotal + pay);
    });
  }
  const g = S.gameState;
  g.currentGameType = gameType;
  g.board = [];
  g.pots = anteTotal > 0 ? [{amount: anteTotal, eligible: actives.map((p) => p.uid)}] : [];
  g.bombPot = !!bombOn;
  g.aof = !!aofOn;
  g.tourLevel = S.settings.spinMode ? spinLevel(S) : 0;
  g.lastWinners = null;
  g.lastWinAmount = 0;
  g.allInReveal = false;
  g.earlyWin = false;
  g.rabbit = null;
  g.board2 = null;
  g.ritOffer = null;
  g.ritAgree = null;
  if (bombOn) {
    // Bomb pot: everyone antes, no preflop betting — straight to the flop.
    deck.pop();
    g.board = [deck.pop(), deck.pop(), deck.pop()];
    g.highestBet = 0;
    g.minRaise = bbAmt;
    g.phase = gameType === "Pineapple" ? "discard" : "flop";
    g.activeTurnUid = g.phase === "flop" ? firstAfterDealerIn(pl, g) : null;
    g.turnStartedAt = S.now;
    S.deck = deck;
    return;
  }
  // positions (index.html:9417-9429)
  const dIdx = Math.max(0, actives.findIndex((p) => p.uid === g.dealerUid));
  let sbP;
  let bbP;
  let utgIdx;
  if (actives.length === 2) {
    sbP = actives[dIdx];
    bbP = actives[(dIdx + 1) % 2];
    utgIdx = dIdx; // dealer/SB acts first heads-up preflop
  } else {
    sbP = actives[(dIdx + 1) % actives.length];
    bbP = actives[(dIdx + 2) % actives.length];
    utgIdx = (dIdx + 3) % actives.length;
  }
  const post = (p, amt, label) => { // index.html:9430-9435 — ASSIGNS bet (ante already potted)
    const pay = Math.min(amt, p.stack);
    p.stack = round2(p.stack - pay);
    p.bet = round2(pay);
    p.actionText = label;
  };
  post(sbP, sbAmt, "SB");
  post(bbP, bbAmt, "BB");
  let high = bbAmt;
  let minR = bbAmt;
  let firstUid = actives[utgIdx].uid;
  const utgP = actives[utgIdx];
  if (!S.settings.spinMode && S.settings.straddle && actives.length >= 3 && utgP && S.players[utgP.uid] && S.players[utgP.uid].straddleNext && utgP.stack > bbAmt * 2) {
    post(utgP, round2(bbAmt * 2), "Straddle");
    high = minR = round2(bbAmt * 2);
    firstUid = actives[(utgIdx + 1) % actives.length].uid;
  }
  g.highestBet = high;
  g.minRaise = minR;
  g.phase = "preflop";
  g.handN = (Number(g.handN) || 0) + 1; // hand counter — client keys the deal animation off it
  g.activeTurnUid = firstUid;
  g.turnStartedAt = S.now;
  S.deck = deck;
}

function firstAfterDealerIn(pl, g) {
  const acts = Object.values(pl).filter((p) => p.status === "active" && p.stack > 0).sort((a, b) => a.seatIndex - b.seatIndex);
  if (!acts.length) return null;
  const dealer = pl[g.dealerUid];
  const dSeat = dealer ? dealer.seatIndex : -1;
  const after = acts.filter((p) => p.seatIndex > dSeat).concat(acts.filter((p) => p.seatIndex <= dSeat));
  return after[0] ? after[0].uid : null;
}

// performAction port — index.html:9303-9379. Throws HttpsError on bad input.
function applyAction(S, actorUid, action, amount, auto) {
  const g = S.gameState;
  const pl = S.players;
  if (!BETTING.includes(g.phase)) throw new HttpsError("failed-precondition", "No betting now");
  if (g.activeTurnUid !== actorUid) throw new HttpsError("failed-precondition", "Not your turn");
  const p = pl[actorUid];
  if (!p || p.status !== "active") throw new HttpsError("failed-precondition", "You are not in the hand");
  p.missed = auto ? (p.missed || 0) + 1 : 0;
  if (auto && p.missed >= 2 && !p.sitOut && !p.sitOutNext) {
    p.sitOutNext = true;
    p.sitAuto = true;
  }
  if (action === "fold") {
    p.status = "folded";
    p.actionText = "Fold";
    p.hasActed = true;
  } else if (action === "call") {
    const toCall = round2(Math.max(0, g.highestBet - (p.bet || 0)));
    const pay = Math.min(toCall, p.stack);
    p.stack = round2(p.stack - pay);
    p.bet = round2((p.bet || 0) + pay);
    p.actionText = pay > 0 ? (p.stack === 0 ? "All-in" : "Call") : "Check";
    p.hasActed = true;
  } else if (action === "raise") {
    const maxT = round2((p.bet || 0) + p.stack);
    let target = Math.min(round2(Number(amount) || 0), maxT);
    if ((g.currentGameType || "").startsWith("Omaha") && S.settings.omahaPotLimit !== false) {
      const toCallP = round2(Math.max(0, g.highestBet - (p.bet || 0)));
      const potNow = round2((g.pots || []).reduce((s, x) => s + x.amount, 0) + Object.values(pl).reduce((s, q) => s + (q.bet || 0), 0));
      target = Math.min(target, round2(g.highestBet + potNow + toCallP));
    }
    const minT = round2(g.highestBet + g.minRaise);
    if (target < minT) target = Math.min(minT, maxT);
    const add = round2(target - (p.bet || 0));
    if (add <= 0) throw new HttpsError("failed-precondition", "Raise too small");
    p.stack = round2(p.stack - add);
    p.bet = target;
    if (target > g.highestBet) {
      g.minRaise = Math.max(g.minRaise, round2(target - g.highestBet));
      g.highestBet = target;
      Object.values(pl).forEach((q) => {
        if (q.uid !== actorUid && q.status === "active" && q.stack > 0) q.hasActed = false;
      });
    }
    p.actionText = p.stack === 0 ? "All-in" : "Raise";
    p.hasActed = true;
  } else {
    throw new HttpsError("invalid-argument", "Unknown action");
  }
  afterAction(S, actorUid);
}

// index.html:9352-9378 — fold-out check, then turn advance / round close.
function afterAction(S, actorUid) {
  const g = S.gameState;
  const pl = S.players;
  const actives = activesOf(pl);
  if (actives.length === 1) {
    finishEarlyWin(S, actives[0].uid);
    return;
  }
  const actorSeat = pl[actorUid] ? pl[actorUid].seatIndex : -1;
  const order = actives;
  const after = order.filter((q) => q.seatIndex > actorSeat).concat(order.filter((q) => q.seatIndex <= actorSeat && q.uid !== actorUid));
  const next = after.find((q) => q.stack > 0 && (!q.hasActed || (q.bet || 0) < g.highestBet));
  if (next) {
    g.activeTurnUid = next.uid;
    g.turnStartedAt = S.now;
    return;
  }
  g.activeTurnUid = null;
  if (actives.length > 1 && actives.filter((q) => q.stack > 0).length < 2) {
    g.allInReveal = true;
    revealActiveHands(S);
    maybeOfferRit(S);
    g.turnStartedAt = S.now; // runout pacing stamp — pkTick advances streets
    return;
  }
  advancePhase(S);
}

// On all-in reveal / showdown the live hands go public (index.html §4.1).
function revealActiveHands(S) {
  activesOf(S.players).forEach((p) => {
    if (S.priv[p.uid]) p.cards = [...S.priv[p.uid]];
  });
}

// Run-it-twice offer — protocol §3.5. Only when the board is incomplete.
function maybeOfferRit(S) {
  const g = S.gameState;
  if (!S.settings.runTwice || S.table.tournamentId) return;
  if ((g.board || []).length >= 5) return;
  const acts = activesOf(S.players);
  if (acts.length < 2) return;
  g.ritOffer = {until: S.now + 10000};
  g.ritAgree = {};
}
function resolveRitIfDue(S) {
  const g = S.gameState;
  if (!g.ritOffer) return false;
  const acts = activesOf(S.players);
  const votes = g.ritAgree || {};
  const allVoted = acts.every((p) => votes[p.uid] !== undefined);
  if (!allVoted && S.now < g.ritOffer.until) return false; // still open
  const agreed = acts.length >= 2 && acts.every((p) => votes[p.uid] === true);
  g.ritOffer = null;
  if (agreed) g.board2 = [...(g.board || [])];
  return true;
}

// advancePhase port — index.html:9230-9283. One street per call.
function advancePhase(S) {
  const g = S.gameState;
  const pl = S.players;
  C.gatherBetsToPots(g, pl);
  g.highestBet = 0;
  g.minRaise = bbOf(S.settings);
  Object.values(pl).forEach((p) => {
    if (p.status === "active") {
      p.hasActed = false;
      if (p.actionText !== "All-in") p.actionText = "";
    }
  });
  const deck = S.deck;
  const dealTwin = (cnt) => { // second board runs out in lockstep (RIT)
    if (!g.board2) return;
    deck.pop();
    for (let i = 0; i < cnt; i++) g.board2.push(deck.pop());
  };
  if (g.phase === "preflop") {
    deck.pop();
    g.board = [deck.pop(), deck.pop(), deck.pop()];
    dealTwin(3);
    if (g.currentGameType === "Pineapple") {
      g.phase = "discard";
      g.activeTurnUid = null;
      g.turnStartedAt = S.now;
      if (g.allInReveal) autoDiscardAll(S); // no one can act in a runout
      return;
    }
    g.phase = "flop";
  } else if (g.phase === "flop") {
    deck.pop();
    g.board = [...g.board, deck.pop()];
    dealTwin(1);
    g.phase = "turn";
  } else if (g.phase === "turn") {
    deck.pop();
    g.board = [...g.board, deck.pop()];
    dealTwin(1);
    g.phase = "river";
  } else if (g.phase === "river") {
    runShowdown(S);
    return;
  } else {
    return;
  }
  const actors = activesOf(pl).filter((p) => p.stack > 0);
  if (actors.length < 2) {
    g.allInReveal = true;
    revealActiveHands(S);
    g.activeTurnUid = null;
    g.turnStartedAt = S.now; // pacing stamp for the next street
  } else {
    g.activeTurnUid = firstAfterDealerIn(pl, g);
    g.turnStartedAt = S.now;
  }
}

// Pineapple discard — index.html:9619-9662.
function applyDiscard(S, uid, index) {
  const g = S.gameState;
  const p = S.players[uid];
  if (g.phase !== "discard" || !p || p.status !== "active") return false;
  const hand = S.priv[uid] || [];
  if (hand.length !== 3 || index < 0 || index >= 3) return false;
  hand.splice(index, 1);
  S.priv[uid] = hand;
  p.cardCount = 2;
  p.actionText = "Discard";
  if (g.allInReveal || p.cards.length) p.cards = [...hand];
  const pending = activesOf(S.players).some((q) => (S.priv[q.uid] || []).length === 3);
  if (!pending) {
    g.phase = "flop";
    Object.values(S.players).forEach((q) => {
      if (q.status === "active") {
        q.hasActed = false;
        if (q.actionText !== "All-in") q.actionText = "";
      }
    });
    const actors = activesOf(S.players).filter((q) => q.stack > 0);
    if (actors.length < 2) {
      g.allInReveal = true;
      g.activeTurnUid = null;
      g.turnStartedAt = S.now;
    } else {
      g.activeTurnUid = firstAfterDealerIn(S.players, g);
      g.turnStartedAt = S.now;
    }
  }
  return true;
}
function autoDiscardAll(S) {
  activesOf(S.players).forEach((p) => {
    const hand = S.priv[p.uid] || [];
    if (hand.length === 3) applyDiscard(S, p.uid, crypto.randomInt(0, 3));
  });
}

// finishEarlyWin port — index.html:9074-9133. Uncalled bet FIRST, then pot.
function finishEarlyWin(S, winnerUid) {
  const g = S.gameState;
  const pl = S.players;
  const w = pl[winnerUid];
  const maxOther = Math.max(0, ...Object.values(pl).filter((p) => p.uid !== winnerUid).map((p) => p.bet || 0));
  if ((w.bet || 0) > maxOther) {
    const unc = round2((w.bet || 0) - maxOther);
    w.stack = round2(w.stack + unc);
    w.bet = maxOther;
  }
  C.gatherBetsToPots(g, pl);
  const pot = round2((g.pots || []).reduce((s, x) => s + x.amount, 0));
  const rakeFrac = (Number(S.settings.rakePercent) || 0) / 100;
  const rake = (g.board || []).length > 0 ? round2(pot * rakeFrac) : 0; // no rake preflop
  w.stack = round2(w.stack + pot - rake);
  w.actionText = "WINNER";
  // rabbit hunt: the runout that WOULD have come, real burn order (§4.2)
  if ((g.board || []).length < 5 && S.deck && S.deck.length) {
    const d = [...S.deck];
    const rab = [];
    if (g.board.length === 0) {
      d.pop();
      rab.push(d.pop(), d.pop(), d.pop());
    }
    while (g.board.length + rab.length < 5 && d.length > 1) {
      d.pop();
      rab.push(d.pop());
    }
    g.rabbit = rab;
  }
  g.pots = [];
  g.phase = "showdown";
  g.activeTurnUid = null;
  g.earlyWin = true;
  g.allInReveal = false;
  g.ritOffer = null;
  g.lastWinAmount = round2(pot - rake);
  g.lastWinners = w.name;
  g.showdownAt = S.now;
  settleAfterHand(S, rake, new Set([winnerUid]));
}

// runShowdown port — index.html:9134-9229 (+ RIT split per protocol §3.5).
function runShowdown(S) {
  const g = S.gameState;
  const pl = S.players;
  revealActiveHands(S);
  const rakeFrac = (Number(S.settings.rakePercent) || 0) / 100;
  const scoreOn = (board) => {
    const scores = {};
    activesOf(pl).forEach((p) => {
      scores[p.uid] = C.bestScoreFull(S.priv[p.uid] || [], board, g.currentGameType);
    });
    return scores;
  };
  const s1 = scoreOn(g.board);
  const s2 = g.board2 && g.board2.length === 5 ? scoreOn(g.board2) : null;
  let rakeTotal = 0;
  let winTotal = 0;
  const winnerUids = new Set();
  (g.pots || []).forEach((potObj, idx) => {
    // Single-eligible pot = uncalled over-bet returning to its owner: a
    // silent REFUND, never a "win" (it rendered like a split pot).
    if ((potObj.eligible || []).length === 1) {
      const uid0 = potObj.eligible[0];
      if (pl[uid0]) pl[uid0].stack = round2(pl[uid0].stack + potObj.amount);
      return;
    }
    let elig = potObj.eligible.filter((uid) => pl[uid] && pl[uid].status === "active");
    if (!elig.length) {
      // Every player who could contest this side pot has folded. These are
      // real chips someone put in — dropping the pot destroyed them (soak
      // caught a 12-chip pot vanishing this way). Award it to whoever is
      // still in the hand; if literally nobody is, return it to the players
      // who built it.
      const stillIn = activesOf(pl).map((p) => p.uid);
      elig = stillIn.length ? stillIn : (potObj.eligible || []).filter((uid) => pl[uid]);
      if (!elig.length) return; // those seats have left the table entirely
    }
    let amount = potObj.amount;
    if (idx === 0 && rakeFrac > 0) {
      const r = round2(amount * rakeFrac);
      rakeTotal = round2(rakeTotal + r);
      amount = round2(amount - r);
    }
    const award = (scores, part) => {
      let best = -1;
      let winners = [];
      elig.forEach((uid) => {
        const sc = scores[uid] || 0;
        if (sc > best) {
          best = sc;
          winners = [uid];
        } else if (sc === best) winners.push(uid);
      });
      const share = Math.floor(part / winners.length * 100) / 100; // floor to the cent (client parity)
      winners.forEach((uid) => {
        pl[uid].stack = round2(pl[uid].stack + share);
        pl[uid].actionText = "WINNER";
        winnerUids.add(uid);
        winTotal = round2(winTotal + share);
      });
    };
    if (s2) {
      const half1 = round2(amount / 2);
      award(s1, half1);
      award(s2, round2(amount - half1));
    } else {
      award(s1, amount);
    }
  });
  g.pots = [];
  g.phase = "showdown";
  g.activeTurnUid = null;
  g.earlyWin = false;
  g.allInReveal = false;
  g.ritOffer = null;
  g.lastWinAmount = winTotal;
  g.lastWinners = [...winnerUids].map((uid) => pl[uid].name).join(", ");
  g.showdownAt = S.now;
  settleAfterHand(S, rakeTotal, winnerUids);
}

// Shared post-hand bookkeeping: busts, history, rake + gameLog effects.
// index.html:9096-9130 / :9192-9226.
function settleAfterHand(S, rake, winnerUids) {
  const g = S.gameState;
  const pl = S.players;
  Object.values(pl).forEach((p) => {
    if (p.stack <= 0 && (p.cardCount || 0) > 0 && !["busted", "out"].includes(p.status)) {
      p.status = "busted";
      p.bustedAt = S.now;
    }
  });
  const dealt = Object.values(pl).filter((p) => (p.cardCount || 0) > 0);
  const hist = {
    at: S.now,
    game: g.currentGameType,
    board: g.board || [],
    rake,
    amount: g.lastWinAmount,
    winners: g.lastWinners || "",
    ps: dealt.map((p) => ({
      n: p.name,
      c: p.cards && p.cards.length ? p.cards : (p.reveal && S.priv[p.uid] ? S.priv[p.uid] : null),
      cc: p.cardCount || 0,
      w: winnerUids.has(p.uid),
      f: p.status === "folded",
    })),
  };
  S.table.history = [...(S.table.history || []), hist].slice(-100);
  if (rake > 0) {
    const dealtUids = dealt.map((p) => p.uid);
    S.effects.push({type: "rake", rake, uids: dealtUids});
    const rkPlayers = dealt.filter((p) => !p.isBot);
    if (rkPlayers.length) {
      const share = round2(rake / rkPlayers.length);
      S.effects.push({type: "gameLog", entries: rkPlayers.map((p) => ({uid: p.uid, username: p.name, profit: 0, rake: share}))});
    }
  }
}

// Bot policy port — index.html:10287-10306.
/* --------------------------- bot brain ---------------------------------
 * This used to be three coin flips that never looked at the cards: it called
 * any bet 82% of the time and called an ALL-IN half the time regardless of
 * what it held. On the felt that reads exactly as it played — paying off
 * shoves with high card. It is now the same brain the cash tables use:
 * a preflop hand tier, and postflop a Monte-Carlo equity against the live
 * opponent count weighed against the pot odds.
 * ---------------------------------------------------------------------- */
const RANK_V = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14};

// 0 = trash, 1 = playable, 2 = strong, 3 = premium
function preflopTier(cards) {
  const vs = (cards || []).map((c) => RANK_V[c.val] || 0).sort((a, b) => b - a);
  if (!cards || cards.length !== 2) { // Omaha & friends: count high cards
    const hi = vs.filter((v) => v >= 11).length;
    const paired = new Set(vs).size < vs.length;
    const suits = {};
    (cards || []).forEach((c) => { suits[c.suit] = (suits[c.suit] || 0) + 1; });
    const suited = Object.values(suits).some((n) => n >= 2);
    if (hi >= 3 || (paired && hi >= 2)) return 2;
    if (hi >= 2 || paired || (suited && hi >= 1)) return 1;
    return rnd() < 0.3 ? 1 : 0;
  }
  const suited = cards[0].suit === cards[1].suit;
  if (vs[0] === vs[1]) return vs[0] >= 10 ? 3 : 2; // every pair is playable
  const gap = vs[0] - vs[1];
  if (vs[0] === 14 && vs[1] >= 12) return 3;
  if ((vs[0] >= 12 && vs[1] >= 10) || (vs[0] === 14 && suited)) return 2;
  if (vs[0] === 14 || (gap <= 1 && vs[1] >= 5) || (gap <= 3 && suited && vs[1] >= 4) ||
      (vs[0] >= 10 && vs[1] >= 8)) return 1;
  return 0;
}

/* Monte-Carlo equity. Returns 0..1, or null when the hand is unknown —
 * callers must treat null as "do not gamble".
 *
 * `range` is what makes the bot notice its opponent. At range=1 each opponent
 * is dealt one random hand, which is the assumption the bot used to make on
 * every street: that a player who just shoved the river is as likely to hold
 * seven-deuce as aces. It measured -17 bb/100 against an opponent who only
 * ever played premiums — it kept paying him off.
 *
 * At range=k each opponent is dealt k candidate hands and plays the best of
 * them, which is a cheap, honest model of "this player's range is roughly the
 * top 1/k of hands". Callers raise k with the size of the bet being faced, so
 * a pot-sized river bet is answered as the strong range it usually is.
 */
function equityOf(myCards, board, oppCount, gameType, range) {
  try {
    if (!myCards || !myCards.length) return null;
    const omaha = (gameType || "").startsWith("Omaha");
    const iters = omaha ? 90 : 200;
    const k = Math.max(1, Math.min(6, Math.round(range || 1)));
    const known = new Set([...myCards, ...(board || [])].map((c) => c.id));
    const rest = C.pokerDeck().filter((c) => !known.has(c.id));
    const need = myCards.length * oppCount * k + 5;
    if (rest.length < need) return null;
    let score = 0;
    for (let i = 0; i < iters; i++) {
      // cheap partial shuffle of the remaining deck
      const d = rest.slice();
      for (let x = d.length - 1; x > 0; x--) {
        const j = Math.floor(rnd() * (x + 1));
        [d[x], d[j]] = [d[j], d[x]];
      }
      const fb = [...(board || [])];
      const oppHands = [];
      for (let o = 0; o < oppCount; o++) {
        const cands = [];
        for (let c = 0; c < k; c++) cands.push(d.splice(0, myCards.length));
        oppHands.push(cands);
      }
      while (fb.length < 5) fb.push(d.pop());
      const my = C.bestScoreFull(myCards, fb, gameType);
      let lose = false; let tie = false;
      for (const cands of oppHands) {
        let best = 0;
        for (const oc of cands) {
          const sc = C.bestScoreFull(oc, fb, gameType);
          if (sc > best) best = sc;
        }
        if (best > my) { lose = true; break; }
        if (best === my) tie = true;
      }
      if (!lose) score += tie ? 0.5 : 1;
    }
    return score / iters;
  } catch (e) {
    return null;
  }
}

/* How strong to assume the opponents' range is, from what they just did.
 * A check is no information; a small bet is barely any; a pot-sized bet or a
 * shove is a lot. This is the whole of "the bot pays attention". */
function rangeFacing(toCall, potNow, bb) {
  if (toCall <= 0) return 1;
  const ratio = toCall / Math.max(bb, potNow);
  if (ratio >= 1.0) return 4;   // pot-sized or bigger
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
}

function botAction(S, uid) {
  const g = S.gameState;
  const b = S.players[uid];
  const cards = (S.priv && S.priv[uid]) || b.cards || [];
  const bb = (Number(S.settings.blinds) || 0.5) * 2;
  const toCall = round2(Math.max(0, g.highestBet - (b.bet || 0)));
  const stack = b.stack || 0;
  const potNow = round2((g.pots || []).reduce((s, p) => s + (p.amount || 0), 0) +
      Object.values(S.players).reduce((s, p) => s + (p.bet || 0), 0));
  const oppN = Math.max(1, activesOf(S.players).filter((p) => p.uid !== uid).length);
  const snap = (x) => Math.max(bb, Math.round(x / bb) * bb);
  const raiseTo = (x) => round2(Math.min(Math.max(snap(x), round2(g.highestBet + (g.minRaise || bb))),
      round2(stack + (b.bet || 0))));
  const r = rnd();

  if (g.phase === "preflop") {
    // with a blind or less behind, folding is never right
    if (toCall > 0 && stack <= bb * 1.5) return {action: "call"};
    const tier = preflopTier(cards);
    const isPair = cards.length === 2 && cards[0].val === cards[1].val;
    if (isPair && toCall > 0 && toCall <= Math.min(stack * 0.15, bb * 8) && tier < 3) return {action: "call"};
    if (tier === 0) return toCall <= 0 ? {action: "call"} : {action: "fold"};
    if (tier === 1) {
      if (toCall <= 0) return r < 0.12 ? {action: "raise", amount: raiseTo(bb * 2.5)} : {action: "call"};
      if (toCall > stack * 0.3) return {action: "fold"};
      if (toCall <= bb * 2.5) return r < 0.75 ? {action: "call"} : {action: "fold"};
      return r < 0.12 ? {action: "call"} : {action: "fold"};
    }
    if (tier === 2) {
      if (stack <= bb * 12 && toCall >= stack * 0.35) return r < 0.55 ? {action: "call"} : {action: "fold"};
      if (toCall > stack * 0.35) return r < 0.1 ? {action: "call"} : {action: "fold"};
      if (toCall <= 0) return r < 0.45 ? {action: "raise", amount: raiseTo(bb * (2.5 + r))} : {action: "call"};
      if (toCall > bb * 3.5) return r < 0.55 ? {action: "call"} : {action: "fold"};
      return r < 0.3 ? {action: "raise", amount: raiseTo((g.highestBet || bb) * 3)} : {action: "call"};
    }
    if (stack <= bb * 12) return {action: "raise", amount: round2(stack + (b.bet || 0))};
    if (toCall <= 0) return r < 0.8 ? {action: "raise", amount: raiseTo(bb * (2.8 + r))} : {action: "call"};
    return r < 0.7 ? {action: "raise", amount: raiseTo((g.highestBet || bb) * (2.7 + r * 0.8))} : {action: "call"};
  }

  // Read the opponents' strength from the bet we are facing, not from thin air.
  const rng = rangeFacing(toCall, potNow, bb);
  const eqRaw = equityOf(cards, g.board || [], Math.min(3, oppN), g.currentGameType || "NLH", rng);
  const eq = eqRaw == null ? 0.35 : eqRaw; // unknown hand: never gamble on it
  const potOdds = toCall > 0 ? toCall / (potNow + toCall) : 0;
  const committed = potNow > 0 && stack <= potNow * 0.6;

  if (toCall <= 0) {
    const river = g.phase === "river";
    if (eq > 0.9) return (river ? r < 0.05 : r < 0.15) ? {action: "call"} :
      {action: "raise", amount: raiseTo((b.bet || 0) + potNow * (0.65 + r * 0.35))};
    if (eq > 0.78) return (river ? r < 0.12 : r < 0.25) ? {action: "call"} :
      {action: "raise", amount: raiseTo((b.bet || 0) + potNow * (0.55 + r * 0.3))};
    if (eq > 0.55) return r < 0.5 ? {action: "raise", amount: raiseTo((b.bet || 0) + potNow * (0.4 + r * 0.25))} : {action: "call"};
    return r < 0.11 ? {action: "raise", amount: raiseTo((b.bet || 0) + potNow * 0.55)} : {action: "call"};
  }
  // facing an ALL-IN: this is the one that was a coin flip before
  if (toCall >= stack) return eq > Math.max(0.42, potOdds) ? {action: "call"} : {action: "fold"};
  if (eq > potOdds + 0.18 && eq > 0.62) {
    if (r < 0.3) return {action: "raise", amount: raiseTo(g.highestBet + Math.min(potNow, (g.highestBet || bb) * 1.6))};
    return {action: "call"};
  }
  if (eq > potOdds + 0.02) return {action: "call"};
  if (committed && eq > potOdds - 0.06) return {action: "call"};
  return r < 0.07 ? {action: "raise", amount: raiseTo(g.highestBet + potNow * 0.7)} : {action: "fold"};
}

/* ============================ Firestore plumbing ============================ */

const tRef = (id) => db().collection("tables").doc(id);
const privRef = (id, sub) => tRef(id).collection("priv").doc(sub);

async function loadState(tx, id, opts) {
  const snap = await tx.get(tRef(id));
  if (!snap.exists) throw new HttpsError("not-found", "Table not found");
  const t = snap.data();
  if (t.tournamentId) throw new HttpsError("failed-precondition", "Tournament tables run on the client engine");
  const S = {
    id,
    settings: t.settings || {},
    players: clonePlayers(t.players || {}),
    gameState: {...(t.gameState || {})},
    table: {handCount: t.handCount, history: t.history, spin: t.spin, spinStartAt: t.spinStartAt, spinDone: t.spinDone, spinWinner: t.spinWinner, tournamentId: t.tournamentId || null, clubId: t.clubId || "main", leftStacks: t.leftStacks || {}},
    raw: t,
    priv: {},
    deck: null,
    now: Date.now(),
    effects: [],
  };
  if (opts && opts.withCards) {
    const engSnap = await tx.get(privRef(id, "_engine"));
    S.deck = engSnap.exists ? (engSnap.data().deck || []) : [];
    const uids = Object.keys(S.players).filter((uid) => (S.players[uid].cardCount || 0) > 0);
    const snaps = await Promise.all(uids.map((uid) => tx.get(privRef(id, uid))));
    snaps.forEach((s, i) => {
      S.priv[uids[i]] = s.exists ? (s.data().cards || []) : [];
    });
  }
  return S;
}

function commitState(tx, S, extraTop) {
  const top = {
    players: S.players,
    gameState: S.gameState,
    ...(S.table.history !== S.raw.history ? {history: S.table.history} : {}),
    ...(S.table.handCount !== S.raw.handCount ? {handCount: S.table.handCount} : {}),
    ...(extraTop || {}),
  };
  Object.entries(S.leftWrites || {}).forEach(([uid, v]) => {
    top[`leftStacks.${uid}`] = v;
  });
  tx.update(tRef(S.id), top);
  if (S.deck !== null) tx.set(privRef(S.id, "_engine"), {deck: S.deck});
  Object.entries(S.priv).forEach(([uid, cards]) => {
    tx.set(privRef(S.id, uid), {cards});
  });
}

// Post-transaction side effects: money history + rake distribution.
// Ports logGameResult (index.html:1636-1652) and distributeRake (:1534-1608).
async function runEffects(S) {
  for (const ef of S.effects) {
    try {
      if (ef.type === "gameLog") {
        for (const e of ef.entries) {
          if (!e.uid || String(e.uid).startsWith("bot_")) continue;
          await db().collection("gameLog").add({
            uid: e.uid, username: e.username || "", game: "poker",
            clubId: S.table.clubId, profit: round2(e.profit || 0),
            rake: round2(e.rake || 0), tableId: S.id, at: Date.now(),
          });
        }
      } else if (ef.type === "credit") {
        const mRef = db().doc(`memberships/${ef.uid}_${S.table.clubId}`);
        await db().runTransaction(async (mtx) => {
          const ms = await mtx.get(mRef);
          if (!ms.exists) return;
          const upd = {balance: round2((Number(ms.data().balance) || 0) + ef.amount)};
          Object.entries(ef.fields || {}).forEach(([k, v]) => {
            upd[k] = round2((Number(ms.data()[k]) || 0) + v);
          });
          mtx.update(mRef, upd);
        });
      } else if (ef.type === "rake") {
        await distributeRakeSrv(S.table.clubId, ef.rake, ef.uids);
      }
    } catch (e) {
      console.error("effect failed", ef.type, e);
    }
  }
}

// computeAgentCuts + creditAgent + creditRakeToClub — index.html:1454-1608.
async function distributeRakeSrv(clubId, rake, uids) {
  if (!rake || rake <= 0) return;
  let total = 0;
  const cuts = {};
  try {
    const list = (uids || []).filter((u) => u && !String(u).startsWith("bot_"));
    if (list.length) {
      const share = rake / list.length; // unrounded (client parity)
      const snaps = await Promise.all(list.map((uid) => db().doc(`memberships/${uid}_${clubId}`).get()));
      snaps.forEach((s, i) => {
        if (!s.exists) return;
        const m = s.data();
        if (m.agentUid && (Number(m.agentPct) || 0) > 0 && m.agentUid !== list[i]) {
          cuts[m.agentUid] = round2((cuts[m.agentUid] || 0) + round2(share * (Number(m.agentPct) || 0) / 100));
        }
      });
      for (const [agentUid, amt] of Object.entries(cuts)) {
        if (amt <= 0) continue;
        total = round2(total + amt);
        const aRef = db().doc(`memberships/${agentUid}_${clubId}`);
        await db().runTransaction(async (mtx) => {
          const s = await mtx.get(aRef);
          if (!s.exists) return;
          mtx.update(aRef, {
            balance: round2((Number(s.data().balance) || 0) + amt),
            agentProfits: round2((Number(s.data().agentProfits) || 0) + amt),
          });
        });
        await db().collection("agentLog").add({agentUid, clubId, amount: round2(amt), at: Date.now()});
      }
    }
  } catch (e) {
    total = 0; // on any throw the whole rake goes to the club (client parity)
  }
  const clubAmt = round2(Math.max(rake - total, 0));
  if (clubAmt <= 0) return;
  const clubSnap = await db().doc(`clubs/${clubId}`).get();
  const ownerUid = clubSnap.exists ? clubSnap.data().ownerUid : null;
  if (!ownerUid) return;
  const oRef = db().doc(`memberships/${ownerUid}_${clubId}`);
  await db().runTransaction(async (mtx) => {
    const s = await mtx.get(oRef);
    if (!s.exists) return;
    mtx.update(oRef, {
      balance: round2((Number(s.data().balance) || 0) + clubAmt),
      clubProfits: round2((Number(s.data().clubProfits) || 0) + clubAmt),
    });
  });
  await db().collection("agentLog").add({clubId, amount: clubAmt, at: Date.now(), kind: "club"});
}

/* ============================ tick orchestration ============================ */

// Everything time-driven lives here: timeouts, bots, runouts, next hands,
// spin arming/resolution, seat reaping. Called by every viewer every ~4s
// (protocol §3.3) — must be cheap and idempotent.
async function tickTable(id) {
  // Cheap pre-check without a transaction: bail when clearly nothing is due.
  const pre = await tRef(id).get();
  if (!pre.exists) return {};
  const t0 = pre.data();
  if (t0.tournamentId) return {};
  if (!((t0.settings || {}).serverEngine)) return {};
  let spinPayout = null;
  let S = null;
  await db().runTransaction(async (tx) => {
    spinPayout = null;
    S = await loadState(tx, id, {withCards: true});
    const g = S.gameState;
    const pl = S.players;
    const now = S.now;
    const extraTop = {};
    let dirty = false;

    // --- Spin arming: table full, wheel not spun yet (protocol §5) ---
    if (S.settings.spinMode && !S.raw.spin && Object.keys(pl).length >= (Number(S.settings.maxPlayers) || 3)) {
      const mult = C.spinDrawMult(rnd());
      extraTop.spin = {mult, near: mult < 100 && rnd() < 0.3, prize: C.spinPrize(S.settings.spinBuyIn, mult)};
      extraTop.spinStartAt = now + 7500;
      S.table.spinStartAt = extraTop.spinStartAt;
      dirty = true;
    }

    // --- Spin resolution: one player left with chips, hand not running ---
    if (S.settings.spinMode && S.raw.spin && !S.raw.spinDone && ["waiting", "showdown"].includes(g.phase)) {
      const alive = Object.values(pl).filter((p) => p.stack > 0);
      if (alive.length === 1 && Object.keys(pl).length >= 2) {
        extraTop.spinDone = true;
        extraTop.spinWinner = alive[0].uid;
        spinPayout = {winner: alive[0], prize: (S.raw.spin || {}).prize || 0, all: Object.values(pl)};
        dirty = true;
      }
    }

    // --- Seat reaping (cash only): leaveReq/sitOut/busted between hands ---
    if (!S.settings.spinMode && ["waiting", "showdown"].includes(g.phase)) {
      for (const p of Object.values(pl)) {
        const idle = p.leaveReq || (p.sitOut && p.sitOutAt && now - p.sitOutAt > 600000) ||
          (p.leavingAt && now >= p.leavingAt) ||
          (p.status === "busted" && p.bustedAt && (p.isBot || now - p.bustedAt > 300000));
        if (!idle) continue;
        removeSeat(S, p.uid, false);
        dirty = true;
      }
    }

    // --- Next hand from waiting / showdown ---
    const eligible = Object.values(pl).filter((p) => p.stack > 0 && !p.sitOut && !["busted", "out"].includes(p.status));
    const spinGate = S.settings.spinMode ? (S.raw.spin || extraTop.spin) && now >= ((S.raw.spinStartAt || S.table.spinStartAt) || 0) && !S.raw.spinDone && !extraTop.spinDone : true;
    if (g.phase === "waiting" && eligible.length >= 2 && spinGate) {
      startHand(S);
      dirty = true;
    } else if (g.phase === "showdown" && spinGate && !extraTop.spinDone) {
      const wait = g.earlyWin ? 2500 : 5000; // client cash parity (server tables are cash/spin only)
      if (now - (g.showdownAt || 0) > wait && eligible.length >= 2) {
        startHand(S);
        dirty = true;
      }
    } else if (g.phase === "dc_selection") {
      const stuck = now - (g.turnStartedAt || 0);
      const picker = pl[g.dcUid];
      if (picker && picker.isBot && stuck > 2200) {
        const keys = Object.keys(C.GAME_CARDS);
        executeDeal(S, keys[crypto.randomInt(0, keys.length)]);
        dirty = true;
      } else if (stuck > 25000) {
        executeDeal(S, S.settings.baseGameType || "NLH");
        dirty = true;
      }
    } else if (g.phase === "discard") {
      const stuck = now - (g.turnStartedAt || 0);
      let acted = false;
      activesOf(pl).forEach((p) => {
        if ((S.priv[p.uid] || []).length !== 3) return;
        if (p.isBot && stuck > 1600) acted = applyDiscard(S, p.uid, crypto.randomInt(0, 3)) || acted;
      });
      if (!acted && stuck > 25000) {
        const holdout = activesOf(pl).find((p) => (S.priv[p.uid] || []).length === 3);
        if (holdout) acted = applyDiscard(S, holdout.uid, crypto.randomInt(0, 3));
      }
      dirty = dirty || acted;
    } else if (BETTING.includes(g.phase)) {
      if (g.allInReveal) {
        if (g.ritOffer && resolveRitIfDue(S)) dirty = true; // offer settled (agreed or expired)
        if (!g.ritOffer && now - (g.turnStartedAt || 0) >= 1300) { // runout pacing (index.html:9277)
          g.turnStartedAt = now;
          advancePhase(S);
          dirty = true;
        }
      } else if (g.activeTurnUid) {
        const actor = pl[g.activeTurnUid];
        const stuck = now - (g.turnStartedAt || 0);
        if (!actor || actor.status !== "active") { // watchdog port (index.html:10595-10610)
          const acts = activesOf(pl);
          if (acts.length === 1) finishEarlyWin(S, acts[0].uid);
          else if (acts.length === 0) {
            g.phase = "waiting";
            g.activeTurnUid = null;
          } else {
            g.activeTurnUid = firstAfterDealerIn(pl, g);
            g.turnStartedAt = now;
          }
          dirty = true;
        } else if (actor.isBot && stuck > 2200) {
          const move = botAction(S, actor.uid);
          applyAction(S, actor.uid, move.action, move.amount, false);
          dirty = true;
        } else if (!actor.isBot) {
          const gone = actor.lastSeen && now - actor.lastSeen > 20000;
          const limit = gone ? 9000 : ((Number(S.settings.actionTime) || 30) + 22) * 1000;
          if (stuck > limit) {
            const toCall = round2(Math.max(0, g.highestBet - (actor.bet || 0)));
            applyAction(S, actor.uid, toCall > 0 ? "fold" : "call", undefined, true);
            dirty = true;
          }
        }
      }
    }
    if (dirty || Object.keys(extraTop).length) commitState(tx, S, extraTop);
    else S.effects = [];
  });
  if (S) {
    if (spinPayout) {
      const {winner, prize, all} = spinPayout;
      if (!winner.isBot && prize > 0) S.effects.push({type: "credit", uid: winner.uid, amount: prize, fields: {bonusTotal: 0}});
      S.effects.push({type: "gameLog", entries: all.filter((p) => !p.isBot).map((p) => ({
        uid: p.uid, username: p.name,
        profit: p.uid === winner.uid ? round2(prize - (p.spinPaid || 0)) : -round2(p.spinPaid || 0),
        rake: 0,
      }))});
    }
    await runEffects(S);
  }
  return {};
}

// Stand a seat up inside a loaded state (cash rules; spin/tour pay nothing).
// Port of the pkLeave expectations (protocol §3.4) + leftStacks (index.html:10228).
function removeSeat(S, uid, inHand) {
  const p = S.players[uid];
  if (!p) return;
  const g = S.gameState;
  if ((p.bet || 0) > 0 && inHand) { // forfeit live bet into an extra pot
    const elig = activesOf(S.players).filter((q) => q.uid !== uid).map((q) => q.uid);
    g.pots = [...(g.pots || []), {amount: round2(p.bet), eligible: elig}];
  }
  const stack = round2(p.stack || 0);
  const credit = S.settings.spinMode ?
    (S.raw.spin || S.table.spin ? 0 : round2(p.spinPaid || 0)) :
    round2(stack + (p.pendingTopUp || 0) + (inHand ? 0 : (p.bet || 0)));
  delete S.players[uid];
  if (g.activeTurnUid === uid) {
    const acts = activesOf(S.players);
    if (acts.length === 1 && BETTING.includes(g.phase)) finishEarlyWin(S, acts[0].uid);
    else if (BETTING.includes(g.phase)) {
      g.activeTurnUid = firstAfterDealerIn(S.players, g);
      g.turnStartedAt = S.now;
    } else g.activeTurnUid = null;
  }
  if (credit > 0 && !p.isBot) {
    S.effects.push({type: "credit", uid, amount: credit});
    if (!S.settings.spinMode) {
      S.effects.push({type: "gameLog", entries: [{uid, username: p.name, profit: round2(stack - (p.buyTotal || stack)), rake: 0}]});
      if (stack > 0) {
        S.leftWrites = S.leftWrites || {};
        S.leftWrites[uid] = {amount: stack, at: S.now}; // 12h re-entry floor (index.html:10228)
      }
    }
  }
}

/* ============================ callables ============================ */

const CALL_OPTS = {region: "us-central1"};

const authedUid = (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first");
  return uid;
};
const reqTableId = (request) => {
  const id = request.data && request.data.tableId;
  if (!id || typeof id !== "string") throw new HttpsError("invalid-argument", "Missing tableId");
  return id;
};

// pkDeal — protocol §3.1. Must finish well under the client's 7s race.
exports.pkDeal = onCall({...CALL_OPTS, minInstances: 1}, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  let S = null;
  await db().runTransaction(async (tx) => {
    S = await loadState(tx, id, {withCards: true});
    const god = isGodEmail(request.auth.token && request.auth.token.email);
    if (!S.players[uid] && !god) throw new HttpsError("permission-denied", "You are not seated at this table");
    const phase = S.gameState.phase || "waiting";
    if (!["waiting", "showdown"].includes(phase)) {
      S.effects = [];
      S = null; // someone already dealt — idempotent success
      return;
    }
    if (S.settings.spinMode) {
      const armed = S.raw.spin && S.raw.spinStartAt && Date.now() >= S.raw.spinStartAt && !S.raw.spinDone;
      if (!armed) throw new HttpsError("failed-precondition", "The spin has not started yet");
    }
    startHand(S);
    commitState(tx, S);
  });
  if (S) await runEffects(S);
  return {ok: true};
});

// pkAct — protocol §3.2. amount is the TARGET TOTAL bet for the street.
exports.pkAct = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const {action, amount, auto} = request.data || {};
  if (!["fold", "call", "raise"].includes(action)) throw new HttpsError("invalid-argument", "Unknown action");
  let S = null;
  await db().runTransaction(async (tx) => {
    S = await loadState(tx, id, {withCards: true});
    applyAction(S, uid, action, amount, !!auto);
    commitState(tx, S);
  });
  await runEffects(S);
  return {ok: true};
});

// pkTick — protocol §3.3. Called by every viewer; cheap + idempotent.
exports.pkTick = onCall(CALL_OPTS, async (request) => {
  authedUid(request);
  return await tickTable(reqTableId(request));
});

// pkLeave — protocol §3.4. Self stand-up, or admin kick with targetUid.
exports.pkLeave = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const target = (request.data || {}).targetUid || uid;
  let S = null;
  await db().runTransaction(async (tx) => {
    S = await loadState(tx, id, {withCards: true});
    if (target !== uid) {
      const god = isGodEmail(request.auth.token && request.auth.token.email);
      const clubSnap = await tx.get(db().doc(`clubs/${S.table.clubId}`));
      const owner = clubSnap.exists && clubSnap.data().ownerUid === uid;
      if (!god && !owner) throw new HttpsError("permission-denied", "Not allowed");
    }
    const p = S.players[target];
    if (!p) {
      S = null;
      return; // already gone — success
    }
    const inHand = BETTING.includes(S.gameState.phase) && p.status === "active";
    if (inHand && target === uid) throw new HttpsError("failed-precondition", "You are mid-hand — the seat clears when the hand ends");
    removeSeat(S, target, inHand);
    commitState(tx, S);
    tx.set(privRef(id, target), {cards: []});
  });
  if (S) await runEffects(S);
  return {ok: true};
});

// pkRit — protocol §3.5.
exports.pkRit = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const agree = !!(request.data || {}).agree;
  await db().runTransaction(async (tx) => {
    const S = await loadState(tx, id);
    const g = S.gameState;
    if (!g.ritOffer || S.now >= g.ritOffer.until) return;
    const p = S.players[uid];
    if (!p || p.status !== "active") return;
    g.ritAgree = {...(g.ritAgree || {}), [uid]: agree};
    tx.update(tRef(id), {"gameState.ritAgree": g.ritAgree});
  });
  return {ok: true};
});

// pkReveal — protocol §3.6: publish my mucked cards on the felt.
exports.pkReveal = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  await db().runTransaction(async (tx) => {
    const S = await loadState(tx, id);
    const p = S.players[uid];
    if (!p || S.gameState.phase !== "showdown") throw new HttpsError("failed-precondition", "Nothing to reveal now");
    const okState = p.status === "folded" || (S.gameState.earlyWin && p.status === "active");
    if (!okState || p.reveal) return;
    const cs = await tx.get(privRef(id, uid));
    const cards = cs.exists ? (cs.data().cards || []) : [];
    if (!cards.length) return;
    tx.update(tRef(id), {[`players.${uid}.reveal`]: true, [`players.${uid}.cards`]: cards});
  });
  return {ok: true};
});

// pkPickGame — protocol §3.7. Errors must mention "your pick"/"dc_selection".
exports.pkPickGame = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const gameType = (request.data || {}).gameType;
  if (!C.GAME_CARDS[gameType]) throw new HttpsError("invalid-argument", "Unknown game type");
  let S = null;
  await db().runTransaction(async (tx) => {
    S = await loadState(tx, id, {withCards: true});
    if (S.gameState.phase !== "dc_selection") throw new HttpsError("failed-precondition", "Not in dc_selection");
    if (S.gameState.dcUid !== uid) throw new HttpsError("permission-denied", "Not your pick");
    executeDeal(S, gameType);
    commitState(tx, S);
  });
  await runEffects(S);
  return {ok: true};
});

// pkDiscard — protocol §3.8. index is a position in MY priv cards array.
exports.pkDiscard = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const index = Number((request.data || {}).index);
  let S = null;
  await db().runTransaction(async (tx) => {
    S = await loadState(tx, id, {withCards: true});
    if (!applyDiscard(S, uid, index)) throw new HttpsError("failed-precondition", "Cannot discard now");
    commitState(tx, S);
  });
  await runEffects(S);
  return {ok: true};
});

// godPeek — protocol §3.9. GOD accounts only: all hands + the coming runout.
exports.godPeek = onCall(CALL_OPTS, async (request) => {
  authedUid(request);
  if (!isGodEmail(request.auth.token && request.auth.token.email)) {
    throw new HttpsError("permission-denied", "Not allowed");
  }
  const id = reqTableId(request);
  const tSnap = await tRef(id).get();
  if (!tSnap.exists) throw new HttpsError("not-found", "Table not found");
  const t = tSnap.data();
  const pl = t.players || {};
  const uids = Object.keys(pl).filter((uid) => (pl[uid].cardCount || 0) > 0);
  const [engSnap, ...cardSnaps] = await Promise.all([
    privRef(id, "_engine").get(),
    ...uids.map((uid) => privRef(id, uid).get()),
  ]);
  const hands = {};
  cardSnaps.forEach((s, i) => {
    if (s.exists && (s.data().cards || []).length) hands[uids[i]] = s.data().cards;
  });
  // simulate the exact upcoming pops (burn + street) without mutating
  const board = ((t.gameState || {}).board || []);
  const deck = engSnap.exists ? [...(engSnap.data().deck || [])] : [];
  const finalBoard = [...board];
  if (board.length === 0 && deck.length >= 4) {
    deck.pop();
    finalBoard.push(deck.pop(), deck.pop(), deck.pop());
  }
  while (finalBoard.length < 5 && deck.length >= 2) {
    deck.pop();
    finalBoard.push(deck.pop());
  }
  return {hands, finalBoard: finalBoard.length === 5 ? finalBoard : []};
});

// admFixGameLog — protocol §3.10: delete duplicate gameLog docs for a club.
exports.admFixGameLog = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const email = request.auth.token && request.auth.token.email;
  const clubId = (request.data || {}).clubId;
  if (!clubId) throw new HttpsError("invalid-argument", "Missing clubId");
  if (!isGodEmail(email) && String(email || "").toLowerCase() !== SUPER_ADMIN_EMAIL) {
    const clubSnap = await db().doc(`clubs/${clubId}`).get();
    if (!clubSnap.exists || clubSnap.data().ownerUid !== uid) {
      throw new HttpsError("permission-denied", "Owner only");
    }
  }
  const snap = await db().collection("gameLog").where("clubId", "==", clubId).get();
  const seen = new Set();
  const dupes = [];
  snap.docs.forEach((d) => {
    const e = d.data();
    const key = [e.uid, e.tableId, e.at, e.profit, e.rake, e.game].join("|");
    if (seen.has(key)) dupes.push(d.ref);
    else seen.add(key);
  });
  for (let i = 0; i < dupes.length; i += 300) {
    await Promise.all(dupes.slice(i, i + 300).map((r) => r.delete().catch(() => {})));
  }
  return {deleted: dupes.length};
});

// ---- Scheduled tournament auto-start ----
// Fires every minute on the SERVER, so a scheduled tournament flips to
// 'running' exactly at its start time (anchored to the advertised startAt) —
// no admin needs to be online. Table seeding then happens on the first club
// client that sees a running tournament with no tables (index.html fallback
// seeder), so play begins the moment players are looking at it.
const {onSchedule} = require("firebase-functions/v2/scheduler");
exports.tourAutoStart = onSchedule("every 1 minutes", async () => {
  const now = Date.now();
  const snap = await db().collection("tournaments").where("status", "==", "reg").get();
  for (const d of snap.docs) {
    const t = d.data();
    if (!t.startAt || t.startAt > now) continue;
    const entrants = Object.values(t.players || {}).filter((p) => !p.out);
    if (entrants.length < Math.max(2, Number(t.minPlayers) || 2)) continue;
    let rigUid = null;
    if (t.mysteryBounty && t.mysteryRig && t.mysteryRig.playerId) {
      const want = String(t.mysteryRig.playerId).trim().toUpperCase();
      const hit = entrants.find((p) => String(p.playerId || "").toUpperCase() === want);
      if (hit) rigUid = hit.uid;
    }
    try {
      await db().runTransaction(async (tx) => {
        const s = await tx.get(d.ref);
        if (!s.exists || s.data().status !== "reg") return;
        tx.update(d.ref, {
          status: "running",
          // blind clock anchored to the ADVERTISED start (Israel-time as set
          // in the form), even if this tick ran up to a minute late
          startedAt: Math.max(t.startAt, now - 60000),
          round: 1,
          ...(rigUid ? {mysteryRigUid: rigUid} : {}),
        });
      });
    } catch (e) { /* raced another starter — fine */ }
  }
});

// Test hook — a plain object, ignored by the Functions deploy loader.
exports.__engineInternals = {startHand, executeDeal, applyAction, advancePhase, finishEarlyWin, runShowdown, applyDiscard, removeSeat, activesOf, botAction, preflopTier, equityOf};
