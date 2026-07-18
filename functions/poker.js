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

// ── GOD list: server-side only. Add emails here (or to the admin/gods doc). ──
const SERVER_GODS = ["aaci.yoni@gmail.com"];
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

async function logHandResults(t, eng, plAfter) {
  try {
    const start = eng.startStacks || {};
    const now = Date.now();
    for (const p of Object.values(plAfter)) {
      if (!(p.uid in start)) continue;
      const profit = round2((p.stack || 0) - start[p.uid]);
      if (profit === 0) continue;
      db.collection("gameLog").add({uid: p.uid, username: p.name || "", clubId: t.clubId || "main", game: "poker", profit, tableId: eng.tableId || "", at: now}).catch(() => {});
    }
  } catch (e) { /* best-effort */ }
}

// ── Core: finish paths (mutate g/pl; return {reveal} extra public updates) ──
function finishEarlyWin(t, g, pl, winnerUid) {
  gatherBetsToPots(g, pl);
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
  return {rake, participants: Object.values(pl).filter((q) => (q.cardCount || 0) > 0).map((q) => q.uid)};
}

function runShowdown(t, g, pl, hands) {
  const acts = Object.values(pl).filter((p) => p.status === "active");
  const scores = {};
  acts.forEach((p) => { scores[p.uid] = bestScore(hands[p.uid] || [], g.board || [], g.currentGameType); });
  let rakeTotal = 0;
  const winnerNames = new Set();
  let winTotal = 0;
  const rakeFrac = (Number((t.settings || {}).rakePercent) || 0) / 100;
  (g.pots || []).forEach((pot, idx) => {
    const elig = (pot.eligible || []).filter((uid) => pl[uid] && pl[uid].status === "active");
    if (elig.length === 0) return;
    let bestS = -1; let winners = [];
    elig.forEach((uid) => { const sc = scores[uid] || 0; if (sc > bestS) { bestS = sc; winners = [uid]; } else if (sc === bestS) winners.push(uid); });
    let amount = pot.amount;
    if (idx === 0) { const r = round2(amount * rakeFrac); rakeTotal = round2(rakeTotal + r); amount = round2(amount - r); }
    const share = Math.floor((amount / winners.length) * 100) / 100;
    winTotal = round2(winTotal + share * winners.length);
    winners.forEach((uid) => { pl[uid].stack = round2(pl[uid].stack + share); pl[uid].actionText = "WINNER"; winnerNames.add(pl[uid].name); });
  });
  g.pots = []; g.phase = "showdown"; g.activeTurnUid = null; g.earlyWin = false;
  g.lastWinAmount = winTotal;
  g.lastWinners = [...winnerNames].join(", ");
  g.showdownAt = Date.now();
  // showdown is public: reveal every remaining hand in the public doc
  acts.forEach((p) => { pl[p.uid].cards = hands[p.uid] || []; });
  return {rake: rakeTotal, participants: Object.values(pl).filter((q) => (q.cardCount || 0) > 0).map((q) => q.uid)};
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
  else if (g.phase === "river") return runShowdown(t, g, pl, eng.hands);
  // all-in runout: fewer than 2 players can still act → keep dealing to the end
  const canAct = activesOf(pl).filter((p) => (p.stack || 0) > 0);
  if (canAct.length < 2) {
    g.allInReveal = true;
    Object.values(pl).forEach((p) => { if (p.status === "active") p.cards = eng.hands[p.uid] || []; });
    return advancePhase(t, g, pl, eng);
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
  if (type === "fold") { p.status = "folded"; p.actionText = "Fold"; p.hasActed = true; }
  else if (type === "call") {
    const pay = Math.min(toCall, p.stack);
    p.stack = round2(p.stack - pay); p.bet = round2((p.bet || 0) + pay);
    p.actionText = toCall === 0 ? "Check" : (p.stack === 0 ? "All-in" : "Call");
    p.hasActed = true;
  } else if (type === "raise") {
    let target = round2(Number(targetBet) || 0);
    const maxBet = round2((p.bet || 0) + p.stack);
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

  const remaining = Object.values(pl).filter((q) => q.status === "active");
  if (remaining.length === 1) return finishEarlyWin(t, g, pl, remaining[0].uid);
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
  await db.runTransaction(async (tx) => {
    const tS = await tx.get(tRef(tableId));
    if (!tS.exists) throw new HttpsError("not-found", "Table gone");
    const t = tS.data();
    const s = t.settings || {};
    if (!s.serverEngine) throw new HttpsError("failed-precondition", "Not a server table");

    const g0 = t.gameState || {};
    if (!["waiting", "showdown"].includes(g0.phase)) throw new HttpsError("failed-precondition", "Hand in progress");
    const pl = JSON.parse(JSON.stringify(t.players || {}));
    Object.values(pl).forEach((p) => {
      p.cards = []; p.cardCount = 0; p.bet = 0; p.actionText = ""; p.hasActed = false; p.reveal = false;
      // Tournament: sit-out players are still dealt (blinds burn, auto-folded by the tick);
      // out/busted stay out. Cash: sit-out means skipped.
      p.status = p.stack > 0
        ? ((p.sitOut && !t.tournamentId) ? "sitout" : "active")
        : (["busted", "out"].includes(p.status) ? p.status : "sitout");
    });
    const acts = activesOf(pl);
    if (acts.length < 2) { tx.update(tRef(tableId), {players: pl, "gameState.phase": "waiting", "gameState.activeTurnUid": null}); return; }
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
          lastWinners: null, lastWinAmount: 0, allInReveal: false, earlyWin: false,
        }});
        return;
      }
      g0.dcUid = dcUid; g0.dcAnchor = dcAnchor;
    }
    const nCards = GAME_CARDS[gameType] || 2;
    const deck = pokerDeck();
    const hands = {};
    acts.forEach((p) => { hands[p.uid] = deck.splice(0, nCards); p.cardCount = nCards; });
    // dealer rotation
    const prevSeat = (pl[g0.dealerUid] || {}).seatIndex ?? -1;
    const order = acts.filter((p) => p.seatIndex > prevSeat).concat(acts.filter((p) => p.seatIndex <= prevSeat));
    const dealer = order[0];
    let sb = round2(Number(s.blinds) || 0.5);
    let bb = round2(sb * 2);
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
    post(sbP, sb, "SB"); post(bbP, bb, "BB");
    const g = {
      phase: "preflop", deck: [], board: [], pots: anteTotal > 0 ? [{amount: anteTotal, eligible: acts.map((p) => p.uid)}] : [], highestBet: bb, minRaise: bb,
      dealerUid: dealer.uid, dcUid: g0.dcUid || null, dcAnchor: g0.dcAnchor || null, currentGameType: gameType,
      activeTurnUid: firstUid, turnStartedAt: Date.now(), lastWinners: null, lastWinAmount: 0,
      allInReveal: false, earlyWin: false, showdownAt: null,
    };
    const startStacks = {};
    acts.forEach((p) => { startStacks[p.uid] = round2((p.stack || 0) + (p.bet || 0)); });
    tx.set(eRef(tableId), {deck, hands, startStacks, tableId, at: Date.now()});
    for (const p of acts) tx.set(pRef(tableId, p.uid), {cards: hands[p.uid], at: Date.now()});
    tx.update(tRef(tableId), {players: pl, gameState: g});
  });
  return finishInfo;
}

// ── Post-finish bookkeeping (rake, logs, busted) done outside the tx ──
async function afterFinish(tableId, t, finish, plAfter, eng) {
  if (!finish) return;
  markBusted(plAfter);
  await tRef(tableId).update({players: plAfter}).catch(() => {});
  if (t.tournamentId) {
    const winnersUids = Object.values(plAfter).filter((q) => q.actionText === "WINNER").map((q) => q.uid);
    await tourAfterHand(tableId, t, plAfter, winnersUids);
  } else {
    distributeRake(t.clubId || "main", finish.rake, finish.participants);
    logHandResults(t, eng, plAfter);
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
function botDecide(t, g, pl, eng, uid) {
  const p = pl[uid];
  const toCall = round2(Math.max(0, (g.highestBet || 0) - (p.bet || 0)));
  const board = g.board || [];
  const hole = (eng.hands || {})[uid] || [];
  let strength = 0.3;
  if (board.length >= 3) {
    const sc = bestScore(hole, board, g.currentGameType);
    strength = sc >= 3000000 ? 0.95 : sc >= 2000000 ? 0.8 : sc >= 1000000 ? 0.55 : 0.25;
  } else if (hole.length >= 2) {
    const vals = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14};
    const vs = hole.map((c) => vals[c.val]).sort((a, b) => b - a);
    const pair = new Set(hole.map((c) => c.val)).size < hole.length;
    strength = pair ? 0.85 : vs[0] >= 12 ? 0.6 : vs[0] >= 9 ? 0.42 : 0.28;
  }
  const rnd = Math.random();
  const potOdds = toCall > 0 ? toCall / Math.max(1, toCall + (g.pots || []).reduce((s, x) => s + x.amount, 0) + Object.values(pl).reduce((s, q) => s + (q.bet || 0), 0)) : 0;
  if (toCall === 0) {
    if (strength > 0.75 && rnd < 0.5) {
      const target = round2((g.highestBet || 0) + Math.max(g.minRaise || 1, round2((Number((t.settings || {}).blinds) || 0.5) * 2 * (2 + Math.floor(rnd * 3)))));
      return {type: "raise", amount: Math.min(target, round2((p.bet || 0) + p.stack))};
    }
    return {type: "call"}; // check
  }
  if (strength >= 0.8) {
    if (rnd < 0.45) {
      const target = round2((g.highestBet || 0) + Math.max(g.minRaise || 1, toCall * 2));
      return {type: "raise", amount: Math.min(target, round2((p.bet || 0) + p.stack))};
    }
    return {type: "call"};
  }
  if (strength >= 0.45) return potOdds < 0.4 || rnd < 0.7 ? {type: "call"} : {type: "fold"};
  return toCall <= (Number((t.settings || {}).blinds) || 0.5) * 2 && rnd < 0.55 ? {type: "call"} : {type: "fold"};
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
  const {tableId, action, amount} = request.data || {};
  if (!tableId || !action) throw new HttpsError("invalid-argument", "Missing args");
  await engineStep(tableId, (t, g, pl, eng) => {
    if (!BETTING.includes(g.phase)) throw new HttpsError("failed-precondition", "No betting now");
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

  // 1) showdown pause over → next hand
  if (g.phase === "showdown" && g.showdownAt && Date.now() - g.showdownAt > (g.earlyWin ? 3500 : 5000)) {
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
    if (chooser && (chooser.isBot || stuck > 25000)) {
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
  if (!BETTING.includes(g.phase) || !g.activeTurnUid) return {ok: true};

  const actor = pl[g.activeTurnUid];
  const elapsed = Date.now() - (g.turnStartedAt || 0);
  if (!actor || actor.status !== "active") {
    // orphan turn → advance
    try {
      await engineStep(tableId, (t2, g2, pl2, eng) => {
        const acts = Object.values(pl2).filter((q) => q.status === "active");
        if (acts.length === 1) return finishEarlyWin(t2, g2, pl2, acts[0].uid);
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
        const toCall = round2(Math.max(0, (g2.highestBet || 0) - (pl2[actor.uid].bet || 0)));
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

// GOD-only: return all live hands for a table. Validated server-side; the god
// list never ships to the browser.
exports.godPeek = onCall(async (request) => {
  if (!(await isGod(request.auth))) throw new HttpsError("permission-denied", "No");
  const {tableId} = request.data || {};
  if (!tableId) throw new HttpsError("invalid-argument", "Missing tableId");
  const eS = await eRef(tableId).get();
  if (!eS.exists) return {hands: {}};
  return {hands: eS.data().hands || {}};
});
