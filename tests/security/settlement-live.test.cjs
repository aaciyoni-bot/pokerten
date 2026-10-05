'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const admin=require('../../functions/node_modules/firebase-admin');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Settlement tests require the Firestore emulator; never use production');
admin.initializeApp({projectId:'demo-pokerten-security'});const db=admin.firestore();
const api=require('../../functions/pokerSettlement'),profile=require('../../functions/pokerProfile'),S=require('../../functions/settlementStore');
const cid='settlement_live_regression',owner='live_owner',agent='live_agent',uid='live_player',zero='live_zero';
const identity=who=>({uid:who,token:{email:who+'@example.test',email_verified:true}});
const call=(name,who,data={})=>api[name].run({auth:identity(who),data:{clubId:cid,requestId:crypto.randomUUID(),...data}});
const cmd=(action,data={})=>call('pkSettlement',owner,{action,...data});
const report=(who=uid,cycleId)=>call('pkSettlementReport',who,cycleId?{cycleId}:{});
const accounting=async()=>(await profile.pkClubDirectory.run({auth:identity(uid),data:{clubId:cid,accountingOnly:true}})).accounting;
const root=db.doc('settlementClubs/'+cid),table1=db.doc('tables/settlement_live_one'),table2=db.doc('tables/settlement_live_two');
const sitting=table=>root.collection('sittings').doc(S.hash(table.id,uid));
after(async()=>{await db.terminate();await admin.app().delete();});
async function settled(table,stack,rake=0,hands=1){
 await db.runTransaction(async tx=>{
  const data=(await tx.get(table)).data();
  const write=await S.prepareJournal(db,tx,cid,[{type:'settlementHands',entries:[{uid,hands,tableName:data.name,gameType:'NLH'}]},...(rake?[{type:'rake',rake,rakeSource:'human',allocations:[{uid,amount:rake}]}]:[])],table.id,Date.now());
  write();tx.update(table,{players:{...data.players,[uid]:{...data.players[uid],stack,bet:0,pendingTopUp:0}},gameState:{phase:'showdown'}});
 });
}
async function cashOut(table){
 await db.runTransaction(async tx=>{
  const data=(await tx.get(table)).data(),seat=data.players[uid],member=await tx.get(db.doc(`memberships/${uid}_${cid}`));
  const wealth=seat.stack+(seat.bet||0)+(seat.pendingTopUp||0),profit=wealth-seat.buyTotal;
  const write=await S.prepareJournal(db,tx,cid,[{type:'gameLog',entries:[{uid,username:uid,profit}]}],table.id,Date.now());
  write();const players={...data.players};delete players[uid];tx.update(table,{players});
  tx.update(member.ref,{balance:member.data().balance+wealth});
  tx.set(db.collection('gameLog').doc(),{clubId:cid,uid,tableId:table.id,profit,rake:0,at:Date.now()});
 });
}
test('live sessions, exact unfinished-hand wealth, manual boundaries, cash-out and reopen stay consistent',async()=>{
 await db.recursiveDelete(root);await db.doc('clubs/'+cid).set({ownerUid:owner});
 for(const [who,role,balance,agentUid] of [[owner,'club_owner',2000,''],[agent,'agent',100,''],[uid,'player',40,agent],[zero,'player',5,'']])await db.doc(`memberships/${who}_${cid}`).set({uid:who,clubId:cid,username:who,role,status:'approved',balance,agentUid,agentPct:50});
 await table1.set({clubId:cid,type:'poker',name:'Cash one',settings:{ante:5,pokerType:'NLH'},players:{[uid]:{uid,stack:80,buyTotal:100},[zero]:{uid:zero,stack:20,buyTotal:20}},gameState:{phase:'showdown'}});
 await table2.set({clubId:cid,type:'poker',name:'Cash two',settings:{ante:0,pokerType:'NLH'},players:{[uid]:{uid,stack:70,buyTotal:60}},gameState:{phase:'showdown'}});
 await cmd('setLegacyPeriodStart',{startAt:Date.now()-86400000});await cmd('closeLegacy');
 assert.equal((await sitting(table1).get()).data().baseline,-2000);assert.equal((await sitting(table2).get()).data().baseline,1000);
 assert.equal((await report()).player.totals.result,0);assert.equal((await accounting()).players[uid].result,0);
 await call('pkSettlementTerms',owner,{targetUid:agent,patch:{agentPct:50,agentType:'rake'}});
 await settled(table1,65,2,1);await settled(table2,75,1,1);
 let own=await report(),a=await report(agent),money=await accounting();
 assert.equal(own.player.totals.result,-1000);assert.equal(money.players[uid].result,-10);assert.equal(own.player.totals.hands,2);
 assert.equal(a.agent.rake,300);assert.equal(a.agent.commission,150);assert.equal(a.agent.toClub,850);
 assert.doesNotMatch(JSON.stringify(a),/totalResult|totalRake/);assert.doesNotMatch(JSON.stringify(own),/rakeback|"rake"|agentPct|secondary/);
 // A pending top-up adds equally to held wealth and buy-in. Betting/folding has
 // no result until award, including a short stack whose actual ante is below 5.
 await table1.update({players:{[uid]:{uid,stack:0,bet:60,pendingTopUp:10,buyTotal:110},[zero]:{uid:zero,stack:20,buyTotal:20}},gameState:{phase:'river',handStartWealth:{[uid]:65},handStartStacks:{[uid]:60}}});
 assert.equal((await report()).player.totals.result,-1000);assert.equal((await accounting()).players[uid].chips,190);
 await table2.update({players:{[uid]:{uid,stack:0,bet:1,buyTotal:60}},settings:{ante:5,pokerType:'NLH'},gameState:{phase:'flop',handStartWealth:{[uid]:75},handStartStacks:{[uid]:70}}});
 assert.equal((await report()).player.totals.result,-1000);
 // Non-table tournament counters are not reset by a cash-cycle boundary.
 const tournamentCounter=root.collection('sittings').doc(S.hash('tournament:pending',uid));
 await tournamentCounter.set({uid,source:'tournament:pending',rake:700,hands:3,baseline:0});
 const beforeTables=[(await table1.get()).data(),(await table2.get()).data()],beforeMembers=(await db.collection('memberships').where('clubId','==',cid).get()).docs.map(d=>d.data());
 const requestId=crypto.randomUUID();await cmd('close',{requestId});await cmd('close',{requestId});
 assert.equal((await root.get()).data().currentCycleId,'cycle_2','retry must not create a second close');
 assert.deepEqual([(await table1.get()).data(),(await table2.get()).data()],beforeTables);assert.deepEqual((await db.collection('memberships').where('clubId','==',cid).get()).docs.map(d=>d.data()),beforeMembers);
 assert.equal((await sitting(table1).get()).data().baseline,-3500);assert.equal((await sitting(table1).get()).data().rake,0);assert.equal((await sitting(table1).get()).data().hands,0);
 assert.equal((await root.collection('sittings').doc(S.hash(table1.id,zero)).get()).data().baseline,0,'zero activity cash seats also get a boundary');
 assert.equal((await tournamentCounter.get()).data().rake,700);assert.equal((await tournamentCounter.get()).data().hands,3);
 assert.equal((await report(uid,'cycle_1')).player.totals.result,-1000);assert.equal((await report()).player.totals.result,0);assert.equal((await accounting()).players[uid].result,0);
 // Reopen keeps immutable segments and the seat baseline, then appends another
 // segment on the next manual close rather than overwriting the original.
 await cmd('reopen');assert.equal((await report()).cycle.id,'cycle_1');assert.equal((await report()).player.totals.result,-1000);
 await settled(table1,85,0.5,1); // buyTotal 110 => cumulative -25, +10 since close
 assert.equal((await report()).player.totals.result,0);await cmd('close');
 assert.equal((await root.collection('sessions').where('cycleId','==','cycle_1').get()).size,3);assert.equal((await report(uid,'cycle_1')).player.totals.result,0);
 // A completed zero-result hand is activity and blocks an accidental reopen.
 await settled(table2,75,0,1);await assert.rejects(cmd('reopen'),/must be empty/);
 await settled(table1,80,1,1); // current cycle -5
 own=await report();assert.equal(own.player.totals.result,-500);assert.equal((await accounting()).players[uid].result,-5);assert.equal((await report(uid,'cycle_1')).player.totals.result,0);
 const all=await report(owner,'all');assert.equal(all.details.find(p=>p.playerId===uid).totals.result,-500,'aggregate includes the current live residual only once');
 await cashOut(table1);assert.equal((await sitting(table1).get()).exists,false);
 assert.equal((await report()).player.totals.result,-500);assert.equal((await accounting()).players[uid].result,-5,'cash-out replaces the live segment without double-counting');
 assert.equal((await report(uid,'cycle_1')).player.totals.result,0,'closed report cannot move after a later cash-out');
 const range=await call('pkSettlementReport',uid,{fromAt:Date.now()-86400000,toAt:Date.now()+1000});
 assert.equal(range.legacyReport.totals.result,-3000,'date range retains explicitly documented recorded cash-out basis');
 // Both operations read the shared cycle pointer/table/counter in their own
 // transactions. Whichever commits first, retry must preserve the same result.
 await settled(table2,65,0,1);
 await Promise.all([cmd('close'),cashOut(table2)]);
 assert.equal((await report(owner,'all')).details.find(p=>p.playerId===uid).totals.result,-1500,'concurrent cash-out and close include each segment exactly once');
 assert.equal((await report(uid,'cycle_2')).player.totals.result,-1500);assert.equal((await report()).player.totals.result,0);
 assert.equal((await sitting(table2).get()).exists,false);
 // Exact pre-ante wealth also avoids fabricating profit for a partial ante.
 const partial= require('../../functions/pokerAccounting').buildAccounting([{uid,status:'approved',balance:0}],[],[{settings:{ante:5},players:{[uid]:{uid,stack:0,bet:0,buyTotal:2}},gameState:{phase:'flop',handStartWealth:{[uid]:2},handStartStacks:{[uid]:0}}}],{cycle:{legacy:true,id:'legacy_current',status:'open',startAt:0}});
 assert.equal(partial.players[uid].result,0);assert.equal(partial.players[uid].chips,2);
});
