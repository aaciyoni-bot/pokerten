/**
 * AVIATORIZIS — server-authoritative crash game (play-money chips).
 *
 * One shared round for every connected phone. The SERVER draws the crash
 * point in secret (publishing only its SHA-256 hash for provable fairness),
 * debits bets, credits cash-outs and settles the round in transactions.
 * Clients only render and ask; no client can write a balance.
 *
 * Money model (separate from the poker club's memberships):
 *   aviatorPlayers/{uid}   balance, net, profile     — functions-only writes
 *   aviatorBets/{rid_uid}  one bet per player/round  — functions-only writes
 *   aviatorRounds/{rid}    settled round history     — functions-only writes
 *   aviatorLedger/{auto}   every chip movement       — functions-only writes
 *   aviator/state          public round state        — functions-only writes
 *   aviator/_engine        the secret (seed, crash)  — no client access at all
 *
 * Round clock: state.phaseAt is server epoch ms. Every callable returns
 * serverNow so clients can offset their local clock and animate smoothly.
 * Rounds advance via avTick, called by whichever clients notice the phase
 * deadline passed — no always-on process, rounds simply pause when the
 * room is empty.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const crypto = require("crypto");

const adb = getFirestore();

const AV_OPTS = {region: "us-central1"};
const ADMIN_EMAIL = "aaci.yoni@gmail.com";

const GROWTH_K = 0.132;             // m(t) = e^(k·t) — must match the client
const WAIT_MS = 7000;               // betting window
const CRASH_HOLD_MS = 3200;         // crash screen hold
const HOUSE_EDGE = 0.03;            // 3% instant bust
const MIN_BET = 25;
const WELCOME_CHIPS = 10000;
const MAX_FLIGHT_MULT = 5000;       // hard ceiling, keeps flights finite
const CASHOUT_GRACE_MS = 250;       // network forgiveness: price the press a
                                    // beat earlier so latency can't eat a
                                    // cash-out the player made in time

const stateRef = () => adb.doc("aviator/state");
const engineRef = () => adb.doc("aviator/_engine");

const multAt = (ms) => Math.exp(GROWTH_K * ms / 1000);
const timeForMult = (m) => Math.log(m) / GROWTH_K * 1000;
const round2 = (m) => Math.floor(m * 100) / 100;

function isAdmin(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  return !!email && String(email).toLowerCase() === ADMIN_EMAIL;
}

function drawRound(roundId) {
  const seed = crypto.randomBytes(16).toString("hex");
  // crash point derived from the seed so the pre-published hash commits to it
  const h = crypto.createHash("sha256").update(seed).digest();
  const r = h.readUInt32BE(0) / 0xFFFFFFFF;            // uniform [0,1)
  let crashPoint;
  if (r < HOUSE_EDGE) crashPoint = 1.00;
  else crashPoint = Math.min(MAX_FLIGHT_MULT,
    Math.max(1.00, Math.floor((0.97 / (1 - (h.readUInt32BE(4) / 0xFFFFFFFF))) * 100) / 100));
  const hash = crypto.createHash("sha256").update(`${roundId}:${seed}:${crashPoint}`).digest("hex");
  return {seed, crashPoint, hash};
}

async function ledger(tx, entry) {
  tx.create(adb.collection("aviatorLedger").doc(), {...entry, ts: Date.now()});
}

/* Ensure the room exists; used by avJoin and avTick. Not transactional on
   its own — callers run it inside their transaction. */
function bootRound(tx, now) {
  const roundId = `r${now}`;
  const {seed, crashPoint, hash} = drawRound(roundId);
  tx.set(engineRef(), {roundId, seed, crashPoint});
  tx.set(stateRef(), {
    roundId, phase: "waiting", phaseAt: now, waitMs: WAIT_MS,
    crashHold: CRASH_HOLD_MS, growthK: GROWTH_K, hash,
    crashPoint: null, seed: null,
  });
  return roundId;
}

/* -------------------------------------------------------------------------
 * avJoin — create/fetch my player doc, boot the room if needed.
 * ---------------------------------------------------------------------- */
exports.avJoin = onCall(AV_OPTS, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  const name = String((request.data && request.data.name) ||
    request.auth.token.name || request.auth.token.phone_number || "Pilot").slice(0, 24);
  const photo = String((request.auth.token.picture) || "").slice(0, 400);

  const pRef = adb.doc(`aviatorPlayers/${uid}`);
  const out = await adb.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(stateRef())]);
    const now = Date.now();
    if (!sSnap.exists) bootRound(tx, now);
    if (!pSnap.exists) {
      tx.set(pRef, {
        uid, name, photo, balance: WELCOME_CHIPS, net: 0,
        admin: isAdmin(request), joinedAt: now, lastSeen: now,
      });
      ledger(tx, {uid, type: "welcome", amount: WELCOME_CHIPS, by: "system"});
      return {balance: WELCOME_CHIPS, isNew: true};
    }
    tx.update(pRef, {lastSeen: now, name, photo, admin: isAdmin(request)});
    return {balance: pSnap.data().balance, isNew: false};
  });
  return {...out, serverNow: Date.now(), admin: isAdmin(request)};
});

/* -------------------------------------------------------------------------
 * avTick — advance the shared round when its deadline passed.
 * Any client may call it; the transaction makes duplicates harmless.
 * ---------------------------------------------------------------------- */
exports.avTick = onCall(AV_OPTS, async (request) => {
  if (!(request.auth && request.auth.uid)) {
    throw new HttpsError("unauthenticated", "צריך להתחבר");
  }
  await adb.runTransaction(async (tx) => {
    const now = Date.now();
    const sSnap = await tx.get(stateRef());
    if (!sSnap.exists) { bootRound(tx, now); return; }
    const s = sSnap.data();

    if (s.phase === "waiting" && now >= s.phaseAt + s.waitMs) {
      tx.update(stateRef(), {phase: "flying", phaseAt: now});
      return;
    }

    if (s.phase === "flying") {
      const eSnap = await tx.get(engineRef());
      const e = eSnap.data() || {};
      const crashAt = s.phaseAt + timeForMult(e.crashPoint || 1);
      if (now < crashAt) return;

      // settle: server-enforced auto cash-outs, everyone else busts
      const betsQ = adb.collection("aviatorBets").where("roundId", "==", s.roundId);
      const bets = await tx.get(betsQ);
      let totalBets = 0; let totalPaid = 0; let players = 0;
      const results = [];
      for (const d of bets.docs) {
        const b = d.data();
        players++; totalBets += b.amount;
        if (b.cashedAt) { totalPaid += b.win; continue; }
        if (b.autoAt && b.autoAt >= 1.01 && b.autoAt < e.crashPoint) {
          const win = Math.floor(b.amount * b.autoAt);
          totalPaid += win;
          tx.update(d.ref, {cashedAt: b.autoAt, win, auto: true});
          results.push({uid: b.uid, delta: win, betAmount: b.amount, mult: b.autoAt});
        } else {
          tx.update(d.ref, {lost: true});
          results.push({uid: b.uid, delta: 0, betAmount: b.amount, mult: null});
        }
      }
      for (const r of results) {
        const pRef = adb.doc(`aviatorPlayers/${r.uid}`);
        const net = r.delta - r.betAmount;
        if (r.delta > 0) {
          tx.update(pRef, {balance: FieldValue.increment(r.delta), net: FieldValue.increment(net)});
          ledger(tx, {uid: r.uid, type: "auto_cashout", amount: r.delta,
            roundId: s.roundId, mult: r.mult, by: "system"});
        } else {
          tx.update(pRef, {net: FieldValue.increment(net)});
        }
      }
      tx.create(adb.doc(`aviatorRounds/${s.roundId}`), {
        roundId: s.roundId, crashPoint: e.crashPoint, seed: e.seed, hash: s.hash,
        endedAt: now, players, totalBets, totalPaid,
      });
      tx.update(stateRef(), {
        phase: "crashed", phaseAt: now,
        crashPoint: e.crashPoint, seed: e.seed,
      });
      return;
    }

    if (s.phase === "crashed" && now >= s.phaseAt + (s.crashHold || CRASH_HOLD_MS)) {
      bootRound(tx, now);
    }
  });
  const after = await stateRef().get();
  return {serverNow: Date.now(), state: after.data() || null};
});

/* -------------------------------------------------------------------------
 * avBet / avCancelBet — betting window only. Balance is debited here and
 * nowhere else; autoAt (optional) is the server-enforced auto cash-out.
 * ---------------------------------------------------------------------- */
exports.avBet = onCall(AV_OPTS, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  const amount = Math.floor(Number(request.data && request.data.amount) || 0);
  const rawAuto = Number(request.data && request.data.autoAt) || 0;
  const autoAt = rawAuto >= 1.01 ? Math.min(1000, round2(rawAuto)) : null;
  if (amount < MIN_BET) throw new HttpsError("invalid-argument", `מינימום ${MIN_BET}`);

  const pRef = adb.doc(`aviatorPlayers/${uid}`);
  const out = await adb.runTransaction(async (tx) => {
    const [sSnap, pSnap] = await Promise.all([tx.get(stateRef()), tx.get(pRef)]);
    if (!sSnap.exists || !pSnap.exists) throw new HttpsError("failed-precondition", "אין חדר פעיל");
    const s = sSnap.data();
    if (s.phase !== "waiting" || Date.now() >= s.phaseAt + s.waitMs) {
      throw new HttpsError("failed-precondition", "חלון ההימורים סגור");
    }
    const p = pSnap.data();
    const bRef = adb.doc(`aviatorBets/${s.roundId}_${uid}`);
    const bSnap = await tx.get(bRef);
    const prior = bSnap.exists && !bSnap.data().cashedAt && !bSnap.data().lost
      ? bSnap.data().amount : 0;
    if (amount > p.balance + prior) throw new HttpsError("failed-precondition", "אין מספיק צ'יפים");
    tx.set(bRef, {
      uid, roundId: s.roundId, amount, autoAt,
      name: p.name || "Pilot", photo: p.photo || "",
      cashedAt: null, win: 0, lost: false, ts: Date.now(),
    });
    tx.update(pRef, {balance: FieldValue.increment(prior - amount)});
    ledger(tx, {uid, type: "bet", amount: -(amount - prior), roundId: s.roundId, by: "self"});
    return {balance: p.balance + prior - amount, roundId: s.roundId};
  });
  return {...out, serverNow: Date.now()};
});

exports.avCancelBet = onCall(AV_OPTS, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  const pRef = adb.doc(`aviatorPlayers/${uid}`);
  const out = await adb.runTransaction(async (tx) => {
    const sSnap = await tx.get(stateRef());
    if (!sSnap.exists) throw new HttpsError("failed-precondition", "אין חדר פעיל");
    const s = sSnap.data();
    if (s.phase !== "waiting") throw new HttpsError("failed-precondition", "הסיבוב כבר יצא");
    const bRef = adb.doc(`aviatorBets/${s.roundId}_${uid}`);
    const bSnap = await tx.get(bRef);
    if (!bSnap.exists) throw new HttpsError("failed-precondition", "אין הימור לביטול");
    const amount = bSnap.data().amount;
    tx.delete(bRef);
    tx.update(pRef, {balance: FieldValue.increment(amount)});
    ledger(tx, {uid, type: "bet_cancel", amount, roundId: s.roundId, by: "self"});
    return {refunded: amount};
  });
  return {...out, serverNow: Date.now()};
});

/* -------------------------------------------------------------------------
 * avCashout — the moment of truth. The multiplier is computed from the
 * SERVER clock, so a hacked client gains nothing; latency is part of the
 * game exactly like in the real thing.
 * ---------------------------------------------------------------------- */
exports.avCashout = onCall(AV_OPTS, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  const pRef = adb.doc(`aviatorPlayers/${uid}`);
  const out = await adb.runTransaction(async (tx) => {
    const now = Date.now();
    const [sSnap, eSnap] = await Promise.all([tx.get(stateRef()), tx.get(engineRef())]);
    if (!sSnap.exists) throw new HttpsError("failed-precondition", "אין חדר פעיל");
    const s = sSnap.data();
    const e = eSnap.data() || {};
    if (s.phase !== "flying") throw new HttpsError("failed-precondition", "אין טיסה פעילה");
    const mult = round2(Math.min(
      multAt(Math.max(0, now - CASHOUT_GRACE_MS - s.phaseAt)), MAX_FLIGHT_MULT));
    if (mult >= e.crashPoint) throw new HttpsError("failed-precondition", "המטוס כבר התרסק");
    const bRef = adb.doc(`aviatorBets/${s.roundId}_${uid}`);
    const bSnap = await tx.get(bRef);
    if (!bSnap.exists || bSnap.data().cashedAt || bSnap.data().lost) {
      throw new HttpsError("failed-precondition", "אין הימור פעיל");
    }
    const amount = bSnap.data().amount;
    const win = Math.floor(amount * mult);
    tx.update(bRef, {cashedAt: mult, win});
    tx.update(pRef, {balance: FieldValue.increment(win), net: FieldValue.increment(win - amount)});
    ledger(tx, {uid, type: "cashout", amount: win, roundId: s.roundId, mult, by: "self"});
    return {mult, win};
  });
  return {...out, serverNow: Date.now()};
});

/* -------------------------------------------------------------------------
 * avCredit — admin-only top-up (or clawback with a negative amount).
 * This is the ONLY way chips enter the room besides the welcome stack.
 * ---------------------------------------------------------------------- */
exports.avCredit = onCall(AV_OPTS, async (request) => {
  if (!isAdmin(request)) throw new HttpsError("permission-denied", "מנהל בלבד");
  const target = String(request.data && request.data.uid || "");
  const amount = Math.round(Number(request.data && request.data.amount) || 0);
  if (!target || !amount || Math.abs(amount) > 1e12) {
    throw new HttpsError("invalid-argument", "uid וסכום נדרשים");
  }
  const pRef = adb.doc(`aviatorPlayers/${target}`);
  const out = await adb.runTransaction(async (tx) => {
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists) throw new HttpsError("not-found", "שחקן לא נמצא");
    const newBal = Math.max(0, (pSnap.data().balance || 0) + amount);
    tx.update(pRef, {balance: newBal});
    ledger(tx, {uid: target, type: "admin_credit", amount, by: request.auth.uid});
    return {balance: newBal};
  });
  return {...out, serverNow: Date.now()};
});
