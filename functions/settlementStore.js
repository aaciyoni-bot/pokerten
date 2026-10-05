'use strict';
// Private, server-only settlement journal. Shares the game's transaction; never
// changes chip balances, historical gameLog rows, decks, or private cards.
const crypto=require('node:crypto');
const A=require('./pokerAuthority');
const E=require('./settlementEngine');
const hash=(...parts)=>crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const root=(db,cid)=>db.doc('settlementClubs/'+A.key(cid));
const cycleRef=(db,cid,id)=>root(db,cid).collection('cycles').doc(A.key(id));
const data=s=>s.exists?s.data():null;
async function authority(tx,db,cid,r){
 const uid=A.uid(r),club=data(await tx.get(db.doc('clubs/'+A.key(cid)))),me=data(await tx.get(db.doc(`memberships/${uid}_${cid}`)));
 if(!club)A.fail('not-found','Club not found.');
 const owner=A.root(r)||club.ownerUid===uid,manager=owner||me?.status==='approved'&&me.role==='manager';
 if(!manager&&me?.status!=='approved')A.fail('permission-denied','Approved club membership is required.');
 return{uid,club,me,owner,manager,role:manager?'owner':me.role==='agent'?'agent':'player'};
}
async function context(tx,db,cid){
 const ref=root(db,cid),config=data(await tx.get(ref));
 if(!config)return{ref,config:null};
 const current=cycleRef(db,cid,config.currentCycleId),cycle=data(await tx.get(current));
 if(!cycle||cycle.status!=='open')A.fail('failed-precondition','No open cycle was found.');
 return{ref,config,current,cycle};
}
const approvedAgent=m=>m?.status==='approved'&&['agent','manager','club_owner'].includes(m.role);
async function frozenTerms(tx,db,cid,uid){
 const m=data(await tx.get(db.doc(`memberships/${uid}_${cid}`)))||{};
 const t=data(await tx.get(root(db,cid).collection('terms').doc(uid)))||{};
 let primaryAgentId=m.agentUid&&m.agentUid!==uid?m.agentUid:null;
 let a={},at={};
 if(primaryAgentId){a=data(await tx.get(db.doc(`memberships/${A.key(primaryAgentId)}_${cid}`)))||{};at=data(await tx.get(root(db,cid).collection('terms').doc(primaryAgentId)))||{};if(!approvedAgent(a))primaryAgentId=null;}
 const secondaryAgentId=t.secondaryAgentId||null;
 return{primaryAgentId,agentType:at.agentType||'rake',agentPct:primaryAgentId?(at.agentPct??Number(m.agentPct||0)):0,secondaryAgentId,secondaryPct:secondaryAgentId?(t.secondaryPct||0):0,rakebackPct:t.rakebackPct||0};
}
// A sitting is booked when it ends. Hand/rake counters are accumulated on the
// server. The activation baseline excludes pre-existing sitting profits without
// editing those seats or cash-out logs. Tournament fees come from the engine.
async function prepareJournal(db,tx,cid,effects,source,now){
 const results=effects.filter(e=>e.type==='gameLog').flatMap(e=>e.entries||[]).filter(e=>e.uid&&!e.uid.startsWith('bot_'));
 const hands=effects.filter(e=>e.type==='settlementHands').flatMap(e=>e.entries||[]);
 const allocations=effects.filter(e=>e.type==='rake'&&e.rake>0&&e.rakeSource!=='unclassified').flatMap(e=>e.allocations||[]).filter(e=>!e.isBot&&!e.uid.startsWith('bot_'));
 const ids=[...new Set([...results,...hands,...allocations].map(e=>e.uid))];
 if(!ids.length)return()=>{};
 const ctx=await context(tx,db,cid);if(!ctx.config)return()=>{};
 const writes=[];
 for(const uid of ids){
  const ref=ctx.ref.collection('sittings').doc(hash(source,uid)),old=data(await tx.get(ref))||{};
  const hand=hands.find(e=>e.uid===uid),result=results.find(e=>e.uid===uid);
  const counter={...old,uid,source,rake:(old.rake||0)+allocations.filter(e=>e.uid===uid).reduce((n,e)=>n+E.cents(e.amount),0),hands:(old.hands||0)+hands.filter(e=>e.uid===uid).reduce((n,e)=>n+(e.hands??1),0),tableName:hand?.tableName||old.tableName||source,gameType:hand?.gameType||old.gameType||'poker',updatedAt:now};
  if(result){
   const terms=await frozenTerms(tx,db,cid,uid);
   const row={playerId:uid,playerName:String(result.username||uid),tableId:source,tableName:counter.tableName,gameType:counter.gameType,kind:source.startsWith('tournament:')?'tournament':result.kind||'cash',result:E.cents(result.profit||0)-(old.baseline||0),rake:counter.rake,hands:counter.hands,...terms,cycleId:ctx.config.currentCycleId,at:now};
   // All callers run inside a Firestore transaction protected by game state /
   // command receipt. A deterministic ID adds retry safety at the journal edge.
   const session=ctx.ref.collection('sessions').doc(hash(source,uid,now,ctx.config.currentCycleId));
   const existing=await tx.get(session);if(!existing.exists)writes.push(()=>tx.create(session,row));
   writes.push(()=>tx.delete(ref));
  }else writes.push(()=>tx.set(ref,counter));
 }
 // Reading the cycle pointer in this transaction serializes it with cycle changes, so closing cannot race
 // with the game's commit or place activity in a closed cycle.
 return()=>{for(const write of writes)write();};
}
async function calculate(tx,db,cid,cycleId){
 const ref=cycleRef(db,cid,cycleId),cycle=data(await tx.get(ref));if(!cycle||cycle.status==='void')A.fail('not-found','Cycle not found.');
 const [sessions,payments]=await Promise.all([tx.get(root(db,cid).collection('sessions').where('cycleId','==',cycleId)),tx.get(root(db,cid).collection('payments').where('cycleId','==',cycleId))]);
 const names=Object.fromEntries(sessions.docs.map(s=>[s.data().playerId,s.data().playerName]));
 const members=await tx.get(db.collection('memberships').where('clubId','==',cid));for(const m of members.docs)names[m.data().uid]=m.data().username||m.data().uid;
 const calculated=E.computeCycle({sessions:sessions.docs.map(s=>s.data()),payments:payments.docs.map(s=>s.data()).filter(p=>p.status==='confirmed'),openings:cycle.openings||{},names});
 return{cycle,calculated,payments:payments.docs.map(d=>({id:d.id,...d.data()})),members:members.docs.map(d=>d.data()),sessionCount:sessions.size};
}
function publicReport(ctx,full){
 const {calculated:c,cycle}=full,{uid,role}=ctx;
 const funds=(full.members||[]).filter(m=>!m.isBot&&(role==='owner'||m.uid===uid||m.agentUid===uid)).map(m=>({uid:m.uid,name:m.username||m.uid,balance:E.cents(Number(m.balance)||0)}));
 const metadata={id:cycle.id,number:cycle.number,startAt:cycle.startAt,endAt:cycle.endAt,closedAt:cycle.closedAt||null,status:cycle.status,autoClose:!!cycle.autoClose};
 const payments=full.payments.filter(p=>role==='owner'||p.fromId===uid||p.toId===uid).map(p=>({...p,canConfirm:p.status==='pending'&&p.confirmBy===uid}));
 const own=c.players[uid]||{playerId:uid,playerName:ctx.me?.username||uid,rows:[],totals:{result:0,hands:0,games:0},opening:0,paid:0,closing:0,counterparties:[]};
 if(role==='player')return{role,cycle:metadata,player:own,payments,balance:E.cents(Number(ctx.me?.balance)||0)};
 if(role==='agent')return{role,cycle:metadata,funds,player:own,agent:c.agents[uid]||{agentId:uid,agentName:ctx.me?.username||uid,players:[],leads:[],playersResult:0,rake:0,hands:0,commission:0,earnings:0,toClub:0,opening:0,paid:0,closing:0},details:Object.values(c.pairs).filter(p=>p.agentId===uid),payments};
 return{role,cycle:metadata,funds,club:c.club,agents:Object.values(c.agents),details:Object.values(c.pairs),payments};
}
module.exports={hash,root,cycleRef,data,authority,context,approvedAgent,frozenTerms,prepareJournal,calculate,publicReport};
