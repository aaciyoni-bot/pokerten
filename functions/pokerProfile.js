'use strict';
const {onCall}=require('firebase-functions/v2/https');
const A=require('./pokerAuthority');
const opts={region:'us-central1'};
const text=(value,max,label)=>{if(typeof value!=='string'||value.length>max)A.fail('invalid-argument','Invalid '+label);return value.trim();};

// Keep the public profile and club copies together without accepting wallet,
// role, player-code or approval fields from the browser.
exports.pkProfile=onCall(opts,async r=>A.command(r,'profile',async(tx,db,uid)=>{
 const raw=r.data.patch||{},patch={};
 for(const k of Object.keys(raw))if(!['username','photo','avatarSeed'].includes(k))A.fail('invalid-argument','Unsupported profile field');
 if('username'in raw){patch.username=text(raw.username,20,'name');if(patch.username.length<2)A.fail('invalid-argument','Name must be 2 to 20 characters');}
 if('photo'in raw){patch.photo=text(raw.photo,80000,'photo');if(patch.photo&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(patch.photo))A.fail('invalid-argument','Invalid photo');}
 if('avatarSeed'in raw)patch.avatarSeed=text(raw.avatarSeed,128,'avatar');
 if(!Object.keys(patch).length)A.fail('invalid-argument','No profile changes');
 const profile=await tx.get(db.doc('users/'+uid));if(!profile.exists)A.fail('not-found','Profile missing');
 const memberships=await tx.get(db.collection('memberships').where('uid','==',uid));
 if(memberships.size>400)A.fail('resource-exhausted','Too many club profiles');
 tx.update(profile.ref,patch);for(const m of memberships.docs)tx.update(m.ref,patch);
 return{ok:true};
}));

exports.pkClubInbox=onCall(opts,async r=>A.command(r,'club-inbox',async(tx,db,uid,now)=>{
 const cid=A.key(r.data.clubId);await A.member(tx,db,cid,r);
 const ref=db.doc(`memberships/${uid}_${cid}`),m=await tx.get(ref);if(!m.exists)A.fail('not-found','Membership missing');
 tx.update(ref,{inboxReadAt:now});return{ok:true};
}));

exports.pkClubBroadcast=onCall(opts,async r=>A.command(r,'club-broadcast',async(tx,db,uid,now)=>{
 const cid=A.key(r.data.clubId),club=await A.owner(tx,db,cid,r),message=text(r.data.text,300,'message');
 if(message.length<2)A.fail('invalid-argument','Write a message');
 const ref=db.doc('broadcasts/'+cid),old=await tx.get(ref),profile=await tx.get(db.doc('users/'+uid));
 const entry={text:message,at:now,by:profile.data()?.username||'Club owner'};
 tx.set(ref,{...entry,clubName:club.name||'',history:[...(old.data()?.history||[]).slice(-19),entry]});
 return{ok:true,entry};
}));

exports.pkClubDirectory=onCall(opts,async r=>{
 const uid=A.uid(r),cid=A.key(r.data?.clubId),db=require('firebase-admin/firestore').getFirestore();
 return db.runTransaction(async tx=>{
  const club=await tx.get(db.doc('clubs/'+cid)),me=await tx.get(db.doc(`memberships/${uid}_${cid}`));
  if(!club.exists)A.fail('not-found','Club missing');
  const owner=A.root(r)||club.data().ownerUid===uid,role=me.data()?.role;
  if(!owner&&(me.data()?.status!=='approved'||!['manager','agent'].includes(role)))A.fail('permission-denied','Club staff only');
  let query=db.collection('memberships').where('clubId','==',cid);
  if(!owner&&role==='agent')query=query.where('agentUid','==',uid);
  const members=await tx.get(query),rows=members.docs.map(d=>({id:d.id,...d.data()}));
  if(!rows.some(m=>m.uid===uid)&&me.exists)rows.push({id:me.id,...me.data()});
  // An agent receives only their own commissions and assigned players.
  let logs=db.collection('agentLog').where('clubId','==',cid);
  if(!owner)logs=logs.where('agentUid','==',uid);
  const history=await tx.get(logs);
  return{members:rows,agentLog:history.docs.map(d=>d.data())};
 });
});

exports.pkAgentLookup=onCall(opts,async r=>{
 A.uid(r);const cid=A.key(r.data?.clubId),code=text(r.data?.code,12,'agent code').toUpperCase();
 if(!/^[A-Z0-9]{4,12}$/.test(code))A.fail('invalid-argument','Invalid agent code');
 const db=require('firebase-admin/firestore').getFirestore(),rows=await db.collection('memberships').where('clubId','==',cid).where('agentCode','==',code).limit(2).get();
 const agent=rows.docs.find(d=>d.data().status==='approved'&&d.data().role==='agent')?.data();
 return{agent:agent?{uid:agent.uid,name:agent.username||'Agent',pct:agent.agentSharePct??50}:null};
});
