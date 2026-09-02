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

/* ---- house bots: liveliness only. They hold no wallet — their bets are
   round-local props, settled visually and skipped by the money paths. ---- */
const BOT_COUNT = 500;
const BOT_FIRST = ["Dani","Maya","Yossi","Noa","Avi","Tamar","Ronen","Shira","Omer","Lior",
  "Eden","Itay","Gal","Roni","Alex","Nikita","Marco","Leo","Sara","Adam",
  "Max","Nina","Igor","Luca","Amir","Dana","Eli","Mika","Ben","Yael",
  "Oren","Tal","Ariel","Ziv","Ivan","Sofia","Emma","Noam","Idan","Shay"];
const botName = (i) => BOT_FIRST[i % BOT_FIRST.length] + (10 + (i * 7919) % 90);
function seedBots(tx, roundId){
  const n = 35 + crypto.randomInt(31);              // 35..65 bots join each round
  const picked = new Set();
  while (picked.size < n) picked.add(crypto.randomInt(BOT_COUNT));
  for (const i of picked){
    /* realistic table stakes: 100–2,000, log-spread, in round steps */
    const amount = Math.max(100,
      Math.round(Math.pow(10, 2 + Math.random() * 1.301) / 25) * 25);
    const autoAt = Math.random() < 0.8
      ? Math.min(30, round2(1.02 - Math.log(1 - Math.random()) / 1.1))
      : null;                                        // ~20% ride it to the crash
    tx.create(adb.doc(`aviatorBets/${roundId}_bot_${i}`), {
      uid: `bot_${i}`, roundId, amount, autoAt, bot: true,
      name: botName(i), photo: "",
      cashedAt: null, win: 0, lost: false, ts: Date.now(),
    });
  }
}

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
  seedBots(tx, roundId);
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
          results.push({uid: b.uid, delta: win, betAmount: b.amount, mult: b.autoAt, bot: !!b.bot});
        } else {
          tx.update(d.ref, {lost: true});
          results.push({uid: b.uid, delta: 0, betAmount: b.amount, mult: null, bot: !!b.bot});
        }
      }
      for (const r of results) {
        if (r.bot) continue;                 // bots have no wallet or ledger
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
    const peekSnap = await tx.get(adb.doc(`aviatorPeeks/${s.roundId}_${uid}`));
    if (peekSnap.exists) {
      throw new HttpsError("failed-precondition",
        "מצב בקרה פעיל — בסיבוב שנצפה אפשר רק לצפות");
    }
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
  /* what the player's screen showed at the press. Payment is
     min(seen, server) — claiming high changes nothing, claiming what you
     saw makes the screen exactly truthful. */
  const seen = Number(request.data && request.data.seen) || 0;
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
    const timing = {
      uid, roundId: s.roundId, ts: now, flightMs: now - s.phaseAt,
      seen: seen || null, srvMult: mult,
    };
    if (mult >= e.crashPoint) {
      tx.create(adb.collection("aviatorTiming").doc(),
        {...timing, type: "late", crashPoint: e.crashPoint});
      return {late: true};
    }
    const bRef = adb.doc(`aviatorBets/${s.roundId}_${uid}`);
    const bSnap = await tx.get(bRef);
    if (!bSnap.exists || bSnap.data().cashedAt || bSnap.data().lost) {
      throw new HttpsError("failed-precondition", "אין הימור פעיל");
    }
    const amount = bSnap.data().amount;
    const payMult = seen >= 1.01 ? Math.min(mult, round2(seen)) : mult;
    const win = Math.floor(amount * payMult);
    tx.create(adb.collection("aviatorTiming").doc(),
      {...timing, type: "cashout", paid: payMult});
    tx.update(bRef, {cashedAt: payMult, win});
    tx.update(pRef, {balance: FieldValue.increment(win), net: FieldValue.increment(win - amount)});
    ledger(tx, {uid, type: "cashout", amount: win, roundId: s.roundId, mult: payMult, by: "self"});
    return {mult: payMult, win};
  });
  if (out.late) throw new HttpsError("failed-precondition", "המטוס כבר התרסק");
  return {...out, serverNow: Date.now()};
});

/* -------------------------------------------------------------------------
 * avCredit — admin-only top-up (or clawback with a negative amount).
 * This is the ONLY way chips enter the room besides the welcome stack.
 * ---------------------------------------------------------------------- */
/* While Google sign-in is paused there is no admin email on any account,
   so the owner authenticates with a secret code instead (hash-checked,
   never stored in the client). The same code unlocks avPeek. */
/* High-entropy on purpose: this repo is public, so the hash is public,
   and a short numeric code could be brute-forced offline from it. */
const OWNER_CODE_HASH =
  "c6006217569d5fabbd7e4d9264ee23f8d10e651d554c57a992a350f5def72d23";
function codeOk(request) {
  const code = String((request.data && request.data.code) || "").trim();
  return !!code &&
    crypto.createHash("sha256").update(code).digest("hex") === OWNER_CODE_HASH;
}

/* -------------------------------------------------------------------------
 * avPeek — owner supervision: reveals the current round's crash point.
 * Structurally fair: a uid that peeks a round cannot bet in it, and cannot
 * peek while holding a live bet — so the information can never steer play.
 * ---------------------------------------------------------------------- */
exports.avPeek = onCall(AV_OPTS, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  if (!codeOk(request)) throw new HttpsError("permission-denied", "קוד שגוי");
  const out = await adb.runTransaction(async (tx) => {
    const [sSnap, eSnap] = await Promise.all([tx.get(stateRef()), tx.get(engineRef())]);
    if (!sSnap.exists || !eSnap.exists) {
      throw new HttpsError("failed-precondition", "אין חדר פעיל");
    }
    const s = sSnap.data();
    const bSnap = await tx.get(adb.doc(`aviatorBets/${s.roundId}_${uid}`));
    if (bSnap.exists && !bSnap.data().cashedAt && !bSnap.data().lost && !bSnap.data().bot) {
      throw new HttpsError("failed-precondition",
        "יש לך הימור פעיל בסיבוב — בקרה תיפתח בסיבוב הבא");
    }
    tx.set(adb.doc(`aviatorPeeks/${s.roundId}_${uid}`),
      {uid, roundId: s.roundId, ts: Date.now()});
    return {roundId: s.roundId, phase: s.phase, crashPoint: eSnap.data().crashPoint};
  });
  return {...out, serverNow: Date.now()};
});

exports.avCredit = onCall(AV_OPTS, async (request) => {
  if (!isAdmin(request) && !codeOk(request)) {
    throw new HttpsError("permission-denied", "מנהל בלבד");
  }
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
