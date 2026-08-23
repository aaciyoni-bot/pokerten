/**
 * BINGO CLIENT↔SERVER PARITY — the client's pattern maths (extracted from the
 * real index.html bundle) must agree with the server's (functions/bingoCore)
 * on every card and every call state, or the BINGO! button will light when
 * the server says "false bingo" (or worse, stay dark on a real win).
 *
 * Run: node bingo.parity.sim.js
 */
'use strict';
const fs = require('fs');
const B = require('./functions/bingoCore');

let pass = 0; let fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (extra ? '\n          → ' + extra : '')); }
};

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const cut = (a, b) => {
  const i = html.indexOf(a);
  if (i < 0) throw new Error('client marker missing: ' + a);
  const j = html.indexOf(b, i);
  if (j < 0) throw new Error('client marker missing: ' + b);
  return html.slice(i, j);
};
// the pure helper block of the client bingo code (before any React component)
const clientSrc = cut('const BINGO_BALLS = {', 'const bingoTableDoc =');
const client = new Function(clientSrc + `
  return {bingoHasPattern, bingoMissingFor, bingoActivePatterns, bingoRows90Done, BINGO_LINES_75};
`)();

let seed = 424242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const randInt = (n) => Math.floor(rnd() * n);

console.log('bingo client<->server parity\n');

// 1) pattern verdicts agree on random cards across a full simulated draw
let checks = 0; let diffs = 0;
for (let round = 0; round < 40; round++) {
  const variant = round % 2 ? '75' : '90';
  const cards = [];
  for (let i = 0; i < 4; i++) cards.push(B.genCard(variant, rnd));
  const order = B.ballOrder(variant, randInt);
  const called = new Set();
  for (const ball of order) {
    called.add(ball);
    if (called.size % 3 !== 0 && called.size < order.length) continue; // sample every 3rd state
    for (const nums of cards) {
      for (const pat of B.PATTERNS[variant]) {
        checks++;
        const srv = B.hasPattern(variant, nums, called, pat);
        const cli = client.bingoHasPattern(variant, nums, called, pat);
        if (srv !== cli) diffs++;
        const srvM = B.missingFor(variant, nums, called, pat);
        const cliM = client.bingoMissingFor(variant, nums, called, pat);
        if (srvM !== cliM) diffs++;
      }
    }
  }
}
check(`pattern verdict + one-to-go parity (${checks} states)`, diffs === 0, diffs + ' disagreements');

// 2) active pattern lists agree for every split shape
const splits = [
  {line1: 20, line2: 30, full: 50}, {line1: 0, line2: 0, full: 100},
  {line: 25, corners: 0, blackout: 75}, {line: 0, corners: 0, blackout: 100},
];
let apOk = true;
for (const sp of splits) {
  for (const variant of ['90', '75']) {
    const a = JSON.stringify(B.activePatterns(variant, sp));
    const b = JSON.stringify(client.bingoActivePatterns(variant, sp));
    if (a !== b) apOk = false;
  }
}
check('active-pattern lists agree (final pattern always terminates)', apOk);

// 3) the 75-ball line tables are the same 12 lines
check('75-ball line tables identical',
  JSON.stringify(B.LINES_75) === JSON.stringify(client.BINGO_LINES_75));

console.log('\n' + (fail ? `FAILED: ${fail} check(s)` : `OK: all ${pass} parity checks passed`));
process.exit(fail ? 1 : 0);
