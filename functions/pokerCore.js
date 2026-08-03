/**
 * PokerTen — server engine, layer 1: pure poker primitives.
 *
 * Ported 1:1 from the client engine in index.html (lines noted per block) so
 * both engines agree on every card, score and pot to the last chip. Keep the
 * logic byte-compatible with the client: any drift shows up as a "wrong
 * winner" the moment a table fails over between engines.
 */
"use strict";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// index.html:2088-2126 — card model is {id, val, suit} with unicode suits
// and "10" spelled out (NOT "T"). id = val+suit, e.g. "10♥".
const SUITS = ["♠", "♥", "♦", "♣"];
const CARD_VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const GAME_CARDS = {
  "NLH": 2,
  "Pineapple": 3,
  "Omaha 4": 4,
  "Omaha 5": 5,
  "Omaha 6": 6,
};
const HOLE_ORD = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};
const sortHoleCards = (h) => [...h].sort((a, b) =>
  (HOLE_ORD[b.val] || 0) - (HOLE_ORD[a.val] || 0) ||
  String(a.suit).localeCompare(String(b.suit)));

function pokerDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const val of CARD_VALUES) deck.push({id: `${val}${suit}`, val, suit});
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// index.html:2127-2138
const getCombinations = (arr, k) => {
  if (k === 1) return arr.map((a) => [a]);
  if (arr.length === k) return [arr];
  if (arr.length < k) return [];
  const combs = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const head = arr.slice(i, i + 1);
    const tail = getCombinations(arr.slice(i + 1), k - 1);
    for (let j = 0; j < tail.length; j++) combs.push(head.concat(tail[j]));
  }
  return combs;
};

// index.html:2139-2188 — numeric hand score; higher wins. Exact formula
// (including the High Card /15 fraction) must match the client.
const evaluate5Cards = (cards5) => {
  const rankValues = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
  };
  const ranks = cards5.map((c) => rankValues[c.val]).sort((a, b) => b - a);
  const isFlush = cards5.every((c) => c.suit === cards5[0].suit);
  let isStraight = ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5;
  let straightHigh = ranks[0];
  if (ranks.join(",") === "14,5,4,3,2") {
    isStraight = true;
    straightHigh = 5;
  }
  const counts = {};
  ranks.forEach((r) => counts[r] = (counts[r] || 0) + 1);
  const groups = Object.entries(counts).map(([r, c]) => ({
    rank: Number(r),
    count: c,
  })).sort((a, b) => b.count - a.count || b.rank - a.rank);
  const kickers = (skip) => ranks.filter((r) => !skip.includes(r));
  if (isStraight && isFlush) return 8000000 + straightHigh * 10000;
  if (groups[0].count === 4) return 7000000 + groups[0].rank * 10000 + kickers([groups[0].rank])[0];
  if (groups[0].count === 3 && groups[1] && groups[1].count >= 2) return 6000000 + groups[0].rank * 10000 + groups[1].rank;
  if (isFlush) return 5000000 + ranks[0] * 10000 + ranks[1] * 500 + ranks[2] * 25 + ranks[3];
  if (isStraight) return 4000000 + straightHigh * 10000;
  if (groups[0].count === 3) {
    const k = kickers([groups[0].rank]);
    return 3000000 + groups[0].rank * 10000 + k[0] * 100 + k[1];
  }
  if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
    const k = kickers([groups[0].rank, groups[1].rank]);
    return 2000000 + groups[0].rank * 10000 + groups[1].rank * 100 + k[0];
  }
  if (groups[0].count === 2) {
    const k = kickers([groups[0].rank]);
    return 1000000 + groups[0].rank * 10000 + k[0] * 200 + k[1] * 14 + k[2];
  }
  return ranks[0] * 10000 + ranks[1] * 500 + ranks[2] * 25 + ranks[3] + ranks[4] / 15;
};

// index.html:2229
const handName = (s) => s >= 8000000 ? "Straight Flush" :
  s >= 7000000 ? "Four of a Kind" :
  s >= 6000000 ? "Full House" :
  s >= 5000000 ? "Flush" :
  s >= 4000000 ? "Straight" :
  s >= 3000000 ? "Three of a Kind" :
  s >= 2000000 ? "Two Pair" :
  s >= 1000000 ? "Pair" : "High Card";

// index.html:2230-2245 — Omaha must use exactly 2 hole + 3 board.
const bestScoreFull = (hole, board5, gameType) => {
  const omaha = (gameType || "").startsWith("Omaha");
  let best = 0;
  if (omaha) {
    getCombinations(hole, 2).forEach((h) => getCombinations(board5, 3).forEach((b) => {
      const s = evaluate5Cards([...h, ...b]);
      if (s > best) best = s;
    }));
  } else {
    getCombinations([...hole, ...board5], 5).forEach((c) => {
      const s = evaluate5Cards(c);
      if (s > best) best = s;
    });
  }
  return best;
};

// index.html:2189-2216 — side-pot builder. Mutates gs.pots and zeroes bets,
// merging into the previous pot when the eligible set is identical.
const gatherBetsToPots = (gs, playersObj) => {
  if (!gs.pots) gs.pots = [];
  let bettors = Object.values(playersObj).filter((p) => p.bet > 0).sort((a, b) => a.bet - b.bet);
  while (bettors.length > 0) {
    const minBet = bettors[0].bet;
    let potContribution = 0;
    const eligibleUids = bettors.filter((p) => p.status === "active").map((p) => p.uid);
    bettors.forEach((p) => {
      potContribution += minBet;
      p.bet -= minBet;
    });
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

/* Spin & Cash wheel — index.html:2273-2299. Owner rules: the ×100 jackpot is
   a display-only lure that never lands; prize rounds DOWN; keep the weighted
   average multiplier < 3 so the house never loses. */
const SPIN_WHEEL = [
  {mult: 2, weight: 720},
  {mult: 3, weight: 200},
  {mult: 5, weight: 50},
  {mult: 10, weight: 25},
  {mult: 25, weight: 5},
];
// The client wheel graphic's segment ring (index.html:2714) — any mult the
// server writes MUST appear in this list or the wheel animation breaks.
const SPIN_SEGS = [2, 3, 100, 2, 5, 3, 10, 2, 3, 20, 4, 3];
const spinDrawMult = (rnd) => {
  const tot = SPIN_WHEEL.reduce((s, f) => s + f.weight, 0);
  let r = (rnd == null ? Math.random() : rnd) * tot;
  for (const f of SPIN_WHEEL) {
    r -= f.weight;
    if (r < 0) return f.mult;
  }
  return SPIN_WHEEL[0].mult;
};
const spinPrize = (buyIn, mult) => Math.floor((Number(buyIn) || 0) * (Number(mult) || 0));

module.exports = {
  round2, SUITS, CARD_VALUES, GAME_CARDS, HOLE_ORD, sortHoleCards, pokerDeck,
  getCombinations, evaluate5Cards, handName, bestScoreFull, gatherBetsToPots,
  SPIN_WHEEL, SPIN_SEGS, spinDrawMult, spinPrize,
};
