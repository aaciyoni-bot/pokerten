const { chromium } = require('playwright');
const fs = require('fs');
const P = __dirname;
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('page: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto('http://localhost:8765/aviator-live.html');
  await p.waitForTimeout(3600);
  // inject the mock backend, then enter
  await p.evaluate(fs.readFileSync(P + '/mock-fb.js', 'utf8'));
  await p.waitForTimeout(400);
  await p.click('#spPlay');
  await p.waitForTimeout(1200);
  const out = {};
  out.loginHidden = await p.evaluate(() => !document.querySelector('#loginModal').classList.contains('on'));
  out.balance = await p.textContent('#balanceNum');
  out.adminBtnVisible = await p.evaluate(() => !document.querySelector('#adminBtn').hidden);
  // wait for waiting phase then bet
  await p.waitForFunction(() => document.querySelector('#actionBtn').textContent.includes('Place bet'), null, { timeout: 20000 });
  await p.screenshot({ path: P + '/1-live-waiting.png' });
  await p.click('#actionBtn');
  await p.waitForTimeout(500);
  out.afterBet = await p.textContent('#actionBtn');
  out.playersRow = await p.evaluate(() => document.querySelector('#players').textContent.trim().slice(0, 60));
  // wait for flight, cash out
  await p.waitForFunction(() => document.querySelector('#actionBtn').className === 'cash', null, { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: P + '/2-live-flying.png' });
  await p.click('#actionBtn');
  await p.waitForTimeout(600);
  out.afterCash = await p.textContent('#actionBtn');
  // wait for crash + next round
  await p.waitForFunction(() => document.querySelector('#crashTag').classList.contains('on'), null, { timeout: 40000 });
  await p.screenshot({ path: P + '/3-live-crashed.png' });
  out.fairPill = await p.textContent('#fairPill');
  await p.waitForFunction(() => document.querySelector('#countdown') && !document.querySelector('#countdown').hidden, null, { timeout: 20000 });
  out.nextRoundOk = true;
  // chat
  await p.click('#chatBtn');
  await p.fill('#chatInput', 'שלום מהבדיקה');
  await p.click('#chatSend');
  await p.waitForTimeout(400);
  out.chatMsg = await p.evaluate(() => document.querySelector('#chatList').textContent.includes('שלום מהבדיקה'));
  await p.screenshot({ path: P + '/4-live-chat.png' });
  /* chat auto-closes on send now */
  // admin
  await p.click('#adminBtn');
  await p.waitForTimeout(500);
  out.adminPlayers = await p.evaluate(() => document.querySelectorAll('#admPlayers .admRow').length);
  out.adminRounds = await p.evaluate(() => document.querySelectorAll('#admRounds .admRound').length);
  await p.screenshot({ path: P + '/5-live-admin.png' });
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
