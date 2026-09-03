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
      oracleTag: !!o && /Training table/.test(up(o).textContent) && !/see/.test(up(o).textContent),
      strongTag: !!s && /Training/.test(up(s).textContent)};
  });
  check('both tables are listed in the lobby', lobby.both);
  check('the training table is tagged "Training table" in the lobby, mechanism not spelled out there', lobby.oracleTag);
  check('the default table carries NO such tag', !lobby.strongTag);

  // open the training table
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /ORACLETBL/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  const dlg = await pg.evaluate(() => { const d = [...document.querySelectorAll('div')].filter(x => /Table buy-in/.test(x.textContent) && x.textContent.length < 900).pop(); return d ? d.innerText : ''; });
  await pg.screenshot({path: SP + '/botmode-buyin.png'});
  check('the seat dialog carries the label "TRAINING TABLE"', /TRAINING TABLE/.test(dlg), dlg.slice(0, 120));
  check('  first time: the one line — NOTHING HERE IS A REAL GAME', /NOTHING HERE IS A REAL GAME/.test(dlg));
  check('  the word "bot" appears nowhere in the dialog', !/\bbots?\b/i.test(dlg), dlg);
  check('  no seat button until he has read it', !/Take a seat/.test(dlg));
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Got it/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(800);
  const dlg2 = await pg.evaluate(() => { const d = [...document.querySelectorAll('div')].filter(x => /Table buy-in/.test(x.textContent) && x.textContent.length < 900).pop(); return d ? d.innerText : ''; });
  await pg.screenshot({path: SP + '/botmode-buyin-2.png'});
  check('  after "Got it": the line is gone, the label stays, the seat button is back', !/NOTHING HERE/.test(dlg2) && /TRAINING TABLE/.test(dlg2) && /Take a seat/.test(dlg2), dlg2.slice(0, 200));
  const acked = await pg.evaluate(() => !!((window.__stubStore.users || {}).owner1 || {}).trainingAck);
  check('  ...and it is remembered on the account, so he is never told twice', acked);
  check('  the dialog says practice chips, wallet not touched — never "Balance"', /wallet is not touched/.test(dlg2) && !/Balance:/.test(dlg2));

  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Spectate the table/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1200);
  await pg.screenshot({path: SP + '/botmode-table.png'});
  const hdr = await pg.evaluate(() => document.body.innerText);
  check('the table header says "Training table"', /Training table/.test(hdr));
  // and a hand actually runs there (the brain does not choke on the mode)
  let played = false;
  for (let i = 0; i < 20; i++) {
    await pg.waitForTimeout(3000);
    const n = await pg.evaluate(() => ((window.__stubStore.tables || {}).toracle || {}).history || []).then(h => h.length);
    if (n > 0) { played = true; break; }
  }
  check('a hand completes on the training table', played);

  // NOT A REAL GAME, in the ledger too: sit, play, stand up — the wallet never moves
  const walletOf = () => { const M = window.__stubStore.memberships || {}; const k = Object.keys(M).find(x => (M[x].uid === 'owner1') || /owner1/.test(x)); return k ? Number(M[k].balance) : null; };
  const w0 = await pg.evaluate(walletOf);
  // as a spectator the bottom "Take a seat" opens the dialog; the dialog's own button seats him
  for (let k = 0; k < 2; k++) {
    await pg.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter(y => /Take a seat/.test(y.textContent)); const x = bs[bs.length - 1]; if (x) x.click(); });
    await pg.waitForTimeout(1500);
  }
  await pg.waitForTimeout(1500);
  const seated = await pg.evaluate(() => { const p = (((window.__stubStore.tables || {}).toracle || {}).players || {}).owner1; return p ? {stack: p.stack, buyTotal: p.buyTotal} : null; });
  const w1 = await pg.evaluate(walletOf);
  check('sitting at a training table seats him with practice chips', !!seated && seated.stack === 40, JSON.stringify(seated));
  check('  ...and the wallet did not move', w0 !== null && w1 === w0, `${w0} -> ${w1}`);
  await pg.waitForTimeout(9000);   // let a hand or two run with him in it
  await pg.evaluate(() => { const m = document.querySelector('[title="Table menu"]'); if (m) m.click(); });
  await pg.waitForTimeout(700);
  await pg.evaluate(() => { const x = document.querySelector('[title="Stand up"]'); if (x) x.click(); });
  await pg.waitForTimeout(3500);
  const after = await pg.evaluate(() => {
    const T = ((window.__stubStore.tables || {}).toracle || {});
    const G = window.__stubStore.gameLog || {};
    return {seated: !!((T.players || {}).owner1), left: !!((T.leftStacks || {}).owner1),
      logs: Object.values(G).filter(g => g.uid === 'owner1').length};
  });
  const w2 = await pg.evaluate(walletOf);
  check('standing up leaves the training table', !after.seated, JSON.stringify(after));
  check('  the wallet still did not move', w2 === w0, `${w0} -> ${w2}`);
  check('  nothing written to the game log for him', after.logs === 0, `${after.logs} entries`);
  check('  no re-entry floor remembered', !after.left);
  // control: the SAME sit on a normal table costs the buy-in
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1800);
  await pg.evaluate(async () => {
    const seat = (uid, name, ix) => ({uid, name, seatIndex: ix, stack: 100, bet: 0, buyTotal: 100, status: 'active', cards: [], hasActed: false, actionText: '', isBot: true});
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'tctrl'), {type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'CTRLTBL', maxPlayers: 6, blinds: 0.5, actionTime: 30, minBuyIn: 40, maxBuyIn: 200, serverEngine: false, rakePercent: 5, autoStart: 2},
      players: {b1: seat('b1', 'Bot One', 0), b2: seat('b2', 'Bot Two', 1)}, gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 1, dealerUid: 'b1', currentGameType: 'NLH', activeTurnUid: null, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []});
  });
  await pg.waitForTimeout(1500);
  const c0 = await pg.evaluate(walletOf);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /CTRLTBL/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Take a seat/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(2500);
  const c1 = await pg.evaluate(walletOf);
  check('control: the same seat at a normal table costs the buy-in', c0 !== null && c1 === c0 - 40, `${c0} -> ${c1}`);

  // back to the lobby, open the default table: no label
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1800);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /STRONGTBL/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  const hdr2 = await pg.evaluate(() => document.body.innerText);
  check('the default table shows no training label and no notice', !/Training/.test(hdr2) && !/cards visible/.test(hdr2));

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
  check('  the form never says "bot" either', !(form.options || []).some(o => /\bbots?\b/i.test(o)) && !/\bbots?\b/i.test(form.help || ''), JSON.stringify(form.options));
  await pg.screenshot({path: SP + '/botmode-form.png', fullPage: true});

  // a CLUB OWNER — every right to open tables, none to open a training one
  await pg.evaluate(async () => {
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'users', 'clubowner1'), {
      username: 'Club Owner', email: 'clubowner1@test.local', role: 'club_owner', status: 'approved',
      playerId: '777777', balance: 5000, clubProfits: 0, isBot: false, isGuest: false, managedGames: ['poker']});
    await window.fbStubAs('clubowner1', 'clubowner1@test.local');
  });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1500);
  await pg.screenshot({path: SP + '/botmode-clubowner.png', fullPage: true});
  // the form stays open across the account switch; if it did not, open it
  const asOwner = await pg.evaluate(() => {
    if (/New poker table/.test(document.body.innerText)) return {formOpen: true};
    const nt = [...document.querySelectorAll('button')].find(y => /New table/.test(y.textContent));
    if (!nt) return {formOpen: false, text: document.body.innerText.slice(0, 200)};
    nt.click();
    return {formOpen: true};
  });
  await pg.waitForTimeout(1500);
  const form2 = await pg.evaluate(() => ({
    formOpen: /New poker table/.test(document.body.innerText),
    botField: [...document.querySelectorAll('select')].some(s => [...s.options].some(o => /plays from what everyone sees/.test(o.textContent)))
  }));
  check('a club owner sees the create-table form', asOwner.formOpen && form2.formOpen, JSON.stringify({asOwner, form2}));
  check('  ...but sees NO Bot mode field — training tables are the site owner\'s alone', !form2.botField);
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
