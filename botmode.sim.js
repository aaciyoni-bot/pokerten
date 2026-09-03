// Bot mode, in a real browser: the manager picks it when opening a table,
// "strong" is the default, and a training table says out loud — in the lobby
// and on the table — that the bots see the cards.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
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

  // two tables, identical except for the mode
  await pg.evaluate(async () => {
    const seat = (uid, name, ix) => ({uid, name, seatIndex: ix, stack: 100, bet: 0, buyTotal: 100,
      status: 'active', cards: [], hasActed: false, actionText: '', isBot: true});
    const mk = (id, name, extra) => window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', id), {
      type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: name, maxPlayers: 6, blinds: 0.5, actionTime: 30,
        minBuyIn: 40, maxBuyIn: 200, serverEngine: false, rakePercent: 5, autoStart: 2, ...extra},
      players: {b1: seat('b1', 'Bot One', 0), b2: seat('b2', 'Bot Two', 1), b3: seat('b3', 'Bot Three', 2)},
      gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 1,
        dealerUid: 'b1', currentGameType: 'NLH', activeTurnUid: null, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []
    });
    await mk('tstrong', 'STRONGTBL', {});
    await mk('toracle', 'ORACLETBL', {botMode: 'oracle'});
  });
  await pg.waitForTimeout(1500);
  await pg.screenshot({path: SP + '/botmode-lobby.png', fullPage: true});
  const lobby = await pg.evaluate(() => {
    const body = document.body.innerText;
    const cardOf = name => { const els = [...document.querySelectorAll('div')].filter(x => x.textContent.includes(name)); return els[els.length - 1]; };
    const o = cardOf('ORACLETBL'); const s = cardOf('STRONGTBL');
    // walk up to the table card (the element that also carries the stakes line)
    const up = el => { let e = el; for (let i = 0; i < 8 && e; i++) { if (/0\.5\s*\/\s*1/.test(e.textContent) && e.textContent.length < 400) return e; e = e.parentElement; } return el; };
    return {both: body.includes('ORACLETBL') && body.includes('STRONGTBL'),
      oracleTag: !!o && /Training .* the bots see the cards/.test(up(o).textContent),
      strongTag: !!s && /bots see the cards/.test(up(s).textContent)};
  });
  check('both tables are listed in the lobby', lobby.both);
  check('the training table says "the bots see the cards" in the lobby', lobby.oracleTag);
  check('the default table carries NO such tag', !lobby.strongTag);

  // open the training table
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /ORACLETBL/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Spectate the table/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1200);
  await pg.screenshot({path: SP + '/botmode-table.png'});
  const hdr = await pg.evaluate(() => document.body.innerText);
  check('the table header says "Training mode · the bots see the cards"', /Training mode/.test(hdr) && /bots see the cards/.test(hdr));
  // and a hand actually runs there (the brain does not choke on the mode)
  let played = false;
  for (let i = 0; i < 20; i++) {
    await pg.waitForTimeout(3000);
    const n = await pg.evaluate(() => ((window.__stubStore.tables || {}).toracle || {}).history || []).then(h => h.length);
    if (n > 0) { played = true; break; }
  }
  check('a hand completes on the training table', played);

  // back to the lobby, open the default table: no label
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1800);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /STRONGTBL/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  const hdr2 = await pg.evaluate(() => document.body.innerText);
  check('the default table shows no training label', !/Training mode/.test(hdr2));

  // the create-table form: the field exists, "strong" is selected by default
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1800);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /New table/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1500);
  const form = await pg.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /plays from what everyone sees/.test(o.textContent)));
    if (!sel) return {found: false};
    return {found: true, value: sel.value, options: [...sel.options].map(o => o.textContent),
      help: (sel.parentElement.textContent || '')};
  });
  check('the create-table form has a Bot mode field', form.found);
  check('  "strong" is the default', form.value === 'strong', form.value);
  check('  the training option says the table will be labeled', (form.options || []).some(o => /labeled on the table/.test(o)), JSON.stringify(form.options));
  await pg.screenshot({path: SP + '/botmode-form.png', fullPage: true});
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
