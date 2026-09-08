'use strict';
// Load the actual, pure browser policy without mounting the app or contacting Firebase.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
module.exports = function loadClientBot() {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const source = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m => m[1].includes('const botPokerMove ='))[1];
  const names = ['round2', 'SUITS', 'CARD_VALUES', 'pokerDeck', 'getCombinations', 'evaluate5Cards', 'bestScoreFull', 'deckWithout', 'simMyEquity', 'botRangeFacing', 'botHandBody', 'botPreflopTier', 'botPokerMove'];
  const found = new Map();
  for (const node of babel.parseSync(source).program.body) {
    if (node.type === 'FunctionDeclaration' && names.includes(node.id.name)) found.set(node.id.name, source.slice(node.start, node.end));
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) {
      if (names.includes(d.id.name)) found.set(d.id.name, `${node.kind} ${source.slice(d.start, d.end)};`);
    }
  }
  for (const name of names) if (!found.has(name)) throw new Error(`Missing actual client declaration: ${name}`);
  const context = vm.createContext({ Math });
  vm.runInContext([...found.values()].join('\n') + `\nthis.policy = { ${names.join(', ')} };`, context);
  return context.policy;
};
