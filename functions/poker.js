/**
 * PokerTen — server-authoritative poker engine (Phase A: cash tables).
 *
 * Tables with settings.serverEngine === true are dealt and driven HERE.
 * Hole cards and the deck never appear in the public table doc:
 *   tables/{id}            public state (players get cardCount, cards stay [])
 *   tables/{id}/priv/{uid} that player's own hole cards (rules: only they read it)
 *   tables/{id}/priv/_engine  deck + all hands + hand bookkeeping (no client access)
 *
 * GOD access is validated ONLY here, against SERVER_GODS + admin/gods doc —
 * the client never ships the list. Clients act via callables; any open client
 * may call pkTick, which lets the server enforce timeouts, run bots and deal
 * the next hand — the client is just a clock, never an authority.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const crypto = require("crypto");

const db = getFirestore();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Table max buy-in (money-first, legacy BB fallback) — mirrors the client's buyInMax().
const maxBuyOf = (s) => {
  s = s || {};
  return s.maxBuyIn != null ? round2(Number(s.maxBuyIn) || 0) : round2((Number(s.maxBuyInBB) || 200) * (Number(s.blinds) || 0.5) * 2);
};

// ── GOD list: server-side only. Add emails here (or to the admin/gods doc). ──
const SERVER_GODS = ["aaci.yoni@gmail.com", "info.bagso@gmail.com", "avi057278@gmail.com", "khnby749@gmail.com", "bykhn3234@gmail.com"];
async function isGod(auth) {
  const email = ((auth && auth.token && auth.token.email) || "").toLowerCase().trim();
  if (!email) return false;
  if (SERVER_GODS.includes(email)) return true;
  try {
    const d = await db.doc("admin/gods").get();
    return d.exists && (d.data().emails || []).map((e) => String(e).toLowerCase()).includes(email);
  } catch (e) { return false; }
}

// ── Cards ──
const SUITS = ["♠", "♥", "♦", "♣"];
const CARD_VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const GAME_CARDS = {"NLH": 2, "Pineapple": 3, "Omaha 4": 4, "Omaha 5": 5, "Omaha 6": 6};

function pokerDeck() {
  const deck = [];
  for (const suit of SUITS) for (const val of CARD_VALUES) deck.push({id: `${val}${suit}`, val, suit});
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); // CSPRNG — not Math.random
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const getCombinations = (arr, k) => {
  if (k === 1) return arr.map((a) => [a]);
  if (arr.length === k) return [arr];
  if (arr.length < k) return [];
  const combs = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const tail = getCombinations(arr.slice(i + 1), k - 1);
    for (const t of tail) combs.push([arr[i]].concat(t));
  }
  return combs;
};

// Identical scoring to the client's evaluate5Cards (same constants → same ranking)
const evaluate5Cards = (cards5) => {
  const rankValues = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14};
  const ranks = cards5.map((c) => rankValues[c.val]).sort((a, b) => b - a);
  const isFlush = cards5.every((c) => c.suit === cards5[0].suit);
  let isStraight = ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5;
  let straightHigh = ranks[0];
  if (ranks.join(",") === "14,5,4,3,2") { isStraight = true; straightHigh = 5; }
  const counts = {};
  ranks.forEach((r) => counts[r] = (counts[r] || 0) + 1);
  const groups = Object.entries(counts).map(([r, c]) => ({rank: Number(r), count: c})).sort((a, b) => b.count - a.count || b.rank - a.rank);
  const kickers = (skip) => ranks.filter((r) => !skip.includes(r));
  if (isStraight && isFlush) return 8000000 + straightHigh * 10000;
  if (groups[0].count === 4) return 7000000 + groups[0].rank * 10000 + kickers([groups[0].rank])[0];
  if (groups[0].count === 3 && groups[1] && groups[1].count >= 2) return 6000000 + groups[0].rank * 10000 + groups[1].rank;
  if (isFlush) return 5000000 + ranks[0] * 10000 + ranks[1] * 500 + ranks[2] * 25 + ranks[3];
  if (isStraight) return 4000000 + straightHigh * 10000;
  if (groups[0].count === 3) { const k = kickers([groups[0].rank]); return 3000000 + groups[0].rank * 10000 + k[0] * 100 + k[1]; }
  if (groups[0].count === 2 && groups[1] && groups[1].count === 2) { const k = kickers([groups[0].rank, groups[1].rank]); return 2000000 + groups[0].rank * 10000 + groups[1].rank * 100 + k[0]; }
  if (groups[0].count === 2) { const k = kickers([groups[0].rank]); return 1000000 + groups[0].rank * 10000 + k[0] * 200 + k[1] * 14 + k[2]; }
  return ranks[0] * 10000 + ranks[1] * 500 + ranks[2] * 25 + ranks[3] + ranks[4] / 15;
};

const bestScore = (hole, board, gameType) => {
  let best = 0;
  if ((gameType || "").startsWith("Omaha")) {
    const hc = getCombinations(hole, 2);
    const bc = getCombinations(board, 3);
    hc.forEach((h) => bc.forEach((b) => { const s = evaluate5Cards([...h, ...b]); if (s > best) best = s; }));
  } else {
    getCombinations([...hole, ...board], 5).forEach((c) => { const s = evaluate5Cards(c); if (s > best) best = s; });
  }
  return best;
};

// ── Side pots (port of the client's gatherBetsToPots) ──
const gatherBetsToPots = (gs, playersObj) => {
  if (!gs.pots) gs.pots = [];
  let bettors = Object.values(playersObj).filter((p) => p.bet > 0).sort((a, b) => a.bet - b.bet);
  while (bettors.length > 0) {
    const minBet = bettors[0].bet;
    let potContribution = 0;
    const eligibleUids = bettors.filter((p) => p.status === "active").map((p) => p.uid);
    bettors.forEach((p) => { potContribution += minBet; p.bet -= minBet; });
    if (gs.pots.length > 0) {
      const lastPot = gs.pots[gs.pots.length - 1];
      const isSame = lastPot.eligible.length === eligibleUids.length && lastPot.eligible.every((uid) => eligibleUids.includes(uid));
      if (isSame) lastPot.amount = round2(lastPot.amount + potContribution);
      else gs.pots.push({amount: round2(potContribution), eligible: eligibleUids});
    } else {
      gs.pots.push({amount: round2(potContribution), eligible: eligibleUids});
    }
    bettors = bettors.filter((p) => p.bet > 0);
  }
  Object.values(playersObj).forEach((p) => p.bet = 0);
};

// ── Helpers ──
const TOUR_SCHEDULE = [[5, 10], [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500], [400, 800], [600, 1200], [1000, 2000]];
const tourLevelOf = (tour) => Math.min(TOUR_SCHEDULE.length - 1, Math.floor((Date.now() - (tour.startedAt || Date.now())) / ((tour.levelMins || 5) * 60000)));

const tRef = (id) => db.doc(`tables/${id}`);
const eRef = (id) => db.doc(`tables/${id}/priv/_engine`);
const pRef = (id, uid) => db.doc(`tables/${id}/priv/${uid}`);
const BETTING = ["preflop", "flop", "turn", "river"];

const activesOf = (pl) => Object.values(pl).filter((p) => p.status === "active").sort((a, b) => a.seatIndex - b.seatIndex);

const firstAfterDealer = (g, pl) => {
  const acts = activesOf(pl).filter((p) => (p.stack || 0) > 0);
  if (!acts.length) return null;
  const dSeat = (pl[g.dealerUid] || {}).seatIndex ?? -1;
  const rot = acts.filter((p) => p.seatIndex > dSeat).concat(acts.filter((p) => p.seatIndex <= dSeat));
  return rot.length ? rot[0].uid : null;
};

const nextActor = (g, pl, fromUid) => {
  const acts = activesOf(pl);
  const from = pl[fromUid];
  if (!from) return null;
  const order = acts.filter((q) => q.seatIndex > from.seatIndex).concat(acts.filter((q) => q.seatIndex <= from.seatIndex && q.uid !== fromUid));
  for (const q of order) {
    if ((q.stack || 0) <= 0) continue;
    const toCall = round2((g.highestBet || 0) - (q.bet || 0));
    if (!q.hasActed || toCall > 0) return q.uid;
  }
  return null;
};

// ── Rake distribution (port of the client's distributeRake, post-commit best-effort) ──
async function distributeRake(clubId, rake, participantUids) {
  if (!(rake > 0) || !clubId) return;
  try {
    const memSnaps = await Promise.all(participantUids.map((uid) => db.doc(`memberships/${uid}_${clubId}`).get()));
    const share = rake / participantUids.length;
    const cuts = {};
    let total = 0;
    memSnaps.forEach((s) => {
      if (!s.exists) return;
      const d = s.data();
      if (d.agentUid) {
        const pct = Number(d.agentPct) || 0;
        const cut = round2(share * pct / 100);
        if (cut > 0) { cuts[d.agentUid] = round2((cuts[d.agentUid] || 0) + cut); total = round2(total + cut); }
      }
    });
    for (const [agentUid, amt] of Object.entries(cuts)) {
      const r = db.doc(`memberships/${agentUid}_${clubId}`);
      await db.runTransaction(async (tx) => {
        const sn = await tx.get(r);
        if (sn.exists) tx.update(r, {balance: round2((sn.data().balance || 0) + amt), agentProfits: round2((sn.data().agentProfits || 0) + amt)});
      });
      db.collection("agentLog").add({agentUid, clubId, amount: round2(amt), at: Date.now()}).catch(() => {});
    }
    const ownerCut = round2(Math.max(rake - total, 0));
    if (ownerCut > 0) {
      const club = await db.doc(`clubs/${clubId}`).get();
      const ownerUid = club.exists ? club.data().ownerUid : null;
      if (ownerUid) {
        const r = db.doc(`memberships/${ownerUid}_${clubId}`);
        await db.runTransaction(async (tx) => {
          const sn = await tx.get(r);
          if (sn.exists) tx.update(r, {balance: round2((sn.data().balance || 0) + ownerCut), clubProfits: round2((sn.data().clubProfits || 0) + ownerCut)});
        });
        db.collection("agentLog").add({clubId, amount: ownerCut, at: Date.now(), kind: "club"}).catch(() => {});
      }
    }
  } catch (e) { /* rake distribution is best-effort, never blocks the hand */ }
}

// ── Tournament flow: mark busts, report ranks/bounties, detect table winner ──
const MYSTERY_TIERS = [[0.5, 0.40], [1, 0.35], [2, 0.15], [3, 0.08], [25, 0.02]];
const mysteryMult = () => { const r = Math.random(); let acc = 0; for (const [m, p] of MYSTERY_TIERS) { acc += p; if (r <= acc) return m; } return 1; };

async function creditBalance(uid, clubId, amt) {
  if (!uid || !(amt > 0)) return;
  try {
    const r = db.doc(`memberships/${uid}_${clubId}`);
    await db.runTransaction(async (tx) => {
      const sn = await tx.get(r);
      if (sn.exists) tx.update(r, {balance: round2((sn.data().balance || 0) + amt)});
    });
  } catch (e) { /* best-effort */ }
}

async function tourAfterHand(tableId, t, plAfter, winnersUids) {
  const tour = t.tournament || null;
  if (!tour || !t.tournamentId) return;
  const lvl = tourLevelOf(tour);
  const bustedNow = [];
  const upd = {};
  for (const q of Object.values(plAfter)) {
    if (q.status === "busted" && !q._reported) {
      q._reported = true;
      upd[`players.${q.uid}._reported`] = true;
      bustedNow.push(q.uid);
      if (lvl > (tour.rebuyUntil ?? -1)) { q.status = "out"; upd[`players.${q.uid}.status`] = "out"; }
    }
  }
  const outsNow = bustedNow.filter((u) => plAfter[u].status === "out");
  if (Object.keys(upd).length) await tRef(tableId).update(upd).catch(() => {});

  // Report to the tournament doc (ranks + bounty bookkeeping) — mirrors the client's tourReportBust
  if (outsNow.length || (tour.bounty > 0 && bustedNow.length && winnersUids.length)) {
    const torRef = db.doc(`tournaments/${t.tournamentId}`);
    const bountyCuts = [];
    try {
      await db.runTransaction(async (tx) => {
        const sn = await tx.get(torRef);
        if (!sn.exists) return;
        const tor = sn.data();
        const tp = {...tor.players};
        let alive = Object.values(tp).filter((p) => !p.out).length;
        const u2 = {};
        for (const uid of outsNow) {
          if (!tp[uid] || tp[uid].out) continue;
          u2[`players.${uid}.out`] = true;
          u2[`players.${uid}.rank`] = alive;
          tp[uid] = {...tp[uid], out: true};
          alive--;
        }
        const bountyAmt = Number(tour.bounty) || 0;
        const liveWinners = winnersUids.filter((w) => !bustedNow.includes(w));
        if (bountyAmt > 0 && liveWinners.length && bustedNow.length) {
          let total;
          if (tor.mysteryBounty) {
            const rigUid = (tor.mysteryRigUid && liveWinners.includes(tor.mysteryRigUid)) ? tor.mysteryRigUid : null;
            let sum = 0;
            for (let i = 0; i < bustedNow.length; i++) sum += bountyAmt * (rigUid ? ((tor.mysteryRig || {}).mult || 25) : mysteryMult());
            total = round2(sum);
          } else {
            total = round2(bountyAmt * bustedNow.length);
          }
          const share = round2(Math.floor((total / liveWinners.length) * 100) / 100);
          liveWinners.forEach((w) => {
            u2[`players.${w}.bounties`] = ((tp[w] || {}).bounties || 0) + bustedNow.length;
            u2[`players.${w}.bountyWon`] = round2(((tp[w] || {}).bountyWon || 0) + share);
            bountyCuts.push([w, share]);
          });
        }
        if (Object.keys(u2).length) tx.update(torRef, u2);
      });
    } catch (e) { /* raced */ }
    for (const [w, amt] of bountyCuts) await creditBalance(w, t.clubId || "main", amt);
  }

  // Single survivor → table finished (MTT non-final tables wait for the orchestrator instead)
  const aliveHere = Object.values(plAfter).filter((q) => (q.stack || 0) > 0);
  if (aliveHere.length === 1 && !(tour.mttMode && !tour.final)) {
    await tRef(tableId).update({tournament: {...tour, finished: true, tableWinner: aliveHere[0].uid}}).catch(() => {});
  }
}

async function logHandResults(t, eng, plAfter, finish) {
  try {
    const start = eng.startStacks || {};
    const now = Date.now();
    const parts = (finish && finish.participants) || [];
    const share = parts.length ? round2((finish && finish.rake || 0) / parts.length) : 0;
    for (const p of Object.values(plAfter)) {
      if (!(p.uid in start)) continue;
      const profit = round2((p.stack || 0) - start[p.uid]);
      const rake = parts.includes(p.uid) ? share : 0;
      if (profit === 0 && rake === 0) continue;
      db.collection("gameLog").add({uid: p.uid, username: p.name || "", clubId: t.clubId || "main", game: "poker", profit, rake, tableId: eng.tableId || "", at: now}).catch(() => {});
    }
  } catch (e) { /* best-effort */ }
}

// ── Core: finish paths (mutate g/pl; return {reveal} extra public updates) ──
function finishEarlyWin(t, g, pl, winnerUid, eng) {
  gatherBetsToPots(g, pl);
  // Rabbit hunt: the board's future is fixed in the shuffled deck (no burns) —
  // publish the would-be runout so players can peek at what never came.
  g.rabbit = (eng && (g.board || []).length < 5) ? (eng.deck || []).slice(0, 5 - (g.board || []).length) : null;
  const pot = round2((g.pots || []).reduce((s, p) => s + p.amount, 0));
  const rakeFrac = (Number((t.settings || {}).rakePercent) || 0) / 100;
  const rake = (g.board || []).length > 0 ? round2(pot * rakeFrac) : 0; // No Flop No Drop
  pl[winnerUid].stack = round2(pl[winnerUid].stack + pot - rake);
  pl[winnerUid].actionText = "WINNER";
  g.pots = []; g.phase = "showdown"; g.activeTurnUid = null;
  g.earlyWin = true;
  g.lastWinAmount = round2(pot - rake);
  g.lastWinners = pl[winnerUid].name;
  g.showdownAt = Date.now();
  return {rake, g, participants: Object.values(pl).filter((q) => (q.cardCount || 0) > 0).map((q) => q.uid)};
}

function runShowdown(t, g, pl, eng) {
  const hands = eng.hands || {};
  const acts = Object.values(pl).filter((p) => p.status === "active");
  // Run It Twice: build the second board (shares everything dealt pre-agreement)
  if (g.rit && !g.board2) {
    const shared = (g.board || []).slice(0, g.ritFrom || 0);
    const b2 = [...shared];
    while (b2.length < 5 && (eng.deck || []).length) b2.push(eng.deck.shift());
    g.board2 = b2;
  }
  const boards = (g.rit && (g.board2 || []).length === 5) ? [g.board || [], g.board2] : [g.board || []];
  const scoreSets = boards.map((bd) => { const sc = {}; acts.forEach((p) => sc[p.uid] = bestScore(hands[p.uid] || [], bd, g.currentGameType)); return sc; });
  let rakeTotal = 0;
  const winnerNames = new Set();
  let winTotal = 0;
  const rakeFrac = (Number((t.settings || {}).rakePercent) || 0) / 100;
  (g.pots || []).forEach((pot, idx) => {
    const elig = (pot.eligible || []).filter((uid) => pl[uid] && pl[uid].status === "active");
    if (elig.length === 0) return;
    let amount = pot.amount;
    if (idx === 0) { const r = round2(amount * rakeFrac); rakeTotal = round2(rakeTotal + r); amount = round2(amount - r); }
    // one board → whole pot on it; two boards → half the pot decided by EACH board
    const halves = scoreSets.length === 2 ? [round2(amount / 2), round2(amount - round2(amount / 2))] : [amount];
    halves.forEach((amt, bi) => {
      const scores = scoreSets[bi];
      let bestS = -1; let winners = [];
      elig.forEach((uid) => { const sc = scores[uid] || 0; if (sc > bestS) { bestS = sc; winners = [uid]; } else if (sc === bestS) winners.push(uid); });
      const share = Math.floor((amt / winners.length) * 100) / 100;
      // Odd cents from an uneven split go to the first winner — chips never vanish.
      const oddCents = round2(amt - share * winners.length);
      winTotal = round2(winTotal + amt);
      winners.forEach((uid, wi) => { pl[uid].stack = round2(pl[uid].stack + share + (wi === 0 ? oddCents : 0)); pl[uid].actionText = "WINNER"; winnerNames.add(pl[uid].name); });
    });
  });
  g.pots = []; g.phase = "showdown"; g.activeTurnUid = null; g.earlyWin = false;
  g.lastWinAmount = winTotal;
  g.lastWinners = [...winnerNames].join(", ");
  g.showdownAt = Date.now();
  // showdown is public: reveal every remaining hand in the public doc
  acts.forEach((p) => { pl[p.uid].cards = hands[p.uid] || []; });
  return {rake: rakeTotal, g, participants: Object.values(pl).filter((q) => (q.cardCount || 0) > 0).map((q) => q.uid)};
}

function dealBoard(g, deck, n) {
  for (let i = 0; i < n; i++) { const c = deck.shift(); if (c) g.board.push(c); }
}

function advancePhase(t, g, pl, eng) {
  gatherBetsToPots(g, pl);
  Object.values(pl).forEach((p) => { if (p.status === "active") { p.hasActed = false; if (p.actionText !== "All-in") p.actionText = ""; } });
  g.highestBet = 0;
  g.minRaise = round2((Number((t.settings || {}).blinds) || 0.5) * 2);
  const deck = eng.deck;
  if (g.phase === "preflop") {
    dealBoard(g, deck, 3);
    if (g.currentGameType === "Pineapple" && !g.allInReveal) {
      // Pineapple: every active player throws one of their 3 cards before flop betting
      const needs = activesOf(pl).some((p) => ((eng.hands || {})[p.uid] || []).length === 3);
      if (needs) { g.phase = "discard"; g.activeTurnUid = null; g.turnStartedAt = Date.now(); return null; }
    }
    g.phase = "flop";
  } else if (g.phase === "discard") { g.phase = "flop"; }
  else if (g.phase === "flop") { dealBoard(g, deck, 1); g.phase = "turn"; }
  else if (g.phase === "turn") { dealBoard(g, deck, 1); g.phase = "river"; }
  else if (g.phase === "river") return runShowdown(t, g, pl, eng);
  // All-in runout: fewer than 2 players can still act → reveal everyone's hands
  // and deal the rest of the board ONE STREET AT A TIME. The tick brings the next
  // street after a dramatic pause, so players actually SEE the turn and the river
  // land before the showdown — never a jump-cut from all-in to "hand over".
  const canAct = activesOf(pl).filter((p) => (p.stack || 0) > 0);
  if (canAct.length < 2) {
    g.allInReveal = true;
    Object.values(pl).forEach((p) => { if (p.status === "active") p.cards = eng.hands[p.uid] || []; });
    g.activeTurnUid = null;
    g.runoutAt = Date.now();
    // Run It Twice (table option): open a 5.5s opt-in window for every live
    // player before the rest of the board runs. Cards already visible are shared.
    if ((t.settings || {}).runTwice && !g.rit && !g.ritOffer && (g.board || []).length < 5 && Object.values(pl).filter((q) => q.status === "active").length >= 2) {
      g.ritOffer = {until: Date.now() + 5500};
      g.ritAgree = {};
      g.ritFrom = (g.board || []).length;
    }
    return null;
  }
  g.activeTurnUid = firstAfterDealer(g, pl);
  g.turnStartedAt = Date.now();
  return null;
}

// Apply one action; returns finish info or null. Mutates g/pl.
function applyAction(t, g, pl, eng, actorUid, type, targetBet) {
  const p = pl[actorUid];
  if (!p || p.status !== "active") throw new HttpsError("failed-precondition", "Not in the hand");
  if (g.activeTurnUid !== actorUid) throw new HttpsError("failed-precondition", "Not your turn");
  const toCall = round2(Math.max(0, (g.highestBet || 0) - (p.bet || 0)));
  if (g.aof) {
    // All-In-or-Fold hand: jam or fold (checking with nothing to call stays legal).
    if (type === "raise") targetBet = round2((p.bet || 0) + p.stack);
    if (type === "call" && toCall > 0 && toCall < p.stack) throw new HttpsError("failed-precondition", "All-in or Fold hand");
  }
  if (type === "fold") { p.status = "folded"; p.actionText = "Fold"; p.hasActed = true; }
  else if (type === "call") {
    const pay = Math.min(toCall, p.stack);
    p.stack = round2(p.stack - pay); p.bet = round2((p.bet || 0) + pay);
    p.actionText = toCall === 0 ? "Check" : (p.stack === 0 ? "All-in" : "Call");
    p.hasActed = true;
  } else if (type === "raise") {
    let target = round2(Number(targetBet) || 0);
    const maxBet = round2((p.bet || 0) + p.stack);
    // Pot-Limit (the Omaha default; omahaPotLimit=false → NLO plays no-limit):
    // max raise-to = highestBet + toCall + pot-after-call.
    if (String(g.currentGameType || "").startsWith("Omaha") && ((t.settings || {}).omahaPotLimit !== false)) {
      const potNow = round2((g.pots || []).reduce((s2, x) => s2 + x.amount, 0) + Object.values(pl).reduce((s2, q) => s2 + (q.bet || 0), 0));
      const cap = round2((g.highestBet || 0) + potNow + toCall);
      if (target > cap) target = cap;
    }
    if (target >= maxBet) target = maxBet; // all-in
    else {
      const minTarget = round2((g.highestBet || 0) + (g.minRaise || 0));
      if (target < minTarget) throw new HttpsError("invalid-argument", "Raise below minimum");
    }
    const add = round2(target - (p.bet || 0));
    if (add <= 0 || add > p.stack + 0.001) throw new HttpsError("invalid-argument", "Bad raise amount");
    if (target > (g.highestBet || 0)) {
      g.minRaise = round2(Math.max(g.minRaise || 0, target - (g.highestBet || 0)));
      g.highestBet = target;
      Object.values(pl).forEach((q) => { if (q.uid !== actorUid && q.status === "active" && q.stack > 0) q.hasActed = false; });
    }
    p.stack = round2(p.stack - add); p.bet = target;
    p.actionText = p.stack === 0 ? "All-in" : "Raise";
    p.hasActed = true;
  } else throw new HttpsError("invalid-argument", "Unknown action");

  // Street-by-street action log for the hand-history view (small: ≤ a few dozen rows)
  g.actions = [...(g.actions || []), {n: p.name || "", a: p.actionText, amt: type === "fold" ? 0 : round2(p.bet || 0), ph: g.phase}].slice(-80);

  const remaining = Object.values(pl).filter((q) => q.status === "active");
  if (remaining.length === 1) return finishEarlyWin(t, g, pl, remaining[0].uid, eng);
  const nxt = nextActor(g, pl, actorUid);
  if (!nxt) return advancePhase(t, g, pl, eng);
  g.activeTurnUid = nxt; g.turnStartedAt = Date.now();
  return null;
}

function markBusted(pl) {
  Object.values(pl).forEach((q) => {
    if ((q.stack || 0) <= 0 && (q.cardCount || 0) > 0 && !["busted", "out"].includes(q.status)) { q.status = "busted"; q.bustedAt = Date.now(); }
  });
}

// ── Deal a fresh hand (internal; caller must hold nothing — runs its own tx) ──
async function dealHand(tableId, chosenType) {
  let finishInfo = null;
  const topUpRefunds = []; // [uid, clubId, amt] — clipped queue remainders go BACK to the wallet
  await db.runTransaction(async (tx) => {
    topUpRefunds.length = 0; // tx may retry — never refund twice
    const tS = await tx.get(tRef(tableId));
    if (!tS.exists) throw new HttpsError("not-found", "Table gone");
    const t = tS.data();
    const s = t.settings || {};
    if (!s.serverEngine) throw new HttpsError("failed-precondition", "Not a server table");

    const g0 = t.gameState || {};
    // "dc_selection" is allowed here too: when a Dealer's-Choice pick comes in
    // (pkPickGame) or the pick times out (pkTick), we deal straight from that phase.
    if (!["waiting", "showdown", "dc_selection"].includes(g0.phase)) throw new HttpsError("failed-precondition", "Hand in progress");
    if (s.spinMode && (!t.spin || Date.now() < (t.spinStartAt || 0))) throw new HttpsError("failed-precondition", "Waiting for the wheel");
    const pl = JSON.parse(JSON.stringify(t.players || {}));
    Object.values(pl).forEach((p) => {
      // Queued top-up (player asked to add chips mid-hand): apply it now, at the
      // start of the next hand, capped to the table's max buy-in. Wallet was
      // already debited when the request was made.
      if (p.pendingTopUp && p.pendingTopUp > 0 && !["busted", "out"].includes(p.status)) {
        const cap = maxBuyOf(s);
        const room = cap ? Math.max(0, round2(cap - (p.stack || 0))) : (p.pendingTopUp || 0);
        const add = Math.min(round2(p.pendingTopUp), room);
        if (add > 0) p.stack = round2((p.stack || 0) + add);
        // The wallet was debited for the FULL queued amount — anything the table
        // cap clips off must go back to the wallet, never evaporate.
        const clipped = round2((p.pendingTopUp || 0) - add);
        if (clipped > 0 && !p.isBot) topUpRefunds.push([p.uid, t.clubId || "main", clipped]);
        p.pendingTopUp = 0;
      }
      // Busted BOT refills BETWEEN hands (cash only): a fresh buy-in sized to the
      // table — around the average live stack, clamped to the buy-in window — so
      // bot tables keep playing at natural depths without a human topping them up.
      if (p.isBot && !t.tournamentId && (p.stack || 0) <= 0) {
        const bb2 = round2((Number(s.blinds) || 0.5) * 2);
        const live = Object.values(pl).filter((q) => q.uid !== p.uid && (q.stack || 0) > 0).map((q) => q.stack);
        const avg = live.length ? live.reduce((a2, b2) => a2 + b2, 0) / live.length : bb2 * 100;
        const cap = maxBuyOf(s) || avg;
        p.stack = round2(Math.max(bb2 * 40, Math.min(avg, cap)));
        p.status = "waiting"; p.bustedAt = null;
      }
      // Deferred sit-out (tapped ☕ mid-hand): the rule everywhere is that state
      // changes apply BETWEEN hands, never inside one.
      if (p.sitOutNext) { p.sitOut = true; p.sitOutAt = Date.now(); p.sitAuto = false; p.sitOutNext = false; }
      // Leaving at hand's end — never dealt into the next hand (removal races the deal).
      if (p.leaveReq && !t.tournamentId) { p.sitOut = true; if (!p.sitOutAt) p.sitOutAt = Date.now(); }
      p.cards = []; p.cardCount = 0; p.bet = 0; p.actionText = ""; p.hasActed = false; p.reveal = false;
      // Tournament: sit-out players are still dealt (blinds burn, auto-folded by the tick);
      // out/busted stay out. Cash: sit-out means skipped.
      p.status = p.stack > 0
        ? ((p.sitOut && !t.tournamentId) ? "sitout" : "active")
        : (["busted", "out"].includes(p.status) ? p.status : "sitout");
    });
    const acts = activesOf(pl);
    if (acts.length < 2) {
      // Not enough players: the felt must read as IDLE — a stale board with a
      // lone sitting-out player looked like a broken table.
      tx.update(tRef(tableId), {players: pl, "gameState.phase": "waiting", "gameState.activeTurnUid": null, "gameState.board": [], "gameState.pots": [], "gameState.lastWinners": null, "gameState.lastWinAmount": 0, "gameState.rabbit": null, "gameState.allInReveal": false, "gameState.earlyWin": false});
      return;
    }
    let gameType = chosenType || g0.currentGameType || s.baseGameType || "NLH";
    if (!GAME_CARDS[gameType]) gameType = s.baseGameType || "NLH";
    // Dealer's Choice: the choosing seat rotates backwards; when it's the dealer's
    // pick and no game was chosen yet this hand → pause in dc_selection.
    if (s.isDealerChoice) {
      const uids = acts.map((p) => p.uid);
      const prevSeat0 = (pl[g0.dealerUid] || {}).seatIndex ?? -1;
      const ord0 = acts.filter((p) => p.seatIndex > prevSeat0).concat(acts.filter((p) => p.seatIndex <= prevSeat0));
      const nextDealerUid = ord0[0].uid;
      let dcUid = g0.dcUid || null;
      let dcAnchor = g0.dcAnchor || null;
      if (!dcUid || uids.indexOf(dcUid) === -1 || !dcAnchor || uids.indexOf(dcAnchor) === -1) {
        dcAnchor = nextDealerUid;
        dcUid = uids[(uids.indexOf(nextDealerUid) - 1 + uids.length) % uids.length];
      } else if (nextDealerUid === dcAnchor) {
        dcUid = uids[(uids.indexOf(dcUid) - 1 + uids.length) % uids.length];
      }
      if (nextDealerUid === dcUid && !chosenType) {
        tx.update(tRef(tableId), {players: pl, gameState: {
          ...g0, phase: "dc_selection", dealerUid: nextDealerUid, dcUid, dcAnchor,
          board: [], pots: [], activeTurnUid: null, turnStartedAt: Date.now(),
          lastWinners: null, lastWinAmount: 0, allInReveal: false, earlyWin: false, rabbit: null,
        }});
        return;
      }
      g0.dcUid = dcUid; g0.dcAnchor = dcAnchor;
    }
    // ── Special-hand cadence (table options): Bomb Pot / All-In-or-Fold ──
    const handNo = (Number(t.handCounter) || 0) + 1;
    const bombN = Number(s.bombEvery) || 0;
    const isBomb = bombN > 0 && gameType !== "Pineapple" && !t.tournamentId && handNo % bombN === 0;
    const aofN = s.aofEvery === "orbit" ? Math.max(2, acts.length) : (Number(s.aofEvery) || 0);
    const isAof = !isBomb && aofN > 0 && !t.tournamentId && handNo % aofN === 0;
    const nCards = GAME_CARDS[gameType] || 2;
    const deck = pokerDeck();
    const hands = {};
    // Hole cards are stored sorted high→low, so every consumer (player view,
    // GOD peek, showdown reveal, discard-by-index) sees the same tidy order.
    const ORD = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14};
    acts.forEach((p) => { hands[p.uid] = deck.splice(0, nCards).sort((a, b) => ((ORD[b.val] || 0) - (ORD[a.val] || 0)) || String(a.suit).localeCompare(String(b.suit))); p.cardCount = nCards; });
    // dealer rotation
    const prevSeat = (pl[g0.dealerUid] || {}).seatIndex ?? -1;
    const order = acts.filter((p) => p.seatIndex > prevSeat).concat(acts.filter((p) => p.seatIndex <= prevSeat));
    const dealer = order[0];
    let sb = round2(Number(s.blinds) || 0.5);
    let bb = round2(sb * 2);
    if (s.spinMode && t.spinStartAt) {
      // Hyper structure: blinds double every 4 minutes (cap ×32) so a spin game always ends
      const lvl2 = Math.max(0, Math.floor((Date.now() - t.spinStartAt) / 240000));
      const esc = Math.min(32, Math.pow(2, lvl2));
      sb = round2(sb * esc); bb = round2(sb * 2);
    }
    let anteAmt = 0;
    const tour = t.tournament || null;
    if (tour) {
      const lvl = tourLevelOf(tour);
      sb = TOUR_SCHEDULE[lvl][0]; bb = TOUR_SCHEDULE[lvl][1];
      anteAmt = lvl >= (tour.anteFromLevel ?? 4) ? sb : 0;
    }
    let anteTotal = 0;
    if (anteAmt > 0) acts.forEach((p) => { const a = Math.min(anteAmt, p.stack); p.stack = round2(p.stack - a); anteTotal = round2(anteTotal + a); });
    let sbP; let bbP; let firstUid;
    if (acts.length === 2) {
      sbP = dealer; bbP = order[1]; firstUid = dealer.uid;
    } else {
      sbP = order[1]; bbP = order[2]; firstUid = (order[3] || order[0]).uid;
    }
    const post = (p, amt, label) => { const pay = Math.min(amt, p.stack); p.stack = round2(p.stack - pay); p.bet = round2(pay); p.actionText = label; };
    if (isBomb) {
      // Bomb pot: everyone antes X BB, NO preflop betting — straight to the flop.
      const ba = round2(Math.max(1, Number(s.bombAnte) || 2) * bb);
      acts.forEach((p) => { const a = Math.min(ba, p.stack); p.stack = round2(p.stack - a); anteTotal = round2(anteTotal + a); p.actionText = "BOMB"; });
    } else { post(sbP, sb, "SB"); post(bbP, bb, "BB"); }
    // ── Straddle chain (armed players only, consecutive, poker-legal): the first
    // player after the BB may straddle 2×BB, the NEXT one may double to 4×BB,
    // the next triple to 8×BB (cap by table setting). The chain simply stops
    // when there's no eligible armed player — so 3-handed only the single
    // (button) straddle is possible, exactly per the rules. Action reopens
    // left of the LAST straddler; he acts last preflop. ──
    let strAmt = 0; let strLastUid = null; const strActions = [];
    if (!isBomb && s.straddle && !t.tournamentId && !isAof) {
      const maxStr = Math.max(1, Math.min(3, Number(s.straddleMax) || 1));
      const ordAll = acts.filter((p2) => p2.seatIndex > bbP.seatIndex).concat(acts.filter((p2) => p2.seatIndex <= bbP.seatIndex));
      const afterBB = ordAll.filter((p2) => p2.uid !== sbP.uid && p2.uid !== bbP.uid);
      let amt = bb;
      for (let i2 = 0; i2 < Math.min(maxStr, afterBB.length); i2++) {
        const q = afterBB[i2];
        if (!q.straddleNext || (q.stack || 0) <= 0) break;   // chain must be consecutive volunteers
        amt = round2(amt * 2);
        const pay = Math.min(amt, q.stack);
        q.stack = round2(q.stack - pay); q.bet = round2(pay); q.actionText = i2 === 0 ? "STR" : i2 === 1 ? "STR×2" : "STR×3";
        strActions.push({n: q.name || "", a: q.actionText, amt: pay, ph: "preflop"});
        strAmt = amt; strLastUid = q.uid;
        if (pay < amt) break;                                 // short straddle ends the chain
      }
    }
    const g = {
      phase: "preflop", deck: [], board: [], pots: anteTotal > 0 ? [{amount: anteTotal, eligible: acts.map((p) => p.uid)}] : [], highestBet: isBomb ? 0 : bb, minRaise: bb,
      dealerUid: dealer.uid, dcUid: g0.dcUid || null, dcAnchor: g0.dcAnchor || null, currentGameType: gameType,
      activeTurnUid: firstUid, turnStartedAt: Date.now(), lastWinners: null, lastWinAmount: 0,
      allInReveal: false, earlyWin: false, showdownAt: null, rabbit: null, bombPot: isBomb, aof: isAof,
      actions: isBomb ? [] : [{n: sbP.name || "", a: "SB", amt: sb, ph: "preflop"}, {n: bbP.name || "", a: "BB", amt: bb, ph: "preflop"}],
    };
    if (isBomb) {
      dealBoard(g, deck, 3);
      g.phase = "flop";
      g.activeTurnUid = firstAfterDealer(g, pl);
    }
    if (strAmt > 0) {
      // Straddle live: it's the new blind level; first action left of the last straddler
      g.highestBet = strAmt; g.minRaise = strAmt;
      g.actions = [...g.actions, ...strActions];
      const ordAct = activesOf(pl);
      const si = ordAct.findIndex((p2) => p2.uid === strLastUid);
      if (si >= 0 && ordAct.length > 1) { g.activeTurnUid = ordAct[(si + 1) % ordAct.length].uid; g.turnStartedAt = Date.now(); }
    }
    const startStacks = {};
    acts.forEach((p) => { startStacks[p.uid] = round2((p.stack || 0) + (p.bet || 0)); });
    tx.set(eRef(tableId), {deck, hands, startStacks, tableId, at: Date.now()});
    for (const p of acts) tx.set(pRef(tableId, p.uid), {cards: hands[p.uid], at: Date.now()});
    tx.update(tRef(tableId), {players: pl, gameState: g, handCounter: handNo});
  });
  for (const [uid, clubId, amt] of topUpRefunds) await creditBalance(uid, clubId, amt);
  return finishInfo;
}

// ── Post-finish bookkeeping (rake, logs, busted) done outside the tx ──
async function afterFinish(tableId, t, finish, plAfter, eng) {
  if (!finish) return;
  markBusted(plAfter);
  // Hand history — muck-safe by construction: plAfter[uid].cards is only populated for
  // hands made public (showdown/all-in/voluntary reveal); everyone else stores a count only.
  const g2 = finish.g || {};
  const histEntry = {
    at: Date.now(), game: g2.currentGameType || "NLH", board: g2.board || [], board2: g2.board2 || null,
    acts: g2.actions || [], // street-by-street action log (SB/BB/raises/calls/folds)
    rake: finish.rake || 0, amount: g2.lastWinAmount || 0, winners: g2.lastWinners || "",
    ps: Object.values(plAfter).filter((q) => (q.cardCount || 0) > 0).map((q) => ({
      n: q.name || "", c: (q.cards && q.cards.length) ? q.cards : null, cc: q.cardCount || 0,
      w: q.actionText === "WINNER", f: q.status === "folded",
    })),
  };
  const hist = [...(t.history || []), histEntry].slice(-100);
  await tRef(tableId).update({players: plAfter, history: hist}).catch(() => {});
  if (t.tournamentId) {
    const winnersUids = Object.values(plAfter).filter((q) => q.actionText === "WINNER").map((q) => q.uid);
    await tourAfterHand(tableId, t, plAfter, winnersUids);
  } else if ((t.settings || {}).spinMode) {
    await spinAfterHand(tableId, t, plAfter); // no rake, no per-hand money log — chips are tournament chips
  } else {
    distributeRake(t.clubId || "main", finish.rake, finish.participants);
    logHandResults(t, eng, plAfter, finish);
  }
}

// Run one engine step inside a transaction and persist. op(t, g, pl, eng) → finish|null
async function engineStep(tableId, op) {
  let out = null;
  await db.runTransaction(async (tx) => {
    const [tS, eS] = await Promise.all([tx.get(tRef(tableId)), tx.get(eRef(tableId))]);
    if (!tS.exists) throw new HttpsError("not-found", "Table gone");
    const t = tS.data();
    if (!(t.settings || {}).serverEngine) throw new HttpsError("failed-precondition", "Not a server table");
    const eng = eS.exists ? eS.data() : {deck: [], hands: {}, startStacks: {}};
    const g = JSON.parse(JSON.stringify(t.gameState || {}));
    const pl = JSON.parse(JSON.stringify(t.players || {}));
    const finish = op(t, g, pl, eng);
    tx.update(tRef(tableId), {gameState: g, players: pl});
    tx.set(eRef(tableId), eng);
    out = {t, g, pl, eng, finish};
  });
  if (out && out.finish) await afterFinish(tableId, out.t, out.finish, out.pl, out.eng);
  return out;
}

// ── Bot decision: server knows the bot's cards → simple strength-based play ──
// ── Bot brain: plays like a solid, believable human — using ONLY its own cards
// and the board (never peeks at opponents or the deck). Real hand classes,
// draw awareness, pot odds, mixed frequencies, and pot-commitment: it will call
// down with second pair when the price is right, but it never spazzes all-in
// without the goods, and it never folds a crumb stack into a big pot. ──
const RANKV = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14};

function botEquity(hole, board, gameType) {
  // Postflop: classify the MADE hand relative to the board + add draw equity.
  const sc = bestScore(hole, board, gameType);
  const bRanks = board.map((c) => RANKV[c.val]).sort((a, b) => b - a);
  let eq;
  if (sc >= 5000000) eq = 0.93;                    // flush or better
  else if (sc >= 4000000) eq = 0.88;               // straight
  else if (sc >= 3000000) eq = 0.80;               // trips/set
  else if (sc >= 2000000) eq = 0.70;               // two pair
  else if (sc >= 1000000) {
    const pr = Math.floor((sc - 1000000) / 10000); // the pair's rank
    if (pr >= bRanks[0]) eq = 0.58;                // top pair / overpair
    else if (pr >= (bRanks[1] || 0)) eq = 0.46;    // second pair — worth a fair price
    else eq = 0.34;                                // weak pair
  } else {
    const hv = hole.map((c) => RANKV[c.val]).sort((a, b) => b - a);
    eq = hv[0] === 14 ? 0.26 : 0.18;               // ace-high / air
  }
  if (board.length < 5) {
    // Draws (simple + honest): flush draw = 4 of a suit, straight draws by window scan
    const suits = {};
    [...hole, ...board].forEach((c) => suits[c.suit] = (suits[c.suit] || 0) + 1);
    const myS = {}; hole.forEach((c) => myS[c.suit] = (myS[c.suit] || 0) + 1);
    const fd = Object.keys(suits).some((s2) => suits[s2] === 4 && (myS[s2] || 0) >= 1);
    const rs = new Set([...hole, ...board].map((c) => RANKV[c.val]));
    if (rs.has(14)) rs.add(1);
    let bestWin = 0;
    for (let lo = 1; lo <= 10; lo++) {
      let hit = 0;
      for (let v = lo; v < lo + 5; v++) if (rs.has(v)) hit++;
      bestWin = Math.max(bestWin, hit);
    }
    if (fd) eq = Math.min(0.9, eq + 0.17);
    if (bestWin === 4 && sc < 4000000) eq = Math.min(0.9, eq + 0.13); // open/gutshot family
  }
  return eq;
}

function botPreflop(hole, gameType) {
  const hv = hole.map((c) => RANKV[c.val]).sort((a, b) => b - a);
  const suited = new Set(hole.map((c) => c.suit)).size < hole.length;
  const paired = new Set(hole.map((c) => c.val)).size < hole.length;
  if ((gameType || "").startsWith("Omaha")) {
    // rough Omaha strength: pairs + suitedness + connectivity + high cards
    let eq = 0.30 + (paired ? 0.14 : 0) + (suited ? 0.07 : 0) + (hv[0] >= 13 ? 0.08 : 0) + (hv[1] >= 11 ? 0.05 : 0);
    const gaps = hv.slice(0, -1).map((v, i2) => v - hv[i2 + 1]);
    if (gaps.every((d2) => d2 <= 2)) eq += 0.07;
    return Math.min(0.8, eq);
  }
  if (paired) return hv[0] >= 12 ? 0.88 : hv[0] >= 9 ? 0.72 : 0.55;
  if (hv[0] === 14 && hv[1] >= 12) return suited ? 0.75 : 0.70;    // AK/AQ
  if (hv[0] >= 11 && hv[1] >= 10) return suited ? 0.62 : 0.56;     // broadways
  if (hv[0] === 14) return suited ? 0.5 : 0.42;                    // Ax
  if (suited && hv[0] - hv[1] === 1 && hv[1] >= 5) return 0.5;     // suited connectors
  if (hv[0] >= 10) return 0.36;
  return 0.24;
}

// The shuffle already fixed the future: the deck order determines the exact final
// board, so among the CURRENT live hands the showdown winner is already decided.
function botOracle(g, pl, eng) {
  const acts = Object.values(pl).filter((q) => q.status === "active");
  const board = g.board || [];
  const finalBoard = [...board, ...((eng.deck || []).slice(0, Math.max(0, 5 - board.length)))];
  let best = -1; let winners = [];
  acts.forEach((q) => {
    const sc = bestScore((eng.hands || {})[q.uid] || [], finalBoard, g.currentGameType);
    if (sc > best) { best = sc; winners = [q.uid]; } else if (sc === best) winners.push(q.uid);
  });
  return winners;
}

// ── Spin & Cash: 3-player hyper SNG. The wheel decides the prize BEFORE play.
// House math (pool = 3×buy-in): ×2 @50% (+1 buy-in to house), ×3 @40% (even),
// ×4 @5%, ×5 @2.8%, ×10 @1.2%, ×20 @0.5%, free-ticket @0.5%. The ×100 slice is
// pure display — probability zero. House EV ≈ +0.22 buy-ins per game, always
// positive long-term. No rake, no agent cut — the edge IS the wheel curve. ──
const SPIN_WHEEL = [
  {m: 2, p: 0.50}, {m: 3, p: 0.40}, {m: 4, p: 0.05}, {m: 5, p: 0.028},
  {m: 10, p: 0.012}, {m: 20, p: 0.005}, {m: "ticket", p: 0.005},
];
async function armSpin(tableId) {
  try {
    await db.runTransaction(async (tx) => {
      const sn = await tx.get(tRef(tableId));
      if (!sn.exists) return;
      const t = sn.data();
      const s = t.settings || {};
      if (!s.spinMode || t.spin || (t.gameState || {}).phase !== "waiting") return;
      if (Object.keys(t.players || {}).length < (Number(s.maxPlayers) || 3)) return;
      const r = crypto.randomInt(100000) / 100000;
      let acc = 0; let out = SPIN_WHEEL[0];
      for (const o of SPIN_WHEEL) { acc += o.p; if (r < acc) { out = o; break; } }
      const mult = out.m === "ticket" ? 3 : out.m;
      const buy = round2(Number(s.spinBuyIn) || 50);
      tx.update(tRef(tableId), {
        spin: {mult, ticket: out.m === "ticket", prize: round2(buy * mult), at: Date.now(), near: mult <= 3 && crypto.randomInt(4) === 0},
        spinStartAt: Date.now() + 9000,
      });
    });
  } catch (e) { /* raced */ }
}
async function spinAfterHand(tableId, t, plAfter) {
  const s = t.settings || {};
  const alive = Object.values(plAfter).filter((q) => (q.stack || 0) > 0);
  if (alive.length !== 1 || !t.spin || t.spinDone) return;
  let won = false;
  try {
    await db.runTransaction(async (tx) => {
      const sn = await tx.get(tRef(tableId));
      if (!sn.exists || sn.data().spinDone) return;
      tx.update(tRef(tableId), {spinDone: true, spinWinner: alive[0].uid});
      won = true;
    });
  } catch (e) { return; }
  if (!won) return;
  const w = alive[0];
  const clubId = t.clubId || "main";
  const buy = round2(Number(s.spinBuyIn) || 50);
  await creditBalance(w.uid, clubId, t.spin.prize);
  if (t.spin.ticket && !w.isBot) {
    try {
      const r = db.doc(`memberships/${w.uid}_${clubId}`);
      await db.runTransaction(async (tx) => { const sn = await tx.get(r); if (sn.exists) tx.update(r, {spinTickets: (sn.data().spinTickets || 0) + 1}); });
    } catch (e) { /* best-effort */ }
  }
  // Results (settlement-visible, dedup-safe via the tournament: prefix). No rake, no agent cut.
  const now = Date.now();
  for (const q of Object.values(plAfter)) {
    const profit = q.uid === w.uid ? round2(t.spin.prize - buy) : -buy;
    db.collection("gameLog").add({uid: q.uid, username: q.name || "", clubId, game: "poker", profit, rake: 0, tableId: `tournament:spin_${tableId}`, at: now}).catch(() => {});
  }
  // Respawn: a fresh Spin & Cash table with the SAME settings opens immediately.
  db.collection("tables").add({
    type: "poker", clubId, createdAt: Date.now(),
    settings: {...s},
    players: {}, chat: [], leftStacks: {},
    gameState: {phase: "waiting", deck: [], board: [], pots: [], highestBet: 0, minRaise: round2((Number(s.blinds) || 0.5) * 2), dealerUid: null, dcUid: null, dcAnchor: null, currentGameType: s.baseGameType || "NLH", activeTurnUid: null, turnStartedAt: null, lastWinners: null, lastWinAmount: 0, allInReveal: false},
  }).catch(() => {});
}

// ── Bot rotation (cash): every ~20-45 min one bot stands up between hands and a
// fresh face sits down, so a table never shows the same lineup for days. The
// swap is 1:1 ONLY while the table keeps ≥2 seats open for real players —
// otherwise the leaver isn't replaced and the bots thin out. ──
const SRV_BOT_FIRST = ["יוסי", "דודו", "אבי", "שלומי", "רמי", "קובי", "אלי", "מאיר", "אורן", "נדב", "מוטי", "דורון", "רועי", "עידן", "ליאור", "תומר", "אסף", "ניר", "גיא", "ברק", "Roy", "Idan", "Lior", "Tomer", "Omer", "Assaf", "Alon", "Barak", "Tal", "Yuval", "Eyal", "Ronen", "Shay", "Eran", "Danny", "Rafi"];
const SRV_BOT_LAST = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אוחיון", "דהן", "חדד", "גבאי", "אזולאי", "מלכה", "עמר", "שרעבי", "אלבז", "אמסלם", "אדרי", "סבן", "טולדנו", "בוזגלו", "ממן", "Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Ohayon", "Dahan", "Hadad", "Gabay", "Azulay", "Malka", "Amar", "Elbaz", "Saban", "Toledano", "Maman", "Hazan", "Vaknin", "Avitan", "Shitrit"];
async function rotateBots(tableId) {
  try {
    await db.runTransaction(async (tx) => {
      const sn = await tx.get(tRef(tableId));
      if (!sn.exists) return;
      const t = sn.data();
      const g = t.gameState || {};
      if (t.tournamentId || !["waiting", "showdown"].includes(g.phase)) return;
      const pl = {...(t.players || {})};
      const bots = Object.values(pl).filter((q) => q.isBot);
      if (!bots.length) return;
      const now = Date.now();
      const next = now + (20 + crypto.randomInt(25)) * 60000;
      if (!t.botRotAt) { tx.update(tRef(tableId), {botRotAt: next}); return; }
      if (now < t.botRotAt) return;
      const maxP = Number((t.settings || {}).maxPlayers) || 9;
      const seats = Object.keys(pl).length;
      const out = bots[crypto.randomInt(bots.length)];
      delete pl[out.uid];
      const upd = {botRotAt: next, [`players.${out.uid}`]: FieldValue.delete()};
      if (maxP - seats >= 2) {
        const names = new Set(Object.values(pl).map((q) => q.name));
        const keys = new Set(Object.values(pl).map((q) => String(q.name || "").split(" ").pop()));
        let nm = null;
        for (let i = 0; i < 60 && !nm; i++) {
          const cand = SRV_BOT_FIRST[crypto.randomInt(SRV_BOT_FIRST.length)] + " " + SRV_BOT_LAST[crypto.randomInt(SRV_BOT_LAST.length)];
          if (!names.has(cand) && !keys.has(cand.split(" ").pop())) nm = cand;
        }
        if (nm) {
          const taken = new Set(Object.values(pl).map((q) => q.seatIndex));
          let si = 0; while (taken.has(si)) si++;
          const bb2 = round2((Number((t.settings || {}).blinds) || 0.5) * 2);
          const live = Object.values(pl).filter((q) => (q.stack || 0) > 0).map((q) => q.stack);
          const avg = live.length ? live.reduce((a2, b2) => a2 + b2, 0) / live.length : bb2 * 100;
          const cap = maxBuyOf(t.settings) || avg;
          const uid2 = `bot_${now}_${crypto.randomInt(1e9).toString(36)}`;
          upd[`players.${uid2}`] = {uid: uid2, name: nm, seatIndex: si, stack: round2(Math.max(bb2 * 40, Math.min(avg, cap))), bet: 0, status: "waiting", cards: [], cardCount: 0, hasActed: false, actionText: "", isBot: true};
        }
      }
      tx.update(tRef(tableId), upd);
    });
  } catch (e) { /* raced — next tick retries */ }
}

function botDecide(t, g, pl, eng, uid) {
  const p = pl[uid];
  const toCall = round2(Math.max(0, (g.highestBet || 0) - (p.bet || 0)));
  const board = g.board || [];
  const hole = (eng.hands || {})[uid] || [];
  const bb = round2((Number((t.settings || {}).blinds) || 0.5) * 2);
  const stack = p.stack || 0;
  const maxTo = round2((p.bet || 0) + stack);
  const pot = round2((g.pots || []).reduce((s2, x) => s2 + x.amount, 0) + Object.values(pl).reduce((s2, q) => s2 + (q.bet || 0), 0));
  const rnd = Math.random();
  const potOdds = toCall > 0 ? toCall / Math.max(0.01, pot + toCall) : 0;
  const street = board.length; // 0 preflop, 3 flop, 4 turn, 5 river
  const raiseTo = (frac) => {
    const target = round2((g.highestBet || 0) + Math.max(g.minRaise || bb, (pot + toCall) * frac));
    return Math.min(target, maxTo);
  };
  // The oracle: bots know every live hand and the fixed runout. The WINNER plays
  // for maximum value; the LOSERS lose the minimum — but every visible move must
  // read like a disciplined human, so the "story" (visEq: what the bot's own
  // cards + board would justify) shapes sizing and call/fold theater.
  const winners = botOracle(g, pl, eng);
  const iWin = winners.includes(uid);
  const split = iWin && winners.length > 1;
  const visEq = street >= 3 ? botEquity(hole, board, g.currentGameType) : botPreflop(hole, g.currentGameType);

  if (g.aof) {
    // All-In-or-Fold hand: the winner jams; a destined loser folds — except a
    // premium-LOOKING hand shoves sometimes for optics, and crumb stacks go in.
    if (iWin && !split) return toCall > 0 ? (toCall >= stack ? {type: "call"} : {type: "raise", amount: maxTo}) : {type: "raise", amount: maxTo};
    if (split) return toCall > 0 ? (toCall >= stack ? {type: "call"} : {type: "raise", amount: maxTo}) : {type: "call"};
    if (toCall === 0) return visEq >= 0.85 && rnd < 0.4 ? {type: "raise", amount: maxTo} : {type: "call"};
    if (stack <= bb * 1.5) return toCall >= stack ? {type: "call"} : {type: "raise", amount: maxTo};
    if (visEq >= 0.85 && rnd < 0.35) return toCall >= stack ? {type: "call"} : {type: "raise", amount: maxTo};
    return {type: "fold"};
  }

  // ── PREFLOP: the standard starting-hands chart RULES the optics, winner or not.
  // KK never limps. A destined-loser premium raises like a human and escapes on
  // later streets ("cooler avoided" discipline); a destined-winner with junk
  // mostly limps/defends — sneaking in cheap is exactly how junk wins big pots.
  if (street === 0) {
    const premium = visEq >= 0.8;     // AA/KK/QQ
    const strong = visEq >= 0.62;     // JJ-99, AK/AQ, big broadways
    const playable = visEq >= 0.45;   // suited connectors, Ax, mid pairs
    if (premium) {
      if (toCall >= stack) return {type: "call"};
      return rnd < 0.9 ? {type: "raise", amount: raiseTo(0.55 + rnd * 0.25)} : {type: "call"};
    }
    if (iWin && !split) {
      if (toCall >= stack) return {type: "call"};
      if (strong) return rnd < 0.65 ? {type: "raise", amount: raiseTo(0.5)} : {type: "call"};
      return rnd < 0.25 ? {type: "raise", amount: raiseTo(0.45)} : {type: "call"}; // limp in quietly
    }
    if (split) return toCall === 0 || potOdds <= 0.34 || toCall >= stack ? {type: "call"} : {type: "fold"};
    // destined loser — chart-honest, price-aware, minimum damage
    if (toCall === 0) return strong && rnd < 0.5 ? {type: "raise", amount: raiseTo(0.5)} : {type: "call"};
    if (stack <= bb * 1.5) return {type: "call"};
    if (strong && potOdds <= 0.34 && rnd < 0.8) return {type: "call"};
    if (playable && potOdds <= 0.25 && rnd < 0.6) return {type: "call"};
    if (toCall <= bb && rnd < 0.5) return {type: "call"};           // blind defense optics
    return {type: "fold"};
  }

  if (iWin && !split) {
    // Guaranteed winner: never folds, builds the pot. All-in only where a strong
    // human would naturally jam — late streets or when the pot got big.
    if (toCall > 0) {
      if (toCall >= stack) return {type: "call"};
      if (street === 5 && rnd < 0.55 && stack <= pot * 2) return {type: "raise", amount: maxTo}; // confident value jam
      if (rnd < (street >= 4 ? 0.55 : 0.4)) return {type: "raise", amount: raiseTo(0.6 + rnd * 0.3)};
      return {type: "call"};
    }
    if (street === 5) {
      if (rnd < 0.3 && stack <= pot * 1.6) return {type: "raise", amount: maxTo};                // river jam, pot-sized story
      return rnd < 0.85 ? {type: "raise", amount: raiseTo(0.65 + rnd * 0.3)} : {type: "call"};
    }
    if (rnd < 0.22) return {type: "call"};                          // trap street — lets someone catch up on looks
    return {type: "raise", amount: raiseTo(0.5 + rnd * 0.3)};
  }
  if (split) {
    // Chop-bound: no value to build — call reasonable prices, decline big raises war
    if (toCall === 0) return {type: "call"};
    return potOdds <= 0.34 || toCall >= stack ? {type: "call"} : {type: "fold"};
  }

  // Destined loser: fold-for-free discipline. A runner-runner hope with no price
  // per the odds table is exactly what a solid player dumps — so it dumps.
  if (toCall === 0) {
    // Flop with a big VISIBLE hand (overpair look): one believable stab, then slow down
    if (street === 3 && visEq >= 0.7 && rnd < 0.55) return {type: "raise", amount: raiseTo(0.45)};
    return {type: "call"};                                          // check it down
  }
  if (stack <= bb * 1.5) return {type: "call"};                     // crumb stack — humans always call that
  // Theater calls (feed the pot ONLY when the visible story truly justifies it):
  if (street === 3 && visEq >= 0.6 && potOdds <= 0.3 && rnd < 0.7) return {type: "call"};
  if (street >= 3 && street < 5 && visEq >= 0.5 && potOdds <= 0.22 && rnd < 0.55) return {type: "call"};
  if (visEq >= 0.3 && potOdds <= 0.1 && rnd < 0.45) return {type: "call"};
  return {type: "fold"};
}

// ═════════ Callables ═════════

exports.pkDeal = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const tableId = request.data && request.data.tableId;
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  const tS = await tRef(tableId).get();
  if (!tS.exists) throw new HttpsError("not-found", "Table gone");
  const t = tS.data();
  const seated = !!(t.players || {})[uid];
  if (!seated && !(await isGod(request.auth))) throw new HttpsError("permission-denied", "Not seated here");
  await dealHand(tableId);
  return {ok: true};
});

exports.pkAct = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId, action, amount, auto} = request.data || {};
  if (!tableId || !action) throw new HttpsError("invalid-argument", "Missing args");
  await engineStep(tableId, (t, g, pl, eng) => {
    if (!BETTING.includes(g.phase)) throw new HttpsError("failed-precondition", "No betting now");
    const p0 = pl[uid];
    if (p0) {
      // auto=true marks a client-side TIMEOUT fold/check — it counts as a miss
      // (two straight misses → sit-out at the end of the hand). A real tap resets.
      if (auto) {
        p0.missed = (p0.missed || 0) + 1;
        if (p0.missed >= 2 && !p0.sitOut && !p0.sitOutNext) { p0.sitOutNext = true; p0.sitAuto = true; }
      } else p0.missed = 0;
    }
    return applyAction(t, g, pl, eng, uid, action, amount);
  });
  return {ok: true};
});

exports.pkReveal = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  await engineStep(tableId, (t, g, pl, eng) => {
    const p = pl[uid];
    if (!p || g.phase !== "showdown") throw new HttpsError("failed-precondition", "Nothing to show");
    const mayShow = p.status === "folded" || (g.earlyWin && p.status === "active") || (g.earlyWin && p.actionText === "WINNER");
    if (!mayShow) throw new HttpsError("failed-precondition", "Cards already public");
    p.reveal = true; p.cards = (eng.hands || {})[uid] || [];
    return null;
  });
  return {ok: true};
});

// Any signed-in viewer is a clock: enforce timeouts, play bots, deal next hand.
exports.pkTick = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  const tS = await tRef(tableId).get();
  if (!tS.exists) return {ok: true, gone: true};
  const t = tS.data();
  const s = t.settings || {};
  if (!s.serverEngine) return {ok: true};
  const g = t.gameState || {};
  const pl = t.players || {};

  // CASH sanity: a player holding live cards can NEVER be sitOut mid-hand (a
  // sit-out tap racing the deal used to leave a "sitting out" seat playing a
  // hand). Demote the flag to sitOutNext — it applies at the end of the hand,
  // exactly per the house rule. Tournaments are exempt (sit-outs are dealt).
  if (!t.tournamentId && [...BETTING, "discard"].includes(g.phase)) {
    const bad = Object.values(pl).filter((q) => q && q.sitOut && q.status === "active" && (q.cardCount || 0) > 0);
    if (bad.length) {
      const upd = {};
      bad.forEach((q) => { upd[`players.${q.uid}.sitOut`] = false; upd[`players.${q.uid}.sitOutNext`] = true; });
      await tRef(tableId).update(upd).catch(() => {});
    }
  }

  // Spin & Cash: table filled → spin the wheel; wheel done → auto-deal hands.
  if (s.spinMode && !t.tournamentId) {
    if (!t.spin && g.phase === "waiting" && Object.keys(pl).length >= (Number(s.maxPlayers) || 3)) { await armSpin(tableId); return {ok: true}; }
    if (t.spin && !t.spinDone && g.phase === "waiting" && Date.now() > (t.spinStartAt || 0)) {
      const alive = Object.values(pl).filter((q) => (q.stack || 0) > 0);
      if (alive.length >= 2) { try { await dealHand(tableId); } catch (e) { /* raced */ } return {ok: true}; }
    }
  }

  // Bot rotation: between hands, when its timer matured (or to arm the timer)
  if (!t.tournamentId && ["waiting", "showdown"].includes(g.phase) && Object.values(pl).some((q) => q && q.isBot) && (!t.botRotAt || Date.now() > t.botRotAt)) {
    await rotateBots(tableId);
  }

  // Door rule: leaving takes effect at the END of the hand, never inside one.
  // A seat flagged leaveReq is removed by whichever viewer ticks first — but only
  // once its owner is no longer live in a hand (hand over / folded / sitout).
  // A disconnected leaver still exits: the timeout below folds him, then this fires.
  if (!t.tournamentId) {
    const lv = Object.values(pl).find((p) => p && p.leaveReq);
    if (lv) {
      const inLive = [...BETTING, "discard"].includes(g.phase) && lv.status === "active";
      if (!inLive) {
        try { await leaveSeat(tableId, lv.uid, t.clubId || "main"); } catch (e) { /* retried next tick */ }
        return {ok: true};
      }
      // Still live in the hand → FALL THROUGH to the normal tick (timeouts, bots,
      // dealing). Returning here froze the whole table while a leaver played on.
    }
  }

  // 1) showdown pause over → next hand
  if (g.phase === "showdown" && Date.now() - (g.showdownAt || 0) > (g.earlyWin ? 4000 : 9000)) {
    if (t.tournament && t.tournament.finished) return {ok: true};
    const alive = Object.values(pl).filter((p) => (p.stack || 0) > 0 && (t.tournamentId ? !["busted", "out"].includes(p.status) : !p.sitOut));
    if (alive.length >= 2) { try { await dealHand(tableId); } catch (e) { /* raced */ } }
    return {ok: true};
  }
  // 2) waiting + enough players → first deal
  if (g.phase === "waiting") {
    if (t.tournament && t.tournament.finished) return {ok: true};
    const ready = Object.values(pl).filter((p) => (p.stack || 0) > 0 && (t.tournamentId ? !["busted", "out"].includes(p.status) : !p.sitOut));
    if (ready.length >= 2) { try { await dealHand(tableId); } catch (e) { /* raced */ } }
    return {ok: true};
  }
  // Dealer's Choice pick stalled (bot chooser or 25s human timeout) → default game
  if (g.phase === "dc_selection") {
    const stuck = Date.now() - (g.turnStartedAt || 0);
    const chooser = pl[g.dcUid];
    if (!chooser || chooser.isBot || stuck > 25000) {
      try { await dealHand(tableId, s.baseGameType || "NLH"); } catch (e) { /* raced */ }
    }
    return {ok: true};
  }
  // Pineapple discard: bots throw after ~1.5s; humans time out at 25s
  if (g.phase === "discard") {
    const stuck = Date.now() - (g.turnStartedAt || 0);
    let out = null;
    try {
      out = await engineStep(tableId, (t2, g2, pl2, eng) => {
        if (g2.phase !== "discard") return null;
        for (const p of activesOf(pl2)) {
          const h = ((eng.hands || {})[p.uid] || []);
          if (h.length !== 3) continue;
          if (p.isBot ? stuck > 1500 : stuck > 25000) applyDiscard(t2, g2, pl2, eng, p.uid, crypto.randomInt(3));
        }
        return null;
      });
    } catch (e) { /* raced */ }
    if (out && out.eng && out.eng.dirtyPriv) {
      for (const duid of [...new Set(out.eng.dirtyPriv)]) {
        await pRef(tableId, duid).set({cards: out.eng.hands[duid], at: Date.now()}).catch(() => {});
      }
    }
    return {ok: true};
  }
  // Self-heal: a betting phase with no active turn (corrupted during a freeze /
  // legacy write) would otherwise stall forever — reassign the turn or settle.
  if (BETTING.includes(g.phase) && !g.activeTurnUid) {
    // Run It Twice offer window: pause the runout; bots opt in; close on expiry.
    if (g.allInReveal && g.ritOffer && !g.rit) {
      if (Date.now() < g.ritOffer.until) {
        const pendingBots = Object.values(pl).filter((q) => q.isBot && q.status === "active" && (g.ritAgree || {})[q.uid] === undefined);
        if (pendingBots.length) {
          try { await engineStep(tableId, (t2, g2, pl2) => { g2.ritAgree = g2.ritAgree || {}; Object.values(pl2).forEach((q) => { if (q.isBot && q.status === "active") g2.ritAgree[q.uid] = true; }); return null; }); } catch (e) { /* raced */ }
        }
        return {ok: true};
      }
      try {
        await engineStep(tableId, (t2, g2, pl2) => {
          if (!g2.ritOffer) return null;
          const live = Object.values(pl2).filter((q) => q.status === "active");
          g2.rit = live.length >= 2 && live.every((q) => (g2.ritAgree || {})[q.uid] === true);
          g2.ritOffer = null; g2.runoutAt = Date.now();
          return null;
        });
      } catch (e) { /* raced */ }
      return {ok: true};
    }
    // Staged all-in runout: hold each street on screen before dealing the next.
    if (g.allInReveal && Date.now() - (g.runoutAt || 0) < 1600) return {ok: true};
    try {
      await engineStep(tableId, (t2, g2, pl2, eng) => {
        if (!BETTING.includes(g2.phase) || g2.activeTurnUid) return null;
        if (g2.allInReveal && Date.now() - (g2.runoutAt || 0) < 1600) return null;
        const acts = Object.values(pl2).filter((q) => q.status === "active");
        if (acts.length === 0) { g2.phase = "waiting"; g2.board = []; g2.pots = []; return null; }
        if (acts.length === 1) return finishEarlyWin(t2, g2, pl2, acts[0].uid, eng);
        const canAct = acts.filter((q) => (q.stack || 0) > 0);
        if (canAct.length < 2) return advancePhase(t2, g2, pl2, eng); // all-in runout to showdown
        g2.activeTurnUid = firstAfterDealer(g2, pl2); g2.turnStartedAt = Date.now();
        return null;
      });
    } catch (e) { /* raced */ }
    return {ok: true};
  }
  if (!BETTING.includes(g.phase)) return {ok: true};

  const actor = pl[g.activeTurnUid];
  const elapsed = Date.now() - (g.turnStartedAt || 0);
  if (!actor || actor.status !== "active") {
    // orphan turn → advance
    try {
      await engineStep(tableId, (t2, g2, pl2, eng) => {
        const acts = Object.values(pl2).filter((q) => q.status === "active");
        if (acts.length === 1) return finishEarlyWin(t2, g2, pl2, acts[0].uid, eng);
        if (acts.length === 0) { g2.phase = "waiting"; g2.activeTurnUid = null; g2.board = []; g2.pots = []; return null; } // hand voided (everyone left)
        g2.activeTurnUid = firstAfterDealer(g2, pl2); g2.turnStartedAt = Date.now();
        return null;
      });
    } catch (e) { /* raced */ }
    return {ok: true};
  }
  const isBot = !!actor.isBot;
  const limitMs = ((Number(s.actionTime) || 30) + 3) * 1000;
  if (isBot && elapsed > 1200 + crypto.randomInt(1800)) {
    try {
      await engineStep(tableId, (t2, g2, pl2, eng) => {
        if (g2.activeTurnUid !== actor.uid) return null;
        const d = botDecide(t2, g2, pl2, eng, actor.uid);
        return applyAction(t2, g2, pl2, eng, actor.uid, d.type, d.amount);
      });
    } catch (e) { /* raced */ }
    return {ok: true};
  }
  if (!isBot && (elapsed > limitMs || actor.sitOut)) {
    try {
      await engineStep(tableId, (t2, g2, pl2, eng) => {
        if (g2.activeTurnUid !== actor.uid) return null;
        const p2 = pl2[actor.uid];
        // Two straight timer misses → automatic 10-minute sit-out (flagged for the
        // NEXT deal — the current hand just auto-folds/checks). A real action resets it.
        if (!actor.sitOut) {
          p2.missed = (p2.missed || 0) + 1;
          if (p2.missed >= 2 && !p2.sitOutNext) { p2.sitOutNext = true; p2.sitAuto = true; }
        }
        const toCall = round2(Math.max(0, (g2.highestBet || 0) - (p2.bet || 0)));
        return applyAction(t2, g2, pl2, eng, actor.uid, toCall > 0 ? "fold" : "call");
      });
    } catch (e) { /* raced */ }
  }
  return {ok: true};
});

// Pineapple: apply one discard for uid; when everyone is down to 2 cards, resume flop betting.
function applyDiscard(t, g, pl, eng, uid, index) {
  if (g.phase !== "discard") throw new HttpsError("failed-precondition", "Not discard time");
  const hand = (eng.hands || {})[uid] || [];
  if (hand.length !== 3) return null; // already discarded (or not in hand)
  const idx = Math.max(0, Math.min(2, Number(index) || 0));
  hand.splice(idx, 1);
  eng.hands[uid] = hand;
  if (pl[uid]) pl[uid].cardCount = 2;
  eng.dirtyPriv = eng.dirtyPriv || [];
  eng.dirtyPriv.push(uid);
  const pending = activesOf(pl).some((p) => ((eng.hands || {})[p.uid] || []).length === 3);
  if (!pending) {
    g.phase = "flop";
    g.activeTurnUid = firstAfterDealer(g, pl);
    g.turnStartedAt = Date.now();
  }
  return null;
}

exports.pkDiscard = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId, index} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  const out = await engineStep(tableId, (t, g, pl, eng) => applyDiscard(t, g, pl, eng, uid, index));
  if (out && out.eng && (out.eng.dirtyPriv || []).includes(uid)) {
    await pRef(tableId, uid).set({cards: out.eng.hands[uid], at: Date.now()}).catch(() => {});
  }
  return {ok: true};
});

exports.pkPickGame = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId, gameType} = request.data || {};
  if (!tableId || !gameType) throw new HttpsError("invalid-argument", "Missing args");
  const tS = await tRef(tableId).get();
  if (!tS.exists) throw new HttpsError("not-found", "Table gone");
  const g = (tS.data().gameState || {});
  if (g.phase !== "dc_selection" || g.dcUid !== uid) throw new HttpsError("permission-denied", "Not your pick");
  await dealHand(tableId, String(gameType));
  return {ok: true};
});

// Stand up / kick on a server table (cash only). Works MID-HAND: folds the seat
// out of the current hand correctly (turn advance, early-win, pineapple discard,
// dealer's-choice stall), then removes the seat and refunds stack + queued top-up
// to the wallet — so blinds/turn logic never waits on a ghost player.
// callerUid may remove himself; a god or club super_admin/club_owner/manager may
// pass targetUid to remove someone else.
exports.pkLeave = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId, targetUid} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  const uid = targetUid || callerUid;
  const tS0 = await tRef(tableId).get();
  if (!tS0.exists) return {ok: true, gone: true};
  const t0 = tS0.data();
  if (t0.tournamentId) throw new HttpsError("failed-precondition", "Tournament seats are handled by the tournament flow");
  const clubId = t0.clubId || "main";
  if (uid !== callerUid && !(await isGod(request.auth))) {
    const mS = await db.doc(`memberships/${callerUid}_${clubId}`).get();
    const role = (mS.exists && mS.data().role) || "";
    if (!["super_admin", "club_owner", "manager"].includes(role)) throw new HttpsError("permission-denied", "Managers only");
  }
  const refund = await leaveSeat(tableId, uid, clubId);
  return {ok: true, refund};
});

// The actual seat removal — also invoked by pkTick as a backstop for seats the
// client flagged with leaveReq (its own pkLeave call failed / never arrived).
async function leaveSeat(tableId, uid, clubId) {
  // Step 1: fold the seat out of the live hand (server-authoritative, turn-aware).
  try {
    await engineStep(tableId, (t2, g2, pl2, eng) => {
      const p2 = pl2[uid];
      if (!p2 || p2.status !== "active") return null;
      const others = Object.values(pl2).filter((q) => q.status === "active" && q.uid !== uid);
      if (BETTING.includes(g2.phase)) {
        // He's the LAST one still in the hand (everyone else folded/left) → the pot
        // is his; settle the hand for him, then the removal below cashes it out.
        if (others.length === 0) return finishEarlyWin(t2, g2, pl2, uid, eng);
        if (g2.activeTurnUid === uid) return applyAction(t2, g2, pl2, eng, uid, "fold");
        p2.status = "folded"; p2.actionText = "Fold"; p2.hasActed = true;
        if (others.length === 1) return finishEarlyWin(t2, g2, pl2, others[0].uid, eng);
        return null;
      }
      if (g2.phase === "discard") {
        if (others.length === 0) return finishEarlyWin(t2, g2, pl2, uid, eng);
        p2.status = "folded"; p2.actionText = "Fold";
        if (others.length === 1) return finishEarlyWin(t2, g2, pl2, others[0].uid, eng);
        // If he was the last one still holding 3 cards, resume the flop betting round.
        const pending = others.some((q) => (((eng.hands || {})[q.uid]) || []).length === 3);
        if (!pending) { g2.phase = "flop"; g2.activeTurnUid = firstAfterDealer(g2, pl2); g2.turnStartedAt = Date.now(); }
        return null;
      }
      return null;
    });
  } catch (e) { /* raced / already out of the hand */ }
  // Step 2: remove the seat + refund. His folded bet joins the pot for the players
  // still in the hand; the dc_selection watchdog (pkTick) covers a vanished chooser.
  let refund = 0;
  let leaverLog = null; // set when the seat is pulled MID-HAND — his result must still be booked
  await db.runTransaction(async (tx) => {
    leaverLog = null;
    const [tS, mS, eS] = await Promise.all([tx.get(tRef(tableId)), tx.get(db.doc(`memberships/${uid}_${clubId}`)), tx.get(eRef(tableId))]);
    if (!tS.exists) return;
    const t = tS.data();
    const g = t.gameState || {};
    const pl = {...(t.players || {})};
    const p = pl[uid];
    if (!p) return;
    // A live hand ends WITHOUT him in players → logHandResults would skip his loss
    // and the books stop summing to zero (the raem-atias class of bug). Book his
    // hand result now, flagged leave:true so the dedup repair never touches it.
    const eng0 = eS.exists ? eS.data() : {};
    const start0 = (eng0.startStacks || {});
    if ([...BETTING, "discard"].includes(g.phase) && (p.cardCount || 0) > 0 && (uid in start0)) {
      const profit = round2((p.stack || 0) - start0[uid]);
      if (profit !== 0) leaverLog = {uid, username: p.name || "", clubId, game: "poker", profit, rake: 0, tableId, leave: true, at: Date.now()};
    }
    const othersLive = Object.values(pl).filter((q) => q.uid !== uid && q.status === "active");
    // Only wait for step 1 when there are OTHER live players whose hand we'd disturb;
    // a lone leaver must never be trapped by his own "active" status.
    if ([...BETTING, "discard"].includes(g.phase) && p.status === "active" && othersLive.length > 0) throw new HttpsError("aborted", "Mid-action, try again");
    refund = (t.settings || {}).spinMode
      ? (t.spin ? 0 : round2(p.spinPaid || 0)) // spin chips aren't money; pre-wheel exit refunds the entry
      : round2((p.stack || 0) + (p.pendingTopUp || 0));
    const pots = [...(g.pots || [])];
    if ((p.bet || 0) > 0) {
      if (othersLive.length > 0) pots.push({amount: round2(p.bet), eligible: othersLive.map((q) => q.uid)});
      else refund = round2(refund + p.bet); // no one left to win it — back to his wallet
    }
    delete pl[uid];
    if (Object.keys(pl).length === 0) {
      tx.delete(tRef(tableId)); tx.delete(eRef(tableId));
    } else {
      const upd = {players: pl, "gameState.pots": pots};
      if (!p.isBot && (p.stack || 0) > 0 && !(t.settings || {}).spinMode) upd[`leftStacks.${uid}`] = {amount: round2(p.stack), at: Date.now()};
      tx.update(tRef(tableId), upd);
    }
    if (!p.isBot && refund > 0 && mS.exists) tx.update(mS.ref, {balance: round2((mS.data().balance || 0) + refund)});
  });
  if (leaverLog) db.collection("gameLog").add(leaverLog).catch(() => {});
  return refund;
}

// GOD-only one-shot repair: remove client-written SESSION duplicates from gameLog.
// Server hand results are written in GROUPS sharing (tableId, at) — every player
// of the hand at the same millisecond. A cash-poker entry that shares its
// timestamp with no sibling is a client session log (the double-count) → delete.
// Tournament payouts ('tournament:...') and manual adjustments are untouched.
exports.admFixGameLog = onCall(async (request) => {
  if (!(await isGod(request.auth))) throw new HttpsError("permission-denied", "No");
  const {clubId} = request.data || {};
  const snap = await db.collection("gameLog").where("clubId", "==", clubId || "main").get();
  const groups = {};
  snap.docs.forEach((d) => {
    const e = d.data();
    if (e.game !== "poker") return;
    if (e.leave) return; // mid-hand leaver results are legitimately solo — never delete
    const tid = String(e.tableId || "");
    if (tid.startsWith("tournament:")) return;
    const k = tid + "|" + e.at;
    (groups[k] = groups[k] || []).push(d);
  });
  const solo = [];
  Object.values(groups).forEach((arr) => { if (arr.length === 1) solo.push(arr[0]); });
  let deleted = 0;
  while (solo.length) {
    const chunk = solo.splice(0, 450);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return {ok: true, deleted, scanned: snap.size};
});

// Run It Twice vote (during the 5.5s all-in offer window only)
exports.pkRit = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in");
  const {tableId, agree} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  try {
    await engineStep(tableId, (t2, g2, pl2) => {
      if (!g2.ritOffer || Date.now() > g2.ritOffer.until) return null;
      if (!pl2[uid] || pl2[uid].status !== "active") return null;
      g2.ritAgree = g2.ritAgree || {};
      g2.ritAgree[uid] = agree === true;
      return null;
    });
  } catch (e) { /* window closed */ }
  return {ok: true};
});

// GOD-only: return all live hands for a table. Validated server-side; the god
// list never ships to the browser.
exports.godPeek = onCall(async (request) => {
  if (!(await isGod(request.auth))) throw new HttpsError("permission-denied", "No");
  const {tableId} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  const [eS, tS] = await Promise.all([eRef(tableId).get(), tRef(tableId).get()]);
  if (!eS.exists) return {hands: {}, finalBoard: []};
  const eng = eS.data();
  const board = ((tS.exists && tS.data().gameState) || {}).board || [];
  // The board's future is already fixed in the shuffled deck (dealt via shift, no burns)
  const finalBoard = [...board, ...((eng.deck || []).slice(0, Math.max(0, 5 - board.length)))];
  return {hands: eng.hands || {}, finalBoard};
});
