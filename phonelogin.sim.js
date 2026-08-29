// Verified phone sign-in, end to end in a real browser: type a name and an
// Israeli mobile number, get the SMS step, type the code, and check what
// actually landed in the users collection — and what the club owner will see.
//
// The SMS itself is stubbed (the code is 123456); everything else is the real
// screen, the real validation and the real account-creation path.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
const NAME = 'יוני שחקן';
const TYPED = '0521234567';
const E164 = '+972521234567';

let pass = 0; let fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '  → ' + extra : '')); } };

(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}});
  const errs = [];
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) errs.push(s.slice(0, 160)); });
  await pg.goto('http://localhost:8079/index.html?as=none&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(3200);

  check('the login screen is showing', await pg.evaluate(() => /Sign in with Google/.test(document.body.innerText)));
  check('Google sign-in is still offered', await pg.evaluate(() => [...document.querySelectorAll('button')].some(x => /Sign in with Google/.test(x.textContent))));
  check('the phone button replaced the unverified guest button',
    await pg.evaluate(() => /כניסה עם מספר טלפון/.test(document.body.innerText) && !/כניסה כאורח/.test(document.body.innerText)));
  await pg.screenshot({path: SP + '/phone-1.png'});

  const click = re => pg.evaluate(r => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(r).test(y.textContent)); if (x) x.click(); }, re);
  const type = async (ph, v) => pg.evaluate(([p, val]) => {
    const el = [...document.querySelectorAll('input')].find(i => new RegExp(p).test(i.placeholder));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }, [ph, v]);

  await click('כניסה עם מספר טלפון');
  await pg.waitForTimeout(600);
  const fields = await pg.evaluate(() => [...document.querySelectorAll('input')].map(i => ({ph: i.placeholder, max: i.maxLength, im: i.inputMode, ac: i.autocomplete})));
  check('name field and a tel field appear',
    fields.some(f => /שם/.test(f.ph) && f.max === 20) && fields.some(f => /05X/.test(f.ph) && f.im === 'tel'),
    JSON.stringify(fields));
  check('the note says the number is verified by SMS and cannot be changed',
    await pg.evaluate(() => /SMS/.test(document.body.innerText) && /לשנות/.test(document.body.innerText)));
  await pg.screenshot({path: SP + '/phone-2.png'});

  // ---- validation happens BEFORE an SMS is spent -------------------------
  await type('שם', 'א'); await type('05X', '0521234567'); await click('שלח לי קוד');
  await pg.waitForTimeout(500);
  check('a 1-character name is refused', await pg.evaluate(() => /לפחות 2 תווים/.test(document.body.innerText)));
  check('  no SMS was sent for it', await pg.evaluate(() => !window.__stubSends));

  await type('שם', NAME); await type('05X', '05212'); await click('שלח לי קוד');
  await pg.waitForTimeout(500);
  check('a too-short number is refused', await pg.evaluate(() => /מספר לא תקין/.test(document.body.innerText)));
  check('  still no SMS spent', await pg.evaluate(() => !window.__stubSends));

  await type('05X', '05a2b1c234567');
  check('the number field keeps digits (and +) only',
    await pg.evaluate(() => ([...document.querySelectorAll('input')].find(i => /05X/.test(i.placeholder)) || {}).value) === TYPED);

  // ---- send ---------------------------------------------------------------
  await click('שלח לי קוד');
  await pg.waitForTimeout(900);
  check('the number was normalised to E.164 before it went to Firebase',
    await pg.evaluate(() => window.__stubPhone) === E164, await pg.evaluate(() => window.__stubPhone));
  check('the code screen shows the number it sent to',
    await pg.evaluate(e => document.body.innerText.includes(e), E164));
  const codeField = await pg.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find(x => x.maxLength === 6);
    return i ? {im: i.inputMode, ac: i.autocomplete} : null;
  });
  check('a 6-digit one-time-code field is focused-ready (numeric, autofill)',
    !!codeField && codeField.im === 'numeric' && codeField.ac === 'one-time-code', JSON.stringify(codeField));
  check('resend is blocked for the first seconds', await pg.evaluate(() =>
    [...document.querySelectorAll('button')].some(x => /שליחה חוזרת בעוד/.test(x.textContent) && x.disabled)));
  await pg.screenshot({path: SP + '/phone-3.png'});

  // ---- a wrong code must not sign anyone in -------------------------------
  await pg.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(i => i.maxLength === 6);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '000000');
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await pg.waitForTimeout(900);
  check('a wrong code is rejected the moment the sixth digit lands — no button press',
    await pg.evaluate(() => /הקוד שגוי/.test(document.body.innerText)));
  check('  he is still on the login screen', await pg.evaluate(() => /Sign in with Google/.test(document.body.innerText)));
  check('  the half-typed name did not leak into a global',
    await pg.evaluate(() => !window.__guestName && !window.__guestNumber));

  // ---- the real code ------------------------------------------------------
  await pg.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(i => i.maxLength === 6);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '123456');
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await pg.waitForTimeout(3500);   // no click: six digits submit themselves

  const out = await pg.evaluate(() => {
    const S = window.__stubStore;
    const u = Object.entries(S.users).filter(([k]) => k.startsWith('ph_')).map(([k, v]) => ({uid: k, ...v}))[0] || null;
    return {u, leftAuth: !/Sign in with Google/.test(document.body.innerText),
      screen: document.body.innerText.slice(0, 90).replace(/\n/g, ' | '),
      leakedName: window.__guestName, leakedNum: window.__guestNumber};
  });
  check('the right code signs him in ON ITS OWN — the keyboard can fill it and he is through',
    out.leftAuth, out.screen);
  check('a users doc was created', !!out.u, JSON.stringify(out.u));
  if (out.u) {
    check('  username is the name he typed', out.u.username === NAME, out.u.username);
    check('  playerId is the VERIFIED number', out.u.playerId === E164, String(out.u.playerId));
    check('  phoneVerified is true', out.u.phoneVerified === true, String(out.u.phoneVerified));
    check('  isGuest is FALSE — a proved number is a real identity', out.u.isGuest === false, String(out.u.isGuest));
    check('  he lands as a pending player, 0 balance, not a bot',
      out.u.status === 'pending' && out.u.role === 'player' && out.u.balance === 0 && out.u.isBot === false,
      JSON.stringify({s: out.u.status, r: out.u.role, b: out.u.balance, bot: out.u.isBot}));
  }
  check('the temporary globals were cleared', !out.leakedName && !out.leakedNum,
    JSON.stringify({n: out.leakedName, m: out.leakedNum}));
  check('no page errors', errs.length === 0, errs.join(' ; '));
  await pg.screenshot({path: SP + '/phone-4.png'});

  // ---- and the half that matters to the owner: can he tell who this is? ----
  const uid = out.u && out.u.uid;
  if (uid) {
    const pg2 = await b.newPage({viewport: {width: 430, height: 932}});
    await pg2.goto('http://localhost:8079/index.html?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
    await pg2.waitForTimeout(3000);
    await pg2.evaluate(([u, n, num]) => {
      const S = window.__stubStore;
      S.users[u] = {username: n, email: '', playerId: num, phone: num, phoneVerified: true, isGuest: false,
        isBot: false, role: 'player', status: 'pending', balance: 0};
      S.memberships[u + '_main'] = {uid: u, clubId: 'main', username: n, email: '', playerId: num,
        isGuest: false, isBot: false, role: 'player', status: 'pending', balance: 0, createdAt: Date.now()};
    }, [uid, NAME, E164]);
    await pg2.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
    await pg2.waitForTimeout(2200);
    await pg2.evaluate(() => { const x = [...document.querySelectorAll('button,a')].find(y => /^Manage$/i.test((y.textContent || '').trim())); if (x) x.click(); });
    await pg2.waitForTimeout(2800);
    const seen = await pg2.evaluate(([n, num]) => {
      const t = document.body.innerText;
      return {name: t.includes(n), num: t.includes(num), approve: /Approve/.test(t)};
    }, [NAME, E164]);
    check('the owner sees the NAME in his approval queue', seen.name);
    check('the owner sees the VERIFIED NUMBER on the same row', seen.num);
    check('there is an Approve button for him', seen.approve);
    await pg2.screenshot({path: SP + '/phone-owner.png', fullPage: true});
    await pg2.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
