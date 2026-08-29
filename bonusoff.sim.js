// The bonus games are off in the build. This is the case that actually
// happened: the club doc still carries bonusWheel.enabled === true from when
// they were live, and the gift button kept appearing in the lobby wallet row
// because the only gate was that setting.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
const PORT = Number(process.env.PT_PORT) || 8079;   // PT_PORT=8077 runs it against the previous build

let pass = 0; let fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '  → ' + extra : '')); } };

(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  await pg.goto(`http://localhost:${PORT}/index.html?as=owner1&x=` + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(2500);

  // the club as it really is in production right now
  await pg.evaluate(() => {
    window.__stubStore.clubs.main.bonusWheel = {enabled: true, prizes: [5, 10, 20, 30, 50, 75, 100, 200]};
  });
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(3000);

  const inLobby = await pg.evaluate(() => /New table/i.test(document.body.innerText));
  check('the lobby is showing', inLobby, (await pg.evaluate(() => document.body.innerText.slice(0, 80))).replace(/\n/g, ' | '));
  check('the club really does still have the wheel switched ON',
    await pg.evaluate(() => window.__stubStore.clubs.main.bonusWheel.enabled === true));

  const gift = await pg.evaluate(() => [...document.querySelectorAll('button')]
    .filter(x => /🎁|🎰|🎫/.test(x.textContent) || /Bonus/i.test(x.getAttribute('aria-label') || ''))
    .map(x => (x.getAttribute('aria-label') || x.textContent || '').trim().slice(0, 24)));
  check('no bonus button is rendered anywhere in the lobby', gift.length === 0, JSON.stringify(gift));

  // and the row it used to sit in must not leave a gap
  const row = await pg.evaluate(() => {
    const el = document.querySelector('.lobby-bonus-mini');
    return el ? {kids: el.children.length, w: Math.round(el.getBoundingClientRect().width)} : null;
  });
  check('the bonus slot in the wallet row is empty', !row || row.kids === 0, JSON.stringify(row));

  const wide = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('the wallet row no longer overflows the screen edge', wide,
    await pg.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));

  await pg.screenshot({path: SP + '/bonusoff.png'});
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
