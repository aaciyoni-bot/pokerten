// "I press reset and some of the data doesn't reset."
// Seed a club that looks like the morning after a real night — tables with
// chips on them, a tournament, hand history, a security alert, players with
// balances and spent daily bonuses — then press GENERAL RESET and see what
// is actually left.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
const URL = process.env.RK_URL || 'http://localhost:8079/index.html';

let pass = 0; let fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (extra ? '  → ' + extra : '')); } };

(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 1280, height: 900}});
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) console.log('  PAGEERROR: ' + s.slice(0, 150)); });
  await pg.goto(URL + '?as=owner1&x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(3200);

  // the morning after
  await pg.evaluate(async () => {
    const S = window.__stubStore;
    for (let i = 0; i < 3; i++) {
      await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'old' + i), {
        type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
        settings: {baseGameType: 'NLH', maxPlayers: 6, blinds: 0.5, minBuyIn: 40, maxBuyIn: 200, serverEngine: false},
        players: {z1: {uid: 'z1', name: 'Leftover', seatIndex: 0, stack: 340, bet: 0, buyTotal: 100, status: 'active', isBot: false}},
        gameState: {phase: 'waiting', deck: [], board: [], pots: [], highestBet: 0, minRaise: 1, __seq: 1},
        chat: [], leftStacks: {}, tournamentId: null,
        history: [{at: Date.now(), rake: 12, winners: ['z1']}, {at: Date.now(), rake: 4, winners: ['z1']}]
      });
    }
    // a table with no clubId at all — written before the field existed
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'legacy'), {
      type: 'poker', createdAt: Date.now(), settings: {maxPlayers: 6, blinds: 0.5}, players: {},
      gameState: {phase: 'waiting', pots: []}, chat: [], history: []
    });
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tournaments', 'tr1'),
      {clubId: 'main', name: 'Last night', status: 'done', game: 'poker', players: {}, results: []});
    S.securityAlerts = S.securityAlerts || {};
    S.securityAlerts.chips_main_old0_x = {kind: 'chips', clubId: 'main', tableId: 'old0', at: Date.now(), count: 3, delta: -50};
    // a player who played, took a bonus and has a balance
    S.memberships.p9_main = {uid: 'p9', clubId: 'main', username: 'Nightowl', playerId: 'P009', role: 'player',
      status: 'approved', balance: 812.5, clubProfits: 33, agentProfits: 5, bonusTotal: 100, bonusOpen: 60,
      promoBalance: 25, lastBonusAt: Date.now(), lastScratchAt: Date.now(), spinPaid: 50, lastRefundAt: Date.now(),
      isBot: false, stats: {gamesPlayed: 40, gamesWon: 9, totalProfit: 312}};
  });
  await pg.waitForTimeout(1500);

  const snapshot = () => pg.evaluate(() => {
    const S = window.__stubStore;
    const mine = o => Object.values(o || {}).filter(t => (t.clubId || 'main') === 'main').length;
    const m = S.memberships.p9_main || {};
    return {tables: mine(S.tables), tours: mine(S.tournaments), logs: mine(S.gameLog),
      alerts: Object.keys(S.securityAlerts || {}).length,
      bal: m.balance, bonus: m.bonusOpen, promo: m.promoBalance, lastBonus: m.lastBonusAt,
      games: (m.stats || {}).gamesPlayed};
  });
  const before = await snapshot();
  console.log('the morning after:', JSON.stringify(before));
  check('there is something to reset', before.tables >= 4 && before.tours >= 1 && before.logs > 0, JSON.stringify(before));

  // press the button, exactly as the owner does
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(2200);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button,a')].find(y => /^Manage$/i.test((y.textContent || '').trim())); if (x) x.click(); });
  await pg.waitForTimeout(2800);
  const opened = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /General reset/i.test(y.textContent)); if (x) { x.click(); return true; } return false; });
  check('the General reset button is on the management screen', opened);
  await pg.waitForTimeout(900);
  const clubName = await pg.evaluate(() => (window.__club || {}).name || 'Netabel');
  await pg.evaluate((nm) => {
    const el = [...document.querySelectorAll('input')].find(i => /confirm|RESET/i.test(i.className) || i.autofocus) ||
      [...document.querySelectorAll('input')].pop();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, nm);
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }, clubName);
  await pg.waitForTimeout(500);
  // sample the store while the reset runs — the page reloads itself at the end
  const samples = [];
  const poll = setInterval(async () => { try { samples.push(await snapshot()); } catch (e) {} }, 250);
  const fired = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /^RESET the club$/.test((y.textContent || '').trim())); if (x && !x.disabled) { x.click(); return true; } return false; });
  check('the typed club name unlocks the reset', fired);
  await pg.waitForTimeout(6000);
  clearInterval(poll);

  const low = samples.reduce((a, s) => ({
    tables: Math.min(a.tables, s.tables), tours: Math.min(a.tours, s.tours), logs: Math.min(a.logs, s.logs),
    alerts: Math.min(a.alerts, s.alerts), bal: Math.min(a.bal === undefined ? 1e9 : a.bal, s.bal === undefined ? 1e9 : s.bal),
    bonus: Math.min(a.bonus === undefined ? 1e9 : a.bonus, s.bonus === undefined ? 1e9 : s.bonus),
    promo: Math.min(a.promo === undefined ? 1e9 : a.promo, s.promo === undefined ? 1e9 : s.promo),
    lastBonus: Math.min(a.lastBonus === undefined ? 1e18 : a.lastBonus, s.lastBonus === undefined ? 1e18 : s.lastBonus),
    games: Math.min(a.games === undefined ? 1e9 : a.games, s.games === undefined ? 1e9 : s.games)
  }), {tables: 1e9, tours: 1e9, logs: 1e9, alerts: 1e9, bal: 1e9, bonus: 1e9, promo: 1e9, lastBonus: 1e18, games: 1e9});
  console.log('lowest seen during the reset:', JSON.stringify(low));

  check('every table in the club is gone (including the one with no clubId)', low.tables === 0, String(low.tables));
  check('every tournament is gone', low.tours === 0, String(low.tours));
  check('the hand / money history is gone', low.logs === 0, String(low.logs));
  check('the security alerts are gone', low.alerts === 0, String(low.alerts));
  check('the player is at 0', low.bal === 0, String(low.bal));
  check('his bonus is cleared', low.bonus === 0, String(low.bonus));
  check('his promo wallet is cleared', low.promo === 0, String(low.promo));
  check('his daily-bonus clock is cleared (he can claim again tonight)', low.lastBonus === 0, String(low.lastBonus));
  check('his stats are back to zero', low.games === 0, String(low.games));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
