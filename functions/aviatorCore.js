"use strict";
const crypto = require("node:crypto");

const GROWTH_K = 0.132;
const MAX_CENTS = 500000;
const QUOTE_TTL_MS = 2500;
const toCents = value => Math.floor(Number(value) * 100 + 1e-8);
const multAt = ms => Math.exp(GROWTH_K * Math.max(0, ms) / 1000);
const timeForMult = mult => Math.log(mult) / GROWTH_K * 1000;
const centsAt = ms => Math.min(MAX_CENTS, toCents(multAt(ms)));

function payout(amount, cents) {
  if (!Number.isSafeInteger(amount) || amount < 0 ||
      !Number.isSafeInteger(cents) || cents < 100 || cents > MAX_CENTS) {
    throw new RangeError("Invalid chip amount or multiplier");
  }
  const value = Number(BigInt(amount) * BigInt(cents) / 100n);
  if (!Number.isSafeInteger(value)) throw new RangeError("Chip payout too large");
  return value;
}

function signature(seed, uid, roundId, maxCents, issuedAt) {
  return crypto.createHmac("sha256", seed)
    .update(JSON.stringify([uid, roundId, maxCents, issuedAt])).digest("hex");
}

function makeQuote(seed, uid, roundId, maxCents, issuedAt) {
  return {roundId, maxCents, issuedAt,
    token: signature(seed, uid, roundId, maxCents, issuedAt)};
}

function validQuote(quote, seed, uid, roundId, seenCents, receivedAt) {
  if (!quote || quote.roundId !== roundId ||
      !Number.isSafeInteger(quote.issuedAt) || quote.issuedAt > receivedAt ||
      receivedAt - quote.issuedAt > QUOTE_TTL_MS ||
      !Number.isSafeInteger(quote.maxCents) || quote.maxCents < 100 || quote.maxCents > MAX_CENTS ||
      !Number.isSafeInteger(seenCents) || seenCents < 100 || seenCents > quote.maxCents ||
      !/^[a-f0-9]{64}$/.test(quote.token || "")) return false;
  const expected = signature(seed, uid, roundId, quote.maxCents, quote.issuedAt);
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(quote.token, "hex"));
}

function cashoutPrice({receivedAt, startedAt, crashPoint, autoAt, seenCents}) {
  const crashAt = startedAt + timeForMult(crashPoint);
  const autoCents = autoAt ? toCents(autoAt) : 0;
  // A stored automatic exit is authoritative, including when the client reconnects.
  if (autoCents >= 101 && autoCents < toCents(crashPoint) &&
      receivedAt >= startedAt + timeForMult(autoCents / 100)) {
    return {cents: autoCents, auto: true};
  }
  // Equality belongs to the crash, regardless of settlement transaction order.
  if (receivedAt < startedAt || receivedAt >= crashAt) return {late: true};
  if (!Number.isSafeInteger(seenCents) || seenCents < 100 ||
      seenCents > centsAt(receivedAt - startedAt) || seenCents >= toCents(crashPoint)) {
    return {invalid: true};
  }
  return {cents: seenCents, auto: false};
}

module.exports = {GROWTH_K, MAX_CENTS, QUOTE_TTL_MS, toCents, multAt, timeForMult,
  centsAt, payout, makeQuote, validQuote, cashoutPrice};
