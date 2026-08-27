/**
 * CLUBCULATION data contract — asserted against the REAL engine, not against
 * a description of it. Plays hands on a table of humans and bots and checks
 * every gameLog row the app would write.
 *
 * Run: node contract.js
 */
'use strict';
const fs = require('fs');
const ROOT = '/home/user/pokerten';
const E = require(ROOT + '/functions/pokerEngine').__engineInternals;
const C = require(ROOT + '/functions/pokerCore');

let pass = 0; let fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '\n        → ' + extra : '')); } };

const html = fs.readFileSync(ROOT + '/index.html', 'utf8');

/* ---- 1. every gameLog writer in the client emits the contract fields ---- */
{
  const i = html.indexOf('const logGameResult = async');
  const src = html.slice(i, html.indexOf('};', html.indexOf('addDoc', i)));
  ['uid:', 'clubId:', 'profit:', 'rake:', 'game:', 'tableId:', 'at:'].forEach(f =>
    check(`logGameResult writes ${f.replace(':', '')}`, src.includes(f), src.slice(0, 200)));
}
/* the manual correction row is written directly, not through logGameResult */
{
  const i = html.indexOf("game: 'adjust'");
  const src = html.slice(Math.max(0, i - 400), i + 400);
  check("the 'adjust' row carries rake and tableId too", /rake:\s*0/.test(src) && /tableId:\s*''/.test(src), src.slice(300, 700));
}

/* ---- 2. rake: real, human-only, and not inflated ------------------------ */
{
  const SEATS = 4;                       // 1 human, 3 bots — the inflating case
  const S = {id: 'c', settings: {blinds: 0.5, baseGameType: 'NLH', rakePercent: 10, actionTime: 30, maxPlayers: SEATS},
    players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
    raw: {}, priv: {}, deck: null, now: 17e11, effects: []};
  for (let i = 0; i < SEATS; i++) {
    S.players['u' + i] = {uid: 'u' + i, name: 'u' + i, seatIndex: i, stack: 100, bet: 0,
      status: 'active', isBot: i > 0, cards: [], cardCount: 0, buyTotal: 100};
  }
  let rows = []; let rakeEffects = 0; let botRows = 0; let hands = 0;
  for (let h = 0; h < 400; h++) {
    Object.values(S.players).forEach(p => { p.stack = 100; p.bet = 0; p.status = 'active'; p.cards = []; });
    S.gameState = {phase: 'waiting', dealerUid: 'u' + (h % SEATS)};
    S.priv = {}; S.effects = []; S.now += 20000;
    if (E.startHand(S) !== 'dealt') continue;
    hands++;
    let g = 0;
    while (S.gameState.phase !== 'showdown' && g++ < 300) {
      const uid = S.gameState.activeTurnUid;
      if (!uid) { E.advancePhase(S); continue; }
      const p = S.players[uid];
      if (!p) { E.advancePhase(S); continue; }
      const mv = E.botAction(S, uid) || {action: 'call'};
      E.applyAction(S, uid, mv.action, mv.amount, false);
    }
    S.effects.forEach(e => {
      if (e.type === 'rake') rakeEffects = C.round2(rakeEffects + (e.rake || 0));
      if (e.type === 'gameLog') (e.entries || []).forEach(r => {
        rows.push(r);
        if ((S.players[r.uid] || {}).isBot) botRows++;
      });
    });
  }
  const logged = C.round2(rows.reduce((a, r) => a + (r.rake || 0), 0));
  check(`no gameLog row is ever written for a bot (${hands} hands)`, botRows === 0, `${botRows} bot rows`);
  check('every row carries a numeric rake', rows.every(r => typeof r.rake === 'number' && !isNaN(r.rake)));
  check('every row carries a numeric profit', rows.every(r => typeof r.profit === 'number' && !isNaN(r.profit)));
  // 1 human of 4 dealt: the human may carry at most his own quarter, never all of it
  check('the lone human is not charged the whole table\'s rake',
    logged <= rakeEffects * 0.35 + 0.5,
    `rake taken ${rakeEffects}, attributed to the human ${logged} (${(logged / rakeEffects * 100).toFixed(0)}% of it — a quarter is right for 1 human in 4)`);
  console.log(`      rake taken from pots ${rakeEffects} · attributed to the one human ${logged} (${(logged / rakeEffects * 100).toFixed(1)}%)`);
}

/* ---- 3. a bots-only table writes nothing at all ------------------------- */
{
  const SEATS = 4;
  const S = {id: 'b', settings: {blinds: 0.5, baseGameType: 'NLH', rakePercent: 10, actionTime: 30, maxPlayers: SEATS},
    players: {}, gameState: {phase: 'waiting'}, table: {clubId: 'main', history: [], handCount: 0},
    raw: {}, priv: {}, deck: null, now: 17e11, effects: []};
  for (let i = 0; i < SEATS; i++) {
    S.players['u' + i] = {uid: 'u' + i, name: 'u' + i, seatIndex: i, stack: 100, bet: 0,
      status: 'active', isBot: true, cards: [], cardCount: 0, buyTotal: 100};
  }
  let rows = 0;
  for (let h = 0; h < 200; h++) {
    Object.values(S.players).forEach(p => { p.stack = 100; p.bet = 0; p.status = 'active'; p.cards = []; });
    S.gameState = {phase: 'waiting', dealerUid: 'u' + (h % SEATS)};
    S.priv = {}; S.effects = []; S.now += 20000;
    if (E.startHand(S) !== 'dealt') continue;
    let g = 0;
    while (S.gameState.phase !== 'showdown' && g++ < 300) {
      const uid = S.gameState.activeTurnUid;
      if (!uid) { E.advancePhase(S); continue; }
      if (!S.players[uid]) { E.advancePhase(S); continue; }
      const mv = E.botAction(S, uid) || {action: 'call'};
      E.applyAction(S, uid, mv.action, mv.amount, false);
    }
    S.effects.forEach(e => { if (e.type === 'gameLog') rows += (e.entries || []).length; });
  }
  check('a bots-only table writes zero gameLog rows (200 hands)', rows === 0, `${rows} rows`);
}

/* ---- 4. the button, and the rules the reader needs ---------------------- */
check('the settlement button points at clubculation.com/pokerten',
  html.includes("window.open('https://clubculation.com/pokerten'"));
{
  const rules = fs.readFileSync(ROOT + '/firestore.rules', 'utf8');
  ['gameLog', 'memberships', 'clubs'].forEach(col => {
    const line = rules.split('\n').find(l => l.includes('match /' + col + '/'));
    check(`${col} is readable by a signed-in account`,
      !!line && /allow read[^;]*if signedIn\(\)/.test(line), line || 'no rule found');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
