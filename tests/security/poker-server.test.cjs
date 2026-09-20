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
const Profile=require('../../functions/pokerProfile');
const call=(name,user,data)=>({...Access,...Engine,...Tours,...Profile}[name]).run(req(user,data));
const get=async path=>(await db.doc(path).get()).data();
const bank=async u=>(await get(`memberships/${u}_${club}`)).balance;
const rows=async id=>(await db.collection('tables').where('tournamentId','==',id).get()).docs.map(d=>({...d.data(),docId:d.id}));
const fresh=async(user,balance=100000)=>{await db.doc('users/'+user).set({username:user});await db.doc(`memberships/${user}_${club}`).set({uid:user,clubId:club,status:'approved',role:user===owner?'club_owner':'player',balance});};
before(async()=>{await db.doc('clubs/'+club).set({ownerUid:owner});await fresh(owner,1000000);await fresh(uid);await fresh('opponent');});
after(async()=>{await db.terminate();await admin.app().delete();});
test('profile edits update club copies but cannot change identity, roles or chips',async()=>{
 const u='profile-edit';await fresh(u,250);await db.doc(`memberships/${u}_second`).set({uid:u,clubId:'second',balance:75,role:'player'});
 await call('pkProfile',u,{patch:{username:'שם חדש',photo:'',avatarSeed:'test-avatar'}});
 assert.equal((await get('users/'+u)).username,'שם חדש');assert.equal((await get(`memberships/${u}_${club}`)).username,'שם חדש');assert.equal((await get(`memberships/${u}_second`)).avatarSeed,'test-avatar');
 for(const patch of [{balance:99999},{role:'club_owner'},{playerId:'P123456789'},{photo:'javascript:alert(1)'}])await assert.rejects(call('pkProfile',u,{patch}));
 assert.equal(await bank(u),250);assert.equal((await get(`memberships/${u}_second`)).balance,75);
});
test('club administration checks the owner, preserves balances and records notices exactly once',async()=>{
 const u='managed-member';await fresh(u,123);
 for(const op of ['ban','details','message','photo-reset','agent-settings'])await assert.rejects(call('pkClubMember',u,{clubId:club,targetUid:owner,op}),e=>e.code==='permission-denied');
 await call('pkClubMember',owner,{clubId:club,targetUid:u,op:'details',phone:'test phone',notes:'Test note'});
 await call('pkClubMember',owner,{clubId:club,targetUid:u,op:'ban'});assert.equal((await get(`memberships/${u}_${club}`)).status,'banned');assert.equal(await bank(u),123);
 await call('pkClubMember',owner,{clubId:club,targetUid:u,op:'unban'});
 const r=req(owner,{clubId:club,targetUid:u,op:'message',text:'Test message'});await Access.pkClubMember.run(r);await Access.pkClubMember.run(r);
 assert.equal((await get(`memberships/${u}_${club}`)).inbox.length,1);await call('pkClubInbox',u,{clubId:club});assert.ok((await get(`memberships/${u}_${club}`)).inboxReadAt);
 await assert.rejects(call('pkClubMember',owner,{clubId:club,targetUid:owner,op:'ban'}));
 const broadcast=req(owner,{clubId:club,text:'Test broadcast'});await Profile.pkClubBroadcast.run(broadcast);await Profile.pkClubBroadcast.run(broadcast);assert.equal((await get('broadcasts/'+club)).history.length,1);
 await assert.rejects(call('pkClubBroadcast',u,{clubId:club,text:'Not allowed'}),e=>e.code==='permission-denied');
});
test('agent referrals persist and directory access is restricted to assigned members',async()=>{
 const agent='directory-agent',assigned='directory-assigned',other='directory-other';for(const u of [agent,assigned,other])await fresh(u);
 await call('pkClubMember',owner,{clubId:club,targetUid:agent,op:'role',role:'agent',agentPct:25});
 await call('pkClubMember',owner,{clubId:club,targetUid:agent,op:'agent-settings',share:0});const a=await get(`memberships/${agent}_${club}`);
 const found=await call('pkAgentLookup',assigned,{clubId:club,code:a.agentCode});assert.equal(found.agent.uid,agent);assert.equal(found.agent.pct,0);
 await db.doc(`memberships/${assigned}_${club}`).delete();await call('pkJoinClub',assigned,{clubId:club,agentUid:agent});
 let m=await get(`memberships/${assigned}_${club}`);assert.equal(m.agentUid,agent);assert.equal(m.agentPct,0);assert.equal(m.status,'pending');await call('pkClubMember',owner,{clubId:club,targetUid:assigned,op:'approve',agentUid:agent});assert.equal((await get(`memberships/${assigned}_${club}`)).agentPct,0);
 const scoped=await call('pkClubDirectory',agent,{clubId:club});assert.deepEqual(scoped.members.map(m=>m.uid).sort(),[agent,assigned].sort());
 await assert.rejects(call('pkClubDirectory',other,{clubId:club}),e=>e.code==='permission-denied');
 await call('pkClubMember',owner,{clubId:club,targetUid:agent,op:'ban'});await assert.rejects(call('pkClubDirectory',agent,{clubId:club}),e=>e.code==='permission-denied');
});
test('promoting an agent to manager preserves referrals, commission settings and invitation code',async()=>{
 const manager='promoted-agent',player='promoted-referral',newPlayer='manager-invite';for(const u of [manager,player,newPlayer])await fresh(u,0);
 await call('pkClubMember',owner,{clubId:club,targetUid:manager,op:'role',role:'agent',agentPct:35});
 await call('pkClubMember',owner,{clubId:club,targetUid:manager,op:'agent-settings',share:0});
 const code=(await get(`memberships/${manager}_${club}`)).agentCode;
 await call('pkClubMember',owner,{clubId:club,targetUid:player,op:'role',role:'player',agentUid:manager,agentPct:35});
 await call('pkClubMember',owner,{clubId:club,targetUid:manager,op:'role',role:'manager',agentPct:0});
 const m=await get(`memberships/${manager}_${club}`);assert.equal(m.agentCode,code);assert.equal(m.agentSharePct,0);assert.equal((await get(`memberships/${player}_${club}`)).agentUid,manager);
 assert.equal((await call('pkAgentLookup',newPlayer,{clubId:club,code})).agent.uid,manager);
 await db.doc(`memberships/${newPlayer}_${club}`).delete();await call('pkJoinClub',newPlayer,{clubId:club,agentUid:manager});
 assert.equal((await get(`memberships/${newPlayer}_${club}`)).agentPct,0);
 await call('pkClubMember',manager,{clubId:club,targetUid:manager,op:'agent-settings',share:20});
 await call('pkClubMember',manager,{clubId:club,targetUid:newPlayer,op:'approve',agentUid:manager});
 assert.equal((await get(`memberships/${newPlayer}_${club}`)).agentPct,20);
 await call('pkClubMember',owner,{clubId:club,targetUid:manager,op:'ban'});assert.equal((await call('pkAgentLookup',newPlayer,{clubId:club,code})).agent,null);
});
test('mixed and bots-only rake keeps bot funding out of profits and agent commissions',async()=>{
 const {prepareLedger}=require('../../functions/pokerLedger'),{allocateRake}=require('../../functions/pokerRake');
 const agent='rake-manager',human='rake-human';await fresh(agent,0);await fresh(human,100);
 await call('pkClubMember',owner,{clubId:club,targetUid:agent,op:'role',role:'manager'});
 await call('pkClubMember',owner,{clubId:club,targetUid:human,op:'role',role:'player',agentUid:agent,agentPct:50});
 const before=await get(`memberships/${owner}_${club}`),parts=[{uid:human,name:'Human'},{uid:'bot_rake_1',isBot:true,fundingUid:owner}];
 const apply=async(source,parts)=>db.runTransaction(async tx=>{const write=await prepareLedger(db,tx,club,[{type:'rake',rake:10,allocations:allocateRake(10,parts)}],source,Date.now());write();});
 await apply('rake-mixed-test',parts);assert.equal(await bank(agent),2.5);assert.equal(await bank(owner),before.balance+7.5);assert.equal((await get(`memberships/${owner}_${club}`)).clubProfits,(before.clubProfits||0)+2.5);
 const entries=(await db.collection('agentLog').where('tableId','==','rake-mixed-test').get()).docs.map(d=>d.data());
 assert.equal(entries.filter(e=>e.rakeSource==='human').reduce((n,e)=>n+e.amount,0),5);assert.equal(entries.filter(e=>e.rakeSource==='bot').reduce((n,e)=>n+e.amount,0),5);
 const games=(await db.collection('gameLog').where('tableId','==','rake-mixed-test').get()).docs.map(d=>d.data());assert.equal(games.length,1);assert.equal(games[0].rake,5);assert.equal(games[0].uid,human);
 const profit=(await get(`memberships/${owner}_${club}`)).clubProfits;
 await apply('rake-bots-test',[{uid:'bot_rake_2',isBot:true,fundingUid:owner},{uid:'bot_rake_3',isBot:true,fundingUid:owner}]);
 assert.equal((await get(`memberships/${owner}_${club}`)).clubProfits,profit);assert.equal(await bank(agent),2.5);assert.equal(await bank(owner),before.balance+17.5);
 assert.equal((await db.collection('gameLog').where('tableId','==','rake-bots-test').get()).size,0);
});
test('tournament fees attribute paid human entries and bot funding separately at settlement',async()=>{
 const human='fee-human',agent='fee-manager';await fresh(human,100);await fresh(agent,0);
 await call('pkClubMember',owner,{clubId:club,targetUid:agent,op:'role',role:'manager'});
 await call('pkClubMember',owner,{clubId:club,targetUid:human,op:'role',role:'player',agentUid:agent,agentPct:50});
 const before=await get(`memberships/${owner}_${club}`);
 const {tournamentId:id}=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Fee split',buyIn:10,fee:2,startStack:100,maxPlayers:2,tableSize:2,payouts:[100],botFill:true,startAt:Date.now()+600000}});
 await call('pkTournament',human,{op:'register',tournamentId:id});await call('pkTournament',owner,{op:'start',tournamentId:id});
 const [row]=await rows(id),bot=Object.values(row.players).find(p=>p.isBot),now=Date.now();
 await db.doc('tables/'+row.docId).update({['players.'+human+'.stack']:200,['players.'+bot.uid+'.stack']:0,['players.'+bot.uid+'.status']:'busted',['players.'+bot.uid+'.bustedAt']:now-5000});
 await Tours.tickTournament(id,now);assert.equal((await get('tournaments/'+id)).status,'done');assert.equal(await bank(agent),1);assert.equal(await bank(human),108);
 assert.equal(await bank(owner),before.balance-9);assert.equal((await get(`memberships/${owner}_${club}`)).clubProfits,(before.clubProfits||0)+1);
 const logs=(await db.collection('agentLog').where('tableId','==','tournament:'+id).get()).docs.map(d=>d.data());assert.equal(logs.filter(e=>e.rakeSource==='bot').reduce((n,e)=>n+e.amount,0),2);
 await Tours.tickTournament(id,now+1000);assert.equal(await bank(agent),1);
});
test('archiving completed tournament and historical tables never replays prizes or old stacks',async()=>{
 const id='archive-done',balance=await bank(owner);await db.doc('tournaments/'+id).set({clubId:club,status:'done',paidPrizes:{sponsor:true}});
 for(const [tableId,t]of [['archive-tour',{authorityVersion:2,tournamentId:id,settings:{serverEngine:true},players:{sponsor:{uid:owner,stack:100000}}}],['archive-legacy',{status:'done',players:{sponsor:{uid:owner,stack:99999}}}]]){
  await db.doc('tables/'+tableId).set({clubId:club,...t});await call('pkTableManage',owner,{tableId,op:'delete'});await call('pkTableManage',owner,{tableId,op:'delete'});
  assert.equal(await get('tables/'+tableId),undefined);assert.ok(await get('_pkClosedTables/'+tableId));assert.equal(await bank(owner),balance);
 }
});
test('a tournament can finish at three configured winners only after every hand settles and pays once',async()=>{
 const b=await bank(owner),{tournamentId:id}=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Three winners',maxPlayers:5,tableSize:5,buyIn:10,startStack:100,payouts:[50,30,20],finishAtPaidPlaces:true,botFill:true,startAt:Date.now()+600000}});
 await call('pkTournament',owner,{op:'start',tournamentId:id});const [row]=await rows(id),ids=Object.keys(row.players),tor=await get('tournaments/'+id);
 ids.forEach((u,i)=>{Object.assign(row.players[u],{stack:[250,150,100,0,0][i],status:i<3?'active':'out'});Object.assign(tor.players[u],{out:i>=3,rank:i>=3?i+1:null});});
 await db.doc('tournaments/'+id).update({players:tor.players});await db.doc('tables/'+row.docId).update({players:row.players,gameState:{phase:'flop',pots:[]}});
 await Tours.tickTournament(id);assert.equal((await get('tournaments/'+id)).status,'running');
 await db.doc('tables/'+row.docId).update({'gameState.phase':'waiting'});await Tours.tickTournament(id);const done=await get('tournaments/'+id);
 assert.equal(done.status,'done');assert.equal(done.winnerUids.length,3);assert.deepEqual(done.results.slice(0,3).map(r=>r.prize),[25,15,10]);assert.equal(Core.chips(await rows(id)),500);assert.equal(await bank(owner),b);
 await Tours.tickTournament(id);assert.equal(await bank(owner),b);
});
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
test('a last rebuy is charged before a multi-winner finish and tied stacks share their prize places',async()=>{
 const balance=await bank(owner),{tournamentId:id}=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Rebuy at finish',maxPlayers:5,tableSize:5,buyIn:10,startStack:100,payouts:[50,30,20],finishAtPaidPlaces:true,rebuys:true,maxRebuys:1,rebuyUntilLevel:1,botFill:true,startAt:Date.now()+600000}});
 await call('pkTournament',owner,{op:'start',tournamentId:id});const [row]=await rows(id),ids=Object.keys(row.players),t=await get('tournaments/'+id),now=Date.now();
 ids.forEach((uid,i)=>{Object.assign(row.players[uid],{stack:i<2?250:0,status:i<2?'active':i===2?'busted':'out',bustedAt:now-5000});Object.assign(t.players[uid],{out:i>=3,rank:i>=3?i+1:null});});
 await db.doc('tournaments/'+id).update({players:t.players});await db.doc('tables/'+row.docId).update({players:row.players,gameState:{phase:'waiting',pots:[]}});
 await Tours.tickTournament(id,now);const done=await get('tournaments/'+id);assert.equal(done.status,'done');assert.equal(done.players[ids[2]].rebuys,1);assert.deepEqual(done.results.slice(0,3).map(p=>p.prize),[24,24,12]);assert.equal(Core.chips(await rows(id)),600);assert.equal(await bank(owner),balance);
 await Tours.tickTournament(id,now+10000);assert.equal(await bank(owner),balance);
});
test('cash rebuy queues once during another hand and joins only the next deal, even after its old bust timer expires',async()=>{
 const u='queued-rebuy',a='rebuy-other-a',b='rebuy-other-b';for(const x of [u,a,b])await fresh(x);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 for(const x of [u,a,b])await call('pkSeat',x,{tableId,op:'join',amount:100});
 await db.doc('tables/'+tableId).update({['players.'+u+'.stack']:0,['players.'+u+'.status']:'busted',['players.'+u+'.bustedAt']:Date.now()-301000,['players.'+a+'.stack']:200});
 await call('pkDeal',a,{tableId});const before=await get('tables/'+tableId),balance=await bank(u),request=req(u,{tableId,op:'rebuy',amount:40});
 await Access.pkSeat.run(request);await Access.pkSeat.run(request);let t=await get('tables/'+tableId);
 assert.equal(await bank(u),balance-40);assert.equal(t.players[u].stack,0);assert.equal(t.players[u].pendingTopUp,40);assert.equal(t.players[u].cardCount,0);assert.deepEqual(t.gameState.pots,before.gameState.pots);assert.equal(t.gameState.activeTurnUid,before.gameState.activeTurnUid);
 await assert.rejects(call('pkSeat',u,{tableId,op:'rebuy',amount:40}),/already queued/);assert.equal(await bank(u),balance-40);
 const g=t.gameState;await call('pkAct',g.activeTurnUid,{tableId,action:'fold',expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});
 await Engine.__engineInternals.tickTable(tableId,Date.now()+6000);t=await get('tables/'+tableId);
 assert.equal(t.gameState.handN,before.gameState.handN+1);assert.equal(t.players[u].pendingTopUp,0);assert.equal(t.players[u].stack+t.players[u].bet,40);assert.equal(t.players[u].cardCount,2);assert.equal(await bank(u),balance-40);assert.equal(Core.chips([t]),340);
});
test('spectators and undealt seats leave immediately; queued top-ups refund once and dealt players wait',async()=>{
 const a='exit-a',b='exit-b',late='exit-waiting';for(const x of [a,b,late])await fresh(x);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 for(const x of [a,b])await call('pkSeat',x,{tableId,op:'join',amount:100});await call('pkDeal',a,{tableId});const before=await get('tables/'+tableId),balance=await bank(late);
 assert.equal((await call('pkLeave',late,{tableId})).queued,false);assert.deepEqual(await get('tables/'+tableId),before);
 await call('pkSeat',late,{tableId,op:'join',amount:100});await call('pkSeat',late,{tableId,op:'topup',amount:40});assert.equal(await bank(late),balance-140);
 assert.equal((await call('pkLeave',late,{tableId})).queued,false);const after=await get('tables/'+tableId);assert.equal(after.players[late],undefined);assert.equal(await bank(late),balance);assert.equal(after.gameState.activeTurnUid,before.gameState.activeTurnUid);assert.deepEqual(after.gameState.pots,before.gameState.pots);
 await call('pkLeave',late,{tableId});assert.equal(await bank(late),balance);assert.equal((await call('pkLeave',a,{tableId})).queued,true);assert.ok((await get('tables/'+tableId)).players[a].leaveReq);
});
test('club transfers are atomic and ordinary players cannot authorize them',async()=>{
 const a=await bank(owner),b=await bank(uid);await call('pkClubMember',owner,{clubId:club,targetUid:uid,op:'transfer',amount:123.45});assert.equal(await bank(owner),a-123.45);assert.equal(await bank(uid),b+123.45);
 await assert.rejects(call('pkClubMember',uid,{clubId:club,targetUid:owner,op:'transfer',amount:10000}));await assert.rejects(call('pkClubMember',owner,{clubId:club,targetUid:uid,op:'transfer',amount:10000000}));assert.equal(await bank(owner),a-123.45);
});
test('deleting a previously played, now empty table never pays past players again',async()=>{
 const a='delete-past-a',b='delete-past-b';await fresh(a);await fresh(b);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 for(const u of [a,b])await call('pkSeat',u,{tableId,op:'join',amount:100});await call('pkDeal',a,{tableId});
 const g=(await get('tables/'+tableId)).gameState;await call('pkAct',g.activeTurnUid,{tableId,action:'fold',expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});
 for(const u of [a,b])await call('pkLeave',u,{tableId});const before=await get('tables/'+tableId),balances=await Promise.all([bank(a),bank(b),bank(owner)]);
 assert.equal(Object.keys(before.players).length,0);assert.ok(before.history.length);assert.ok(Object.keys(before.leftStacks).length);
 const ledgers=(await db.collection('_pkLedger').where('source','==',tableId).get()).size;
 const request=req(owner,{tableId,op:'delete'});assert.equal((await Access.pkTableManage.run(request)).deleted,true);await Access.pkTableManage.run(request);await call('pkTableManage',owner,{tableId,op:'delete'});
 assert.equal(await get('tables/'+tableId),undefined);assert.deepEqual(await Promise.all([bank(a),bank(b),bank(owner)]),balances,'history, past buy-ins and leftStacks never create another credit');
 assert.equal((await db.collection('_pkLedger').where('source','==',tableId).get()).size,ledgers);assert.deepEqual((await get('_pkClosedTables/'+tableId)).history,before.history);
 assert.equal((await db.collection('tables/'+tableId+'/priv').get()).size,0);
});
test('cash table closure returns only seated balances and pending funds, including bot sponsors, once',async()=>{
 const human='close-human';await fresh(human);const startHuman=await bank(human),startOwner=await bank(owner);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,botCount:2,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 await call('pkSeat',human,{tableId,op:'join',amount:100});await call('pkSeat',human,{tableId,op:'topup',amount:40});
 const requests=[req(owner,{tableId,op:'delete'}),req(owner,{tableId,op:'delete'})];await Promise.all(requests.map(r=>Access.pkTableManage.run(r)));
 assert.equal(await bank(human),startHuman);assert.equal(await bank(owner),startOwner);assert.equal(await get('tables/'+tableId),undefined);
 const logs=(await db.collection('_pkLedger').where('source','==',tableId).get()).docs.map(d=>d.data());assert.equal(logs.filter(l=>l.movements.some(m=>m.amount>0)).length,1);
});
test('closing a live cash table preserves its hand, settles its real winner and never deals or charges again',async()=>{
 const a='close-live-a',b='close-live-b';await fresh(a);await fresh(b);const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 for(const u of [a,b])await call('pkSeat',u,{tableId,op:'join',amount:100});await call('pkDeal',a,{tableId});await call('pkSeat',a,{tableId,op:'topup',amount:40});
 const before=await get('tables/'+tableId),balances=await Promise.all([bank(a),bank(b)]),result=await call('pkTableManage',owner,{tableId,op:'delete'});assert.equal(result.queued,true);
 let t=await get('tables/'+tableId);assert.deepEqual(t.players,before.players);assert.deepEqual(t.gameState.pots,before.gameState.pots);assert.equal(t.gameState.activeTurnUid,before.gameState.activeTurnUid);
 for(const op of ['join','topup','rebuy','addbot','wait'])await assert.rejects(call('pkSeat',a,{tableId,op,amount:40}),/closing/);await assert.rejects(call('pkDeal',a,{tableId}),/closing/);
 assert.deepEqual(await Promise.all([bank(a),bank(b)]),balances);
 const g=t.gameState;await call('pkAct',g.activeTurnUid,{tableId,action:'fold',expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});
 t=await get('tables/'+tableId);assert.equal(t.gameState.phase,'showdown');assert.equal(Core.chips([t])+Object.values(t.players).reduce((n,p)=>n+(p.pendingTopUp||0),0),240);const expected=[a,b].map((u,i)=>balances[i]+t.players[u].stack+(t.players[u].pendingTopUp||0));
 await Engine.__engineInternals.tickTable(tableId,t.gameState.showdownAt+1000);assert.ok(await get('tables/'+tableId),'winner display stays visible');
 await Promise.all([1,2].map(()=>Engine.__engineInternals.tickTable(tableId,t.gameState.showdownAt+6000)));
 assert.equal(await get('tables/'+tableId),undefined);assert.deepEqual(await Promise.all([bank(a),bank(b)]),expected);assert.equal((await get('_pkClosedTables/'+tableId)).gameState.handN,before.gameState.handN);
 await call('pkTableManage',owner,{tableId,op:'delete'});assert.deepEqual(await Promise.all([bank(a),bank(b)]),expected);
});
test('table controls require current club authority and managers have full club access',async()=>{
 for(const [u,role,games,status]of [['poker-manager','manager',['poker'],'approved'],['other-manager','manager',['rummy'],'approved'],['pending-manager','manager',['poker'],'pending'],['fake-owner','club_owner',[],'approved']]){await fresh(u);await db.doc(`memberships/${u}_${club}`).update({role,managedGames:games,status});}
 const {tableId}=await call('pkTableCreate','poker-manager',{clubId:club,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 for(const u of [uid,'pending-manager','fake-owner'])for(const op of ['delete','limits','settings','mute','clear-floor'])await assert.rejects(call('pkTableManage',u,{tableId,op,min:10,max:100,role:'club_owner',clubId:'forged'}),e=>e.code==='permission-denied');
 await assert.rejects(Access.pkTableManage.run({data:{tableId,op:'delete',requestId:crypto.randomUUID()}}),e=>e.code==='unauthenticated');
 for(const [min,max]of [[-1,100],[100,50],[NaN,100],[10,Infinity]])await assert.rejects(call('pkTableManage',owner,{tableId,op:'limits',min,max}));
 await call('pkTableManage','poker-manager',{tableId,op:'limits',min:50,max:150});assert.equal((await get('tables/'+tableId)).settings.minBuyIn,50);
 await call('pkTableManage','poker-manager',{tableId,op:'mute',muted:true});await call('pkSeat',uid,{tableId,op:'floor'});assert.equal((await get('tables/'+tableId)).floorCall.uid,uid);await assert.rejects(call('pkSeat',uid,{tableId,op:'floor'}),e=>e.code==='resource-exhausted');
 await call('pkTableManage','poker-manager',{tableId,op:'clear-floor'});assert.equal((await get('tables/'+tableId)).floorCall,null);
 await db.doc(`memberships/poker-manager_${club}`).update({managedGames:[]});await call('pkTableManage','poker-manager',{tableId,op:'mute',muted:false});await call('pkTableManage','other-manager',{tableId,op:'mute',muted:true});await db.doc(`memberships/poker-manager_${club}`).update({role:'player'});await assert.rejects(call('pkTableManage','poker-manager',{tableId,op:'delete'}),e=>e.code==='permission-denied');
 await call('pkTableManage',owner,{tableId,op:'delete'});await assert.rejects(call('pkTableManage',uid,{tableId,op:'delete'}),e=>e.code==='permission-denied');
});
test('table deletion never converts Spin or tournament chips to money, or interrupts funded competitions',async()=>{
 for(const mode of ['unarmed','funding-pending','active','done']){
  const balance=await bank(owner),{tableId}=await call('pkTableCreate',owner,{clubId:club,botCount:2,settings:{spinMode:true,spinBuyIn:10,spinStack:1000}});
  if(mode!=='unarmed')await db.doc('tables/'+tableId).update({spin:{prize:100,fundingPending:mode==='funding-pending'},spinDone:mode==='done'});
  await assert.rejects(call('pkTableManage',owner,{tableId,op:'limits',min:1,max:200}),/Spin settings/);
  if(mode==='active'){const before=await get('tables/'+tableId);await assert.rejects(call('pkTableManage',owner,{tableId,op:'delete'}),/Spin must finish/);assert.deepEqual(await get('tables/'+tableId),before);assert.equal(await bank(owner),balance-20);}
  else{await call('pkTableManage',owner,{tableId,op:'delete'});assert.equal(await bank(owner),mode==='done'?balance-20:balance,'completed Spin stacks and prizes must never be paid a second time');}
 }
 const {tournamentId}=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Do not delete live tournament tables',maxPlayers:2,tableSize:2,buyIn:10,startStack:1000,botFill:true,startAt:Date.now()+600000}});await call('pkTournament',owner,{op:'start',tournamentId});
 const [row]=await rows(tournamentId),balance=await bank(owner);await assert.rejects(call('pkTableManage',owner,{tableId:row.docId,op:'delete'}),/Tournament tables/);assert.equal(await bank(owner),balance);assert.ok(await get('tables/'+row.docId));
});
test('a missing funding account aborts closure atomically instead of deleting chips or partially refunding',async()=>{
 const a='close-missing',b='close-present';await fresh(a);await fresh(b);const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}});
 for(const u of [a,b])await call('pkSeat',u,{tableId,op:'join',amount:100});await db.doc(`memberships/${a}_${club}`).delete();const before=await get('tables/'+tableId),balance=await bank(b);
 await assert.rejects(call('pkTableManage',owner,{tableId,op:'delete'}),/Funding account missing/);assert.deepEqual(await get('tables/'+tableId),before);assert.equal(await bank(b),balance);assert.equal(await get('_pkClosedTables/'+tableId),undefined);
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
test('a paid tournament rebuy survives a live table, expiry and balancing until the next hand',async()=>{
 const u='tour-queued',a='tour-queue-a',b='tour-queue-b';for(const x of [u,a,b])await fresh(x);
 const r=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Queue regression',buyIn:20,fee:2,tableSize:3,maxPlayers:3,startStack:100,rebuys:true,rebuyUntilLevel:2,maxRebuys:1,startAt:Date.now()+600000,structure:[{sb:1,bb:2,ante:0,mins:10}]}}),id=r.tournamentId;
 for(const x of [u,a,b])await call('pkTournament',x,{op:'register',tournamentId:id});await call('pkTournament',owner,{op:'start',tournamentId:id});const [row]=await rows(id),tableId=row.docId;
 await db.doc('tables/'+tableId).update({['players.'+u+'.stack']:0,['players.'+u+'.status']:'busted',['players.'+u+'.bustedAt']:Date.now()-50000,['players.'+a+'.stack']:200});await call('pkDeal',a,{tableId});
 const balance=await bank(u),request=req(u,{op:'rebuy',tournamentId:id}),result=await Tours.pkTournament.run(request);assert.equal(result.queued,true);await Tours.pkTournament.run(request);
 let t=await get('tables/'+tableId),g=t.gameState;assert.equal(t.players[u].stack,0);assert.equal(t.players[u].pendingTournamentChips,100);assert.equal(t.players[u].cardCount,0);assert.equal(await bank(u),balance-22);assert.equal(Core.chips([t]),400);
 await assert.rejects(call('pkTournament',u,{op:'rebuy',tournamentId:id}),/already queued/);
 await call('pkAct',g.activeTurnUid,{tableId,action:'fold',expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});
 await Tours.tickTournament(id,Date.now()+6000);assert.equal((await get('tournaments/'+id)).players[u].out,false,'accepted rebuy cannot expire or eliminate the player');
 await Engine.__engineInternals.tickTable(tableId,Date.now()+7000);t=await get('tables/'+tableId);assert.equal(t.players[u].pendingTournamentChips,0);assert.equal(t.players[u].stack+t.players[u].bet,100);assert.equal(t.players[u].cardCount,2);assert.equal(Core.chips([t]),400);assert.equal(await bank(u),balance-22);
});
test('cancelling registration returns funded bot entries, guaranteed prize and unused bounty reserve exactly once',async()=>{
 const b=await bank(owner),r=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Cancel checks',buyIn:10,fee:1,bounty:5,bountyFree:true,bountyBudgetRemaining:100,addedPrize:50,maxPlayers:4,startAt:Date.now()+600000}}),id=r.tournamentId;
 await call('pkTournament',owner,{op:'fillbots',tournamentId:id});assert.equal(await bank(owner),b-194);await call('pkTournament',owner,{op:'cancel',tournamentId:id});assert.equal(await bank(owner),b);await call('pkTournament',owner,{op:'cancel',tournamentId:id});assert.equal(await bank(owner),b);
});
test('cash and tournament bots get real display names and existing generic names refresh without changing identity',async()=>{
 const names=require('../../functions/botNames'),r=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:40,maxBuyIn:100,blinds:1},botCount:1});
 let t=await get('tables/'+r.tableId);const id=Object.keys(t.players)[0],p=t.players[id];assert.equal(names.generic(p.name),false);
 await db.doc('tables/'+r.tableId).update({['players.'+id+'.name']:'BOT 1'});const b=await bank(owner);await Engine.__engineInternals.tickTable(r.tableId,Date.now());t=await get('tables/'+r.tableId);
 assert.equal(names.generic(t.players[id].name),false);assert.equal(t.players[id].stack,p.stack);assert.equal(t.players[id].fundingUid,p.fundingUid);assert.equal(await bank(owner),b);
 const c=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Name checks',maxPlayers:6,buyIn:0,startAt:Date.now()+600000}});
 await call('pkTournament',owner,{op:'fillbots',tournamentId:c.tournamentId});let tor=await get('tournaments/'+c.tournamentId);assert.equal(new Set(Object.values(tor.players).map(p=>p.name)).size,6);assert.ok(Object.values(tor.players).every(p=>!names.generic(p.name)));
 const bid=Object.keys(tor.players)[0];await db.doc('tournaments/'+c.tournamentId).update({['players.'+bid+'.name']:'Bot 1'});await Tours.tickTournament(c.tournamentId);tor=await get('tournaments/'+c.tournamentId);assert.equal(names.generic(tor.players[bid].name),false);assert.equal(tor.status,'reg');
});
test('tournament settlement pays exactly the configured number of prize places and never pays twice',async()=>{
 for(const [mode,payouts,paidPct,expected]of [['three',[50,30,20],0,3],['two',[70,30],0,2],['percent',[100],40,2]]){
  const c=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Payout '+mode,maxPlayers:5,tableSize:5,buyIn:10,payouts,paidPct,startAt:Date.now()+600000}}),id=c.tournamentId;
  await call('pkTournament',owner,{op:'fillbots',tournamentId:id});await call('pkTournament',owner,{op:'start',tournamentId:id});const [row]=await rows(id),ids=Object.keys(row.players),roster={...(await get('tournaments/'+id)).players};
  // Feed the final settled hand into the actual server orchestrator.
  for(let i=0;i<ids.length;i++){const uid=ids[i];Object.assign(row.players[uid],{stack:i===0?50000:0,bet:0,status:i===0?'active':'out'});Object.assign(roster[uid],{out:i!==0,rank:i===0?null:i+1});}
  await db.doc('tables/'+row.docId).update({players:row.players});await db.doc('tournaments/'+id).update({players:roster});const b=await bank(owner);await Tours.tickTournament(id);const done=await get('tournaments/'+id);
  assert.equal(done.status,'done');assert.equal(done.results.filter(p=>p.prize>0).length,expected);assert.equal(done.results.reduce((n,p)=>n+p.prize,0),50);assert.equal(await bank(owner),b+50);
  await Tours.tickTournament(id);assert.equal(await bank(owner),b+50);
 }
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
test('bot rebuys require both an enabled window and sponsor funds, and never invent chips',async()=>{
 for(const mode of ['funded','disabled','empty']){
  const sponsor='rebuy_'+mode,clubId='club_'+mode;await db.doc('users/'+sponsor).set({username:sponsor});await db.doc('clubs/'+clubId).set({ownerUid:sponsor});await db.doc(`memberships/${sponsor}_${clubId}`).set({uid:sponsor,clubId,status:'approved',role:'club_owner',balance:mode==='empty'?20:100});
  const r=await call('pkTournament',sponsor,{op:'create',clubId,settings:{name:mode,maxPlayers:2,tableSize:2,buyIn:10,startStack:100,botFill:true,rebuys:mode!=='disabled',maxRebuys:1,rebuyUntilLevel:2,startAt:Date.now()+600000}}),id=r.tournamentId;await call('pkTournament',sponsor,{op:'start',tournamentId:id});
  const [row]=await rows(id),[a,b]=Object.keys(row.players),now=Date.now();await db.doc('tables/'+row.docId).update({['players.'+a+'.stack']:0,['players.'+a+'.status']:'busted',['players.'+a+'.bustedAt']:now-4000,['players.'+b+'.stack']:200});
  const before=(await get(`memberships/${sponsor}_${clubId}`)).balance;await Tours.tickTournament(id,now);const t=await get('tournaments/'+id),live=await get('tables/'+row.docId);
  if(mode==='funded'){assert.equal(live.players[a].stack,100);assert.equal(t.initialChips,300);assert.equal(t.players[a].rebuys,1);assert.equal((await get(`memberships/${sponsor}_${clubId}`)).balance,before-10);}else{assert.equal(t.players[a].out,true);assert.equal(t.initialChips,200);assert.equal(live.players[a]?.stack||0,0);}
 }
});
test('each-player and big-blind antes keep hand blinds fixed and conserve short stacks',()=>{
 for(const anteType of ['each','bb','none']){
  const now=Date.now(),players=Object.fromEntries([5,25,100].map((stack,i)=>['a'+i,{uid:'a'+i,name:'P'+i,seatIndex:i,stack,bet:0,cards:[],cardCount:0,status:'active'}]));
  const tor={id:'antes',status:'running',startedAt:now,anteType,structure:[{sb:10,bb:20,ante:10,mins:1},{sb:100,bb:200,ante:100,mins:1}]},S={id:'antes-table',tor,settings:{baseGameType:'NLH',actionTime:25,rakePercent:10},players,raw:{players:structuredClone(players)},table:{tournamentId:'antes',clubId:club,handCount:0,history:[]},gameState:{phase:'waiting'},priv:{},deck:null,effects:[],now};
  assert.equal(Engine.__engineInternals.startHand(S),'dealt');assert.equal(S.gameState.handBB,20);assert.equal(Core.chips([S]),130);S.now+=120000;
  let steps=0;while(S.gameState.phase!=='showdown'&&steps++<40){if(S.gameState.activeTurnUid)Engine.__engineInternals.applyAction(S,S.gameState.activeTurnUid,'call',undefined,false);else Engine.__engineInternals.advancePhase(S);assert.equal(Core.chips([S]),130);assert.equal(S.gameState.handBB,20);}
  assert.equal(S.gameState.phase,'showdown');assert.equal(S.table.history[0].rake,0);assert.ok(Object.values(S.players).every(p=>p.stack>=0));
 }
});
test('an all-bot multi-table tournament ends, balances tables, preserves chips and pays once',async()=>{
 const b=await bank(owner),created=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'All bots',maxPlayers:8,tableSize:3,buyIn:10,fee:1,bounty:2,bountyMode:'progressive',startStack:100,botFill:true,rebuys:false,startAt:Date.now()+600000,structure:[{sb:5,bb:10,ante:0,mins:1},{sb:25,bb:50,ante:50,mins:1},{sb:100,bb:200,ante:200,mins:1}]}}),id=created.tournamentId;
 await call('pkTournament',owner,{op:'start',tournamentId:id});let state=await get('tournaments/'+id);assert.equal((await rows(id)).length,3);let now=state.startedAt,steps=0;
 while(state.status==='running'&&steps++<360){now+=6000;await Tours.tickTournament(id,now);for(const row of await rows(id))await Engine.__engineInternals.tickTable(row.docId,now);await Tours.tickTournament(id,now);state=await get('tournaments/'+id);assert.equal(state.integrityIssue||null,null,'integrity on tick '+steps);assert.equal(Core.chips(await rows(id)),state.initialChips);}
 assert.equal(state.status,'done','all-bot tournament must finish without a browser');assert.equal((await rows(id)).length,1);assert.equal(state.results.length,8);assert.equal(new Set(state.results.map(p=>p.rank)).size,8);assert.equal(await bank(owner),b,'sponsor receives all bot awards, entries and fees exactly once');const paid=await bank(owner);await Tours.tickTournament(id,now+60000);assert.equal(await bank(owner),paid);
 console.log('All-bot tournament completed in '+steps+' ticks');
});

test('spectating managers fill all remaining seats atomically without sitting or overcharging the sponsor',async()=>{
 const manager='fill-manager';await fresh(manager);await db.doc(`memberships/${manager}_${club}`).update({role:'manager',managedGames:['poker']});
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{maxPlayers:6,minBuyIn:40,maxBuyIn:100,blinds:1}});
 await assert.rejects(call('pkSeat',uid,{tableId,op:'fillbots'}),e=>e.code==='permission-denied');
 const before=await bank(owner),request=req(manager,{tableId,op:'fillbots'});await Promise.all([Access.pkSeat.run(request),Access.pkSeat.run(request)]);
 const t=await get('tables/'+tableId),ps=Object.values(t.players),names=require('../../functions/botNames');assert.equal(ps.length,6);assert.equal(t.players[manager],undefined);assert.equal(await bank(owner),before-600);
 const families=ps.map(p=>names.familyKey(p.name)).filter(Boolean);assert.equal(new Set(families).size,families.length);assert.ok(ps.some(p=>names.language(p.name)==='en'));assert.ok(ps.some(p=>names.language(p.name)==='he'));assert.ok(ps.every(p=>p.botLeavesAt>p.botJoinedAt));
 assert.equal((await call('pkSeat',manager,{tableId,op:'fillbots'})).added,0);assert.equal(await bank(owner),before-600);
 const six=await call('pkTableCreate',owner,{clubId:club,botCount:'full',settings:{maxPlayers:9,baseGameType:'Omaha6',minBuyIn:40,maxBuyIn:100,blinds:1}});assert.equal(Object.keys((await get('tables/'+six.tableId)).players).length,7);
 const poor='unfunded-fill';await fresh(poor);const c=await call('pkClubCreate',poor,{name:'No funds'}),r=await call('pkTableCreate',poor,{clubId:c.id,settings:{}});
 await assert.rejects(call('pkSeat',poor,{tableId:r.tableId,op:'fillbots'}));assert.equal(Object.keys((await get('tables/'+r.tableId)).players).length,0,'insufficient funding creates no partial table');
});
test('lobby settings queue through an active hand, keep its rake and stacks, and apply at the next boundary',async()=>{
 const a='settings-a',b='settings-b';await fresh(a);await fresh(b);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{blinds:1,minBuyIn:40,maxBuyIn:200,rakePercent:6}});
 await call('pkSeat',a,{tableId,op:'join',amount:100});await call('pkSeat',b,{tableId,op:'join',amount:100});
 await assert.rejects(call('pkTableManage',a,{tableId,op:'settings',patch:{blinds:2}}),e=>e.code==='permission-denied');
 for(const patch of [{rakePercent:21},{blinds:0},{minBuyIn:300,maxBuyIn:100},{serverEngine:false},{players:{}},{rakePercent:''}])await assert.rejects(call('pkTableManage',owner,{tableId,op:'settings',patch}));
 await call('pkDeal',a,{tableId});const before=await get('tables/'+tableId);
 assert.equal((await call('pkTableManage',owner,{tableId,op:'settings',patch:{blinds:5,minBuyIn:100,maxBuyIn:500,rakePercent:20}})).queued,true);
 let t=await get('tables/'+tableId);assert.equal(t.settings.blinds,1);assert.equal(t.settings.rakePercent,6);assert.deepEqual(t.players,before.players);
 const act=async action=>{const t=await get('tables/'+tableId),g=t.gameState;await call('pkAct',g.activeTurnUid,{tableId,action,expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});};
 await act('call');await act('call');t=await get('tables/'+tableId);assert.equal(t.gameState.phase,'flop');await act('fold');t=await get('tables/'+tableId);assert.equal(t.gameState.phase,'showdown');assert.equal(t.gameState.lastWinAmount,3.76,'the settled pot still uses the original 6% rake');
 const chips=Core.chips([t]);await Engine.__engineInternals.tickTable(tableId,t.gameState.showdownAt+1000);t=await get('tables/'+tableId);assert.equal(t.pendingSettings,null);assert.equal(t.settings.blinds,5);assert.equal(t.settings.minBuyIn,100);assert.equal(t.settings.maxBuyIn,500);assert.equal(t.settings.rakePercent,20);assert.equal(Core.chips([t]),chips);
 await Engine.__engineInternals.tickTable(tableId,t.gameState.showdownAt+6000);t=await get('tables/'+tableId);assert.equal(t.gameState.highestBet,10);assert.equal(Core.chips([t]),chips);
});
test('cash bot rotation is staggered, boundary-only, preserves funds and removes obsolete private cards',async()=>{
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,botCount:3,settings:{maxPlayers:3,blinds:1,minBuyIn:40,maxBuyIn:100}});let t=await get('tables/'+tableId);const ids=Object.keys(t.players),now=Date.now();
 for(const id of ids){t.players[id].botLeavesAt=now-10000;await db.doc(`tables/${tableId}/priv/${id}`).set({cards:[{val:'A',suit:'♠'}]});}
 await db.doc('tables/'+tableId).update({players:t.players});const total=(await bank(owner))+Core.chips([t]);
 await Promise.all([Engine.__engineInternals.tickTable(tableId,now),Engine.__engineInternals.tickTable(tableId,now)]);t=await get('tables/'+tableId);
 const removed=ids.filter(id=>!t.players[id]),added=Object.keys(t.players).filter(id=>!ids.includes(id));assert.equal(removed.length,1);assert.equal(added.length,1);assert.equal((await bank(owner))+Core.chips([t]),total);assert.equal(await get(`tables/${tableId}/priv/${removed[0]}`),undefined);assert.ok(t.botRotateAfter>=now+1*60000);assert.ok(t.players[added[0]].botLeavesAt>=now+25*60000);assert.ok(t.players[added[0]].botLeavesAt<=now+35*60000);
 const inHandIds=Object.keys(t.players).sort();await Engine.__engineInternals.tickTable(tableId,now+1000);assert.deepEqual(Object.keys((await get('tables/'+tableId)).players).sort(),inHandIds,'another tick cannot rotate more seats in the same hand');
 // Put the same funded stacks at a settled boundary while the stagger gap is active.
 for(const p of Object.values(t.players)){p.stack+=p.bet;p.bet=0;p.cardCount=0;}
 await db.doc('tables/'+tableId).update({players:t.players,gameState:{phase:'showdown',showdownAt:now-10000,earlyWin:false,pots:[],board:[],handN:1,__seq:5}});await Engine.__engineInternals.tickTable(tableId,now+2000);assert.deepEqual(Object.keys((await get('tables/'+tableId)).players).sort(),inHandIds,'a hand boundary does not bypass the rotation spacing');
});
test('expired bot sessions never rotate out of Spin or tournaments',async()=>{
 const spin=await call('pkTableCreate',owner,{clubId:club,botCount:2,settings:{spinMode:true,spinBuyIn:10,spinStack:1000}}),now=Date.now();let t=await get('tables/'+spin.tableId);const ids=Object.keys(t.players);for(const p of Object.values(t.players))p.botLeavesAt=1;await db.doc('tables/'+spin.tableId).update({players:t.players});await Engine.__engineInternals.tickTable(spin.tableId,now);assert.deepEqual(Object.keys((await get('tables/'+spin.tableId)).players).sort(),ids.sort());
 const c=await call('pkTournament',owner,{op:'create',clubId:club,settings:{name:'Stable sessions',maxPlayers:6,tableSize:6,buyIn:0,botFill:true,startAt:now+600000}});await call('pkTournament',owner,{op:'start',tournamentId:c.tournamentId});const [row]=await rows(c.tournamentId),tourIds=Object.keys(row.players);for(const p of Object.values(row.players))p.botLeavesAt=1;await db.doc('tables/'+row.docId).update({players:row.players});await Engine.__engineInternals.tickTable(row.docId,now);assert.deepEqual(Object.keys((await get('tables/'+row.docId)).players).sort(),tourIds.sort());
});


test('approved managers administer members, agents, settings and reports throughout their own club',async()=>{
 const manager='full-manager',agent='full-agent',player='full-player';for(const u of [manager,agent,player])await fresh(u,0);
 await call('pkClubMember',owner,{clubId:club,targetUid:manager,op:'role',role:'manager',managedGames:[]});
 assert.ok((await get(`memberships/${manager}_${club}`)).managedGames.includes('poker'));
 await call('pkClubMember',manager,{clubId:club,targetUid:agent,op:'role',role:'agent',agentPct:20});
 await db.doc(`memberships/${player}_${club}`).update({status:'pending'});
 await call('pkClubMember',manager,{clubId:club,targetUid:player,op:'approve',agentUid:agent});
 assert.equal((await get(`memberships/${player}_${club}`)).status,'approved');assert.equal((await get(`memberships/${player}_${club}`)).agentUid,agent);
 await call('pkClubMember',manager,{clubId:club,targetUid:agent,op:'agent-settings',share:35});
 await call('pkClubMember',manager,{clubId:club,targetUid:player,op:'details',notes:'Manager note',phone:''});
 await call('pkClubMember',manager,{clubId:club,targetUid:player,op:'message',text:'Club message'});
 for(const op of ['ban','unban','photo-reset'])await call('pkClubMember',manager,{clubId:club,targetUid:player,op});
 await call('pkClubSettings',manager,{clubId:club,patch:{name:'Managed club',rakePct:5,botsAuto:true}});
 await call('pkSettlementNote',manager,{clubId:club,targetUid:player,amount:12,note:'Settlement correction'});
 await call('pkClubBroadcast',manager,{clubId:club,text:'Manager announcement'});
 await db.doc('agentLog/manager-visible').set({clubId:club,agentUid:agent,amount:5,at:Date.now()});
 await db.doc('agentLog/manager-hidden').set({clubId:'another-club',agentUid:agent,amount:7,at:Date.now()});
 await db.doc('securityAlerts/manager-visible').set({clubId:club,reason:'test'});
 const report=await call('pkClubDirectory',manager,{clubId:club,includeReports:true,includeSecurity:true});
 assert.ok(report.members.some(m=>m.uid===agent));assert.ok(report.agentLog.some(e=>e.agentUid===agent));assert.ok(report.agentLog.every(e=>e.clubId===club));
 assert.ok(report.gameLog.some(e=>e.uid===player&&e.by===manager));assert.ok(report.securityAlerts.some(e=>e.id==='manager-visible'));assert.equal(report.treasury.uid,owner);
 const scoped=await call('pkClubDirectory',agent,{clubId:club,includeReports:true,includeSecurity:true});assert.equal(scoped.treasury,null);assert.equal(scoped.securityAlerts.length,0);assert.ok(scoped.members.every(m=>m.uid===agent||m.agentUid===agent));assert.ok(scoped.gameLog.every(e=>e.uid===agent||e.uid===player));
 for(const op of ['ban','reject','role'])await assert.rejects(call('pkClubMember',manager,{clubId:club,targetUid:owner,op,role:'player'}));
 await assert.rejects(call('pkClubMember',manager,{clubId:club,targetUid:player,op:'role',role:'super_admin'}));
 await assert.rejects(call('pkClubSettings',manager,{clubId:club,patch:{ownerUid:manager}}));
});

test('manager deposits and withdrawals use club funds, serialize concurrent spend and audit the actor once',async()=>{
 const cid='manager-finance',boss='finance-owner',manager='finance-manager',agent='finance-agent',player='finance-player';
 await db.doc('clubs/'+cid).set({ownerUid:boss});
 for(const [u,role,balance]of [[boss,'club_owner',100],[manager,'manager',0],[agent,'agent',0],[player,'player',0]])await db.doc(`memberships/${u}_${cid}`).set({uid:u,clubId:cid,role,status:'approved',balance});
 const balance=async u=>(await get(`memberships/${u}_${cid}`)).balance,move=(targetUid,amount)=>call('pkClubMember',manager,{clubId:cid,targetUid,op:'transfer',amount});
 const results=await Promise.allSettled([move(agent,80),move(player,80)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await balance(boss),20);assert.equal(await balance(manager),0);
 const funded=await balance(agent)?agent:player,empty=funded===agent?player:agent;
 const request=req(manager,{clubId:cid,targetUid:funded,op:'transfer',amount:-30});await Promise.all([Access.pkClubMember.run(request),Access.pkClubMember.run(request)]);
 assert.equal(await balance(boss),50);assert.equal(await balance(funded),50);assert.equal(await balance(manager),0);
 for(const [target,amount]of [[empty,-1],[funded,-51],[empty,51],[boss,1]])await assert.rejects(move(target,amount));
 assert.equal(await balance(boss),50);assert.equal(await balance(funded),50);
 const audit=(await db.collection('_pkAudit').where('clubId','==',cid).get()).docs.map(d=>d.data());assert.equal(audit.length,2);assert.ok(audit.every(a=>a.uid===manager&&a.fundingUid===boss&&a.action==='member-transfer'));assert.deepEqual(audit.map(a=>a.amount).sort((a,b)=>a-b),[-30,80]);
 const ledger=(await db.collection('_pkLedger').where('clubId','==',cid).get()).docs.map(d=>d.data());assert.equal(ledger.length,2);assert.ok(ledger.every(l=>l.source==='transfer:'+manager&&l.movements.reduce((n,m)=>n+m.amount,0)===0));
});

test('revoked, pending, banned and other-club managers cannot retain financial or administrative authority',async()=>{
 const manager='revocable-manager';await fresh(manager,0);const ref=db.doc(`memberships/${manager}_${club}`);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{}});
 const actions=[()=>call('pkClubMember',manager,{clubId:club,targetUid:uid,op:'transfer',amount:10}),()=>call('pkClubMember',manager,{clubId:club,targetUid:uid,op:'approve'}),()=>call('pkClubMember',manager,{clubId:club,targetUid:manager,op:'role',role:'manager'}),()=>call('pkClubSettings',manager,{clubId:club,patch:{name:'Denied'}}),()=>call('pkClubBroadcast',manager,{clubId:club,text:'Denied message'}),()=>call('pkSettlementNote',manager,{clubId:club,targetUid:uid,note:'Denied',amount:5}),()=>call('pkTableManage',manager,{tableId,op:'delete'}),()=>call('pkClubDirectory',manager,{clubId:club,includeReports:true})];
 for(const patch of [{role:'manager',status:'pending'},{role:'manager',status:'banned'},{role:'player',status:'approved'},{role:'club_owner',status:'approved'}]){await ref.update(patch);for(const action of actions)await assert.rejects(action,e=>e.code==='permission-denied');}
 await ref.update({role:'manager',status:'approved'});await call('pkClubSettings',manager,{clubId:club,patch:{name:'Allowed'}});
 await db.doc('clubs/other-managed-club').set({ownerUid:owner});await assert.rejects(call('pkClubSettings',manager,{clubId:'other-managed-club',patch:{name:'Not allowed'},role:'club_owner'}),e=>e.code==='permission-denied');
 await call('pkClubMember',owner,{clubId:club,targetUid:manager,op:'role',role:'player'});for(const action of actions)await assert.rejects(action,e=>e.code==='permission-denied');
 await call('pkTableManage',owner,{tableId,op:'delete'});
});

test('manager-created tournament reserves and cancellation refunds both use the club treasury',async()=>{
 const manager='tournament-manager';await fresh(manager,0);await db.doc(`memberships/${manager}_${club}`).update({role:'manager'});
 const before=await bank(owner),{tournamentId}=await call('pkTournament',manager,{op:'create',clubId:club,settings:{name:'Managed prize',addedPrize:75,minPlayers:2,maxPlayers:2}});
 const event=await get('tournaments/'+tournamentId);assert.equal(event.creatorUid,manager);assert.equal(event.bountyFundingUid,owner);assert.equal(await bank(owner),before-75);assert.equal(await bank(manager),0);
 await call('pkTournament',manager,{op:'cancel',tournamentId});await call('pkTournament',manager,{op:'cancel',tournamentId});assert.equal(await bank(owner),before);assert.equal(await bank(manager),0);
});

test('built-in cash variants open with a full funded bot roster without seating the manager',async()=>{
 const manager='quick-manager';await fresh(manager,0);await db.doc(`memberships/${manager}_${club}`).update({role:'manager',managedGames:[]});
 for(const game of ['NLH','Omaha 4','Omaha 5','Omaha 6','Pineapple']){
  const before=await bank(owner),{tableId}=await call('pkTableCreate',manager,{clubId:club,botCount:'full',settings:{baseGameType:game,blinds:.5,minBuyIn:250,maxBuyIn:250,rakePercent:4,maxPlayers:6,autoStart:2}});
  const table=await get('tables/'+tableId);assert.equal(table.settings.baseGameType,game);assert.equal(table.settings.rakePercent,4);assert.equal(Object.keys(table.players).length,6);assert.equal(table.players[manager],undefined);assert.ok(Object.values(table.players).every(p=>p.isBot&&p.stack===250&&p.fundingUid===owner));assert.equal(await bank(owner),before-1500);assert.equal(await bank(manager),0);
  const names=Object.values(table.players).map(p=>p.name);assert.ok(names.some(n=>/[A-Za-z]/.test(n)));assert.ok(names.some(n=>/[א-ת]/.test(n)));
  await call('pkTableManage',manager,{tableId,op:'delete'});assert.equal(await bank(owner),before);
 }
});

test('frequent ticks do not shorten thinking time or duplicate a bot move, while human actions advance immediately',async()=>{
 const a='latency-a',b='latency-b';await fresh(a);await fresh(b);
 const {tableId}=await call('pkTableCreate',owner,{clubId:club,settings:{minBuyIn:100,maxBuyIn:100,blinds:.5,maxPlayers:2}});
 for(const u of [a,b])await call('pkSeat',u,{tableId,op:'join',amount:100});
 await Engine.__engineInternals.tickTable(tableId);let table=await get('tables/'+tableId),g=table.gameState;
 await Engine.__engineInternals.tickTable(tableId,g.turnStartedAt+1000);assert.equal((await get('tables/'+tableId)).gameState.__seq,g.__seq,'a thinking human is not auto-acted');
 await call('pkAct',g.activeTurnUid,{tableId,action:'call',expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});assert.equal((await get('tables/'+tableId)).gameState.__seq,g.__seq+1,'human action never waits for a polling tick');
 const created=await call('pkTableCreate',owner,{clubId:club,botCount:'full',settings:{minBuyIn:100,maxBuyIn:100,blinds:.5,maxPlayers:2}});await Engine.__engineInternals.tickTable(created.tableId);table=await get('tables/'+created.tableId);g=table.gameState;
 await Engine.__engineInternals.tickTable(created.tableId,g.turnStartedAt+2100);assert.equal((await get('tables/'+created.tableId)).gameState.__seq,g.__seq);
 await Promise.all([1,2,3].map(()=>Engine.__engineInternals.tickTable(created.tableId,g.turnStartedAt+2300)));assert.equal((await get('tables/'+created.tableId)).gameState.__seq,g.__seq+1,'only one due bot move commits across racing viewers');
});
