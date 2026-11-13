'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {parseSync, traverse} = require('@babel/core');
const {JSDOM} = require('jsdom');

const html = fs.readFileSync(require.resolve('../../index.html'), 'utf8');
const bundle = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .find(match => match[1].includes('function PokerTable('));
assert.ok(bundle, 'Expected the main game client');
const offset = html.slice(0, bundle.index + bundle[0].indexOf('>') + 1).split('\n').length - 1;
const browser = new JSDOM('', {url:'https://example.invalid', pretendToBeVisual:true}).window;
// React loads via script tags. These browser APIs are optional or missing in jsdom.
const provided = new Set(['React','ReactDOM','ResizeObserver','Notification','fetch']);
try {
  const ast = parseSync(bundle[1], {configFile:false, babelrc:false, sourceType:'script'});
  traverse(ast, {Program(program) {
    const missing = Object.entries(program.scope.globals)
      .filter(([name]) => !(name in browser) && !provided.has(name))
      .map(([name,node]) => name+' (index.html line '+(offset+node.loc.start.line)+')');
    assert.deepEqual(missing, [], 'Unresolved client references: '+missing.join(', '));
    program.stop();
  }});
  console.log('PASS: game client handlers and components resolve their identifiers');
} finally {
  browser.close();
}
