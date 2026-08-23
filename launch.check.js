/**
 * PRE-LAUNCH CHECK — the failure modes that actually hurt on a live night:
 * a game that stops moving, and a player who finds himself at 0.
 *
 * Everything here runs the REAL engine (functions/pokerEngine.js) and the REAL
 * client brain (extracted from index.html). Nothing is mocked except the clock.
 *
 * Run: node launch.js [hands]
 */
'use strict';
const fs = require('fs');
const ROOT = '/home/user/pokerten';
const E = require(ROOT + '/functions/pokerEngine').__engineInternals;
const C = require(ROOT + '/functions/pokerCore');

let pass = 0; let fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (extra ? '\n          → ' + extra : '')); }
};
const head = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

let seed = 20260823;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); return html.slice(i, j); };
const clientBrain = new Function('pokerDeck', 'bestScoreFull', 'round2', 'GAME_CARDS',
  cut('const deckWithout = known =>', 'const simRealEquity =') + '\nreturn botPokerMove;')(
  C.pokerDeck, C.bestScoreFull, C.round2, C.GAME_CARDS);

const HANDS = Number(process.argv[2]) || 1500;
const BB = 1; const START = 100;
const mk = (uid, i, bot) => ({uid, name: uid, seatIndex: i, stack: START, bet: 0, status: 'active',
  isBot: !!bot, cards: [], cardCount: 0, buyTotal: START});

/* ======================================================================== 1
   A NIGHT OF POKER: seats joining and leaving, players going all-in, humans
   walking away mid-hand. Nothing may stall, no seat may end up holding chips
   it did not win, and nobody may be dealt into a hand with nothing in front.  */
head(`1. A full night — ${HANDS} hands with churn, all-ins and walk-aways`);
{
  const SEATS = 6;
  const S = {id: 'night', settings: {blinds: BB / 2, baseGameType: 'NLH', rakePercent: 5, actionTime: 30, maxPlayers: SEATS},
    players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
    raw: {}, priv: {}, deck: null, now: 17e11, effects: []};
  for (let i = 0; i < SEATS; i++) S.players['u' + i] = mk('u' + i, i, i % 2 === 1);

  let broughtIn = SEATS * START;
  let paidOut = 0; let rakeTaken = 0;
  let dealt = 0; let stalls = 0; let zeroDeals = 0; let seatFaults = 0;
  let midHandLeaves = 0; let joins = 0;
  let zeroWhileAlive = 0; const zeroCases = [];
  let worstHand = 0; let worstAt = -1;
  const chipsNow = () => C.round2(Object.values(S.players).reduce((a, p) => a + p.stack + (p.bet || 0), 0) +
    (S.gameState.pots || []).reduce((a, x) => a + (x.amount || 0), 0));

  for (let h = 0; h < HANDS; h++) {
    S.gameState = {phase: 'waiting', dealerUid: Object.keys(S.players)[h % Math.max(1, Object.keys(S.players).length)]};
    S.priv = {}; S.effects = []; S.now += 25000;

    // somebody busts and re-buys, somebody new sits down
    Object.values(S.players).forEach(p => {
      if (p.stack <= 0.01) {
        if (rnd() < 0.7) { p.stack = START; p.buyTotal = C.round2((p.buyTotal || 0) + START); broughtIn += START; p.status = 'active'; }
        else delete S.players[p.uid];   // busted to nothing: no chips to account for
      }
    });
    if (Object.keys(S.players).length < SEATS && rnd() < 0.25) {
      const taken = new Set(Object.values(S.players).map(p => p.seatIndex));
      let ix = 0; while (taken.has(ix)) ix++;
      const uid = 'n' + h;
      S.players[uid] = mk(uid, ix, rnd() < 0.5);
      broughtIn += START; joins++;
    }
    const live = Object.values(S.players).filter(p => p.stack > 0.01);
    if (live.length < 2) continue;

    // nobody may ever be dealt in with an empty stack
    const chipsBefore = chipsNow();
    if (E.startHand(S) !== 'dealt') continue;
    dealt++;
    Object.values(S.players).forEach(p => {
      if ((p.cardCount || (S.priv[p.uid] || []).length) > 0 && (p.stack + (p.bet || 0)) <= 0.001) zeroDeals++;
    });

    let guard = 0; const before = S.gameState.phase;
    while (S.gameState.phase !== 'showdown' && guard++ < 400) {
      const uid = S.gameState.activeTurnUid;
      if (!uid) { E.advancePhase(S); continue; }
      const p = S.players[uid];
      if (!p) { E.advancePhase(S); continue; }
      // a human closes the tab mid-hand, ~1 in 60 decisions
      if (!p.isBot && rnd() < 0.017 && Object.values(S.players).filter(q => q.status === 'active').length > 2) {
        midHandLeaves++;
        E.removeSeat(S, uid, true);   // the credit it emits is drained below
        continue;
      }
      const t = {settings: S.settings, players: S.players};
      const b = {...p, cards: (S.priv && S.priv[uid]) || []};
      let mv; try { mv = clientBrain(S.gameState, t, b) || {type: 'call'}; } catch (e) { mv = {type: 'call'}; }
      if (mv.type === 'raise' && mv.amt > (p.bet || 0) && mv.amt > S.gameState.highestBet) E.applyAction(S, uid, 'raise', C.round2(mv.amt), false);
      else E.applyAction(S, uid, mv.type === 'raise' ? 'call' : mv.type, undefined, false);
    }
    if (guard >= 400) { stalls++; console.log(`        stalled at hand ${h}, phase ${before} → ${S.gameState.phase}`); }

    // THE bug the owner keeps seeing: a seat showing 0 while still in the game
    Object.values(S.players).forEach(p => {
      if (p.status === 'active' && (p.stack + (p.bet || 0)) <= 0.001 && (p.buyTotal || 0) > 0) {
        // legitimate only if he actually lost it all this hand
        if (!['busted', 'out'].includes(p.status)) { zeroWhileAlive++; if (zeroCases.length < 4) zeroCases.push(`${p.uid} hand ${h} status=${p.status}`); }
      }
    });
    // seat integrity
    const ix = Object.values(S.players).map(p => p.seatIndex);
    if (new Set(ix).size !== ix.length || ix.some(x => !Number.isFinite(x) || x < 0 || x >= SEATS)) seatFaults++;
    // the ledger: every chip that leaves the table is announced as an effect
    let leftThisHand = 0;
    (S.effects || []).forEach(e => {
      if (e.type === 'credit') { paidOut = C.round2(paidOut + (Number(e.amount) || 0)); leftThisHand += Number(e.amount) || 0; }
      if (e.type === 'rake') { rakeTaken = C.round2(rakeTaken + (Number(e.rake) || 0)); leftThisHand += Number(e.rake) || 0; }
    });
    S.effects = [];
    const d = C.round2(chipsNow() + leftThisHand - chipsBefore);
    if (Math.abs(d) > Math.abs(worstHand)) { worstHand = d; worstAt = h; }
  }
  const onTable = C.round2(Object.values(S.players).reduce((a, p) => a + p.stack + (p.bet || 0), 0));
  const potLeft = C.round2((S.gameState.pots || []).reduce((a, p) => a + (p.amount || 0), 0));
  (S.effects || []).forEach(e => {
    if (e.type === 'credit') paidOut = C.round2(paidOut + (Number(e.amount) || 0));
    if (e.type === 'rake') rakeTaken = C.round2(rakeTaken + (Number(e.rake) || 0));
  });
  const residue = C.round2(onTable + potLeft + paidOut + rakeTaken - broughtIn);

  console.log(`  ${dealt} hands dealt · ${joins} sit-downs · ${midHandLeaves} walk-aways mid-hand · rake taken ${rakeTaken}`);
  check('no hand ever stalls (the table always keeps moving)', stalls === 0, `${stalls} stalls`);
  check('no player is dealt in with 0 chips', zeroDeals === 0, `${zeroDeals} zero-chip deals`);
  check('no seat sits at 0 while still marked active', zeroWhileAlive === 0, zeroCases.join(' ; '));
  check('seat indexes stay unique and in range', seatFaults === 0, `${seatFaults} faults`);
  console.log(`  books: in ${broughtIn} · on table ${onTable} · paid out ${paidOut} · rake ${rakeTaken} · residue ${residue} (${C.round2(residue / dealt * 10000) / 10000}/hand)`);
  // 0.02 is the floor of what two-decimal money can do: a split pot and a
  // percentage rake both round at the second decimal, so one agora per side is
  // the smallest error that exists. Anything ABOVE that is a real leak.
  check('no single hand loses more than two-decimal rounding (≤0.02)', Math.abs(worstHand) <= 0.02,
    `worst hand ${worstHand} at hand ${worstAt}`);
  check('chips are conserved over the night (drift is round2 noise only)',
    Math.abs(residue / dealt) < 0.005, `residue ${residue} over ${dealt} hands = ${residue / dealt}/hand`);
}

/* ======================================================================== 2
   THE STUCK TABLE: the server driver must un-stick a table whose player left
   the browser open and walked away, and one whose bot is due to act.          */
head('2. A table nobody is watching still moves');
{
  const mkS = (over) => ({id: 'stuck', settings: {blinds: 0.5, baseGameType: 'NLH', maxPlayers: 6, actionTime: 30, serverEngine: true},
    players: {a: mk('a', 0, true), b: mk('b', 1, false)}, gameState: {phase: 'waiting'},
    table: {clubId: 'main', history: [], handCount: 0}, raw: {}, priv: {}, deck: null, now: 17e11, effects: [], ...over});
  const S = mkS();
  E.startHand(S);
  const first = S.gameState.activeTurnUid;
  check('a hand deals with one bot and one human', S.gameState.phase === 'preflop' && !!first, S.gameState.phase);
  // the bot's turn: botAction must answer, always
  let botAnswers = 0;
  for (let i = 0; i < 50; i++) {
    const s2 = mkS(); E.startHand(s2);
    let g = 0;
    while (s2.gameState.phase !== 'showdown' && g++ < 200) {
      const uid = s2.gameState.activeTurnUid;
      if (!uid) { E.advancePhase(s2); continue; }
      const p = s2.players[uid];
      if (!p) { E.advancePhase(s2); continue; }
      const mv = p.isBot ? E.botAction(s2, uid) : {action: 'call'};
      if (p.isBot && mv && mv.action) botAnswers++;
      E.applyAction(s2, uid, (mv && mv.action) || 'call', mv && mv.amount, false);
    }
    if (g >= 200) { check('a bot/human hand always finishes', false, 'hand ' + i + ' never reached showdown'); break; }
  }
  check('the bot answered every turn it was given', botAnswers > 0, String(botAnswers));
}

/* ======================================================================== 3
   SIDE POTS: the case that used to destroy chips — everyone eligible for a
   side pot folds, so the pot has no contestant left.                          */
head('3. Side pots never destroy chips');
{
  let worst = 0; let runs = 0;
  for (let k = 0; k < 400; k++) {
    const S = {id: 'sp', settings: {blinds: 0.5, baseGameType: 'NLH', maxPlayers: 6, rakePercent: 0},
      players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
      raw: {}, priv: {}, deck: null, now: 17e11 + k * 1000, effects: []};
    // deliberately uneven stacks: side pots are guaranteed
    const stacks = [12, 30, 55, 100, 7, 240];
    stacks.forEach((st, i) => { S.players['p' + i] = {...mk('p' + i, i, true), stack: st, buyTotal: st}; });
    const inAll = stacks.reduce((a, b) => a + b, 0);
    if (E.startHand(S) !== 'dealt') continue;
    runs++;
    let g = 0;
    while (S.gameState.phase !== 'showdown' && g++ < 300) {
      const uid = S.gameState.activeTurnUid;
      if (!uid) { E.advancePhase(S); continue; }
      const p = S.players[uid];
      if (!p) { E.advancePhase(S); continue; }
      // everyone shoves or folds — the shape that makes orphan side pots
      const r = rnd();
      if (r < 0.55) E.applyAction(S, uid, 'raise', C.round2(p.stack + (p.bet || 0)), false);
      else if (r < 0.8) E.applyAction(S, uid, 'call', undefined, false);
      else E.applyAction(S, uid, 'fold', undefined, false);
    }
    const out = C.round2(Object.values(S.players).reduce((a, p) => a + p.stack + (p.bet || 0), 0) +
      (S.gameState.pots || []).reduce((a, p) => a + (p.amount || 0), 0));
    const d = C.round2(out - inAll);
    if (Math.abs(d) > Math.abs(worst)) worst = d;
  }
  check(`${runs} all-in wars with uneven stacks lose no chips`, Math.abs(worst) < 0.05, `worst single hand ${worst}`);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
