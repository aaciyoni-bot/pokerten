/**
 * LEAK AUDIT — where the bot's money actually goes.
 *
 * Plays self-play hands and attributes every chip won or lost back to the
 * decision that put it there: the street, the action, and what the hand
 * actually was at that moment. Then it also asks the counterfactual that
 * matters most — of the hands it FOLDED, how many would have won at showdown,
 * and what that cost.
 *
 * This is how the 52bb/100 air leak was found. It reports in bb per 100 hands
 * so every line is directly comparable.
 *
 * Run: node leaks.js [hands]
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

const bodyOf = (cards, board) => {
  if (!board || board.length < 3) return {made: -1, outs: 0};
  const sc = C.bestScoreFull(cards, board, 'NLH');
  const made = sc >= 3000000 ? 3 : sc >= 2000000 ? 2 : sc >= 1000000 ? 1 : 0;
  if (board.length >= 5) return {made, outs: 0};
  const known = new Set([...board, ...cards].map(c => c.id));
  let outs = 0;
  C.pokerDeck().filter(c => !known.has(c.id)).forEach(c => {
    if (C.bestScoreFull(cards, [...board, c], 'NLH') >= 4000000) outs++;
  });
  return {made, outs};
};
const label = b => b.made === -1 ? 'preflop' : b.made >= 3 ? 'trips+' : b.made === 2 ? 'two pair' :
  b.made === 1 ? 'a pair' : b.outs >= 8 ? 'a big draw' : b.outs >= 4 ? 'a gutshot' : 'nothing';

const HANDS = Number(process.argv[2]) || 1500;
const SEATS = 6; const BB = 1; const START = 150;
const mk = (uid, i) => ({uid, name: uid, seatIndex: i, stack: START, bet: 0, status: 'active',
  isBot: true, cards: [], cardCount: 0, buyTotal: START});
const S = {id: 'l', settings: {blinds: BB / 2, baseGameType: 'NLH', rakePercent: 0, actionTime: 30, maxPlayers: SEATS},
  players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
  raw: {}, priv: {}, deck: null, now: 17e11, effects: []};
for (let i = 0; i < SEATS; i++) S.players['u' + i] = mk('u' + i, i);

const bucket = {};                 // "street · action · hand"  ->  {n, chips}
const add = (k, n, chips) => { const b = bucket[k] = bucket[k] || {n: 0, chips: 0}; b.n += n; b.chips = C.round2(b.chips + chips); };
let dealt = 0;
let foldedWinners = 0; let foldedWinnerPots = 0; let foldsTotal = 0;

for (let h = 0; h < HANDS; h++) {
  Object.values(S.players).forEach(p => { p.stack = START; p.bet = 0; p.status = 'active'; p.cards = []; });
  S.gameState = {phase: 'waiting', dealerUid: 'u' + (h % SEATS)};
  S.priv = {}; S.effects = []; S.now += 20000;
  if (E.startHand(S) !== 'dealt') continue;
  dealt++;
  const startStack = {};
  Object.values(S.players).forEach(p => { startStack[p.uid] = p.stack + (p.bet || 0); });
  const decisions = [];            // {uid, key}
  const folded = [];               // {uid, cards, street, potAtFold}
  const dealtCards = {};
  Object.keys(S.priv).forEach(u => { dealtCards[u] = S.priv[u]; });

  let g = 0;
  while (S.gameState.phase !== 'showdown' && g++ < 300) {
    const gs = S.gameState;
    const uid = gs.activeTurnUid;
    if (!uid) { E.advancePhase(S); continue; }
    const p = S.players[uid];
    if (!p) { E.advancePhase(S); continue; }
    const mine = (S.priv && S.priv[uid]) || [];
    const t = {settings: S.settings, players: S.players};
    let mv; try { mv = brain(gs, t, {...p, cards: mine}) || {type: 'call'}; } catch (e) { mv = {type: 'call'}; }
    const toCall = C.round2(Math.max(0, gs.highestBet - (p.bet || 0)));
    const bd = bodyOf(mine, gs.board || []);
    const act = mv.type === 'fold' ? 'fold' : (mv.type === 'raise' && mv.amt > gs.highestBet) ? 'raise'
      : toCall > 0 ? 'call' : 'check';
    decisions.push({uid, key: `${gs.phase.padEnd(7)} ${act.padEnd(5)} with ${label(bd)}`});
    if (act === 'fold') {
      foldsTotal++;
      folded.push({uid, cards: mine, potAtFold: C.round2((gs.pots || []).reduce((a, x) => a + (x.amount || 0), 0) +
        Object.values(S.players).reduce((a, q) => a + (q.bet || 0), 0))});
    }
    if (mv.type === 'raise' && mv.amt > (p.bet || 0) && mv.amt > gs.highestBet) E.applyAction(S, uid, 'raise', C.round2(mv.amt), false);
    else E.applyAction(S, uid, mv.type === 'raise' ? 'call' : mv.type, undefined, false);
  }

  // what each seat actually made this hand, split across the decisions it made
  const net = {};
  Object.values(S.players).forEach(p => { net[p.uid] = C.round2((p.stack + (p.bet || 0)) - startStack[p.uid]); });
  const perUid = {};
  decisions.forEach(d => { perUid[d.uid] = (perUid[d.uid] || 0) + 1; });
  decisions.forEach(d => add(d.key, 1, net[d.uid] / perUid[d.uid]));

  // the counterfactual: would a folded hand have won at showdown?
  const board = S.gameState.board || [];
  if (board.length === 5 && folded.length) {
    const survivors = Object.values(S.players).filter(p => p.status === 'active' && (S.priv[p.uid] || []).length);
    if (survivors.length) {
      const best = Math.max.apply(null, survivors.map(p => C.bestScoreFull(S.priv[p.uid], board, 'NLH')));
      folded.forEach(f => {
        if (!f.cards.length) return;
        if (C.bestScoreFull(f.cards, board, 'NLH') > best) { foldedWinners++; foldedWinnerPots += f.potAtFold; }
      });
    }
  }
}

const per100 = x => C.round2(x / dealt * 100);
const rows = Object.entries(bucket).map(([k, v]) => ({k, n: v.n, chips: v.chips, per100: per100(v.chips)}))
  .filter(r => r.n >= 10).sort((a, b) => a.per100 - b.per100);

console.log(`${dealt} self-play hands, ${SEATS} seats, ${START}bb deep — bb per 100 hands\n`);
console.log('  WORST decision classes (money leaving through them):');
rows.slice(0, 12).forEach(r => console.log(`    ${r.k.padEnd(38)} ${String(r.n).padStart(5)}x  ${r.per100 >= 0 ? '+' : ''}${r.per100.toFixed(1).padStart(8)} bb/100`));
console.log('\n  BEST decision classes:');
rows.slice(-6).reverse().forEach(r => console.log(`    ${r.k.padEnd(38)} ${String(r.n).padStart(5)}x  ${r.per100 >= 0 ? '+' : ''}${r.per100.toFixed(1).padStart(8)} bb/100`));
console.log(`\n  folds that would have WON at showdown: ${foldedWinners} of ${foldsTotal} folds` +
  `  (${(foldedWinners / Math.max(1, foldsTotal) * 100).toFixed(1)}%), pots given up ${C.round2(foldedWinnerPots)}bb` +
  ` = ${per100(foldedWinnerPots)}bb/100`);
console.log('  (some of that is unavoidable — folding is how you lose small pots to win big ones —');
console.log('   but a number far above ~15% of folds means the bot is being pushed off winners.)');
