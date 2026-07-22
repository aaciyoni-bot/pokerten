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
    // Odd cents from an uneven split go to the first winner — chips never vanish.
    const oddCents = round2(amount - share * winners.length);
    winTotal = round2(winTotal + amount);
    winners.forEach((uid, wi) => { pl[uid].stack = round2(pl[uid].stack + share + (wi === 0 ? oddCents : 0)); pl[uid].actionText = "WINNER"; winnerNames.add(pl[uid].name); });
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
      // Deferred sit-out (tapped ☕ mid-hand): the rule everywhere is that state
      // changes apply BETWEEN hands, never inside one.
      if (p.sitOutNext) { p.sitOut = true; p.sitOutAt = Date.now(); p.sitAuto = false; p.sitOutNext = false; }
      // Leaving at hand's end — never dealt into the next hand (removal races the deal).
      if (p.leaveReq && !t.tournamentId) p.sitOut = true;
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
          lastWinners: null, lastWinAmount: 0, allInReveal: false, earlyWin: false, rabbit: null,
        }});
        return;
      }
      g0.dcUid = dcUid; g0.dcAnchor = dcAnchor;
    }
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
      allInReveal: false, earlyWin: false, showdownAt: null, rabbit: null,
      actions: [{n: sbP.name || "", a: "SB", amt: sb, ph: "preflop"}, {n: bbP.name || "", a: "BB", amt: bb, ph: "preflop"}],
    };
    const startStacks = {};
    acts.forEach((p) => { startStacks[p.uid] = round2((p.stack || 0) + (p.bet || 0)); });
    tx.set(eRef(tableId), {deck, hands, startStacks, tableId, at: Date.now()});
    for (const p of acts) tx.set(pRef(tableId, p.uid), {cards: hands[p.uid], at: Date.now()});
    tx.update(tRef(tableId), {players: pl, gameState: g});
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
    at: Date.now(), game: g2.currentGameType || "NLH", board: g2.board || [],
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
    try {
      await engineStep(tableId, (t2, g2, pl2, eng) => {
        if (!BETTING.includes(g2.phase) || g2.activeTurnUid) return null;
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
    refund = round2((p.stack || 0) + (p.pendingTopUp || 0));
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
      if (!p.isBot && (p.stack || 0) > 0) upd[`leftStacks.${uid}`] = {amount: round2(p.stack), at: Date.now()};
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
