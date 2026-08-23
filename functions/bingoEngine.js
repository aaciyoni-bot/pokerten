/**
 * PokerTen — server-authoritative Bingo engine.
 *
 * The server sells the cards, draws the balls and pays the winners; clients
 * only send requests and render. Mirrors the pokerEngine.js protocol style:
 *
 *   tables/{id}                 — public doc (called balls, players, bank —
 *                                 but never the future draw order)
 *   tables/{id}/priv/{uid}      — {cards:[{id, round, nums}]} readable only
 *                                 by that uid (firestore.rules)
 *   tables/{id}/priv/_engine    — {order, seed, round} server-only
 *
 * Provably fair: at bingoStart the full ball order is shuffled with a CSPRNG
 * and its sha256 (order + seed) is published as `fairHash` on the public doc.
 * At showdown the order + seed are published in lastResults, so anyone can
 * re-hash and verify no ball was inserted or reordered mid-round.
 *
 * Money model (see bingoCore.computeSettlement):
 *   buy   — balance -= cardPrice×n (+flat fee×n), bank += cardPrice×n
 *   rake  — pct-of-pot at settlement, or the flat fees collected at the door
 *   pool  — bank minus pct rake, split by settings.prizeSplit per pattern,
 *           equal split between same-pattern winners (floored to the cent)
 *   house — bot/deserter shares + rounding crumbs → club owner (clubProfits)
 *   rake  — agent cuts first, remainder to the club owner (agentLog), exactly
 *           like distributeRake for the other games.
 * Bots never touch real money: their cards are free and out of the bank.
 */
"use strict";

const crypto = require("crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {getFirestore} = require("firebase-admin/firestore");
const B = require("./bingoCore");
const round2 = B.round2;

let _db = null;
const db = () => (_db = _db || getFirestore());

// keep in sync with index.html + pokerEngine.js
const GOD_EMAILS = ["aaci.yoni@gmail.com", "info.bagso@gmail.com", "avi057278@gmail.com", "khnby749@gmail.com", "bykhn3234@gmail.com", "easymarcelos@gmail.com"];
const isGodEmail = (e) => GOD_EMAILS.includes(String(e || "").toLowerCase().trim());

const CALL_OPTS = {region: "us-central1"};
const WIN_PAUSE_MS = 4000; // breather after a pattern is won before the next ball

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
const tRef = (id) => db().doc(`tables/${id}`);
const privRef = (id, uid) => db().doc(`tables/${id}/priv/${uid}`);
const engRef = (id) => db().doc(`tables/${id}/priv/_engine`);
const memRef = (uid, clubId) => db().doc(`memberships/${uid}_${clubId}`);

const rng = () => crypto.randomInt(0, 1000000) / 1000000;

const assertBingo = (snap) => {
  if (!snap.exists) throw new HttpsError("not-found", "Table doesn't exist");
  const t = snap.data();
  if (t.type !== "bingo") throw new HttpsError("failed-precondition", "Not a bingo table");
  return t;
};

// host / club owner / GOD / manager-of-bingo may drive the table
async function canDrive(tx, uid, token, t) {
  if (t.hostUid === uid) return true;
  if (isGodEmail(token && token.email)) return true;
  const clubId = t.clubId || "main";
  const clubSnap = await tx.get(db().doc(`clubs/${clubId}`));
  if (clubSnap.exists && clubSnap.data().ownerUid === uid) return true;
  const ms = await tx.get(memRef(uid, clubId));
  if (ms.exists) {
    const m = ms.data();
    if (m.role === "club_owner" || m.role === "super_admin") return true;
    if (m.role === "manager" && (m.managedGames || []).includes("bingo")) return true;
  }
  return false;
}

const curCards = (privSnap, roundN) => {
  const arr = (privSnap && privSnap.exists ? privSnap.data().cards : []) || [];
  return arr.filter((c) => (c.round || 1) === roundN);
};

/* ------------------------------- bingoBuy ------------------------------- */
// {tableId, count, bot?:{uid,name,photo,avatarSeed}} — bot buys are free
// (house cards) and only a driver may make them.
exports.bingoBuy = onCall(CALL_OPTS, async (request) => {
  const callerUid = authedUid(request);
  const id = reqTableId(request);
  const count = Math.floor(Number((request.data || {}).count) || 0);
  if (count < 1 || count > 100) throw new HttpsError("invalid-argument", "Bad card count");
  const bot = (request.data || {}).bot || null;
  let becameFull = false;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(tRef(id));
    const t = assertBingo(snap);
    if (t.phase !== "waiting") throw new HttpsError("failed-precondition", "The round already started — wait for the next one");
    const s = t.settings || {};
    const clubId = t.clubId || "main";
    let uid = callerUid;
    let seat = {name: "", photo: "", avatarSeed: "", isBot: false};
    if (bot) {
      if (!(await canDrive(tx, callerUid, request.auth.token, t))) throw new HttpsError("permission-denied", "Not allowed");
      if (!bot.uid || typeof bot.uid !== "string") throw new HttpsError("invalid-argument", "Bad bot");
      uid = bot.uid;
      seat = {name: String(bot.name || "Bot"), photo: String(bot.photo || ""), avatarSeed: String(bot.avatarSeed || bot.uid), isBot: true};
    }
    const players = t.players || {};
    const me = players[uid];
    if (!me && Object.keys(players).length >= (Number(s.maxPlayers) || 30)) throw new HttpsError("failed-precondition", "The table is full");
    const maxCards = Math.max(1, Number(s.maxCardsPerPlayer) || 1);
    const owned = me ? (Number(me.cardCount) || 0) : 0;
    if (owned + count > maxCards) throw new HttpsError("failed-precondition", `Up to ${maxCards} cards per player at this table`);
    const price = round2(Number(s.cardPrice) || 0);
    const fee = (s.rakeMode || "pct") === "flat" ? round2(Number(s.rakeFee) || 0) : 0;
    const charge = round2((price + fee) * count);
    const roundN = Number(t.roundN) || 1;

    // all reads before writes
    let mSnap = null;
    if (!seat.isBot) {
      mSnap = await tx.get(memRef(uid, clubId));
      if (!mSnap.exists) throw new HttpsError("permission-denied", "No membership in this club");
      if ((Number(mSnap.data().balance) || 0) < charge) throw new HttpsError("failed-precondition", `Not enough balance (${charge.toFixed(2)} needed)`);
    }
    const pSnap = await tx.get(privRef(id, uid));

    if (!seat.isBot) {
      tx.update(mSnap.ref, {balance: round2((Number(mSnap.data().balance) || 0) - charge)});
    }
    const kept = curCards(pSnap, roundN);
    const fresh = [];
    for (let i = 0; i < count; i++) {
      fresh.push({id: uid.slice(0, 5) + "-" + roundN + "-" + (owned + i + 1) + "-" + crypto.randomBytes(3).toString("hex"), round: roundN, nums: B.genCard(s.variant, rng)});
    }
    tx.set(privRef(id, uid), {cards: [...kept, ...fresh]});

    let seatIndex = me ? me.seatIndex : 0;
    if (!me) {
      const taken = new Set(Object.values(players).map((p) => p.seatIndex));
      while (taken.has(seatIndex)) seatIndex++;
    }
    const upd = {
      [`players.${uid}`]: {
        uid,
        name: me ? me.name : (seat.isBot ? seat.name : String((request.data || {}).name || "").slice(0, 40) || "Player"),
        photo: me ? (me.photo || "") : (seat.isBot ? seat.photo : String((request.data || {}).photo || "")),
        avatarSeed: me ? (me.avatarSeed || "") : (seat.isBot ? seat.avatarSeed : String((request.data || {}).avatarSeed || "")),
        seatIndex,
        isBot: seat.isBot,
        left: false,
        cardCount: owned + count,
        spent: round2((me ? Number(me.spent) || 0 : 0) + (seat.isBot ? 0 : charge)),
        lastSeen: Date.now(),
      },
    };
    if (!seat.isBot) {
      upd.bank = round2((Number(t.bank) || 0) + price * count);
      if (fee > 0) upd.feeAcc = round2((Number(t.feeAcc) || 0) + fee * count);
    }
    tx.update(tRef(id), upd);
    if (!me && Object.keys(players).length + 1 >= (Number(s.maxPlayers) || 30)) becameFull = true;
  });
  return {ok: true, becameFull};
});

/* ------------------------------ bingoStart ------------------------------ */
exports.bingoStart = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(tRef(id));
    const t = assertBingo(snap);
    if (t.phase !== "waiting") throw new HttpsError("failed-precondition", "The round already started");
    if (!(await canDrive(tx, uid, request.auth.token, t))) throw new HttpsError("permission-denied", "Only the host can start the game");
    const withCards = Object.values(t.players || {}).filter((p) => (Number(p.cardCount) || 0) > 0 && !p.left);
    if (withCards.length < 2) throw new HttpsError("failed-precondition", "Need at least 2 players with cards");
    const s = t.settings || {};
    const roundN = Number(t.roundN) || 1;
    const order = B.ballOrder(s.variant, (n) => crypto.randomInt(0, n));
    const seed = crypto.randomBytes(16).toString("hex");
    const fairHash = crypto.createHash("sha256").update(order.join(",") + "|" + seed).digest("hex");
    const drawRate = Math.max(0, Number(s.drawRate) || 0);
    const now = Date.now();
    tx.set(engRef(id), {order, seed, round: roundN});
    tx.update(tRef(id), {
      phase: "drawing",
      startedAt: now,
      called: [],
      lastBall: null,
      calledAt: null,
      wonPatterns: {},
      fairHash,
      pauseUntil: null,
      nextDrawAt: drawRate > 0 ? now + drawRate * 1000 : null,
    });
  });
  return {ok: true};
});

/* --------------------------- draw + settlement --------------------------- */

// One ball out of the bag + pattern evaluation. Runs inside a transaction;
// returns the settlement bundle when this ball ended the round (the CALLER
// then runs the money effects, pokerEngine-style).
async function drawBall(tx, id, t) {
  const s = t.settings || {};
  const roundN = Number(t.roundN) || 1;
  const engSnap = await tx.get(engRef(id));
  if (!engSnap.exists || (engSnap.data().round || 1) !== roundN) throw new HttpsError("failed-precondition", "Draw order missing — restart the round");
  const eng = engSnap.data();
  const called = [...(t.called || [])];
  if (called.length >= eng.order.length) return await endRound(tx, id, t, eng, called); // safety
  const ball = eng.order[called.length];
  called.push(ball);
  const calledSet = new Set(called);

  // read every live player's cards (reads before writes)
  const players = t.players || {};
  const liveUids = Object.keys(players).filter((u) => !players[u].left && (Number(players[u].cardCount) || 0) > 0);
  const cardsByUid = {};
  for (const u of liveUids) {
    cardsByUid[u] = curCards(await tx.get(privRef(id, u)), roundN);
  }

  const wonPatterns = {...(t.wonPatterns || {})};
  const active = B.activePatterns(s.variant, s.prizeSplit);
  let newWin = false;
  for (const pat of active) {
    if (wonPatterns[pat]) continue;
    const winners = [];
    for (const u of liveUids) {
      for (const c of cardsByUid[u]) {
        if (B.hasPattern(s.variant, c.nums, calledSet, pat)) {
          winners.push({uid: u, name: players[u].name || "", isBot: !!players[u].isBot, cardId: c.id, nums: c.nums});
          break; // one share per player, even with several completing cards
        }
      }
    }
    if (winners.length) {
      wonPatterns[pat] = {winners, ball, idx: called.length, at: Date.now()};
      newWin = true;
    }
  }

  const fin = B.FINAL_PATTERN[String(s.variant || "90")] || "full";
  const now = Date.now();
  const upd = {
    called,
    lastBall: ball,
    calledAt: now,
    wonPatterns,
    nextDrawAt: (Number(s.drawRate) || 0) > 0 ? now + Number(s.drawRate) * 1000 : null,
    pauseUntil: newWin ? now + WIN_PAUSE_MS : (t.pauseUntil || null),
  };
  if (wonPatterns[fin]) {
    return await endRound(tx, id, t, eng, called, wonPatterns, upd);
  }
  tx.update(tRef(id), upd);
  return null;
}

// Marks the round settled on the public doc and returns the money bundle.
async function endRound(tx, id, t, eng, called, wonPatterns, upd) {
  const s = t.settings || {};
  const players = t.players || {};
  const leftUids = Object.keys(players).filter((u) => players[u].left);
  const wp = wonPatterns || t.wonPatterns || {};
  const st = B.computeSettlement(s, Number(t.bank) || 0, Number(t.feeAcc) || 0, wp, leftUids);
  const now = Date.now();
  tx.update(tRef(id), {
    ...(upd || {}),
    wonPatterns: wp,
    phase: "showdown",
    showdownAt: now,
    nextDrawAt: null,
    pauseUntil: null,
    lastResults: {
      pot: round2(Number(t.bank) || 0),
      rake: st.rake,
      pool: st.pool,
      roundN: Number(t.roundN) || 1,
      calledCount: (called || t.called || []).length,
      patterns: Object.fromEntries(Object.entries(st.perPattern).map(([pat, x]) => [pat, {
        share: x.share,
        prize: x.prize,
        winners: ((wp[pat] || {}).winners || []).map((w) => ({uid: w.uid, name: w.name, isBot: !!w.isBot, cardId: w.cardId, nums: w.nums})),
        ball: (wp[pat] || {}).ball || null,
        idx: (wp[pat] || {}).idx || null,
      }])),
      // provably fair reveal — re-hash order+seed and compare to fairHash
      order: eng ? eng.order : [],
      seed: eng ? eng.seed : "",
      fairHash: t.fairHash || "",
    },
  });
  return {settle: st, t, called: called || t.called || [], wonPatterns: wp};
}

// Post-transaction money effects — pokerEngine.runEffects parity.
async function settleEffects(id, bundle) {
  const {settle: st, t} = bundle;
  const clubId = t.clubId || "main";
  const players = t.players || {};
  // 1) winners
  for (const [uid, amt] of Object.entries(st.prizes)) {
    if (amt <= 0) continue;
    try {
      await db().runTransaction(async (mtx) => {
        const ms = await mtx.get(memRef(uid, clubId));
        if (!ms.exists) return;
        const m = ms.data();
        const stt = m.stats || {gamesPlayed: 0, gamesWon: 0, totalProfit: 0};
        mtx.update(ms.ref, {
          balance: round2((Number(m.balance) || 0) + amt),
          lastRefundAt: Date.now(), // receipt — see watchBalances
          "stats.gamesPlayed": (stt.gamesPlayed || 0) + 1,
          "stats.gamesWon": (stt.gamesWon || 0) + 1,
          "stats.totalProfit": round2((stt.totalProfit || 0) + amt - (Number(players[uid] && players[uid].spent) || 0)),
        });
      });
    } catch (e) {
      console.error("bingo winner credit failed", uid, e);
    }
  }
  // 2) non-winning humans — stats only
  for (const [uid, p] of Object.entries(players)) {
    if (p.isBot || st.prizes[uid] || (Number(p.spent) || 0) <= 0) continue;
    try {
      await db().runTransaction(async (mtx) => {
        const ms = await mtx.get(memRef(uid, clubId));
        if (!ms.exists) return;
        const stt = ms.data().stats || {gamesPlayed: 0, gamesWon: 0, totalProfit: 0};
        mtx.update(ms.ref, {
          "stats.gamesPlayed": (stt.gamesPlayed || 0) + 1,
          "stats.totalProfit": round2((stt.totalProfit || 0) - (Number(p.spent) || 0)),
        });
      });
    } catch (e) { /* stats only */ }
  }
  // 3) house sweep (bot shares + rounding) → club owner
  if (st.house > 0) {
    try {
      const clubSnap = await db().doc(`clubs/${clubId}`).get();
      const ownerUid = clubSnap.exists ? clubSnap.data().ownerUid : null;
      if (ownerUid) {
        await db().runTransaction(async (mtx) => {
          const ms = await mtx.get(memRef(ownerUid, clubId));
          if (!ms.exists) return;
          mtx.update(ms.ref, {
            balance: round2((Number(ms.data().balance) || 0) + st.house),
            clubProfits: round2((Number(ms.data().clubProfits) || 0) + st.house),
          });
        });
      }
    } catch (e) {
      console.error("bingo house sweep failed", e);
    }
  }
  // 4) rake → agent cuts, remainder to the club owner (distributeRake port)
  const humanUids = Object.keys(players).filter((u) => !players[u].isBot && (Number(players[u].spent) || 0) > 0);
  await distributeRakeB(clubId, st.rake, humanUids);
  // 5) game history — winner rows carry the full reveal (card + balls), so a
  //    round can be audited after the fact (who won, with which card, on
  //    which called numbers).
  const rakeShare = humanUids.length ? round2(st.rake / humanUids.length) : 0;
  for (const uid of humanUids) {
    try {
      const p = players[uid];
      const myWins = Object.entries(bundle.wonPatterns || {})
          .filter(([, w]) => (w.winners || []).some((x) => x.uid === uid))
          .map(([pat, w]) => ({
            pattern: pat, ball: w.ball || null, idx: w.idx || null,
            card: ((w.winners || []).find((x) => x.uid === uid) || {}).nums || [],
          }));
      await db().collection("gameLog").add({
        uid, username: p.name || "", game: "bingo", clubId,
        profit: round2((st.prizes[uid] || 0) - (Number(p.spent) || 0)),
        rake: rakeShare, tableId: id, at: Date.now(),
        ...(myWins.length ? {bingo: {wins: myWins, called: bundle.called || [], variant: String((t.settings || {}).variant || "90")}} : {}),
      });
    } catch (e) { /* history is best-effort */ }
  }
}

// computeAgentCuts + creditAgent + creditRakeToClub port (pokerEngine parity).
async function distributeRakeB(clubId, rake, uids) {
  if (!rake || rake <= 0) return;
  let total = 0;
  const cuts = {};
  try {
    const list = (uids || []).filter((u) => u && !String(u).startsWith("bot_"));
    if (list.length) {
      const share = rake / list.length;
      const snaps = await Promise.all(list.map((uid) => memRef(uid, clubId).get()));
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
        await db().runTransaction(async (mtx) => {
          const s = await mtx.get(memRef(agentUid, clubId));
          if (!s.exists) return;
          mtx.update(s.ref, {
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
  await db().runTransaction(async (mtx) => {
    const s = await mtx.get(memRef(ownerUid, clubId));
    if (!s.exists) return;
    mtx.update(s.ref, {
      balance: round2((Number(s.data().balance) || 0) + clubAmt),
      clubProfits: round2((Number(s.data().clubProfits) || 0) + clubAmt),
    });
  });
  await db().collection("agentLog").add({clubId, amount: clubAmt, at: Date.now(), kind: "club"});
}

/* ------------------------------- bingoTick ------------------------------- */
// Called by every viewer every ~2s (pkTick parity) — cheap and idempotent.
// Draws the next ball when its time has come; a raced duplicate collapses
// inside the transaction (called.length moved on → the ball comes from the
// same fixed order, so at most one write wins).
exports.bingoTick = onCall(CALL_OPTS, async (request) => {
  authedUid(request);
  const id = reqTableId(request);
  const pre = await tRef(id).get();
  if (!pre.exists) return {};
  const t0 = pre.data();
  if (t0.type !== "bingo" || t0.phase !== "drawing") return {};
  const rate = Number((t0.settings || {}).drawRate) || 0;
  if (rate <= 0) return {}; // manual mode — the host presses Draw
  const now = Date.now();
  if (t0.nextDrawAt && now < t0.nextDrawAt) return {};
  if (t0.pauseUntil && now < t0.pauseUntil) return {};
  let bundle = null;
  await db().runTransaction(async (tx) => {
    bundle = null;
    const snap = await tx.get(tRef(id));
    const t = assertBingo(snap);
    if (t.phase !== "drawing") return;
    const n = Date.now();
    if (t.nextDrawAt && n < t.nextDrawAt) return;
    if (t.pauseUntil && n < t.pauseUntil) return;
    bundle = await drawBall(tx, id, t);
  });
  if (bundle) await settleEffects(id, bundle);
  return {ok: true};
});

/* ------------------------------- bingoDraw ------------------------------- */
// Manual advance by the host (drawRate 0, or the host hurrying the clock).
exports.bingoDraw = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  let bundle = null;
  await db().runTransaction(async (tx) => {
    bundle = null;
    const snap = await tx.get(tRef(id));
    const t = assertBingo(snap);
    if (t.phase !== "drawing") throw new HttpsError("failed-precondition", "No round in progress");
    if (!(await canDrive(tx, uid, request.auth.token, t))) throw new HttpsError("permission-denied", "Only the host draws");
    bundle = await drawBall(tx, id, t);
  });
  if (bundle) await settleEffects(id, bundle);
  return {ok: true};
});

/* ------------------------------ bingoClaim ------------------------------ */
// The "בינגו!" button. Wins are awarded automatically the moment their ball
// is drawn (auto-call — no prize can be missed), so the claim is a server-
// verified assertion: it confirms the caller's cards against the balls that
// were ACTUALLY called, and a false bingo is rejected loudly.
exports.bingoClaim = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const snap = await tRef(id).get();
  const t = assertBingo(snap);
  if (t.phase !== "drawing" && t.phase !== "showdown") throw new HttpsError("failed-precondition", "No round in progress");
  const s = t.settings || {};
  const roundN = Number(t.roundN) || 1;
  const pSnap = await privRef(id, uid).get();
  const cards = curCards(pSnap, roundN);
  if (!cards.length) throw new HttpsError("failed-precondition", "You have no cards this round");
  const calledSet = new Set(t.called || []);
  const mine = [];
  for (const pat of B.activePatterns(s.variant, s.prizeSplit)) {
    if (cards.some((c) => B.hasPattern(s.variant, c.nums, calledSet, pat))) mine.push(pat);
  }
  if (!mine.length) throw new HttpsError("failed-precondition", "False bingo — the card doesn't complete a pattern with the called balls");
  const confirmed = mine.filter((pat) => (((t.wonPatterns || {})[pat] || {}).winners || []).some((w) => w.uid === uid));
  return {ok: true, patterns: mine, confirmed};
});

/* ------------------------------ bingoLeave ------------------------------ */
// Self leave or admin kick. Before the round starts the purchase is refunded
// in full (price + flat fee); mid-round the cards are forfeited.
exports.bingoLeave = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  const target = (request.data || {}).targetUid || uid;
  let deleted = false;
  let cancelled = null;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(tRef(id));
    const t = assertBingo(snap);
    if (target !== uid && !(await canDrive(tx, uid, request.auth.token, t))) throw new HttpsError("permission-denied", "Not allowed");
    const players = {...(t.players || {})};
    const p = players[target];
    if (!p) return; // already gone — success
    const clubId = t.clubId || "main";

    if (t.phase === "drawing" && !p.left && (Number(p.cardCount) || 0) > 0) {
      // forfeits the cards; if nobody with cards remains, cancel + refund all
      const rest = Object.values(players).filter((q) => q.uid !== target && !q.left && (Number(q.cardCount) || 0) > 0);
      if (rest.length === 0) {
        const spenders = Object.values(players).filter((q) => !q.isBot && (Number(q.spent) || 0) > 0);
        const reads = [];
        for (const q of spenders) reads.push([q, await tx.get(memRef(q.uid, clubId))]);
        for (const [q, ms] of reads) {
          if (ms.exists) {
            tx.update(ms.ref, {
              balance: round2((Number(ms.data().balance) || 0) + (Number(q.spent) || 0)),
              lastRefundAt: Date.now(),
            });
          }
        }
        tx.update(tRef(id), {
          [`players.${target}.left`]: true,
          phase: "showdown",
          showdownAt: Date.now(),
          nextDrawAt: null,
          pauseUntil: null,
          bank: 0,
          feeAcc: 0,
          lastResults: {cancelled: true, pot: 0, rake: 0, pool: 0, patterns: {}, roundN: Number(t.roundN) || 1},
        });
        cancelled = true;
        return;
      }
      tx.update(tRef(id), {[`players.${target}.left`]: true});
      return;
    }

    // waiting / showdown: seat clears; a waiting-phase purchase is refunded
    let refund = 0;
    if (t.phase === "waiting" && !p.isBot && (Number(p.spent) || 0) > 0) {
      refund = round2(Number(p.spent) || 0);
      const s = t.settings || {};
      const price = round2(Number(s.cardPrice) || 0);
      const ms = await tx.get(memRef(target, clubId));
      if (ms.exists) {
        tx.update(ms.ref, {
          balance: round2((Number(ms.data().balance) || 0) + refund),
          lastRefundAt: Date.now(), // receipt — see watchBalances
        });
      }
      const priceBack = round2(price * (Number(p.cardCount) || 0));
      tx.update(tRef(id), {
        bank: round2(Math.max(0, (Number(t.bank) || 0) - priceBack)),
        feeAcc: round2(Math.max(0, (Number(t.feeAcc) || 0) - round2(refund - priceBack))),
      });
    }
    delete players[target];
    tx.set(privRef(id, target), {cards: []});
    if (Object.keys(players).length === 0 && t.phase !== "drawing") {
      tx.delete(tRef(id));
      deleted = true;
      return;
    }
    const upd = {players};
    if (t.hostUid === target) {
      const first = Object.values(players).filter((q) => !q.isBot).sort((a, b) => a.seatIndex - b.seatIndex)[0] ||
          Object.values(players).sort((a, b) => a.seatIndex - b.seatIndex)[0];
      if (first) upd.hostUid = first.uid;
    }
    tx.update(tRef(id), upd);
  });
  return {ok: true, deleted, cancelled: !!cancelled};
});

/* ---------------------------- bingoNewRound ---------------------------- */
// showdown → waiting. Players keep their seats; cards & money counters reset
// and roundN moves on (stale priv cards are ignored by the round tag).
exports.bingoNewRound = onCall(CALL_OPTS, async (request) => {
  const uid = authedUid(request);
  const id = reqTableId(request);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(tRef(id));
    const t = assertBingo(snap);
    if (t.phase !== "showdown") throw new HttpsError("failed-precondition", "The round hasn't ended");
    if (!(await canDrive(tx, uid, request.auth.token, t))) throw new HttpsError("permission-denied", "Only the host starts a new round");
    const players = {};
    Object.entries(t.players || {}).forEach(([k, p]) => {
      if (p.left) return; // deserters drop off between rounds
      players[k] = {...p, cardCount: 0, spent: 0};
    });
    tx.update(tRef(id), {
      players,
      phase: "waiting",
      roundN: (Number(t.roundN) || 1) + 1,
      bank: 0,
      feeAcc: 0,
      called: [],
      lastBall: null,
      calledAt: null,
      wonPatterns: {},
      fairHash: null,
      nextDrawAt: null,
      pauseUntil: null,
      showdownAt: null,
      startedAt: null,
    });
  });
  return {ok: true};
});

/* ------------------------------ bingoPeek ------------------------------ */
// GOD sees everything: every player's cards and the rest of the bag.
exports.bingoPeek = onCall(CALL_OPTS, async (request) => {
  authedUid(request);
  if (!isGodEmail(request.auth.token && request.auth.token.email)) throw new HttpsError("permission-denied", "GOD only");
  const id = reqTableId(request);
  const snap = await tRef(id).get();
  const t = assertBingo(snap);
  const roundN = Number(t.roundN) || 1;
  const out = {};
  for (const u of Object.keys(t.players || {})) {
    out[u] = curCards(await privRef(id, u).get(), roundN).map((c) => ({id: c.id, nums: c.nums}));
  }
  const eng = await engRef(id).get();
  return {
    cards: out,
    order: eng.exists && (eng.data().round || 1) === roundN ? eng.data().order : [],
    seed: eng.exists ? eng.data().seed || "" : "",
  };
});

// Test hook — a plain object, ignored by the Functions deploy loader.
exports.__bingoInternals = {drawBall, endRound, distributeRakeB, canDrive, curCards};
