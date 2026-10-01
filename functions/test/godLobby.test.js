'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createCallable} = require('../godLobby');
const engine = fs.readFileSync(path.join(__dirname, '../pokerEngine.js'), 'utf8');
const guard = vm.runInNewContext(engine.match(/const GOD_EMAILS = [^;]+;/)[0] + '\n' + engine.match(/const isGodAuth = [^\n]+/)[0] + '\nisGodAuth;');
const HAIM = 'haim29071994@gmail.com';
const auth = (email, verified = true) => ({uid: 'viewer', token: {email, email_verified: verified}});
const ordinary = auth('manager@example.invalid');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture() {
  const reads = [];
  const docs = {
    mixed: {clubId: 'main', type: 'poker', players: {human: {isBot: false}, bot: {isBot: true}, unknown: {name: 'Legacy'}, departed: {isBot: false, status: 'left'}, ofcDeparted: {isBot: false, left: true}}, waitlist: [{uid: 'queued-bot', isBot: true}], gameState: {deck: ['must not return']}},
    empty: {clubId: 'main', type: 'ofc', players: {}},
    other: {clubId: 'private-other', type: 'poker', players: {hidden: {isBot: false}}},
    unsupported: {clubId: 'main', type: 'aviator', players: {hidden: {isBot: false}}}
  };
  const db = {collection: name => ({doc: id => ({name, id})}), getAll: async (...refs) => {
    reads.push(...refs.map(ref => ref.name + '/' + ref.id));
    return refs.map(ref => ({exists: !!docs[ref.id], data: () => docs[ref.id]}));
  }};
  const call = createCallable({onCall: (_, fn) => fn, HttpsError, db: () => db, isGodAuth: guard, CALL_OPTS: {}});
  return {call, reads};
}
test('only verified GOD identities can obtain lobby counts; rejected requests read nothing', async () => {
  for (const identity of [null, ordinary, {...ordinary, role: 'super_admin'}, {...ordinary, role: 'club_owner'}, {...ordinary, role: 'manager'}, auth(HAIM, false), auth('easymarcelos@gmail.com')]) {
    const f = fixture();
    await assert.rejects(f.call({auth: identity, data: {clubId: 'main', tableIds: ['mixed'], godMode: true, email: HAIM}}), e => e.code === (identity ? 'permission-denied' : 'unauthenticated'));
    assert.deepEqual(f.reads, []);
  }
});
test('GOD receives seated counts only, with unknown preserved and waitlist/departed excluded', async () => {
  const f = fixture();
  const result = await f.call({auth: auth(HAIM), data: {clubId: 'main', tableIds: ['mixed', 'empty', 'other', 'unsupported', 'missing', 'mixed']}});
  assert.deepEqual(result, {tables: [
    {tableId: 'mixed', humans: 1, bots: 1, unknown: 1, seated: 3, occupancyKey: '["bot","human","unknown"]'},
    {tableId: 'empty', humans: 0, bots: 0, unknown: 0, seated: 0, occupancyKey: '[]'}
  ]});
  assert.deepEqual(f.reads, ['tables/mixed', 'tables/empty', 'tables/other', 'tables/unsupported', 'tables/missing']);
  assert.ok(!JSON.stringify(result).includes('must not return'));
});
test('request bounds and document path validation run before any read', async () => {
  for (const data of [{clubId: 'main', tableIds: Array(61).fill('mixed')}, {clubId: 'main', tableIds: ['mixed/priv/_engine']}, {clubId: '../main', tableIds: ['mixed']}, {clubId: 'main', tableIds: [42]}]) {
    const f = fixture();
    await assert.rejects(f.call({auth: auth(HAIM), data}), e => e.code === 'invalid-argument');
    assert.deepEqual(f.reads, []);
  }
});
test('callable is wired to the engine GOD predicate, not a role predicate', () => {
  assert.match(engine, /exports\.godLobbyCounts = require\("\.\/godLobby"\)\.createCallable\(\{onCall, HttpsError, db, isGodAuth, CALL_OPTS\}\)/);
});
