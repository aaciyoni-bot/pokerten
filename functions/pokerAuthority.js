'use strict';
const crypto=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {getFirestore}=require('firebase-admin/firestore');
const fail=(code,message)=>{throw new HttpsError(code,message);};
const key=(v,label='identifier')=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))fail('invalid-argument','Invalid '+label);return v;};
const cash=n=>Math.round(n*100)/100;
function number(v,fallback,min,max,integer=false){const n=v==null?fallback:Number(v);if(!Number.isFinite(n)||n<min||n>max||(integer?!Number.isInteger(n):Math.abs(cash(n)-n)>1e-7))fail('invalid-argument','Invalid numeric setting');return n;}
const root=r=>r.auth?.token?.email_verified===true&&String(r.auth.token.email||'').trim().toLowerCase()==='aaci.yoni@gmail.com';
const uid=r=>r.auth?.uid?key(r.auth.uid,'user'):fail('unauthenticated','Sign in first');
async function owner(tx,db,cid,r){const c=await tx.get(db.doc('clubs/'+key(cid,'club')));if(!c.exists)fail('not-found','Club missing');if(!root(r)&&c.data().ownerUid!==uid(r))fail('permission-denied','Club owner only');return c.data();}
async function member(tx,db,cid,r){const m=await tx.get(db.doc(`memberships/${uid(r)}_${key(cid)}`));if(!root(r)&&(!m.exists||m.data().status!=='approved'))fail('permission-denied','Approved membership required');return m.exists?m.data():{};}
async function command(r,scope,body){
 const user=uid(r),rid=key(r.data?.requestId,'request');if(rid.length<16)fail('invalid-argument','Request identifier is too short');
 const db=getFirestore(),ref=db.doc('_pkRequests/'+crypto.createHash('sha256').update(scope+':'+user+':'+rid).digest('hex'));
 const signature=crypto.createHash('sha256').update(JSON.stringify(r.data)).digest('hex');
 return db.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists){if(old.data().signature!==signature)fail('invalid-argument','Request identifier already used');return old.data().result;}
  const result=await body(tx,db,user,Date.now());tx.set(ref,{uid:user,scope,signature,result,at:Date.now()});return result;});
}
const capacity=s=>Math.max(2,Math.min(9,Math.floor(44/(s.isDealerChoice?6:(require('./pokerCore').GAME_CARDS[s.baseGameType||s.pokerType]||2))),Math.floor(Number(s.maxPlayers||s.tableSize)||9)));
const idle=t=>['waiting','showdown'].includes(t.gameState?.phase||'waiting')&&!(t.gameState?.pots||[]).some(p=>p.amount>0)&&!Object.values(t.players||{}).some(p=>p.bet>0);
const payee=p=>p.isBot?key(p.fundingUid,'bot sponsor'):key(p.uid);
module.exports={fail,key,cash,number,root,uid,owner,member,command,capacity,idle,payee};
