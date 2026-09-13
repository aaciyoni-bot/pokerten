'use strict';
const {fail,key,cash}=require('./pokerAuthority');
// Prepare every read first. The returned closure writes in the caller's SAME
// transaction as the game state and its idempotency receipt.
async function prepareLedger(db,tx,clubId,effects,source,now){
 key(clubId);const deltas=new Map(),logs=[],agentLogs=[];
 const add=(uid,amount,fields={})=>{key(uid);if(!Number.isFinite(amount))fail('failed-precondition','Invalid ledger amount');const d=deltas.get(uid)||{amount:0,fields:{}};d.amount=cash(d.amount+amount);for(const [k,v]of Object.entries(fields)){if(!['agentProfits','clubProfits','bonusOpen','bonusTotal'].includes(k)||!Number.isFinite(v))fail('failed-precondition','Invalid ledger field');d.fields[k]=cash((d.fields[k]||0)+v);}deltas.set(uid,d);};
 for(const e of effects){
  if(e.type==='credit')add(e.uid,e.amount,e.fields);
  else if(e.type==='gameLog')logs.push(...e.entries);
  else if(e.type==='rake'&&e.rake>0){
   const club=await tx.get(db.doc('clubs/'+clubId));if(!club.exists||!club.data().ownerUid)fail('failed-precondition','Club funding account missing');
   const ids=[...new Set(e.uids||[])].filter(x=>x&&!x.startsWith('bot_'));
   const members=ids.length?await tx.getAll(...ids.map(x=>db.doc(`memberships/${key(x)}_${clubId}`))):[];
   const eligible=members.filter(x=>x.exists&&x.data().agentUid&&x.data().agentUid!==x.data().uid);
   const agentIds=[...new Set(eligible.map(x=>key(x.data().agentUid)))];
   const agents=agentIds.length?await tx.getAll(...agentIds.map(x=>db.doc(`memberships/${x}_${clubId}`))):[];
   const approved=new Set(agents.filter(x=>x.exists&&x.data().status==='approved'&&['agent','manager','club_owner'].includes(x.data().role)).map(x=>x.data().uid));
   let left=Math.round(e.rake*100);for(const m of eligible){const d=m.data();if(!approved.has(d.agentUid))continue;const cents=Math.min(left,Math.floor(e.rake*100/Math.max(1,ids.length)*Math.max(0,Math.min(100,Number(d.agentPct)||0))/100));if(cents){add(d.agentUid,cents/100,{agentProfits:cents/100});agentLogs.push({agentUid:d.agentUid,amount:cents/100});left-=cents;}}
   if(left){add(club.data().ownerUid,left/100,{clubProfits:left/100});agentLogs.push({kind:'club',amount:left/100});}
  }else if(e.type!=='rake')fail('failed-precondition','Unknown ledger effect');
 }
 const ids=[...deltas.keys()],snaps=ids.length?await tx.getAll(...ids.map(id=>db.doc(`memberships/${id}_${clubId}`))):[];
 const writes=snaps.map((s,i)=>{if(!s.exists)fail('failed-precondition','Funding account missing');const d=deltas.get(ids[i]),old=s.data(),balance=cash(Number(old.balance)+d.amount);if(!Number.isFinite(balance)||balance<0)fail('failed-precondition','Insufficient balance');const patch={balance};for(const [k,v]of Object.entries(d.fields))patch[k]=cash((Number(old[k])||0)+v);return{ref:s.ref,patch};});
 return()=>{for(const w of writes)tx.update(w.ref,w.patch);for(const e of logs){if(!e.uid||e.uid.startsWith('bot_'))continue;tx.set(db.collection('gameLog').doc(),{uid:key(e.uid),username:String(e.username||''),game:'poker',clubId,tableId:source,profit:cash(e.profit||0),rake:cash(e.rake||0),at:now});}for(const e of agentLogs)tx.set(db.collection('agentLog').doc(),{...e,clubId,tableId:source,at:now});if(ids.length)tx.set(db.collection('_pkLedger').doc(),{clubId,source,at:now,movements:ids.map(uid=>({uid,...deltas.get(uid)}))});};
}
module.exports={prepareLedger};
