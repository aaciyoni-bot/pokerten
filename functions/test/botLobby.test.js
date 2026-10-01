'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../botLobby'),I=B.__botLobbyInternals,E=require('../pokerEngine').__engineInternals;
const settings=require('../pokerAccess').__accessInternals.tableSettings({baseGameType:'Omaha 6',blinds:.5,minBuyIn:50,maxBuyIn:100,maxPlayers:6});
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(balance=3000){
 const state=new Map([['clubs/netabel',{ownerUid:'owner',botsAuto:true,botLobby:{version:1,enabled:true,templates:[settings],updatedAt:1}}],['memberships/owner_netabel',{balance}]]);let auto=0;
 const ref=path=>({path,id:path.split('/').at(-1),collection:name=>collection(path+'/'+name)});
 const snapshot=path=>({id:path.split('/').at(-1),ref:ref(path),exists:state.has(path),data:()=>copy(state.get(path))});
 const collection=path=>({path,doc:id=>ref(path+'/'+(id||'auto'+(++auto))),where:(field,op,value)=>({path,field,op,value})});
 const db={doc:ref,collection,runTransaction:async fn=>{
  const writes=[];let writing=false;
  const tx={delete:r=>{writing=true;writes.push(()=>state.delete(r.path));},get:async target=>{assert.equal(writing,false,'Firestore reads must precede writes');if(target.field||typeof target.doc==='function')return{docs:[...state.keys()].filter(k=>k.startsWith(target.path+'/')&&k.split('/').length===target.path.split('/').length+1).filter(k=>!target.field||target.field.split('.').reduce((o,key)=>o?.[key],state.get(k))===target.value).map(snapshot)};return snapshot(target.path);},getAll:async(...refs)=>Promise.all(refs.map(r=>tx.get(r))),set:(r,d)=>{writing=true;writes.push(()=>state.set(r.path,copy(d)));},create:(r,d)=>{writing=true;writes.push(()=>{assert.equal(state.has(r.path),false,'No duplicate table');state.set(r.path,copy(d));});},update:(r,patch)=>{writing=true;writes.push(()=>{const data=copy(state.get(r.path));for(const[k,v]of Object.entries(patch)){const parts=k.split('.');let at=data;for(const key of parts.slice(0,-1))at=at[key]||=( {} );at[parts.at(-1)]=copy(v);}state.set(r.path,data);});}};
  const result=await fn(tx);for(const write of writes)write();return result;
 }};
 return{db,state,tables:()=>[...state.entries()].filter(([p])=>p.startsWith('tables/')).map(([path,t])=>({path,...t}))};
}
function S(profile=0){
 const raw=I.makeTable('netabel','owner',settings,profile,'testtable',1000,1);
 return{id:'testtable',raw:copy(raw),settings:raw.settings,players:raw.players,gameState:raw.gameState,table:{clubId:'netabel'},priv:{},effects:[],now:2000000};
}

function callable(f,name){
 const fs=require('node:fs'),vm=require('node:vm'),createRequire=require('node:module').createRequire;
 const file=require.resolve(name==='pkBotLobbyConfigure'?'../botLobby':'../pokerAccess'),localRequire=createRequire(file),authority=localRequire('./pokerAuthority'),module={exports:{}};let now=20000;
 const requireMock=id=>id==='firebase-functions/v2/https'?{onCall:(_options,handler)=>handler}:id==='./pokerSecurity'?{requirePokerAvailable:()=>{}}:id==='./pokerAuthority'?{...authority,command:async(request,_action,fn)=>f.db.runTransaction(tx=>fn(tx,f.db,authority.uid(request),now++))}:localRequire(id);
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:requireMock,console,Buffer},{filename:file});
 return module.exports[name];
}
const auth=(uid='owner')=>({uid,token:{email:uid+'@example.test',email_verified:true}});
const sponsoredChips=f=>Math.round((f.state.get('memberships/owner_netabel').balance+f.tables().reduce((sum,t)=>sum+Object.values(t.players||{}).reduce((n,p)=>n+(p.stack||0)+(p.bet||0)+(p.pendingTopUp||0),0)+(t.gameState?.pots||[]).reduce((n,p)=>n+(p.amount||0),0),0))*100)/100;
function addExisting(f,id='existing',profile=0){const table=I.makeTable('netabel','owner',settings,profile,id,1000,1);f.state.set('tables/'+id,table);return table;}

test('old enabled pools never create tables even with funded slots and repeated scheduled passes',async()=>{
 const f=fixture(1000000),club=f.state.get('clubs/netabel');club.name='Netabel';
 club.botLobby.slots=[0,1,2].map(profile=>({id:'main-'+profile,profile,templates:[settings]}));
 const before=JSON.stringify([...f.state]);
 for(const now of [10000,20000,86400000,172800000]){
  assert.equal((await B.maintainBotLobbies(f.db,now)).manualOnly,true);
  assert.equal((await I.maintainClub(f.db,'netabel',now)).created,0);
 }
 assert.equal(f.tables().length,0);assert.equal(JSON.stringify([...f.state]),before);
});
test('bootstrap and old named-club upgrade entry points cannot opt in or reopen games',async()=>{
 for(const configured of [false,true]){
  const f=fixture();f.state.get('clubs/netabel').name='Netabel';if(!configured)delete f.state.get('clubs/netabel').botLobby;
  addExisting(f);const before=JSON.stringify([...f.state]);
  assert.equal((await I.bootstrapNetabel(f.db,10000)).reason,'manual-only');
  assert.equal((await I.upgradeNetabelTexas(f.db,10001)).reason,'manual-only');
  assert.equal(JSON.stringify([...f.state]),before);
 }
});
test('maintenance cannot adopt, retire or alter expired existing tables, active hands, human seats or queues',async()=>{
 const f=fixture(50000);
 for(const profile of [0,1,2]){const table=addExisting(f,'existing'+profile,profile);table.botLobby.rotateAt=1;}
 const human=f.state.get('tables/existing1');human.players.player={uid:'player',isBot:false,stack:42,seatIndex:5};human.gameState.phase='turn';
 f.state.get('tables/existing2').waitlist=[{uid:'human',name:'Human',at:1}];
 const manual=addExisting(f,'manual');delete manual.botLobby;manual.botLobbyExcluded=true;
 const before=JSON.stringify([...f.state]);
 await I.maintainClub(f.db,'netabel',999999999);await B.maintainBotLobbies(f.db,999999999);
 assert.equal(JSON.stringify([...f.state]),before);assert.ok(f.tables().every(t=>!t.closeRequested));
});
test('queued and completed manual deletions never receive automatic replacement; funded closure remains intact',async()=>{
 const f=fixture(10000),table=addExisting(f);table.gameState.phase='preflop';
 const before=sponsoredChips(f),manage=callable(f,'pkTableManage'),request={auth:auth(),data:{tableId:'existing',op:'delete'}};
 assert.equal((await manage(request)).queued,true);assert.ok(f.state.get('tables/existing').closeRequested);
 const closing=JSON.stringify([...f.state]);
 for(const now of [30000,40000,86400000]){await B.maintainBotLobbies(f.db,now);await I.maintainClub(f.db,'netabel',now);}
 assert.equal(JSON.stringify([...f.state]),closing);assert.equal(f.tables().length,1);
 f.state.get('tables/existing').gameState.phase='waiting';
 assert.equal((await manage(request)).deleted,true);assert.equal(f.tables().length,0);assert.equal(sponsoredChips(f),before);
 const closed=JSON.stringify([...f.state]);
 await B.maintainBotLobbies(f.db,172800000);await I.maintainClub(f.db,'netabel',172800000);
 assert.equal(JSON.stringify([...f.state]),closed);assert.equal(f.tables().length,0);assert.ok(f.state.has('_pkClosedTables/existing'));
});
test('stale clients cannot re-enable automatic pools; turning the old flag off preserves settings',async()=>{
 const f=fixture(),configure=callable(f,'pkBotLobbyConfigure'),old=copy(f.state.get('clubs/netabel').botLobby);
 for(const data of [{enabled:true},{enabled:true,templateTableIds:['existing']},{enabled:true,resumePaused:true}]){
  const before=JSON.stringify([...f.state]);await assert.rejects(configure({auth:auth(),data:{clubId:'netabel',...data}}),e=>e.code==='failed-precondition');assert.equal(JSON.stringify([...f.state]),before);
 }
 assert.equal((await configure({auth:auth(),data:{clubId:'netabel',enabled:false}})).manualOnly,true);
 const current=f.state.get('clubs/netabel').botLobby;assert.equal(current.enabled,false);assert.deepEqual(current.templates,old.templates);assert.equal(f.state.get('memberships/owner_netabel').balance,3000);
});
test('manual table opening preserves game choices, blinds, chip funding and duplicate-request behavior',async()=>{
 const f=fixture(10000),create=callable(f,'pkTableCreate'),before=sponsoredChips(f);
 for(const [index,game]of ['NLH','Omaha 4','Omaha 5','Omaha 6','Pineapple'].entries()){
  const blinds=[.5,1,2,.5,1][index],maxPlayers=game==='NLH'||game==='Omaha 6'?6:4;
  const request={auth:auth(),data:{manual:true,clubId:'netabel',requestId:'manual-game-'+index,settings:{baseGameType:game,blinds,minBuyIn:100*blinds,maxBuyIn:400*blinds,maxPlayers},botCount:'full',botLobby:{version:1},botLobbyExcluded:false}};
  const result=await create(request),table=f.state.get('tables/'+result.tableId);
  assert.equal(table.settings.baseGameType,game);assert.equal(table.settings.blinds,blinds);assert.equal(Object.keys(table.players).length,maxPlayers);assert.equal(table.botLobbyExcluded,true);assert.equal(table.botLobby,undefined);assert.equal(sponsoredChips(f),before);
  assert.equal((await create(request)).tableId,result.tableId);assert.equal(sponsoredChips(f),before);
 }
 assert.equal(f.tables().length,5);const count=f.tables().length;await B.maintainBotLobbies(f.db,900000000);assert.equal(f.tables().length,count);
});
test('manual opening still requires approved manager or owner authority and rejects archived clubs',async()=>{
 for(const scenario of ['anonymous','player','pending-manager','archived']){
  const f=fixture();f.state.set('memberships/player_netabel',{uid:'player',role:scenario==='pending-manager'?'manager':'player',status:scenario==='pending-manager'?'pending':'approved'});
  if(scenario==='archived')f.state.get('clubs/netabel').archived=true;
  const create=callable(f,'pkTableCreate'),before=JSON.stringify([...f.state]);
  const identity=scenario==='anonymous'?undefined:scenario==='archived'?auth():auth('player');
  await assert.rejects(create({auth:identity,data:{manual:true,clubId:'netabel',requestId:'manual-denied',settings,botCount:0}}),e=>e.code===(scenario==='anonymous'?'unauthenticated':scenario==='archived'?'failed-precondition':'permission-denied'));
  assert.equal(JSON.stringify([...f.state]),before);
 }
 const f=fixture();f.state.set('memberships/manager_netabel',{uid:'manager',role:'manager',status:'approved'});
 const result=await callable(f,'pkTableCreate')({auth:auth('manager'),data:{manual:true,clubId:'netabel',requestId:'manual-manager',settings,botCount:0}});assert.ok(result.tableId);assert.equal(f.tables().length,1);
});
test('real queued bot takes vacated seat only at settled hand boundary with funded chip conservation',async()=>{
 const s=S(),old=Object.values(s.players)[3],waiting=s.raw.waitlist[0];old.botLeavesAt=1;s.gameState.dealerUid=old.uid;
 const total=()=>Object.values(s.players).reduce((n,p)=>n+p.stack,0)+s.effects.filter(e=>e.type==='credit').reduce((n,e)=>n+e.amount,0);
 const before=total(),patch=await B.reconcileManagedSeats(s,E.removeSeat,async()=>1000);
 assert.equal(s.players[old.uid],undefined);assert.equal(s.players[waiting.uid].name,waiting.name);assert.equal(s.players[waiting.uid].seatIndex,old.seatIndex);assert.equal(s.gameState.dealerUid,waiting.uid);assert.equal(total(),before);assert.equal(patch.waitlist.length,2);assert.ok(!patch.waitlist.some(w=>w.uid===waiting.uid));assert.deepEqual(s.privateDeletes,[old.uid]);
});
test('active hands and unsettled pots cannot rotate or add seats',async()=>{
 for(const variant of ['turn','pot']){const s=S(),old=Object.values(s.players)[0];old.botLeavesAt=1;if(variant==='turn')s.gameState.phase='turn';else s.gameState.pots=[{amount:10}];const before=JSON.stringify(s);const patch=await B.reconcileManagedSeats(s,E.removeSeat,async()=>assert.fail('No funding read while hand active'));assert.deepEqual(patch,{});assert.equal(JSON.stringify(s),before);}
});
test('human waiting has priority over bot queue and receives a free seat without being autocharged',async()=>{
 const s=S();s.raw.waitlist.push({uid:'human',name:'Human',at:s.now, buyAmt:50});const patch=await B.reconcileManagedSeats(s,E.removeSeat,async()=>1000);
 assert.equal(Object.keys(s.players).length,5);assert.equal(patch.waitlist[0].uid,'human');assert.equal(s.players.human,undefined);assert.ok(s.effects.every(e=>e.uid==='owner'&&e.amount>=0));
});
test('a live human seated in a one-open-seat profile is never removed while one bot yields that vacancy',async()=>{
 const s=S(1),human={uid:'human',name:'Human',isBot:false,stack:57,seatIndex:5};s.players.human=human;s.raw.players=copy(s.players);
 await B.reconcileManagedSeats(s,E.removeSeat,async()=>1000);assert.equal(s.players.human,human);assert.equal(s.players.human.stack,57);assert.equal(Object.keys(s.players).length,5);assert.ok(s.effects.every(e=>e.uid==='owner'));
});

test('an authorized stale browser cannot use the former unmarked automatic-create request',async()=>{
 const f=fixture(10000),create=callable(f,'pkTableCreate'),before=JSON.stringify([...f.state]);
 for(const manual of [undefined,false,'true',1]){
  await assert.rejects(create({auth:auth(),data:{clubId:'netabel',requestId:'stale-auto-create',settings,botCount:0,...(manual===undefined?{}:{manual})}}),e=>e.code==='failed-precondition');
  assert.equal(JSON.stringify([...f.state]),before);
 }
});
