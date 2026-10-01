'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createCallable, godCardContext} = require('../godPeek');
const client = require('../../assets/js/poker-runtime');
const source = fs.readFileSync(path.join(__dirname, '../pokerEngine.js'), 'utf8');
const guard = vm.runInNewContext(source.match(/const GOD_EMAILS = [^;]+;/)[0] + '\n' + source.match(/const isGodAuth = [^\n]+/)[0] + '\nisGodAuth;');
const auth = (email = 'haim29071994@gmail.com', verified = true) => ({uid: 'viewer', token: {email, email_verified: verified}});
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const card = (val, suit = '♠') => ({val, suit});
const table = () => ({gameState: {handN: 7, phase: 'turn', currentGameType: 'NLH', board: ['2','3','4','5'].map(v => card(v, '♥'))}, players: {a: {cardCount: 2}, b: {cardCount: 2}}});
function fixture() {
  let docs = {'tables/t': table(), 'tables/t/priv/_engine': {deck: [card('8'), card('9')]},
    'tables/t/priv/a': {cards: [card('A'), card('K')]}, 'tables/t/priv/b': {cards: [card('Q'), card('J')]}};
  const reads = [], writes = [];
  const ref = path => ({path, collection: name => ({doc: id => ref(path + '/' + name + '/' + id)}),
    get: () => { throw Error('Independent reads can mix two hands'); }});
  const snap = (snapshot, r) => ({exists: !!snapshot[r.path], data: () => structuredClone(snapshot[r.path])});
  let afterTableRead = () => {};
  const database = {collection: name => ({doc: id => ref(name + '/' + id)}), runTransaction: async fn => {
    const snapshot = structuredClone(docs);
    return fn({get: async r => { reads.push(r.path); const result = snap(snapshot, r); afterTableRead(); return result; },
      getAll: async (...refs) => { reads.push(...refs.map(r => r.path)); return refs.map(r => snap(snapshot, r)); },
      set: (...args) => writes.push(args), update: (...args) => writes.push(args)});
  }};
  const call = createCallable({onCall: (_, fn) => fn, HttpsError, db: () => database, isGodAuth: guard, CALL_OPTS: {}});
  return {call, reads, writes, get docs() { return docs; }, set docs(value) { docs = value; }, set afterTableRead(fn) { afterTableRead = fn; }};
}
test('peek denies forged role/profile/GOD flag, unverified and removed accounts before reads', async () => {
  for (const identity of [null, auth('player@example.invalid'), {...auth('owner@example.invalid'), role: 'super_admin'}, auth(undefined, false), auth('easymarcelos@gmail.com')]) {
    const f = fixture();
    await assert.rejects(f.call({auth: identity, data: {tableId: 't', godMode: true, email: 'haim29071994@gmail.com'}}),
      e => e.code === (identity ? 'permission-denied' : 'unauthenticated'));
    assert.deepEqual(f.reads, []);
  }
});
test('atomic peek cannot mix old public hand with newly dealt private cards or deck', async () => {
  const f = fixture(), before = structuredClone(f.docs), contextKey = godCardContext(before['tables/t']);
  f.afterTableRead = () => { f.docs['tables/t'].gameState.handN++; f.docs['tables/t/priv/a'].cards = [card('6'), card('7')]; f.docs['tables/t/priv/_engine'].deck = [card('10'), card('J')]; };
  const result = await f.call({auth: auth(), data: {tableId: 't', contextKey}});
  assert.equal(result.tableId, 't'); assert.equal(result.handN, 7); assert.equal(result.contextKey, contextKey);
  assert.deepEqual(result.hands.a, before['tables/t/priv/a'].cards);
  assert.deepEqual(result.finalBoard.at(-1), card('8'));
  assert.deepEqual(f.writes, []); assert.equal(result.deck, undefined);
});
test('hand mismatch rejects before private reads and incomplete hands never return a partial winner', async () => {
  const f = fixture();
  await assert.rejects(f.call({auth: auth(), data: {tableId: 't', contextKey: 'old-hand'}}), e => e.code === 'failed-precondition');
  assert.deepEqual(f.reads, ['tables/t']);
  delete f.docs['tables/t/priv/b'];
  await assert.rejects(f.call({auth: auth(), data: {tableId: 't'}}), e => e.code === 'failed-precondition');
});
test('context agrees client/server, catches same-phase/bomb-pot next hand and discard, ignores bets/presence', () => {
  const t = table(), initial = godCardContext(t);
  assert.equal(client.godCardContext(t), initial);
  t.gameState.__seq = 100; t.players.a.bet = 100; t.players.a.lastSeen = Date.now();
  assert.equal(godCardContext(t), initial);
  for (const change of [x => x.handCount = (x.handCount || 0) + 1, x => x.gameState.handN++, x => x.gameState.board[0].suit = '♦', x => x.players.a.cardCount = 3, x => x.gameState.currentGameType = 'Omaha4']) {
    const changed = structuredClone(t); change(changed);
    assert.notEqual(godCardContext(changed), initial); assert.equal(client.godCardContext(changed), godCardContext(changed));
  }
});
test('peek path validation and engine wiring retain trusted GOD predicate', async () => {
  const f = fixture();
  await assert.rejects(f.call({auth: auth(), data: {tableId: 't/priv/a'}}), e => e.code === 'invalid-argument');
  assert.deepEqual(f.reads, []);
  assert.match(source, /exports\.godPeek = require\("\.\/godPeek"\)\.createCallable\(\{onCall, HttpsError, db, isGodAuth, CALL_OPTS\}\)/);
});
