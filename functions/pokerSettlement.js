'use strict';
const {onCall}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getFirestore}=require('firebase-admin/firestore');
const A=require('./pokerAuthority'),E=require('./settlementEngine'),S=require('./settlementStore');
const Legacy=require('./legacySettlement'),Period=require('./settlementPeriod');
const opts={region:'us-central1',memory:'512MiB',timeoutSeconds:120};
const audit=(tx,ref,uid,action,details,now)=>tx.set(ref.collection('audit').doc(),{uid,action,details,at:now});
const requireManager=a=>{if(!a.manager)A.fail('permission-denied','Only club managers can perform this action.');};
const meta=c=>({id:c.id,...(c.legacy?{legacy:true}:{}),number:c.number,startAt:c.startAt,endAt:c.status==='open'?null:c.endAt,...(c.status==='open'&&c.endAt!=null?{plannedEndAt:c.endAt}:{}),status:c.status,autoClose:false,closedAt:c.closedAt||null});
const memberMoneyFields=['uid','username','agentUid','role','status','balance','isBot'];
const gameMoneyFields=['uid','profit','rake','at','rakeSource'];
const tableMoneyFields=['name','players','settings','tournamentId','gameState.phase','gameState.handStartWealth','gameState.handStartStacks','gameState.bombPot','gameState.handBB'];
// This query matches the calculator's existing inclusion rule. Pure equality
// filters retain Firestore's default single-field index merging (no ordering).
const humanCommissionQuery=(db,cid)=>db.collection('agentLog').where('clubId','==',cid).where('rakeSource','==','human').where('accountingVersion','==',2);
const legacyPeriodRef=(db,cid)=>S.root(db,cid).collection('state').doc('legacyPeriod');
async function readLegacyPeriod(tx,db,cid,now=Date.now()){const snap=await tx.get(legacyPeriodRef(db,cid));return Period.legacyPeriod(snap.exists?snap.data():null,now);}
async function legacyData(tx,db,cid,auth,now=Date.now(),period=null){
 // Fetch only fields used by accounting, not table chat, action histories or
 // other large game payloads. Player history is queried by that player's UID.
 const own=auth.role==='player',needsCommissions=!own&&period&&!period.needsPeriodStart;
 let membersQuery=db.collection('memberships').where('clubId','==',cid);
 if(auth.role==='agent')membersQuery=membersQuery.where('agentUid','==',auth.uid);
 let gamesQuery=db.collection('gameLog').where('clubId','==',cid);
 if(own)gamesQuery=gamesQuery.where('uid','==',auth.uid);
 let agentQuery=humanCommissionQuery(db,cid);
 if(auth.role==='agent')agentQuery=agentQuery.where('agentUid','==',auth.uid);
 const [members,games,tables,agentLogs]=await Promise.all([
  own?Promise.resolve(null):tx.get(membersQuery.select(...memberMoneyFields)),
  tx.get(gamesQuery.select(...gameMoneyFields)),
  tx.get(db.collection('tables').where('clubId','==',cid).select(...tableMoneyFields)),
  !needsCommissions?Promise.resolve(null):tx.get(agentQuery.select('agentUid','amount','at','accountingVersion','rakeSource'))]);
 const rows=members?members.docs.map(d=>d.data()):[];if(auth.me&&!rows.some(m=>m.uid===auth.uid))rows.push({uid:auth.uid,...auth.me});
 return Legacy.buildLegacy(rows,games.docs.map(d=>d.data()),tables.docs.map(d=>d.data()),agentLogs?agentLogs.docs.map(d=>d.data()):[],{ownerUid:auth.club.ownerUid,now,period});
}
function legacyReport(auth,full,cycle){return{active:false,legacy:true,role:auth.role,basis:full.basis,supportsDateRange:true,needsPeriodStart:!!full.needsPeriodStart,canSetPeriodStart:auth.manager&&!!full.needsPeriodStart,canClose:auth.manager&&cycle.status==='open'&&!full.needsPeriodStart,cycle:meta(cycle),legacyReport:Legacy.projectLegacy(full,auth)};}
async function initialize(tx,db,cid,auth,now){
 requireManager(auth);const ref=S.root(db,cid),existing=await tx.get(ref);if(existing.exists)return{ok:true};
 const period=await readLegacyPeriod(tx,db,cid,now);if(period.needsPeriodStart)A.fail('failed-precondition','Confirm the current cycle start date before closing it.');
 const [members,tables]=await Promise.all([tx.get(db.collection('memberships').where('clubId','==',cid).select(...memberMoneyFields,'agentProfits','clubProfits')),tx.get(db.collection('tables').where('clubId','==',cid).select(...tableMoneyFields))]);
 if(members.size+tables.docs.reduce((n,d)=>n+Object.values(d.data().players||{}).filter(p=>!p.isBot).length,0)>450)A.fail('resource-exhausted','Please contact the system administrator to enable a larger club.');
 const [games,agentLogs]=await Promise.all([tx.get(db.collection('gameLog').where('clubId','==',cid).select(...gameMoneyFields)),tx.get(humanCommissionQuery(db,cid).select('agentUid','amount','at','accountingVersion','rakeSource'))]);
 const legacy=Legacy.buildLegacy(members.docs.map(d=>d.data()),games.docs.map(d=>d.data()),tables.docs.map(d=>d.data()),agentLogs.docs.map(d=>d.data()),{ownerUid:auth.club.ownerUid,now,period});
 const accounting=require('./pokerAccounting').buildAccounting(members.docs.map(d=>d.data()),games.docs.map(d=>d.data()),tables.docs.map(d=>d.data()),{ownerUid:auth.club.ownerUid,god:true,now,cycle:period});
 const snapshots=members.docs.map(d=>({uid:d.data().uid,balance:d.data().balance||0,agentProfits:d.data().agentProfits||0,clubProfits:d.data().clubProfits||0,name:d.data().username||d.data().uid,agentUid:d.data().agentUid||null,role:d.data().role||'player',accounting:accounting.players[d.data().uid]||null}));
 // A preservation snapshot, never applied back over live balances.
 tx.create(ref,{currentCycleId:'cycle_1',activatedAt:now,revision:0,resetOpening:true,ownerUid:auth.club.ownerUid});
 tx.create(S.cycleRef(db,cid,'legacy_current'),{id:'legacy_current',number:0,legacy:true,status:'closed',startAt:legacy.start,endAt:now,closedAt:now,closedBy:auth.uid,report:legacy});
 tx.create(S.cycleRef(db,cid,'cycle_1'),{id:'cycle_1',number:1,status:'open',startAt:now,endAt:null,autoClose:false,openings:{pairs:[],agents:[]}});
 for(const m of snapshots)tx.create(ref.collection('activationBalances').doc(m.uid),{...m,at:now});
 for(const table of tables.docs){const t=table.data();if(t.settings?.spinMode||t.tournamentId)continue;const sittingAccounting=require('./pokerAccounting').buildAccounting(members.docs.map(d=>d.data()),[],[t],{ownerUid:auth.club.ownerUid,now});for(const p of Object.values(t.players||{})){if(p.isBot)continue;tx.set(ref.collection('sittings').doc(S.hash(table.id,p.uid)),{uid:p.uid,source:table.id,baseline:E.cents(sittingAccounting.players[p.uid]?.openResult??((p.stack||0)+(p.bet||0)+(p.pendingTopUp||0)-(p.buyTotal??p.stack??0))),rake:0,hands:0,tableName:t.name||t.settings?.name||table.id,gameType:t.settings?.pokerType||'poker',updatedAt:now});}}
 audit(tx,ref,auth.uid,'close-legacy-open-zero',{preservedMembers:snapshots.length,closedCycleId:'legacy_current'},now);return{ok:true,cycleId:'cycle_1'};
}
async function close(tx,db,cid,ctx,now,uid){
 const full=await S.calculate(tx,db,cid,ctx.config.currentCycleId),old=full.cycle;
 const openings={pairs:Object.values(full.calculated.pairs).filter(p=>p.closing).map(p=>({agentId:p.agentId,playerId:p.playerId,amount:p.closing})),agents:Object.values(full.calculated.agents).filter(a=>a.closing).map(a=>({agentId:a.agentId,amount:a.closing}))};
 if(Buffer.byteLength(JSON.stringify(openings))>700000)A.fail('resource-exhausted','Balances must be split before this cycle can be closed.');
 const nextId='cycle_'+(old.number+1),nextRef=S.cycleRef(db,cid,nextId),next=await tx.get(nextRef);
 if(next.exists&&next.data().status!=='void')A.fail('failed-precondition','The next cycle already exists.');
 if(full.liveSittings.length+full.liveSessions.length+4>450)A.fail('resource-exhausted','Too many open sittings to close in one transaction.');
 S.preserveOpenContributions(tx,db,cid,old,full.liveSittings,now);
 tx.update(ctx.current,{status:'closed',closedAt:now,endAt:now,closedBy:uid});
 tx.set(nextRef,{id:nextId,number:old.number+1,status:'open',startAt:now,endAt:null,autoClose:false,prevCycleId:old.id,openings});
 tx.update(ctx.ref,{currentCycleId:nextId,revision:(ctx.config.revision||0)+1});audit(tx,ctx.ref,uid,'close',{cycleId:old.id,nextId},now);return{ok:true,cycleId:nextId};
}
exports.pkSettlementReport=onCall(opts,async r=>{
 const db=getFirestore(),cid=A.key(r.data?.clubId);return db.runTransaction(async tx=>{
  const auth=await S.authority(tx,db,cid,r),ctx=await S.context(tx,db,cid);
  if(r.data?.fromAt!==undefined||r.data?.toAt!==undefined){
   let period;try{period=Period.dateRange(r.data.fromAt,r.data.toAt);}catch(e){A.fail('invalid-argument',e.message);}
   const full=await legacyData(tx,db,cid,auth,Date.now(),period);
   const cycles=ctx.config?await tx.get(ctx.ref.collection('cycles')):null;
   return{...legacyReport(auth,full,period),readOnly:true,dateRange:{fromAt:period.startAt,toAt:period.endAt},canSetPeriodStart:false,canClose:false,cycles:cycles?cycles.docs.map(d=>d.data()).filter(c=>c.status!=='void').sort((a,b)=>b.number-a.number).map(meta):[],currentCycleId:ctx.config?.currentCycleId||'legacy_current'};
  }
  if(r.data?.cycleId==='all'&&!auth.manager)A.fail('permission-denied','Please select a specific cycle.');
  if(!ctx.config){const period=await readLegacyPeriod(tx,db,cid),full=await legacyData(tx,db,cid,auth,Date.now(),period);return{...legacyReport(auth,full,period),cycles:[],currentCycleId:'legacy_current'};}
  const cyclesSnap=await tx.get(ctx.ref.collection('cycles')),cycles=cyclesSnap.docs.map(d=>d.data()).filter(c=>c.status!=='void').sort((a,b)=>b.number-a.number);
  const requested=r.data?.cycleId||ctx.config.currentCycleId;
  let result;
  if(requested==='legacy_current'){const legacy=cycles.find(c=>c.id===requested&&c.legacy);if(!legacy?.report)A.fail('not-found','The previous cycle was not found.');return{...legacyReport(auth,legacy.report,legacy),cycles:cycles.map(meta),currentCycleId:ctx.config.currentCycleId};}
  if(requested==='all'){
   // Aggregate activity across immutable records without summing carried balances.
   const sessions=await tx.get(ctx.ref.collection('sessions')),payments=await tx.get(ctx.ref.collection('payments')),members=await tx.get(db.collection('memberships').where('clubId','==',cid));
   const names=Object.fromEntries(members.docs.map(d=>[d.data().uid,d.data().username||d.data().uid]));
   const live=await S.openContributions(tx,db,cid,ctx.cycle);
   const calculated=E.computeCycle({sessions:[...sessions.docs.map(d=>d.data()),...live.sessions],payments:payments.docs.map(d=>d.data()).filter(p=>p.status==='confirmed'),names});
   result=S.publicReport(auth,{calculated,members:members.docs.map(d=>d.data()),cycle:{id:'all',number:0,startAt:ctx.config.activatedAt,endAt:null,status:'all'},payments:payments.docs.map(d=>({id:d.id,...d.data()}))});
  }else result=S.publicReport(auth,await S.calculate(tx,db,cid,A.key(requested)));
  result.cycle=meta(result.cycle);
  // Current wallet/P&L stays visible beside the selected-cycle statement. Scope
  // these fields after calculation; never send another player's data to a player.
  const [currentMembers,currentGames,currentTables]=await Promise.all([tx.get(db.collection('memberships').where('clubId','==',cid).select(...memberMoneyFields)),!auth.manager?Promise.resolve(null):tx.get(db.collection('gameLog').where('clubId','==',cid).select(...gameMoneyFields)),tx.get(db.collection('tables').where('clubId','==',cid).select(...tableMoneyFields))]);
  const currentAccounting=require('./pokerAccounting').buildAccounting(currentMembers.docs.map(d=>d.data()),currentGames?currentGames.docs.map(d=>d.data()):[],currentTables.docs.map(d=>d.data()),{ownerUid:auth.club.ownerUid,now:Date.now()});
  const currentMoney=p=>({chips:E.cents(p?.chips||0),...(auth.manager?{totalResult:E.cents(p?.totalResult||0)}:{})});
  if(auth.role==='player')result.chips=E.cents(currentAccounting.players[auth.uid]?.chips||0);
  else {result.funds=result.funds.map(p=>({...p,...currentMoney(currentAccounting.players[p.uid])}));result.currentTotals=currentMoney(auth.role==='owner'?currentAccounting.club:currentAccounting.agents[auth.uid]);}
  const approvals=await tx.get(ctx.ref.collection('approvals').where('cycleId','==',requested));
  return{active:true,...result,supportsDateRange:true,needsPeriodStart:false,clubPartyId:auth.club.ownerUid,cycles:cycles.map(meta),currentCycleId:ctx.config.currentCycleId,activatedAt:ctx.config.activatedAt,approvals:approvals.docs.map(d=>d.data()).filter(a=>auth.manager||a.uid===auth.uid)};
 },{readOnly:true});
});
exports.pkSettlementArchive=onCall(opts,async r=>{
 const db=getFirestore(),cid=A.key(r.data?.clubId);return db.runTransaction(async tx=>{
  const auth=await S.authority(tx,db,cid,r),config=S.data(await tx.get(S.root(db,cid)));
  if(!config)return{rows:[],at:null};
  const snap=await tx.get(S.root(db,cid).collection('activationBalances'));
  return{at:config.activatedAt,rows:snap.docs.map(d=>d.data()).filter(m=>auth.manager||m.uid===auth.uid||auth.role==='agent'&&m.agentUid===auth.uid).map(m=>({uid:m.uid,name:m.name,balance:m.balance,result:m.accounting?.result||0,chips:m.accounting?.chips??m.balance,...(auth.role!=='player'?{rake:m.accounting?.rake||0,agentProfits:m.agentProfits,clubProfits:m.clubProfits}:{})}))};
 },{readOnly:true});
});
exports.pkSettlement=onCall(opts,async r=>A.command(r,'settlement',async(tx,db,uid,now)=>{
 const d=r.data,cid=A.key(d.clubId),auth=await S.authority(tx,db,cid,r),action=d.action;
 if(action==='setLegacyPeriodStart'){
  requireManager(auth);
  const config=await tx.get(S.root(db,cid));if(config.exists)A.fail('failed-precondition','The current cycle already has a recorded start date.');
  const startAt=A.number(d.startAt,NaN,0,now,true),ref=legacyPeriodRef(db,cid),saved=await tx.get(ref);
  const old=Period.legacyPeriod(saved.exists?saved.data():null,now);
  if(!old.needsPeriodStart){if(old.startAt===startAt)return{ok:true};A.fail('failed-precondition','The confirmed start date cannot be changed.');}
  tx.set(ref,{startAt,source:'manager-confirmed',confirmedAt:now,confirmedBy:uid});
  audit(tx,S.root(db,cid),uid,action,{startAt},now);return{ok:true};
 }
 if(action==='initialize'||action==='closeLegacy')return initialize(tx,db,cid,auth,now);
 const ctx=await S.context(tx,db,cid);if(!ctx.config)A.fail('failed-precondition','Please open the new cycle first.');
 if(action==='close'){requireManager(auth);return close(tx,db,cid,ctx,now,uid);}
 if(action==='setEnd'){
  requireManager(auth);if(d.autoClose===true)A.fail('failed-precondition','Cycles can only be closed manually.');
  const endAt=d.endAt==null?null:A.number(d.endAt,NaN,now+60000,now+366*86400000,true);
  tx.update(ctx.current,{endAt,autoClose:false});audit(tx,ctx.ref,uid,action,{endAt,autoClose:false},now);
 }else if(action==='lock'){
  requireManager(auth);const ref=S.cycleRef(db,cid,A.key(d.cycleId)),cycle=S.data(await tx.get(ref));if(cycle?.status!=='closed')A.fail('failed-precondition','Only a closed cycle can be locked.');
  tx.update(ref,{status:'locked',lockedAt:now});audit(tx,ctx.ref,uid,action,{cycleId:d.cycleId},now);
 }else if(action==='reopen'){
  requireManager(auth);const full=await S.calculate(tx,db,cid,ctx.config.currentCycleId);
  if(!ctx.cycle.prevCycleId||full.sessionCount||full.payments.length)A.fail('failed-precondition','The next cycle must be empty.');
  const approval=await tx.get(ctx.ref.collection('approvals').where('cycleId','==',ctx.config.currentCycleId).limit(1));if(!approval.empty)A.fail('failed-precondition','The next cycle already contains an approval.');
  const prev=S.cycleRef(db,cid,ctx.cycle.prevCycleId),old=S.data(await tx.get(prev));if(old?.status!=='closed')A.fail('failed-precondition','A locked cycle cannot be reopened.');
  tx.update(ctx.current,{status:'void'});tx.update(prev,{status:'open',closedAt:null,endAt:null,autoClose:false});tx.update(ctx.ref,{currentCycleId:old.id,revision:(ctx.config.revision||0)+1});audit(tx,ctx.ref,uid,action,{cycleId:old.id},now);
 }else if(action==='payment'){
  const type=d.type;if(!['player','agent'].includes(type))A.fail('invalid-argument','Invalid payment type.');
  const agentId=d.agentId==='club'?'club':A.key(d.agentId),playerId=type==='player'?A.key(d.playerId):null;
  const full=await S.calculate(tx,db,cid,ctx.config.currentCycleId);
  const other=agentId==='club'?auth.club.ownerUid:agentId;
  if(type==='player'){
   const m=S.data(await tx.get(db.doc(`memberships/${playerId}_${cid}`)));
   if(!m||m.isBot||(!full.calculated.pairs[E.pairKey(agentId,playerId)]&&(m.agentUid||'club')!==agentId))A.fail('invalid-argument','The parties are not associated with this settlement.');
  }else{const m=S.data(await tx.get(db.doc(`memberships/${agentId}_${cid}`)));if(!S.approvedAgent(m)||agentId===auth.club.ownerUid)A.fail('invalid-argument','Invalid agent.');}
  const parties=type==='player'?[playerId,other]:[agentId,auth.club.ownerUid];
  if(parties[0]===parties[1])A.fail('invalid-argument','Two different parties are required.');
  const fromId=A.key(d.fromId),toId=A.key(d.toId);if(!parties.includes(fromId)||!parties.includes(toId)||fromId===toId)A.fail('invalid-argument','Invalid payment direction.');
  if(!parties.includes(uid))A.fail('permission-denied','Only a party to this payment can record it.');
  const amount=E.cents(A.number(d.amount,NaN,0.01,100000000)),ref=ctx.ref.collection('payments').doc(S.hash(uid,d.requestId));
  tx.create(ref,{cycleId:ctx.config.currentCycleId,originCycleId:ctx.config.currentCycleId,type,agentId,playerId,fromId,toId,amount,status:'pending',createdBy:uid,confirmBy:parties.find(p=>p!==uid),at:now,note:String(d.note||'').slice(0,300)});audit(tx,ctx.ref,uid,action,{paymentId:ref.id,amount},now);
 }else if(action==='confirmPayment'||action==='cancelPayment'){
  const ref=ctx.ref.collection('payments').doc(A.key(d.paymentId)),p=S.data(await tx.get(ref));if(!p)A.fail('not-found','Payment not found.');
  if(p.status!=='pending')A.fail('failed-precondition','This payment has already been processed.');
  if(action==='confirmPayment'&&p.confirmBy!==uid||action==='cancelPayment'&&p.createdBy!==uid)A.fail('permission-denied','Only the authorized party can perform this action.');
  // Confirmation after close is booked in the current open cycle. Locked and
  // closed statements never change; the original pending request remains in audit.
  tx.update(ref,{status:action==='confirmPayment'?'confirmed':'cancelled',cycleId:ctx.config.currentCycleId,confirmedAt:now,confirmedBy:uid});audit(tx,ctx.ref,uid,action,{paymentId:ref.id},now);
 }else if(action==='approve'){
  const cycleId=A.key(d.cycleId),cycle=S.data(await tx.get(S.cycleRef(db,cid,cycleId)));if(!cycle||cycle.status==='void'||cycle.status==='locked')A.fail('failed-precondition','This cycle is not open for comments.');
  tx.set(ctx.ref.collection('approvals').doc(S.hash(cycleId,uid)),{uid,cycleId,approved:d.approved===true,remark:String(d.remark||'').slice(0,1000),at:now});
 }else A.fail('invalid-argument','Unknown action.');
 tx.update(ctx.ref,{revision:(ctx.config.revision||0)+1});return{ok:true};
}));
exports.pkSettlementTerms=onCall(opts,async r=>{
 const cid=A.key(r.data?.clubId);
 if(r.data?.action==='list')return getFirestore().runTransaction(async tx=>{
  const db=getFirestore(),auth=await S.authority(tx,db,cid,r);if(!auth.manager&&auth.role!=='agent')A.fail('permission-denied','You do not have permission to view these terms.');
  const members=await tx.get(db.collection('memberships').where('clubId','==',cid)),terms=await tx.get(S.root(db,cid).collection('terms'));
  const visible=members.docs.map(d=>d.data()).filter(m=>!m.isBot&&(auth.manager||m.uid===auth.uid||m.agentUid===auth.uid));
  return{role:auth.role,members:visible.map(m=>({uid:m.uid,name:m.username||m.uid,role:m.role,status:m.status,primaryAgentId:m.agentUid||null,agentPct:S.approvedAgent(m)?(m.agentSharePct??50):(m.agentPct||0),defaultAgentPct:m.agentSharePct??50,...(terms.docs.find(d=>d.id===m.uid)?.data()||{})}))};
 },{readOnly:true});
 return A.command(r,'settlement-terms',async(tx,db,uid,now)=>{
  const auth=await S.authority(tx,db,cid,r),target=A.key(r.data.targetUid),ref=S.root(db,cid).collection('terms').doc(target),old=S.data(await tx.get(ref))||{},mref=db.doc(`memberships/${target}_${cid}`),m=S.data(await tx.get(mref));
  if(!m||m.status!=='approved'||m.isBot)A.fail('failed-precondition','An approved member is required.');
  const input=r.data.patch||{},allowed=['primaryAgentId','secondaryAgentId','secondaryPct','rakebackPct','agentType','agentPct'];for(const k of Object.keys(input))if(!allowed.includes(k))A.fail('invalid-argument','Unsupported field.');
  if(!auth.manager&&(auth.role!=='agent'||m.agentUid!==uid||Object.keys(input).some(k=>k!=='rakebackPct')))A.fail('permission-denied','Agents can only change rakeback for their own players.');
  const next={...old};for(const k of ['secondaryPct','rakebackPct','agentPct'])if(k in input)next[k]=A.number(input[k],0,0,100);
  if('agentType'in input){if(!['rake','result'].includes(input.agentType)||!S.approvedAgent(m))A.fail('invalid-argument','Invalid agent agreement.');next.agentType=input.agentType;}
  const primary='primaryAgentId'in input?(input.primaryAgentId?A.key(input.primaryAgentId):null):(m.agentUid||null);
  const secondary='secondaryAgentId'in input?(input.secondaryAgentId?A.key(input.secondaryAgentId):null):(old.secondaryAgentId||null);
  if(primary===target||secondary===target||primary&&secondary===primary)A.fail('invalid-argument','Circular agent assignments are not allowed.');
  let agent=null,agentTerms={};for(const id of [...new Set([primary,secondary].filter(Boolean))]){const a=S.data(await tx.get(db.doc(`memberships/${id}_${cid}`)));if(!S.approvedAgent(a))A.fail('invalid-argument','This agent is not approved in the club.');if(id===primary){agent=a;agentTerms=S.data(await tx.get(S.root(db,cid).collection('terms').doc(id)))||{};}}
  const cap=agentTerms.agentPct??(primary===m.agentUid?m.agentPct:agent?.agentSharePct)??0;
  if(primary&&(agentTerms.agentType||'rake')==='rake'&&(next.rakebackPct||0)+(secondary?(next.secondaryPct||0):0)>cap)A.fail('invalid-argument','Combined rakeback and secondary agent commission exceed the agent share.');
  let assigned=[];if('agentPct'in input||'agentType'in input){if(!auth.manager||!S.approvedAgent(m))A.fail('permission-denied','Only a club manager can set an agent agreement.');const q=await tx.get(db.collection('memberships').where('clubId','==',cid).where('agentUid','==',target));assigned=q.docs;for(const a of assigned){const t=S.data(await tx.get(S.root(db,cid).collection('terms').doc(a.data().uid)))||{};if((next.agentType||'rake')==='rake'&&(t.rakebackPct||0)+(t.secondaryAgentId?t.secondaryPct||0:0)>(next.agentPct??m.agentSharePct??50))A.fail('invalid-argument','Reduce player rakeback or secondary agent commission first.');}}
  next.secondaryAgentId=secondary;next.updatedAt=now;next.updatedBy=uid;
  tx.set(ref,next);if('primaryAgentId'in input)tx.update(mref,{agentUid:primary||'',agentPct:(agentTerms.agentType||'rake')==='result'?0:cap});
  if('agentPct'in input||'agentType'in input){const p=next.agentPct??m.agentSharePct??50;tx.update(mref,{agentSharePct:p});for(const a of assigned)tx.update(a.ref,{agentPct:(next.agentType||'rake')==='result'?0:p});}
  audit(tx,S.root(db,cid),uid,'terms',{target,previous:old,next},now);return{ok:true};
 });
});
// Retain the scheduled export for deployment compatibility. Older persisted
// autoClose flags have no effect: only an authenticated manager can close.
exports.pkSettlementTick=onSchedule({schedule:'every 5 minutes',region:'us-central1',timeZone:'Asia/Jerusalem',timeoutSeconds:540},async()=>({automaticClosingDisabled:true}));
