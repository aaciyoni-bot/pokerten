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

console.log('\n' + (fails ? `FAILED: ${fails} check(s) failed, ${passes} passed — DO NOT DEPLOY` : `OK: all ${passes} checks passed`));
process.exit(fails ? 1 : 0);
