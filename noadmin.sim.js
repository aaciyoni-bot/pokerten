// The stuck table, reproduced and fixed: an ordinary player sits at a
// client-engine table with bots while the super admin is NOT there.
//
// Before: bots acted only from the super admin's browser, so with him away
// every bot turn waited for the 52-second watchdog and a hand took minutes —
// "the game is stuck". Now the first seated human who is online drives the
// bots too, and a hand completes in well under a minute.
const {chromium} = require('playwright');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); ok ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  const errs = [];
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) errs.push(s.slice(0, 160)); });
  // sign in as an approved ORDINARY player — not the owner, not a manager
  await pg.goto('http://localhost:8079/index.html?as=none&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(1500);
  await pg.evaluate(async () => {
    const S = window.__stubStore;
    S.users = S.users || {}; S.memberships = S.memberships || {}; S.clubs = S.clubs || {};
    S.clubs.main = S.clubs.main || {name: 'PokerTen Club', ownerUid: 'owner1', code: '743801', rakePct: 5};
    S.users.p1 = {username: 'Roni', email: 'roni@test.local', role: 'player', status: 'approved', playerId: '111111', balance: 500, clubProfits: 0, isBot: false, isGuest: false};
    S.memberships.p1_main = {uid: 'p1', clubId: 'main', username: 'Roni', playerId: '111111', role: 'player', status: 'approved', balance: 500, clubProfits: 0, isBot: false};
    const seat = (uid, nm, ix, st) => ({uid, name: nm, seatIndex: ix, stack: st, bet: 0, buyTotal: st, status: 'active', cards: [], hasActed: false, actionText: '', isBot: true});
    S.tables = S.tables || {};
    S.tables.na = {type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'NOADMIN', maxPlayers: 6, blinds: 1, actionTime: 30, minBuyIn: 80, maxBuyIn: 400, serverEngine: false, rakePercent: 5, autoStart: 2},
      players: {b0: seat('b0', 'Dani', 1, 150), b1: seat('b1', 'Yossi', 3, 150), b2: seat('b2', 'Moshe', 4, 150)},
      gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 2, dealerUid: 'b0', currentGameType: 'NLH', activeTurnUid: null, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []};
    await window.fbStubAs('p1', 'roni@test.local');
  });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1800);
  const who = await pg.evaluate(() => document.body.innerText.includes('NOADMIN'));
  check('an ordinary player sees the table in the lobby', who);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /NOADMIN/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter(y => /Take a seat/.test(y.textContent)); const x = bs[bs.length - 1]; if (x) x.click(); });
  await pg.waitForTimeout(2000);
  const seated = await pg.evaluate(() => !!(((window.__stubStore.tables || {}).na || {}).players || {}).p1);
  check('he takes a seat (no admin anywhere)', seated);
  // the hand must move: bots act, streets advance, a hand completes — and the
  // player, when it is his turn, folds so the bots carry the hand
  const t0 = Date.now();
  let hist = 0, botActs = 0, lastPhase = '';
  const phases = new Set();
  while (Date.now() - t0 < 75000) {
    await pg.waitForTimeout(500);
    const st = await pg.evaluate(() => {
      const T = (window.__stubStore.tables || {}).na || {};
      const g = T.gameState || {};
      const fold = [...document.querySelectorAll('button')].find(b => /^\s*fold/i.test(b.textContent));
      if (fold) fold.click();
      return {hist: (T.history || []).length, phase: g.phase, acts: (g.acts || []).filter(a => /^b/.test(a.u)).length};
    });
    hist = st.hist; phases.add(st.phase); botActs = Math.max(botActs, st.acts); lastPhase = st.phase;
    if (hist >= 1) break;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  check(`bots act without the admin (${botActs} bot actions seen)`, botActs >= 2, JSON.stringify([...phases]));
  check(`a full hand completes within 75s without the admin (took ${secs}s)`, hist >= 1, `phases seen: ${[...phases].join(',')} · last: ${lastPhase}`);
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
