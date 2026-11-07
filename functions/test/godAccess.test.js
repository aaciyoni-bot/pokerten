'use strict';
const {identities}=require('../../tests/god-session-fixture.cjs');
// Exercise the real callable with isolated Firestore reads, never live cards.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const enginePath=path.join(__dirname,'../pokerEngine.js');
const source=fs.readFileSync(enginePath,'utf8'),engineRequire=createRequire(enginePath);
const SUPERVISOR_A=identities.supervisors[0],SUPERVISOR_B=identities.supervisors[1],REVOKED=identities.revoked;
function fixture(){
 const reads=[],board=['A','K','Q','J','10'].map(val=>({val,suit:'♠'})),cards=[{val:'2',suit:'♥'},{val:'3',suit:'♥'}];
 let transactions=0;
 const data={'tables/test':{handCount:29,players:{p1:{cardCount:2}},gameState:{handN:23,phase:'river',currentGameType:'NLH',board}},'tables/test/priv/_engine':{deck:[]},'tables/test/priv/p1':{cards}};
 const ref=p=>({path:p,collection:name=>ref(p+'/'+name),doc:id=>ref(p+'/'+id),get:async()=>{throw Error('GOD cards must use a single transactional snapshot');}});
 // Collections start at the Firestore root, without a leading slash.
 const db={collection:name=>ref(name),runTransaction:async fn=>{
  transactions++;
  const snapshot=structuredClone(data);
  const read=r=>{reads.push(r.path);return{exists:r.path in snapshot,data:()=>snapshot[r.path]};};
  return fn({get:async r=>read(r),getAll:async(...refs)=>refs.map(read)});
 }};
 // The engine resolves getFirestore lazily on the first permitted read.
 const context={exports:{},console,require:name=>name==='firebase-functions/v2/https'?{...engineRequire(name),onCall:(_,fn)=>fn}:name==='firebase-functions/v2/scheduler'?{onSchedule:(_,fn)=>fn}:name==='firebase-admin/firestore'?{getFirestore:()=>db}:engineRequire(name)};
 vm.runInNewContext(source,context);
 const contextKey=JSON.stringify([29,23,'river','NLH',board.map(c=>[c.val,c.suit]),[['p1',2]]]);
 return{peek:context.exports.godPeek,reads,board,cards,contextKey,get transactions(){return transactions;}};
}
const auth=(email,verified=true)=>({uid:'verified-account',token:{email,email_verified:verified}});
for(const [i,email] of [SUPERVISOR_A,SUPERVISOR_B].entries())test('Authorized observer '+(i+1)+' can read the existing GOD callable after verified sign-in',async()=>{
 const f=fixture(),result=await f.peek({auth:auth(email),data:{tableId:'test',contextKey:f.contextKey}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{tableId:'test',contextKey:f.contextKey,handN:23,hands:{p1:f.cards},finalBoard:f.board});
 assert.deepEqual(f.reads.sort(),['tables/test','tables/test/priv/_engine','tables/test/priv/p1']);
 assert.equal(f.transactions,1,'the real engine callable uses one coherent transaction');
});
test('revoked former observer and unverified/forged identities cannot read any private document',async()=>{
 for(const identity of [auth(REVOKED),auth(SUPERVISOR_A,false),auth(SUPERVISOR_B,false),auth('ordinary@example.invalid'),{uid:'verified-account',email:SUPERVISOR_B,role:'super_admin',token:{email:'ordinary@example.invalid',email_verified:true}},null]){
  const f=fixture();
  await assert.rejects(f.peek({auth:identity,data:{tableId:'test',email:SUPERVISOR_A,role:'super_admin'}}),e=>e.code===(identity?'permission-denied':'unauthenticated'));
  assert.deepEqual(f.reads,[]);
  assert.equal(f.transactions,0,'authorization must run before starting a private read transaction');
 }
});
test('UI GOD identity guard agrees with the callable including revocation',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
 const {emails,grantFor}=require('../../tests/god-session-fixture.cjs');
 assert.ok(emails.includes(SUPERVISOR_A));assert.ok(emails.includes(SUPERVISOR_B));assert.equal(emails.includes(REVOKED),false);
 for (const email of emails)assert.equal(html.includes(email),false,'viewer email list must not ship with the app');
 const user={uid:'supervisorA',email:SUPERVISOR_A,emailVerified:true};
 const context={window:{fb:{auth:{currentUser:user},viewerGrant:grantFor(user)}}};
 vm.runInNewContext(html.slice(html.indexOf('const isGodUser ='),html.indexOf('const isClubOversightUser ='))+'\nthis.allowed=isGodUser;',context);
 assert.equal(context.allowed({uid:'supervisorA'}),true);
 context.window.fb.auth.currentUser.email=REVOKED;assert.equal(context.allowed({uid:'supervisorA',email:SUPERVISOR_A}),false);
 context.window.fb.auth.currentUser.email=SUPERVISOR_A;assert.equal(context.allowed({uid:'other',email:SUPERVISOR_A}),false);
});
