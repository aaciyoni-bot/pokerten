'use strict';
// A manager-requested close drains tables before taking the cycle boundary.
// Every payout uses the existing table lifecycle transaction. A retry never
// pays an archived table again, and no new play can cross the club barrier.
const A=require('./pokerAuthority'),S=require('./settlementStore');
const stateRef=(db,cid)=>S.root(db,cid).collection('state').doc('tableClosure');
const activeEvent=t=>!['done','cancelled'].includes(t.status);
const protectedTable=t=>t.authorityVersion===2&&t.settings?.serverEngine===true;
const legacySafe=t=>!Object.keys(t.players||{}).length&&['waiting','showdown','ended','finished','done','gameOver','gameover'].includes(t.gameState?.phase||t.phase||t.status||'waiting')&&!(t.gameState?.pots||[]).some(p=>p.amount>0)&&!Number(t.pot||t.gameState?.pot||0);
const spinRunning=t=>t.settings?.spinMode&&t.spin&&!t.spin.fundingPending&&!t.spinDone;
const publicState=s=>s?{id:s.id,status:s.status,fromCycleId:s.fromCycleId,nextCycleId:s.nextCycleId||null,remaining:s.remaining||0,startedAt:s.startedAt,error:s.error||null}:null;
async function progress(db,cid){return publicState(S.data(await stateRef(db,cid).get()));}
async function begin(tx,db,cid,auth,ctx,expectedCycleId,id,now){
 const currentId=ctx.config?.currentCycleId||'legacy_current';
 if(expectedCycleId!==currentId)A.fail('failed-precondition','The current cycle changed. Refresh the report before closing.');
 const ref=stateRef(db,cid),saved=S.data(await tx.get(ref));
 if(auth.club.settlementClosing?.status==='closing')return{ok:true,closureId:auth.club.settlementClosing.id};
 const [tables,events]=await Promise.all([tx.get(db.collection('tables').where('clubId','==',cid)),tx.get(db.collection('tournaments').where('clubId','==',cid))]);
 const active=events.docs.filter(d=>activeEvent(d.data()));
 if(active.length)A.fail('failed-precondition','Finish or cancel active tournaments before closing the cycle: '+active.map(d=>d.data().name||d.id).join(', ').slice(0,250));
 if(tables.size>400)A.fail('resource-exhausted','Close some tables before closing this cycle.');
 for(const d of tables.docs){const t=d.data();if(t.tournamentId){const event=events.docs.find(e=>e.id===t.tournamentId);if(!event||activeEvent(event.data()))A.fail('failed-precondition','Review tournament '+t.tournamentId+' before closing its table.');}else if(!protectedTable(t)&&!legacySafe(t))A.fail('failed-precondition','This unfinished legacy table needs an accounting review: '+(t.name||d.id));}
 const job={id,status:'closing',fromCycleId:currentId,by:auth.uid,startedAt:now,remaining:tables.size,error:null};
 tx.set(ref,job);tx.update(db.doc('clubs/'+cid),{settlementClosing:{id,status:'closing',by:auth.uid,at:now},botsAuto:false,...(auth.club.botLobby?{'botLobby.enabled':false}:{})});
 for(const d of tables.docs){const t=d.data();if(protectedTable(t)&&!t.tournamentId&&!spinRunning(t))tx.update(d.ref,{closeRequested:{by:auth.uid,at:now,cycleClosureId:id},...(t.botLobby?{'botLobby.disabled':true}:{}),'gameState.__seq':(t.gameState?.__seq||0)+1});}
 tx.set(S.root(db,cid).collection('audit').doc(),{uid:auth.uid,action:'begin-close-tables',at:now,details:{id,cycleId:currentId,tables:tables.size,previousRequest:saved?.id||null}});
 return{ok:true,closureId:id};
}
async function advance(db,cid,id,finish){
 const clubRef=db.doc('clubs/'+cid),ref=stateRef(db,cid),initial=S.data(await ref.get());
 if(!initial||initial.id!==id)return{ok:true};
 if(initial.status==='completed')return{ok:true,cycleId:initial.nextCycleId};
 const tables=await db.collection('tables').where('clubId','==',cid).get();let error=null;
 for(const d of tables.docs){
  try{await db.runTransaction(async tx=>{
   const club=S.data(await tx.get(clubRef));if(club?.settlementClosing?.id!==id)return;
   const snap=await tx.get(d.ref);if(!snap.exists)return;const t=snap.data(),now=Date.now(),life=require('./pokerTableLifecycle');
   if(t.tournamentId){const event=S.data(await tx.get(db.doc('tournaments/'+A.key(t.tournamentId))));if(!event||activeEvent(event))A.fail('failed-precondition','Finish the active tournament before closing its table.');return life.archiveTable(tx,db,d.ref,t,initial.by,now);}
   if(!protectedTable(t)){if(!legacySafe(t))A.fail('failed-precondition','A legacy table needs an accounting review.');return life.archiveTable(tx,db,d.ref,t,initial.by,now);}
   if(spinRunning(t))return;
   if(A.idle(t)&&(t.gameState?.phase!=='showdown'||now-(t.gameState.showdownAt||0)>=5000))return life.closeTable(tx,db,d.ref,t,initial.by,now);
   if(!t.closeRequested)tx.update(d.ref,{closeRequested:{by:initial.by,at:now,cycleClosureId:id},'gameState.__seq':(t.gameState?.__seq||0)+1});
  });}catch(e){error=String(e.message||'A table could not be closed.').slice(0,300);}
 }
 try{return await db.runTransaction(async tx=>{
  const club=S.data(await tx.get(clubRef)),job=S.data(await tx.get(ref));
  if(!job||job.id!==id)return{ok:true};
  if(job.status==='completed')return{ok:true,cycleId:job.nextCycleId};
  if(club?.settlementClosing?.id!==id)A.fail('failed-precondition','The closing request changed. Refresh the report.');
  const [remaining,events]=await Promise.all([tx.get(db.collection('tables').where('clubId','==',cid)),tx.get(db.collection('tournaments').where('clubId','==',cid))]);
  if(remaining.size||events.docs.some(d=>activeEvent(d.data()))){tx.update(ref,{remaining:remaining.size,error,updatedAt:Date.now()});return{ok:true,closing:true,closureId:id,remaining:remaining.size};}
  const ctx=await S.context(tx,db,cid),currentId=ctx.config?.currentCycleId||'legacy_current';
  if(currentId!==job.fromCycleId)A.fail('failed-precondition','The cycle changed during closing. Review its saved report.');
  const now=Date.now(),result=await finish(tx,db,cid,{uid:job.by,club,manager:true,role:'owner'},ctx,now);
  tx.update(ref,{status:'completed',nextCycleId:result.cycleId,remaining:0,error:null,completedAt:now});
  tx.update(clubRef,{settlementClosing:null});return result;
 });}catch(e){await db.runTransaction(async tx=>{const job=S.data(await tx.get(ref));if(job?.id===id&&job.status==='closing')tx.update(ref,{error:String(e.message||'Could not finish closing.').slice(0,300),updatedAt:Date.now()});});throw e;}
}
module.exports={begin,advance,progress};
