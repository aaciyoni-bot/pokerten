'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getFirestore}=require('firebase-admin/firestore');
const {prepareLedger}=require('./pokerLedger');
const CLUB='synga_main',OWNER='aaci.yoni@gmail.com',ISSUE=10000000;
exports.siteAccess=onCall({region:'us-central1'},async request=>{
 const auth=request.auth;if(!auth?.uid)throw new HttpsError('unauthenticated','Please sign in.');
 const owner=auth.token.email_verified===true&&String(auth.token.email||'').trim().toLowerCase()===OWNER;
 const db=getFirestore('synga'),uid=auth.uid,now=Date.now();
 return db.runTransaction(async tx=>{
  const clubRef=db.doc('clubs/'+CLUB),memberRef=db.doc(`memberships/${uid}_${CLUB}`),receipt=db.doc('_syngaIssuance/owner-reserve-v1');
  const [club,member,user,issued]=await tx.getAll(clubRef,memberRef,db.doc('users/'+uid),receipt);
  if(!user.exists)throw new HttpsError('failed-precondition','Complete registration first.');
  if(!club.exists||club.data().archived)throw new HttpsError('failed-precondition','SYNGA is not open yet. Contact the administrator.');
  if(owner&&club.data().ownerUid!==uid)throw new HttpsError('permission-denied','The verified owner does not match the treasury account.');
  if(!member.exists){
   if(owner)throw new HttpsError('failed-precondition','Owner membership must be initialized first.');
   const p=user.data();tx.create(memberRef,{uid,clubId:CLUB,username:p.username||'Player',playerId:p.playerId||'',photo:p.photo||'',role:'player',status:'pending',balance:0,clubProfits:0,agentProfits:0,createdAt:now});
   return {clubId:CLUB,status:'pending'};
  }
  if(owner&&!issued.exists){
   // Same transaction: journal, existing treasury balance increment and durable receipt.
   const write=await prepareLedger(db,tx,CLUB,[{type:'credit',uid,amount:ISSUE}], 'synga-owner-reserve-v1',now);
   write();tx.create(receipt,{uid,clubId:CLUB,amount:ISSUE,kind:'initial-play-chip-reserve',createdAt:now});
   tx.create(db.collection('adminAudit').doc(),{uid,clubId:CLUB,action:'initial-play-chip-reserve',amount:ISSUE,at:now});
  }
  return {clubId:CLUB,status:member.data().status,...(owner?{reserveIssued:true}:{})};
 });
});
exports.pkClubCreate=onCall({region:'us-central1'},async()=>{throw new HttpsError('failed-precondition','SYNGA is one shared club. Request site access instead.');});
exports.pkClubArchive=onCall({region:'us-central1'},async()=>{throw new HttpsError('failed-precondition','The SYNGA site club cannot be archived.');});
