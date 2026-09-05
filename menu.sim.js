// Pass 2, in a real browser: the table menu is a labeled sheet, the chat
// never sits on the action bar, the felt no longer carries GPS/IP text, and
// the one Hebrew button in an English app is gone.
const {chromium} = require('playwright');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + (detail || ''))); ok ? pass++ : fail++; };
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad/tour';
(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  const errs = [];
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) errs.push(s.slice(0, 160)); });
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2200);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1500);
  // cashier: English
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Cashier/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(900);
  const cashier = await pg.evaluate(() => document.body.innerText);
  check('the cashier speaks one language (Account statement / settlement)', /Account statement/.test(cashier) && !/פירוט חשבון/.test(cashier));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /^Close$/.test(y.textContent.trim())); if (x) x.click(); }); await pg.waitForTimeout(400);
  // create form: option labels that fit
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /New table/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1200);
  const opts = await pg.evaluate(() => [...document.querySelectorAll('select option')].map(o => o.textContent).filter(t => /engine/i.test(t)));
  check('engine options are short enough to fit (≤ 24 chars)', opts.length === 2 && opts.every(t => t.length <= 24), JSON.stringify(opts));
  check('  ...and the explanation moved under the field', /needs a manager watching the table/.test(await pg.evaluate(() => document.body.innerText)));
  // a table, seated, at my turn
  await pg.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2200);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1500);
  await pg.evaluate(async () => {
    const seat = (uid, nm, ix, st) => ({uid, name: nm, seatIndex: ix, stack: st, bet: 0, buyTotal: st, status: 'active', cards: [], hasActed: false, actionText: '', isBot: true});
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'mn'), {type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'MENUTBL', maxPlayers: 6, blinds: 1, actionTime: 60, minBuyIn: 80, maxBuyIn: 400, serverEngine: false, rakePercent: 5, autoStart: 2},
      players: {b0: seat('b0', 'Dani', 1, 120), b1: seat('b1', 'Yossi', 3, 260)},
      gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 2, dealerUid: 'b0', currentGameType: 'NLH', activeTurnUid: null, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []});
  });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /MENUTBL/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Spectate the table/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(1000);
  const felt = await pg.evaluate(() => document.body.innerText);
  check('the felt no longer says GPS · ON / IP · ON', !/GPS · ON/.test(felt.replace(/·/g, '·')) || false, '');
  // sit, wait for my turn, open the chat: it must clear the action bar
  await pg.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter(y => /Take a seat/.test(y.textContent)); const x = bs[bs.length - 1]; if (x) x.click(); });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter(y => /Take a seat/.test(y.textContent)); const x = bs[bs.length - 1]; if (x) x.click(); });
  let mine = false;
  for (let i = 0; i < 90 && !mine; i++) { await pg.waitForTimeout(700); mine = await pg.evaluate(() => [...document.querySelectorAll('button')].some(b => /^\s*fold/i.test(b.textContent))); }
  check('it is my turn (action bar up)', mine);
  // menu sheet
  await pg.evaluate(() => { const m = document.querySelector('[title="Table menu"]'); if (m) m.click(); });
  await pg.waitForTimeout(700);
  await pg.screenshot({path: SP + '/50-menu-sheet.png'});
  const sheet = await pg.evaluate(() => {
    const t = document.body.innerText;
    const tiles = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().height >= 60 && /My look|Sound|Sit out|Add chips|Add bot|Deal now|Unstick|Buy-in|Manage|Leave|Stand up|GOD/.test(b.textContent));
    const ys = tiles.map(b => b.getBoundingClientRect().top);
    return {labels: tiles.map(b => b.textContent.replace(/[^\x20-\x7E]/g, '').trim()), minTop: Math.min(...ys), gps: /GPS/.test(t)};
  });
  check('the menu opens as a sheet with WORDS on every tile', sheet.labels.length >= 6 && sheet.labels.every(l => l.length >= 4), JSON.stringify(sheet.labels));
  check('  the sheet rises from the bottom (tiles in the lower half)', sheet.minTop > 466, String(sheet.minTop));
  check('  GPS / IP moved into the menu', sheet.gps);
  const onTop = await pg.evaluate(() => {
    const tiles = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().height >= 60 && /My look|Sound|Sit out|Add chips|Add bot|Deal now|Unstick|Buy-in|Manage|Leave|Stand up|GOD/.test(b.textContent));
    return tiles.map(b => { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(el) || el === b; });
  });
  check('  every tile is the topmost thing at its own centre (nothing paints over the sheet)', onTop.length > 0 && onTop.every(Boolean), JSON.stringify(onTop));
  await pg.mouse.click(215, 120); await pg.waitForTimeout(500);
  const closed = await pg.evaluate(() => ![...document.querySelectorAll('button')].some(b => /My look/.test(b.textContent)));
  check('  tapping outside closes it', closed);
  await pg.evaluate(() => { const x = document.querySelector('[title="Table chat"]'); if (x) x.click(); });
  await pg.waitForTimeout(800);
  await pg.screenshot({path: SP + '/51-chat-docked.png'});
  const geo = await pg.evaluate(() => {
    const chat = [...document.querySelectorAll('div')].find(d => /^Table chat/.test(d.textContent.trim()) && d.getBoundingClientRect().height > 200);
    const fold = [...document.querySelectorAll('button')].find(b => /^\s*fold/i.test(b.textContent));
    const hs = [...document.querySelectorAll('div')].find(d => /High Card|Pair|Two Pair|Flush|Straight|Trips|Set/.test(d.textContent) && d.getBoundingClientRect().height < 40 && d.getBoundingClientRect().top > 700);
    return {chatBottom: chat && chat.getBoundingClientRect().bottom, barTop: Math.min(fold ? fold.getBoundingClientRect().top : 9e9, hs ? hs.getBoundingClientRect().top : 9e9)};
  });
  check('the chat panel sits ABOVE the action bar, not on it', geo.chatBottom != null && geo.chatBottom <= geo.barTop, JSON.stringify(geo));
  check('no page errors', errs.length === 0, errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
