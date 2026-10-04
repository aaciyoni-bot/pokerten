'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const admin=require('../../functions/node_modules/firebase-admin');
const initializeApp=(...args)=>admin.initializeApp(...args),getFirestore=()=>admin.firestore();
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Settlement tests require the Firestore emulator; never use production');
initializeApp({projectId:'demo-pokerten-security'});const db=getFirestore();
const api=require('../../functions/pokerSettlement'),{prepareLedger}=require('../../functions/pokerLedger');
const profile=require('../../functions/pokerProfile');
const cid='settlement_regression',identity=uid=>({uid,token:{email:uid+'@example.test',email_verified:true}});
const call=(name,uid,data={})=>api[name].run({auth:identity(uid),data:{clubId:cid,requestId:crypto.randomUUID(),...data}});
const cmd=(uid,action,data={})=>call('pkSettlement',uid,{action,...data});
const report=(uid,cycleId)=>call('pkSettlementReport',uid,cycleId?{cycleId}:{});
const accounting=async uid=>(await profile.pkClubDirectory.run({auth:identity(uid),data:{clubId:cid,accountingOnly:true}})).accounting;
const ref=()=>db.doc('settlementClubs/'+cid);
after(async()=>{await db.terminate();await admin.app().delete();});
const members=[['owner','club_owner',5000,null],['agentA','agent',100,null],['agentB','agent',200,null],['lead','agent',0,null],['A','player',159.83,'agentA'],['B','player',1000,'agentA'],['C','player',400,'agentA'],['D','player',500,'agentB'],['legacy','player',50,'agentA']];
before(async()=>{
 await db.recursiveDelete(ref());await db.doc('clubs/'+cid).set({ownerUid:'owner',name:'Settlement isolated test'});
 for(const [uid,role,balance,agentUid] of members)await db.doc(`memberships/${uid}_${cid}`).set({uid,clubId:cid,role,balance,agentUid:agentUid||'',agentPct:uid==='D'?40:50,agentSharePct:role==='agent'?uid==='agentB'?40:50:0,status:'approved',username:uid,agentProfits:role==='agent'?75:0});
 await db.doc('tables/settlement_legacy_table').set({clubId:cid,name:'Existing sitting',gameState:{phase:'flop',handStartStacks:{legacy:158.83}},players:{legacy:{uid:'legacy',stack:100,bet:20,buyTotal:500}},settings:{serverEngine:true,pokerType:'NLH',ante:1}});
 await db.doc('gameLog/settlement_current_a').set({clubId:cid,uid:'A',profit:-200,rake:20,at:Date.now()});
 await db.doc('gameLog/settlement_current_b').set({clubId:cid,uid:'B',profit:500,rake:10,at:Date.now()});
 await db.doc('agentLog/settlement_current_agent').set({clubId:cid,agentUid:'agentA',playerUid:'A',amount:14,rakeSource:'human',accountingVersion:2,at:Date.now()});
 await db.doc('gameLog/settlement_old_history').set({clubId:cid,uid:'legacy',profit:-80,rake:2,at:Date.now()});
 await db.doc('clubs/settlement_other').set({ownerUid:'outsider'});
 await db.doc('memberships/outsider_settlement_other').set({uid:'outsider',clubId:'settlement_other',role:'club_owner',status:'approved',balance:99});
});
async function record(uid,result,rake,hands,source='session_'+crypto.randomUUID()){
 await db.runTransaction(async tx=>{const write=await prepareLedger(db,tx,cid,[{type:'settlementHands',entries:[{uid,hands,tableName:source,gameType:'NLH'}]},{type:'gameLog',entries:[{uid,username:uid,profit:result,rake:0}]},...(rake?[{type:'rake',rake,allocations:[{uid,amount:rake}]}]:[])],source,Date.now());write();});
}
test('settlement lifecycle, permissions, preserved balances and payment confirmation',async()=>{
 await assert.rejects(cmd('A','initialize'),/מנהל/);
 const beforeBalances=await db.collection('memberships').where('clubId','==',cid).get();
 const live=await report('owner'),ownLive=await report('A'),agentLive=await report('agentA');
 assert.equal(live.legacy,true);assert.equal(live.cycle.status,'open');assert.equal(live.canClose,true);
 assert.equal(live.legacyReport.players.find(p=>p.uid==='A').result,-20000);assert.equal(live.legacyReport.players.find(p=>p.uid==='B').result,50000);
 assert.equal(agentLive.legacyReport.totals.commission,1400);assert.equal(agentLive.legacyReport.players.some(p=>p.uid==='D'),false);assert.equal(agentLive.canClose,false);
 assert.equal(ownLive.legacyReport.players.length,1);assert.equal(ownLive.legacyReport.totals.result,-20000);assert.doesNotMatch(JSON.stringify(ownLive),/totalResult|rake|commission|agentUid|agentProfits|Pct/);
 await assert.rejects(report('A','all'),/מחזור מסוים/);
 assert.equal((await ref().get()).exists,false,'reading the legacy cycle must never initialize it');await assert.rejects(report('outsider'),/חברות/);
 await cmd('owner','closeLegacy');const afterBalances=await db.collection('memberships').where('clubId','==',cid).get();assert.deepEqual(afterBalances.docs.map(d=>d.data()),beforeBalances.docs.map(d=>d.data()));
 assert.equal((await db.doc('gameLog/settlement_old_history').get()).data().profit,-80);
 const archived=await report('A','legacy_current');assert.equal(archived.legacy,true);assert.equal(archived.cycle.status,'closed');assert.equal(archived.canClose,false);assert.equal(archived.legacyReport.totals.result,-20000);assert.doesNotMatch(JSON.stringify(archived),/rake|commission|agentUid|agentProfits|Pct/);
 assert.ok((await report('owner')).cycles.find(c=>c.id==='legacy_current'));
 assert.equal((await report('owner')).club.totals.closing,0);assert.equal((await report('A')).player.opening,0);
 const initialPlayer=await report('A');assert.equal(initialPlayer.chips,15983);assert.equal('totalResult'in initialPlayer,false);assert.equal((await ref().collection('sittings').doc(require('../../functions/settlementStore').hash('settlement_legacy_table','legacy')).get()).data().baseline,-34017);assert.doesNotMatch(JSON.stringify(initialPlayer),/rakeback|"rake"|Pct|agentProfits|secondary/i);
 const initialAccounting=await accounting('A');assert.equal(initialAccounting.cycleId,'cycle_1');assert.equal(initialAccounting.basis,'settlement-cycle-completed-sessions');assert.equal(initialAccounting.players.A.result,0);assert.equal('totalResult'in initialAccounting.players.A,false);
 const openAccounting=await accounting('legacy');assert.equal(openAccounting.players.legacy.result,0);assert.equal(openAccounting.players.legacy.openSessions,1);assert.equal(openAccounting.players.legacy.chips,209.83);
 await assert.rejects(report('outsider'),/חברות/);await assert.rejects(call('pkSettlementTerms','A',{action:'list'}),/הרשאה/);
 await call('pkSettlementTerms','owner',{targetUid:'A',patch:{rakebackPct:30}});
 await call('pkSettlementTerms','owner',{targetUid:'agentA',patch:{agentType:'rake',agentPct:50}});
 await call('pkSettlementTerms','owner',{targetUid:'agentB',patch:{agentType:'rake',agentPct:40}});
 await assert.rejects(call('pkSettlementTerms','agentB',{targetUid:'A',patch:{rakebackPct:20}}),/רייקבק/);
 await assert.rejects(call('pkSettlementTerms','agentA',{targetUid:'A',patch:{rakebackPct:51}}),/גבוהים/);
 await record('A',-1200,350,410);await record('A',-1000,200,180);await record('A',200,50,95,'tournament:regression');await record('B',1200,400,520);await record('C',-500,250,300);await record('D',3000,2000,800);
 let owner=await report('owner'),a=await report('agentA'),p=await report('A');
 assert.equal(p.player.closing,-182000);assert.equal(p.player.totals.hands,685);assert.equal(p.player.rakebackTotal,18000);assert.doesNotMatch(JSON.stringify(p),/"rake"|Pct|agentType|agentProfits/);
 assert.equal((await accounting('A')).players.A.result,p.player.totals.result/100,'management and the settlement statement must use the same cycle journal');
 assert.equal(a.agent.toClub,67500);assert.equal(a.agent.earnings,44500);assert.equal(a.details.some(d=>d.playerId==='D'),false);assert.equal(a.funds.some(m=>m.uid==='D'),false);
 assert.equal(owner.club.totals.closing,-312500);assert.equal(owner.agents.find(a=>a.agentId==='agentB').closing,-380000);
 const zero=await report('B');assert.doesNotMatch(JSON.stringify(zero),/rakeback/i);
 // Chips loaded directly in the test fixture are not settlement payments.
 await db.doc(`memberships/A_${cid}`).update({balance:9999});assert.equal((await report('A')).player.closing,-182000);
 // Freeze past terms. A secondary agent receives just the lead and player name.
 await call('pkSettlementTerms','owner',{targetUid:'C',patch:{secondaryAgentId:'lead',secondaryPct:10}});await record('C',0,10,1);
 const lead=await report('lead');assert.equal(lead.agent.leadsIncome,100);assert.deepEqual(Object.keys(lead.agent.leads[0]).sort(),['commission','playerId','playerName']);assert.deepEqual(lead.details,[]);assert.equal(lead.funds.some(m=>m.uid==='C'),false);
 assert.equal((await report('A')).player.closing,-182000);
 // Existing open sitting -340.17 remains in the archive. New -10 only is booked.
 await record('legacy',-350.17,0,2,'settlement_legacy_table');assert.equal((await report('legacy')).player.totals.result,-1000);assert.equal((await accounting('legacy')).players.legacy.result,-10,'the journal already excluded pre-activation open-session loss');
 const archive=await call('pkSettlementArchive','A');assert.equal(archive.rows.length,1);assert.equal(archive.rows[0].balance,159.83);assert.doesNotMatch(JSON.stringify(archive),/rake|Pct/i);
 // An initiator cannot approve their own payment, even the club owner.
 await cmd('agentA','payment',{type:'agent',agentId:'agentA',fromId:'agentA',toId:'owner',amount:50});let pending=(await report('agentA')).payments.find(p=>p.status==='pending');
 await assert.rejects(cmd('agentA','confirmPayment',{paymentId:pending.id}),/הצד/);await assert.rejects(cmd('agentB','confirmPayment',{paymentId:pending.id}),/הצד/);
 const oldA=(await report('A')).player.closing;
 await cmd('owner','close');assert.equal((await report('A')).player.opening,oldA);assert.equal((await report('A')).player.closing,oldA);
 const nextAccounting=await accounting('A');assert.equal(nextAccounting.cycleId,'cycle_2');assert.equal(nextAccounting.players.A.result,0,'previous-cycle games and carried settlement balance do not become new-cycle profit/loss');
 await cmd('owner','lock',{cycleId:'cycle_1'});const frozen=(await report('agentA','cycle_1')).agent.closing;
 await cmd('owner','confirmPayment',{paymentId:pending.id});assert.equal((await report('agentA','cycle_1')).agent.closing,frozen);
 await cmd('A','payment',{type:'player',agentId:'agentA',playerId:'A',fromId:'A',toId:'agentA',amount:1000});pending=(await report('A')).payments.find(p=>p.status==='pending');assert.equal((await report('A')).player.closing,-182000);
 await cmd('agentA','confirmPayment',{paymentId:pending.id});assert.equal((await report('A')).player.closing,-82000);
 await assert.rejects(cmd('owner','reopen'),/ריק|נעול/);await assert.rejects(cmd('A','close'),/מנהל/);
 await assert.rejects(report('A','all'),/מחזור מסוים/);assert.equal((await report('A','cycle_1')).player.closing,-182000,'individual historical cycles remain authorized');
 await cmd('owner','close');await cmd('owner','reopen');assert.equal((await report('owner')).cycle.id,'cycle_2');
 const requestId=crypto.randomUUID();await call('pkSettlement','owner',{action:'setEnd',requestId,endAt:Date.now()+86400000,autoClose:false});
 await assert.rejects(call('pkSettlement','owner',{action:'close',requestId}),/already used/);
});
