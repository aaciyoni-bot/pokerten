/**
 * PokerTen — Bingo pure logic (no Firestore, no crypto — RNG is injected).
 *
 * Shared by the server engine (bingoEngine.js) and the tests
 * (bingo.test.js). Everything money-related here is deterministic maths so
 * ledger conservation can be asserted to the cent without an emulator.
 *
 * Card layout (Firestore cannot nest arrays, so grids are stored FLAT):
 *   90-ball: nums[27] — 3 rows × 9 cols, row-major, 0 = blank cell.
 *            Column c holds numbers from 1+9*c .. 9+9*c (last col 80..90).
 *            Each row has exactly 5 numbers, each column 1..3 — 15 in total.
 *   75-ball: nums[25] — 5 rows × 5 cols (B I N G O), row-major,
 *            0 = the FREE center. Column c holds 1+15*c .. 15*(c+1).
 */
"use strict";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Prize shares round DOWN so a split can never mint money; the sub-cent
// remainder is swept to the club owner at settlement.
const floor2 = (n) => Math.floor((Number(n) || 0) * 100 + 1e-9) / 100;

// Pattern order = payout order. 'full'/'blackout' always ends the round.
const PATTERNS = {
  "90": ["line1", "line2", "full"],
  "75": ["line", "corners", "blackout"],
};
const FINAL_PATTERN = {"90": "full", "75": "blackout"};
const BALLS = {"90": 90, "75": 75};

/* ------------------------------ card makers ------------------------------ */

// rng() must return a float in [0,1). randInt derives a fair-enough int for
// layout purposes (the DRAW order is what fairness rests on, not the cards).
const ri = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

// 90-ball column number ranges: col 0 → 1-9, col 1 → 10-19, … col 8 → 80-90.
const col90Range = (c) => {
  const lo = c === 0 ? 1 : c * 10;
  const hi = c === 8 ? 90 : c * 10 + 9;
  return [lo, hi];
};

const pickN = (rng, lo, hi, n) => {
  const pool = [];
  for (let v = lo; v <= hi; v++) pool.push(v);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = ri(rng, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).sort((a, b) => a - b);
};

/**
 * gen90Card(rng) -> nums[27] (3×9 flat, 0 = blank).
 * Column counts: nine columns each get 1 number, then 6 more spread randomly
 * (max 3 per column) = 15. Rows are filled greedily — each column places its
 * numbers on the rows with the most remaining capacity, which always lands on
 * exactly 5 numbers per row (Gale–Ryser style argument; asserted anyway).
 */
function gen90Card(rng) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const counts = new Array(9).fill(1);
    let extra = 6;
    while (extra > 0) {
      const c = ri(rng, 9);
      if (counts[c] < 3) {
        counts[c]++;
        extra--;
      }
    }
    const rowLeft = [5, 5, 5];
    const rowsFor = new Array(9).fill(null);
    // place bigger columns first so the greedy never strands capacity
    const order = [...Array(9).keys()].sort((a, b) => counts[b] - counts[a] || rng() - 0.5);
    let ok = true;
    for (const c of order) {
      const rows = [0, 1, 2].sort((a, b) => rowLeft[b] - rowLeft[a] || rng() - 0.5).slice(0, counts[c]);
      if (rows.some((r) => rowLeft[r] <= 0)) {
        ok = false;
        break;
      }
      rows.forEach((r) => rowLeft[r]--);
      rowsFor[c] = rows.sort((a, b) => a - b);
    }
    if (!ok || rowLeft.some((x) => x !== 0)) continue;
    const nums = new Array(27).fill(0);
    for (let c = 0; c < 9; c++) {
      const [lo, hi] = col90Range(c);
      const vals = pickN(rng, lo, hi, counts[c]); // ascending top→bottom (standard)
      rowsFor[c].forEach((r, i) => nums[r * 9 + c] = vals[i]);
    }
    return nums;
  }
  throw new Error("gen90Card: layout failed"); // unreachable in practice
}

/** gen75Card(rng) -> nums[25] (5×5 flat, center 0 = FREE). */
function gen75Card(rng) {
  const nums = new Array(25).fill(0);
  for (let c = 0; c < 5; c++) {
    const lo = c * 15 + 1;
    const need = c === 2 ? 4 : 5;
    const vals = pickN(rng, lo, lo + 14, need);
    let vi = 0;
    for (let r = 0; r < 5; r++) {
      if (c === 2 && r === 2) continue; // FREE
      nums[r * 5 + c] = vals[vi++];
    }
  }
  return nums;
}

const genCard = (variant, rng) => String(variant) === "75" ? gen75Card(rng) : gen90Card(rng);

/** Shuffled full ball order for the round (the provably-fair part). */
function ballOrder(variant, randInt) {
  const n = BALLS[String(variant)] || 90;
  const order = [];
  for (let v = 1; v <= n; v++) order.push(v);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(i + 1); // uniform int in [0, i]
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/* ----------------------------- pattern checks ---------------------------- */

/** Complete-row count of a 90-ball card against a Set of called numbers. */
function rows90Done(nums, calledSet) {
  let done = 0;
  for (let r = 0; r < 3; r++) {
    let full = true;
    for (let c = 0; c < 9; c++) {
      const v = nums[r * 9 + c];
      if (v && !calledSet.has(v)) {
        full = false;
        break;
      }
    }
    if (full) done++;
  }
  return done;
}

const mark75 = (nums, calledSet, i) => nums[i] === 0 || calledSet.has(nums[i]);

const LINES_75 = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  L.push([0, 6, 12, 18, 24]);
  L.push([4, 8, 12, 16, 20]);
  return L;
})();

/**
 * hasPattern(variant, nums, calledSet, pattern) — the server-side truth for a
 * claim: does this card complete the pattern with exactly these called balls?
 * A "false bingo" is simply this returning false.
 */
function hasPattern(variant, nums, calledSet, pattern) {
  if (String(variant) === "75") {
    if (pattern === "line") return LINES_75.some((L) => L.every((i) => mark75(nums, calledSet, i)));
    if (pattern === "corners") return [0, 4, 20, 24].every((i) => mark75(nums, calledSet, i));
    if (pattern === "blackout") return nums.every((v, i) => mark75(nums, calledSet, i));
    return false;
  }
  const done = rows90Done(nums, calledSet);
  if (pattern === "line1") return done >= 1;
  if (pattern === "line2") return done >= 2;
  if (pattern === "full") return done >= 3;
  return false;
}

/** How many balls a card still needs for the pattern (for "one-to-go" UI). */
function missingFor(variant, nums, calledSet, pattern) {
  const miss = (idxs) => idxs.reduce((s, i) => s + (nums[i] !== 0 && !calledSet.has(nums[i]) ? 1 : 0), 0);
  if (String(variant) === "75") {
    if (pattern === "line") return Math.min(...LINES_75.map(miss));
    if (pattern === "corners") return miss([0, 4, 20, 24]);
    return miss([...Array(25).keys()]);
  }
  const rowMiss = [0, 1, 2].map((r) => miss([...Array(9).keys()].map((c) => r * 9 + c)));
  const sorted = [...rowMiss].sort((a, b) => a - b);
  if (pattern === "line1") return sorted[0];
  if (pattern === "line2") return sorted[0] + sorted[1];
  return sorted[0] + sorted[1] + sorted[2];
}

/* ------------------------------- the money ------------------------------- */

/**
 * Active pattern list for a table: patterns with a prize share > 0, plus the
 * terminating pattern (full/blackout) which always runs so the round can end.
 */
function activePatterns(variant, prizeSplit) {
  const fin = FINAL_PATTERN[String(variant)] || "full";
  return PATTERNS[String(variant) === "75" ? "75" : "90"]
      .filter((p) => p === fin || (Number((prizeSplit || {})[p]) || 0) > 0);
}

/**
 * computeSettlement — the single money truth for a bingo round.
 *
 *   bank      = human card money that entered the table (price × cards).
 *   feeAcc    = flat per-card fees already collected on top (rakeMode 'flat').
 *   rake      = pct-of-pot (rakeMode 'pct') or the accumulated flat fees.
 *   pool      = bank - pctRake (flat fees never touch the pool).
 *   prize(p)  = floor2(pool × split% / 100), split equally (floor2) between
 *               that pattern's winners.
 *   Bot / departed winners' shares go to the HOUSE (club owner) — bots play
 *   with house money, so their prizes return to it. Sub-cent crumbs from all
 *   the floors also go to the house. Invariant (asserted in bingo.test.js):
 *       bank + feeAcc = Σ humanPrizes + houseSweep + rake        (exactly)
 *
 * wonPatterns: {pattern: {winners: [{uid, name, isBot}], ball, idx}}
 * Returns {rake, pool, prizes: {uid: amt}, house, perPattern:
 *          {pattern: {share, winners}}, total}
 */
function computeSettlement(settings, bank, feeAcc, wonPatterns, leftUids) {
  const s = settings || {};
  const pctMode = (s.rakeMode || "pct") !== "flat";
  const rake = pctMode ? round2((Number(bank) || 0) * (Number(s.rakePct) || 0) / 100) : round2(feeAcc || 0);
  const pool = round2((Number(bank) || 0) - (pctMode ? rake : 0));
  const split = s.prizeSplit || {};
  const left = new Set(leftUids || []);
  const prizes = {};
  const perPattern = {};
  const variant = String(s.variant || "90");
  let assigned = 0; // pool money that reached a pattern's winners (incl. house shares)
  let house = 0;
  for (const pat of activePatterns(variant, split)) {
    const prize = floor2(pool * (Number(split[pat]) || 0) / 100);
    const winners = ((wonPatterns || {})[pat] || {}).winners || [];
    if (!winners.length || prize <= 0) {
      // In a finished round every active pattern has winners (line ⊂ full);
      // an empty list only happens on a prize of 0 or a cancelled round —
      // the slice is simply never carved out of the pool.
      perPattern[pat] = {share: 0, prize, winners: []};
      continue;
    }
    const share = floor2(prize / winners.length);
    perPattern[pat] = {share, prize, winners};
    for (const w of winners) {
      // Bots play with house money, and a player who abandoned the round
      // forfeited their cards — both shares return to the club owner.
      if (w.isBot || left.has(w.uid)) house = round2(house + share);
      else prizes[w.uid] = round2((prizes[w.uid] || 0) + share);
    }
    assigned = round2(assigned + prize);
    house = round2(house + round2(prize - share * winners.length)); // floor2 crumbs
  }
  // Pool slice never carved out (splits under 100%, floors, unhit patterns)
  // sweeps to the house so every שקל that entered the table leaves it.
  house = round2(house + round2(pool - assigned));
  const total = round2(Object.values(prizes).reduce((a, b) => round2(a + b), 0) + house + rake);
  return {rake, pool, prizes, house, perPattern, total};
}

module.exports = {
  round2, floor2, PATTERNS, FINAL_PATTERN, BALLS,
  gen90Card, gen75Card, genCard, ballOrder,
  rows90Done, hasPattern, missingFor, activePatterns, computeSettlement,
  col90Range, LINES_75,
};
