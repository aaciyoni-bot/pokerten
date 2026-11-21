'use strict';
const {createHash} = require('node:crypto');
const {onCall} = require('firebase-functions/v2/https');
const {getFirestore, FieldPath} = require('firebase-admin/firestore');
const A = require('./pokerAuthority');
const {prepareLedger} = require('./pokerLedger');
const options = {region:'us-central1'};
const maxAmount = 10000000;

function regularChips(player) {
  const balance = Number(player.balance) || 0;
  return A.cash(Math.max(0, balance - Math.max(0, Number(player.bonusOpen ?? player.bonusTotal) || 0)));
}
function validatePlayer(player) {
  if (!player || player.status !== 'approved' || player.removedFromClub || player.isBot) {
    A.fail('failed-precondition', 'An approved player membership is required.');
  }
}
exports.pkWalletRequest = onCall(options, r => A.command(r, 'wallet-request', async (tx, db, uid, now) => {
  const cid = A.key(r.data.clubId);
  const requests = db.collection('clubs/'+cid+'/walletRequests');
  const locks = db.collection('clubs/'+cid+'/pendingWalletRequests');
  if (r.data.op === 'submit') {
    const member = await A.member(tx, db, cid, r);
    validatePlayer(member);
    const club = await A.activeClub(tx, db, cid);
    if (uid === club.ownerUid) A.fail('failed-precondition','The club treasury cannot request a transfer to itself.');
    const direction = r.data.direction;
    if (!['deposit','withdraw'].includes(direction)) A.fail('invalid-argument','Choose a transfer direction.');
    const amount = A.number(r.data.amount, NaN, 0.01, maxAmount);
    if (direction === 'withdraw' && amount > regularChips(member)) A.fail('failed-precondition','Amount exceeds withdrawable chips.');
    const lock = await tx.get(locks.doc(uid));
    if (lock.exists) A.fail('already-exists','You already have a pending request.');
    // Ascending document IDs list the newest requests first without composite indexes.
    const suffix = createHash('sha256').update(uid+':'+r.data.requestId).digest('hex').slice(0,32);
    const ref = requests.doc(String(9999999999999-now).padStart(13,'0')+'_'+suffix);
    tx.create(ref,{uid, name:String(member.username || member.playerId || 'Player'), direction, amount, fee:0, createdAt:now, status:'pending'});
    tx.create(locks.doc(uid),{id:ref.id});
    return {id:ref.id,status:'pending'};
  }
  if (!['approve','reject'].includes(r.data.op)) A.fail('invalid-argument','Unknown wallet action.');
  const club = await A.clubManager(tx, db, cid, r);
  const ref = requests.doc(A.key(r.data.id)), snap = await tx.get(ref);
  if (!snap.exists) A.fail('not-found','Request missing.');
  const row = snap.data(), status = r.data.op === 'approve' ? 'approved' : 'rejected';
  if (row.status !== 'pending') {
    if (row.status === status) return {id:ref.id,status};
    A.fail('failed-precondition','A manager has already reviewed this request.');
  }
  const lock = await tx.get(locks.doc(row.uid));
  if (lock.data()?.id !== ref.id) A.fail('failed-precondition','Pending request does not match.');
  if (status === 'approved') {
    A.assertClubOpen(club);
    if (row.uid === uid || row.uid === club.ownerUid) A.fail('permission-denied','Another manager must approve this transfer.');
    const member = (await tx.get(db.doc('memberships/'+row.uid+'_'+cid))).data();
    validatePlayer(member);
    const amount = row.direction === 'deposit' ? row.amount : -row.amount;
    if (amount < 0 && -amount > regularChips(member)) A.fail('failed-precondition','Withdrawable chips have changed.');
    const write = await prepareLedger(db,tx,cid,[
      {type:'credit',uid:club.ownerUid,amount:-amount}, {type:'credit',uid:row.uid,amount}
    ],'transfer:'+uid,now);
    write();
    tx.set(db.collection('_pkAudit').doc(),{clubId:cid,uid,targetUid:row.uid,fundingUid:club.ownerUid,action:'member-cashier-transfer',amount,at:now,walletRequestId:ref.id});
  }
  tx.update(ref,{status,reviewedBy:uid,reviewedAt:now});
  tx.delete(lock.ref);
  return {id:ref.id,status};
}));
exports.pkWalletRequests = onCall(options, async r => {
  const uid = A.uid(r), cid = A.key(r.data?.clubId), queue = r.data.queue === true;
  const db = getFirestore();
  return db.runTransaction(async tx => {
    if (queue) await A.clubManager(tx,db,cid,r);
    else validatePlayer(await A.member(tx,db,cid,r));
    const collection = db.collection('clubs/'+cid+'/walletRequests');
    let query = collection.where(queue ? 'status' : 'uid','==',queue ? 'pending' : uid).orderBy(FieldPath.documentId());
    if (r.data.cursor) query = query.startAfter(A.key(r.data.cursor));
    const docs = (await tx.get(query.limit(51))).docs;
    const rows = docs.slice(0,50).map(doc => {
      const {name,direction,amount,fee,status,createdAt,reviewedAt} = doc.data();
      return {id:doc.id,name,direction,amount,fee,status,createdAt,reviewedAt:reviewedAt || null};
    });
    return {rows,nextCursor:docs.length > 50 ? rows.at(-1).id : null,maxAmount,fee:0};
  },{readOnly:true});
});

exports.pkWalletHistory = onCall(options, async r => {
  const uid=A.uid(r), cid=A.key(r.data?.clubId);
  const db=getFirestore();
  return db.runTransaction(async tx=>{
    validatePlayer(await A.member(tx,db,cid,r));
    // Historical journal documents store movement objects in an array. Select
    // only the caller's changes before returning the page, including old rows.
    let query=db.collection('_pkLedger').where('clubId','==',cid).orderBy(FieldPath.documentId());
    if(r.data.cursor)query=query.startAfter(A.key(r.data.cursor));
    const docs=(await tx.get(query.limit(201))).docs, records=[];
    for(const doc of docs.slice(0,200)){
      const row=doc.data(), change=Array.isArray(row.movements)&&row.movements.find(m=>m.uid===uid);
      if(!change || !Number.isFinite(change.amount) || !change.amount)continue;
      records.push({id:doc.id,at:Number(row.at)||0,amount:change.amount,
        type:String(row.source||'').startsWith('transfer:')?'Club transfer':'Chip movement'});
    }
    return {records,nextCursor:docs.length>200?docs[199].id:null};
  },{readOnly:true});
});
