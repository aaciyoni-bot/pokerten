'use strict';
const A=require('./pokerAuthority');
const {onCall}=require('firebase-functions/v2/https');
const {FieldPath,FieldValue,getFirestore}=require('firebase-admin/firestore');
function write(tx,db,S) {
 const g=S.gameState,h=S.table.history?.at(-1);
 if(!S.settledWinners||!h)return;
 const cards=items=>(items||[]).slice(0,5).map(c=>String(c.val)+String(c.suit));
 const dealt=Object.values(S.players).filter(p=>p.cardCount>0);
 const common={at:h.at,table:S.id,name:S.settings.name||S.settings.tableName||S.id,game:h.game||'Poker',
  hand:g.handN,board:cards(h.board),board2:cards(g.board2),board3:cards(g.board3),winners:h.winners||'',amount:h.amount||0,
  actions:(g.publicActions||[]).map(e=>({street:e.street,name:S.players[e.uid]?.name||'Player',action:e.action,amount:e.amount||0})),
  tournament:!!S.tor||!!S.settings.spinMode};
 const docId=String(9999999999999-h.at).padStart(13,'0')+'_'+S.id+'_'+g.handN;
 for(const p of dealt) {
  if(p.isBot)continue;
  const start=g.handStartWealth?.[p.uid];
  const archive=db.collection('clubs').doc(S.table.clubId).collection('playerArchives').doc(p.uid);
  const result=Number.isFinite(start)?A.cash(p.stack-start):null;
  let sessionId=null;
  if(!common.tournament){
   // Seats created before session tracking have no reliable arrival timestamp.
   // Keep the first observed hand as the lower bound and say so in the UI.
   if(!p.seatStartedAt&&!p.archiveObservedAt)p.archiveObservedAt=h.at;
   const since=p.seatStartedAt||p.archiveObservedAt;
   sessionId=String(9999999999999-since).padStart(13,'0')+'_'+S.id;
   tx.set(archive.collection('sessions').doc(sessionId),{
    table:S.id,name:common.name,since,through:h.at,partialStart:!p.seatStartedAt,
    hands:FieldValue.increment(1),measuredHands:FieldValue.increment(result===null?0:1),
    winningHands:FieldValue.increment(S.settledWinners.has(p.uid)?1:0),
    netCents:FieldValue.increment(result===null?0:Math.round(result*100))
   },{merge:true});
  }
  tx.set(archive.collection('hands').doc(docId),{...common,result,sessionId});
 }
}
const pkMyHands=onCall({region:'us-central1'},async r=>{
 const uid=A.uid(r),cid=A.key(r.data?.clubId),db=getFirestore(),cursor=r.data?.cursor;
 if(cursor!=null&&(typeof cursor!=='string'||cursor.length>300||!/^[a-zA-Z0-9_-]+$/.test(cursor)))A.fail('invalid-argument','Invalid hand cursor.');
 return db.runTransaction(async tx=>{
  await A.member(tx,db,cid,r);
  const view=r.data?.view??'hands';
  if(!['hands','sessions'].includes(view))A.fail('invalid-argument','Unknown archive view.');
  let query=db.collection('clubs').doc(cid).collection('playerArchives').doc(uid).collection(view).orderBy(FieldPath.documentId());
  if(cursor)query=query.startAfter(cursor);
  const docs=(await tx.get(query.limit(31))).docs;
  return {rows:docs.slice(0,30).map(d=>({id:d.id,...d.data()})),nextCursor:docs.length>30?docs[29].id:null};
 },{readOnly:true});
});
module.exports={write,pkMyHands};
