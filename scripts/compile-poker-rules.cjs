'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(__dirname, '.generated-firestore.rules');

// Keep the shared ruleset out of both hosting packages and poker release commits.
// Replace only the reviewed tournament block. Fail closed if the shared source changes.
function composeRules() {
  const shared = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const poker = fs.readFileSync(path.join(__dirname, 'poker-player-access.rules'), 'utf8');
  const start = shared.indexOf('    // Match the lobby\'s authorityVersion + clubId query.');
  const end = shared.indexOf('    match /tournamentViews/{id}', start);
  const previous = shared.slice(start, end);
  const digest = createHash('sha256').update(previous).digest('hex');
  if (start < 0 || end <= start || digest !== '58895dda86793598799379d5ad9d2a49a7991e8faa03a9054a0d558b0dd7ddc7') {
    throw new Error('Shared tournament access rules changed. Review the poker replacement before deploying.');
  }
  return shared.slice(0, start) + poker + shared.slice(end);
}

if (require.main === module) fs.writeFileSync(target, composeRules(), { mode: 0o600 });
module.exports = { composeRules };
