// "Every time I close a Spin & Cash table, a new one appears."
// Reproduce it: three Spin tables of the same config, two of them already
// armed (so nothing is joinable once the third goes), then delete them one by
// one and count what the lobby holds afterwards.
//
// RK_URL=http://localhost:8078/index.html to point at another build.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
const URL = process.env.RK_URL || 'http://localhost:8079/index.html';

(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) console.log('  PAGEERROR:', s.slice(0, 150)); });
  await pg.goto(URL + '?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(2500);

  const owner = await pg.evaluate(() => ({ club: (window.__club || {}).ownerUid, me: (window.__stubUser || {}).uid || 'marcelos' }));
  console.log('club owner:', JSON.stringify(owner));

  // three Spin & Cash tables, identical config; two already armed
  await pg.evaluate(async () => {
    const S = { baseGameType: 'NLH', spinMode: true, spinBuyIn: 50, spinStack: 1000, maxPlayers: 3,
      blinds: 10, minBuyIn: 50, maxBuyIn: 50, serverEngine: true, rakePercent: 0, actionTime: 20 };
    for (let i = 0; i < 3; i++) {
      await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'spin' + i), {
        type: 'poker', clubId: 'main', createdAt: Date.now() + i, settings: {...S},
        players: i < 2 ? {a: {uid: 'a', name: 'A', seatIndex: 0, stack: 1000, bet: 0, status: 'active', isBot: true},
          b: {uid: 'b', name: 'B', seatIndex: 1, stack: 1000, bet: 0, status: 'active', isBot: true},
          c: {uid: 'c', name: 'C', seatIndex: 2, stack: 1000, bet: 0, status: 'active', isBot: true}} : {},
        ...(i < 2 ? {spin: {mult: 2, prize: 100}, spinStartAt: Date.now()} : {}),
        chat: [], leftStacks: {}, tournamentId: null, history: [],
        gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 20,
          dealerUid: null, currentGameType: 'NLH', activeTurnUid: null, __seq: 1}
      });
    }
  });
  await pg.waitForTimeout(2500);
  const count = () => pg.evaluate(() => Object.values(window.__stubStore.tables)
    .filter(t => (t.settings || {}).spinMode && (t.clubId || 'main') === 'main').length);
  console.log('spin tables after setup:', await count());

  // the owner closes them, one at a time, exactly as the trash button does
  for (const id of ['spin2', 'spin0', 'spin1']) {
    await pg.evaluate(async (docId) => {
      await window.fb.deleteDoc(window.fb.doc(window.fb.db, 'tables', docId));
    }, id);
    await pg.waitForTimeout(10000);         // outlast the 8s debounce so a respawn has every chance to fire
    console.log(`  after closing ${id}: ${await count()} spin table(s) left`);
  }
  await pg.waitForTimeout(9000);            // outlast the debounce entirely
  const left = await count();
  const closedOk = left === 0;
  console.log(`\nCLOSING: ${left} spin table(s) left  ->  ${closedOk ? 'PASS — closed stays closed' : 'FAIL — the lobby recreated ' + left}`);

  // ...and the behaviour that MUST survive: when the last open table FILLS UP,
  // a fresh one has to appear, or players arriving find nowhere to sit.
  await pg.evaluate(async () => {
    const S = { baseGameType: 'NLH', spinMode: true, spinBuyIn: 50, spinStack: 1000, maxPlayers: 3,
      blinds: 10, minBuyIn: 50, maxBuyIn: 50, serverEngine: true, rakePercent: 0, actionTime: 20 };
    for (let i = 0; i < 2; i++) {
      await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'fill' + i), {
        type: 'poker', clubId: 'main', createdAt: Date.now() + i, settings: {...S},
        players: i === 0 ? {a: {uid: 'a', name: 'A', seatIndex: 0, stack: 1000, bet: 0, status: 'active', isBot: true},
          b: {uid: 'b', name: 'B', seatIndex: 1, stack: 1000, bet: 0, status: 'active', isBot: true},
          c: {uid: 'c', name: 'C', seatIndex: 2, stack: 1000, bet: 0, status: 'active', isBot: true}} : {},
        ...(i === 0 ? {spin: {mult: 2, prize: 100}, spinStartAt: Date.now()} : {}),
        chat: [], leftStacks: {}, tournamentId: null, history: [],
        gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 20,
          dealerUid: null, currentGameType: 'NLH', activeTurnUid: null, __seq: 1}
      });
    }
  });
  await pg.waitForTimeout(3000);
  const before = await count();
  // fill1 (the only open one) fills up — nothing was deleted
  await pg.evaluate(async () => {
    await window.fb.updateDoc(window.fb.doc(window.fb.db, 'tables', 'fill1'), {
      players: {x: {uid: 'x', name: 'X', seatIndex: 0, stack: 1000, bet: 0, status: 'active', isBot: true},
        y: {uid: 'y', name: 'Y', seatIndex: 1, stack: 1000, bet: 0, status: 'active', isBot: true},
        z: {uid: 'z', name: 'Z', seatIndex: 2, stack: 1000, bet: 0, status: 'active', isBot: true}}
    });
  });
  await pg.waitForTimeout(11000);
  const after = await count();
  const stockOk = after > before;
  console.log(`FILLING: ${before} -> ${after} spin table(s)  ->  ${stockOk ? 'PASS — a fresh table opened' : 'FAIL — nowhere left to sit'}`);
  await b.close();
  process.exit(closedOk && stockOk ? 0 : 1);
})();
