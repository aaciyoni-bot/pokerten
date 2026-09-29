'use strict';
// Exercise the real callable with isolated Firestore reads, never live cards.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const enginePath=path.join(__dirname,'../pokerEngine.js');
const source=fs.readFileSync(enginePath,'utf8'),engineRequire=createRequire(enginePath);
const HAIM='haim29071994@gmail.com',REVOKED='easymarcelos@gmail.com';
function fixture(){
 const reads=[],board=['A','K','Q','J','10'].map(val=>({val,suit:'♠'})),cards=[{val:'2',suit:'♥'},{val:'3',suit:'♥'}];
 const data={'tables/test':{players:{p1:{cardCount:2}},gameState:{board}},'tables/test/priv/_engine':{deck:[]},'tables/test/priv/p1':{cards}};
 const ref=p=>({collection:name=>ref(p+'/'+name),doc:id=>ref(p+'/'+id),get:async()=>{reads.push(p);return{exists:p in data,data:()=>data[p]};}});
 // Collections start at the Firestore root, without a leading slash.
 const db={collection:name=>ref(name)};
 // The engine resolves getFirestore lazily on the first permitted read.
 const context={exports:{},console,require:name=>name==='firebase-functions/v2/https'?{...engineRequire(name),onCall:(_,fn)=>fn}:name==='firebase-functions/v2/scheduler'?{onSchedule:(_,fn)=>fn}:name==='firebase-admin/firestore'?{getFirestore:()=>db}:engineRequire(name)};
 vm.runInNewContext(source,context);
 return{peek:context.exports.godPeek,reads,board,cards};
}
const auth=(email,verified=true)=>({uid:'verified-account',token:{email,email_verified:verified}});
test('HAIM can read the existing GOD callable after verified sign-in',async()=>{
 const f=fixture(),result=await f.peek({auth:auth(HAIM),data:{tableId:'test'}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{hands:{p1:f.cards},finalBoard:f.board});
 assert.deepEqual(f.reads.sort(),['tables/test','tables/test/priv/_engine','tables/test/priv/p1']);
});
test('revoked EASYMARCELOS and unverified/forged identities cannot read any private document',async()=>{
 for(const identity of [auth(REVOKED),auth(HAIM,false),auth('ordinary@example.invalid'),{uid:'verified-account',email:HAIM,role:'super_admin',token:{email:'ordinary@example.invalid',email_verified:true}},null]){
  const f=fixture();
  await assert.rejects(f.peek({auth:identity,data:{tableId:'test',email:HAIM,role:'super_admin'}}),e=>e.code===(identity?'permission-denied':'unauthenticated'));
  assert.deepEqual(f.reads,[]);
 }
});
test('UI GOD identity guard agrees with the callable including revocation',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
 const clientList=vm.runInNewContext(html.match(/const GOD_EMAILS = (\[[^;]+);/)[1]);
 const serverList=vm.runInNewContext(source.match(/const GOD_EMAILS = (\[[^;]+);/)[1]);
 assert.deepEqual(Array.from(clientList).sort(),Array.from(serverList).sort());
 assert.ok(clientList.includes(HAIM));assert.equal(clientList.includes(REVOKED),false);
 const context={window:{fb:{auth:{currentUser:{uid:'haim',email:HAIM,emailVerified:true}}}}};
 vm.runInNewContext(html.match(/const GOD_EMAILS = [^;]+;/)[0]+'\n'+html.slice(html.indexOf('const isGodUser ='),html.indexOf('const isClubOversightUser ='))+'\nthis.allowed=isGodUser;',context);
 assert.equal(context.allowed({uid:'haim'}),true);
 context.window.fb.auth.currentUser.email=REVOKED;assert.equal(context.allowed({uid:'haim',email:HAIM}),false);
 context.window.fb.auth.currentUser.email=HAIM;assert.equal(context.allowed({uid:'other',email:HAIM}),false);
});
