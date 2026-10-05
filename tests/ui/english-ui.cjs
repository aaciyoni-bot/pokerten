'use strict';
const assert = require('node:assert/strict');

// Only call this on controlled fixtures with English user data. Real names,
// messages and notes may use any language; this checks interface copy, not data.
module.exports = function assertEnglishUi(root, scenario) {
  assert.ok(root, scenario + ': rendered UI exists');
  const doc = root.ownerDocument, hebrew = /[\u0590-\u05ff]/u;
  const walker = doc.createTreeWalker(root, doc.defaultView.NodeFilter.SHOW_TEXT);
  const untranslated = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest('script,style') && hebrew.test(node.textContent))
      untranslated.push('text: ' + node.textContent.trim());
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute(attribute);
      if (value && hebrew.test(value)) untranslated.push(attribute + ': ' + value);
    }
  }
  assert.deepEqual(untranslated, [], scenario + ': interface text and accessible labels are English');
};
