'use strict';
// Exercise the real callable, command receipts, permission checks and ledger
// against an atomic in-memory Firestore transaction. No remote services run.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const localRequire=createRequire(path.join(__dirname,'../pokerAccess.js'));
const {HUMAN_WAIT_LEASE_MS,normalizeWaitlist}=require('../pokerWaitlist');
const NOW=Date.parse('2026-09-27T12:00:00Z');
const copy=value=>structuredClone(value);
const person=(uid,extra={})=>({uid,name:uid,at:NOW-1000,buyAmt:50,...extra});
const bot=uid=>person(uid,{isBot:true});
function fixture({waitlist=[],players={},status='approved',balance=1000}={}){
 const docs=new Map([['tables/tableA',{authorityVersion:2,type:'poker',clubId:'clubA',settings:{serverEngine:true,baseGameType:'NLH',maxPlayers:6,blinds:.5,minBuyIn:50,maxBuyIn:200},players:copy(players),waitlist:copy(waitlist),gameState:{phase:'waiting',pots:[],__seq:0}}],['clubs/clubA',{ownerUid:'owner'}]]);
 for(const uid of ['alice','bob','carol','owner']){
  docs.set('users/'+uid,{username:uid});
  docs.set(`memberships/${uid}_clubA`,{uid,clubId:'clubA',status,balance,role:uid==='owner'?'club_owner':'player'});
 }
 let autoId=0,requestId=0,now=NOW;
 class ClockDate extends Date{static now(){return now;}}
 const db={doc:p=>({path:p,id:p.split('/').pop()}),collection:name=>({doc:()=>db.doc(name+'/auto'+(++autoId))}),async runTransaction(body){
  const writes=[];let wrote=false;
  const tx={
   async get(ref){assert.equal(wrote,false,'All Firestore reads must precede writes');const value=docs.get(ref.path);return{ref,id:ref.id,exists:value!==undefined,data:()=>copy(value)};},
   async getAll(...refs){return Promise.all(refs.map(ref=>tx.get(ref)));},
   update(ref,patch){wrote=true;writes.push({ref,patch:copy(patch),update:true});},
   set(ref,patch){wrote=true;writes.push({ref,patch:copy(patch)});}
  };
  const result=await body(tx);
  for(const {ref,patch,update}of writes){
   if(!update){docs.set(ref.path,patch);continue;}
   assert.ok(docs.has(ref.path));const value=copy(docs.get(ref.path));
   for(const [field,item]of Object.entries(patch)){const keys=field.split('.');let target=value;for(const key of keys.slice(0,-1))target=target[key]??={};target[keys.at(-1)]=item;}
   docs.set(ref.path,value);
  }
  return result;
 }};
 function load(file,overrides={}){
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,exports:module.exports,require:name=>Object.hasOwn(overrides,name)?overrides[name]:localRequire(name),console,Date:ClockDate,Buffer},{filename:file});
  return module.exports;
 }
 const A=load('pokerAuthority.js',{'firebase-admin/firestore':{getFirestore:()=>db}});
 const access=load('pokerAccess.js',{'./pokerAuthority':A,'firebase-functions/v2/https':{onCall:(_,handler)=>handler},'./pokerSecurity':{requirePokerAvailable(){}}});
 return{docs,table:()=>docs.get('tables/tableA'),balance:uid=>docs.get(`memberships/${uid}_clubA`).balance,advance:ms=>{now+=ms;},
  run:(uid,op,extra={},rid)=>access.pkSeat({auth:uid?{uid,token:{email:uid+'@example.test',email_verified:true}}:null,data:{tableId:'tableA',requestId:rid||'waitlist-request-'+(++requestId),op,amount:50,...extra}})};
}

test('first waiting human can take a seat ahead of bot metadata and is charged once',async()=>{
 const f=fixture({waitlist:[bot('bot_first'),person('alice'),bot('bot_second'),person('bob')]});
 const result=await f.run('alice','join',{fromWaitlist:true},'fixed-waitlist-request');
 assert.equal(result.ok,true);
 assert.equal(f.table().players.alice.stack,50);
 assert.equal(f.balance('alice'),950);
 assert.equal(f.balance('owner'),1000);
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['bob','bot_first','bot_second']);
 await f.run('alice','join',{fromWaitlist:true},'fixed-waitlist-request');
 assert.equal(f.balance('alice'),950,'An idempotent retry must not debit twice');
});
test('newcomers and later humans cannot bypass the first player, with or without the waitlist flag',async()=>{
 for(const [uid,fromWaitlist]of [['carol',false],['carol',true],['bob',false],['bob',true]]){
  const f=fixture({waitlist:[bot('bot_first'),person('alice'),person('bob')]});
  const before=copy([...f.docs]);
  await assert.rejects(f.run(uid,'join',{fromWaitlist}),error=>error.code==='failed-precondition');
  assert.deepEqual([...f.docs],before,'A rejected join must not change balances, seats, queue or receipts');
 }
});
test('direct join by the first queued human remains valid and bot-only queues do not block humans',async()=>{
 for(const waitlist of [[person('alice'),bot('bot_waiting')],[bot('bot_waiting')]]){
  const f=fixture({waitlist});await f.run('alice','join');
  assert.equal(f.table().players.alice.stack,50);
  assert.equal(f.balance('alice'),950);
  assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['bot_waiting']);
 }
});
test('joining and refreshing the queue preserves human FIFO without reserving chips',async()=>{
 const f=fixture({waitlist:[bot('bot_one'),person('alice'),bot('bot_two'),person('bob')]});
 await f.run('carol','wait',{isBot:true});
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['alice','bob','carol','bot_one','bot_two']);
 assert.equal(f.table().waitlist[2].isBot,undefined,'A request cannot forge bot queue metadata');
 await f.run('alice','wait',{amount:75});
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['alice','bob','carol','bot_one','bot_two']);
 assert.equal(f.table().waitlist[0].at,NOW-1000);
 assert.equal(f.table().waitlist[0].seenAt,NOW);
 assert.equal(f.table().waitlist[0].buyAmt,75);
 assert.equal(f.balance('alice'),1000);assert.equal(f.balance('carol'),1000);
 assert.equal([...f.docs.keys()].some(key=>key.startsWith('_pkLedger/')),false);
});
test('bot metadata cannot fill the human queue capacity; total entries stay bounded',async()=>{
 const f=fixture({waitlist:Array.from({length:30},(_,i)=>bot('bot_'+i))});
 await f.run('alice','wait');
 assert.equal(f.table().waitlist.length,30);
 assert.equal(f.table().waitlist[0].uid,'alice');
 assert.equal(f.table().waitlist.filter(entry=>entry.isBot).length,29);
 const full=fixture({waitlist:Array.from({length:30},(_,i)=>person('human_'+i))});
 await assert.rejects(full.run('alice','wait'),error=>error.code==='resource-exhausted');
 assert.equal(full.table().waitlist.length,30);
});
test('only the caller leaves the queue, while humans stay ahead of bots',async()=>{
 const f=fixture({waitlist:[bot('bot_one'),person('alice'),person('bob')]});
 await f.run('alice','unwait',{uid:'bob',targetUid:'bob'});
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['bob','bot_one']);
 assert.equal(f.balance('alice'),1000);
});
test('manual bot add and fill cannot consume vacancies ahead of humans or debit the sponsor',async()=>{
 for(const op of ['addbot','fillbots']){
  const f=fixture({waitlist:[bot('bot_one'),person('alice')]});const before=copy([...f.docs]);
  await assert.rejects(f.run('owner',op),error=>error.code==='failed-precondition');
  assert.deepEqual([...f.docs],before);
 }
});
test('queue requests retain membership, authentication and bot-management permission checks',async()=>{
 for(const uid of [null,'unknown']){
  const f=fixture();await assert.rejects(f.run(uid,'wait'),error=>['unauthenticated','permission-denied'].includes(error.code));
  assert.equal(f.table().waitlist.length,0);
 }
 const pending=fixture({status:'pending'});
 await assert.rejects(pending.run('alice','wait'),error=>error.code==='permission-denied');
 const normal=fixture();await assert.rejects(normal.run('alice','addbot'),error=>error.code==='permission-denied');
});
test('a stale seated waiter is removed and cannot block the next actual human',async()=>{
 const f=fixture({players:{alice:{uid:'alice',seatIndex:0,stack:100}},waitlist:[person('alice'),bot('bot_one'),person('bob')]});
 await f.run('bob','join',{fromWaitlist:true});
 assert.equal(f.table().players.bob.seatIndex,1);
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['bot_one']);
});
test('insufficient balance keeps the waiting entry and seat unchanged',async()=>{
 const f=fixture({balance:20,waitlist:[person('alice'),bot('bot_one')]});const before=copy([...f.docs]);
 await assert.rejects(f.run('alice','join',{fromWaitlist:true}),error=>error.code==='failed-precondition');
 assert.deepEqual([...f.docs],before);
});
test('a queue heartbeat renews the lease without charging or moving the player back',async()=>{
 const f=fixture({waitlist:[person('alice'),person('bob'),bot('bot_waiting')]});
 f.advance(60000);await f.run('alice','wait',{amount:75});
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['alice','bob','bot_waiting']);
 assert.equal(f.table().waitlist[0].at,NOW-1000);
 assert.equal(f.table().waitlist[0].seenAt,NOW+60000);
 assert.equal(f.table().waitlist[0].buyAmt,75);
 assert.equal(f.balance('alice'),1000);
 assert.equal([...f.docs.keys()].some(key=>key.startsWith('_pkLedger/')),false);
});
test('an offline human expires after five minutes and cannot pin a vacant table',async()=>{
 const f=fixture({waitlist:[person('alice'),bot('bot_waiting')]});
 f.advance(HUMAN_WAIT_LEASE_MS);await f.run('bob','join');
 assert.equal(f.table().players.bob.stack,50);
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['bot_waiting']);
 assert.equal(f.balance('alice'),1000);assert.equal(f.balance('bob'),950);
});
test('renewed human leases survive old FIFO timestamps, while bots have no player lease',()=>{
 const t={waitlist:[person('old'),person('renewed',{at:1,seenAt:NOW-60000}),bot('bot_waiting'),person('missing',{at:undefined})]};
 t.waitlist[0].at=NOW-HUMAN_WAIT_LEASE_MS;t.waitlist[2].at=1;
 assert.deepEqual(normalizeWaitlist(t,NOW).map(entry=>entry.uid),['renewed','bot_waiting']);
 assert.deepEqual(normalizeWaitlist({waitlist:[person('legacy',{at:NOW-60000})]},NOW).map(entry=>entry.uid),['legacy']);
});
test('returning after lease expiry rejoins behind currently live players',async()=>{
 const f=fixture({waitlist:[person('alice',{at:NOW-HUMAN_WAIT_LEASE_MS}),person('bob',{seenAt:NOW-60000}),bot('bot_waiting')]});
 await f.run('alice','wait');
 assert.deepEqual(f.table().waitlist.map(entry=>entry.uid),['bob','alice','bot_waiting']);
 assert.equal(f.table().waitlist[1].at,NOW);assert.equal(f.table().waitlist[1].seenAt,NOW);
 assert.equal(f.balance('alice'),1000);
});
