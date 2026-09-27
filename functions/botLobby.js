'use strict';
// Opt-in cash-table availability. Every chip uses the existing sponsor ledger;
// live human tables and human queues are never retired by this controller.
const crypto=require('node:crypto');
const {onCall}=require('firebase-functions/v2/https');
const A=require('./pokerAuthority');
const {prepareLedger}=require('./pokerLedger');
const {botName}=require('./botNames');
const {session,rotationGap}=require('./botSessions');
const {normalizeWaitlist}=require('./pokerWaitlist');
const PROFILES=[0,1,2];
const TABLE_ROTATION_GAP_MS=10*60*1000;
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const humans=(t,now=Date.now())=>Object.values(t.players||{}).some(p=>p.isBot!==true)||normalizeWaitlist(t,now).some(p=>p.isBot!==true);
const safeCash=t=>t.authorityVersion===2&&t.type==='poker'&&t.settings?.serverEngine===true&&!t.tournamentId&&!t.settings.spinMode&&!t.settings.demoOnly&&A.capacity(t.settings)>=4;
const buyIn=s=>A.cash(Math.min(s.maxBuyIn,Math.max(s.minBuyIn,100*s.blinds*2)));
const expiry=(seed,now)=>now+(60+parseInt(hash(seed).slice(0,4),16)%61)*60000;
function bot(uid,seat,buy,funding,now,names){
 return{uid,name:botName(uid,names),isBot:true,...session(uid,now),fundingUid:funding,botStyle:['tight','balanced','aggressive'][parseInt(hash(uid).slice(0,2),16)%3],seatIndex:seat,stack:buy,buyTotal:buy,bet:0,status:'active',cards:[],cardCount:0,hasActed:false,actionText:'',avatarSeed:uid,lastSeen:now};
}
function botQueue(tableId,players,waitlist,now,buy){
 const waiting=[...(waitlist||[])].sort((a,b)=>Number(a.isBot===true)-Number(b.isBot===true));
 const used=new Set([...Object.keys(players),...waiting.map(p=>p.uid)]),names=[...Object.values(players).map(p=>p.name),...waiting.map(p=>p.name)];
 let nonce=0;
 while(waiting.filter(p=>p.isBot===true).length<2){
  const uid='bot_wait_'+hash(tableId+':'+now+':'+nonce++).slice(0,22);if(used.has(uid))continue;
  const name=botName(uid,names);names.push(name);used.add(uid);waiting.push({uid,name,at:now,buyAmt:buy,isBot:true});
 }
 return waiting;
}
const legacySlotId=profile=>'main-'+profile;
const tableSlotId=t=>t.botLobby?.slotId||legacySlotId(t.botLobby?.profile);
function availabilitySlots(config){
 if(Array.isArray(config.slots)&&config.slots.length)return config.slots;
 return PROFILES.map(profile=>({id:legacySlotId(profile),profile,templates:config.templates||[]}));
}
function managedTag(profile,seed,now,configuredAt,slotId){return{version:1,profile,...(slotId?{slotId}:{}),rotateAt:expiry(seed,now),configuredAt,disabled:false};}
function makeTable(clubId,ownerUid,settings,profile,id,now,configuredAt,slotId){
 const players={},buy=buyIn(settings),count=A.capacity(settings)-profile;
 for(let i=0;i<count;i++){const uid='bot_'+hash(id+':'+i).slice(0,24);players[uid]=bot(uid,i,buy,ownerUid,now,Object.values(players).map(p=>p.name));}
 return{authorityVersion:2,type:'poker',clubId,createdBy:ownerUid,createdAt:now,settings:{...settings},players,chat:[],leftStacks:{},waitlist:profile===0?botQueue(id,players,[],now,buy):[],botLobby:{...managedTag(profile,id,now,configuredAt,slotId),fundingUid:ownerUid},gameState:{phase:'waiting',board:[],pots:[],highestBet:0,minRaise:settings.blinds*2,activeTurnUid:null,turnStartedAt:null,handN:0,__seq:0}};
}
const sameSettings=(a,b)=>JSON.stringify(Object.entries(a||{}).sort(([x],[y])=>x.localeCompare(y)))===JSON.stringify(Object.entries(b||{}).sort(([x],[y])=>x.localeCompare(y)));
const sponsoredBots=(t,owner)=>Object.values(t.players||{}).length>0&&Object.values(t.players||{}).every(p=>p.isBot===true&&p.fundingUid===owner);
const playableCount=t=>Object.values(t.players||{}).filter(p=>p.stack>0&&!p.sitOut&&!['out','busted'].includes(p.status)).length;
const healthyProfile=(t,profile,now)=>safeCash(t)&&!t.closeRequested&&!humans(t,now)&&Object.keys(t.players||{}).length===A.capacity(t.settings)-profile&&playableCount(t)>=2;
const refundable=t=>A.cash(Object.values(t.players||{}).reduce((sum,p)=>sum+(p.stack||0)+(p.bet||0)+(p.pendingTopUp||0),0)+(t.gameState?.pots||[]).reduce((sum,p)=>sum+(p.amount||0),0));

async function maintainClub(db,clubId,now=Date.now()){
 return db.runTransaction(async tx=>{
  const clubRef=db.doc('clubs/'+A.key(clubId)),cs=await tx.get(clubRef);if(!cs.exists)return{created:0};
  const club=cs.data(),config=club.botLobby;if(config?.version!==1)return{created:0};
  const tables=await tx.get(db.collection('tables').where('clubId','==',clubId));
  const rows=tables.docs.map(d=>({id:d.id,ref:d.ref,table:d.data()}));
  const managed=rows.filter(r=>r.table.botLobby?.version===1),updates=new Map(),created=[],effects=[];
  const patch=(row,value)=>updates.set(row.id,{row,value:{...(updates.get(row.id)?.value||{}),...value}});
  for(const row of rows)if(row.table.type==='poker'&&row.table.authorityVersion===2){
   const queue=normalizeWaitlist(row.table,now);
   if(JSON.stringify(queue)!==JSON.stringify(row.table.waitlist||[])){patch(row,{waitlist:queue});row.table.waitlist=queue;}
  }
  const close=row=>{if(!row.table.closeRequested&&!humans(row.table,now)&&safeCash(row.table)){patch(row,{closeRequested:{by:club.ownerUid,at:now,reason:'bot-lobby-rotation'},'gameState.__seq':(row.table.gameState?.__seq||0)+1});return true;}return false;};
  if(config.enabled!==true||club.botsAuto===false){
   for(const row of managed){patch(row,{'botLobby.disabled':true});close(row);}
   for(const {row,value}of updates.values())tx.update(row.ref,value);
   return{created:0,disabled:true};
  }
  const slots=availabilitySlots(config);
  if(!slots.length||slots.some(slot=>!slot.templates?.length)||!club.ownerUid)return{created:0};
  const bank=await tx.get(db.doc(`memberships/${A.key(club.ownerUid)}_${clubId}`));
  let available=bank.exists&&Number.isFinite(bank.data().balance)?bank.data().balance:0;
  const selected=new Set(),healthy=new Set(),fundingRetirements=[];let blocked=false;
  // Whole-table renewals run on a slower clock than individual bot sessions.
  // Keep one persistent club-wide slot; refilling a missing profile is immediate.
  let rotationUsed=false,nextTableRotationAt=Number(config.nextTableRotationAt)||0;
  const canRotate=()=>!rotationUsed&&now>=nextTableRotationAt&&!managed.some(r=>r.table.closeRequested);
  const closeOne=row=>{
   if(!canRotate()||!close(row))return false;
   rotationUsed=true;nextTableRotationAt=now+TABLE_ROTATION_GAP_MS;return true;
  };
  // Replenish a missing profile before spending spare chips on another
  // table's renewal. This also serializes low-reserve close/refund/reopen.
  const hasLive=slot=>managed.some(r=>tableSlotId(r.table)===slot.id&&!r.table.botLobby.disabled&&!r.table.closeRequested&&!humans(r.table,now)&&safeCash(r.table));
  const order=[...slots].sort((a,b)=>Number(hasLive(a))-Number(hasLive(b)));
  for(const slot of order){
   const {profile,templates}=slot;
   // Keep funded games until a replacement exists. Joining a managed table
   // detaches it from availability selection; it is never evicted or reset.
   const live=managed.filter(r=>tableSlotId(r.table)===slot.id&&!r.table.botLobby.disabled&&!r.table.closeRequested&&!humans(r.table,now)&&safeCash(r.table));
   const ready=live.find(r=>r.table.botLobby.configuredAt===config.updatedAt&&r.table.botLobby.rotateAt>now&&templates.some(s=>sameSettings(s,r.table.settings))&&Object.keys(r.table.players||{}).length>=A.capacity(r.table.settings)-profile);
   if(ready){selected.add(ready.id);if(healthyProfile(ready.table,profile,now))healthy.add(slot.id);continue;}
   // Do not let the final cleanup retire an overdue incumbent during cooldown.
   if(live.length&&!canRotate()){
    const held=live.find(r=>healthyProfile(r.table,profile,now))||live[0];
    selected.add(held.id);if(healthyProfile(held.table,profile,now))healthy.add(slot.id);continue;
   }
   const reusable=rows.filter(r=>!selected.has(r.id)&&r.table.botLobbyExcluded!==true&&!r.table.botLobby&&!r.table.closeRequested&&!r.table.pendingSettings&&safeCash(r.table)&&!humans(r.table,now)&&Object.values(r.table.players||{}).every(p=>p.fundingUid===club.ownerUid)&&Object.keys(r.table.players||{}).length>=A.capacity(r.table.settings)-profile&&templates.some(s=>sameSettings(s,r.table.settings))).sort((a,b)=>(Object.keys(a.table.players).length-A.capacity(a.table.settings))-(Object.keys(b.table.players).length-A.capacity(b.table.settings)))[0];
   if(reusable){patch(reusable,{botLobby:{...managedTag(profile,reusable.id+':'+now,now,config.updatedAt,slot.id),fundingUid:club.ownerUid}});selected.add(reusable.id);if(healthyProfile(reusable.table,profile,now))healthy.add(slot.id);if(live.length)closeOne(live[0]);continue;}
   const affordable=templates.filter(s=>A.cash((A.capacity(s)-profile)*buyIn(s))<=available);
   const choices=affordable.length?affordable:templates;
   const settings=choices[parseInt(hash(clubId+':'+slot.id+':'+now).slice(0,4),16)%choices.length];
   const cost=A.cash((A.capacity(settings)-profile)*buyIn(settings));
   if(cost>available){
    blocked=true;const fallback=live.find(r=>healthyProfile(r.table,profile,now))||live[0];
    if(fallback){
     selected.add(fallback.id);if(healthyProfile(fallback.table,profile,now))healthy.add(slot.id);
     const leastCost=Math.min(...templates.map(s=>A.cash((A.capacity(s)-profile)*buyIn(s))));
     if((fallback.table.botLobby.rotateAt<=now||fallback.table.botLobby.configuredAt!==config.updatedAt||!templates.some(s=>sameSettings(s,fallback.table.settings)))&&healthyProfile(fallback.table,profile,now)&&sponsoredBots(fallback.table,club.ownerUid)&&available+refundable(fallback.table)>=leastCost)fundingRetirements.push({row:fallback,slot});
    }
    continue;
   }
   available=A.cash(available-cost);
   const id='autobot_'+hash(clubId+':'+slot.id+':'+now).slice(0,26);
   created.push({id,table:makeTable(clubId,club.ownerUid,settings,profile,id,now,config.updatedAt,slot.id)});selected.add(id);healthy.add(slot.id);
   effects.push({type:'credit',uid:club.ownerUid,amount:-cost});
   if(live.length)closeOne(live[0]);
  }
  // With no spare treasury a fully occupied portfolio would otherwise never
  // rotate. Retire at most ONE expired or reconfigured bot-only table, while two
  // other actual funded profiles remain. Settlement returns its chips through
  // the existing close path; the missing profile gets first funding priority
  // on the next pass. Never start a second retirement while one is in flight.
  if(canRotate()&&healthy.size>=3&&!managed.some(r=>r.table.closeRequested||(!selected.has(r.id)&&!humans(r.table,now)&&safeCash(r.table)))&&fundingRetirements.length){
   const candidate=fundingRetirements.sort((a,b)=>a.row.table.botLobby.rotateAt-b.row.table.botLobby.rotateAt)[0];
   // Earlier new-table buys may have reduced the spare balance since this
   // candidate was considered. Recheck the replacement funding requirement.
   const leastCost=Math.min(...candidate.slot.templates.map(s=>A.cash((A.capacity(s)-candidate.slot.profile)*buyIn(s))));
   if(available+refundable(candidate.row.table)>=leastCost&&closeOne(candidate.row))healthy.delete(candidate.slot.id);
  }
  // Human seats/queues block retirement even if the table is overdue or is a
  // duplicate. closeRequested prevents a later join while the last hand ends.
  for(const row of managed)if(!selected.has(row.id)&&healthy.size>=2)closeOne(row);
  // The one-time named-club migration also retires its original surplus bot
  // tables, but only after all requested replacement slots are actually ready.
  if(healthy.size===slots.length)for(const row of rows)if((config.adoptTableIds||[]).includes(row.id)&&row.table.botLobbyExcluded!==true&&!selected.has(row.id)&&sponsoredBots(row.table,club.ownerUid))closeOne(row);
  const write=await prepareLedger(db,tx,clubId,effects,'bot-lobby',now);
  write();for(const {row,value}of updates.values())tx.update(row.ref,value);
  for(const entry of created)tx.create(db.doc('tables/'+entry.id),entry.table);
  tx.update(clubRef,{'botLobby.lastMaintainedAt':now,'botLobby.fundingBlockedAt':blocked?now:null,...(rotationUsed?{'botLobby.nextTableRotationAt':nextTableRotationAt}:{})});
  if(created.length)tx.set(db.collection('_pkAudit').doc(),{action:'bot-lobby-create',clubId,uid:club.ownerUid,at:now,tableIds:created.map(r=>r.id)});
  const coverage=slots.map(slot=>{
   const row=[...rows,...created.map(entry=>({id:entry.id,table:entry.table}))].find(r=>selected.has(r.id)&&tableSlotId({...r.table,...(updates.get(r.id)?.value.botLobby?{botLobby:updates.get(r.id).value.botLobby}:{})})===slot.id);
   if(!row)return{slotId:slot.id,missing:true};
   const table=row.table,closing=!!(table.closeRequested||updates.get(row.id)?.value.closeRequested);
   return{slotId:slot.id,game:table.settings.baseGameType,smallBlind:table.settings.blinds,minBuyIn:table.settings.minBuyIn,seated:Object.keys(table.players||{}).length,playable:playableCount(table),closing,matchesSettings:slot.templates.some(s=>sameSettings(s,table.settings)),humanCount:Object.values(table.players||{}).filter(p=>p.isBot!==true).length};
  });
  return{created:created.length,fundingBlocked:blocked,coverage,missingSlots:coverage.filter(row=>row.missing||row.closing||!row.matchesSettings||row.playable<2).map(row=>row.slotId)};
 });
}
const BOOTSTRAP_RELEASE='bot-lobby-netabel-2026-09-27';
async function bootstrapNetabel(db,now=Date.now()){
 return db.runTransaction(async tx=>{
  const matches=await tx.get(db.collection('clubs').where('name','==','Netabel'));
  if(matches.docs.length!==1)return{configured:false,reason:'not-unique'};
  const cs=matches.docs[0],club=cs.data(),clubId=cs.id;
  if(Object.prototype.hasOwnProperty.call(club,'botLobby')||club.botsAuto===false||!club.ownerUid)return{configured:false,reason:'existing-setting'};
  const tables=await tx.get(db.collection('tables').where('clubId','==',clubId));
  const eligible=tables.docs.map(d=>({id:d.id,table:d.data()})).filter(r=>r.table.botLobbyExcluded!==true&&safeCash(r.table)&&!r.table.closeRequested&&!r.table.pendingSettings&&!humans(r.table,now)&&sponsoredBots(r.table,club.ownerUid));
  if(!eligible.length)return{configured:false,reason:'no-existing-bot-tables'};
  const sanitize=require('./pokerAccess').__accessInternals.tableSettings;
  const templates=[];
  for(const row of eligible){const s=sanitize(row.table.settings);if(!templates.some(t=>sameSettings(t,s))&&templates.length<6)templates.push(s);}
  const candidates=eligible.filter(r=>templates.some(s=>sameSettings(s,r.table.settings))),adopted=new Set();let required=0;
  for(const profile of PROFILES){
   const existing=candidates.filter(r=>!adopted.has(r.id)&&Object.keys(r.table.players).length>=A.capacity(r.table.settings)-profile).sort((a,b)=>(Object.keys(a.table.players).length-A.capacity(a.table.settings))-(Object.keys(b.table.players).length-A.capacity(b.table.settings)))[0];
   if(existing)adopted.add(existing.id);
   else required+=Math.max(...templates.map(s=>(A.capacity(s)-profile)*buyIn(s)));
  }
  const bank=await tx.get(db.doc(`memberships/${A.key(club.ownerUid)}_${clubId}`));
  if(!bank.exists||!Number.isFinite(bank.data().balance)||bank.data().balance<A.cash(required))return{configured:false,reason:'insufficient-existing-funds'};
  const config={version:1,enabled:true,templates,updatedAt:now,updatedBy:BOOTSTRAP_RELEASE,bootstrapRelease:BOOTSTRAP_RELEASE,adoptTableIds:eligible.slice(0,60).map(r=>r.id)};
  tx.update(cs.ref,{botLobby:config});
  tx.set(db.collection('_pkAudit').doc(),{action:'bot-lobby-bootstrap',clubId,actor:BOOTSTRAP_RELEASE,at:now,templateCount:templates.length,requiredFunding:A.cash(required)});
  return{configured:true,clubId};
 });
}
const TEXAS_RELEASE='bot-lobby-netabel-texas-2026-09-27';
async function upgradeNetabelTexas(db,now=Date.now()){
 return db.runTransaction(async tx=>{
  const matches=await tx.get(db.collection('clubs').where('name','==','Netabel'));
  if(matches.docs.length!==1)return{configured:false,reason:'not-unique'};
  const cs=matches.docs[0],club=cs.data(),config=club.botLobby;
  if(config?.version!==1||config.enabled!==true||club.botsAuto===false||!club.ownerUid)return{configured:false,reason:'disabled-or-unconfigured'};
  if(config.texasRelease===TEXAS_RELEASE)return{configured:false,reason:'already-configured'};
  const sanitize=require('./pokerAccess').__accessInternals.tableSettings;
  const source=[];for(const raw of config.templates||[]){try{const s=sanitize(raw);if(!s.spinMode&&A.capacity(s)>=4&&!source.some(t=>sameSettings(t,s)))source.push(s);}catch{}}
  if(!source.length)return{configured:false,reason:'no-cash-template'};
  const variantSettings=(game,blinds,maxPlayers)=>{
   const base=source.find(s=>s.baseGameType===game)||source[0];
   return sanitize({...base,baseGameType:game,blinds,minBuyIn:100*blinds,maxBuyIn:400*blinds,minBuyInBB:50,maxBuyInBB:200,maxPlayers,autoStart:Math.min(base.autoStart,maxPlayers),isDealerChoice:false,bombEvery:0,aofEvery:0,ante:0,straddle:false,name:game+' '+blinds+'/'+(2*blinds)});
  };
  const slots=PROFILES.map(profile=>({id:legacySlotId(profile),profile,templates:[variantSettings('Omaha 6',[.5,1,2][profile],6)]}));
  for(const profile of PROFILES)slots.push({id:'nlh-'+profile,profile,templates:[variantSettings('NLH',[.5,1,2][profile],6)]});
  for(const [id,game]of [['omaha4-4max','Omaha 4'],['omaha5-4max','Omaha 5'],['pineapple-4max','Pineapple']])slots.push({id,profile:1,templates:[variantSettings(game,.5,4)]});
  const templates=[];for(const slot of slots)for(const s of slot.templates)if(!templates.some(t=>sameSettings(t,s)))templates.push(s);
  tx.update(cs.ref,{botLobby:{...config,slots,templates,updatedAt:now,updatedBy:TEXAS_RELEASE,texasRelease:TEXAS_RELEASE}});
  tx.set(db.collection('_pkAudit').doc(),{action:'bot-lobby-texas-upgrade',clubId:cs.id,actor:TEXAS_RELEASE,at:now,slotCount:slots.length});
  return{configured:true,clubId:cs.id,slots:slots.length};
 });
}
async function maintainBotLobbies(db,now=Date.now()){
 // Emit only bounded operational state, never club members, cards or balances.
 // A missing/disabled setup must be distinguishable from an unread scheduler log.
 const status=fields=>console.info('BOT_LOBBY_VARIETY_STATUS '+JSON.stringify({at:now,release:TEXAS_RELEASE,...fields}));
 let bootstrapReason;
 try{const result=await bootstrapNetabel(db,now);bootstrapReason=result.reason;if(!result.configured&&!['existing-setting','no-existing-bot-tables'].includes(result.reason))console.warn('Netabel bot lobby bootstrap skipped',result.reason);}catch(e){console.error('Netabel bot lobby bootstrap',e.message);}
 try{
  const result=await upgradeNetabelTexas(db,now);
  if(result.configured)console.info('BOT_LOBBY_VARIETY_MIGRATION '+JSON.stringify({release:TEXAS_RELEASE,slots:result.slots}));
  else if(result.reason!=='already-configured')status({reason:bootstrapReason==='insufficient-existing-funds'?'bootstrap-insufficient-existing-funds':result.reason});
 }catch(e){status({reason:'maintenance-failed'});console.error('Netabel Texas availability upgrade',e.message);}
 const clubs=await db.collection('clubs').where('botLobby.version','==',1).get();
 for(const club of clubs.docs)try{
  const result=await maintainClub(db,club.id,now);
  if(club.data().botLobby?.texasRelease===TEXAS_RELEASE)console.info('BOT_LOBBY_VARIETY_STATUS '+JSON.stringify({at:now,release:club.data().botLobby.texasRelease,coverage:result.coverage||[],fundingBlocked:result.fundingBlocked===true,missingSlots:result.missingSlots||[],disabled:result.disabled===true}));
 }catch(e){if(club.data().botLobby?.texasRelease===TEXAS_RELEASE)status({reason:'maintenance-failed'});console.error('Bot lobby maintenance',club.id,e.message);}
}

// Invoked by the existing engine transaction at the settled hand boundary.
// It shares removeSeat, the existing sponsor balance and effect ledger, so it
// cannot mint chips or change the dealer/board mid-hand.
async function reconcileManagedSeats(S,removeSeat,fundedBalance){
 const t=S.raw,tag=t.botLobby,g=S.gameState,now=S.now,players=S.players;
 if(tag?.version!==1||tag.disabled||t.closeRequested||S.tor||S.settings.spinMode||!A.idle({...t,players,gameState:g})||(g.phase==='showdown'&&now-(g.showdownAt||0)<(g.earlyWin?2500:5000)))return{};
 const patch={},humanCount=Object.values(players).filter(p=>p.isBot!==true).length;
 let queue=normalizeWaitlist({...t,players},now);
 const humanWaiting=queue.some(p=>p.isBot!==true),capacity=A.capacity(S.settings);
 const target=Math.max(0,capacity-tag.profile-humanCount-(humanWaiting&&tag.profile===0?1:0));
 const bots=Object.values(players).filter(p=>p.isBot===true&&p.fundingUid&&!p.pendingTopUp);
 const buy=buyIn(S.settings);
 const excess=bots.length>target;
 const due=bots.filter(p=>p.status==='busted'||p.leaveReq||(p.botLeavesAt||session(p.uid,p.botJoinedAt||t.createdAt||now).botLeavesAt)<=now).sort((a,b)=>(a.botLeavesAt||0)-(b.botLeavesAt||0));
 const old=excess?bots.at(-1):now>=(t.botRotateAfter||0)?due[0]:null;
 const needsBot=bots.length-(old?1:0)<target;
 const sponsor=old?.fundingUid||bots[0]?.fundingUid||tag.fundingUid;
 let canBuy=false;
 if(needsBot&&sponsor){const refund=old?A.cash((old.stack||0)+(old.bet||0)):0;canBuy=(await fundedBalance(sponsor))+refund>=buy;}
 // Keep a healthy incumbent when its replacement cannot be afforded.
 if(old&&(canBuy||!needsBot||old.status==='busted'||old.leaveReq)){
  removeSeat(S,old.uid,false);delete S.priv[old.uid];S.privateDeletes=[...(S.privateDeletes||[]),old.uid];
  patch.botNameHistory=[...(t.botNameHistory||[]),old.name].slice(-20);
  S.botRotation={clubId:S.table.clubId,tableId:S.id,action:'bot-rotation',at:now,departed:old.uid,joined:null,refund:A.cash(old.stack||0),buy:0};
 }
 const remainingBots=Object.values(players).filter(p=>p.isBot===true).length;
 if(remainingBots<target&&canBuy){
  const waiting=queue.find(p=>p.isBot===true),uid=waiting?.uid||'bot_'+hash(S.id+':seat:'+now).slice(0,24);
  const taken=new Set(Object.values(players).map(p=>p.seatIndex));let seat=old&&!players[old.uid]?old.seatIndex:0;while(taken.has(seat))seat++;
  const names=[...Object.values(players).map(p=>p.name),...(patch.botNameHistory||t.botNameHistory||[])];
  players[uid]=bot(uid,seat,buy,sponsor,now,names);if(waiting)players[uid].name=waiting.name;
  queue=queue.filter(p=>p.uid!==uid);S.effects.push({type:'credit',uid:sponsor,amount:-buy});
  S.botRotation={...(S.botRotation||{clubId:S.table.clubId,tableId:S.id,action:'bot-rotation',at:now,departed:null,refund:0}),joined:uid,buy};
  patch.botRotateAfter=now+rotationGap(uid);
 }else if(S.botRotation)patch.botRotateAfter=now+rotationGap(old.uid);
 // Keep the button's seat order when its occupant leaves. startHand advances
 // from dealerUid; a dangling deleted uid would incorrectly restart at seat 0.
 if(old&&!players[old.uid]){
  const replacement=S.botRotation?.joined;
  if(g.dealerUid===old.uid){
   const active=Object.values(players).filter(p=>p.stack>0&&!p.sitOut).sort((a,b)=>a.seatIndex-b.seatIndex);
   g.dealerUid=replacement||active.filter(p=>p.seatIndex<old.seatIndex).at(-1)?.uid||active.at(-1)?.uid||null;
  }
  if(replacement){if(g.dcUid===old.uid)g.dcUid=replacement;if(g.dcAnchor===old.uid)g.dcAnchor=replacement;}
 }
 if(tag.profile===0&&!humanCount&&!humanWaiting)queue=botQueue(S.id,players,queue,now,buy);
 if(JSON.stringify(queue)!==JSON.stringify(t.waitlist||[]))patch.waitlist=queue;
 return patch;
}

exports.pkBotLobbyConfigure=onCall({region:'us-central1'},async r=>{
 require('./pokerSecurity').requirePokerAvailable();
 return A.command(r,'bot-lobby-configure',async(tx,db,uid,now)=>{
  const clubId=A.key(r.data.clubId),club=await A.clubManager(tx,db,clubId,r);
  if(typeof r.data.enabled!=='boolean')A.fail('invalid-argument','Specify whether automatic cash tables are enabled');
  let templates=club.botLobby?.templates||[];
  if(r.data.enabled){
   const ids=r.data.templateTableIds;
   if(ids===undefined&&club.botLobby?.slots?.length){
    const slots=club.botLobby.slots,sanitize=require('./pokerAccess').__accessInternals.tableSettings;
    if(slots.length>18||new Set(slots.map(s=>s.id)).size!==slots.length||slots.some(s=>typeof s.id!=='string'||!s.id||!PROFILES.includes(s.profile)||!Array.isArray(s.templates)||!s.templates.length||s.templates.length>6))A.fail('failed-precondition','Saved automatic table configuration is invalid');
    templates=[];for(const slot of slots)for(const raw of slot.templates){const s=sanitize(raw);if(s.spinMode||A.capacity(s)<4)A.fail('failed-precondition','Saved templates must be cash tables with at least four seats');if(!templates.some(t=>sameSettings(t,s)))templates.push(s);}
   }else{
    if(!Array.isArray(ids)||ids.length<1||ids.length>6)A.fail('invalid-argument','Choose one to six existing cash tables as templates');
    const snaps=await tx.getAll(...[...new Set(ids)].map(id=>db.doc('tables/'+A.key(id))));
    templates=snaps.map(s=>{const t=s.exists?s.data():{};if(t.clubId!==clubId||!safeCash(t))A.fail('failed-precondition','Templates must be protected cash tables in this club with at least four seats');return require('./pokerAccess').__accessInternals.tableSettings(t.settings);});
   }
  }
  const previous=club.botLobby||{};
  const config={version:1,enabled:r.data.enabled,templates,updatedAt:now,updatedBy:uid,...(previous.slots?.length?{slots:previous.slots}:{}),...(previous.texasRelease?{texasRelease:previous.texasRelease}:{}),...(previous.bootstrapRelease?{bootstrapRelease:previous.bootstrapRelease}:{}),...(previous.adoptTableIds?{adoptTableIds:previous.adoptTableIds}:{}),...(previous.nextTableRotationAt?{nextTableRotationAt:previous.nextTableRotationAt}:{})};
  tx.update(db.doc('clubs/'+clubId),{botLobby:config});
  tx.set(db.collection('_pkAudit').doc(),{action:'bot-lobby-configure',clubId,uid,at:now,enabled:r.data.enabled,templateCount:templates.length});
  return{ok:true,enabled:r.data.enabled,profiles:PROFILES};
 });
});
exports.maintainBotLobbies=maintainBotLobbies;
exports.reconcileManagedSeats=reconcileManagedSeats;
exports.__botLobbyInternals={humans,safeCash,buyIn,expiry,botQueue,makeTable,maintainClub,bootstrapNetabel,healthyProfile,PROFILES,TABLE_ROTATION_GAP_MS,upgradeNetabelTexas,availabilitySlots,TEXAS_RELEASE};
