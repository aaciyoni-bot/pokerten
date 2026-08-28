/**
 * DUEL — brain A against brain B at the same table.
 *
 * The reference opponents (nit / station / maniac) are useful for catching
 * leaks, but they are too crude to judge a subtle read: a station never bets,
 * a maniac bets at random, so "he bet three streets, he has it" is false
 * against both by construction. The only opponent that actually plays poker
 * is the brain itself.
 *
 * Seats alternate A, B, A, B, A, B. Whatever one loses the other wins, so the
 * result is a straight answer to "which brain is stronger".
 *
 * Run: node duel.js <A.html> <B.html> [hands]
 */
'use strict';
const fs = require('fs');
const ROOT = '/home/user/pokerten';
const E = require(ROOT + '/functions/pokerEngine').__engineInternals;
const C = require(ROOT + '/functions/pokerCore');

const load = (path, name) => {
  const html = fs.readFileSync(path, 'utf8');
  const i = html.indexOf('const deckWithout = known =>');
  const j = html.indexOf('const simRealEquity =', i);
  if (i < 0 || j < 0) throw new Error('no brain found in ' + path);
  const fn = new Function('pokerDeck', 'bestScoreFull', 'round2', 'GAME_CARDS',
    html.slice(i, j) + '\nreturn botPokerMove;')(C.pokerDeck, C.bestScoreFull, C.round2, C.GAME_CARDS);
  return {name, fn};
};

const A = load(process.argv[2], 'A ' + require('path').basename(process.argv[2]));
const B = load(process.argv[3], 'B ' + require('path').basename(process.argv[3]));
const HANDS = Number(process.argv[4]) || 4000;
const SEATS = 6; const BB = 1; const START = 100;

const mk = (uid, i) => ({uid, name: uid, seatIndex: i, stack: START, bet: 0, status: 'active',
  isBot: true, cards: [], cardCount: 0, buyTotal: START});
const S = {id: 'duel', settings: {blinds: BB / 2, baseGameType: 'NLH', rakePercent: 0, actionTime: 30, maxPlayers: SEATS},
  players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
  raw: {}, priv: {}, deck: null, now: 17e11, effects: []};
for (let i = 0; i < SEATS; i++) S.players['u' + i] = mk('u' + i, i);
const brainOf = i => (i % 2 === 0 ? A : B);

const won = {A: 0, B: 0};
let dealt = 0;
for (let h = 0; h < HANDS; h++) {
  Object.values(S.players).forEach(p => { p.stack = START; p.bet = 0; p.status = 'active'; p.cards = []; });
  S.gameState = {phase: 'waiting', dealerUid: 'u' + (h % SEATS)};
  S.priv = {}; S.effects = []; S.now += 20000;
  if (E.startHand(S) !== 'dealt') continue;
  dealt++;
  let g = 0;
  while (S.gameState.phase !== 'showdown' && g++ < 300) {
    const uid = S.gameState.activeTurnUid;
    if (!uid) { E.advancePhase(S); continue; }
    const p = S.players[uid];
    if (!p) { E.advancePhase(S); continue; }
    const t = {settings: S.settings, players: S.players};
    const b = {...p, cards: (S.priv && S.priv[uid]) || []};
    let mv;
    try { mv = brainOf(p.seatIndex).fn(S.gameState, t, b) || {type: 'call'}; } catch (e) { mv = {type: 'call'}; }
    if (mv.type === 'raise' && mv.amt > (p.bet || 0) && mv.amt > S.gameState.highestBet) E.applyAction(S, uid, 'raise', C.round2(mv.amt), false);
    else E.applyAction(S, uid, mv.type === 'raise' ? 'call' : mv.type, undefined, false);
  }
  Object.values(S.players).forEach(p => {
    won[p.seatIndex % 2 === 0 ? 'A' : 'B'] += (p.stack + (p.bet || 0)) - START;
  });
}

const bb100 = side => (won[side] / (SEATS / 2)) / dealt / BB * 100;
console.log(`${dealt} hands, seats alternating\n`);
console.log(`  ${A.name.padEnd(34)} ${bb100('A') >= 0 ? '+' : ''}${bb100('A').toFixed(2)} bb/100`);
console.log(`  ${B.name.padEnd(34)} ${bb100('B') >= 0 ? '+' : ''}${bb100('B').toFixed(2)} bb/100`);
const edge = bb100('A') - bb100('B');
console.log(`\n  ${Math.abs(edge) < 1 ? 'too close to call' :
  (edge > 0 ? A.name : B.name) + ' is stronger by ' + Math.abs(edge).toFixed(2) + ' bb/100'}`);
