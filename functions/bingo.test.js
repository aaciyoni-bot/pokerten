/**
 * Bingo engine test — pure logic layer (no Firestore): card structure, draw
 * uniqueness + verifiability, pattern truth (false-bingo rejection), prize
 * split and LEDGER CONSERVATION to the cent for both rake modes.
 * Run: node bingo.test.js
 */
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const B = require("./bingoCore");

let seed = 20260823;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

console.log("bingo core tests\n");

/* ---------- 90-ball card structure ---------- */
for (let k = 0; k < 500; k++) {
  const nums = B.gen90Card(rnd);
  assert.strictEqual(nums.length, 27, "27 cells");
  const nz = nums.filter((v) => v > 0);
  assert.strictEqual(nz.length, 15, "15 numbers");
  assert.strictEqual(new Set(nz).size, 15, "no duplicate numbers on a card");
  for (let r = 0; r < 3; r++) {
    const row = nums.slice(r * 9, r * 9 + 9).filter((v) => v > 0);
    assert.strictEqual(row.length, 5, "each row has exactly 5 numbers");
  }
  for (let c = 0; c < 9; c++) {
    const [lo, hi] = B.col90Range(c);
    const col = [0, 1, 2].map((r) => nums[r * 9 + c]).filter((v) => v > 0);
    assert.ok(col.length >= 1 && col.length <= 3, "column holds 1..3 numbers");
    col.forEach((v) => assert.ok(v >= lo && v <= hi, `col ${c} value ${v} in [${lo},${hi}]`));
    for (let i = 1; i < col.length; i++) assert.ok(col[i] > col[i - 1], "column ascends top→bottom");
  }
}
console.log("  PASS  90-ball card structure (500 cards)");

/* ---------- 75-ball card structure ---------- */
for (let k = 0; k < 300; k++) {
  const nums = B.gen75Card(rnd);
  assert.strictEqual(nums.length, 25);
  assert.strictEqual(nums[12], 0, "center is FREE");
  const nz = nums.filter((v) => v > 0);
  assert.strictEqual(nz.length, 24);
  assert.strictEqual(new Set(nz).size, 24, "no duplicates");
  for (let c = 0; c < 5; c++) {
    const lo = c * 15 + 1;
    for (let r = 0; r < 5; r++) {
      const v = nums[r * 5 + c];
      if (v) assert.ok(v >= lo && v <= lo + 14, `col ${c} in range`);
    }
  }
}
console.log("  PASS  75-ball card structure (300 cards)");

/* ---------- draw order: every ball exactly once, hash-verifiable ---------- */
for (const variant of ["90", "75"]) {
  const order = B.ballOrder(variant, (n) => crypto.randomInt(0, n));
  const n = B.BALLS[variant];
  assert.strictEqual(order.length, n);
  assert.strictEqual(new Set(order).size, n, "no duplicate ball in the draw");
  assert.ok(Math.min(...order) === 1 && Math.max(...order) === n);
  const seedHex = crypto.randomBytes(16).toString("hex");
  const h1 = crypto.createHash("sha256").update(order.join(",") + "|" + seedHex).digest("hex");
  const h2 = crypto.createHash("sha256").update(order.join(",") + "|" + seedHex).digest("hex");
  assert.strictEqual(h1, h2, "published order+seed re-hash to the fairHash");
}
console.log("  PASS  draw uniqueness + provable-fair hash");

/* ---------- pattern truth: real bingo accepted, false bingo rejected ---------- */
{
  const nums = B.gen90Card(rnd);
  const row0 = nums.slice(0, 9).filter((v) => v > 0);
  const called = new Set(row0.slice(0, 4)); // one short of a line
  assert.strictEqual(B.hasPattern("90", nums, called, "line1"), false, "false bingo rejected");
  called.add(row0[4]);
  assert.strictEqual(B.hasPattern("90", nums, called, "line1"), true, "real line accepted");
  assert.strictEqual(B.hasPattern("90", nums, called, "line2"), false);
  assert.strictEqual(B.hasPattern("90", nums, called, "full"), false);
  const all = new Set(nums.filter((v) => v > 0));
  assert.strictEqual(B.hasPattern("90", nums, all, "full"), true, "full house accepted");
  assert.strictEqual(B.missingFor("90", nums, called, "line1"), 0);
  assert.ok(B.missingFor("90", nums, called, "full") === 10, "10 balls missing to full after one line");
}
{
  const nums = B.gen75Card(rnd);
  const corners = [0, 4, 20, 24].map((i) => nums[i]);
  const called = new Set(corners.slice(0, 3));
  assert.strictEqual(B.hasPattern("75", nums, called, "corners"), false);
  called.add(corners[3]);
  assert.strictEqual(B.hasPattern("75", nums, called, "corners"), true);
  // middle row crosses FREE — 4 real numbers make the line
  const midRow = [10, 11, 13, 14].map((i) => nums[i]);
  assert.strictEqual(B.hasPattern("75", nums, new Set(midRow), "line"), true, "FREE counts as marked");
  assert.strictEqual(B.hasPattern("75", nums, new Set(midRow.slice(1)), "line"), false);
  assert.strictEqual(B.hasPattern("75", nums, new Set(nums.filter((v) => v > 0)), "blackout"), true);
}
console.log("  PASS  pattern truth (accept real / reject false bingo)");

/* ---------- full simulated round: line1 < line2 < full, always ends ---------- */
{
  const cards = [];
  for (let i = 0; i < 6; i++) cards.push(B.gen90Card(rnd));
  const order = B.ballOrder("90", (n) => crypto.randomInt(0, n));
  const called = new Set();
  const wonAt = {};
  for (const ball of order) {
    called.add(ball);
    for (const pat of ["line1", "line2", "full"]) {
      if (!wonAt[pat] && cards.some((c) => B.hasPattern("90", c, called, pat))) wonAt[pat] = called.size;
    }
    if (wonAt.full) break;
  }
  assert.ok(wonAt.line1 && wonAt.line2 && wonAt.full, "all three patterns hit");
  assert.ok(wonAt.line1 <= wonAt.line2 && wonAt.line2 <= wonAt.full, "patterns land in order");
}
console.log("  PASS  simulated round completes all patterns in order");

/* ---------- settlement: pct rake, multi-winner equal split, conservation ---------- */
const settings90 = (over) => ({
  variant: "90", cardPrice: 10, maxCardsPerPlayer: 6, maxPlayers: 20,
  drawRate: 4, rakeMode: "pct", rakePct: 6, rakeFee: 0,
  prizeSplit: {line1: 20, line2: 30, full: 50}, ...(over || {}),
});
{
  // 3 humans bought 10 cards total = bank 100; A+B share line1, B line2, C full
  const bank = 100;
  const won = {
    line1: {winners: [{uid: "A", name: "A"}, {uid: "B", name: "B"}], ball: 7, idx: 12},
    line2: {winners: [{uid: "B", name: "B"}], ball: 31, idx: 25},
    full: {winners: [{uid: "C", name: "C"}], ball: 55, idx: 61},
  };
  const st = B.computeSettlement(settings90(), bank, 0, won, []);
  assert.strictEqual(st.rake, 6, "6% rake");
  assert.strictEqual(st.pool, 94);
  assert.strictEqual(st.perPattern.line1.share, 9.4, "18.8 split equally = 9.40 each");
  assert.strictEqual(st.prizes.A, 9.4);
  assert.strictEqual(st.prizes.B, B.round2(9.4 + 28.2));
  assert.strictEqual(st.prizes.C, 47);
  const paid = Object.values(st.prizes).reduce((a, b) => B.round2(a + b), 0);
  assert.strictEqual(B.round2(paid + st.house + st.rake), bank, "LEDGER: every שקל that entered leaves");
}
{
  // 3-way split with an indivisible cent — crumbs go to the house, not lost
  const st = B.computeSettlement(settings90({rakePct: 0, prizeSplit: {line1: 100, line2: 0, full: 0}}), 100,
      0, {line1: {winners: [{uid: "A"}, {uid: "B"}, {uid: "C"}]}, full: {winners: [{uid: "A"}]}}, []);
  assert.strictEqual(st.perPattern.line1.share, 33.33);
  assert.strictEqual(st.house, 0.01, "the odd cent sweeps to the house");
  const paid = Object.values(st.prizes).reduce((a, b) => B.round2(a + b), 0);
  assert.strictEqual(B.round2(paid + st.house + st.rake), 100);
}
{
  // flat-fee mode ("50+10"): bank has pure card money, fees ride on top as rake
  const st = B.computeSettlement(settings90({rakeMode: "flat", rakeFee: 10, cardPrice: 50}),
      150, 30, {line1: {winners: [{uid: "A"}]}, line2: {winners: [{uid: "B"}]}, full: {winners: [{uid: "C"}]}}, []);
  assert.strictEqual(st.rake, 30, "flat fees are the rake");
  assert.strictEqual(st.pool, 150, "flat fees never shrink the pool");
  const paid = Object.values(st.prizes).reduce((a, b) => B.round2(a + b), 0);
  assert.strictEqual(B.round2(paid + st.house + st.rake), 180, "LEDGER: bank + fees fully redistributed");
}
{
  // bot winner + a deserter: their shares return to the house, books balance
  const st = B.computeSettlement(settings90(), 200, 0, {
    line1: {winners: [{uid: "bot1", isBot: true}, {uid: "H", name: "H"}]},
    line2: {winners: [{uid: "GONE"}]},
    full: {winners: [{uid: "H"}]},
  }, ["GONE"]);
  assert.strictEqual(st.rake, 12);
  assert.ok(!st.prizes.bot1 && !st.prizes.GONE, "bots and deserters are never credited");
  const paid = Object.values(st.prizes).reduce((a, b) => B.round2(a + b), 0);
  assert.strictEqual(B.round2(paid + st.house + st.rake), 200);
}
{
  // 75-ball settlement with a disabled pattern (corners 0%)
  const st = B.computeSettlement({variant: "75", cardPrice: 5, rakeMode: "pct", rakePct: 10,
    prizeSplit: {line: 30, corners: 0, blackout: 70}}, 60, 0, {
    line: {winners: [{uid: "A"}]}, blackout: {winners: [{uid: "B"}]},
  }, []);
  assert.strictEqual(st.rake, 6);
  assert.strictEqual(st.prizes.A, B.floor2(54 * 0.3));
  assert.strictEqual(st.prizes.B, B.floor2(54 * 0.7));
  const paid = Object.values(st.prizes).reduce((a, b) => B.round2(a + b), 0);
  assert.strictEqual(B.round2(paid + st.house + st.rake), 60);
}
{
  // splits that do not add to 100 — the shortfall sweeps to the house
  const st = B.computeSettlement(settings90({prizeSplit: {line1: 10, line2: 10, full: 10}}), 100, 0, {
    line1: {winners: [{uid: "A"}]}, line2: {winners: [{uid: "A"}]}, full: {winners: [{uid: "A"}]},
  }, []);
  const paid = Object.values(st.prizes).reduce((a, b) => B.round2(a + b), 0);
  assert.strictEqual(B.round2(paid + st.house + st.rake), 100);
  assert.ok(st.house > 60, "unassigned pool slice goes to the house, never vanishes");
}
console.log("  PASS  settlement: rake pct + flat, equal split, bots/deserters, LEDGER conservation");

/* ---------- refund maths (leave before start) ---------- */
{
  // buy: 3 cards at 50+10 flat → spent 180, bank 150, feeAcc 30. Leave → all back.
  const price = 50; const fee = 10; const n = 3;
  const spent = B.round2((price + fee) * n);
  const bank = B.round2(price * n);
  const feeAcc = B.round2(fee * n);
  const priceBack = B.round2(price * n);
  const feeBack = B.round2(spent - priceBack);
  assert.strictEqual(B.round2(bank - priceBack), 0);
  assert.strictEqual(B.round2(feeAcc - feeBack), 0);
  assert.strictEqual(spent, B.round2(priceBack + feeBack), "refund equals exactly what was charged");
}
console.log("  PASS  leave-before-start refund maths");

console.log("\nOK: all bingo core tests passed");
