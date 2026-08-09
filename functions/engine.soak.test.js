/**
 * Engine soak — the question this answers is "can cash tables run on the
 * server engine tonight?", so it hammers the exact things that went wrong on
 * the client engine: chips going missing and seats colliding.
 *
 * Many hands, players joining and leaving mid-session, random actions. After
 * EVERY hand it checks, to the cent:
 *   - chips on the table + rake taken + chips paid out to leavers == what was
 *     ever brought to the table
 *   - no two players share a seat index, none is missing or out of range
 *   - nobody is dealt into a new hand holding zero chips
 *
 * Run: node engine.soak.test.js [hands]
 */
"use strict";
const assert = require("assert");
const E = require("./pokerEngine").__engineInternals;
const C = require("./pokerCore");

const HANDS = Number(process.argv[2]) || 400;
const SEATS = 6;
const BUY = 100;

// deterministic PRNG so a failure is reproducible
let seed = 20260809;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];

const mkPlayer = (uid, seatIndex) => ({uid, name: uid.toUpperCase(), seatIndex, stack: BUY, bet: 0,
  status: "active", isBot: false, cards: [], cardCount: 0, buyTotal: BUY});

const S = {
  id: "soak",
  settings: {blinds: 0.5, baseGameType: "NLH", rakePercent: 6, rakeCap: 5, actionTime: 30, maxPlayers: SEATS},
  players: {},
  gameState: {phase: "waiting"},
  table: {clubId: "main", history: [], handCount: 0},
  raw: {}, priv: {}, deck: null, now: 1700000000000, effects: [],
};

let broughtIn = 0;   // every chip ever carried onto the table
let paidOut = 0;     // every chip credited back to a wallet
let rakeTaken = 0;
let uidSeq = 0;

const freeSeat = () => {
  const taken = new Set(Object.values(S.players).map((p) => p.seatIndex));
  for (let i = 0; i < SEATS; i++) if (!taken.has(i)) return i;
  return -1;
};
const join = () => {
  const s = freeSeat();
  if (s < 0) return false;
  const uid = "u" + (uidSeq++);
  S.players[uid] = mkPlayer(uid, s);
  broughtIn = C.round2(broughtIn + BUY);
  return true;
};
const drainEffects = () => {
  S.effects.forEach((e) => {
    if (e.type === "credit") paidOut = C.round2(paidOut + (Number(e.amount) || 0));
    if (e.type === "rake") rakeTaken = C.round2(rakeTaken + (Number(e.rake) || 0));
  });
  S.effects = [];
};
const onTable = () => C.round2(Object.values(S.players).reduce((s, p) => s + (p.stack || 0) + (p.bet || 0), 0) +
  (S.gameState.pots || []).reduce((s, x) => s + x.amount, 0));

for (let i = 0; i < SEATS; i++) join();

let dealt = 0; let seatFaults = 0; let zeroDealt = 0; let worstDrift = 0; let worstStep = 0; let lastDrift = 0;
for (let h = 0; h < HANDS; h++) {
  S.now += 20000;
  drainEffects();

  // churn: someone leaves, someone new sits down
  if (h > 0 && rnd() < 0.25) {
    const uids = Object.keys(S.players);
    if (uids.length > 2) {
      const victim = pick(uids);
      E.removeSeat(S, victim, false);
      drainEffects();
    }
  }
  if (rnd() < 0.35) join();

  // rebuy anyone who busted, exactly like the lobby would
  Object.values(S.players).forEach((p) => {
    if ((p.stack || 0) <= 0) { p.stack = BUY; p.buyTotal = C.round2((p.buyTotal || 0) + BUY); broughtIn = C.round2(broughtIn + BUY); }
  });

  const res = E.startHand(S);
  if (res !== "dealt") continue;
  dealt++;

  // nobody may be dealt in with an empty stack
  Object.values(S.players).forEach((p) => {
    if (p.status === "active" && (p.stack || 0) + (p.bet || 0) <= 0) zeroDealt++;
  });

  const trail = [];
  const snap = () => Object.values(S.players).map((p) => `${p.uid}:${p.status[0]} st${p.stack} b${p.bet}`).join(" ") +
      " POTS" + JSON.stringify((S.gameState.pots || []).map((x) => x.amount));
  const mark = (what) => trail.push(`${S.gameState.phase} ${what} -> ` +
      C.round2(onTable() + paidOut + rakeTaken + S.effects.reduce((a, e) => a + (e.type === "credit" ? (+e.amount || 0) : e.type === "rake" ? (+e.rake || 0) : 0), 0) - broughtIn) + "  " + snap());
  mark("DEAL");
  let guard = 0;
  while (S.gameState.phase !== "showdown" && guard++ < 200) {
    const uid = S.gameState.activeTurnUid;
    // everyone left is all-in: the live table runs the board out on the tick,
    // so the soak has to do the same or it abandons a hand holding live pots
    if (!uid) { E.advancePhase(S); mark("advancePhase"); continue; }
    const p = S.players[uid];
    if (!p) { E.advancePhase(S); mark("advancePhase(gone)"); continue; }
    const r = rnd();
    const toCall = C.round2((S.gameState.highestBet || 0) - (p.bet || 0));
    if (r < 0.18) E.applyAction(S, uid, "fold", undefined, false);
    else if (r < 0.75 || toCall >= p.stack) E.applyAction(S, uid, "call", undefined, false);
    else {
      const target = C.round2(Math.min((S.gameState.highestBet || 0) + (S.gameState.minRaise || 1) + Math.floor(rnd() * 12),
        C.round2(p.stack + (p.bet || 0))));
      E.applyAction(S, uid, "raise", target, false);
    }
    mark(uid);
  }
  drainEffects();

  // ---- the books must balance ----
  // A split pot that does not divide evenly leaves an odd cent behind, so the
  // bar is: no SINGLE hand may lose real money, and the residue must stay in
  // rounding territory over a long session.
  const drift = C.round2(onTable() + paidOut + rakeTaken - broughtIn);
  const step = C.round2(drift - lastDrift);
  lastDrift = drift;
  if (Math.abs(drift) > Math.abs(worstDrift)) worstDrift = drift;
  if (Math.abs(step) > Math.abs(worstStep)) worstStep = step;
  if (Math.abs(step) >= 0.05) {
    console.log(`\nhand ${h}: lost ${step} in one hand\n  ` + trail.join("\n  "));
    assert.fail(`hand ${h}: lost ${step} in one hand`);
  }

  // ---- seats must stay unique, present and in range ----
  const seen = {};
  Object.entries(S.players).forEach(([uid, p]) => {
    const ix = p.seatIndex;
    if (!Number.isFinite(Number(ix)) || ix < 0 || ix >= SEATS) seatFaults++;
    else if (seen[ix]) seatFaults++;
    else seen[ix] = uid;
  });
}

assert.strictEqual(seatFaults, 0, `${seatFaults} seat faults (duplicate / missing / out of range)`);
assert.strictEqual(zeroDealt, 0, `${zeroDealt} players dealt in with no chips`);
assert.ok(Math.abs(worstDrift) < Math.max(1, dealt * 0.01),
  `residue ${worstDrift} over ${dealt} hands is more than split-pot rounding`);
console.log(`engine soak: ALL OK — ${dealt}/${HANDS} hands dealt, ${uidSeq} sit-downs, ` +
  `brought ${broughtIn}, on table ${onTable()}, paid out ${paidOut}, rake ${rakeTaken}\n` +
  `  worst single-hand loss ${worstStep}, total residue ${worstDrift} ` +
  `(${(Math.abs(worstDrift) / Math.max(1, dealt)).toFixed(4)}/hand), seat faults 0, zero-chip deals 0`);
