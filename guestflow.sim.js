// Guest login, end to end in a real browser: type a name and a number, press
// continue, and check what actually landed in the users collection and what
// the club owner will see in his approval list.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
const NAME = 'יוני אורח';
const NUM = '0521234567';

let pass = 0; let fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '  → ' + extra : '')); } };

(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  const errs = [];
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) errs.push(s.slice(0, 160)); });
  await pg.goto('http://localhost:8079/index.html?as=none&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(3200);

  const onAuth = await pg.evaluate(() => /Sign in with Google/.test(document.body.innerText));
  check('the login screen is showing', onAuth);

  const hasGuest = await pg.evaluate(() => /כניסה כאורח/.test(document.body.innerText) && /או/.test(document.body.innerText));
  check('the guest button and the "או" separator are on it', hasGuest);
  await pg.screenshot({path: SP + '/guest-1.png'});

  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /כניסה כאורח/.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(700);
  const fields = await pg.evaluate(() => [...document.querySelectorAll('input')].map(i => ({ph: i.placeholder, max: i.maxLength, im: i.inputMode})));
  check('two fields appear: name (maxLength 20) and number (numeric)',
    fields.some(f => /שם/.test(f.ph) && f.max === 20) && fields.some(f => /מספר/.test(f.ph) && f.im === 'numeric'),
    JSON.stringify(fields));
  const note = await pg.evaluate(() => /לא ניתן לשנות/.test(document.body.innerText));
  check('the "the number cannot be changed later" note is shown', note);
  await pg.screenshot({path: SP + '/guest-2.png'});

  // validation: a one-letter name must be refused
  const type = async (ph, v) => pg.evaluate(([p, val]) => {
    const el = [...document.querySelectorAll('input')].find(i => new RegExp(p).test(i.placeholder));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }, [ph, v]);
  const submit = () => pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /המשך כאורח/.test(y.textContent)); if (x) x.click(); });

  await type('שם', 'א'); await type('מספר', '12'); await submit();
  await pg.waitForTimeout(600);
  const shortName = await pg.evaluate(() => /לפחות 2 תווים/.test(document.body.innerText));
  check('a 1-character name is refused', shortName);

  await type('שם', NAME); await submit();
  await pg.waitForTimeout(600);
  const shortNum = await pg.evaluate(() => /לפחות 3 ספרות/.test(document.body.innerText));
  check('a 2-digit number is refused', shortNum);

  // letters must never survive in the number field
  await type('מספר', '05a2b1c234567');
  const numVal = await pg.evaluate(() => ([...document.querySelectorAll('input')].find(i => /מספר/.test(i.placeholder)) || {}).value);
  check('the number field keeps digits only', numVal === '0521234567', JSON.stringify(numVal));

  await submit();
  await pg.waitForTimeout(3500);

  const out = await pg.evaluate(() => {
    const S = window.__stubStore;
    const guest = Object.entries(S.users).filter(([k]) => k.startsWith('anon_')).map(([k, v]) => ({uid: k, ...v}))[0] || null;
    return {guest, leftAuth: !/Sign in with Google/.test(document.body.innerText),
      screen: document.body.innerText.slice(0, 90).replace(/\n/g, ' | '),
      leakedName: window.__guestName, leakedNum: window.__guestNumber};
  });
  check('the guest is signed in and off the login screen', out.leftAuth, out.screen);
  check('a users doc was created', !!out.guest, JSON.stringify(out.guest));
  if (out.guest) {
    check('  username is the name he typed', out.guest.username === NAME, out.guest.username);
    check('  playerId is the NUMBER he typed', out.guest.playerId === NUM, String(out.guest.playerId));
    check('  isGuest is true', out.guest.isGuest === true, String(out.guest.isGuest));
    check('  he lands as a pending player, 0 balance, not a bot',
      out.guest.status === 'pending' && out.guest.role === 'player' && out.guest.balance === 0 && out.guest.isBot === false,
      JSON.stringify({s: out.guest.status, r: out.guest.role, b: out.guest.balance, bot: out.guest.isBot}));
  }
  check('the temporary globals were cleared', !out.leakedName && !out.leakedNum,
    JSON.stringify({n: out.leakedName, m: out.leakedNum}));
  check('no page errors', errs.length === 0, errs.join(' ; '));
  await pg.screenshot({path: SP + '/guest-3.png'});

  // ...and the half that actually matters to the owner: can he tell who this
  // is? A guest has no email, so the row he approves from must carry the
  // number, or the whole feature is a name and a blank line.
  const uid = out.guest && out.guest.uid;
  if (uid) {
    const pg2 = await b.newPage({viewport: {width: 430, height: 932}});
    pg2.on('pageerror', e => { const s2 = String(e); if (!/__col/.test(s2)) console.log('  OWNER PAGEERROR: ' + s2.slice(0, 140)); });
    await pg2.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
    await pg2.waitForTimeout(3000);
    await pg2.evaluate(([u, n, num]) => {
      const S = window.__stubStore;
      S.users[u] = {username: n, email: '', playerId: num, isGuest: true, isBot: false, role: 'player', status: 'pending', balance: 0};
      S.memberships[u + '_main'] = {uid: u, clubId: 'main', username: n, email: '', playerId: num,
        isGuest: true, isBot: false, role: 'player', status: 'pending', balance: 0, createdAt: Date.now()};
    }, [uid, NAME, NUM]);
    await pg2.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
    await pg2.waitForTimeout(2200);
    await pg2.evaluate(() => { const x = [...document.querySelectorAll('button,a')].find(y => /^Manage$/i.test((y.textContent || '').trim())); if (x) x.click(); });
    await pg2.waitForTimeout(2800);
    const seen = await pg2.evaluate(([n, num]) => {
      const t = document.body.innerText;
      return {name: t.includes(n), num: t.includes(num), approve: /Approve/.test(t)};
    }, [NAME, NUM]);
    check('the owner sees the guest NAME in his approval queue', seen.name);
    check('the owner sees the guest NUMBER on the same row', seen.num);
    check('there is an Approve button for him', seen.approve);
    await pg2.screenshot({path: SP + '/guest-owner.png', fullPage: true});
    await pg2.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
