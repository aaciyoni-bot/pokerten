/**
 * "I saw a bot pay a lot of money with nothing in its hand."
 *
 * Every postflop CALL the bot makes, classified by what it actually held at
 * that moment, with the chips it paid. "Nothing" means exactly that: no pair,
 * no straight draw, no flush draw — a hand that cannot win unless the board
 * changes, and no card coming that would change it.
 *
 * Run: node paywith.js [hands]     RK_HTML=<file> to measure another build
 */
'use strict';
const fs = require('fs');
const ROOT = '/home/user/pokerten';
const E = require(ROOT + '/functions/pokerEngine').__engineInternals;
const C = require(ROOT + '/functions/pokerCore');

const html = fs.readFileSync(process.env.RK_HTML || (ROOT + '/index.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); return html.slice(i, j); };
const brain = new Function('pokerDeck', 'bestScoreFull', 'round2', 'GAME_CARDS',
  cut('const deckWithout = known =>', 'const simRealEquity =') + '\nreturn botPokerMove;')(
  C.pokerDeck, C.bestScoreFull, C.round2, C.GAME_CARDS);

// the same question the brain asks itself, asked independently here
const bodyOf = (cards, board) => {
  if (!board || board.length < 3) return {made: 2, outs: 0};
  const sc = C.bestScoreFull(cards, board, 'NLH');
  const made = sc >= 2000000 ? 2 : sc >= 1000000 ? 1 : 0;
  if (board.length >= 5) return {made, outs: 0};
  const known = new Set([...board, ...cards].map(c => c.id));
  let outs = 0;
  C.pokerDeck().filter(c => !known.has(c.id)).forEach(c => {
    if (C.bestScoreFull(cards, [...board, c], 'NLH') >= 4000000) outs++;
  });
  return {made, outs};
};

const HANDS = Number(process.argv[2]) || 1200;
const SEATS = 6; const BB = 1; const START = 200;   // deep, so "a lot of money" is possible
const mk = (uid, i) => ({uid, name: uid, seatIndex: i, stack: START, bet: 0, status: 'active',
  isBot: true, cards: [], cardCount: 0, buyTotal: START});
const S = {id: 'p', settings: {blinds: BB / 2, baseGameType: 'NLH', rakePercent: 0, actionTime: 30, maxPlayers: SEATS},
  players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
  raw: {}, priv: {}, deck: null, now: 17e11, effects: []};
for (let i = 0; i < SEATS; i++) S.players['u' + i] = mk('u' + i, i);

const calls = [];
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
    const gs = S.gameState;
    const t = {settings: S.settings, players: S.players};
    const mine = (S.priv && S.priv[uid]) || [];
    const b = {...p, cards: mine};
    let mv; try { mv = brain(gs, t, b) || {type: 'call'}; } catch (e) { mv = {type: 'call'}; }
    const toCall = C.round2(Math.max(0, gs.highestBet - (p.bet || 0)));
    const potBefore = C.round2((gs.pots || []).reduce((a, x) => a + (x.amount || 0), 0) +
      Object.values(S.players).reduce((a, q) => a + (q.bet || 0), 0));
    if (gs.phase !== 'preflop' && mv.type === 'call' && toCall > 0) {
      calls.push({street: gs.phase, paid: Math.min(toCall, p.stack), potBefore, body: bodyOf(mine, gs.board || [])});
    }
    if (mv.type === 'raise' && mv.amt > (p.bet || 0) && mv.amt > gs.highestBet) E.applyAction(S, uid, 'raise', C.round2(mv.amt), false);
    else E.applyAction(S, uid, mv.type === 'raise' ? 'call' : mv.type, undefined, false);
  }
}

const air = calls.filter(c => c.body.made === 0 && c.body.outs < 8);
const paidAir = C.round2(air.reduce((a, c) => a + c.paid, 0));
const paidAll = C.round2(calls.reduce((a, c) => a + c.paid, 0));
console.log(`${dealt} hands, ${SEATS} seats, ${START}bb deep — ${calls.length} postflop calls\n`);
console.log(`  calls made with NOTHING (no pair, no draw)   ${air.length}  (${(air.length / Math.max(1, calls.length) * 100).toFixed(1)}% of calls)`);
console.log(`  chips paid on those                          ${paidAir}bb  (${(paidAir / Math.max(1, paidAll) * 100).toFixed(1)}% of everything called)`);
console.log(`  per 100 hands that is                        ${C.round2(paidAir / dealt * 100)}bb thrown at nothing\n`);
if (air.length) {
  console.log('  the biggest ones:');
  air.sort((a, b) => b.paid - a.paid).slice(0, 8).forEach(c =>
    console.log(`    ${c.street.padEnd(5)} paid ${String(C.round2(c.paid)).padStart(7)}bb into a pot of ${String(c.potBefore).padStart(7)}bb` +
      `   (${(c.paid / c.potBefore * 100).toFixed(0)}% of the pot)`));
  const byStreet = {};
  air.forEach(c => { byStreet[c.street] = C.round2((byStreet[c.street] || 0) + c.paid); });
  console.log('\n  by street: ' + Object.entries(byStreet).map(([k, v]) => `${k} ${v}bb`).join(' · '));
}
