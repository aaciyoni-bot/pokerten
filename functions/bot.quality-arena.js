/**
 * Deterministic, duplicate-deal policy comparison through the real engine.
 *
 * node functions/bot.quality-arena.js --baseline /tmp/pokerten-bot-baseline \
 *   --candidate functions --hands 120 --seed 20260923 --seconds 600
 *
 * Snapshot pokerEngine.js and pokerCore.js into --baseline BEFORE editing.
 * Each four-hand block replays one deck with the tested bot in every seat,
 * against station/tight/aggressive reference policies. Both versions receive
 * exactly the same deals. Separate random streams for dealing and every
 * seat/street/decision prevent different MC draw counts from changing deals.
 * Crypto and Math are injected only into sandboxed module instances; global
 * production RNG is never patched. Opponents' private cards and the remaining
 * deck are removed before the tested policy receives state. God guard is off.
 *
 * This is a small, artificial regression benchmark, NOT proof of human-level
 * strength. Results include uncertainty over whole duplicate-deal blocks.
 * Opponents are intentionally simple; no learning, rake or bankroll dynamics.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const assert = require("node:assert/strict");

const SEATS = 4;
const START = 100;
const TYPES = ["station", "tight", "aggressive"];

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest().readUInt32LE(0);
}

function generator(key) {
  let state = hash(key);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function loadVersion(directory) {
  const localRequire = Module.createRequire(__filename);
  let random = () => { throw new Error("Arena RNG used outside a seeded operation"); };
  const arenaMath = Object.create(Math);
  arenaMath.random = () => random();
  const arenaCrypto = Object.create(crypto);
  arenaCrypto.randomInt = (min, max) => {
    if (max === undefined) { max = min; min = 0; }
    assert(Number.isInteger(min) && Number.isInteger(max) && max > min);
    return min + Math.floor(random() * (max - min));
  };
  const cache = new Map();
  const sources = {};
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const filename = path.resolve(directory, name + ".js");
    const source = fs.readFileSync(filename, "utf8");
    sources[name] = crypto.createHash("sha256").update(source).digest("hex");
    const module = new Module(filename, moduleParent);
    cache.set(name, module);
    module.__arenaMath = arenaMath;
    module.filename = filename;
    module.paths = Module._nodeModulePaths(__dirname);
    module.require = (id) => {
      if (id === "crypto" || id === "node:crypto") return arenaCrypto;
      if (id === "./pokerCore") return load("pokerCore");
      return localRequire(id);
    };
    module._compile('"use strict"; const Math = module.__arenaMath;\n' + source, filename);
    return module.exports;
  }
  const moduleParent = module;
  const E = load("pokerEngine").__engineInternals;
  const C = load("pokerCore");
  return {E, C, sources, withRandom(key, fn) {
    const previous = random;
    random = generator(key);
    try { return fn(); } finally { random = previous; }
  }};
}

function makeState(game, block) {
  const players = {};
  for (let seat = 0; seat < SEATS; seat++) {
    const uid = "u" + seat;
    players[uid] = {uid, name: uid, seatIndex: seat, stack: START, bet: 0,
      buyTotal: START, status: "active", isBot: false, botStyle: ["tight", "balanced", "aggressive"][block % 3],
      cards: [], cardCount: 0};
  }
  return {id: "quality-arena", settings: {blinds: 0.5, baseGameType: game,
    rakePercent: 0, actionTime: 30, maxPlayers: SEATS, botGodGuard: false,
    demoOnly: false, runTwice: false}, players,
  gameState: {phase: "waiting", dealerUid: "u" + (block % SEATS)},
  table: {clubId: "arena", history: [], handCount: 0}, raw: {}, priv: {},
  deck: null, now: 1700000000000 + block * 20000, effects: []};
}

function potOf(S) {
  return (S.gameState.pots || []).reduce((n, p) => n + p.amount, 0) +
    Object.values(S.players).reduce((n, p) => n + (p.bet || 0), 0);
}

function reference(type, S, uid, C, random) {
  if (type === "station") return {action: "call"};
  const g = S.gameState;
  const p = S.players[uid];
  const hand = S.priv[uid];
  const cost = Math.max(0, g.highestBet - (p.bet || 0));
  const raise = (amount) => ({action: "raise", amount: C.round2(Math.min(
    p.stack + (p.bet || 0), Math.max(g.highestBet + (g.minRaise || 1), amount)))});
  if (type === "aggressive") {
    if (random() < 0.65 && p.stack > cost) {
      return raise(g.highestBet + Math.max(3, (potOf(S) + cost) * 0.75));
    }
    return {action: "call"};
  }
  assert.equal(type, "tight");
  if (g.phase === "preflop") {
    const ranks = hand.map(c => C.CARD_VALUES.indexOf(c.val) + 2).sort((a, b) => b - a);
    const premium = hand.length === 2 ?
      (ranks[0] === ranks[1] && ranks[0] >= 10 || ranks[0] === 14 && ranks[1] >= 12) :
      (ranks.filter(n => n === 14).length >= 2 || ranks.filter(n => n >= 11).length >= 4);
    if (!premium) return {action: cost > 0 ? "fold" : "call"};
    return cost <= 8 && p.stack > cost ? raise(g.highestBet + 3) : {action: "call"};
  }
  const score = C.bestScoreFull(hand, g.board, g.currentGameType);
  const strong = score >= (hand.length > 2 ? 4000000 : 2000000);
  if (strong && cost <= 0 && p.stack > 0) return raise(potOf(S) * 0.6);
  return {action: cost <= 0 || strong ? "call" : "fold"};
}

function policyView(S, uid) {
  return {...S, deck: undefined, priv: {[uid]: S.priv[uid]},
    players: Object.fromEntries(Object.entries(S.players).map(([key, p]) =>
      [key, {...p, cards: key === uid ? S.priv[uid] : []}]))};
}

function play(version, game, block, heroSeat, seed, expectedDeal) {
  const {E, C} = version;
  const S = makeState(game, block);
  S.players["u" + heroSeat].isBot = true;
  assert.equal(version.withRandom(`${seed}/${game}/${block}/deal`, () => E.startHand(S)), "dealt");
  const deal = JSON.stringify({priv: S.priv, deck: S.deck});
  if (expectedDeal !== undefined) assert.equal(deal, expectedDeal, "Duplicate deals differ");
  const actions = {call: 0, raise: 0, fold: 0};
  const counters = {};
  let decisions = 0;
  let decisionMs = 0;
  let steps = 0;
  while (S.gameState.phase !== "showdown") {
    assert(++steps <= 300, `Hand did not finish: ${game}/${block}/${heroSeat}`);
    const g = S.gameState;
    const uid = g.activeTurnUid;
    if (!uid) {
      assert(g.allInReveal && ["preflop", "flop", "turn", "river"].includes(g.phase), "Missing actor outside all-in runout");
      version.withRandom(`${seed}/${game}/${block}/runout/${g.phase}`, () => E.advancePhase(S));
      continue;
    }
    const seat = S.players[uid]?.seatIndex;
    assert(uid && Number.isInteger(seat), "Missing actor before showdown");
    const key = `${uid}/${g.phase}`;
    counters[key] = (counters[key] || 0) + 1;
    const randomKey = `${seed}/${game}/${block}/${heroSeat}/${key}/${counters[key]}`;
    let move;
    if (seat === heroSeat) {
      const started = performance.now();
      move = version.withRandom(randomKey, () => E.botAction(policyView(S, uid), uid));
      decisionMs += performance.now() - started;
      decisions++;
      assert(move && Object.hasOwn(actions, move.action), "Invalid bot action");
      actions[move.action]++;
    } else {
      const type = TYPES[(seat - heroSeat - 1 + SEATS) % SEATS];
      move = reference(type, S, uid, C, generator(randomKey));
    }
    version.withRandom(randomKey + "/apply", () => E.applyAction(S, uid, move.action, move.amount, false));
    S.now += 2000;
  }
  const finalTotal = Object.values(S.players).reduce((n, p) => n + p.stack, 0) + potOf(S);
  assert(Math.abs(finalTotal - SEATS * START) < 0.011, "Chip conservation failed");
  const hero = S.players["u" + heroSeat];
  return {deal, net: C.round2(hero.stack + (hero.bet || 0) - START),
    decisions, decisionMs, actions};
}

function stats(values) {
  const mean = values.reduce((n, x) => n + x, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((n, x) => n + (x - mean) ** 2, 0) / (values.length - 1) : null;
  const se = variance === null ? null : Math.sqrt(variance / values.length);
  return {bb100: +(mean * 100).toFixed(2), approximate95IntervalBB100: se === null ? null :
    [+(100 * (mean - 1.96 * se)).toFixed(2), +(100 * (mean + 1.96 * se)).toFixed(2)]};
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(args[i].startsWith("--") && args[i + 1], "Arguments need --name value pairs");
    options[args[i].slice(2)] = args[i + 1];
  }
  assert(options.baseline, "Specify --baseline directory containing original engine/core");
  const hands = Number(options.hands || 120);
  assert(Number.isInteger(hands) && hands >= 4 && hands % SEATS === 0, "--hands must be a positive multiple of 4");
  const seed = options.seed || "20260923";
  const maxMs = Number(options.seconds || 600) * 1000;
  const games = (options.games || "NLH,Omaha 6").split(",");
  for (const game of games) assert(["NLH", "Omaha 6"].includes(game), "Supported games: NLH,Omaha 6");
  const baseline = loadVersion(path.resolve(options.baseline));
  const candidate = loadVersion(path.resolve(options.candidate || __dirname));
  const started = Date.now();
  const report = {seed, handsPerVersionPerGame: hands, duplicateDeckBlocks: hands / SEATS,
    seats: SEATS, stackBB: START, opponents: TYPES,
    testedStyles: "tight/balanced/aggressive rotate by deal block", godGuard: false,
    baselineSources: baseline.sources, candidateSources: candidate.sources,
    caveat: "Exploratory artificial opponents; intervals use paired deal blocks, normal approximation. Not a claim of human-level or general superiority.",
    results: []};
  for (const game of games) {
    const values = {baseline: [], candidate: [], delta: []};
    const timing = {baseline: {decisions: 0, milliseconds: 0}, candidate: {decisions: 0, milliseconds: 0}};
    const actions = {baseline: {call: 0, raise: 0, fold: 0}, candidate: {call: 0, raise: 0, fold: 0}};
    for (let block = 0; block < hands / SEATS; block++) {
      const totals = {baseline: 0, candidate: 0};
      for (let seat = 0; seat < SEATS; seat++) {
        assert(Date.now() - started < maxMs, `Arena exceeded ${maxMs / 1000}s; no completed benchmark result. Reduce hands or increase --seconds.`);
        const old = play(baseline, game, block, seat, seed);
        const next = play(candidate, game, block, seat, seed, old.deal);
        for (const [name, result] of [["baseline", old], ["candidate", next]]) {
          totals[name] += result.net;
          timing[name].decisions += result.decisions;
          timing[name].milliseconds += result.decisionMs;
          for (const action of Object.keys(actions[name])) actions[name][action] += result.actions[action];
        }
      }
      values.baseline.push(totals.baseline / SEATS);
      values.candidate.push(totals.candidate / SEATS);
      values.delta.push((totals.candidate - totals.baseline) / SEATS);
      process.stderr.write(`${game}: ${(block + 1) * SEATS}/${hands} paired hands; ${Math.round((Date.now() - started) / 1000)}s\n`);
    }
    const item = {game, baseline: stats(values.baseline), candidate: stats(values.candidate),
      candidateMinusBaseline: stats(values.delta), actions, decisionTiming: timing};
    for (const value of Object.values(timing)) {
      value.meanMilliseconds = +(value.milliseconds / Math.max(1, value.decisions)).toFixed(2);
      value.milliseconds = +value.milliseconds.toFixed(2);
    }
    report.results.push(item);
    process.stderr.write(JSON.stringify(item) + "\n");
  }
  report.elapsedSeconds = +((Date.now() - started) / 1000).toFixed(2);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
module.exports = {generator, loadVersion, play, stats};
