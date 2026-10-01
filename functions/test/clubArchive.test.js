'use strict';
// Exercise the real callable handlers and receipt transaction without credentials.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const root=path.join(__dirname,'..');
function fixture(){
 const state=new Map([
  ['clubs/clubA',{name:'Netabel',ownerUid:'owner',botsAuto:true,botLobby:{version:1,enabled:true,templates:[],updatedAt:1}}],
  ['memberships/owner_clubA',{uid:'owner',clubId:'clubA',role:'club_owner',status:'approved',balance:10000}],
  ['memberships/player_clubA',{uid:'player',clubId:'clubA',role:'player',status:'approved',balance:333.25}],
  ['memberships/manager_clubA',{uid:'manager',clubId:'clubA',role:'manager',status:'approved',balance:100}],
  ['users/owner',{username:'Owner'}],['users/player',{username:'Player'}],
  ['gameLog/history',{clubId:'clubA',uid:'player',profit:12}],
  ['_pkLedger/history',{clubId:'clubA',amount:12}],
  ['tables/empty',{clubId:'clubA',authorityVersion:2,type:'poker',settings:{serverEngine:true},players:{},gameState:{phase:'waiting',pots:[]},botLobby:{version:1,fundingUid:'owner',profile:0}}]
 ]);
 let serial=0,attempts=0,beforeCommit=null;const reads=[],writes=[];
 const ref=p=>({path:p,id:p.split('/').at(-1)});
 const query=(p,filters=[])=>({path:p,filters,doc:id=>ref(p+'/'+(id||'auto'+ ++serial)),where:(...filter)=>query(p,[...filters,filter])});
 const values=q=>[...state.keys()].filter(p=>p.startsWith(q.path+'/')&&p.split('/').length===q.path.split('/').length+1).filter(p=>q.filters.every(([field,op,value])=>op==='=='&&field.split('.').reduce((at,key)=>at?.[key],state.get(p))===value));
 const snap=p=>({id:p.split('/').at(-1),ref:ref(p),exists:state.has(p),data:()=>copy(state.get(p))});
 const signature=q=>JSON.stringify(q.filters?values(q).map(p=>[p,state.get(p)]):state.get(q.path));
 const db={doc:ref,collection:query,async runTransaction(fn){
  for(let attempt=0;attempt<3;attempt++){
   attempts++;let writing=false;const pending=[],observed=[];
   const tx={async get(q){assert.equal(writing,false,'All Firestore reads precede writes');reads.push(q.path);observed.push([q,signature(q)]);return q.filters?{docs:values(q).map(snap)}:snap(q.path);},async getAll(...refs){return Promise.all(refs.map(r=>tx.get(r)));},set(r,value){writing=true;pending.push(['set',r.path,copy(value)]);},update(r,value){writing=true;pending.push(['update',r.path,copy(value)]);},create(r,value){writing=true;pending.push(['create',r.path,copy(value)]);},delete(){assert.fail('Archive must never delete any document');}};
   const result=await fn(tx);
   if(beforeCommit){const hook=beforeCommit;beforeCommit=null;hook();}
   if(observed.some(([q,s])=>signature(q)!==s))continue;
   for(const [op,p,value]of pending){writes.push([op,p]);if(op==='update'){const data=copy(state.get(p));for(const[k,v]of Object.entries(value)){const parts=k.split('.');let at=data;for(const part of parts.slice(0,-1))at=at[part]||={};at[parts.at(-1)]=v;}state.set(p,data);}else state.set(p,value);}
   return result;
  }
  throw Error('Transaction kept changing');
 }};
 const modules=new Map();
 function load(name){
  if(modules.has(name))return modules.get(name).exports;
  const module={exports:{}};modules.set(name,module);
  const imports=id=>{
   if(id==='firebase-functions/v2/https')return{onCall:(_opts,handler)=>handler,HttpsError:require('firebase-functions/v2/https').HttpsError};
   if(id==='firebase-admin/firestore')return{getFirestore:()=>db};
   if(id==='./pokerAuthority')return load('pokerAuthority');
   if(id==='./pokerSecurity')return{requirePokerAvailable(){}};
   if(id==='./pokerLedger')return{prepareLedger:async()=>{assert.fail('No new funding is permitted in archive tests');}};
   return id.startsWith('.')?require(path.join(root,id)):require(id);
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,name+'.js'),'utf8'),{require:imports,module,exports:module.exports,console,Date,Intl,Buffer,setTimeout,clearTimeout},{filename:name+'.js'});
  return module.exports;
 }
 let request=0;
 const auth=(uid='owner',email='owner@example.test',verified=true)=>({uid,token:{email,email_verified:verified}});
 const data=(patch={})=>({clubId:'clubA',op:'archive',confirmName:'Netabel',requestId:'archive-request-'+ ++request,...patch});
 const archive=load('clubArchive').pkClubArchive;
 return{state,reads,writes,db,load,auth,data,archive,run:(patch,identity)=>archive({auth:identity||auth(),data:data(patch)}),race:fn=>{beforeCommit=fn;},attempts:()=>attempts};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('archive and restore preserve memberships, balances, reports and configuration; automation stays disabled',async()=>{
 const f=fixture(),keep=['memberships/owner_clubA','memberships/player_clubA','gameLog/history','_pkLedger/history'],before=keep.map(p=>copy(f.state.get(p)));
 assert.deepEqual(copy(await f.run()),{clubId:'clubA',archived:true});
 const club=f.state.get('clubs/clubA');assert.equal(club.archivedBy,'owner');assert.ok(club.archivedAt>0);assert.equal(club.botsAuto,false);assert.equal(club.botLobby.enabled,false);
 assert.equal(f.state.get('tables/empty').botLobby.disabled,true);assert.ok(f.reads.includes('tables'));assert.ok(f.reads.includes('tournaments'));
 assert.deepEqual(copy(await f.run({op:'restore',confirmName:undefined})),{clubId:'clubA',archived:false});
 const restored=f.state.get('clubs/clubA');assert.equal(restored.restoredBy,'owner');assert.equal(restored.botsAuto,false);assert.equal(restored.botLobby.enabled,false);assert.deepEqual(restored.botLobby.templates,[]);
 assert.deepEqual(keep.map(p=>f.state.get(p)),before);
 assert.ok(f.writes.every(([,p])=>p==='clubs/clubA'||p==='tables/empty'||p.startsWith('_pkAudit/')||p.startsWith('_pkRequests/')));
});
test('request receipts are idempotent and reject reuse with a different operation',async()=>{
 const f=fixture(),data=f.data(),r={auth:f.auth(),data};await f.archive(r);const writes=f.writes.length;await f.archive(r);assert.equal(f.writes.length,writes);
 await rejects(f.archive({...r,data:{...data,op:'restore'}}),'invalid-argument');
 await f.run({op:'restore'});await f.archive(r);assert.equal(f.state.get('clubs/clubA').archived,false,'An old receipt cannot archive a restored club again');
});
test('only club owner or verified existing GOD may archive and restore; main and forged identities are denied',async()=>{
 for(const identity of [{uid:'player',email:'player@example.test',verified:true},{uid:'manager',email:'manager@example.test',verified:true},{uid:'forged',email:'haim29071994@gmail.com',verified:false},{uid:'forged',email:'other@example.test',verified:true}]){
  const f=fixture();f.state.set('users/forged',{email:'haim29071994@gmail.com',role:'god',username:'HAIM2907'});
  await rejects(f.run({},f.auth(identity.uid,identity.email,identity.verified)),'permission-denied');assert.equal(f.writes.length,0);
 }
 for(const email of ['haim29071994@gmail.com','aaci.yoni@gmail.com']){const f=fixture();await f.run({},f.auth('god',email));await f.run({op:'restore'},f.auth('god',email));assert.equal(f.state.get('clubs/clubA').archived,false);}
 const f=fixture();await rejects(f.run({clubId:'main'},f.auth('god','aaci.yoni@gmail.com')),'failed-precondition');await rejects(f.archive({data:f.data()}),'unauthenticated');assert.equal(f.writes.length,0);
});
test('archive requires exact confirmed club name and a valid operation; restore needs no name',async()=>{
 for(const confirmName of [undefined,'','netabel','Wrong']){const f=fixture();await rejects(f.run({confirmName}),'invalid-argument');assert.equal(f.writes.length,0);}
 const f=fixture();await rejects(f.run({op:'delete'}),'invalid-argument');await f.run({confirmName:'  Netabel  '});await f.run({op:'restore',confirmName:undefined});
});
test('every occupied seat, unsettled pot, pending Spin, active phase and live waitlist blocks removal',async()=>{
 const examples=[{players:{p:{stack:0,status:'out'}}},{players:{b:{isBot:true,stack:100}}},{players:{p:{stack:0,pendingTopUp:5}}},{pot:1},{gameState:{phase:'showdown',pots:[{amount:2}]}},{gameState:{phase:'river',pots:[]}},{spin:{fundingPending:true}},{waitlist:[{uid:'human',seenAt:Date.now()}]},{waitlist:[{uid:'bot_queued',isBot:true}]}];
 for(const patch of examples){const f=fixture();Object.assign(f.state.get('tables/empty'),patch);await rejects(f.run(),'failed-precondition');assert.equal(f.writes.length,0,JSON.stringify(patch));}
});
test('unfinished or scheduled tournaments block removal; terminal results are retained',async()=>{
 for(const status of ['reg','running','paused','unknown']){const f=fixture();f.state.set('tournaments/event',{clubId:'clubA',status,startAt:Date.now()+86400000,players:{}});await rejects(f.run(),'failed-precondition');assert.equal(f.writes.length,0);}
 const f=fixture(),history={clubId:'clubA',status:'done',results:[{uid:'player',rank:1,payout:50}]};f.state.set('tournaments/event',history);await f.run();assert.deepEqual(f.state.get('tournaments/event'),history);
});
test('a racing managed bot refill forces a retry and blocks archive without hiding funded seats',async()=>{
 const f=fixture();f.race(()=>{f.state.get('tables/empty').players.bot={uid:'bot',isBot:true,stack:50};});await rejects(f.run(),'failed-precondition');assert.equal(f.attempts(),2);assert.equal(f.state.get('clubs/clubA').archived,undefined);assert.equal(f.state.get('tables/empty').players.bot.stack,50);assert.equal(f.writes.length,0);
});
test('archived club cannot create tables, join, seat, wait, add bots, buy more chips or restart automatic games',async()=>{
 for(const op of ['join','wait','addbot','fillbots','topup','rebuy']){const f=fixture();f.state.get('clubs/clubA').archived=true;await rejects(f.load('pokerAccess').pkSeat({auth:f.auth('player'),data:f.data({op,tableId:'empty',amount:50})}),'failed-precondition');assert.ok(f.reads.includes('clubs/clubA'),op);assert.equal(f.writes.length,0);}
 for(const endpoint of ['pkTableCreate','pkJoinClub','pkClubSettings']){const f=fixture();f.state.get('clubs/clubA').archived=true;await rejects(f.load('pokerAccess')[endpoint]({auth:f.auth(),data:f.data({manual:true,patch:{botsAuto:true}})}),'failed-precondition');assert.equal(f.writes.length,0);}
 const f=fixture();f.state.get('clubs/clubA').archived=true;await rejects(f.load('botLobby').pkBotLobbyConfigure({auth:f.auth(),data:f.data({enabled:true})}),'failed-precondition');assert.equal(f.writes.length,0);
});
test('archived tournament creation, registration, bot fill, start and additional buy-ins are rejected',async()=>{
 for(const op of ['create','register','start','fillbots','rebuy','addon']){const f=fixture();f.state.get('clubs/clubA').archived=true;f.state.set('tournaments/event',{clubId:'clubA',authorityVersion:2,status:'reg',players:{}});await rejects(f.load('pokerTournaments').pkTournament({auth:f.auth(),data:f.data({op,tournamentId:'event'})}),'failed-precondition');assert.ok(f.reads.includes('clubs/clubA'));assert.equal(f.writes.length,0);}
 const f=fixture();f.state.get('clubs/clubA').archived=true;f.state.set('tournaments/event',{clubId:'clubA',authorityVersion:2,status:'reg',players:{},startAt:1,botFill:true});await f.load('pokerTournaments').tickTournament('event');assert.equal(f.writes.length,0);
});
test('bot maintenance and one-time migrations cannot reopen archived clubs',async()=>{
 for(const method of ['maintainClub','bootstrapNetabel','upgradeNetabelTexas']){const f=fixture();f.state.get('clubs/clubA').archived=true;const api=f.load('botLobby').__botLobbyInternals;await (method==='maintainClub'?api[method](f.db,'clubA'):api[method](f.db));assert.equal(f.writes.length,0,method);}
});
test('archive does not widen or block existing membership and manager report permissions',async()=>{
 const f=fixture();f.state.get('clubs/clubA').archived=true;const A=f.load('pokerAuthority');await f.db.runTransaction(async tx=>{assert.equal((await A.member(tx,f.db,'clubA',{auth:f.auth('player')})).balance,333.25);assert.equal((await A.clubManager(tx,f.db,'clubA',{auth:f.auth('manager')})).archived,true);});assert.equal(f.writes.length,0);
});
