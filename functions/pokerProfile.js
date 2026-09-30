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
 const cid=A.key(r.data.clubId),club=await A.clubManager(tx,db,cid,r),message=text(r.data.text,300,'message');
 if(message.length<2)A.fail('invalid-argument','Write a message');
 const ref=db.doc('broadcasts/'+cid),old=await tx.get(ref),profile=await tx.get(db.doc('users/'+uid));
 const entry={text:message,at:now,by:profile.data()?.username||'Club owner'};
 tx.set(ref,{...entry,clubName:club.name||'',history:[...(old.data()?.history||[]).slice(-19),entry]});
 return{ok:true,entry};
}));

exports.pkClubDirectory=onCall({...opts,memory:'512MiB',concurrency:8},async r=>{
 const uid=A.uid(r),cid=A.key(r.data?.clubId),{getFirestore,FieldPath}=require('firebase-admin/firestore'),db=getFirestore();
 const reportSection=r.data?.reportSection,pageSize=r.data?.pageSize??200,cursor=r.data?.cursor;
 if(reportSection!==undefined){
  if(!['agentLog','gameLog','securityAlerts'].includes(reportSection))A.fail('invalid-argument','Unknown report section');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>200)A.fail('invalid-argument','Report page size must be 1 to 200');
  // History may have legacy IDs containing punctuation, spaces or Unicode.
  // Validate a single Firestore document ID, not the stricter player UID format.
  if(cursor!=null&&(typeof cursor!=='string'||!cursor.length||cursor.includes('/')||cursor==='.'||cursor==='..'||Buffer.byteLength(cursor,'utf8')>1500))A.fail('invalid-argument','Invalid report cursor');
  if(r.data.directoryOnly===true)A.fail('invalid-argument','Choose either the member directory or a report section');
 }
 const started=Date.now(),directoryOnly=r.data?.directoryOnly===true;
 const diagnostic={stage:'authorization',code:'unknown',elapsedMs:0,memberCount:0,agentLogCount:0,gameLogCount:0};
 try{return await db.runTransaction(async tx=>{
  const club=await tx.get(db.doc('clubs/'+cid)),me=await tx.get(db.doc(`memberships/${uid}_${cid}`));
  if(!club.exists)A.fail('not-found','Club missing');
  const owner=A.root(r)||club.data().ownerUid===uid,role=me.data()?.role;
  if(!owner&&(me.data()?.status!=='approved'||!['manager','agent'].includes(role)))A.fail('permission-denied','Club staff only');
  const manager=owner||role==='manager';
  if(reportSection!==undefined){
   // Each page rechecks staff authority. Paging by document ID preserves legacy
   // records without timestamps and uses existing equality/name indexes.
   if(reportSection==='securityAlerts'&&!manager)return{records:[],hasMore:false,nextCursor:null};
   let visible=null;
   if(reportSection==='gameLog'&&!manager){
    diagnostic.stage='members';
    const assigned=await tx.get(db.collection('memberships').where('clubId','==',cid).where('agentUid','==',uid));
    visible=new Set([uid,...assigned.docs.map(d=>d.data().uid)]);
    diagnostic.memberCount=visible.size;
   }
   diagnostic.stage=reportSection==='gameLog'?'game-history':reportSection==='agentLog'?'agent-history':'security-alerts';
   let query=db.collection(reportSection).where('clubId','==',cid);
   if(reportSection==='agentLog'&&!manager)query=query.where('agentUid','==',uid);
   query=query.orderBy(FieldPath.documentId());
   if(cursor!=null)query=query.startAfter(cursor);
   const page=await tx.get(query.limit(pageSize+1)),docs=page.docs.slice(0,pageSize),hasMore=page.docs.length>pageSize;
   if(reportSection==='agentLog')diagnostic.agentLogCount=page.docs.length;
   if(reportSection==='gameLog')diagnostic.gameLogCount=page.docs.length;
   const records=docs.filter(d=>!visible||visible.has(d.data().uid)).map(d=>({id:d.id,...d.data()}));
   // Advance using the scanned page, even if agent scoping hides every row.
   return{records,hasMore,nextCursor:hasMore?docs[docs.length-1].id:null};
  }
  diagnostic.stage='members';
  let query=db.collection('memberships').where('clubId','==',cid);
  if(!owner&&role==='agent')query=query.where('agentUid','==',uid);
  const members=await tx.get(query),rows=members.docs.map(d=>({id:d.id,...d.data()}));
  if(!rows.some(m=>m.uid===uid)&&me.exists)rows.push({id:me.id,...me.data()});
  diagnostic.memberCount=rows.length;
  const treasury=manager?rows.find(m=>m.uid===club.data().ownerUid):null;
  let agentLog=[],gameLog=[],securityAlerts=[];
  // The member list and approvals must load independently of financial history.
  // Keep the existing full-report contract for clients that do not opt in.
  if(!directoryOnly){
   diagnostic.stage='agent-history';
   let logs=db.collection('agentLog').where('clubId','==',cid);
   if(!manager)logs=logs.where('agentUid','==',uid);
   const history=await tx.get(logs);agentLog=history.docs.map(d=>d.data());
   diagnostic.agentLogCount=agentLog.length;
   if(r.data.includeReports===true){
    diagnostic.stage='game-history';
    const games=await tx.get(db.collection('gameLog').where('clubId','==',cid));
    const visible=new Set(rows.map(m=>m.uid));gameLog=games.docs.map(d=>d.data()).filter(g=>manager||visible.has(g.uid));
    diagnostic.gameLogCount=gameLog.length;
   }
   if(manager&&r.data.includeSecurity===true){
    diagnostic.stage='security-alerts';
    const alerts=await tx.get(db.collection('securityAlerts').where('clubId','==',cid));securityAlerts=alerts.docs.map(d=>({id:d.id,...d.data()}));
   }
  }
  return{members:rows,agentLog,gameLog,securityAlerts,historyIncluded:!directoryOnly,treasury:treasury?{uid:treasury.uid,balance:treasury.balance,clubProfits:treasury.clubProfits||0}:null};
 },{readOnly:true});}catch(error){
  // Only stage, standard status code and counts: never log user data or raw errors.
  const code=error?.code,known=['cancelled','unknown','invalid-argument','deadline-exceeded','not-found','already-exists','permission-denied','resource-exhausted','failed-precondition','aborted','out-of-range','unimplemented','internal','unavailable','data-loss','unauthenticated'];
  diagnostic.code=Number.isInteger(code)&&code>=0&&code<=16?String(code):known.includes(code)?code:'unknown';
  diagnostic.elapsedMs=Math.max(0,Date.now()-started);
  console.error('CLUB_DIRECTORY_DIAGNOSTIC',JSON.stringify(diagnostic));
  throw error;
 }
});

exports.pkAgentLookup=onCall(opts,async r=>{
 A.uid(r);const cid=A.key(r.data?.clubId),code=text(r.data?.code,12,'agent code').toUpperCase();
 if(!/^[A-Z0-9]{4,12}$/.test(code))A.fail('invalid-argument','Invalid agent code');
 const db=require('firebase-admin/firestore').getFirestore(),rows=await db.collection('memberships').where('clubId','==',cid).where('agentCode','==',code).limit(2).get();
 const agent=rows.docs.find(d=>d.data().status==='approved'&&['agent','manager'].includes(d.data().role))?.data();
 return{agent:agent?{uid:agent.uid,name:agent.username||'Agent',pct:agent.agentSharePct??50}:null};
});

