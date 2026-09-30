'use strict';
// Run the real pkClubMember callable, authority predicates and idempotent command
// through the actual Firestore transaction SDK. Only the RPC transport is fake;
// no credentials, production documents or hand-written transaction are used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const {Readable}=require('node:stream');
const {Firestore}=require('firebase-admin/firestore');
const accessPath=fs.realpathSync(path.join(__dirname,'../pokerAccess.js'));
const accessRequire=createRequire(accessPath);
const accessSource=fs.readFileSync(accessPath,'utf8');
const authoritySource=fs.readFileSync(accessRequire.resolve('./pokerAuthority'),'utf8');
const stamp={seconds:'1',nanos:0};
const identity=(uid='manager',email='manager@example.test',verified=true)=>({uid,token:{email,email_verified:verified}});
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(){
 const db=new Firestore({projectId:'demo-pokerten-member-approval',databaseId:'(default)'});
 const records=new Map([
  ['clubs/clubA',{ownerUid:'owner'}],
  ...[
   ['owner','club_owner','approved',1000],['manager','manager','approved',123.45],
   ['pending-manager','manager','pending',5],['banned-manager','manager','banned',6],
   ['agent','agent','approved',7],['player','player','approved',8],
   ['new-player','player','pending',42.37],['other-player','player','pending',3.21]
  ].map(([uid,role,status,balance])=>['memberships/'+uid+'_clubA',{
   uid,clubId:'clubA',username:uid,role,status,balance,clubProfits:11,agentProfits:12,
   bonusOpen:13,bonusTotal:14,...(uid==='agent'?{agentSharePct:35}:{}),
  }]),
  ['users/new-player',{username:'New player',balance:987.65}],
  ['tables/active',{clubId:'clubA',players:{'new-player':{stack:55.25}}}],
  ['gameLog/existing',{clubId:'clubA',uid:'new-player',profit:12.5}],
 ]);
 const requests=[],commits=[];
 const proto=(p,data)=>({name:db.formattedName+'/documents/'+p,fields:db._serializer.encodeFields(data),createTime:stamp,updateTime:stamp});
 db.initializeIfNeeded=async()=>{};
 db.requestStream=async(method,bidirectional,request)=>{
  requests.push({method,request});
  assert.equal(method,'batchGetDocuments','Member approval only reads specific documents');
  return Readable.from(request.documents.map(name=>{
   const p=name.split('/documents/')[1],value=records.get(p);
   return{...(value?{found:proto(p,value)}:{missing:name}),readTime:stamp,transaction:Buffer.from('approval-transaction')};
  }),{objectMode:true});
 };
 db.request=async(method,request)=>{
  requests.push({method,request});
  if(method==='rollback')return{};
  assert.equal(method,'commit');
  const pending=new Map([...records].map(([p,v])=>[p,clone(v)]));
  for(const write of request.writes){
   assert.ok(write.update,'Unexpected delete or transformation');
   const p=write.update.name.split('/documents/')[1];
   const data=Object.fromEntries(Object.entries(write.update.fields||{}).map(([key,value])=>[key,db._serializer.decodeValue(value)]));
   if(write.currentDocument?.exists)assert.ok(pending.has(p),'Update requires an existing member');
   if(write.updateMask){
    const value=pending.get(p)||{};
    for(const field of write.updateMask.fieldPaths){assert.equal(field.includes('.'),false);value[field]=data[field];}
    pending.set(p,value);
   }else pending.set(p,data);
  }
  records.clear();for(const [p,v]of pending)records.set(p,v);
  commits.push(clone(request.writes));
  return{commitTime:stamp,writeResults:request.writes.map(()=>({updateTime:stamp}))};
 };
 const authority={exports:{}};
 new Function('require','module','exports',authoritySource)(name=>name==='firebase-admin/firestore'?{getFirestore:()=>db}:accessRequire(name),authority,authority.exports);
 const exports={};
 new Function('require','exports',accessSource)(name=>name==='./pokerAuthority'?authority.exports:accessRequire(name),exports);
 const all=()=>clone([...records]);
 const protectedState=()=>[...records].filter(([p])=>!p.startsWith('_pk')).map(([p,v])=>{
  const item=clone(v);if(p.startsWith('memberships/'))for(const key of ['status','agentUid','agentPct'])delete item[key];
  return[p,item];
 });
 const protectedBefore=protectedState();
 return{
  run:(data={},auth=identity())=>exports.pkClubMember.run({auth,data:{clubId:'clubA',targetUid:'new-player',op:'approve',requestId:'approval_request_0001',...data}}),
  records,requests,commits,all,
  audit:()=>[...records].filter(([p])=>p.startsWith('_pkAudit/')).map(([,v])=>v),
  assertBalancesUntouched:()=>assert.deepEqual(protectedState(),protectedBefore),
 };
}

test('approved manager and verified HAIM can approve and reject pending members using the real callable',async()=>{
 for(const auth of [identity(),identity('haim','haim29071994@gmail.com')])for(const op of ['approve','reject']){
  const f=fixture();
  assert.deepEqual(await f.run({op},auth),{ok:true});
  assert.equal(f.records.get('memberships/new-player_clubA').status,op==='approve'?'approved':'rejected');
  assert.equal(f.audit().length,1);
  assert.deepEqual({...f.audit()[0],at:0},{clubId:'clubA',uid:auth.uid,targetUid:'new-player',at:0,action:'member-'+op});
  assert.equal(f.records.has('memberships/haim_clubA'),false,'Oversight does not create or impersonate a manager membership');
  assert.equal(f.commits.length,1);
  assert.ok(f.requests[0].request.newTransaction.readWrite,'The actual SDK starts a write transaction');
  f.assertBalancesUntouched();
 }
});

test('approval attaches only a valid approved agent and copies its configured percentage without moving chips',async()=>{
 const f=fixture();await f.run({agentUid:'agent'});
 const m=f.records.get('memberships/new-player_clubA');
 assert.equal(m.status,'approved');assert.equal(m.agentUid,'agent');assert.equal(m.agentPct,35);
 f.assertBalancesUntouched();
 for(const agentUid of ['new-player','missing','pending-manager','banned-manager','player']){
  const invalid=fixture(),before=invalid.all();
  await assert.rejects(invalid.run({agentUid}),e=>['failed-precondition','invalid-argument'].includes(e.code));
  assert.deepEqual(invalid.all(),before);assert.equal(invalid.commits.length,0);
 }
});

test('pending/banned managers, agents, players and unverified/forged oversight cannot approve or reject',async()=>{
 for(const auth of [
  identity('pending-manager'),identity('banned-manager'),identity('agent'),identity('player'),
  identity('haim','haim29071994@gmail.com',false),
  {...identity('outsider','ordinary@example.test'),email:'haim29071994@gmail.com',role:'super_admin'},null,
 ])for(const op of ['approve','reject']){
  const f=fixture(),before=f.all();
  await assert.rejects(f.run({op,email:'haim29071994@gmail.com',role:'manager'},auth),e=>e.code===(auth?'permission-denied':'unauthenticated'));
  assert.deepEqual(f.all(),before);assert.equal(f.commits.length,0);assert.equal(f.audit().length,0);
 }
});

test('retrying the same request returns its receipt without a second audit, and altered replay is rejected',async()=>{
 const f=fixture(),result=await f.run({agentUid:'agent'}),after=f.all();
 assert.deepEqual(await f.run({agentUid:'agent'}),result);
 assert.deepEqual(f.all(),after);assert.equal(f.audit().length,1);
 assert.equal(f.commits.filter(writes=>writes.length>0).length,1,'Replay may commit an empty transaction but cannot write again');
 await assert.rejects(f.run({op:'reject',agentUid:'agent'}),e=>e.code==='invalid-argument');
 assert.deepEqual(f.all(),after);assert.equal(f.audit().length,1);
 f.assertBalancesUntouched();
});
