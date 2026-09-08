/* Assemble aviator-live.html (the multiplayer client) from the solo
   aviator.html design + the live/ part files. One-shot scaffold; the
   generated file is committed to the repo and edited there afterwards. */
const fs = require('fs');
const path = require('path');
/* repo root = two levels up from aviator-src/live/ (overridable via env) */
const SRC = process.env.AVIATOR_REPO_ROOT || path.resolve(__dirname, '..', '..');
const P = __dirname;
const read = f => fs.readFileSync(f, 'utf8');

const src = read(SRC + '/aviator.html');

const cut = (hay, from, to, label) => {
  const a = hay.indexOf(from);
  const b = hay.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('anchor missing: ' + label);
  return hay.slice(a, b);
};

/* --- head + css --- */
let head = src.slice(0, src.indexOf('</style>'));
head += read(P + '/extra.css') + '\n#backBtn{display:none}\n</style>\n</head>\n<body>\n';

/* --- body html --- */
let body = cut(src, '<div id="splash">', '<script type="module">', 'body');
body = body.replace('<button class="icon-btn" id="soundBtn"',
  '<button class="icon-btn badge" id="chatBtn" aria-label="Chat">💬</button>\n    ' +
  '<button class="icon-btn" id="adminBtn" hidden aria-label="Admin dashboard">⚙️</button>\n    ' +
  '<button class="icon-btn" id="soundBtn"');
body = body.replace('<div id="godPill" hidden>⚡ crash @ <b id="godVal">—</b></div>',
  '<div id="fairPill" hidden></div>');
body = body.replace('<div id="iosModal">', read(P + '/extra.html') + '\n<div id="iosModal">');

/* --- reusable script sections from the solo game --- */
const js = cut(src, '"use strict";', '</script>\n</body>', 'main script');
const sound  = cut(js, '/* =====================================================================\n   SOUND ENGINE',
                       '/* =====================================================================\n   BOTS', 'sound');
const canvas = cut(js, '/* =====================================================================\n   CANVAS',
                       '/* =====================================================================\n   MAIN LOOP', 'canvas');
const pwa    = cut(js, '/* =====================================================================\n   APP INSTALL',
                       '/* keep the screen awake', 'pwa')
             + cut(js, '/* keep the screen awake', '/* persist chips */', 'wakelock');
const patch = s => s.replace(/performance\.now\(\)/g, 'eNow()');

const script = [
  read(P + '/main1.js'),
  patch(sound),
  patch(canvas),
  read(P + '/main2.js'),
  patch(pwa),
  read(P + '/main3.js'),
].join('\n');

const out = head + body + read(P + '/module.html') + '\n<script>\n' + script + '\n</script>\n</body>\n</html>\n';
fs.writeFileSync(SRC + '/aviator-live.html', out);
fs.writeFileSync(P + '/live-script-check.js', script);
console.log('aviator-live.html bytes:', out.length);
