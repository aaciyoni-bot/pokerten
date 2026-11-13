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
 const access=load('pokerAccess.js'),profileApi=load('pokerProfile.js'),engineApi=load('pokerEngine.js'),engine=engineApi.__engineInternals;
 const auth=uid=>({uid,token:{email:uid+'@example.test',email_verified:true}});
 return{docs,db,engine,now:()=>now,advance:ms=>{now+=ms;},table:id=>docs.get('tables/'+id),balance:uid=>docs.get(`memberships/${uid}_clubA`).balance,
  create:(settings,botCount='full')=>access.pkTableCreate({auth:auth('owner'),data:{clubId:'clubA',manual:true,requestId:'manual-create-request-'+(++request),settings:{baseGameType:'NLH',blinds:.5,minBuyIn:50,maxBuyIn:200,maxPlayers:4,...settings},botCount}}),
  lineup:(id,uid,data)=>access.pkTableManage({auth:auth(uid),data:{tableId:id,requestId:'lineup-test-request-'+(++request),...data}}),
  wait:id=>access.pkSeat({auth:auth('human'),data:{op:'wait',tableId:id,amount:100,requestId:'manual-wait-request-'+(++request)}}),
  act:(id,action)=>{const g=docs.get('tables/'+id).gameState;return engineApi.pkAct({auth:auth(g.activeTurnUid),data:{tableId:id,action,requestId:"showdown-action-"+(++request),expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}}});},
  profile:patch=>profileApi.pkProfile({auth:auth('human'),data:{patch,requestId:'profile-update-'+(++request)}}),
  topUp:(id,uid,botUid,amount,requestId='bot-topup-request-'+(++request))=>access.pkSeat({auth:auth(uid),data:{tableId:id,op:'topup',botUid,amount,requestId}}),
  seatOp:(id,op,extra={})=>access.pkSeat({auth:auth('human'),data:{tableId:id,op,...extra,requestId:'seat-operation-'+(++request)}}),
  joinClub:clubId=>access.pkJoinClub({auth:auth('human'),data:{clubId}}),
  seat:(id,uid='human')=>access.pkSeat({auth:auth(uid),data:{tableId:id,op:'join',amount:100,requestId:'join-player-request-'+(++request)}}),
  leave:(id,uid,data={})=>engineApi.pkLeave({auth:auth(uid),data:{tableId:id,...data}}),
  deal:(id,uid)=>engineApi.pkDeal({auth:auth(uid),data:{tableId:id}}),
  tick:id=>engine.tickTable(id,now)
 };
}
async function settled(f,capacity=4){
 const {tableId:id}=await f.create({maxPlayers:capacity}),t=f.table(id),deck=localRequire('./pokerCore').pokerDeck();
 assert.equal(t.botLobbyExcluded,true);assert.equal(t.botLobby,undefined);
 const players=Object.values(t.players).sort((a,b)=>a.seatIndex-b.seatIndex),departing=players[2];
 for(const p of players){p.cardCount=2;p.botLeavesAt=f.now()+3*60*60000;f.docs.set(`tables/${id}/priv/${p.uid}`,{cards:[deck.pop(),deck.pop()]});}
 departing.botLeavesAt=f.now()+60*60000;
 Object.assign(t.gameState,{phase:'showdown',showdownAt:f.now()-12000,dealerUid:departing.uid,currentGameType:'NLH',board:[],pots:[]});
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

for(const earlyWin of [false,true])test(`public ${earlyWin?'fold win':'showdown'} survives ticks and manual deal for its full display interval`,async()=>{
 const f=fixture(77),{tableId:id}=await f.create({maxPlayers:4});await f.tick(id);
 const initialTotal=total(f,id);let steps=0;
 while(f.table(id).gameState.phase!=='showdown'&&steps++<60)await f.act(id,earlyWin?'fold':'call');
 const before=copy(f.table(id));assert.equal(before.gameState.phase,'showdown');assert.equal(before.gameState.earlyWin,earlyWin);
 assert.equal(total(f,id),initialTotal,'settlement conserves chips');
 assert.equal(Math.round(before.gameState.lastAwards.reduce((n,a)=>n+a.amount,0)*100),Math.round(before.gameState.lastWinAmount*100));
 const delay=earlyWin?6500:8000,actor=Object.keys(before.players)[0];
 f.advance(before.gameState.showdownAt-f.now()+delay-1);await f.tick(id);await f.deal(id,actor);
 assert.deepEqual(copy(f.table(id).gameState),before.gameState,'background ticks and manual deal cannot erase the public result');
 assert.deepEqual(copy(f.table(id).players),before.players,'winner and revealed cards remain visible');
 assert.equal(total(f,id),initialTotal);
 f.advance(1);await f.tick(id);
 assert.equal(f.table(id).gameState.phase,'preflop');assert.equal(f.table(id).gameState.handN,before.gameState.handN+1);
 assert.deepEqual(copy(f.table(id).gameState.lastAwards),[],'next hand clears the old award');
 assert.equal(total(f,id),initialTotal,'next deal conserves chips');
});

for(const seated of [false,true])test(`legacy background departure request is inert for a fresh ${seated?'seated player':'spectator'}`,async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4},0);
 for(const uid of ['departing','newcomer']){
  f.docs.set('users/'+uid,{username:uid});
  f.docs.set(`memberships/${uid}_clubA`,{uid,clubId:'clubA',role:'player',status:'approved',balance:1000});
 }
 await f.seat(id);await f.seat(id,'departing');if(seated)await f.seat(id,'newcomer');await f.tick(id);
 assert.equal((await f.leave(id,'departing')).queued,true,'target asked to leave after the hand');
 const before=copy([...f.docs]);
 for(let repeat=0;repeat<3;repeat++){
  const result=await f.leave(id,'newcomer',{targetUid:'departing'});
  assert.equal(result.ok,false);assert.equal(result.ignored,true);assert.equal(result.reason,'server-maintenance');
  assert.deepEqual(copy([...f.docs]),before,'old automatic requests cannot change cards, table, wallets or roles');
 }
 await assert.rejects(f.leave(id,'newcomer',{targetUid:'departing',intent:'kick'}),e=>e.code==='permission-denied');
 await assert.rejects(f.leave(id,'newcomer',{targetUid:'human'}),e=>e.code==='permission-denied','an active seat cannot be removed');
 await assert.rejects(f.leave(id,'outsider',{targetUid:'departing'}),e=>e.code==='permission-denied');
 f.docs.get('memberships/newcomer_clubA').status='banned';
 await assert.rejects(f.leave(id,'newcomer',{targetUid:'departing'}),e=>e.code==='permission-denied');
 assert.deepEqual(copy(f.table(id)),before.find(([path])=>path==='tables/'+id)[1]);
 f.docs.get('memberships/newcomer_clubA').status='approved';
 // Real management and self departure still follow their original authorization paths.
 assert.equal((await f.leave(id,'owner',{targetUid:'human',intent:'kick'})).queued,true);
 if(seated)assert.equal((await f.leave(id,'newcomer')).queued,true);
});
test('legacy expired sit-out and stale absent target requests never issue a refund',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4},0);await f.seat(id);
 const p=f.table(id).players.human;Object.assign(p,{sitOut:true,sitOutAt:f.now()-601000});
 f.docs.set('memberships/spectator_clubA',{uid:'spectator',clubId:'clubA',role:'player',status:'approved',balance:1000});
 for(const targetUid of ['human','already_gone']){
  const before=copy([...f.docs]);assert.equal((await f.leave(id,'spectator',{targetUid})).ignored,true);
  assert.deepEqual(copy([...f.docs]),before);
 }
});

for(const count of [0,1])for(const earlyWin of [false,true])test(`settled ${earlyWin?'fold':'showdown'} clears stale cards with ${count} players after the full result interval`,async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4},0);
 if(count)await f.seat(id);
 const table=f.table(id),cards=[{val:'J',suit:'♠'},{val:'5',suit:'♦'},{val:'5',suit:'♥'},{val:'9',suit:'♣'},{val:'A',suit:'♥'}];
 Object.assign(table.gameState,{phase:'showdown',handN:7,showdownAt:f.now(),earlyWin,board:copy(cards),board2:copy(cards),pots:[],lastAwards:[{uid:'previous',name:'Previous',amount:50}],lastWinAmount:50,lastWinners:'Previous'});
 if(count){table.players.human.cards=cards.slice(0,2);table.players.human.cardCount=2;table.players.human.actionText='Call';f.docs.set(`tables/${id}/priv/human`,{cards:cards.slice(0,2)});}
 const before=copy(table),bank=f.balance('human'),chips=total(f,id),delay=earlyWin?6500:8000;
 f.advance(delay-1);await f.tick(id);assert.deepEqual(f.table(id).gameState,before.gameState,'The result remains for its full interval');
 f.advance(1);await f.tick(id);const after=f.table(id);
 assert.equal(after.gameState.phase,'waiting');assert.deepEqual(after.gameState.board,[]);assert.equal(after.gameState.board2,null);
 assert.equal(after.gameState.activeTurnUid,null);assert.equal(after.gameState.handN,7,'No cards are dealt without a second player');
 assert.deepEqual(after.gameState.lastAwards,[]);assert.equal(f.balance('human'),bank);assert.equal(total(f,id),chips,'Clearing presentation cannot move money');
 if(count){assert.equal(after.players.human.cardCount,0);assert.deepEqual(after.players.human.cards,[]);assert.deepEqual(f.docs.get(`tables/${id}/priv/human`).cards,[],'Private old cards are also cleared');}
 const stable=copy(after);await f.tick(id);assert.deepEqual(f.table(id),stable,'Idle maintenance does not repeatedly change the table');
 if(count){await f.seat(id,'owner');await f.tick(id);assert.equal(f.table(id).gameState.phase,'preflop');assert.equal(f.table(id).gameState.handN,8);assert.deepEqual(f.table(id).gameState.board,[]);assert.equal(f.table(id).players.human.cardCount,2);assert.equal(total(f,id),chips,'A second player starts a fresh, conserved hand');}
});

test('PLO7 cash creation normalizes seven cards, five seats, Pot Limit and one board on the server',async()=>{
 const f=fixture(),{tableId:id}=await f.create({baseGameType:'Omaha7',maxPlayers:9,omahaPotLimit:false,runTwice:true});
 const t=f.table(id);assert.equal(t.settings.baseGameType,'Omaha 7');assert.equal(t.settings.maxPlayers,5);assert.equal(t.settings.omahaPotLimit,true);assert.equal(t.settings.runTwice,false);assert.equal(Object.keys(t.players).length,5);
 await f.tick(id);for(const p of Object.values(f.table(id).players)){assert.equal(p.cardCount,7);assert.equal(f.docs.get(`tables/${id}/priv/${p.uid}`).cards.length,7);}
 f.docs.get('tables/'+id).settings.maxPlayers=9; // stale settings cannot admit a sixth player
 await assert.rejects(()=>f.seat(id),/full/);await assert.rejects(()=>f.create({baseGameType:'Omaha 7',spinMode:true}),/Spin & Cash/);
});


test('chosen profile avatar reaches cash/Spin seats and repairs a seated player without changing gameplay or balances',async()=>{
 for(const spinMode of [false,true]){
  const f=fixture(),{tableId:id}=await f.create({spinMode},0);
  await f.profile({avatarSeed:'av3d::cat',photo:''});await f.seat(id);
  assert.equal(f.table(id).players.human.avatarSeed,'av3d::cat');
  assert.equal(f.docs.get('memberships/human_clubA').avatarSeed,'av3d::cat');
  // Reproduce the old UID-based seat, including an already running tournament.
  f.table(id).players.human.avatarSeed='human';
  f.table(id).players.human.cards=[{val:'A',suit:'♠'}];f.table(id).players.human.bet=7;
  f.table(id).gameState.phase='flop';f.table(id).gameState.activeTurnUid='human';
  f.table(id).tournamentId='avatarEvent';f.docs.set('tournaments/avatarEvent',{players:{human:{uid:'human',avatarSeed:'human',paid:100,tableId:id}},prizePool:400,status:'running'});
  const money=[f.balance('owner'),f.balance('human')];
  for(const patch of [{avatarSeed:'av3d::astronaut',photo:''},{avatarSeed:'',photo:'data:image/png;base64,AAAA'},{avatarSeed:'',photo:''}]){
   await f.profile(patch);const before=copy(f.table(id)),event=copy(f.docs.get('tournaments/avatarEvent'));
   await f.seatOp(id,'heartbeat',{avatarSeed:'av3d::pig',photo:'forged',targetUid:'owner'});
   const after=f.table(id),expectedSeed=patch.avatarSeed||'human';
   assert.equal(after.players.human.avatarSeed,expectedSeed);assert.equal(after.players.human.photo,patch.photo);
   const expected=copy(before);Object.assign(expected.players.human,{avatarSeed:expectedSeed,photo:patch.photo,lastSeen:f.now()});expected.gameState.__seq++;
   assert.deepEqual(after,expected,'Only appearance, presence and the snapshot sequence change');
   Object.assign(event.players.human,{avatarSeed:expectedSeed,photo:patch.photo});assert.deepEqual(f.docs.get('tournaments/avatarEvent'),event);
   assert.deepEqual([f.balance('owner'),f.balance('human')],money);
  }
  f.docs.set('clubs/newClub',{ownerUid:'owner'});await f.profile({avatarSeed:'av3d::professor',photo:''});await f.joinClub('newClub');
  assert.equal(f.docs.get('memberships/human_newClub').avatarSeed,'av3d::professor');
 }
});

test('cash bot top-ups use its sponsor, queue during play and replay a single receipt', async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:2,maxBuyIn:500});
 const botUid=Object.keys(f.table(id).players)[0];
 f.docs.set('memberships/manager_clubA',{uid:'manager',clubId:'clubA',role:'manager',status:'approved',balance:17});
 f.docs.set('memberships/sponsor_clubA',{uid:'sponsor',clubId:'clubA',role:'player',status:'approved',balance:40});
 f.table(id).players[botUid].fundingUid='sponsor';
 const owner=f.balance('owner'),initial=f.table(id).players[botUid].stack;
 const idle=await f.topUp(id,'manager',botUid,5.25);
 assert.equal(idle.queued,false);assert.equal(f.table(id).players[botUid].stack,initial+5.25);
 await f.tick(id);const before=copy(f.table(id)),b=before.players[botUid];
 const receipt='cash-bot-topup-request-replay';
 const result=await f.topUp(id,'manager',botUid,24.75,receipt);
 assert.equal(result.queued,true);await f.topUp(id,'manager',botUid,24.75,receipt);
 let t=f.table(id),seat=t.players[botUid];
 assert.equal(f.balance('sponsor'),10);assert.equal(f.balance('owner'),owner);assert.equal(f.balance('manager'),17);
 assert.equal(seat.stack,b.stack);assert.equal(seat.bet,b.bet);assert.equal(seat.pendingTopUp,24.75);assert.equal(seat.buyTotal,b.buyTotal+24.75);
 assert.equal(t.gameState.activeTurnUid,before.gameState.activeTurnUid);assert.deepEqual(t.gameState.pots,before.gameState.pots);
 await assert.rejects(f.topUp(id,'manager',botUid,5,receipt),/already used/);
 await assert.rejects(f.topUp(id,'manager',botUid,11));assert.equal(f.balance('sponsor'),10);
 assert.equal([...f.docs.values()].filter(d=>d.action==='bot-topup'&&d.targetUid===botUid&&d.fundingUid==='sponsor').length,2);
 await f.act(id,'fold');t=f.table(id);const settled=t.players[botUid].stack;
 f.advance(require('../pokerTournamentCore').showdownDelay(t.gameState)+5);await f.tick(id);
 seat=f.table(id).players[botUid];assert.equal(seat.pendingTopUp,0);assert.equal(seat.stack+seat.bet,settled+24.75);
});

test('bot funding rejects non-managers, human targets, closing tables, tournament chips and over-cap requests',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:3,maxBuyIn:200},1);
 await f.seat(id);const botUid=Object.keys(f.table(id).players).find(u=>f.table(id).players[u].isBot);
 const bank=f.balance('owner'),t=f.table(id);
 await assert.rejects(f.topUp(id,'human',botUid,1),{code:'permission-denied'});
 await assert.rejects(f.topUp(id,'owner','human',1),{code:'failed-precondition'});
 await assert.rejects(f.topUp(id,'owner','gone',1),{code:'failed-precondition'});
 await assert.rejects(f.topUp(id,'owner',botUid,201),{code:'invalid-argument'});
 t.settings.spinMode=true;await assert.rejects(f.topUp(id,'owner',botUid,1),/Spin/);t.settings.spinMode=false;
 t.tournamentId='event';await assert.rejects(f.topUp(id,'owner',botUid,1),/tournament/);delete t.tournamentId;
 t.closeRequested={by:'owner'};await assert.rejects(f.topUp(id,'owner',botUid,1),/closing/);assert.equal(f.balance('owner'),bank);
});

for(const managed of [false,true])test('fixed lineup retains stacks, waitlisted seats and busted bots on '+(managed?'managed':'manual')+' cash tables',async()=>{
 const f=fixture(),{id,departing}=await settled(f),t=f.table(id);
 if(managed){delete t.botLobbyExcluded;t.botLobby={version:1,profile:2,fundingUid:'owner'};}
 await f.lineup(id,'owner',{op:'bot-rotation',mode:'fixed'});
 const row=f.table(id),ids=Object.keys(row.players),busted=ids.find(u=>u!==departing);
 Object.values(row.players).forEach(p=>{p.botLeavesAt=1;});row.botRotateAfter=0;
 row.players[departing].stack+=row.players[busted].stack;Object.assign(row.players[busted],{stack:0,status:'busted',bustedAt:1});
 await f.wait(id);const bank=f.balance('owner'),chips=total(f,id);
 await f.tick(id);let after=f.table(id);
 assert.deepEqual(Object.keys(after.players).sort(),ids.sort());assert.equal(after.players[busted].status,'sitout');assert.equal(after.players[busted].sitOut,true);
 assert.equal(after.players[busted].cardCount,0);assert.equal(after.waitlist[0].uid,'human');assert.equal(after.players.human,undefined);
 assert.equal(after.players[departing].name,row.players[departing].name);
 assert.equal(f.balance('owner'),bank);assert.equal(total(f,id),chips);
 await f.leave(id,'owner',{targetUid:busted});assert.ok(f.table(id).players[busted],'legacy automated kick cannot evict a fixed seat');
 await f.topUp(id,'owner',busted,40);
 while(f.table(id).gameState.activeTurnUid)await f.act(id,'fold');
 const end=f.table(id).gameState;f.advance(end.showdownAt+require('../pokerTournamentCore').showdownDelay(end)-f.now());
 await f.tick(id);after=f.table(id);assert.equal(after.players[busted].sitOut,false);assert.equal(after.players[busted].cardCount,2);
 assert.equal(after.players[busted].stack+after.players[busted].bet,40);assert.equal(total(f,id),chips);
});

for(const action of ['replace','free'])test('manual '+action+' waits through the award and pays the original sponsor once via either deal path',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:3,botRotation:'fixed'});
 await f.tick(id);const t=f.table(id),uid=t.gameState.activeTurnUid,old=copy(t.players[uid]),before=copy(t.gameState);
 const data={op:'bot-seat',targetUid:uid,action,requestId:'fixed-seat-change-receipt'};
 const bank=f.balance('owner'),chips=total(f,id);
 await f.lineup(id,'owner',data);await f.lineup(id,'owner',data);
 await assert.rejects(f.lineup(id,'owner',{...data,requestId:'another-seat-change-receipt'}),/already pending/);
 await assert.rejects(f.lineup(id,'owner',{op:'bot-rotation',mode:'automatic'}),/pending/);
 await f.tick(id);assert.equal(f.table(id).gameState.activeTurnUid,before.activeTurnUid);assert.equal(f.table(id).players[uid].stack,old.stack);
 while(f.table(id).gameState.activeTurnUid)await f.act(id,'fold');
 const showdown=f.table(id).gameState,paid=f.table(id).players[uid].stack,delay=require('../pokerTournamentCore').showdownDelay(showdown);
 f.advance(showdown.showdownAt+delay-1-f.now());await f.tick(id);assert.ok(f.table(id).players[uid]);
 f.advance(1);
 if(action==='free')await f.wait(id);
 if(action==='replace')await f.deal(id,uid);else await f.tick(id);
 const after=f.table(id),replacement=Object.values(after.players).find(p=>p.seatIndex===old.seatIndex);
 assert.equal(after.players[uid],undefined);assert.equal(f.docs.has('tables/'+id+'/priv/'+uid),false);
 if(action==='replace'){assert.ok(replacement?.isBot);assert.notEqual(replacement.name,old.name);assert.equal(replacement.fundingUid,'owner');assert.equal(replacement.buyTotal,100);}
 else{assert.equal(replacement,undefined);assert.equal(after.waitlist[0].uid,'human');assert.equal(after.players.human,undefined);}
 assert.equal(f.balance('owner'),bank+paid-(action==='replace'?100:0));assert.equal(total(f,id),chips);
 await f.lineup(id,'owner',data);await f.tick(id);
 assert.equal(audits(f,id).filter(a=>a.action==='fixed-bot-seat'&&a.status==='completed').length,1);
});

test('lineup controls reject non-managers and non-cash tables; unfunded replacement leaves the incumbent and game intact',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:3});
 const target=Object.keys(f.table(id).players)[0];
 await assert.rejects(f.lineup(id,'human',{op:'bot-rotation',mode:'fixed'}),{code:'permission-denied'});
 await assert.rejects(f.lineup(id,'owner',{op:'bot-seat',targetUid:target,action:'free'}),/Fixed lineup/);
 await assert.rejects(f.lineup(id,'owner',{op:'bot-rotation',mode:'other'}),/Unknown/);
 f.table(id).settings.spinMode=true;await assert.rejects(f.lineup(id,'owner',{op:'bot-rotation',mode:'fixed'}),/cash/);f.table(id).settings.spinMode=false;
 f.table(id).tournamentId='event';await assert.rejects(f.lineup(id,'owner',{op:'bot-rotation',mode:'fixed'}),/cash/);delete f.table(id).tournamentId;
 await f.lineup(id,'owner',{op:'bot-rotation',mode:'fixed'});await f.tick(id);
 await f.lineup(id,'owner',{op:'bot-seat',targetUid:target,action:'replace'});
 while(f.table(id).gameState.activeTurnUid)await f.act(id,'fold');
 const row=f.table(id);row.players[target].stack=5;f.docs.get('memberships/owner_clubA').balance=0;
 f.advance(20000);await f.tick(id);const seat=f.table(id).players[target];assert.ok(seat);assert.equal(seat.lineupRequest,undefined);
 assert.match(seat.lineupError,/Insufficient/);assert.equal(f.balance('owner'),0);
 await f.lineup(id,'owner',{op:'bot-rotation',mode:'automatic'});assert.equal(f.table(id).settings.botRotation,'automatic');
});

test('two lineup decisions settle to the original sponsor and preserve a held seat when automatic rotation is restored',async()=>{
 const f=fixture(),{id}=await settled(f);
 await f.lineup(id,'owner',{op:'bot-rotation',mode:'fixed'});
 const rows=Object.values(f.table(id).players),[paid,freed,busted]=rows;
 const sponsor='sponsor',sponsorPath='memberships/'+sponsor+'_clubA';
 f.docs.set(sponsorPath,{uid:sponsor,clubId:'clubA',status:'approved',role:'player',balance:33});
 paid.fundingUid=sponsor;freed.fundingUid=sponsor;
 const expected=33+paid.stack+freed.stack-100,owner=f.balance('owner');
 rows[3].stack+=busted.stack;busted.stack=0;busted.status='busted';
 await f.lineup(id,'owner',{op:'bot-seat',targetUid:paid.uid,action:'replace'});
 await f.lineup(id,'owner',{op:'bot-seat',targetUid:freed.uid,action:'free'});
 await f.tick(id);
 const after=f.table(id).players,added=Object.values(after).find(p=>p.seatIndex===paid.seatIndex);
 assert.equal(added.fundingUid,sponsor);assert.equal(after[freed.uid],undefined);assert.equal(after[paid.uid],undefined);
 assert.equal(f.balance('owner'),owner);assert.equal(f.balance(sponsor),expected);
 assert.equal(after[busted.uid].sitOut,true);
 await f.lineup(id,'owner',{op:'bot-rotation',mode:'automatic'});
 assert.equal(f.table(id).players[busted.uid].status,'busted');assert.equal(f.table(id).players[busted.uid].sitOut,false);
});

for(const viaDeal of [true,false])test('manager removal waits for settlement, refunds once and survives replay through '+(viaDeal?'deal':'tick'),async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4},2);
 await f.seat(id);await f.tick(id);
 const target=viaDeal?'human':Object.keys(f.table(id).players).find(u=>f.table(id).players[u].isBot);
 const payer=viaDeal?'human':'owner',bank=f.balance(payer),chips=total(f,id);
 const request={targetUid:target,intent:'kick',requestId:'explicit-manager-remove-001'};
 const queued=await f.leave(id,'owner',request);assert.equal(queued.queued,true);
 assert.ok(f.table(id).players[target].managerRemoval);
 if(viaDeal)await assert.rejects(f.seatOp(id,'cancel-leave'),/manager scheduled/);
 while(f.table(id).gameState.activeTurnUid)await f.act(id,'fold');
 const table=f.table(id),award=table.gameState.showdownAt+require('../pokerTournamentCore').showdownDelay(table.gameState);
 const due=table.players[target].stack+(table.players[target].pendingTopUp||0);
 f.advance(award-1-f.now());await f.tick(id);assert.ok(f.table(id).players[target]);assert.equal(f.balance(payer),bank);
 f.advance(1);
 if(viaDeal)await f.deal(id,'human');else await f.tick(id);
 assert.equal(f.table(id).players[target],undefined);assert.equal(f.balance(payer),bank+due);
 assert.ok(!f.docs.has('tables/'+id+'/priv/'+target));assert.equal(total(f,id),chips);
 if(viaDeal)await f.seatOp(id,'join',{amount:Math.max(100,due)});
 const before=copy(f.table(id));await f.leave(id,'owner',request);
 assert.deepEqual(f.table(id),before,'replaying the original receipt cannot evict a new sitting');
});
test('manager removal immediately refunds a waiting bot to its sponsor; a non-manager cannot remove it',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4},2);
 const bot=Object.values(f.table(id).players)[0],payer=bot.fundingUid,bank=f.balance(payer);
 const req={targetUid:bot.uid,intent:'kick',requestId:'manager-refund-idle-bot'};
 await assert.rejects(f.leave(id,'human',req),{code:'permission-denied'});
 assert.equal((await f.leave(id,'owner',req)).queued,false);assert.equal(f.table(id).players[bot.uid],undefined);
 assert.equal(f.balance(payer),bank+bot.stack);await f.leave(id,'owner',req);assert.equal(f.balance(payer),bank+bot.stack);
});

test('raising the live minimum immediately prices new seats and locks bots without touching the running hand',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:4,minBuyIn:100,maxBuyIn:1000},2);
 await f.tick(id);const row=f.table(id),seats=copy(row.players),turn=row.gameState.activeTurnUid,bank=f.balance('human');
 await assert.rejects(f.lineup(id,'human',{op:'settings',patch:{minBuyIn:300}}),{code:'permission-denied'});
 const saved=await f.lineup(id,'owner',{op:'settings',patch:{minBuyIn:300}});
 assert.equal(saved.queued,false);assert.equal(f.table(id).settings.minBuyIn,300);
 assert.deepEqual(f.table(id).players,seats);assert.equal(f.table(id).gameState.activeTurnUid,turn);
 await assert.rejects(f.seatOp(id,'join',{amount:299.99}),{code:'invalid-argument'});assert.equal(f.balance('human'),bank);
 await assert.rejects(f.lineup(id,'owner',{op:'bot-rotation',mode:'automatic'}),/300/);
 await f.seatOp(id,'join',{amount:300});assert.equal(f.balance('human'),bank-300);
 const bot=Object.keys(seats)[0];await f.lineup(id,'owner',{op:'bot-seat',targetUid:bot,action:'replace'});
 assert.equal(f.table(id).players[bot].lineupRequest.action,'replace');
});
for(const managed of [false,true])test('previously automatic '+(managed?'managed':'manual')+' cash table at 300 keeps expired seats with a human waiting',async()=>{
 const f=fixture(),{id}=await settled(f),row=f.table(id);row.settings.minBuyIn=300;row.settings.maxBuyIn=1000;row.settings.botRotation='automatic';
 if(managed){delete row.botLobbyExcluded;row.botLobby={version:1,profile:2,fundingUid:'owner'};}
 for(const p of Object.values(row.players))p.botLeavesAt=1;row.botRotateAfter=0;
 const ids=Object.keys(row.players).sort();await f.seatOp(id,'wait',{amount:300});await f.tick(id);
 assert.deepEqual(Object.keys(f.table(id).players).sort(),ids);assert.equal(f.table(id).waitlist[0].uid,'human');
});
test('a queued player keeps their position but must choose a valid new buy-in',async()=>{
 const f=fixture(),{tableId:id}=await f.create({maxPlayers:3,minBuyIn:100,maxBuyIn:600});
 await f.wait(id);const then=f.table(id).waitlist[0].at;
 await f.lineup(id,'owner',{op:'settings',patch:{minBuyIn:300}});
 await f.seatOp(id,'wait',{amount:100,heartbeat:true});assert.equal(f.table(id).waitlist[0].buyAmt,100);
 await f.seatOp(id,'wait',{amount:300});assert.equal(f.table(id).waitlist[0].buyAmt,300);assert.equal(f.table(id).waitlist[0].at,then);
});
