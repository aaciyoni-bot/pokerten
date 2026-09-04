// A REAL showdown (two hands turned over, the pot awarded, the next hand
// dealt) on the client engine, in a real browser. Bots sit with stacks so
// short that they are all-in within a hand, so the showdown path — not the
// everybody-folded path — is the one that runs.
//
// This exists because a ReferenceError inside that path went unnoticed for
// six days: the hand-record write referenced a variable that did not exist,
// the exception fired before the showdown state was saved, and every
// client-engine table froze at the river. The fold-out path had a test; the
// showdown path did not. Now it does.
const {chromium} = require('playwright');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); ok ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  const errs = [];
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) errs.push(s.slice(0, 160)); });
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1800);
  await pg.evaluate(async () => {
    const seat = (uid, name, ix, stack) => ({uid, name, seatIndex: ix, stack, bet: 0, buyTotal: stack,
      status: 'active', cards: [], hasActed: false, actionText: '', isBot: true});
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'sd'), {
      type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'SHOWDOWN', maxPlayers: 6, blinds: 1, actionTime: 30,
        minBuyIn: 40, maxBuyIn: 200, serverEngine: false, rakePercent: 5, autoStart: 2},
      // two chips each at 1/2: the big blind is all-in posting, and the brain's
      // crumbs rule (a blind or less behind never folds preflop) puts the other
      // two all-in behind it — a three-way showdown on the very first hand
      players: {b1: seat('b1', 'Bot One', 0, 2), b2: seat('b2', 'Bot Two', 1, 2), b3: seat('b3', 'Bot Three', 2, 2)},
      gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 2,
        dealerUid: 'b1', currentGameType: 'NLH', activeTurnUid: null, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []
    });
  });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /SHOWDOWN/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Spectate the table/.test(y.textContent)); if (x) x.click(); });

  // wait for a hand whose history row shows at least two hands turned over
  let sd = null;
  for (let i = 0; i < 40; i++) {
    await pg.waitForTimeout(3000);
    sd = await pg.evaluate(() => {
      const T = ((window.__stubStore.tables || {}).sd || {});
      const rows = (T.history || []).filter(h => (h.ps || []).filter(p => p.c && p.c.length).length >= 2);
      const H = window.__stubStore.hands || {};
      const rec = rows.length ? H[rows[rows.length - 1].code] : null;
      return {rows: rows.length, hist: (T.history || []).length, phase: (T.gameState || {}).phase,
        rec: rec ? {pot: rec.pot, board: (rec.board || []).length, acts: (rec.acts || []).length, players: (rec.ps || []).length, winners: (rec.ps || []).filter(p => p.w).length} : null,
        stacks: Object.values(T.players || {}).map(p => p.stack)};
    });
    if (sd.rows > 0) break;
  }
  check('a hand reached a real showdown (two hands turned over)', sd && sd.rows > 0, JSON.stringify(sd));
  check('  the showdown was SAVED: it is in the table history', sd && sd.hist > 0, JSON.stringify(sd));
  check('  the hand record for it was written, with the pot', !!(sd && sd.rec) && sd.rec.pot > 0, JSON.stringify(sd && sd.rec));
  check('  five board cards, every player, a winner, the actions', !!(sd && sd.rec) && sd.rec.board === 5 && sd.rec.players >= 2 && sd.rec.winners >= 1 && sd.rec.acts > 0, JSON.stringify(sd && sd.rec));
  // and the table is NOT stuck: the next hand gets dealt
  await pg.waitForTimeout(9000);
  const later = await pg.evaluate(() => { const T = ((window.__stubStore.tables || {}).sd || {}); return {hist: (T.history || []).length, phase: (T.gameState || {}).phase}; });
  check('the table is not stuck at the river', later.hist > 0 && later.phase !== 'river', JSON.stringify(later));
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
