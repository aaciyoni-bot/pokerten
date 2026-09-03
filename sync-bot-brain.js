#!/usr/bin/env node
/* Copies functions/botBrain.js into index.html between the BOT-BRAIN markers so
 * the client engine and the server engine run the SAME bot. Run after every
 * edit to botBrain.js; predeploy-check.js fails if the two copies differ. */
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const brain = fs.readFileSync(path.join(__dirname, 'functions', 'botBrain.js'), 'utf8').replace(/\s+$/, '');
const re = /(<script id="bot-brain">\n)([\s\S]*?)(\n?    <\/script>\n    <!-- BOT-BRAIN-END -->)/;
if (!re.test(html)) { console.error('bot-brain markers not found in index.html'); process.exit(1); }
const out = html.replace(re, (m, a, b, c) => a + brain + c);
if (out !== html) { fs.writeFileSync(htmlPath, out); console.log('index.html: bot-brain block synced (' + brain.length + ' chars)'); }
else console.log('index.html: bot-brain block already in sync');
