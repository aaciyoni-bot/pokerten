'use strict';
const {onCall}=require('firebase-functions/v2/https');
const A=require('./pokerAuthority');
const Accounting=require('./pokerAccounting');
const opts={region:'us-central1'};
const text=(value,max,label)=>{if(typeof value!=='string'||value.length>max)A.fail('invalid-argument','Invalid '+label);return value.trim();};

// A profile read is scoped to the server's table/club, never a client-supplied
// club or role. It returns one result only: no rake, balances or private cards.
exports.pkTableResult=onCall({...opts,memory:'512MiB',concurrency:8},async r=>{
 const uid=A.uid(r),tableId=A.key(r.data?.tableId),target=r.data?.targetUid?A.key(r.data.targetUid):uid;
 const db=require('firebase-admin/firestore').getFirestore();
 return db.runTransaction(async tx=>{
  const snap=await tx.get(db.doc('tables/'+tableId));if(!snap.exists)A.fail('not-found','The table closed');
  const table=snap.data(),cid=A.key(table.clubId);
  const club=await tx.get(db.doc('clubs/'+cid)),me=await tx.get(db.doc(`memberships/${uid}_${cid}`));
  if(!club.exists)A.fail('not-found','Club missing');
  const manager=A.root(r)||club.data().ownerUid===uid||(me.data()?.status==='approved'&&me.data()?.role==='manager');
  if(!manager&&(target!==uid||me.data()?.status!=='approved'))A.fail('permission-denied','Own table result or club manager access required');
  if(table.type!=='poker'||table.tournamentId||table.settings?.spinMode)A.fail('failed-precondition','Table profit is available for cash poker tables');
  const rows=await tx.get(db.collection('gameLog').where('clubId','==',cid).where('tableId','==',tableId).where('uid','==',target));
  // Reuse the accounting calculation: previous cash-outs + the open sitting.
  // Deposits/rebuys are neutral, and an unfinished pot is held at hand start.
  const summary=Accounting.buildAccounting([{uid:target,status:'approved'}],rows.docs.map(d=>d.data()),[table]);
  const result=summary.players[target]?.totalResult;
  if(!Number.isFinite(result))A.fail('failed-precondition','Table result is unavailable for this player');
  return{tableId,targetUid:target,result,asOf:Date.now()};
 },{readOnly:true});
});

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
  if(!['agentLog','gameLog','securityAlerts','cashierHistory'].includes(reportSection))A.fail('invalid-argument','Unknown report section');
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
  const wallet=r.data?.accountingOnly===true && r.data.wallet===true && me.exists ? {bonus:Math.max(0,Math.min(Number(me.data().balance)||0,Number(me.data().bonusOpen??me.data().bonusTotal)||0))} : null;
  const ownAccounting=r.data?.accountingOnly===true&&!owner&&!['manager','agent'].includes(role);
  if(!owner&&(me.data()?.status!=='approved'||!['manager','agent'].includes(role)&&!ownAccounting))A.fail('permission-denied','Club staff only');
  const manager=owner||role==='manager';
  if(ownAccounting){
   // Players may request their own totals, never a directory/report section or
   // another UID. The response contains no rake, staff totals or private terms.
   if(reportSection!==undefined||directoryOnly||r.data.targetUid&&r.data.targetUid!==uid)A.fail('permission-denied','Own accounting only');
   const games=await tx.get(db.collection('gameLog').where('clubId','==',cid).where('uid','==',uid));
   const tables=await tx.get(db.collection('tables').where('clubId','==',cid));
   const cycle=await Accounting.currentCycle(tx,db,cid);
   const summary=Accounting.buildAccounting([{uid,...me.data()}],games.docs.map(d=>d.data()),tables.docs.map(d=>d.data()),{ownerUid:club.data().ownerUid,god:false,cycle});
   return{accounting:Accounting.ownAccounting(summary,uid),...(wallet?{wallet}:{})};
  }
  if(reportSection!==undefined){
   // Each page rechecks staff authority. Paging by document ID preserves legacy
   // records without timestamps and uses existing equality/name indexes.
   if(reportSection==='cashierHistory'&&!manager)A.fail('permission-denied','Club managers only');
   if(reportSection==='securityAlerts'&&!manager)return{records:[],hasMore:false,nextCursor:null};
   let visible=null;
   if(reportSection==='gameLog'&&!manager){
    diagnostic.stage='members';
    const assigned=await tx.get(db.collection('memberships').where('clubId','==',cid).where('agentUid','==',uid));
    visible=new Set([uid,...assigned.docs.map(d=>d.data().uid)]);
    diagnostic.memberCount=visible.size;
   }
   diagnostic.stage=reportSection==='gameLog'?'game-history':reportSection==='agentLog'?'agent-history':reportSection==='cashierHistory'?'cashier-history':'security-alerts';
   let query=db.collection(reportSection==='cashierHistory'?'_pkAudit':reportSection).where('clubId','==',cid);
   if(reportSection==='agentLog'&&!manager)query=query.where('agentUid','==',uid);
   query=query.orderBy(FieldPath.documentId());
   if(cursor!=null)query=query.startAfter(cursor);
   const page=await tx.get(query.limit(pageSize+1)),docs=page.docs.slice(0,pageSize),hasMore=page.docs.length>pageSize;
   if(reportSection==='agentLog')diagnostic.agentLogCount=page.docs.length;
   if(reportSection==='gameLog')diagnostic.gameLogCount=page.docs.length;
   const records=docs.filter(d=>reportSection!=='cashierHistory'||['member-transfer','member-cashier-transfer'].includes(d.data().action)).filter(d=>!visible||visible.has(d.data().uid)).map(d=>({id:d.id,...d.data()})).map(row=>reportSection==='gameLog'?Accounting.publicGameLog(row,A.root(r)):reportSection==='agentLog'?Accounting.publicAgentLog(row,A.root(r)):reportSection==='cashierHistory'?{id:row.id,targetUid:row.targetUid,amount:row.amount,at:row.at}:row);
   // Advance using the scanned page, even if agent scoping hides every row.
   return{records,hasMore,nextCursor:hasMore?docs[docs.length-1].id:null};
  }
  diagnostic.stage='members';
  let query=db.collection('memberships').where('clubId','==',cid);
  if(!owner&&role==='agent')query=query.where('agentUid','==',uid);
  const members=await tx.get(query),rows=members.docs.map(d=>({id:d.id,...d.data()}));
  if(!rows.some(m=>m.uid===uid)&&me.exists)rows.push({id:me.id,...me.data()});
  diagnostic.memberCount=rows.length;
  if(r.data?.accountingOnly===true){
   diagnostic.stage='game-history';
   const games=await tx.get(db.collection('gameLog').where('clubId','==',cid));
   const tables=await tx.get(db.collection('tables').where('clubId','==',cid));
   const cycle=await Accounting.currentCycle(tx,db,cid);
   const summary=Accounting.buildAccounting(rows,games.docs.map(d=>d.data()),tables.docs.map(d=>d.data()),{ownerUid:club.data().ownerUid,god:A.root(r),cycle});
   if(!manager){
    // Agents receive cycle results and current funds only. Lifetime results are
    // manager-only data and must not merely be hidden by the client.
    const withoutLifetime=({totalResult,totalRake,...visible})=>visible;
    summary.players=Object.fromEntries(Object.entries(summary.players).map(([id,row])=>[id,withoutLifetime(row)]));
    summary.agents=Object.fromEntries(Object.entries(summary.agents).map(([id,row])=>[id,withoutLifetime(row)]));
    summary.club=withoutLifetime(summary.club);
   }
   return{accounting:summary,...(wallet?{wallet}:{})};
  }
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
  return{members:rows,agentLog:agentLog.map(row=>Accounting.publicAgentLog(row,A.root(r))),gameLog:gameLog.map(row=>Accounting.publicGameLog(row,A.root(r))),securityAlerts,historyIncluded:!directoryOnly,treasury:treasury?{uid:treasury.uid,balance:treasury.balance,clubProfits:treasury.clubProfits||0}:null};
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


// Financial history is served through a field-filtered endpoint. Raw gameLog
// includes per-player rake and is readable directly only by the GOD allowlist.
exports.pkGameHistory=onCall({...opts,memory:'512MiB'},async r=>{
 const uid=A.uid(r),cid=r.data?.clubId?A.key(r.data.clubId):null,target=r.data?.targetUid?A.key(r.data.targetUid):uid;
 const {getFirestore,FieldPath}=require('firebase-admin/firestore'),db=getFirestore();
 const leaderboard=r.data?.leaderboard===true;if(leaderboard&&!cid)A.fail('invalid-argument','Club required');
 const cursor=r.data?.cursor;if(cursor!=null&&(typeof cursor!=='string'||!cursor.length||cursor.includes('/')||cursor==='.'||cursor==='..'||Buffer.byteLength(cursor)>1500))A.fail('invalid-argument','Invalid cursor');
 return db.runTransaction(async tx=>{
  if(!cid&&target!==uid)A.fail('permission-denied','Own history only');
  if(cid){
   const club=await tx.get(db.doc('clubs/'+cid)),me=await tx.get(db.doc(`memberships/${uid}_${cid}`));
   if(!club.exists)A.fail('not-found','Club missing');
   const manager=A.root(r)||club.data().ownerUid===uid||(me.data()?.status==='approved'&&me.data()?.role==='manager');
   if(!manager&&me.data()?.status!=='approved')A.fail('permission-denied','Approved membership required');
   if(target!==uid&&!manager){const member=await tx.get(db.doc(`memberships/${target}_${cid}`));if(me.data()?.role!=='agent'||member.data()?.agentUid!==uid)A.fail('permission-denied','Assigned player history only');}
  }
  let query=db.collection('gameLog');if(!leaderboard)query=query.where('uid','==',target);if(cid)query=query.where('clubId','==',cid);
  query=query.orderBy(FieldPath.documentId());if(cursor)query=query.startAfter(cursor);
  const page=await tx.get(query.limit(201)),docs=page.docs.slice(0,200),more=page.docs.length>200;
  return{records:docs.map(d=>leaderboard?{id:d.id,uid:d.data().uid,username:d.data().username||'',game:d.data().game||'',profit:Number(d.data().profit)>0?1:0,at:Number(d.data().at)||0}:Accounting.publicGameLog({id:d.id,...d.data()},A.root(r))),nextCursor:more?docs[docs.length-1].id:null};
 },{readOnly:true});
});

exports.pkSeatStats=onCall(opts,async r=>{
 const tableId=A.key(r.data?.tableId),target=A.key(r.data?.targetUid);
 A.uid(r);
 const db=require('firebase-admin/firestore').getFirestore();
 return db.runTransaction(async tx=>{
  const table=(await tx.get(db.doc('tables/'+tableId))).data();
  if(!table || table.type!=='poker' || table.authorityVersion!==2 || !table.players?.[target] || table.archived)A.fail('not-found','Seat unavailable');
  await A.member(tx,db,table.clubId,r);
  const id=require('node:crypto').createHash('sha256').update(JSON.stringify([table.clubId,target])).digest('hex');
  const m=(await tx.get(db.doc('_pkOpponentModels/'+id))).data()||{};
  const hands=Math.max(0,Number(m.hands)||0);
  const percent=count=>hands ? Math.min(100,Math.max(0,Math.round(100*(Number(count)||0)/hands))) : null;
  return {hands,vpip:percent(m.vpip),pfr:percent(m.pfr)};
 },{readOnly:true});
});
exports.pkClubRanks=onCall({...opts,memory:'512MiB'},async r=>{
 const cid=A.key(r.data?.clubId),period=r.data.period,game=r.data.game;
 A.uid(r);
 if(!['wins','week','trophies'].includes(period)||!['all','poker','durak','ofc'].includes(game)||
    (period==='trophies'&&game!=='all'))A.fail('invalid-argument','Unknown ranking');
 const db=require('firebase-admin/firestore').getFirestore();
 return db.runTransaction(async tx=>{
  await A.member(tx,db,cid,r);
  const members=await tx.get(db.collection('memberships').where('clubId','==',cid)
    .select('uid','username','photo','avatarSeed','status','removedFromClub','isBot','stats'));
  const rows=new Map();
  for(const d of members.docs){
   const m=d.data();
   if(m.status!=='approved'||m.removedFromClub||m.isBot||!m.uid||m.uid.startsWith('bot_'))continue;
   const trophies=Object.values(m.stats?.trophies||{}).reduce((n,v)=>n+Math.max(0,Number(v)||0),0);
   rows.set(m.uid,{uid:m.uid,username:m.username||'Player',photo:m.photo||'',avatarSeed:m.avatarSeed||'',metric:period==='trophies'?trophies:0});
  }
  if(period!=='trophies'){
   const start=period==='week'?Date.now()-7*86400000:0;
   // Only a positive settled game result scores a win. Balance adjustments,
   // fees and per-hand rake records never add a point.
   const logs=await tx.get(db.collection('gameLog').where('clubId','==',cid).select('uid','game','profit','at'));
   for(const d of logs.docs){
    const e=d.data(),row=rows.get(e.uid);
    if(row&&['poker','ofc','durak'].includes(e.game)&&(game==='all'||e.game===game)&&e.at>=start&&e.profit>0)row.metric++;
   }
  }
  return {rows:[...rows.values()].filter(r=>r.metric>0).sort((a,b)=>b.metric-a.metric ||
    a.username.localeCompare(b.username,'en') || a.uid.localeCompare(b.uid,'en')).slice(0,25)};
 },{readOnly:true});
});
