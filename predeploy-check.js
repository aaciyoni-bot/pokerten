#!/usr/bin/env node
/* POKERTEN — mandatory pre-deploy checks.
 *
 * WHY THIS EXISTS: a syntax-only check ("does the bundle parse?") passes even
 * when a change silently breaks basic behaviour — e.g. flipping the engine flag
 * so cards read from an empty source. These checks assert BEHAVIOURAL INVARIANTS
 * that must never regress. Run `node predeploy-check.js` before EVERY push.
 * A non-zero exit means DO NOT DEPLOY.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

let fails = 0, passes = 0;
const ok = m => { passes++; console.log('  ✓ ' + m); };
const bad = m => { fails++; console.log('  ✗ ' + m); };
// A check: name + predicate(text)->boolean(true=pass) + failure explanation
const check = (name, pass, why) => pass ? ok(name) : bad(name + ' — ' + why);

// Largest inline script = the app bundle.
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const bundle = scripts.reduce((a, b) => (b.length > a.length ? b : a), '');

console.log('POKERTEN pre-deploy checks\n');

// 1) BUNDLE PARSES (crash guard)
try { new Function(bundle); ok('bundle parses (no syntax error)'); }
catch (e) { bad('bundle parses — ' + e.message); }

// 2) ENGINE FLAG IS DERIVED FROM THE TABLE, NEVER HARD-CODED.
//    This is the exact class of bug that blanked the cards: `const srvEngine = false`.
check('srvEngine is derived from table settings (not hard-coded)',
  /const srvEngine = !!\(\(tableState \|\| \{\}\)\.settings \|\| \{\}\)\.serverEngine;/.test(bundle) &&
  !/const srvEngine = (true|false)\b/.test(bundle),
  'srvEngine must be `!!settings.serverEngine`, never a constant');

// 3) HERO CARD SOURCE COVERS BOTH ENGINE MODES.
//    Server mode -> priv cards; client mode -> players[uid].cards. If either
//    side is missing, a whole engine mode renders with no cards.
check('hero card source handles server AND client engine (myCards)',
  /const myCards = srvEngine \? .*myPrivCards.*: myPlayer\?\.cards \|\| \[\];/.test(bundle),
  'myCards must fall back to myPlayer.cards when srvEngine is off');

check('table card render handles both engine modes (dispCards)',
  /let dispCards = p\.cards \|\| \[\];/.test(bundle) && /if \(srvEngine\) \{/.test(bundle),
  'dispCards must default to p.cards and only override inside `if (srvEngine)`');

// 4) SPIN cards path present (spin is server-dealt — must read priv cards).
check('spin still reads server-dealt cards',
  /srvEngine \? myPrivCards : myPlayer\?\.cards/.test(bundle),
  'spin/showdown card path must keep the srvEngine?priv:client branch');

// 5) ACTIONS ROUTE FOR BOTH MODES (server via pkAct, else client engine).
check('performAction has server AND client branches',
  /const performAction = async[\s\S]{0,400}?if \(setts\.serverEngine\)/.test(bundle) &&
  /fx\('pkAct'/.test(bundle),
  'performAction must keep both the server (pkAct) and client fallback paths');

// 6) pkTick must not early-return on a value read from a lagging ref (that froze hands).
const tickBlock = (bundle.match(/if \(!srvEngine\) return;\s*const iv = setInterval\(\(\) => \{[\s\S]{0,300}?fx\('pkTick'/g) || [])[0] || '';
check('pkTick is not gated on tableRef.current inside the interval',
  !/tableRef\.current[\s\S]{0,120}return;[\s\S]{0,120}fx\('pkTick'/.test(bundle),
  'a stale-ref guard here can skip the tick that advances the hand (freeze)');

// 7) SW CACHE VERSION WAS BUMPED (else the deploy is served stale).
const swVer = (sw.match(/pokerten-shell-v(\d+)/) || [])[1];
const htmlVerRef = html.includes('pokerten-shell-v' + swVer); // not required, informational
check('service-worker cache version present', !!swVer,
  'sw.js must define a pokerten-shell-vNN cache name');
if (swVer) console.log('    (sw cache = pokerten-shell-v' + swVer + ' — confirm it is higher than the live deploy)');

// 8) PURE HAND-NAME FUNCTION SANITY (evaluate the real function from the bundle).
try {
  const hn = bundle.match(/const handName = \(?s\)? => [^;]+;/);
  if (hn) {
    // eslint-disable-next-line no-eval
    const fn = eval('(' + hn[0].replace('const handName = ', '').replace(/;\s*$/, '') + ')');
    check('handName returns a distinct label per tier',
      !!fn(9000000) && !!fn(1000000) && !!fn(0) && fn(9000000) !== fn(0),
      'handName produced empty/identical output across score tiers');
  } else { bad('handName present — could not locate function'); }
} catch (e) { bad('handName evaluates — ' + e.message); }

// 9) RAKE IS NEVER TAKEN ON UNCALLED BETS (fold-out over-rake regression).
//    BUG (fixed f7f2bac): on a fold-out, rake was charged on the full pot
//    INCLUDING the winner's uncalled bet — their own money returning. A 300
//    contested pot with a 533 uncalled shove was raked 6%×833≈50 instead of 18.
//    Lock BOTH the structural guard and the resulting math so it can't return.
check('finishEarlyWin returns the winner\'s uncalled bet BEFORE building the pot',
  /_maxOther[\s\S]{0,200}?_w\.bet = _maxOther;[\s\S]{0,120}?gatherBetsToPots\(g, pl\)/.test(bundle),
  'the uncalled-bet return block must run before gatherBetsToPots in finishEarlyWin, else uncalled money gets raked');

try {
  const gm = bundle.match(/const gatherBetsToPots = \(gs, playersObj\) => \{[\s\S]*?Object\.values\(playersObj\)\.forEach\(p => p\.bet = 0\);\s*\};/);
  if (gm) {
    const round2 = n => Math.round(n * 100) / 100;
    // eslint-disable-next-line no-eval
    const gather = eval(gm[0].replace('const gatherBetsToPots = ', 'var __gather = ') + '\n__gather;');
    // Canonical scenario: 300 contested already pooled, winner shoves 533 uncalled, all fold.
    const g = { pots: [{ amount: 300, eligible: ['W', 'X'] }], board: ['a','b','c','d','e'] };
    const pl = { W:{uid:'W',bet:533,status:'active',stack:0}, X:{uid:'X',bet:0,status:'folded',stack:0} };
    const winnerUid = 'W', _w = pl[winnerUid];
    const _maxOther = Object.values(pl).reduce((m,p)=>p.uid!==winnerUid?Math.max(m,p.bet||0):m,0);
    if (_w && (_w.bet||0) > _maxOther) { const _unc = round2(_w.bet-_maxOther); _w.stack = round2((_w.stack||0)+_unc); _w.bet = _maxOther; }
    gather(g, pl);
    const pot = round2((g.pots||[]).reduce((s,p)=>s+p.amount,0));
    const rake = round2(pot * 0.06);
    check('fold-out rake = 6% of the CONTESTED pot only (18, not ~50)',
      pot === 300 && rake === 18,
      `expected contested pot 300 / rake 18, got pot ${pot} / rake ${rake} — uncalled money is being raked`);
  } else { bad('rake math check — could not locate gatherBetsToPots in bundle'); }
} catch (e) { bad('rake math check evaluates — ' + e.message); }

// 10) RAKE IS RECORDED PER PLAYER (report-was-always-0 regression, fixed 5e92716).
check('per-player rake is attributed in reports (not always 0)',
  /rakes\[[^\]]*\.uid\][\s\S]{0,80}?e\.rake/.test(bundle) || /e\.rake \|\| 0/.test(bundle),
  'rake must be attributed per player (rakes[e.uid] += e.rake) so reports are not always 0');

// 11) ANTI-FREEZE: the stuck-turn guard must run for ANY seated player.
//    If canGuardTable is narrowed to owner/admin only, a table of pure players
//    freezes the moment the active player disconnects and the owner isn't
//    watching. The seated-player clause is what makes tables self-heal.
check('stuck-turn guard runs for any seated player (self-healing tables)',
  /canGuardTable = !srvEngine &&[\s\S]{0,160}?tableState\?\.players\?\.\[user\.uid\]/.test(bundle),
  'canGuardTable must include `!!tableState?.players?.[user.uid]` so every seated client can unstick the table');

// 12) ANTI-FREEZE: the guard actually force-acts a stuck/disconnected player.
check('guard force-acts a stuck or disconnected player (fold/call)',
  /const gone = !actor\.isBot && actor\.lastSeen[\s\S]{0,450}?performAction\(g\.activeTurnUid/.test(bundle),
  'the guard must call performAction on the stuck active player after the timeout');

// 13) ANTI-FREEZE: server-engine deal has a bounded timeout + failover to client.
//    If pkDeal hangs, the table must flip to the proven client engine, not wait.
check('deal has a bounded timeout and fails over to the client engine',
  /pkDeal timeout/.test(bundle) && /pkDeal failed[\s\S]{0,500}?'settings\.serverEngine': false/.test(bundle),
  'startHand must race pkDeal against a timeout and set settings.serverEngine=false on failure');

// 14) STABILITY: new cash tables and tournaments default to the client engine.
check('new cash tables default to the client engine (serverEngine:false)',
  /serverEngine: false, \/\/ new cash tables/.test(bundle),
  'the cash-table create default must stay serverEngine:false until the server engine is proven');

// 15) CHIP INTEGRITY: tournament pots are NEVER raked. Rake on tournament
//     chips destroys the prize-pool chip count hand after hand (the 270k→50k
//     trial-tournament disaster) and leaves decimal stacks. BOTH showdown
//     paths (runShowdown + finishEarlyWin) must zero the rake for tournaments.
check('tournament pots are never raked (both showdown paths)',
  (bundle.match(/rakeFrac = \(tableRef\.current \|\| \{\}\)\.tournament \? 0 :/g) || []).length >= 2,
  'both rakeFrac sites must be `(tableRef.current || {}).tournament ? 0 : ...`');

// 16) CHIP INTEGRITY: a 0-chip seat is never dealt cards. Dealing a stack-0
//     "zombie" keeps it at the table forever posting phantom blinds.
check('0-chip seats are busted at deal time, never dealt',
  /status === 'active' && \(p\.stack \|\| 0\) <= 0[\s\S]{0,120}?p\.status = 'busted'/.test(bundle) &&
  /filter\(p => p\.status === 'active' && \(p\.stack \|\| 0\) > 0\)\.sort/.test(bundle),
  'executeDeal must mark stack<=0 seats busted and only deal status=active AND stack>0');

// 17) CHIP INTEGRITY: saveGame is seq-guarded. Without the optimistic-
//     concurrency check a stale client (phone waking from background) can
//     overwrite a fresher hand — erasing pot awards (players left at 0).
check('saveGame carries the __seq optimistic-concurrency guard',
  /const base = Number\(g\.__seq\) \|\| 0;[\s\S]{0,600}?if \(cur !== base\) throw 'stale';/.test(bundle),
  'saveGame must run in a transaction and abort when gameState.__seq moved on');

// 18) TOURNAMENT INTEGRITY: the zombie reconciler exists. Without it, a
//     clobbered bust report leaves players 'alive with 0' in the standings
//     forever (the trial-tournament screenshot).
check('mttOrchestrate reconciles zombie players (alive with 0 chips)',
  /ZOMBIE RECONCILER/.test(bundle) && /zombies\.length && zombies\.length < rankAlive\.length/.test(bundle),
  'the idle-gated zombie sweep in mttOrchestrate must stay');

// 19) BOT BRAIN: the inline copy in index.html must be byte-identical to
//     functions/botBrain.js — cash tables (client engine) and Spin tables
//     (server engine) must play the SAME bot. Run `node sync-bot-brain.js`.
try {
  const brainFile = fs.readFileSync(path.join(__dirname, 'functions', 'botBrain.js'), 'utf8').replace(/\s+$/, '');
  const inline = (html.match(/<script id="bot-brain">\n([\s\S]*?)\n?    <\/script>\n    <!-- BOT-BRAIN-END -->/) || [])[1];
  check('inline bot brain is byte-identical to functions/botBrain.js',
    !!inline && inline.replace(/\s+$/, '') === brainFile,
    'run `node sync-bot-brain.js` — the client and server bots have drifted apart');
  check('bot brain module parses and exposes create()',
    (() => { try { const m = { exports: {} }; new Function('module', 'self', brainFile)(m, {}); return typeof m.exports.create === 'function'; } catch (e) { return false; } })(),
    'functions/botBrain.js failed to evaluate');
  check('client bot falls back to the legacy policy if the brain is missing',
    /const botPokerMoveLegacy = \(g, t, b\) => \{/.test(bundle) && /return botPokerMoveLegacy\(g, t, b\);/.test(bundle),
    'botPokerMove must keep the botPokerMoveLegacy fallback so a bot can never freeze a hand');
} catch (e) { bad('bot brain checks — ' + e.message); }

console.log('\n' + (fails ? `FAILED: ${fails} check(s) failed, ${passes} passed — DO NOT DEPLOY` : `OK: all ${passes} checks passed`));
process.exit(fails ? 1 : 0);
