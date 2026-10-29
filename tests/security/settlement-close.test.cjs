'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Cycle closure tests require the Firestore emulator; never production');
const admin=require('../../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'demo-pokerten-security'});const db=admin.firestore();
require('../../functions/pokerSecurity').requirePokerAvailable=()=>{};
const Settlement=require('../../functions/pokerSettlement'),Access=require('../../functions/pokerAccess'),Engine=require('../../functions/pokerEngine');
const api={...Settlement,...Access,...Engine},get=async p=>(await db.doc(p).get()).data();let serial=0;
after(async()=>{await db.terminate();await admin.app().delete();});
async function fixture(){
 const cid='close_cycle_'+(++serial),owner=cid+'_owner',a=cid+'_a',b=cid+'_b';
 const call=(name,uid,data={})=>api[name].run({auth:{uid,token:{email:uid+'@example.test',email_verified:true}},data:{clubId:cid,requestId:crypto.randomUUID(),...data}});
 await db.doc('clubs/'+cid).set({ownerUid:owner});
 for(const uid of [owner,a,b]){await db.doc('users/'+uid).set({username:uid});await db.doc(`memberships/${uid}_${cid}`).set({uid,clubId:cid,username:uid,role:uid===owner?'club_owner':'player',status:'approved',balance:1000});}
 const cmd=(action,data={})=>call('pkSettlement',owner,{action,...data}),report=(uid=owner,cycleId)=>call('pkSettlementReport',uid,cycleId?{cycleId}:{}),bank=uid=>get(`memberships/${uid}_${cid}`).then(m=>m.balance);
 await cmd('setLegacyPeriodStart',{startAt:Date.now()-86400000});
 const table=async(botCount=0)=>(await call('pkTableCreate',owner,{manual:true,botCount,settings:{minBuyIn:40,maxBuyIn:200,blinds:1}})).tableId;
 return{cid,owner,a,b,call,cmd,report,bank,table,root:'settlementClubs/'+cid};
}
test('bulk close waits for the real hand, returns all chips once, then saves the legacy report and opens zero',async()=>{
 const f=await fixture(),idle=await f.table(2),live=await f.table();
 for(const uid of [f.a,f.b])await f.call('pkSeat',uid,{tableId:live,op:'join',amount:100});
 await f.call('pkDeal',f.a,{tableId:live});await f.call('pkSeat',f.a,{tableId:live,op:'topup',amount:10});
 const before=await get('tables/'+live),requestId=crypto.randomUUID();
 await assert.rejects(f.call('pkSettlement',f.a,{action:'beginCloseAll',expectedCycleId:'legacy_current'}),/club managers/);
 const start=await f.cmd('beginCloseAll',{expectedCycleId:'legacy_current',requestId});assert.equal(start.closing,true);
 assert.equal(await get('tables/'+idle),undefined);assert.equal(await f.bank(f.owner),1000,'bot sponsors are refunded');
 let t=await get('tables/'+live);assert.deepEqual(t.players,before.players);assert.deepEqual(t.gameState.pots,before.gameState.pots);assert.equal(t.gameState.activeTurnUid,before.gameState.activeTurnUid);
 assert.equal(await get(f.root),undefined,'cycle cannot advance before the pending hand and payouts finish');
 await assert.rejects(f.table(),/cycle is closing/);await assert.rejects(f.call('pkSeat',f.a,{tableId:live,op:'topup',amount:10}),/cycle is closing/);await assert.rejects(f.cmd('closeLegacy'),/finishes closing/);
 const own=await f.report(f.a);assert.equal(own.cycleClose,undefined,'players do not receive management controls');
 const g=t.gameState;await f.call('pkAct',g.activeTurnUid,{tableId:live,action:'fold',expectedTurn:{handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet}});
 t=await get('tables/'+live);const expected=Object.fromEntries([f.a,f.b].map(uid=>[uid,Math.round((t.players[uid].stack+(t.players[uid].pendingTopUp||0)-t.players[uid].buyTotal)*100)]));
 // Age only the display timer; keep the ledger's recording time at real now.
 await db.doc('tables/'+live).update({'gameState.showdownAt':Date.now()-6000});await Engine.__engineInternals.tickTable(live);
 // A server continuation finishes even if the initiating browser disappeared.
 await Settlement.pkSettlementTick.run({});assert.equal((await get(f.root)).currentCycleId,'cycle_1');
 const old=await f.report(f.owner,'legacy_current');for(const uid of [f.a,f.b])assert.equal(old.legacyReport.players.find(p=>p.uid===uid).result,expected[uid]);
 for(const uid of [f.a,f.b]){assert.equal((await f.report(uid)).player.totals.result,0);assert.equal(await f.bank(uid),1000+expected[uid]/100);}
 assert.equal((await get('clubs/'+f.cid)).settlementClosing,null);assert.equal((await f.report()).cycleClose.status,'completed');
 const balances=await Promise.all([f.owner,f.a,f.b].map(f.bank)),logCount=(await db.collection('gameLog').where('clubId','==',f.cid).get()).size;
 await Promise.all([f.cmd('beginCloseAll',{expectedCycleId:'legacy_current',requestId}),f.cmd('continueCloseAll',{closureId:requestId})]);
 assert.deepEqual(await Promise.all([f.owner,f.a,f.b].map(f.bank)),balances);assert.equal((await get(f.root)).currentCycleId,'cycle_1');assert.equal((await db.collection('gameLog').where('clubId','==',f.cid).get()).size,logCount);
 await assert.rejects(f.cmd('beginCloseAll',{expectedCycleId:'legacy_current'}),/cycle changed/);assert.ok(await f.table(),'new play resumes after completion');
});
test('new-cycle close records cash-outs before the boundary and preserves unpaid balances',async()=>{
 const f=await fixture();await f.cmd('closeLegacy');const tid=await f.table();
 await f.call('pkSeat',f.a,{tableId:tid,op:'join',amount:100});
 await db.doc('tables/'+tid).update({[`players.${f.a}.stack`]:80});
 const requestId=crypto.randomUUID();const results=await Promise.all([f.cmd('beginCloseAll',{expectedCycleId:'cycle_1',requestId}),f.cmd('beginCloseAll',{expectedCycleId:'cycle_1',requestId})]);
 assert.ok(results.every(r=>r.cycleId==='cycle_2'));assert.equal(await f.bank(f.a),980);
 assert.equal((await f.report(f.a,'cycle_1')).player.totals.result,-2000);const current=await f.report(f.a);assert.equal(current.player.totals.result,0);assert.equal(current.player.opening,-2000);
 assert.equal((await db.collection('gameLog').where('clubId','==',f.cid).get()).size,1);
});
test('active tournaments and unsafe legacy tables block before any table or balance changes',async()=>{
 const f=await fixture(),tid=await f.table(1),before=await get('tables/'+tid),balance=await f.bank(f.owner),event=db.doc('tournaments/'+f.cid);
 await event.set({clubId:f.cid,status:'running',name:'Live prizes'});
 await assert.rejects(f.cmd('beginCloseAll',{expectedCycleId:'legacy_current'}),/Finish or cancel active tournaments.*Live prizes/);
 assert.deepEqual(await get('tables/'+tid),before);assert.equal(await f.bank(f.owner),balance);assert.equal((await get('clubs/'+f.cid)).settlementClosing,undefined);
 await event.update({status:'done'});const legacy=db.doc('tables/'+f.cid+'_legacy');await legacy.set({clubId:f.cid,players:{old:{uid:'old',stack:10}},gameState:{phase:'waiting'}});
 await assert.rejects(f.cmd('beginCloseAll',{expectedCycleId:'legacy_current'}),/accounting review/);assert.deepEqual(await get('tables/'+tid),before);
 await legacy.delete();await db.doc('tables/'+f.cid+'_finished').set({clubId:f.cid,tournamentId:f.cid,players:{[f.a]:{uid:f.a,stack:10000}}});
 await f.cmd('beginCloseAll',{expectedCycleId:'legacy_current'});assert.equal(await f.bank(f.a),1000,'tournament chips are never cashed out');assert.equal(await f.bank(f.owner),1000);assert.equal((await db.collection('tables').where('clubId','==',f.cid).get()).size,0);
});
test('failed payouts keep the cycle open and are retryable without paying other tables twice',async()=>{
 const f=await fixture(),paid=await f.table(1),blocked=await f.table();await f.call('pkSeat',f.a,{tableId:blocked,op:'join',amount:100});
 const mref=db.doc(`memberships/${f.a}_${f.cid}`),member=await get(mref.path);await mref.delete();
 const requestId=crypto.randomUUID(),result=await f.cmd('beginCloseAll',{expectedCycleId:'legacy_current',requestId});assert.equal(result.closing,true);assert.equal(await get('tables/'+paid),undefined);assert.ok(await get('tables/'+blocked));assert.equal(await get(f.root),undefined);
 assert.match((await f.report()).cycleClose.error,/Funding account missing/);assert.equal(await f.bank(f.owner),1000);
 await mref.set(member);await f.cmd('continueCloseAll',{closureId:requestId});assert.equal((await get(f.root)).currentCycleId,'cycle_1');assert.equal(await f.bank(f.a),1000);assert.equal(await f.bank(f.owner),1000);
});
test('a funded Spin is allowed to finish before its table is removed, without paying its stack as chips',async()=>{
 const f=await fixture(),tid=(await f.call('pkTableCreate',f.owner,{manual:true,botCount:2,settings:{spinMode:true,spinBuyIn:10,spinStack:1000}})).tableId;
 await db.doc('tables/'+tid).update({spin:{prize:100,fundingPending:false}});const before=await get('tables/'+tid),requestId=crypto.randomUUID();
 await f.cmd('beginCloseAll',{expectedCycleId:'legacy_current',requestId});assert.deepEqual(await get('tables/'+tid),before);assert.equal(await get(f.root),undefined);
 await db.doc('tables/'+tid).update({spinDone:true});await f.cmd('continueCloseAll',{closureId:requestId});assert.equal(await get('tables/'+tid),undefined);assert.equal(await f.bank(f.owner),980,'already awarded Spin receives no second payout');
});
test('retired Spin and synthetic cash tables archive completely without changing balances or history',async()=>{
 const f=await fixture(),old=Date.UTC(2026,8,10),bot='bot_1788994187349_ev73mw';
 const spin={type:'poker',clubId:f.cid,createdAt:old,settings:{serverEngine:true,spinMode:true},spin:{prize:100},players:{[bot]:{uid:bot,isBot:true,stack:19440,bet:0},[f.a]:{lastSeen:old}},gameState:{phase:'showdown',pots:[],showdownAt:old},history:[{at:old,amount:7560}]};
 const cash={...spin,settings:{serverEngine:true},leftStacks:{[f.a]:{amount:49,at:old}},players:{[bot]:{uid:bot,isBot:true,stack:96,bet:2,buyTotal:500}},gameState:{phase:'flop',pots:[{amount:3,eligible:[bot]}],activeTurnUid:bot,turnStartedAt:old}};
 const s=f.cid+'_spin',c=f.cid+'_cash';await db.doc('tables/'+s).set(spin);await db.doc('tables/'+c).set(cash);await db.doc('tables/'+s+'/priv/_engine').set({deck:['preserved']});
 const balances=await Promise.all([f.owner,f.a,f.b].map(f.bank));
 await Promise.all([f.call('pkTableManage',f.owner,{tableId:s,op:'delete'}),f.call('pkTableManage',f.owner,{tableId:s,op:'delete'})]);
 assert.equal(await get('tables/'+s),undefined);assert.deepEqual((await get('_pkClosedTables/'+s)).players,spin.players);
 assert.deepEqual(await get('_pkClosedTables/'+s+'/priv/_engine'),{deck:['preserved']});assert.equal(await get('tables/'+s+'/priv/_engine'),undefined);
 await f.cmd('beginCloseAll',{expectedCycleId:'legacy_current'});
 assert.equal(await get('tables/'+c),undefined);assert.deepEqual((await get('_pkClosedTables/'+c)).leftStacks,cash.leftStacks);assert.deepEqual((await get('_pkClosedTables/'+c)).gameState,cash.gameState);
 assert.equal((await get('_pkClosedTables/'+c)).legacyArchive.moneyEffects,0);
 assert.deepEqual(await Promise.all([f.owner,f.a,f.b].map(f.bank)),balances);assert.equal((await db.collection('gameLog').where('clubId','==',f.cid).get()).size,0);
 assert.equal((await get(f.root)).currentCycleId,'cycle_1');
 assert.equal((await db.collection('_pkAudit').where('tableId','==',s).get()).docs.filter(d=>d.data().action==='legacy-table-archive').length,1);
});
test('legacy deletion cannot discard funded players or overwrite an existing archive',async()=>{
 const f=await fixture(),id=f.cid+'_legacy',ref=db.doc('tables/'+id),old=Date.UTC(2026,8,10);
 await ref.set({clubId:f.cid,players:{[f.a]:{uid:f.a,stack:100}},gameState:{phase:'done'}});
 await assert.rejects(f.call('pkTableManage',f.owner,{tableId:id,op:'delete'}),/accounting review/);assert.equal((await get(ref.path)).players[f.a].stack,100);
 await ref.set({clubId:f.cid,players:{},gameState:{phase:'waiting'},createdAt:old});await db.doc('_pkClosedTables/'+id).set({evidence:'keep'});
 await assert.rejects(f.call('pkTableManage',f.owner,{tableId:id,op:'delete'}),/archive already exists/);
 assert.deepEqual(await get('_pkClosedTables/'+id),{evidence:'keep'});assert.ok(await get(ref.path));assert.equal(await f.bank(f.a),1000);
});
test('bounded production repair preflights every target and reruns without any accounting or cycle writes',async()=>{
 const {repair,IDS,CLUB}=require('../../scripts/archive-retired-tables.cjs'),old=Date.UTC(2026,8,10),bot='bot_1788994187349_ev73mw';
 const original={clubId:CLUB,type:'poker',createdAt:old,settings:{serverEngine:true,spinMode:true},spin:{prize:100},players:{[bot]:{uid:bot,isBot:true,stack:19440,bet:0}},gameState:{phase:'showdown',pots:[],showdownAt:old}};
 const financial={['clubs/'+CLUB]:{ownerUid:'repair-owner',botsAuto:false}};
 financial['memberships/repair-owner_'+CLUB]={uid:'repair-owner',clubId:CLUB,balance:1234,agentProfits:56,clubProfits:78};
 financial['gameLog/repair-history']={clubId:CLUB,uid:'repair-owner',profit:42,rake:3,at:old};
 financial['settlementClubs/'+CLUB]={currentCycleId:'cycle_7'};
 for(const [path,data]of Object.entries(financial))await db.doc(path).set(data);
 for(const id of IDS)await db.doc('tables/'+id).set(original);
 const modern={...original,authorityVersion:2};await db.doc('tables/repair-modern').set(modern);
 await db.doc('tables/'+IDS.at(-1)).update({[`players.${bot}.fundingUid`]:'repair-owner'});
 await assert.rejects(repair(db,{apply:true}),/accounting review/);assert.ok(await get('tables/'+IDS[0]),'all targets are validated before any write');
 await db.doc('tables/'+IDS.at(-1)).set(original);
 const preview=await repair(db);assert.equal(preview.applied,false);assert.equal(preview.eligible,13);assert.ok(await get('tables/'+IDS[0]));
 const result=await repair(db,{apply:true});assert.equal(result.legacyRemaining,0);assert.equal(result.moneyEffects,0);assert.equal(result.cycleChanged,false);
 const archive=await get('_pkClosedTables/'+IDS[0]);await repair(db,{apply:true});assert.deepEqual(await get('_pkClosedTables/'+IDS[0]),archive);
 for(const [path,data]of Object.entries(financial))assert.deepEqual(await get(path),data,path);
 assert.deepEqual(await get('tables/repair-modern'),modern);
 for(const id of IDS){assert.equal(await get('tables/'+id),undefined);assert.deepEqual((await get('_pkClosedTables/'+id)).players,original.players);}
});
