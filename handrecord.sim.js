// Does a finished hand actually leave a record behind, with a code and the
// actions in it? Play a real table in the browser and read hands/.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) console.log('  PAGEERROR:', s.slice(0, 150)); });
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(2200);
  await pg.evaluate(async () => {
    const seat = (uid, name, ix) => ({uid, name, seatIndex: ix, stack: 100, bet: 0, buyTotal: 100,
      status: 'active', cards: [], hasActed: false, actionText: '', isBot: true});
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'rec'), {
      type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'REC', maxPlayers: 6, blinds: 0.5, actionTime: 30,
        minBuyIn: 40, maxBuyIn: 200, serverEngine: false, rakePercent: 5, autoStart: 2},
      players: {b1: seat('b1','Bot One',0), b2: seat('b2','Bot Two',1), b3: seat('b3','Bot Three',2), b4: seat('b4','Bot Four',3), b5: seat('b5','Bot Five',4), b6: seat('b6','Bot Six',5)},
      gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 1,
        dealerUid: 'b1', currentGameType: 'NLH', activeTurnUid: null, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []
    });
  });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /REC/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  for (let i = 0; i < 45; i++) {
    await pg.waitForTimeout(3000);
    const n = await pg.evaluate(() => Object.values(window.__stubStore.hands || {}).filter(r => (r.board || []).length === 5).length);
    if (n > 0) break;
  }
  const out = await pg.evaluate(() => {
    const H = window.__stubStore.hands || {};
    const k = Object.keys(H).find(x => ((H[x].board || []).length === 5)) || Object.keys(H)[0];
    if (!k) return {n: 0};
    const r = H[k];
    return {n: Object.keys(H).length, code: r.code, sameAsKey: r.code === k, acts: (r.acts || []).length,
      streets: [...new Set((r.acts || []).map(a => a.s))], players: (r.ps || []).length,
      hasCards: (r.ps || []).every(p => (p.c || []).length > 0), board: (r.board || []).length,
      sample: (r.acts || []).map(a => `${a.n} ${a.s} ${a.a} ${a.m}`), winners: (r.ps||[]).filter(p=>p.w).map(p=>p.n), pot: r.pot, total: Object.keys(H).length};
  });
  console.log(JSON.stringify(out, null, 1));
  const ok = out.n > 0 && out.sameAsKey && out.acts > 0 && out.players >= 2 && out.hasCards && out.board === 5 && (out.winners||[]).length > 0;
  console.log(ok ? '\nPASS — hands are recorded with a code, the cards and every action'
    : '\nFAIL — the record is missing or incomplete');
  await b.close();
  process.exit(ok ? 0 : 1);
})();
