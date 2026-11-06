'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const list=html.match(/const GOD_EMAILS = ([\s\S]*?);/)[0];
const predicate=html.slice(html.indexOf('const isGodUser ='),html.indexOf('const canManageGame ='));
function gate(profile,identity){const window={fb:{auth:{currentUser:identity}}};return vm.runInNewContext(list+predicate+'isGodUser(profile)',{window,profile});}
const emails=vm.runInNewContext(list+'GOD_EMAILS');
test('GOD UI trusts only the matching verified sign-in, never profile roles or email',()=>{
 const profile={uid:'me',email:emails[0],role:'superadmin'};
 for(const identity of [null,{uid:'me',email:'other@example.com',emailVerified:true},{uid:'me',email:emails[0],emailVerified:false},{uid:'else',email:emails[0],emailVerified:true}]) assert.equal(gate(profile,identity),false);
 for(const email of emails) assert.equal(gate({uid:'me',email:'forged@example.com',role:'player'},{uid:'me',email:email.toUpperCase(),emailVerified:true}),true);
 assert.equal(gate(profile,{uid:'me',email:emails[0]}),false);
});
test('direct GOD endpoint rejects anonymous, unverified and non-designated callers before reading cards',async()=>{
 const {godPeek}=require('../functions/pokerEngine');
 for(const auth of [undefined,{uid:'x',token:{}},{uid:'x',token:{email:emails[0],email_verified:false}},{uid:'x',token:{email:emails[0]}},{uid:'x',token:{email:'other@example.com',email_verified:true,role:'superadmin',god:true}}]) {
  await assert.rejects(godPeek.run({auth,data:{tableId:'test'}}),e=>['unauthenticated','permission-denied'].includes(e.code));
 }
});

test('each table GOD account passes the server check for a PLO7 snapshot',async()=>{
 const {createCallable,godCardContext}=require('../functions/godPeek');
 const engine=fs.readFileSync(require.resolve('../functions/pokerEngine'),'utf8');
 const guard=vm.runInNewContext(engine.match(/const GOD_EMAILS = [^;]+;/)[0]+engine.match(/const isGodAuth = [^;]+;/)[0]+'isGodAuth');
 const hand=['2','3','4','5','6','7','8'].map(val=>({val,suit:'♦'}));
 const board=['9','10','J','Q','K'].map(val=>({val,suit:'♣'}));
 const table={gameState:{phase:'river',currentGameType:'Omaha 7',board},players:{a:{cardCount:7}}};
 const ref={collection:()=>ref,doc:()=>ref};
 const snap=data=>({exists:true,data:()=>data});
 const db=()=>({...ref,runTransaction:fn=>fn({get:async()=>snap(table),getAll:async()=>[snap({deck:[]}),snap({cards:hand})]})});
 const peek=createCallable({onCall:(_,fn)=>fn,HttpsError:Error,db,isGodAuth:guard,CALL_OPTS:{}});
 for(const email of emails){
  const result=await peek({auth:{uid:'observer',token:{email,email_verified:true}},data:{tableId:'plo7',contextKey:godCardContext(table)}});
  assert.deepEqual(result.hands.a,hand,email);
  assert.deepEqual(result.finalBoard,board,email);
 }
});
