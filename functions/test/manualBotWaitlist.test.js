'use strict';
// Exercise the real manual-table callable, waitlist, ledger and tick transaction.
// Only Firestore transport, the clock and shuffle randomness are replaced.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),crypto=require('node:crypto');
const localRequire=createRequire(path.join(__dirname,'../pokerEngine.js'));
const copy=x=>structuredClone(x),NOW=Date.parse('2026-09-27T16:00:00Z');

function fixture(seed=1){
 const docs=new Map([
  ['clubs/clubA',{ownerUid:'owner',botsAuto:true}],
  ['memberships/owner_clubA',{uid:'owner',clubId:'clubA',role:'club_owner',status:'approved',balance:10000}],
  ['users/human',{username:'Human player'}],
  ['memberships/human_clubA',{uid:'human',clubId:'clubA',role:'player',status:'approved',balance:1000}]
 ]);
 let now=NOW,auto=0,request=0,rng=seed;
 const randomInt=(min,max)=>{if(max===undefined){max=min;min=0;}rng=(Math.imul(rng,1664525)+1013904223)>>>0;return min+Math.floor(rng/4294967296*(max-min));};
 class Clock extends Date{static now(){return now;}}
 const snap=p=>({id:p.split('/').at(-1),ref:ref(p),exists:docs.has(p),data:()=>copy(docs.get(p))});
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:n=>collection(p+'/'+n),get:async()=>snap(p)});
 const collection=(p,filters=[])=>({path:p,filters,query:true,doc:id=>ref(p+'/'+(id||'auto'+(++auto))),where:(...f)=>collection(p,[...filters,f])});
 const db={doc:ref,collection,async runTransaction(body){
  let writing=false;const writes=[];
  const tx={async get(target){assert.equal(writing,false,'Firestore reads precede writes');if(!target.query)return snap(target.path);
   return{docs:[...docs.keys()].filter(p=>p.startsWith(target.path+'/')&&p.split('/').length===target.path.split('/').length+1).filter(p=>target.filters.every(([field,op,value])=>op==='=='&&field.split('.').reduce((x,k)=>x?.[k],docs.get(p))===value)).map(snap)};
  },getAll:(...refs)=>Promise.all(refs.map(r=>tx.get(r))),set(r,data){writing=true;writes.push(()=>docs.set(r.path,copy(data)));},update(r,patch){writing=true;writes.push(()=>{assert.ok(docs.has(r.path));const d=copy(docs.get(r.path));for(const [field,value]of Object.entries(patch)){const keys=field.split('.');let at=d;for(const k of keys.slice(0,-1))at=at[k]??={};at[keys.at(-1)]=copy(value);}docs.set(r.path,d);});},delete(r){writing=true;writes.push(()=>docs.delete(r.path));}};
  const result=await body(tx);writes.forEach(write=>write());return result;
 }};
 const cached={};
 function load(file){
  if(cached[file])return cached[file];const module={exports:{}};cached[file]=module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,exports:module.exports,console,Date:Clock,Buffer,setTimeout,
   require:name=>name==='firebase-admin/firestore'?{getFirestore:()=>db}:name==='firebase-functions/v2/https'?{...localRequire(name),onCall:(_,fn)=>fn}:name==='firebase-functions/v2/scheduler'?{onSchedule:(_,fn)=>fn}:name==='./pokerSecurity'?{requirePokerAvailable(){},POKER_SECURITY_PAUSED:false}:['crypto','node:crypto'].includes(name)?{...crypto,randomInt}:['./pokerAuthority','./pokerTournaments','./pokerEngine','./pokerAccess'].includes(name)?load(name.slice(2)+'.js'):localRequire(name)
  },{filename:file});cached[file]=module.exports;return module.exports;
 }
 const access=load('pokerAccess.js'),engine=load('pokerEngine.js').__engineInternals;
 const auth=uid=>({uid,token:{email:uid+'@example.test',email_verified:true}});
 return{docs,db,engine,now:()=>now,advance:ms=>{now+=ms;},table:id=>docs.get('tables/'+id),balance:uid=>docs.get(`memberships/${uid}_clubA`).balance,
  create:settings=>access.pkTableCreate({auth:auth('owner'),data:{clubId:'clubA',manual:true,requestId:'manual-create-request-'+(++request),settings:{baseGameType:'NLH',blinds:.5,minBuyIn:50,maxBuyIn:200,maxPlayers:4,...settings},botCount:'full'}}),
  wait:id=>access.pkSeat({auth:auth('human'),data:{op:'wait',tableId:id,amount:100,requestId:'manual-wait-request-'+(++request)}}),
  tick:id=>engine.tickTable(id,now)
 };
}
async function settled(f,capacity=4){
 const {tableId:id}=await f.create({maxPlayers:capacity}),t=f.table(id),deck=localRequire('./pokerCore').pokerDeck();
 assert.equal(t.botLobbyExcluded,true);assert.equal(t.botLobby,undefined);
 const players=Object.values(t.players).sort((a,b)=>a.seatIndex-b.seatIndex),departing=players[2];
 for(const p of players){p.cardCount=2;p.botLeavesAt=f.now()+3*60*60000;f.docs.set(`tables/${id}/priv/${p.uid}`,{cards:[deck.pop(),deck.pop()]});}
 departing.botLeavesAt=f.now()+60*60000;
 Object.assign(t.gameState,{phase:'showdown',showdownAt:f.now()-6000,dealerUid:departing.uid,currentGameType:'NLH',board:[],pots:[]});
 t.botRotateAfter=f.now()+2*60000;f.docs.set(`tables/${id}/priv/_engine`,{deck});
 return{id,departing:departing.uid};
}
const total=(f,id)=>f.balance('owner')+f.balance('human')+Object.values(f.table(id).players).reduce((n,p)=>n+(p.stack||0)+(p.bet||0)+(p.pendingTopUp||0),0)+(f.table(id).gameState.pots||[]).reduce((n,p)=>n+(p.amount||0),0);
const audits=(f,id)=>[...f.docs].filter(([p,d])=>p.startsWith('_pkAudit/')&&d.tableId===id).map(([,d])=>d);
function assertNextDealer(before,after){
 const seat=before.players[before.gameState.dealerUid].seatIndex,remaining=Object.values(after.players).sort((a,b)=>a.seatIndex-b.seatIndex);
 assert.equal(after.gameState.dealerUid,(remaining.find(p=>p.seatIndex>seat)||remaining[0]).uid,'Button moves to the next occupied seat after the prior dealer');
}
function assertDealt(f,id,count){
 const table=f.table(id);assert.equal(table.gameState.phase,'preflop');assert.equal(Object.keys(table.players).length,count);
 for(const p of Object.values(table.players)){assert.equal(p.cardCount,2);assert.equal(f.docs.get(`tables/${id}/priv/${p.uid}`).cards.length,2);}
}

for(const capacity of [4,6])test(`a full manual ${capacity}-seat bot table yields exactly one seat to a live human queue before session/cooldown expiry`,async()=>{
 const f=fixture(),{id,departing}=await settled(f,capacity);await f.wait(id);
 const before=copy(f.table(id)),chips=total(f,id),bank=f.balance('owner'),human=f.balance('human'),refund=before.players[departing].stack;
 await f.tick(id);const table=f.table(id);
 assert.equal(table.players[departing],undefined);assert.equal(table.players.human,undefined);assert.equal(table.waitlist[0].uid,'human');
 assert.deepEqual(Object.keys(table.players).sort(),Object.keys(before.players).filter(uid=>uid!==departing).sort(),'All other bots remain in their own seats');
 assert.equal(f.balance('owner'),bank+refund);assert.equal(f.balance('human'),human);assert.equal(total(f,id),chips);
 assert.equal(f.docs.has(`tables/${id}/priv/${departing}`),false,'Departed private cards are deleted in the same transaction');
 assert.equal(audits(f,id).length,1);assert.equal(audits(f,id)[0].joined,null);assert.equal(audits(f,id)[0].buy,0);
 assertNextDealer(before,table);assertDealt(f,id,capacity-1);
 const publicAfter=copy(table);await f.tick(id);assert.deepEqual(f.table(id),publicAfter,'Another viewer tick cannot yield a second seat during the new hand');
});

test('an existing free seat satisfies the human queue without forcing another healthy bot out',async()=>{
 const f=fixture(),{id}=await settled(f);const table=f.table(id),old=Object.values(table.players).find(p=>p.seatIndex===0);
 // Set up an already completed manual cash-out before the tested tick.
 f.docs.get('memberships/owner_clubA').balance+=old.stack;delete table.players[old.uid];f.docs.delete(`tables/${id}/priv/${old.uid}`);
 await f.wait(id);const before=copy(f.table(id)),bank=f.balance('owner'),chips=total(f,id);
 await f.tick(id);assert.deepEqual(Object.keys(f.table(id).players).sort(),Object.keys(before.players).sort());
 assert.equal(f.balance('owner'),bank);assert.equal(f.balance('human'),1000);assert.equal(total(f,id),chips);assert.equal(audits(f,id).length,0);assertDealt(f,id,3);
});

test('ordinary due rotation preserves an existing human vacancy and replaces only the due bot',async()=>{
 const f=fixture(),{id,departing}=await settled(f),table=f.table(id),vacated=Object.values(table.players).find(p=>p.seatIndex===0);
 f.docs.get('memberships/owner_clubA').balance+=vacated.stack;delete table.players[vacated.uid];f.docs.delete(`tables/${id}/priv/${vacated.uid}`);
 table.players[departing].botLeavesAt=f.now()-1;table.botRotateAfter=0;await f.wait(id);
 const before=copy(f.table(id)),bank=f.balance('owner'),chips=total(f,id);await f.tick(id);
 const after=f.table(id),joined=Object.keys(after.players).filter(uid=>!before.players[uid]);
 assert.equal(joined.length,1);assert.equal(after.players[departing],undefined);assert.equal(after.players[joined[0]].seatIndex,before.players[departing].seatIndex);
 assert.equal(after.players.human,undefined);assert.equal(f.balance('owner'),bank);assert.equal(total(f,id),chips);assertNextDealer(before,after);assertDealt(f,id,3);
});

test('an unaffordable replacement retains a healthy due bot when a human vacancy already exists',async()=>{
 const f=fixture(),{id,departing}=await settled(f),table=f.table(id),vacated=Object.values(table.players).find(p=>p.seatIndex===0);
 delete table.players[vacated.uid];f.docs.delete(`tables/${id}/priv/${vacated.uid}`);f.docs.get('memberships/owner_clubA').balance=0;
 table.players[departing].stack=20;table.players[departing].botLeavesAt=f.now()-1;table.botRotateAfter=0;await f.wait(id);
 const before=copy(f.table(id)),chips=total(f,id);await f.tick(id);
 assert.deepEqual(Object.keys(f.table(id).players).sort(),Object.keys(before.players).sort());assert.equal(f.balance('owner'),0);assert.equal(f.balance('human'),1000);assert.equal(total(f,id),chips);
 assert.equal(audits(f,id).length,0);assertDealt(f,id,3);
});

test('normal due rotation still replaces a bot without a live human waiter',async()=>{
 const f=fixture(),{id,departing}=await settled(f),table=f.table(id);table.players[departing].botLeavesAt=f.now()-1;table.botRotateAfter=0;
 const before=copy(table),bank=f.balance('owner'),chips=total(f,id);await f.tick(id);const after=f.table(id),joined=Object.keys(after.players).filter(uid=>!before.players[uid]);
 assert.equal(joined.length,1);assert.equal(after.players[departing],undefined);assert.equal(f.docs.has(`tables/${id}/priv/${departing}`),false);
 assert.equal(after.players[joined[0]].seatIndex,before.players[departing].seatIndex);assert.equal(f.balance('owner'),bank);assert.equal(total(f,id),chips);
 assertNextDealer(before,after);assertDealt(f,id,4);
});

for(const kind of ['expired-human','bots-only'])test(kind+' queue does not force an early manual-table bot departure',async()=>{
 const f=fixture(),{id}=await settled(f),table=f.table(id);
 table.waitlist=kind==='expired-human'?[{uid:'human',name:'Offline player',at:f.now()-300001,seenAt:f.now()-300001,buyAmt:100}]:[{uid:'bot_queue',name:'Waiting bot',isBot:true,at:f.now(),buyAmt:100}];
 const before=copy(table),bank=f.balance('owner'),chips=total(f,id);await f.tick(id);
 assert.deepEqual(Object.keys(f.table(id).players).sort(),Object.keys(before.players).sort());assert.equal(f.balance('owner'),bank);assert.equal(total(f,id),chips);assert.equal(audits(f,id).length,0);assertDealt(f,id,4);
});

for(const state of ['active-hand','unsettled-pot','unsettled-bet'])test(state+' does not yield a manual bot seat to waiting humans',async()=>{
 const f=fixture(),{id}=await settled(f);await f.wait(id);const table=f.table(id),first=Object.values(table.players)[0];
 if(state==='active-hand')Object.assign(table.gameState,{phase:'turn',turnStartedAt:f.now(),activeTurnUid:first.uid});
 else{table.gameState.showdownAt=f.now()-1000;if(state==='unsettled-pot'){table.gameState.pots=[{amount:10,eligible:Object.keys(table.players)}];first.stack-=10;}else{first.stack-=10;first.bet=10;}}
 const before=copy(table),bank=f.balance('owner'),chips=total(f,id);await f.tick(id);
 assert.deepEqual(f.table(id),before);assert.equal(f.balance('owner'),bank);assert.equal(total(f,id),chips);assert.equal(audits(f,id).length,0);
});

test('busted bot rebuys preserve one human vacancy instead of refilling the full manual table',async()=>{
 const f=fixture(),{id}=await settled(f),table=f.table(id),seats=Object.values(table.players).sort((a,b)=>a.seatIndex-b.seatIndex),departing=seats[2],rebuying=seats[1];
 seats[0].stack+=departing.stack+rebuying.stack;
 for(const p of [departing,rebuying]){p.stack=0;p.status='busted';p.bustedAt=f.now()-100;}
 await f.wait(id);const bank=f.balance('owner'),chips=total(f,id);await f.tick(id);const after=f.table(id);
 assert.equal(after.players[departing.uid],undefined);assert.equal(f.docs.has(`tables/${id}/priv/${departing.uid}`),false);assert.ok(after.players[rebuying.uid].stack+after.players[rebuying.uid].bet>0);
 assert.equal(f.balance('owner'),bank-100,'Only the other already seated busted bot buys in');assert.equal(f.balance('human'),1000);assert.equal(total(f,id),chips);
 assert.equal(after.players.human,undefined);assertDealt(f,id,3);
});

test('Spin seats are not yielded by the cash-table waitlist guard',async()=>{
 const f=fixture(),{tableId:id}=await f.create({spinMode:true,maxPlayers:3,spinBuyIn:50,spinStack:1000});await f.wait(id);
 const table=f.table(id);for(const p of Object.values(table.players))p.botLeavesAt=f.now()-1;const uids=Object.keys(table.players).sort(),bank=f.balance('owner');
 await f.tick(id);assert.deepEqual(Object.keys(f.table(id).players).sort(),uids);assert.equal(f.balance('owner'),bank);assert.equal(f.balance('human'),1000);assert.equal(audits(f,id).length,0);
});

test('tournament seats are not yielded by the cash-table waitlist guard',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4});await f.wait(id);const table=f.table(id);table.tournamentId='event_waitlist_guard';
 f.docs.set('tournaments/event_waitlist_guard',{authorityVersion:2,clubId:'clubA',status:'reg',players:{}});
 for(const p of Object.values(table.players))p.botLeavesAt=f.now()-1;const before=copy(table),bank=f.balance('owner');
 await f.tick(id);assert.deepEqual(f.table(id),before);assert.equal(f.balance('owner'),bank);assert.equal(f.balance('human'),1000);assert.equal(audits(f,id).length,0);
});
