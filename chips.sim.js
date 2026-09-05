// Chips are denominated in small blinds: at a 0.5/1 table a bet of 26 is
// two greens and two greys, not twenty-six greys. Checked in a real browser
// against the rendered chip classes.
const {chromium} = require('playwright');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); ok ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  const errs = [];
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) errs.push(s.slice(0, 160)); });
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2200);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1500);
  // a hand frozen mid-flop with three bets on the felt; no bots so nothing moves
  await pg.evaluate(async () => {
    const seat = (uid, name, ix, stack, bet) => ({uid, name, seatIndex: ix, stack, bet, buyTotal: 200, status: 'active', cards: [{val: 'A', suit: '♠', id: 'A♠'}, {val: 'K', suit: '♠', id: 'K♠'}], hasActed: true, actionText: 'Raise', isBot: false});
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'ch'), {type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'CHIPS', maxPlayers: 6, blinds: 0.5, actionTime: 300, minBuyIn: 40, maxBuyIn: 200, serverEngine: false, rakePercent: 0, autoStart: 2},
      players: {h1: seat('h1', 'Two', 0, 100, 2), h2: seat('h2', 'Six', 1, 100, 6), h3: seat('h3', 'TwentySix', 2, 100, 26)},
      gameState: {phase: 'flop', deck: [], board: [{val: '7', suit: '♦', id: '7♦'}, {val: '8', suit: '♣', id: '8♣'}, {val: '2', suit: '♥', id: '2♥'}], pots: [{amount: 12, eligible: ['h1', 'h2', 'h3']}], highestBet: 26, minRaise: 1,
        dealerUid: 'h1', currentGameType: 'NLH', activeTurnUid: 'h1', turnStartedAt: Date.now(), __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []});
  });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /CHIPS/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Spectate the table/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1500);
  await pg.screenshot({path: '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad/tour/41-chips.png'});
  const stacks = await pg.evaluate(() => {
    // every bet-fly wrapper holds one CasinoChipStack; read its chips and its label
    return [...document.querySelectorAll('.bet-fly')].map(w => ({
      label: (w.querySelector('.text-\\[12px\\]') || {}).textContent || '',
      chips: [...w.querySelectorAll('.casino-chip')].map(c => [...c.classList].find(k => /^chip-/.test(k))),
      labelSize: w.querySelector('.text-\\[12px\\]') ? getComputedStyle(w.querySelector('.text-\\[12px\\]')).fontSize : null
    }));
  });
  const byLabel = Object.fromEntries(stacks.map(s => [s.label, s]));
  const count = (s, cls) => (s ? s.chips.filter(c => c === cls).length : -1);
  check('three bet stacks on the felt', stacks.length === 3, JSON.stringify(stacks));
  check('a bet of 2 at 0.5/1 = 4 small blinds = four grey chips', count(byLabel['2'], 'chip-1') === 4, JSON.stringify(byLabel['2']));
  check('a bet of 6 = 12 SB = two reds + two greys', count(byLabel['6'], 'chip-5') === 2 && count(byLabel['6'], 'chip-1') === 2, JSON.stringify(byLabel['6']));
  check('a bet of 26 = 52 SB = two greens + two greys (not 26 of anything)', count(byLabel['26'], 'chip-25') === 2 && count(byLabel['26'], 'chip-1') === 2, JSON.stringify(byLabel['26']));
  check('the amount label is 12px', stacks.every(s => s.labelSize === '12px'), JSON.stringify(stacks.map(s => s.labelSize)));
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
