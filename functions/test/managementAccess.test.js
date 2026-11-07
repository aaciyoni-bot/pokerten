'use strict';
const {identities}=require('../../tests/god-session-fixture.cjs');
// Verify the real UI predicates and callable permission boundary together.
// No Firebase credentials or production reads/writes are used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const A=require('../pokerAuthority');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const profileSource=fs.readFileSync(path.join(__dirname,'../pokerProfile.js'),'utf8');
const SUPERVISOR_A=identities.supervisors[0],SUPERVISOR_B=identities.supervisors[1];
function ui(auth){
 const window={fb:{auth:{currentUser:auth}}};
 window.fb.viewerGrant=require('../../tests/god-session-fixture.cjs').grantFor(auth);
 const definitions=['ROLES'].map(name=>{
  const match=html.match(new RegExp('const '+name+' = [\\s\\S]*?;'));
  assert(match,'Missing declaration: '+name);return match[0];
 }).join('\n');
 const predicates=html.slice(html.indexOf('const isGodUser ='),html.indexOf('const buyInMin ='));
 const context={window};
 vm.runInNewContext(definitions+'\n'+predicates+'\nthis.access={isGodUser,isClubOversightUser,canManageClub,canOpenBackoffice};',context);
 return context.access;
}
const user={uid:'supervisorA-auth-uid',role:'player',status:'pending'};
const auth=(email=SUPERVISOR_A,verified=true)=>({uid:user.uid,email,emailVerified:verified});
const requestAuth=(email=SUPERVISOR_A,verified=true)=>({uid:user.uid,token:{email,email_verified:verified}});

for(const [i,email] of [SUPERVISOR_A,SUPERVISOR_B].entries())test('Verified supervisor '+(i+1)+' can open management despite a stale player/pending membership role',()=>{
 const access=ui(auth(email));
 assert.equal(access.isGodUser(user),true);
 assert.equal(access.isClubOversightUser(user),true);
 assert.equal(access.canManageClub(user),true);
 assert.equal(access.canOpenBackoffice(user),true);
 assert.equal(A.root({auth:requestAuth(email)}),true,'Server recognizes the same oversight identity');
});
test('management does not depend on a username, profile email or another signed-in UID',()=>{
 for(const identity of [auth('someone@example.test'),auth(SUPERVISOR_A,false),auth(SUPERVISOR_B,false),{...auth(SUPERVISOR_B),uid:'different-uid'},null]){
  const access=ui(identity),forged={...user,username:'SUPERVISOR01',email:SUPERVISOR_A};
  assert.equal(access.isClubOversightUser(forged),false);
  assert.equal(access.canManageClub(forged),false);
  assert.equal(access.canOpenBackoffice(forged),false);
 }
});
test('only the designated server root allowlist gets identity-based management access',()=>{
 for(const email of [SUPERVISOR_A,SUPERVISOR_B,identities.owner,identities.observer,'stranger@example.test']){
  const access=ui(auth(email));
  assert.equal(access.isClubOversightUser(user),A.root({auth:requestAuth(email)}),email);
 }
 assert.equal(ui(auth(('  '+identities.supervisors[0].toUpperCase()+' '))).isClubOversightUser(user),true);
 assert.equal(ui(auth(identities.supervisors[1].toUpperCase())).isClubOversightUser(user),true);
});
test('club manager and agent scopes remain distinct; pending/banned members get neither entry',()=>{
 const access=ui(auth('ordinary@example.test'));
 assert.equal(access.canManageClub({...user,status:'approved',role:'manager'}),true);
 assert.equal(access.canOpenBackoffice({...user,status:'approved',role:'agent'}),true);
 assert.equal(access.canManageClub({...user,status:'approved',role:'agent'}),false);
 for(const status of ['pending','banned'])for(const role of ['player','agent','manager']){
  assert.equal(access.canOpenBackoffice({...user,status,role}),false);
 }
});

function directoryFixture(){
 const reads=[];
 const members=[{uid:'owner',clubId:'clubA',status:'approved',role:'club_owner'},
  {uid:'alice',clubId:'clubA',status:'approved',role:'player',agentUid:'agentA'},
  {uid:'bob',clubId:'clubA',status:'approved',role:'player',agentUid:'agentB'}];
 const gameLog=[{uid:'alice',clubId:'clubA',profit:10},{uid:'bob',clubId:'clubA',profit:-10}];
 class Query{constructor(name,filters=[]){Object.assign(this,{name,filters});}where(...filter){return new Query(this.name,[...this.filters,filter]);}}
 const tx={async get(ref){
  reads.push(ref);
  if(ref.path){const value=ref.path==='clubs/clubA'?{ownerUid:'owner'}:null;return{exists:!!value,data:()=>value};}
  const rows=ref.name==='memberships'?members:ref.name==='gameLog'?gameLog:[];
  return{docs:rows.filter(value=>ref.filters.every(([key,op,expected])=>op==='=='&&value[key]===expected)).map((value,i)=>({id:String(i),data:()=>value}))};
 },set(){assert.fail('Management report must not write');},update(){assert.fail('Management report must not write');}};
 const db={doc:path=>({path}),collection:name=>new Query(name),runTransaction:fn=>fn(tx)};
 const context={exports:{},require:name=>name==='firebase-functions/v2/https'?{onCall:(_,handler)=>handler}:name==='./pokerAuthority'?A:name==='./pokerAccounting'?require('../pokerAccounting'):name==='firebase-admin/firestore'?{getFirestore:()=>db}:(()=>{throw Error('Unexpected module '+name);})(),Date,Intl,console};
 vm.runInNewContext(profileSource,context);
 return{run:auth=>context.exports.pkClubDirectory({auth,data:{clubId:'clubA',includeReports:true}}),reads};
}
for(const [i,email] of [SUPERVISOR_A,SUPERVISOR_B].entries())test('Server lets verified supervisor '+(i+1)+' see all club results without creating a membership',async()=>{
 const fixture=directoryFixture(),result=await fixture.run(requestAuth(email));
 assert.deepEqual(Array.from(result.gameLog,row=>row.uid),['alice','bob']);
 assert.equal(result.members.length,3);
 assert.equal(fixture.reads.filter(ref=>ref.name==='gameLog').length,1);
});
test('an unverified or different identity cannot reuse SUPERVISOR_A management report access',async()=>{
 for(const identity of [requestAuth(SUPERVISOR_A,false),requestAuth(SUPERVISOR_B,false),requestAuth('someone@example.test')]){
  const fixture=directoryFixture();
  await assert.rejects(fixture.run(identity),error=>error.code==='permission-denied');
  assert.equal(fixture.reads.some(ref=>ref.name==='gameLog'),false);
 }
});
