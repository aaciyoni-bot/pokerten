'use strict';
const {identities}=require('../../tests/god-session-fixture.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createCallable} = require('../godLobby');
const engine = fs.readFileSync(path.join(__dirname, '../pokerEngine.js'), 'utf8');
const guard = vm.runInNewContext(engine.match(/const GOD_EMAILS = [^;]+;/)[0] + '\n' + engine.match(/const isGodAuth = [^\n]+/)[0] + '\nisGodAuth;');
const SUPERVISOR_A = identities.supervisors[0];
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
  for (const identity of [null, ordinary, {...ordinary, role: 'super_admin'}, {...ordinary, role: 'club_owner'}, {...ordinary, role: 'manager'}, auth(SUPERVISOR_A, false), auth(identities.revoked)]) {
    const f = fixture();
    await assert.rejects(f.call({auth: identity, data: {clubId: 'main', tableIds: ['mixed'], godMode: true, email: SUPERVISOR_A}}), e => e.code === (identity ? 'permission-denied' : 'unauthenticated'));
    assert.deepEqual(f.reads, []);
  }
});
test('GOD receives seated counts only, with unknown preserved and waitlist/departed excluded', async () => {
  const f = fixture();
  const result = await f.call({auth: auth(SUPERVISOR_A), data: {clubId: 'main', tableIds: ['mixed', 'empty', 'other', 'unsupported', 'missing', 'mixed']}});
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
    await assert.rejects(f.call({auth: auth(SUPERVISOR_A), data}), e => e.code === 'invalid-argument');
    assert.deepEqual(f.reads, []);
  }
});
test('callable is wired to the engine GOD predicate, not a role predicate', () => {
  assert.match(engine, /exports\.godLobbyCounts = require\("\.\/godLobby"\)\.createCallable\(\{onCall, HttpsError, db, isGodAuth, CALL_OPTS\}\)/);
});

test('each signed-in session receives only its own verified permissions without reading any table',async()=>{
 const f=fixture();
 for(const identity of [auth(SUPERVISOR_A.toUpperCase()),auth(SUPERVISOR_A,false),ordinary]){
  const allowed=identity.token.email_verified && identity.token.email.toLowerCase()===SUPERVISOR_A;
  assert.deepEqual(await f.call({auth:identity,data:{mode:'access',uid:'another',email:SUPERVISOR_A}}),
    {uid:identity.uid,god:allowed,oversight:allowed});
 }
 assert.deepEqual(f.reads,[]);
});

test('observer fallback serves only shared, authoritative poker state for the requested club',async()=>{
 const table={authorityVersion:2,type:'poker',settings:{serverEngine:true,baseGameType:'Omaha 7'},clubId:'main',gameState:{phase:'preflop'}};
 let reads=0;
 const db={collection(name){assert.equal(name,'tables');return{doc:id=>({get:async()=>{reads++;return{id,exists:true,data:()=>table};}})};}};
 const call=createCallable({onCall:(_,fn)=>fn,HttpsError,db:()=>db,isGodAuth:guard,CALL_OPTS:{}});
 const data={mode:'watch',clubId:'main',tableId:'plo7'};
 await assert.rejects(call({auth:ordinary,data}),e=>e.code==='permission-denied');
 await assert.rejects(call({auth:auth(SUPERVISOR_A,false),data}),e=>e.code==='permission-denied');
 await assert.rejects(call({auth:auth(SUPERVISOR_A),data:{...data,tableId:'plo7/priv/_engine'}}),e=>e.code==='invalid-argument');
 assert.equal(reads,0);
 assert.deepEqual((await call({auth:auth(SUPERVISOR_A),data})).rows,[{...table,docId:'plo7'}]);
 assert.deepEqual((await call({auth:auth(SUPERVISOR_A),data:{...data,clubId:'other'}})).rows,[]);
 table.authorityVersion=1;
 assert.deepEqual((await call({auth:auth(SUPERVISOR_A),data})).rows,[]);
});
