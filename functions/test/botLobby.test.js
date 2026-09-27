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
