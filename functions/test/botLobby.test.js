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
  const tx={get:async target=>{assert.equal(writing,false,'Firestore reads must precede writes');if(target.field)return{docs:[...state.keys()].filter(k=>k.startsWith(target.path+'/')&&k.split('/').length===target.path.split('/').length+1).filter(k=>target.field.split('.').reduce((o,key)=>o?.[key],state.get(k))===target.value).map(snapshot)};return snapshot(target.path);},getAll:async(...refs)=>Promise.all(refs.map(r=>tx.get(r))),set:(r,d)=>{writing=true;writes.push(()=>state.set(r.path,copy(d)));},create:(r,d)=>{writing=true;writes.push(()=>{assert.equal(state.has(r.path),false,'No duplicate table');state.set(r.path,copy(d));});},update:(r,patch)=>{writing=true;writes.push(()=>{const data=copy(state.get(r.path));for(const[k,v]of Object.entries(patch)){const parts=k.split('.');let at=data;for(const key of parts.slice(0,-1))at=at[key]||=( {} );at[parts.at(-1)]=copy(v);}state.set(r.path,data);});}};
  const result=await fn(tx);for(const write of writes)write();return result;
 }};
 return{db,state,tables:()=>[...state.entries()].filter(([p])=>p.startsWith('tables/')).map(([path,t])=>({path,...t}))};
}
function S(profile=0){
 const raw=I.makeTable('netabel','owner',settings,profile,'testtable',1000,1);
 return{id:'testtable',raw:copy(raw),settings:raw.settings,players:raw.players,gameState:raw.gameState,table:{clubId:'netabel'},priv:{},effects:[],now:2000000};
}
test('explicit opt-in creates funded 6/5/4 profiles once, with two genuine queued bot entries on full table',async()=>{
 const f=fixture();assert.equal((await I.maintainClub(f.db,'netabel',10000)).created,3);
 assert.deepEqual(f.tables().map(t=>Object.keys(t.players).length),[6,5,4]);
 assert.equal(f.state.get('memberships/owner_netabel').balance,1500);
 const full=f.tables()[0];assert.equal(full.waitlist.length,2);assert.ok(full.waitlist.every(w=>w.isBot&&w.uid.startsWith('bot_')));
 assert.equal(new Set([...Object.keys(full.players),...full.waitlist.map(w=>w.uid)]).size,8);
 assert.equal((await I.maintainClub(f.db,'netabel',10001)).created,0);assert.equal(f.tables().length,3);assert.equal(f.state.get('memberships/owner_netabel').balance,1500);
});
test('clubs without explicit bot lobby opt-in are untouched',async()=>{
 const f=fixture();delete f.state.get('clubs/netabel').botLobby;
 assert.equal((await I.maintainClub(f.db,'netabel',10000)).created,0);assert.equal(f.tables().length,0);assert.equal(f.state.get('memberships/owner_netabel').balance,3000);
});
test('reuses matching existing bot-only cash tables instead of spending a second buy-in',async()=>{
 const f=fixture(0);
 for(const profile of [0,1,2]){const t=I.makeTable('netabel','owner',settings,profile,'existing'+profile,1000,1);delete t.botLobby;f.state.set('tables/existing'+profile,t);}
 const result=await I.maintainClub(f.db,'netabel',10000);assert.equal(result.created,0);assert.equal(result.fundingBlocked,false);assert.ok(f.tables().every(t=>t.botLobby.version===1));assert.equal(f.state.get('memberships/owner_netabel').balance,0);
});
test('overdue table renewals are staggered by ten minutes while each closing hand stays intact',async()=>{
 const f=fixture(10000);await I.maintainClub(f.db,'netabel',10000);
 const old=f.tables();for(const row of old){const t=f.state.get(row.path);t.botLobby.rotateAt=10001;t.gameState.phase='turn';t.gameState.pots=[{amount:10}];}
 await I.maintainClub(f.db,'netabel',10002);assert.equal(f.tables().length,4);
 const closing=f.tables().filter(t=>t.closeRequested);assert.equal(closing.length,1);
 for(const row of old){const t=f.state.get(row.path);assert.equal(t.gameState.phase,'turn');assert.deepEqual(t.gameState.pots,[{amount:10}]);assert.equal(Object.keys(t.players).length,Object.keys(row.players).length);}
 const deadline=f.state.get('clubs/netabel').botLobby.nextTableRotationAt;
 assert.equal(deadline,10002+10*60000);
 await I.maintainClub(f.db,'netabel',deadline);assert.equal(f.tables().length,4,'No second retirement while the first hand has not closed');
 f.state.delete(closing[0].path); // existing engine completes its separately tested close path
 await I.maintainClub(f.db,'netabel',deadline-1);assert.equal(f.tables().length,3);assert.ok(f.tables().every(t=>!t.closeRequested));
 await I.maintainClub(f.db,'netabel',deadline);assert.equal(f.tables().length,4);assert.equal(f.tables().filter(t=>t.closeRequested).length,1);
});
test('whole-table lifetimes are independently varied between sixty and one hundred twenty minutes',()=>{
 const now=1234567,durations=new Set();
 for(let i=0;i<200;i++){const duration=I.expiry('table-'+i,now)-now;assert.ok(duration>=60*60000&&duration<=120*60000);durations.add(duration);}
 assert.ok(durations.size>40,'Not one synchronized lifetime for every table');
});
test('a missing availability profile is replenished immediately during the table-renewal cooldown',async()=>{
 const f=fixture(10000);await I.maintainClub(f.db,'netabel',10000);
 const missing=f.tables()[2];f.state.delete(missing.path);
 f.state.get('clubs/netabel').botLobby.nextTableRotationAt=9999999;
 for(const row of f.tables())f.state.get(row.path).botLobby.rotateAt=1;
 const result=await I.maintainClub(f.db,'netabel',10001);
 assert.equal(result.created,1);assert.deepEqual(f.tables().map(t=>t.botLobby.profile).sort(),[0,1,2]);
 assert.ok(f.tables().every(t=>!t.closeRequested));assert.equal(f.state.get('clubs/netabel').botLobby.nextTableRotationAt,9999999);
});
test('seated humans and human waitlists block automatic closure even after expiry',async()=>{
 const f=fixture(10000);await I.maintainClub(f.db,'netabel',10000);
 const old=f.tables();const seated=f.state.get(old[0].path),queued=f.state.get(old[1].path);
 seated.players.human={uid:'human',isBot:false,stack:42,seatIndex:7};queued.waitlist=[{uid:'waiter',name:'Player',at:1}];
 seated.botLobby.rotateAt=1;queued.botLobby.rotateAt=1;
 await I.maintainClub(f.db,'netabel',10001);assert.equal(f.state.get(old[0].path).closeRequested,undefined);assert.equal(f.state.get(old[1].path).closeRequested,undefined);assert.equal(f.state.get(old[0].path).players.human.stack,42);
});
test('low sponsor balance with fewer than three playable profiles cannot retire another table',async()=>{
 const f=fixture(1500);await I.maintainClub(f.db,'netabel',10000);
 for(const [index,row]of f.tables().entries()){const table=f.state.get(row.path);table.botLobby.rotateAt=1;if(index>0)for(const player of Object.values(table.players))player.stack=0;}
 const result=await I.maintainClub(f.db,'netabel',10001);assert.equal(result.fundingBlocked,true);assert.equal(f.tables().length,3);assert.ok(f.tables().every(t=>!t.closeRequested));assert.equal(f.state.get('memberships/owner_netabel').balance,0);
});
test('disabled pool stops creating, preserves human table, and requests safe closure only for bot-only games',async()=>{
 const f=fixture();await I.maintainClub(f.db,'netabel',10000);const rows=f.tables(),human=f.state.get(rows[0].path);human.players.player={uid:'player',isBot:false,stack:50};f.state.get('clubs/netabel').botLobby.enabled=false;
 await I.maintainClub(f.db,'netabel',10001);assert.equal(f.tables().length,3);assert.ok(f.tables().every(t=>t.botLobby.disabled));assert.equal(f.state.get(rows[0].path).closeRequested,undefined);assert.ok(f.state.get(rows[1].path).closeRequested);
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
function legacyNetabel(balance=0,count=3){
 const f=fixture(balance);const club=f.state.get('clubs/netabel');club.name='Netabel';delete club.botLobby;
 for(let i=0;i<count;i++){const table=I.makeTable('netabel','owner',settings,0,'legacy'+i,1000,1);delete table.botLobby;f.state.set('tables/legacy'+i,table);}
 return f;
}
test('one-time bootstrap is restricted to unique exact Netabel and records a release actor without issuing chips',async()=>{
 const f=legacyNetabel();const result=await I.bootstrapNetabel(f.db,10000);assert.equal(result.configured,true);assert.equal(result.clubId,'netabel');const config=f.state.get('clubs/netabel').botLobby;assert.equal(config.bootstrapRelease,'bot-lobby-netabel-2026-09-27');assert.equal(config.updatedBy,config.bootstrapRelease);assert.equal(f.state.get('memberships/owner_netabel').balance,0);assert.equal((await I.bootstrapNetabel(f.db,10001)).configured,false);
});
test('bootstrap does not opt in another club, ambiguous club name, explicit disabled config or disabled bots',async()=>{
 for(const scenario of ['other','duplicate','disabled','botsoff']){const f=legacyNetabel();if(scenario==='other')f.state.get('clubs/netabel').name='Other';if(scenario==='duplicate')f.state.set('clubs/duplicate',{name:'Netabel',ownerUid:'elsewhere'});if(scenario==='disabled')f.state.get('clubs/netabel').botLobby={version:1,enabled:false};if(scenario==='botsoff')f.state.get('clubs/netabel').botsAuto=false;const before=JSON.stringify([...f.state]);assert.equal((await I.bootstrapNetabel(f.db,10000)).configured,false,scenario);assert.equal(JSON.stringify([...f.state]),before,scenario);}
});
test('bootstrap refuses absent funding when missing profiles would require new buy-ins',async()=>{
 const f=legacyNetabel(0,1);assert.deepEqual(await I.bootstrapNetabel(f.db,10000),{configured:false,reason:'insufficient-existing-funds'});assert.equal(f.state.get('clubs/netabel').botLobby,undefined);assert.equal(f.tables().length,1);
});
test('existing full tables migrate to three profiles without new funding; surplus retires only once all vacancies exist',async()=>{
 const f=legacyNetabel(0,4);await I.bootstrapNetabel(f.db,10000);await I.maintainClub(f.db,'netabel',10001);
 assert.equal(f.tables().length,4);assert.equal(f.tables().filter(t=>t.botLobby).length,3);assert.ok(f.tables().every(t=>!t.closeRequested));
 for(const row of f.tables().filter(t=>t.botLobby)){
  // Engine takes one excess bot out at each completed-hand boundary.
  for(let hand=0;hand<row.botLobby.profile;hand++){
   const raw=copy(f.state.get(row.path));const s={id:row.path.split('/')[1],raw:copy(raw),settings:raw.settings,players:raw.players,gameState:raw.gameState,table:{clubId:'netabel'},priv:{},effects:[],now:10002+hand};
   const patch=await B.reconcileManagedSeats(s,E.removeSeat,async()=>0);f.state.set(row.path,{...raw,...patch,players:s.players,gameState:s.gameState});
  }
 }
 await I.maintainClub(f.db,'netabel',10010);assert.deepEqual(f.tables().filter(t=>t.botLobby).map(t=>Object.keys(t.players).length).sort(),[4,5,6]);assert.ok(f.state.get('tables/legacy3').closeRequested);assert.equal(f.state.get('memberships/owner_netabel').balance,0);
});
test('maintenance prunes expired human leases before retirement but preserves refreshed human waiting',async()=>{
 const f=fixture(10000);await I.maintainClub(f.db,'netabel',10000);const rows=f.tables();
 const expired=f.state.get(rows[0].path),fresh=f.state.get(rows[1].path);
 expired.waitlist.push({uid:'offline',name:'Offline',at:10001});expired.botLobby.rotateAt=1;
 fresh.waitlist=[{uid:'online',name:'Online',at:10001,seenAt:400000}];fresh.botLobby.rotateAt=1;
 await I.maintainClub(f.db,'netabel',400002);
 const retired=f.state.get(rows[0].path),held=f.state.get(rows[1].path);
 assert.ok(retired.closeRequested);assert.ok(!retired.waitlist.some(w=>w.uid==='offline'));assert.equal(retired.waitlist.filter(w=>w.isBot).length,2);
 assert.equal(held.closeRequested,undefined);assert.equal(held.waitlist[0].uid,'online');
});
test('low-reserve rotation closes only one expired table, preserves two playable profiles and waits for its refund',async()=>{
 const f=fixture(1500);await I.maintainClub(f.db,'netabel',10000);
 for(const row of f.tables())f.state.get(row.path).botLobby.rotateAt=1;
 await I.maintainClub(f.db,'netabel',10001);
 const closing=f.tables().filter(t=>t.closeRequested);assert.equal(closing.length,1);
 assert.equal(f.tables().filter(t=>!t.closeRequested&&I.healthyProfile(t,t.botLobby.profile,10001)).length,2);
 await I.maintainClub(f.db,'netabel',10002);
 assert.equal(f.tables().filter(t=>t.closeRequested).length,1,'No second closure while settlement/refund is pending');
 assert.equal(f.state.get('memberships/owner_netabel').balance,0);
 // Simulate the existing engine close: its ledger returns exactly the actual
 // remaining bot stacks; controller never returns or creates these chips.
 const old=closing[0],refund=Object.values(old.players).reduce((sum,p)=>sum+p.stack,0);
 f.state.delete(old.path);f.state.get('memberships/owner_netabel').balance=refund;
 await I.maintainClub(f.db,'netabel',10003);
 const restored=f.tables().filter(t=>t.botLobby.profile===old.botLobby.profile&&!t.closeRequested);
 assert.equal(restored.length,1,'Missing profile is replenished from the returned chips');
 assert.equal(f.tables().filter(t=>!t.closeRequested&&I.healthyProfile(t,t.botLobby.profile,10003)).length>=2,true);
 assert.equal(f.tables().filter(t=>t.closeRequested).length,0,'Refunded profile returns inside cooldown without retiring a second table');
 assert.equal(f.state.get('clubs/netabel').botLobby.nextTableRotationAt,10001+10*60000);
 assert.equal(f.state.get('memberships/owner_netabel').balance,0);
});
test('low-chip table is retained when its eventual refund cannot afford any replacement',async()=>{
 const f=fixture(1500);await I.maintainClub(f.db,'netabel',10000);
 const rows=f.tables(),candidate=f.state.get(rows[0].path);candidate.botLobby.rotateAt=1;
 for(const player of Object.values(candidate.players))player.stack=1;
 await I.maintainClub(f.db,'netabel',10001);
 assert.ok(f.tables().every(t=>!t.closeRequested));assert.equal(f.tables().length,3);
 assert.equal(f.state.get('clubs/netabel').botLobby.nextTableRotationAt,undefined,'An unfunded attempt does not start a rotation clock');
});
test('replenishment chooses an affordable configured template and precedes renewal of another expired profile',async()=>{
 const f=fixture(1500);await I.maintainClub(f.db,'netabel',10000);
 const rows=f.tables(),missing=rows[2];f.state.delete(missing.path);
 f.state.get('memberships/owner_netabel').balance=400;
 const expensive={...settings,minBuyIn:200,maxBuyIn:200};f.state.get('clubs/netabel').botLobby.templates=[expensive,settings];
 for(const row of f.tables())f.state.get(row.path).botLobby.rotateAt=1;
 await I.maintainClub(f.db,'netabel',10001);
 const replacement=f.tables().find(t=>t.botLobby.profile===2&&!t.closeRequested);
 assert.ok(replacement);assert.equal(replacement.settings.maxBuyIn,100);assert.equal(Object.keys(replacement.players).length,4);
 assert.equal(f.state.get('memberships/owner_netabel').balance,0);assert.ok(f.tables().filter(t=>!t.closeRequested).length>=2);
});
test('strict six-seat autoStart templates still deal all managed cash profiles after creation or adoption',async()=>{
 const strict={...settings,autoStart:6};
 for(const profile of [0,1,2]){
  const raw=I.makeTable('netabel','owner',strict,profile,'strict-created'+profile,1000,1);
  const s={id:'strict-created'+profile,raw:copy(raw),settings:raw.settings,players:raw.players,gameState:raw.gameState,table:{clubId:'netabel',handCount:0},priv:{},effects:[],deck:null,now:2000};
  assert.equal(E.startHand(s),'dealt');assert.equal(s.gameState.phase,'preflop');assert.equal(Object.keys(s.priv).length,6-profile);assert.ok(Object.values(s.priv).every(cards=>cards.length===6));
 }
 const f=fixture(0);f.state.get('clubs/netabel').botLobby.templates=[strict];
 for(let i=0;i<3;i++){const table=I.makeTable('netabel','owner',strict,0,'strict-adopt'+i,1000,1);delete table.botLobby;f.state.set('tables/strict-adopt'+i,table);}
 await I.maintainClub(f.db,'netabel',10000);
 for(const row of f.tables()){
  let raw=copy(f.state.get(row.path));
  for(let hand=0;hand<row.botLobby.profile;hand++){
   const s={id:row.path.split('/')[1],raw:copy(raw),settings:raw.settings,players:raw.players,gameState:raw.gameState,table:{clubId:'netabel'},priv:{},effects:[],now:10001+hand};
   const patch=await B.reconcileManagedSeats(s,E.removeSeat,async()=>0);raw={...raw,...patch,players:s.players,gameState:s.gameState};
  }
  const s={id:row.path.split('/')[1],raw:copy(raw),settings:raw.settings,players:raw.players,gameState:raw.gameState,table:{clubId:'netabel',handCount:0},priv:{},effects:[],deck:null,now:20000};
  assert.equal(E.startHand(s),'dealt');assert.equal(Object.keys(s.priv).length,6-row.botLobby.profile);assert.equal(s.settings.blinds,strict.blinds);assert.equal(s.settings.rakePercent,strict.rakePercent);
 }
});

// A slot describes both game family and availability. The two game families
// must not share a table id merely because they have the same vacancy count.
function texasSlots(){
 const sanitize=require('../pokerAccess').__accessInternals.tableSettings;
 return ['main','nlh'].flatMap(family=>[0,1,2].map(profile=>{
  const blinds=[.5,1,2][profile];
  return{id:family+'-'+profile,profile,templates:[sanitize({...settings,baseGameType:family==='nlh'?'NLH':'Omaha 6',blinds,minBuyIn:100*blinds,maxBuyIn:400*blinds,isDealerChoice:false,bombEvery:0,aofEvery:0})]};
 }));
}
function texasFixture(balance=10000){
 const f=fixture(balance),slots=texasSlots();
 f.state.get('clubs/netabel').botLobby={version:1,enabled:true,slots,templates:slots.flatMap(s=>s.templates),updatedAt:1};
 return f;
}
function sponsoredChips(f){
 return f.state.get('memberships/owner_netabel').balance+f.tables().reduce((total,t)=>total+Object.values(t.players||{}).reduce((n,p)=>n+(p.stack||0)+(p.bet||0)+(p.pendingTopUp||0),0)+(t.gameState?.pots||[]).reduce((n,p)=>n+(p.amount||0),0),0);
}
test('six availability slots create distinct Texas and Omaha tables in the same millisecond with conserved funding',async()=>{
 const f=texasFixture(),before=sponsoredChips(f),result=await I.maintainClub(f.db,'netabel',10000);
 assert.equal(result.created,6);assert.equal(f.tables().length,6);
 assert.equal(new Set(f.tables().map(t=>t.path)).size,6);
 assert.deepEqual(f.tables().map(t=>t.botLobby.slotId).sort(),texasSlots().map(s=>s.id).sort());
 assert.equal(sponsoredChips(f),before);assert.equal(f.state.get('memberships/owner_netabel').balance,3600);
 for(const table of f.tables()){
  const slot=texasSlots().find(s=>s.id===table.botLobby.slotId);
  assert.equal(table.botLobby.profile,slot.profile);assert.deepEqual(table.settings,slot.templates[0]);
  assert.equal(Object.keys(table.players).length,6-slot.profile);
  assert.equal(table.waitlist.length,slot.profile===0?2:0);
  assert.ok(table.waitlist.every(w=>w.isBot===true));
  const s={id:table.path.split('/')[1],raw:copy(table),settings:table.settings,players:copy(table.players),gameState:copy(table.gameState),table:{clubId:'netabel',handCount:0},priv:{},effects:[],deck:null,now:20000};
  assert.equal(E.startHand(s),'dealt');
  assert.equal(Object.keys(s.priv).length,6-slot.profile);
  assert.ok(Object.values(s.priv).every(cards=>cards.length===(slot.id.startsWith('nlh-')?2:6)),'Each family deals its own game');
 }
 const snapshot=copy(f.tables());
 assert.equal((await I.maintainClub(f.db,'netabel',10000)).created,0,'Retry in the same millisecond is idempotent');
 assert.equal((await I.maintainClub(f.db,'netabel',10001)).created,0);
 assert.deepEqual(f.tables(),snapshot);assert.equal(sponsoredChips(f),before);
});
test('Netabel upgrade makes nine fixed game slots once without rewriting existing tables or issuing chips',async()=>{
 const f=fixture(10000);f.state.get('clubs/netabel').name='Netabel';
 f.state.get('clubs/netabel').botLobby.templates=[{...settings,isDealerChoice:true,bombEvery:3,aofEvery:'orbit'}];
 await I.maintainClub(f.db,'netabel',10000);const originalTables=copy(f.tables()),balance=f.state.get('memberships/owner_netabel').balance;
 const result=await I.upgradeNetabelTexas(f.db,10001);assert.equal(result.configured,true);
 const config=f.state.get('clubs/netabel').botLobby;
 assert.equal(config.texasRelease,'bot-lobby-netabel-texas-2026-09-27');
 assert.deepEqual(config.slots.map(s=>s.id).sort(),['main-0','main-1','main-2','nlh-0','nlh-1','nlh-2','omaha4-4max','omaha5-4max','pineapple-4max'].sort());
 for(const slot of config.slots){
  const extraGame={'omaha4-4max':'Omaha 4','omaha5-4max':'Omaha 5','pineapple-4max':'Pineapple'}[slot.id];
  assert.equal(slot.templates.length,1);const t=slot.templates[0],blinds=extraGame ? .5 : [.5,1,2][slot.profile];
  assert.equal(t.blinds,blinds);assert.equal(t.minBuyIn,100*blinds);assert.equal(t.maxBuyIn,400*blinds);
  assert.equal(t.baseGameType,extraGame||(slot.id.startsWith('nlh-')?'NLH':'Omaha 6'));
  assert.equal(t.maxPlayers,extraGame?4:6);if(extraGame)assert.equal(slot.profile,1);
  assert.equal(t.isDealerChoice,false);assert.equal(t.bombEvery,0);assert.equal(t.aofEvery,0);
  assert.ok(config.templates.some(template=>JSON.stringify(template)===JSON.stringify(t)),'Union retains every tier template');
 }
 assert.deepEqual(f.tables(),originalTables);assert.equal(f.state.get('memberships/owner_netabel').balance,balance);
 const after=JSON.stringify([...f.state]);assert.equal((await I.upgradeNetabelTexas(f.db,10002)).configured,false);assert.equal(JSON.stringify([...f.state]),after);
});
test('a Texas-only Netabel source still receives the nine explicitly requested fixed game slots',async()=>{
 const f=fixture();f.state.get('clubs/netabel').name='Netabel';
 f.state.get('clubs/netabel').botLobby.templates=[require('../pokerAccess').__accessInternals.tableSettings({...settings,baseGameType:'NLH'})];
 assert.equal((await I.upgradeNetabelTexas(f.db,10000)).configured,true);
 const slots=f.state.get('clubs/netabel').botLobby.slots;
 assert.equal(slots.length,9);
 assert.deepEqual(slots.filter(s=>s.templates[0].baseGameType==='NLH').map(s=>s.id).sort(),['nlh-0','nlh-1','nlh-2']);
 assert.ok(slots.filter(s=>s.id.startsWith('main-')).every(s=>s.templates.every(t=>t.baseGameType==='Omaha 6')));
});
test('Texas upgrade respects disabled and unrelated clubs, ambiguous names and absent opt-in',async()=>{
 for(const scenario of ['other','duplicate','disabled','botsoff','absent','version']){
  const f=fixture(),club=f.state.get('clubs/netabel');club.name='Netabel';
  if(scenario==='other')club.name='Other';
  if(scenario==='duplicate')f.state.set('clubs/duplicate',{name:'Netabel',ownerUid:'elsewhere'});
  if(scenario==='disabled')club.botLobby.enabled=false;
  if(scenario==='botsoff')club.botsAuto=false;
  if(scenario==='absent')delete club.botLobby;
  if(scenario==='version')club.botLobby.version=2;
  const before=JSON.stringify([...f.state]);
  assert.equal((await I.upgradeNetabelTexas(f.db,10000)).configured,false,scenario);
  assert.equal(JSON.stringify([...f.state]),before,scenario);
 }
});
test('legacy managed tags map to main slots and Texas additions do not replace those healthy games',async()=>{
 const f=texasFixture(10000),main=f.state.get('clubs/netabel').botLobby.slots.filter(s=>s.id.startsWith('main-'));
 for(const slot of main){const table=I.makeTable('netabel','owner',slot.templates[0],slot.profile,'legacy-slot'+slot.profile,1000,1);delete table.botLobby.slotId;f.state.set('tables/legacy-slot'+slot.profile,table);}
 const originals=copy(f.tables()),before=sponsoredChips(f);
 assert.equal((await I.maintainClub(f.db,'netabel',10000)).created,3);
 assert.equal(f.tables().length,6);assert.equal(sponsoredChips(f),before);
 for(const original of originals){const table=f.state.get(original.path);assert.deepEqual(table.players,original.players);assert.deepEqual(table.settings,original.settings);assert.equal(table.closeRequested,undefined);}
 assert.equal(f.tables().filter(t=>t.settings.baseGameType==='NLH').length,3);
});
test('Texas migration protects live humans and their queues without changing stakes or an active hand in place',async()=>{
 const f=fixture(50000);f.state.get('clubs/netabel').name='Netabel';await I.maintainClub(f.db,'netabel',10000);
 const originals=f.tables(),seated=f.state.get(originals[0].path),queued=f.state.get(originals[1].path),removed=Object.keys(seated.players)[0];
 const seatIndex=seated.players[removed].seatIndex;delete seated.players[removed];seated.players.human={uid:'human',name:'Human',isBot:false,stack:42,seatIndex};
 seated.gameState.phase='turn';seated.gameState.board=['2c','3d','4h','5s'];seated.gameState.pots=[{amount:17}];seated.botLobby.rotateAt=1;
 queued.waitlist=[{uid:'human-waiter',name:'Waiting player',at:10000,seenAt:10000}];queued.botLobby.rotateAt=1;
 const protectedSettings=[copy(seated.settings),copy(queued.settings)],hand=copy(seated.gameState),human=copy(seated.players.human),waiting=copy(queued.waitlist);
 await I.upgradeNetabelTexas(f.db,10001);await I.maintainClub(f.db,'netabel',10002);
 const held=f.state.get(originals[0].path),heldQueue=f.state.get(originals[1].path);
 assert.equal(held.closeRequested,undefined);assert.equal(heldQueue.closeRequested,undefined);
 assert.deepEqual(held.settings,protectedSettings[0]);assert.deepEqual(heldQueue.settings,protectedSettings[1]);
 assert.deepEqual(held.gameState,hand);assert.deepEqual(held.players.human,human);assert.deepEqual(heldQueue.waitlist,waiting);
 assert.equal(f.tables().filter(t=>t.settings.baseGameType==='NLH'&&!t.closeRequested).length,3);
});
test('six-slot renewals retain one club-wide ten-minute clock across Texas and Omaha',async()=>{
 const f=texasFixture(50000);await I.maintainClub(f.db,'netabel',10000);
 for(const row of f.tables()){const table=f.state.get(row.path);table.botLobby.rotateAt=1;table.gameState.phase='turn';table.gameState.pots=[{amount:10}];}
 await I.maintainClub(f.db,'netabel',10001);assert.equal(f.tables().length,7);
 const closing=f.tables().filter(t=>t.closeRequested);assert.equal(closing.length,1);assert.equal(closing[0].gameState.phase,'turn');assert.deepEqual(closing[0].gameState.pots,[{amount:10}]);
 const deadline=f.state.get('clubs/netabel').botLobby.nextTableRotationAt;assert.equal(deadline,10001+10*60000);
 await I.maintainClub(f.db,'netabel',deadline);assert.equal(f.tables().filter(t=>t.closeRequested).length,1,'Pending hand blocks a second renewal even after the clock expires');assert.equal(f.tables().length,7);
 f.state.delete(closing[0].path);await I.maintainClub(f.db,'netabel',deadline-1);assert.equal(f.tables().length,6);assert.ok(f.tables().every(t=>!t.closeRequested));
 await I.maintainClub(f.db,'netabel',deadline);assert.equal(f.tables().length,7);assert.equal(f.tables().filter(t=>t.closeRequested).length,1);
 assert.equal(f.tables().filter(t=>!t.closeRequested).length,6);
});
test('six-slot low-reserve renewal closes only one table and refills its slot from the exact refund',async()=>{
 const f=texasFixture(6400);await I.maintainClub(f.db,'netabel',10000);assert.equal(f.state.get('memberships/owner_netabel').balance,0);
 for(const row of f.tables())f.state.get(row.path).botLobby.rotateAt=1;
 await I.maintainClub(f.db,'netabel',10001);const closing=f.tables().filter(t=>t.closeRequested);
 assert.equal(closing.length,1);assert.equal(f.tables().filter(t=>!t.closeRequested&&I.healthyProfile(t,t.botLobby.profile,10001)).length,5);
 await I.maintainClub(f.db,'netabel',10002);assert.equal(f.tables().filter(t=>t.closeRequested).length,1);
 const old=closing[0],refund=Object.values(old.players).reduce((n,p)=>n+p.stack,0);f.state.delete(old.path);f.state.get('memberships/owner_netabel').balance=refund;
 await I.maintainClub(f.db,'netabel',10003);
 assert.equal(f.tables().filter(t=>t.botLobby.slotId===old.botLobby.slotId&&!t.closeRequested).length,1);
 assert.equal(f.tables().length,6);assert.ok(f.tables().every(t=>!t.closeRequested));assert.equal(f.state.get('memberships/owner_netabel').balance,0);
 assert.equal(sponsoredChips(f),6400);assert.equal(f.state.get('clubs/netabel').botLobby.nextTableRotationAt,10001+10*60000);
});
test('an underfunded six-slot club never renews below two actually playable tables',async()=>{
 const f=texasFixture(3200);await I.maintainClub(f.db,'netabel',10000);
 assert.equal(f.tables().length,3);assert.equal(f.state.get('memberships/owner_netabel').balance,0);
 for(const row of f.tables())f.state.get(row.path).botLobby.rotateAt=1;
 await I.maintainClub(f.db,'netabel',10001);
 const playable=()=>f.tables().filter(t=>!t.closeRequested&&I.healthyProfile(t,t.botLobby.profile,10001));
 assert.ok(playable().length>=2);assert.ok(f.tables().filter(t=>t.closeRequested).length<=1);assert.equal(sponsoredChips(f),3200);
 // An actual low-chip survivor is not counted as a second playable table.
 for(const row of playable().slice(1))for(const p of Object.values(f.state.get(row.path).players))p.stack=0;
 const closingBefore=f.tables().filter(t=>t.closeRequested).map(t=>t.path);
 await I.maintainClub(f.db,'netabel',700002);
 assert.deepEqual(f.tables().filter(t=>t.closeRequested).map(t=>t.path),closingBefore,'An empty or busted table cannot justify retiring another funded game');
});
test('nine requested slots open funded Texas, Omaha and four-seat side games with the correct initial cards',async()=>{
 const f=fixture(10000);f.state.get('clubs/netabel').name='Netabel';
 await I.upgradeNetabelTexas(f.db,10000);const before=sponsoredChips(f);
 assert.equal((await I.maintainClub(f.db,'netabel',10001)).created,9);
 assert.equal(f.tables().length,9);assert.equal(new Set(f.tables().map(t=>t.path)).size,9);
 assert.equal(sponsoredChips(f),before);assert.equal(f.state.get('memberships/owner_netabel').balance,2700);
 const expectedCards={'NLH':2,'Omaha 6':6,'Omaha 4':4,'Omaha 5':5,'Pineapple':3};
 assert.deepEqual([...new Set(f.tables().map(t=>t.settings.baseGameType))].sort(),Object.keys(expectedCards).sort());
 for(const table of f.tables()){
  const side=table.botLobby.slotId.endsWith('-4max'),count=side?3:6-table.botLobby.profile;
  assert.equal(table.settings.maxPlayers,side?4:6);assert.equal(Object.keys(table.players).length,count);
  if(side){assert.equal(table.botLobby.profile,1);assert.equal(table.settings.blinds,.5);assert.equal(table.settings.minBuyIn,50);assert.equal(table.settings.maxBuyIn,200);}
  const s={id:table.path.split('/')[1],raw:copy(table),settings:table.settings,players:copy(table.players),gameState:copy(table.gameState),table:{clubId:'netabel',handCount:0},priv:{},effects:[],deck:null,now:20000};
  assert.equal(E.startHand(s),'dealt');assert.equal(Object.keys(s.priv).length,count);
  assert.ok(Object.values(s.priv).every(cards=>cards.length===expectedCards[table.settings.baseGameType]),table.settings.baseGameType+' starts with the correct hole-card count');
 }
 assert.equal((await I.maintainClub(f.db,'netabel',10002)).created,0);assert.equal(f.tables().length,9);assert.equal(sponsoredChips(f),before);
});
function configurationCallable(f){
 const fs=require('node:fs'),vm=require('node:vm'),createRequire=require('node:module').createRequire;
 const file=require.resolve('../botLobby'),localRequire=createRequire(file),authority=localRequire('./pokerAuthority'),module={exports:{}};let now=20000;
 const requireMock=id=>id==='firebase-functions/v2/https'?{onCall:(_options,handler)=>handler}:id==='./pokerSecurity'?{requirePokerAvailable:()=>{}}:id==='./pokerAuthority'?{...authority,command:async(_request,_action,fn)=>f.db.runTransaction(tx=>fn(tx,f.db,'owner',now++)),clubManager:async(tx,db,clubId)=>(await tx.get(db.doc('clubs/'+clubId))).data()}:localRequire(id);
 // Authentication/manager authorization is covered separately. This invokes
 // the real configuration handler with a transaction and existing club state.
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:requireMock,console,Buffer},{filename:file});
 return module.exports.pkBotLobbyConfigure;
}
test('manager can disable and re-enable saved game slots after every table is closed without losing the variety configuration',async()=>{
 const f=fixture();f.state.get('clubs/netabel').name='Netabel';await I.upgradeNetabelTexas(f.db,10000);
 const original=copy(f.state.get('clubs/netabel').botLobby),configure=configurationCallable(f);
 assert.equal(f.tables().length,0);
 assert.equal((await configure({data:{clubId:'netabel',enabled:false}})).enabled,false);
 let config=f.state.get('clubs/netabel').botLobby;assert.equal(config.enabled,false);assert.deepEqual(config.slots,original.slots);assert.equal(config.texasRelease,original.texasRelease);
 assert.equal((await configure({data:{clubId:'netabel',enabled:true}})).enabled,true);
 config=f.state.get('clubs/netabel').botLobby;assert.equal(config.enabled,true);assert.deepEqual(config.slots,original.slots);assert.equal(config.texasRelease,original.texasRelease);assert.equal(config.templates.length,9);
 assert.equal(f.tables().length,0);assert.equal(f.state.get('memberships/owner_netabel').balance,3000,'Configuration toggles never spend or mint chips');
});
test('configuration cannot enable legacy templates without table IDs or accept invalid saved slots',async()=>{
 const legacy=fixture(),legacyBefore=JSON.stringify([...legacy.state]);
 await assert.rejects(configurationCallable(legacy)({data:{clubId:'netabel',enabled:true}}),error=>error.code==='invalid-argument');
 assert.equal(JSON.stringify([...legacy.state]),legacyBefore);
 for(const invalid of ['duplicate','empty','profile']){
  const f=texasFixture(),config=f.state.get('clubs/netabel').botLobby;
  if(invalid==='duplicate')config.slots.push(copy(config.slots[0]));
  if(invalid==='empty')config.slots[0].templates=[];
  if(invalid==='profile')config.slots[0].profile=99;
  const before=JSON.stringify([...f.state]);
  await assert.rejects(configurationCallable(f)({data:{clubId:'netabel',enabled:true}}),error=>error.code==='failed-precondition',invalid);
  assert.equal(JSON.stringify([...f.state]),before,invalid);
 }
});
test('a funded legacy slot can retire safely for changed configuration before its old lifetime expires',async()=>{
 const f=fixture(1500);f.state.get('clubs/netabel').name='Netabel';await I.maintainClub(f.db,'netabel',10000);
 assert.equal(f.state.get('memberships/owner_netabel').balance,0);assert.ok(f.tables().every(t=>t.botLobby.rotateAt>10002));
 await I.upgradeNetabelTexas(f.db,10001);await I.maintainClub(f.db,'netabel',10002);
 const closing=f.tables().filter(t=>t.closeRequested);assert.equal(closing.length,1);assert.equal(closing[0].botLobby.profile,0);
 assert.equal(f.tables().filter(t=>!t.closeRequested&&I.healthyProfile(t,t.botLobby.profile,10002)).length,2);
 assert.equal(sponsoredChips(f),1500);assert.equal(f.state.get('clubs/netabel').botLobby.nextTableRotationAt,10002+10*60000);
});
test('coverage reports a populated but one-playable-bot table as missing without retiring it or issuing chips',async()=>{
 const f=fixture(7300);f.state.get('clubs/netabel').name='Netabel';await I.upgradeNetabelTexas(f.db,10000);await I.maintainClub(f.db,'netabel',10001);
 assert.equal(f.tables().length,9);assert.equal(f.state.get('memberships/owner_netabel').balance,0);
 for(const row of f.tables()){
  const table=f.state.get(row.path),players=Object.values(table.players),total=players.reduce((n,p)=>n+p.stack,0);
  for(const p of players){p.stack=0;p.status='busted';}players[0].stack=total;players[0].status='active';table.botLobby.rotateAt=1;
 }
 const result=await I.maintainClub(f.db,'netabel',10002);
 assert.equal(result.created,0);assert.equal(result.coverage.length,9);
 assert.ok(result.coverage.every(row=>row.seated>=3&&row.playable===1));
 assert.deepEqual([...result.missingSlots].sort(),f.state.get('clubs/netabel').botLobby.slots.map(s=>s.id).sort());
 assert.equal(f.tables().length,9);assert.ok(f.tables().every(t=>!t.closeRequested));assert.equal(sponsoredChips(f),7300);
});
test('manual excluded bot tables are neither adopted nor retired through stale migration table IDs',async()=>{
 const f=fixture(1500),ids=[];
 for(const profile of [0,1,2]){
  const id='manual-excluded'+profile,table=I.makeTable('netabel','owner',settings,profile,id,1000,1);
  delete table.botLobby;table.botLobbyExcluded=true;f.state.set('tables/'+id,table);ids.push(id);
 }
 f.state.get('clubs/netabel').botLobby.adoptTableIds=ids;
 const originals=copy(f.tables()),before=sponsoredChips(f);
 assert.equal((await I.maintainClub(f.db,'netabel',10000)).created,3,'Excluded games do not satisfy managed availability slots');
 assert.equal(f.tables().length,6);
 for(const original of originals){const table=f.state.get(original.path);assert.equal(table.botLobby,undefined);assert.equal(table.closeRequested,undefined);assert.equal(table.botLobbyExcluded,true);assert.deepEqual(table.players,original.players);assert.deepEqual(table.settings,original.settings);}
 assert.equal(sponsoredChips(f),before);assert.equal(f.state.get('memberships/owner_netabel').balance,0);
});
test('one-time bootstrap cannot adopt a club whose only bot tables were manually excluded',async()=>{
 const f=legacyNetabel();for(const row of f.tables())f.state.get(row.path).botLobbyExcluded=true;
 const before=JSON.stringify([...f.state]);assert.equal((await I.bootstrapNetabel(f.db,10000)).configured,false);assert.equal(JSON.stringify([...f.state]),before);
});
function manualCreationCallable(f){
 const fs=require('node:fs'),vm=require('node:vm'),createRequire=require('node:module').createRequire;
 const file=require.resolve('../pokerAccess'),localRequire=createRequire(file),authority=localRequire('./pokerAuthority'),module={exports:{}};let now=20000;
 const requireMock=id=>id==='firebase-functions/v2/https'?{onCall:(_options,handler)=>handler}:id==='./pokerSecurity'?{requirePokerAvailable:()=>{}}:id==='./pokerAuthority'?{...authority,command:async(_request,_action,fn)=>f.db.runTransaction(tx=>fn(tx,f.db,'owner',now++)),tableManager:async(tx,db,clubId)=>(await tx.get(db.doc('clubs/'+clubId))).data()}:localRequire(id);
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:requireMock,console,Buffer},{filename:file});
 return module.exports.pkTableCreate;
}
test('manual creation always excludes empty and full-bot tables while the actual ledger conserves sponsor funds',async()=>{
 const f=fixture(1500),create=manualCreationCallable(f),before=sponsoredChips(f);
 for(const botCount of [0,'full']){
  const request={data:{clubId:'netabel',requestId:'manual-excluded-'+botCount,settings:{...settings,botLobbyExcluded:false},botCount,botLobbyExcluded:false,botLobby:{version:1,profile:0}}};
  const result=await create(request),table=f.state.get('tables/'+result.tableId);
  assert.equal(result.ok,true);assert.equal(table.botLobbyExcluded,true);assert.equal(table.botLobby,undefined);
  assert.equal(Object.keys(table.players).length,botCount==='full'?6:0);assert.equal(sponsoredChips(f),before);
  const duplicate=await create(request);assert.equal(duplicate.tableId,result.tableId);assert.equal(sponsoredChips(f),before,'Retry cannot spend the same buy-ins twice');
 }
 assert.equal(f.tables().length,2);assert.equal(f.state.get('memberships/owner_netabel').balance,900);
});
test('an excluded manual table remains available as a settings template without becoming managed itself',async()=>{
 const f=fixture(3000),create=manualCreationCallable(f);
 const manual=await create({data:{clubId:'netabel',requestId:'manual-template',settings,botCount:'full'}});
 const before=copy(f.state.get('tables/'+manual.tableId)),configure=configurationCallable(f);
 assert.equal((await configure({data:{clubId:'netabel',enabled:true,templateTableIds:[manual.tableId]}})).enabled,true);
 assert.deepEqual(f.state.get('clubs/netabel').botLobby.templates,[settings]);
 assert.equal((await I.maintainClub(f.db,'netabel',30000)).created,3);
 const table=f.state.get('tables/'+manual.tableId);assert.equal(table.botLobbyExcluded,true);assert.equal(table.botLobby,undefined);assert.equal(table.closeRequested,undefined);assert.deepEqual(table.players,before.players);
 assert.equal(sponsoredChips(f),3000);
});
