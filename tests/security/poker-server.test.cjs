'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Tests require the Firestore emulator');
const admin=require('../../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'demo-pokerten-security'});
const db=admin.firestore();
// Test the rebuilt runtime while the deployed containment gate remains closed.
require('../../functions/pokerSecurity').requirePokerAvailable=()=>{};
const Access=require('../../functions/pokerAccess'),Engine=require('../../functions/pokerEngine'),Tours=require('../../functions/pokerTournaments'),Core=require('../../functions/pokerTournamentCore');
const uid='pilot',owner='sponsor',club='server-test';
const req=(user,data)=>({auth:{uid:user,token:{email:user+'@example.invalid',email_verified:true}},data:{requestId:crypto.randomUUID(),...data}});
const call=(name,user,data)=>({...Access,...Engine,...Tours}[name]).run(req(user,data));
const get=async path=>(await db.doc(path).get()).data();
const bank=async u=>(await get(`memberships/${u}_${club}`)).balance;
const rows=async id=>(await db.collection('tables').where('tournamentId','==',id).get()).docs.map(d=>({...d.data(),docId:d.id}));
const fresh=async(user,balance=100000)=>{await db.doc('users/'+user).set({username:user});await db.doc(`memberships/${user}_${club}`).set({uid:user,clubId:club,status:'approved',role:user===owner?'club_owner':'player',balance});};
before(async()=>{await db.doc('clubs/'+club).set({ownerUid:owner});await fresh(owner,1000000);await fresh(uid);await fresh('opponent');});
after(async()=>{await db.terminate();await admin.app().delete();});
test('cash entry rejects forged identity, grants, negative money and unaffordable purchases; replay charges once',async()=>{
 const before=await bank(uid),r=await call('pkTableCreate',owner,{clubId:club,settings:{baseGameType:'NLH',minBuyIn:40,maxBuyIn:200,blinds:1}}),tableId=r.tableId;
 await assert.rejects(call('pkTableCreate',uid,{clubId:club,settings:{}}),e=>e.code==='permission-denied');
 for(const amount of [-10,0,10000,NaN,Infinity])await assert.rejects(call('pkSeat',uid,{tableId,op:'join',amount}));
 await assert.rejects(call('pkSeat','stranger',{tableId,op:'join',amount:100,uid:owner,role:'club_owner'}));
 const request=req(uid,{tableId,op:'join',amount:100});await Access.pkSeat.run(request);await Access.pkSeat.run(request);
 assert.equal(await bank(uid),before-100);assert.equal((await get('tables/'+tableId)).players[uid].stack,100);
 await assert.rejects(Access.pkSeat.run({...request,data:{...request.data,amount:150}}),e=>e.code==='invalid-argument');
 await call('pkSeat','opponent',{tableId,op:'join',amount:100});await call('pkDeal',uid,{tableId});
 const t=await get('tables/'+tableId),g=t.gameState,actor=g.activeTurnUid;assert.ok(actor);assert.equal(t.players[actor].cards.length,0);assert.equal(t.gameState.deck,undefined);
 const turn={handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet};
 const action=req(actor,{tableId,action:'call',expectedTurn:turn});const stack=t.players[actor].stack,toCall=Math.min(stack,g.highestBet-t.players[actor].bet);
 await Engine.pkAct.run(action);const called=await get('tables/'+tableId);assert.equal(called.players[actor].stack,stack-toCall);assert.notEqual(called.gameState.activeTurnUid,actor);
 assert.equal(Core.chips([called]),200);await Engine.pkAct.run(action);assert.deepEqual(await get('tables/'+tableId),called);
 await assert.rejects(call('pkAct',actor,{tableId,action:'call',expectedTurn:turn}),e=>e.code==='failed-precondition');
 await call('pkSeat',uid,{tableId,op:'topup',amount:25});let topped=await get('tables/'+tableId);assert.equal(topped.players[uid].pendingTopUp,25);assert.equal(await bank(uid),before-125);
 await call('pkLeave',uid,{tableId});const leaving=await get('tables/'+tableId);assert.ok(leaving.players[uid]);assert.ok(leaving.players[uid].leaveReq);
 await db.doc('tables/legacy').set({clubId:club,settings:{serverEngine:true},players:{[uid]:{stack:10000}}});await assert.rejects(call('pkLeave',uid,{tableId:'legacy'}),e=>e.code==='failed-precondition');
});
test('club transfer is atomic and only the actual owner can authorize it',async()=>{
 const a=await bank(owner),b=await bank(uid);await call('pkClubMember',owner,{clubId:club,targetUid:uid,op:'transfer',amount:123.45});assert.equal(await bank(owner),a-123.45);assert.equal(await bank(uid),b+123.45);
 await assert.rejects(call('pkClubMember',uid,{clubId:club,targetUid:owner,op:'transfer',amount:10000}));await assert.rejects(call('pkClubMember',owner,{clubId:club,targetUid:uid,op:'transfer',amount:10000000}));assert.equal(await bank(owner),a-123.45);
});
test('entries, unregister, late registration, re-entry, rebuy and add-on all debit their fresh server price',async()=>{
 const u='entrant';await fresh(u);await fresh('late');
 const created=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Entry checks',buyIn:20,fee:2,bounty:5,tableSize:2,maxPlayers:6,rebuys:true,maxRebuys:1,rebuyUntilLevel:2,reentry:true,maxReentries:1,lateRegUntilLevel:2,addon:true,addonLevel:1,startStack:100,startAt:Date.now()+600000,structure:[{sb:1,bb:2,ante:0,mins:10}]}}),id=created.tournamentId;
 const op=(kind,user=u)=>call('pkTournament',user,{op:kind,tournamentId:id});let b=await bank(u);await op('register');assert.equal(await bank(u),b-27);await op('unregister');assert.equal(await bank(u),b);await op('register');await op('register','opponent');await op('start',owner);
 await op('register','late');assert.equal((await rows(id)).flatMap(r=>Object.keys(r.players)).filter(x=>x==='late').length,1);
 let rs=await rows(id),row=rs.find(r=>r.players[u]),other=Object.keys(row.players).find(x=>x!==u);
 if(!other){other='opponent';const source=rs.find(r=>r.players[other]);await db.doc('tables/'+source.docId).update({['players.'+other+'.stack']:200});}else await db.doc('tables/'+row.docId).update({['players.'+other+'.stack']:200});
 await db.doc('tables/'+row.docId).update({['players.'+u+'.stack']:0,['players.'+u+'.status']:'busted',['players.'+u+'.bustedAt']:Date.now()});
 await op('rebuy');assert.equal(await bank(u),b-54);assert.equal((await get('tables/'+row.docId)).players[u].stack,100);await assert.rejects(op('rebuy'));
 await op('addon');assert.equal(await bank(u),b-74);assert.equal((await get('tables/'+row.docId)).players[u].stack,200);await assert.rejects(op('addon'));
 // Simulate a settled elimination, then re-enter: the prior zero seat must be replaced once.
 await db.doc('tables/'+row.docId).update({['players.'+u+'.stack']:0,['players.'+u+'.status']:'out'});await db.doc('tournaments/'+id).update({['players.'+u+'.out']:true,['players.'+u+'.rank']:3});
 await op('register');assert.equal(await bank(u),b-101);rs=await rows(id);assert.equal(rs.flatMap(r=>Object.keys(r.players)).filter(x=>x===u).length,1);assert.equal(rs.find(r=>r.players[u]).players[u].stack,100);
 await db.doc('tournaments/'+id).update({startedAt:Date.now()-1800000,structure:[{sb:1,bb:2,ante:0,mins:1},{sb:2,bb:4,ante:0,mins:1},{sb:4,bb:8,ante:0,mins:1}]});await fresh('too-late');await assert.rejects(op('register','too-late'),e=>e.code==='failed-precondition');
});
test('cancelling registration returns funded bot entries, guaranteed prize and unused bounty reserve exactly once',async()=>{
 const b=await bank(owner),r=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Cancel checks',buyIn:10,fee:1,bounty:5,bountyFree:true,bountyBudgetRemaining:100,addedPrize:50,maxPlayers:4,startAt:Date.now()+600000}}),id=r.tournamentId;
 await call('pkTournament',owner,{op:'fillbots',tournamentId:id});assert.equal(await bank(owner),b-194);await call('pkTournament',owner,{op:'cancel',tournamentId:id});assert.equal(await bank(owner),b);await call('pkTournament',owner,{op:'cancel',tournamentId:id});assert.equal(await bank(owner),b);
});
test('pure planner preserves stacks, defers busy-table moves and rejects duplicate/missing/zero live seats',()=>{
 const player=(uid,i)=>({uid,seatIndex:i,stack:100,bet:0,status:'active'}),t={id:'t',status:'running',tableSize:6,players:Object.fromEntries(['a','b','c','d'].map(uid=>[uid,{uid,out:false}]))};
 const make=(id,uids)=>({docId:id,tournamentId:'t',tournament:{},gameState:{phase:'waiting',pots:[]},players:Object.fromEntries(uids.map((u,i)=>[u,player(u,i)]))});
 const rows=[make('one',['a','b','c']),make('two',['d'])],result=Core.plan(t,rows);assert.equal(result.deletes.length,1);assert.equal(Object.keys(result.updates[0].patch.players).length,4);assert.equal(Core.chips(result.updates.map(u=>u.patch)),400);
 const busy=structuredClone(rows);busy[0].gameState.phase='flop';busy[0].players.a.bet=10;busy[0].players.a.stack=90;const held=Core.plan(t,busy);assert.equal(held.deletes.length,0);assert.ok(held.updates[0].patch.tournament.balanceHoldUntil);
 const duplicate=structuredClone(rows);duplicate[1].players.a=player('a',1);assert.equal(Core.plan(t,duplicate).issue,'duplicate-seat');const missing=structuredClone(rows);delete missing[0].players.a;assert.equal(Core.plan(t,missing).issue,'missing-seat');const zero=structuredClone(rows);zero[0].players.a.stack=0;assert.equal(Core.plan(t,zero).issue,'unsettled-zero-stack');assert.equal(Core.capacity({pokerType:'Omaha6',tableSize:9}),7);
});
test('fixed, progressive and mystery payouts remain funded, exact and replay-safe',()=>{
 const base={bounty:10,bountyPool:30,players:{a:{out:false,bountyValue:10},b:{out:true,bountyValue:10},c:{out:false,bountyValue:10}}},event={id:'h1',level:3,busts:[{uid:'b',winners:['a']}]};
 const fixed=Core.bountyPlan({...base,bountyMode:'fixed'},event);assert.equal(fixed.credits.a,10);assert.equal(fixed.pool,20);
 const pko=Core.bountyPlan({...base,bountyMode:'progressive',progressiveCashPct:50},event);assert.equal(pko.credits.a,5);assert.equal(pko.players.a.bountyValue,15);assert.equal(pko.pool,25);
 assert.equal(Core.bountyPlan({...base,bountyEvents:{h1:true}},event),null);
 const locked=Core.bountyPlan({...base,bountyMode:'mystery',mysteryStartLevel:4},event);assert.equal(locked.pool,30);
 const mystery=Core.bountyPlan({...base,bountyMode:'mystery',mysteryStartLevel:3},event,()=>.999);assert.equal(mystery.pool+mystery.credits.a,30);assert.ok(mystery.pool>=0);
 assert.deepEqual(Core.split(1,['a','b','c']),{a:.34,b:.33,c:.33});
});
test('one blind clock respects every custom level and break boundary',()=>{
 const t={startedAt:1000,breakEvery:1,breakMins:2},rows=[{sb:1,bb:2,mins:1},{sb:3,bb:6,mins:3}];assert.equal(Core.clock(t,rows,60999).lvl,0);assert.equal(Core.clock(t,rows,61000).inBreak,true);assert.equal(Core.clock(t,rows,181000).lvl,1);assert.equal(Core.clock(t,rows,181000).inBreak,false);assert.equal(Core.clock(t,rows,361000).phaseEndsAt,Infinity);
});
test('an all-bot multi-table tournament ends, balances tables, preserves chips and pays once',async()=>{
 const b=await bank(owner),created=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'All bots',maxPlayers:8,tableSize:3,buyIn:10,fee:1,bounty:2,bountyMode:'progressive',startStack:100,botFill:true,rebuys:false,startAt:Date.now()+600000,structure:[{sb:5,bb:10,ante:0,mins:1},{sb:25,bb:50,ante:50,mins:1},{sb:100,bb:200,ante:200,mins:1}]}}),id=created.tournamentId;
 await call('pkTournament',owner,{op:'start',tournamentId:id});let state=await get('tournaments/'+id);assert.equal((await rows(id)).length,3);let now=state.startedAt,steps=0;
 while(state.status==='running'&&steps++<360){now+=6000;await Tours.tickTournament(id,now);for(const row of await rows(id))await Engine.__engineInternals.tickTable(row.docId,now);await Tours.tickTournament(id,now);state=await get('tournaments/'+id);assert.equal(state.integrityIssue||null,null,'integrity on tick '+steps);assert.equal(Core.chips(await rows(id)),state.initialChips);}
 assert.equal(state.status,'done','all-bot tournament must finish without a browser');assert.equal((await rows(id)).length,1);assert.equal(state.results.length,8);assert.equal(new Set(state.results.map(p=>p.rank)).size,8);assert.equal(await bank(owner),b,'sponsor receives all bot awards, entries and fees exactly once');const paid=await bank(owner);await Tours.tickTournament(id,now+60000);assert.equal(await bank(owner),paid);
 console.log('All-bot tournament completed in '+steps+' ticks');
});
