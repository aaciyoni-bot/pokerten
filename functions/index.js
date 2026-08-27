/**
 * Rummikube Clubs — Cloud Functions (money authority)
 *
 * Phase 2, function #1: spinDailyBonus
 * The SERVER decides the prize and moves the chips. The client only triggers
 * the spin and animates the wheel — so a player can no longer fake the prize
 * or edit their own balance through the bonus wheel.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWrittenWithAuthContext} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// Server-authoritative poker engine (pkDeal/pkAct/pkTick/pkLeave/pkRit/
// pkReveal/pkPickGame/pkDiscard/godPeek/admFixGameLog) — see pokerEngine.js.
// Requires the app to be initialized first, hence the require after initializeApp.
Object.assign(exports, require("./pokerEngine"));

const BONUS_COOLDOWN_MS = 22 * 3600 * 1000;          // כמו בלקוח
const BONUS_WEIGHTS = [800, 100, 35, 25, 18, 12, 5, 5];
const DEFAULT_PRIZES = [5, 10, 20, 30, 50, 75, 100, 200];
const SCR_COOLDOWN_MS = 7 * 24 * 3600 * 1000;        // גירוד שבועי
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// תחילת המחזור השבועי (יום שני 00:01 שעון ישראל) - זהה ללקוח
function cycleStartIL() {
  const now = new Date();
  const il = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
  const back = (il.getDay() + 6) % 7;
  const monday = new Date(il);
  monday.setDate(il.getDate() - back);
  monday.setHours(0, 1, 0, 0);
  return Math.round((monday.getTime() + (now.getTime() - il.getTime())) / 60000) * 60000;
}

exports.spinDailyBonus = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  const clubId = request.data && request.data.clubId;
  if (!clubId) throw new HttpsError("invalid-argument", "חסר מזהה קלאב");

  const memRef = db.doc(`memberships/${uid}_${clubId}`);
  const clubRef = db.doc(`clubs/${clubId}`);

  return await db.runTransaction(async (tx) => {
    // --- כל הקריאות לפני כל הכתיבות ---
    const memSnap = await tx.get(memRef);
    if (!memSnap.exists) throw new HttpsError("permission-denied", "אינך חבר בקלאב הזה");
    const mem = memSnap.data();

    const clubSnap = await tx.get(clubRef);
    const club = clubSnap.exists ? clubSnap.data() : {};
    const bw = club.bonusWheel || {};
    if (bw.enabled !== true) throw new HttpsError("failed-precondition", "גלגל הבונוס כבוי");

    const now = Date.now();
    const last = Number(mem.lastBonusAt) || 0;
    if (now - last < BONUS_COOLDOWN_MS) {
      const hrs = Math.ceil((BONUS_COOLDOWN_MS - (now - last)) / 3600000);
      throw new HttpsError("failed-precondition", `הבונוס הבא בעוד ${hrs} שעות`);
    }

    // הגרלה משוקללת — בצד השרת, לא ניתן לזיוף
    const prizes = (Array.isArray(bw.prizes) && bw.prizes.length === 8) ?
      bw.prizes.map((x) => Number(x) || 0) : DEFAULT_PRIZES;
    const total = BONUS_WEIGHTS.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < BONUS_WEIGHTS.length; i++) {
      r -= BONUS_WEIGHTS[i];
      if (r <= 0) { idx = i; break; }
    }
    const prize = prizes[idx];

    const ownerUid = club.ownerUid || "";
    if (ownerUid && ownerUid !== uid) {
      // שימור צ'יפים: הפרס עובר מקופת בעל הקלאב לשחקן
      const ownRef = db.doc(`memberships/${ownerUid}_${clubId}`);
      const ownSnap = await tx.get(ownRef);
      const ownBal = ownSnap.exists ? (Number(ownSnap.data().balance) || 0) : 0;
      if (!ownSnap.exists || ownBal < prize) {
        throw new HttpsError("resource-exhausted", "קופת הקלאב ריקה כרגע - נסה מאוחר יותר");
      }
      tx.update(ownRef, {
        balance: round2(ownBal - prize),
        bonusPaid: round2((Number(ownSnap.data().bonusPaid) || 0) + prize),
      });
      tx.update(memRef, {
        balance: round2((Number(mem.balance) || 0) + prize),
        // bonusTotal = lifetime gifts; bonusOpen = the part still owed back to
        // the club at settlement (ratcheted down in watchBalances when lost).
        bonusTotal: round2((Number(mem.bonusTotal) || 0) + prize),
        bonusOpen: round2((Number(mem.bonusOpen) || 0) + prize),
        lastBonusAt: now,
      });
      return {prize, idx, fromBank: true};
    }

    // הבעלים מסובב על עצמו — הכסף נשאר בקופה שלו, רק מעדכנים זמן
    tx.update(memRef, {lastBonusAt: now});
    return {prize, idx, fromBank: false};
  });
});

/**
 * Phase 2, function #2: claimWeeklyScratch
 * גירוד שבועי — השרת מגריל את הפרס, אוכף את מגבלת הפרסים הגדולים (400/200 פעם
 * בשבוע לכל הקלאב) ומזיז את הצ'יפים. הלקוח רק בונה את הרשת הוויזואלית.
 */
exports.claimWeeklyScratch = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר");
  const clubId = request.data && request.data.clubId;
  if (!clubId) throw new HttpsError("invalid-argument", "חסר מזהה קלאב");

  const memRef = db.doc(`memberships/${uid}_${clubId}`);
  const clubRef = db.doc(`clubs/${clubId}`);

  return await db.runTransaction(async (tx) => {
    const memSnap = await tx.get(memRef);
    if (!memSnap.exists) throw new HttpsError("permission-denied", "אינך חבר בקלאב הזה");
    const mem = memSnap.data();

    const clubSnap = await tx.get(clubRef);
    const club = clubSnap.exists ? clubSnap.data() : {};
    const bw = club.bonusWheel || {};
    if (bw.enabled !== true) throw new HttpsError("failed-precondition", "התכונה כבויה");

    const now = Date.now();
    const lastS = Number(mem.lastScratchAt) || 0;
    if (now - lastS < SCR_COOLDOWN_MS) throw new HttpsError("failed-precondition", "כבר גירדת השבוע");

    // מעקב מגבלת פרסים לפי מחזור שבועי (זהה ללקוח)
    const cycleKey = String(cycleStartIL());
    let sc = club.scratch || {};
    if (sc.key !== cycleKey) sc = {key: cycleKey, won400: false, won200: false};

    const r = Math.random() * 1000;
    let prize;
    if (r < 800) prize = 10;
    else if (r < 950) prize = 15;
    else if (r < 955) prize = !sc.won400 ? 400 : 10;
    else if (r < 965) prize = !sc.won200 ? 200 : 10;
    else prize = 10;
    if (prize === 400) sc = {...sc, won400: true};
    if (prize === 200) sc = {...sc, won200: true};

    const ownerUid = club.ownerUid || "";
    if (ownerUid && ownerUid !== uid) {
      const ownRef = db.doc(`memberships/${ownerUid}_${clubId}`);
      const ownSnap = await tx.get(ownRef);
      const ownBal = ownSnap.exists ? (Number(ownSnap.data().balance) || 0) : 0;
      if (!ownSnap.exists || ownBal < prize) {
        throw new HttpsError("resource-exhausted", "קופת הקלאב ריקה כרגע - נסה מאוחר יותר");
      }
      tx.update(ownRef, {
        balance: round2(ownBal - prize),
        bonusPaid: round2((Number(ownSnap.data().bonusPaid) || 0) + prize),
      });
      tx.update(memRef, {
        balance: round2((Number(mem.balance) || 0) + prize),
        bonusTotal: round2((Number(mem.bonusTotal) || 0) + prize),
        bonusOpen: round2((Number(mem.bonusOpen) || 0) + prize),
        lastScratchAt: now,
      });
      tx.update(clubRef, {scratch: sc});
      return {prize, fromBank: true};
    }

    tx.update(memRef, {lastScratchAt: now});
    tx.update(clubRef, {scratch: sc});
    return {prize, fromBank: false};
  });
});

/**
 * watchBalances — server-side tripwire for balance tampering.
 *
 * Fires on EVERY write to a membership doc, no matter who wrote it or how
 * (app, dev console, REST) — a client cannot bypass or even see it. Any
 * single-write balance jump of ALERT_MIN_JUMP+ that wasn't made by the club
 * owner / the admin SDK is recorded in `securityAlerts`, which only the club
 * owner and super admin can read (see firestore.rules).
 *
 * At a 500-chip threshold every cash-out from a table qualifies, so alerts
 * are AGGREGATED per player per day (one doc, running count/total) — the
 * owner sees "player X: 7 jumps, +12,400 today" instead of a flooded panel.
 *
 * It also REVERTS the one shape that can only be tampering: a player raising
 * their OWN balance with nothing to show for it. Firestore rules cannot close
 * this — the client engine pays wins from players' browsers, so membership
 * writes have to stay open — but every legitimate self-credit in the app
 * touches a bookkeeping field alongside the balance:
 *
 *   cash-out / seat refund / registration rollback -> lastRefundAt
 *   pot or tournament win .......................... stats
 *   wheel / scratch card ........................... lastBonusAt, lastScratchAt,
 *                                                    bonusTotal, bonusOpen
 *   rake to the club / agent cut ................... clubProfits, agentProfits
 *
 * A bare {balance: bigger} poke from a browser console carries none of them,
 * and is put straight back. Only SELF-writes are reverted: credits written by
 * another player's client are how the engine pays everyone, so those stay
 * alert-only. Set `guardRevert: false` on the club doc to fall back to
 * alert-only if a legitimate path is ever caught.
 */
const ALERT_MIN_JUMP = 500;
const REVERT_MIN_JUMP = 100;
// Changing any of these alongside the balance proves the credit came from real
// game bookkeeping rather than a hand-written balance.
const RECEIPT_FIELDS = ["lastRefundAt", "stats", "bonusTotal", "bonusOpen",
  "lastBonusAt", "lastScratchAt", "clubProfits", "agentProfits", "spinPaid"];
const changed = (a, b, k) => JSON.stringify((a || {})[k] === undefined ? null : a[k]) !==
    JSON.stringify((b || {})[k] === undefined ? null : b[k]);

exports.watchBalances = onDocumentWrittenWithAuthContext("memberships/{memId}",
    async (event) => {
      const after = event.data.after.exists ? event.data.after.data() : null;
      if (!after) return; // deletion — nothing to gain
      const before = event.data.before.exists ? event.data.before.data() : null;
      const prev = before ? (Number(before.balance) || 0) : 0;
      const next = Number(after.balance) || 0;
      const delta = round2(next - prev);

      const memId = String(event.params.memId);
      // --- Bonus ratchet -------------------------------------------------
      // bonusOpen is the slice of a player's balance that came from gifts
      // (wheel / scratch / freeroll) and is therefore owed back to the club
      // at settlement. A player can PLAY with it, but never cash it. If they
      // lose it at the tables the debt shrinks with them — so bonusOpen can
      // never exceed the balance actually sitting there. Enforced here, on
      // every write, because this trigger cannot be bypassed by a client.
      const openNow = Number(after.bonusOpen) || 0;
      if (openNow > next + 0.005) {
        try {
          await db.doc(`memberships/${memId}`).update({bonusOpen: round2(Math.max(0, next))});
        } catch (e) { /* doc vanished mid-flight — nothing to ratchet */ }
      }
      // -------------------------------------------------------------------

      if (delta < REVERT_MIN_JUMP) return;

      const clubId = after.clubId || memId.split("_").slice(1).join("_") || "";
      const authType = event.authType || "unknown";
      const byUid = event.authId || "";

      // Admin-SDK writes (our own functions / owner console) are trusted.
      if (authType === "service_account" || authType === "system") return;
      // The club owner moving money (deposits, GENERAL RESET) is legitimate.
      let club = {};
      try {
        const clubSnap = await db.doc(`clubs/${clubId}`).get();
        club = clubSnap.exists ? clubSnap.data() : {};
        if (byUid && byUid === (club.ownerUid || "")) return;
      } catch (e) { /* can't verify → carry on and alert */ }

      const selfWrite = !!byUid && memId.indexOf(byUid + "_") === 0;
      // --- Unbacked self-credit: put it straight back ---------------------
      let reverted = false;
      if (selfWrite && club.guardRevert !== false &&
          !RECEIPT_FIELDS.some((k) => changed(before, after, k))) {
        try {
          await db.runTransaction(async (tx) => {
            const ref = db.doc(`memberships/${memId}`);
            const cur = await tx.get(ref);
            // only undo if nothing legitimate landed in the meantime
            if (cur.exists && Math.abs((Number(cur.data().balance) || 0) - next) < 0.005) {
              tx.update(ref, {balance: round2(prev)});
            }
          });
          reverted = true;
        } catch (e) { /* revert failed — the alert below still fires */ }
      }
      // --------------------------------------------------------------------

      if (delta < ALERT_MIN_JUMP && !reverted) return;

      const now = Date.now();
      const il = new Date(new Date(now).toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
      const dayKey = `${il.getFullYear()}-${String(il.getMonth() + 1).padStart(2, "0")}-${String(il.getDate()).padStart(2, "0")}`;
      const uid = after.uid || memId.split("_")[0];
      const aRef = db.doc(`securityAlerts/${clubId}_${uid}_${dayKey}`);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(aRef);
        const cur = s.exists ? s.data() : {};
        tx.set(aRef, {
          at: now, // last event — panel sorts by this
          day: dayKey,
          clubId,
          memberDoc: memId,
          uid,
          username: after.username || cur.username || "",
          count: (Number(cur.count) || 0) + 1,
          total: round2((Number(cur.total) || 0) + delta),
          maxDelta: Math.max(Number(cur.maxDelta) || 0, delta),
          before: prev, // of the latest jump
          after: next,
          delta,
          byUid,
          authType,
          selfWrite: !!cur.selfWrite || selfWrite,
          reverted: !!cur.reverted || reverted,
          revertedTotal: round2((Number(cur.revertedTotal) || 0) + (reverted ? delta : 0)),
        }, {merge: true});
      });
    });

/**
 * guardTables — chip-conservation tripwire on every table write.
 *
 * The owner has now been bitten twice by a seat quietly showing 0 chips. The
 * client-side sensor could only see writes made by the browser it ran in, and
 * only when the seat count was unchanged — so the write that actually loses
 * the chips (a seat appearing or disappearing) slipped past it.
 *
 * This runs on EVERY write to a table, by any client, and balances the books:
 *
 *   chips(after) - chips(before) = (chips brought in by seats that appeared)
 *                                - (chips carried out by seats that vanished)
 *                                - (rake booked into history by this write)
 *
 * Anything left over is chips created or destroyed. It is recorded in
 * `securityAlerts` with the table, the phase, the account that made the write
 * and the exact per-player breakdown, so the owner sees WHO lost WHAT and can
 * put it back — instead of finding out from a player the next day.
 *
 * Detection only: a table mid-hand must never be rewritten by a trigger.
 */
const CHIP_EPS = 0.02;

const seatChips = (p) => (Number((p || {}).stack) || 0) + (Number((p || {}).bet) || 0) +
    (Number((p || {}).pendingTopUp) || 0);
const potChips = (g) => ((g || {}).pots || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);

exports.guardTables = onDocumentWrittenWithAuthContext("tables/{tableId}",
    async (event) => {
      const before = event.data.before.exists ? event.data.before.data() : null;
      const after = event.data.after.exists ? event.data.after.data() : null;
      if (!before || !after) return; // table opened or closed — nothing to balance

      const pb = before.players || {};
      const pa = after.players || {};
      let sumBefore = 0; let sumAfter = 0; let broughtIn = 0; let carriedOut = 0;
      const moved = [];
      Object.keys(pb).forEach((uid) => {
        sumBefore += seatChips(pb[uid]);
        if (!pa[uid]) carriedOut += seatChips(pb[uid]);
      });
      Object.keys(pa).forEach((uid) => {
        sumAfter += seatChips(pa[uid]);
        if (!pb[uid]) broughtIn += seatChips(pa[uid]);
        else {
          // A top-up, or a bot re-buying on a showcase table, is money
          // arriving at the table — not chips appearing from nowhere.
          // buyTotal is the receipt for it.
          const addedIn = round2((Number(pa[uid].buyTotal) || 0) - (Number(pb[uid].buyTotal) || 0));
          if (addedIn > 0) broughtIn += addedIn;
          const d = round2(seatChips(pa[uid]) - seatChips(pb[uid]) - Math.max(0, addedIn));
          if (Math.abs(d) > CHIP_EPS) moved.push({n: pa[uid].name || uid, uid, d});
        }
      });
      // rake leaves the table when a hand is booked into history
      const hb = (before.history || []).length;
      const ha = (after.history || []).length;
      let rake = 0;
      for (let i = hb; i < ha; i++) rake += Number((after.history[i] || {}).rake) || 0;

      const delta = round2((sumAfter + potChips(after.gameState)) -
          (sumBefore + potChips(before.gameState)) - broughtIn + carriedOut + rake);

      // Two seats sharing an index (or a seat that lost its index entirely)
      // render as two pods stacked on the same spot — the owner has seen this
      // twice. Catch the write that creates it, not the screenshot afterwards.
      const seatIx = Object.values(pa).map((p) => p.seatIndex);
      const bad = [];
      const seen = {};
      Object.entries(pa).forEach(([uid, p]) => {
        const ix = p.seatIndex;
        if (!Number.isFinite(Number(ix))) bad.push(`${p.name || uid}: no seat index`);
        else if (seen[ix]) bad.push(`${p.name || uid} + ${seen[ix]} both on seat ${ix}`);
        else seen[ix] = p.name || uid;
      });
      const cap = Math.max(2, Number((after.settings || {}).maxPlayers) || 6);
      seatIx.forEach((ix) => {
        if (Number(ix) >= cap) bad.push(`seat ${ix} is beyond capacity ${cap}`);
      });

      if (Math.abs(delta) <= CHIP_EPS && !bad.length) return; // books balance — the normal case

      const authType = event.authType || "unknown";
      const byUid = event.authId || "";
      const clubId = after.clubId || "main";
      const tableId = String(event.params.tableId);
      const now = Date.now();
      const il = new Date(new Date(now).toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
      const dayKey = `${il.getFullYear()}-${String(il.getMonth() + 1).padStart(2, "0")}-${String(il.getDate()).padStart(2, "0")}`;
      const aRef = db.doc(`securityAlerts/${bad.length && Math.abs(delta) <= CHIP_EPS ? "seats" : "chips"}_${clubId}_${tableId}_${dayKey}`);
      // biggest loser in this write — that is the seat the owner has to fix
      const worst = moved.slice().sort((a, b) => a.d - b.d)[0] || null;
      await db.runTransaction(async (tx) => {
        const s = await tx.get(aRef);
        const cur = s.exists ? s.data() : {};
        tx.set(aRef, {
          kind: "chips",
          at: now,
          day: dayKey,
          clubId,
          tableId,
          tableName: (after.settings || {}).tableName || "",
          uid: (worst || {}).uid || "",
          username: (worst || {}).n || "",
          count: (Number(cur.count) || 0) + 1,
          delta,
          total: round2((Number(cur.total) || 0) + delta),
          phase: `${(before.gameState || {}).phase}→${(after.gameState || {}).phase}`,
          moved: moved.slice(0, 8),
          seatFault: bad.slice(0, 6),
          byUid,
          authType,
          selfWrite: false,
        }, {merge: true});
      });
    });
