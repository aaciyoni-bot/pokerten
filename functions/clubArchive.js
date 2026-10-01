'use strict';
const {onCall}=require('firebase-functions/v2/https');
const A=require('./pokerAuthority');
const {normalizeWaitlist}=require('./pokerWaitlist');

// Archiving removes a club from active discovery, never its money or history.
// Occupied tables must first use the existing close/refund path. Even a busted
// or bot-only seat is retained here rather than guessed safe to discard.
function tableBusy(table,now){
 const phase=table.gameState?.phase||table.phase||table.status||'waiting';
 return Object.keys(table.players||{}).length>0 ||
  !['waiting','showdown','done','finished','ended','gameOver','gameover'].includes(phase) ||
  Number(table.pot||0)>0 || Number(table.gameState?.pot||0)>0 ||
  (table.gameState?.pots||[]).some(p=>Number(p.amount||0)>0) ||
  !!(table.spin&&!table.spinDone) || normalizeWaitlist(table,now).length>0;
}

exports.pkClubArchive=onCall({region:'us-central1'},async request=>A.command(request,'club-archive',async(tx,db,uid,now)=>{
 const clubId=A.key(request.data.clubId,'club'),op=request.data.op;
 if(!['archive','restore'].includes(op))A.fail('invalid-argument','Choose archive or restore');
 if(clubId==='main')A.fail('failed-precondition','The main club cannot be archived');
 const club=await A.owner(tx,db,clubId,request),ref=db.doc('clubs/'+clubId);
 if(op==='archive' && (typeof request.data.confirmName!=='string'||request.data.confirmName.trim()!==String(club.name||'').trim()||!String(club.name||'').trim()))A.fail('invalid-argument','Enter the club name exactly to confirm removal');
 const archived=op==='archive';
 if((club.archived===true)===archived)return{clubId,archived};
 if(archived){
  const tables=await tx.get(db.collection('tables').where('clubId','==',clubId));
  const events=await tx.get(db.collection('tournaments').where('clubId','==',clubId));
  if(tables.docs.some(row=>tableBusy(row.data(),now)))A.fail('failed-precondition','Close occupied tables and clear waiting lists before removing this club');
  if(events.docs.some(row=>!['done','cancelled'].includes(row.data().status)))A.fail('failed-precondition','Finish or cancel all tournaments before removing this club');
  const managed=tables.docs.filter(row=>row.data().botLobby?.version===1);
  if(managed.length>400)A.fail('resource-exhausted','Close unused automatic tables before removing this club');
  // The engine reads each table in its transaction. Touching managed tables
  // prevents an empty table's bot refill from racing the archive transaction.
  for(const row of managed)tx.update(row.ref,{'botLobby.disabled':true});
 }
 const patch={archived,botsAuto:false,...(club.botLobby?{'botLobby.enabled':false}:{})};
 if(archived)Object.assign(patch,{archivedAt:now,archivedBy:uid});
 else Object.assign(patch,{restoredAt:now,restoredBy:uid});
 tx.update(ref,patch);
 tx.set(db.collection('_pkAudit').doc(),{action:'club-'+op,clubId,uid,at:now});
 return{clubId,archived};
}));
