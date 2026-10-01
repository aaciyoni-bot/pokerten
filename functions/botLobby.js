'use strict';
// Cash tables now open only through authorized manual creation. Previously
// configured automatic pools cannot reopen deleted games or rotate tables.
// Existing tables retain their funded bot seat/session behavior below.
const crypto=require('node:crypto');
const {onCall}=require('firebase-functions/v2/https');
const A=require('./pokerAuthority');
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

// Retired entry points stay fail-closed for old scheduler versions and saved
// enabled configurations. No database migration or client update is required.
async function maintainClub() {
 return {created:0,manualOnly:true,coverage:[],missingSlots:[]};
}
async function bootstrapNetabel() {
 return {configured:false,reason:'manual-only'};
}
const TEXAS_RELEASE='bot-lobby-netabel-texas-2026-09-27';
async function upgradeNetabelTexas() {
 return {configured:false,reason:'manual-only'};
}
async function maintainBotLobbies() {
 return {created:0,manualOnly:true};
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

// Keep the old endpoint compatible for turning an old setting off, but never
// allow a stale client or saved template to re-enable automatic table opening.
exports.pkBotLobbyConfigure=onCall({region:'us-central1'},async r=>{
 require('./pokerSecurity').requirePokerAvailable();
 return A.command(r,'bot-lobby-configure',async(tx,db,uid,now)=>{
  const clubId=A.key(r.data.clubId),club=await A.clubManager(tx,db,clubId,r);
  if(typeof r.data.enabled!=='boolean')A.fail('invalid-argument','Specify whether automatic cash tables are enabled');
  if(r.data.enabled){
   A.assertClubOpen(club);
   A.fail('failed-precondition','Automatic table opening is disabled. Open tables manually from the lobby.');
  }
  tx.update(db.doc('clubs/'+clubId),{botLobby:{...(club.botLobby||{}),version:1,enabled:false,updatedAt:now,updatedBy:uid}});
  tx.set(db.collection('_pkAudit').doc(),{action:'bot-lobby-configure',clubId,uid,at:now,enabled:false,manualOnly:true});
  return{ok:true,enabled:false,manualOnly:true};
 });
});
exports.maintainBotLobbies=maintainBotLobbies;
exports.reconcileManagedSeats=reconcileManagedSeats;
exports.__botLobbyInternals={humans,safeCash,buyIn,expiry,botQueue,makeTable,maintainClub,bootstrapNetabel,healthyProfile,PROFILES,TABLE_ROTATION_GAP_MS,upgradeNetabelTexas,availabilitySlots,TEXAS_RELEASE};
