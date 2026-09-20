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
   if(e.rakeSource==='unclassified'){add(club.data().ownerUid,e.rake);agentLogs.push({kind:'unclassified',rakeSource:'unclassified',accountingVersion:2,amount:e.rake});continue;}
   const allocations=e.allocations||require('./pokerRake').allocateRake(e.rake,[...new Set(e.uids||[])].map(uid=>({uid})));
   if(allocations.reduce((n,p)=>n+Math.round(p.amount*100),0)!==Math.round(e.rake*100))fail('failed-precondition','Rake attribution does not balance');
   const ids=[...new Set(allocations.filter(p=>!p.isBot).map(p=>p.uid))];
   const members=ids.length?await tx.getAll(...ids.map(x=>db.doc(`memberships/${key(x)}_${clubId}`))):[];
   const eligible=members.filter(x=>x.exists&&!x.data().isBot&&x.data().agentUid&&x.data().agentUid!==x.data().uid);
   const agentIds=[...new Set(eligible.map(x=>key(x.data().agentUid)))];
   const agents=agentIds.length?await tx.getAll(...agentIds.map(x=>db.doc(`memberships/${x}_${clubId}`))):[];
   const approved=new Set(agents.filter(x=>x.exists&&x.data().status==='approved'&&['agent','manager','club_owner'].includes(x.data().role)).map(x=>x.data().uid));
   let left=0;
   for(const p of allocations){
    if(!p.amount)continue;const m=members.find(m=>m.id===`${p.uid}_${clubId}`),isBot=p.isBot||m?.data()?.isBot;
    if(isBot){const fundingUid=p.fundingUid||club.data().ownerUid;add(fundingUid,p.amount);agentLogs.push({kind:'bot',rakeSource:'bot',accountingVersion:2,fundingUid,amount:p.amount});continue;}
    left+=Math.round(p.amount*100);logs.push({uid:p.uid,username:p.username,profit:0,rake:p.amount,rakeSource:'human',accountingVersion:2});
    const d=m?.data();if(!d?.agentUid||d.agentUid===p.uid||!approved.has(d.agentUid))continue;
    const cents=Math.floor(Math.round(p.amount*100)*Math.max(0,Math.min(100,Number(d.agentPct)||0))/100);
    if(cents){add(d.agentUid,cents/100,{agentProfits:cents/100});agentLogs.push({agentUid:d.agentUid,playerUid:p.uid,amount:cents/100,rakeSource:'human',accountingVersion:2});left-=cents;}
   }
   if(left){add(club.data().ownerUid,left/100,{clubProfits:left/100});agentLogs.push({kind:'club',amount:left/100,rakeSource:'human',accountingVersion:2});}
  }else if(e.type!=='rake')fail('failed-precondition','Unknown ledger effect');
 }
 const ids=[...deltas.keys()],snaps=ids.length?await tx.getAll(...ids.map(id=>db.doc(`memberships/${id}_${clubId}`))):[];
 const writes=snaps.map((s,i)=>{if(!s.exists)fail('failed-precondition','Funding account missing');const d=deltas.get(ids[i]),old=s.data(),balance=cash(Number(old.balance)+d.amount);if(!Number.isFinite(balance)||balance<0)fail('failed-precondition','Insufficient balance');const patch={balance};for(const [k,v]of Object.entries(d.fields))patch[k]=cash((Number(old[k])||0)+v);return{ref:s.ref,patch};});
 return()=>{for(const w of writes)tx.update(w.ref,w.patch);for(const e of logs){if(!e.uid||e.uid.startsWith('bot_'))continue;tx.set(db.collection('gameLog').doc(),{uid:key(e.uid),username:String(e.username||''),game:'poker',clubId,tableId:source,profit:cash(e.profit||0),rake:cash(e.rake||0),...(e.accountingVersion?{rakeSource:e.rakeSource,accountingVersion:e.accountingVersion}:{}),at:now});}for(const e of agentLogs)tx.set(db.collection('agentLog').doc(),{...e,clubId,tableId:source,at:now});if(ids.length)tx.set(db.collection('_pkLedger').doc(),{clubId,source,at:now,movements:ids.map(uid=>({uid,...deltas.get(uid)}))});};
}
module.exports={prepareLedger};
