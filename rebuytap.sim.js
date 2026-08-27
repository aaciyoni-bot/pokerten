// "A player could not rebuy because a window sat on the rebuy button."
// Reproduce it the only way that proves it: put a busted player at a cash
// table and ask the browser what element is actually on top of the Rebuy
// button. If it is not the button, the tap never reaches it.
const {chromium} = require('playwright');
const SP = '/tmp/claude-0/-home-user-pokerten/dd8db2c3-a372-565d-84ac-73c03e3f163a/scratchpad';
const URL = process.env.RK_URL || 'http://localhost:8079/index.html';

(async () => {
  const b = await chromium.launch({executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox']});
  const pg = await b.newPage({viewport: {width: 430, height: 932}, deviceScaleFactor: 2});
  pg.on('pageerror', e => { const s = String(e); if (!/__col/.test(s)) console.log('  PAGEERROR:', s.slice(0, 150)); });
  await pg.goto(URL + '?x=' + Date.now(), {waitUntil: 'load'});
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => /Enter/i.test(y.textContent)); if (x) x.click(); });
  await pg.waitForTimeout(2200);

  // exactly the owner's screenshot: hero busted to 0, another player to act
  await pg.evaluate(async () => {
    const S = window.__stubStore;
    S.users.bot_l = {username: 'לביא וקסמן', isBot: true, avatarSeed: 'l1'};
    const seat = (uid, name, ix, stack, bot, st) => ({uid, name, seatIndex: ix, stack, bet: 0, buyTotal: 100,
      status: st || 'active', cards: [], hasActed: false, actionText: '', isBot: !!bot});
    await window.fb.setDoc(window.fb.doc(window.fb.db, 'tables', 'bust'), {
      type: 'poker', clubId: 'main', createdAt: Date.now(), status: '', hostUid: 'owner1',
      settings: {baseGameType: 'NLH', tableName: 'BUST', maxPlayers: 6, blinds: 1, actionTime: 30,
        minBuyIn: 50, maxBuyIn: 200, serverEngine: false, rakePercent: 5},
      players: {
        marcelos: {...seat('marcelos', 'You', 3, 0, false, 'busted'), bustedAt: Date.now()},
        owner1: seat('owner1', 'Mishmar', 0, 98, false),
        bot_l: seat('bot_l', 'לביא וקסמן', 1, 185.99, true)
      },
      gameState: {phase: 'flop', deck: [], board: [{r: '2', s: 'c'}, {r: '7', s: 'h'}, {r: 'A', s: 'c'}],
        pots: [{amount: 4, eligible: ['owner1', 'bot_l']}], highestBet: 0, minRaise: 2,
        dealerUid: 'owner1', currentGameType: 'NLH', activeTurnUid: 'bot_l', turnStartedAt: Date.now(),
        lastWinners: null, lastWinAmount: 0, allInReveal: false, __seq: 1},
      chat: [], leftStacks: {}, tournamentId: null, history: []
    });
  });
  await pg.waitForTimeout(1400);
  await pg.evaluate(() => { const e = [...document.querySelectorAll('button,div')].filter(x => /You're seated|BUST/.test(x.textContent || '')); const el = e[e.length - 1]; if (el) el.click(); });
  await pg.waitForTimeout(3000);

  const r = await pg.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(x => /Rebuy/.test(x.textContent || ''));
    if (!btn) return {found: false};
    const b = btn.getBoundingClientRect();
    const cx = Math.round(b.x + b.width / 2); const cy = Math.round(b.y + b.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const covers = top && !btn.contains(top) && top !== btn;
    const describe = el => el ? (el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 3).join('.')).slice(0, 90) : 'nothing';
    // walk up from whatever is on top to find its stacking context
    let z = ''; let n = top;
    while (n && n !== document.body) { const zi = getComputedStyle(n).zIndex; if (zi !== 'auto') { z = zi + ' on ' + describe(n); break; } n = n.parentElement; }
    return {found: true, rect: {x: cx, y: cy, w: Math.round(b.width), h: Math.round(b.height)},
      top: describe(top), covers, z, visible: b.width > 0 && b.height > 0};
  });

  console.log('Rebuy button:', r.found ? JSON.stringify(r.rect) : 'NOT RENDERED');
  console.log('what is on top of it:', r.top);
  if (r.z) console.log('   covering layer z-index:', r.z);
  console.log(r.covers ? '\nFAIL — the tap lands on something else, the player cannot rebuy'
    : '\nPASS — the Rebuy button is the topmost element at its own centre');

  // and prove the tap actually works end to end
  if (!r.covers && r.found) {
    await pg.evaluate(() => { const S = window.__stubStore; S.memberships.marcelos_main.balance = 5000; });
    await pg.waitForTimeout(400);
    await pg.click('button:has-text("Rebuy")').catch(() => {});
    await pg.waitForTimeout(1800);
    const after = await pg.evaluate(() => {
      const p = (window.__stubStore.tables.bust.players || {}).marcelos || {};
      return {stack: p.stack, status: p.status};
    });
    console.log('after tapping Rebuy:', JSON.stringify(after),
      after.stack > 0 ? '→ PASS, he is back with chips' : '→ FAIL, still at 0');
  }
  await pg.screenshot({path: SP + '/rebuy.png'});
  await b.close();
  process.exit(r.covers ? 1 : 0);
})();
