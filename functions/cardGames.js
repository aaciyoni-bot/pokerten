'use strict';
// Durak/OFC commands use the same membership, idempotency and funded ledger
// boundary as poker. Only projections are readable in the shared table doc.
const crypto=require('node:crypto');
const {onCall}=require('firebase-functions/v2/https');
const {getFirestore}=require('firebase-admin/firestore');
const A=require('./pokerAuthority'),C=require('./cardGamesCore'),{prepareLedger}=require('./pokerLedger');
const opts={region:'us-central1',timeoutSeconds:60,memory:'512MiB',cors:true};
function settings(type,raw={},club={}){
 const buyIn=A.number(raw.buyIn,100,1,1000000),rakePercent=A.number(club.rakePct,6,0,100);
 const result={buyIn,rakePercent,maxPlayers:A.number(raw.maxPlayers,type==='ofc'?2:4,2,type==='ofc'?3:6,true),serverEngine:false};
 if(type==='ofc')result.stake=A.number(raw.stake,5,.25,buyIn);
 else{result.deckSize=A.number(raw.deckSize,36,36,52,true);if(![36,52].includes(result.deckSize))A.fail('invalid-argument','Choose 36 or 52 cards');result.variant=raw.variant==='perevodnoy'?'perevodnoy':'classic';result.bluffEnabled=raw.bluff===true||raw.bluffEnabled===true;}
 return result;
}
function memberSeat(uid,profile,seatIndex,type,amount,isBot=false,fundingUid=uid){return{uid,name:String(profile.username||'Player').slice(0,80),photo:String(profile.photo||''),avatarSeed:String(profile.avatarSeed||uid),seatIndex,isBot,fundingUid,left:false,out:false,inHand:false,lastSeen:Date.now(),...(type==='durak'?{cards:[]}:{top:[],mid:[],bot:[],pending:[],disc:[],flC:0,flNext:0,stack:amount,buyTotal:amount})};}
async function load(tx,db,ref,pub){
 if(pub.cardGameVersion!==1||!['durak','ofc'].includes(pub.type))A.fail('failed-precondition','Reopen this legacy table from the lobby');
 const engine=await tx.get(ref.collection('priv').doc('_engine'));
 if(!engine.exists)A.fail('failed-precondition','The game state is unavailable');
 return{...engine.data(),chat:pub.chat||[],chatMuted:!!pub.chatMuted,floorCall:pub.floorCall||null,closeRequested:pub.closeRequested||null};
}
async function commit(tx,db,ref,t,effects,now,oldPlayers=[]){
 const statistics=[];
 if(t.settlement){
  const done=t.settlement,ps=Object.values(t.players).filter(p=>p.inHand);
  for(const p of ps){const award=done.awards[p.uid]||0;if(award)effects.push({type:'credit',uid:A.payee(p),amount:award});}
  const allocations=require('./pokerRake').allocateRake(done.rake,ps);
  effects.push({type:'rake',rake:done.rake,allocations,game:t.type});
  effects.push({type:'gameLog',entries:ps.filter(p=>!p.isBot).map(p=>({uid:p.uid,username:p.name,game:t.type,profit:done.profits[p.uid]||0}))});
  effects.push({type:'settlementHands',entries:ps.filter(p=>!p.isBot).map(p=>({uid:p.uid,hands:1,gameType:t.type,tableName:t.settings.name||t.type}))});
  for(const p of ps.filter(p=>!p.isBot)){const m=await tx.get(db.doc(`memberships/${p.uid}_${t.clubId}`));if(m.exists){const old=m.data().stats||{};statistics.push({ref:m.ref,patch:{'stats.gamesPlayed':(old.gamesPlayed||0)+1,'stats.gamesWon':(old.gamesWon||0)+((done.profits[p.uid]||0)>0?1:0),'stats.totalProfit':A.cash((old.totalProfit||0)+(done.profits[p.uid]||0))}});}}
  delete t.settlement;
 }
 if(t.status!=='playing')for(const [id,p]of Object.entries(t.players))if(p.left){if(t.type==='ofc'&&p.stack>0)effects.push({type:'credit',uid:A.payee(p),amount:p.stack});delete t.players[id];}
 t.seq++;const write=await prepareLedger(db,tx,t.clubId,effects,ref.id,now);write();for(const item of statistics)tx.update(item.ref,item.patch);
 tx.set(ref,C.publish(t));tx.set(ref.collection('priv').doc('_engine'),t);
 for(const uid of new Set([...oldPlayers,...Object.keys(t.players)]))tx.set(ref.collection('priv').doc(uid),C.personal(t,uid));
}
async function closeTable(tx,db,ref,pub,uid,now){
 const t=await load(tx,db,ref,pub);
 if(t.status==='playing'){tx.update(ref,{closeRequested:{by:uid,at:now}});return{ok:true,queued:true,deleted:false};}
 const effects=Object.values(t.players).filter(p=>t.type==='ofc'&&p.stack>0).map(p=>({type:'credit',uid:A.payee(p),amount:p.stack}));
 const privateDocs=await tx.get(ref.collection('priv'));const write=await prepareLedger(db,tx,t.clubId,effects,ref.id,now);write();
 tx.set(db.doc('_pkClosedTables/'+ref.id),{...C.publish(t),closedAt:now,closedBy:uid});
 for(const d of privateDocs.docs)tx.delete(d.ref);tx.delete(ref);return{ok:true,deleted:true,queued:false};
}
exports.pkCardTableCreate=onCall(opts,async r=>{
 require('./pokerSecurity').requirePokerAvailable();
 return A.command(r,'card-table-create',async(tx,db,uid,now)=>{
  const cid=A.key(r.data.clubId),type=r.data.type;if(!['durak','ofc'].includes(type))A.fail('invalid-argument','Unknown card game');
  const club=await A.tableManager(tx,db,cid,r);A.assertClubOpen(club);
  const id='card_'+crypto.createHash('sha256').update(uid+':'+r.data.requestId).digest('hex').slice(0,28),ref=db.doc('tables/'+id),t=C.newTable(type,settings(type,r.data.settings,club),uid,cid,now);
  // Creation opens an empty table. Joining/buy-in is always an explicit action.
  await commit(tx,db,ref,t,[],now);return{ok:true,tableId:id};
 });
});
exports.pkCardGame=onCall(opts,async r=>{
 require('./pokerSecurity').requirePokerAvailable();
 return A.command(r,'card-game',async(tx,db,uid,now)=>{
  const ref=db.doc('tables/'+A.key(r.data.tableId)),snap=await tx.get(ref);if(!snap.exists)A.fail('not-found','The table closed');
  const pub=snap.data();await A.member(tx,db,pub.clubId,r);const op=r.data.op;
  if(op==='delete'){await A.tableManager(tx,db,pub.clubId,r);return closeTable(tx,db,ref,pub,uid,now);}
  const t=await load(tx,db,ref,pub),effects=[],oldPlayers=Object.keys(t.players),p=t.players[uid];
  if(['join','addbot','start','topup','refillbots'].includes(op)){await A.activeClub(tx,db,t.clubId);if(t.closeRequested)A.fail('failed-precondition','The table is closing');}
  if(op==='join'||op==='addbot'){
   if(t.status==='playing')A.fail('failed-precondition','Wait for the current hand to finish');
   if(op==='join'&&p)return{ok:true};if(Object.keys(t.players).length>=t.settings.maxPlayers)A.fail('failed-precondition','The table is full');
   let who=uid,profile,funder=uid;
   if(op==='addbot'){const club=await A.tableManager(tx,db,t.clubId,r);funder=club.ownerUid;who='bot_'+crypto.createHash('sha256').update(uid+r.data.requestId).digest('hex').slice(0,24);profile={username:require('./botNames').botName(who,Object.values(t.players).map(p=>p.name))};}
   else{const u=await tx.get(db.doc('users/'+uid));profile=u.exists?u.data():{};}
   let ix=0;const taken=new Set(Object.values(t.players).map(p=>p.seatIndex));while(taken.has(ix))ix++;
   t.players[who]=memberSeat(who,profile,ix,t.type,t.settings.buyIn,op==='addbot',funder);
   if(t.type==='ofc')effects.push({type:'credit',uid:funder,amount:-t.settings.buyIn});
   t.waitlist=t.waitlist.filter(w=>w.uid!==who);
  }else if(op==='start'){
   if(t.hostUid!==uid&&!p)await A.tableManager(tx,db,t.clubId,r);
   if(t.status==='showdown'&&now-t.showdownAt<5000)A.fail('failed-precondition','Review the result before the next hand');
   if(t.type==='durak')for(const seat of Object.values(t.players).filter(p=>!p.left))effects.push({type:'credit',uid:A.payee(seat),amount:-t.settings.buyIn});
   try{C.begin(t,now);}catch(e){A.fail('failed-precondition',e.message);}
  }else if(['play','take','pass','accept','challenge','confirm'].includes(op)){
   if(!p||p.left)A.fail('permission-denied','You are not playing');
   if(r.data.seq!==t.seq)A.fail('failed-precondition','The turn changed. Try again');
   try{if(t.type==='durak')C.durakAction(t,uid,op,r.data,now);else{if(op!=='confirm')A.fail('invalid-argument','Place your cards');C.ofcAction(t,uid,r.data.stage,now);}}catch(e){A.fail('failed-precondition',e.message);}
  }else if(op==='tick'){
   if(t.closeRequested&&t.status!=='playing'&&(t.status!=='showdown'||now-t.showdownAt>=5000))return closeTable(tx,db,ref,pub,uid,now);
   const actor=t.players[t.turnUid],due=actor?.isBot?1500:(t.type==='durak'?30000:45000);
   if(t.status!=='playing'||!actor||now-t.turnStartedAt<due)return{ok:true};
   try{C.autoMove(t,now);}catch(e){A.fail('failed-precondition',e.message);}
  }else if(op==='leave'){
   if(!p)return{ok:true};
   if(t.type==='ofc'&&t.status!=='playing'&&p.stack>0)effects.push({type:'credit',uid:A.payee(p),amount:p.stack});
   if(t.type==='ofc'&&t.status==='playing'&&!p.inHand&&p.stack>0)effects.push({type:'credit',uid:A.payee(p),amount:p.stack});
   try{C.leave(t,uid,now);}catch(e){A.fail('failed-precondition',e.message);}
   if(t.hostUid===uid)t.hostUid=Object.values(t.players).find(p=>!p.left&&!p.isBot)?.uid||t.hostUid;
  }else if(op==='refillbots'){
   const club=await A.tableManager(tx,db,t.clubId,r);if(t.type!=='ofc'||t.status==='playing')A.fail('failed-precondition','Refill bots between hands');
   for(const bot of Object.values(t.players).filter(p=>p.isBot&&p.stack<=0)){effects.push({type:'credit',uid:A.payee(bot),amount:-t.settings.buyIn});bot.stack=t.settings.buyIn;bot.buyTotal=A.cash((bot.buyTotal||0)+t.settings.buyIn);}
  }else if(op==='topup'){
   if(t.type!=='ofc'||!p||t.status==='playing')A.fail('failed-precondition','Add chips between hands');
   const amount=A.number(r.data.amount,t.settings.buyIn,.01,1000000);effects.push({type:'credit',uid,amount:-amount});p.stack=A.cash(p.stack+amount);p.buyTotal=A.cash(p.buyTotal+amount);
  }else if(op==='wait'||op==='unwait'){
   t.waitlist=t.waitlist.filter(w=>w.uid!==uid);if(op==='wait'&&!p){if(t.waitlist.length>=30)A.fail('resource-exhausted','Queue full');const u=await tx.get(db.doc('users/'+uid));t.waitlist.push({uid,name:u.data()?.username||'Player',at:now});}
  }else if(op==='heartbeat'||op==='stay'){if(!p)return{ok:true};p.lastSeen=now;p.stayAt=now;
  }else if(op==='chat'||op==='floor'){
   if(t.chatMuted)await A.tableManager(tx,db,t.clubId,r);
   const last=t.chat.filter(m=>m.uid===uid).at(-1);if(last&&now-last.at<750)A.fail('resource-exhausted','Please wait');
   const u=await tx.get(db.doc('users/'+uid)),text=String(r.data.text||'').trim();if(op==='chat'&&(!text||text.length>240))A.fail('invalid-argument','Message must be 1–240 characters');
   const msg={uid,name:u.data()?.username||'Player',text,at:now,emoji:String(r.data.emoji||'').slice(0,12),gift:String(r.data.gift||'').slice(0,30),giftE:String(r.data.giftE||'').slice(0,12),to:String(r.data.to||'').slice(0,128)};
   if(op==='floor'){msg.floor=true;t.floorCall={uid,name:msg.name,at:now};}t.chat=[...t.chat.slice(-39),msg];
  }else if(op==='mute'||op==='clear-floor'){
   await A.tableManager(tx,db,t.clubId,r);if(op==='mute')t.chatMuted=r.data.muted===true;else t.floorCall=null;
  }else A.fail('invalid-argument','Unknown game operation');
  await commit(tx,db,ref,t,effects,now,oldPlayers);return{ok:true,seq:t.seq};
 });
});
// Existing GOD allowlist, checked on the server and never added to public docs.
exports.pkCardPeek=onCall(opts,async r=>{
 A.uid(r);const allowed=['aaci.yoni@gmail.com','info.bagso@gmail.com','avi057278@gmail.com','khnby749@gmail.com','bykhn3234@gmail.com','haim29071994@gmail.com','tomerbitan481@gmail.com'];
 if(r.auth.token.email_verified!==true||!allowed.includes(String(r.auth.token.email||'').toLowerCase().trim()))A.fail('permission-denied','Not allowed');
 const db=getFirestore(),ref=db.doc('tables/'+A.key(r.data.tableId));return db.runTransaction(async tx=>{const s=await tx.get(ref);if(!s.exists)A.fail('not-found','Table closed');await A.member(tx,db,s.data().clubId,r);const t=await load(tx,db,ref,s.data());if(t.seq!==r.data.seq)A.fail('failed-precondition','The turn changed');return{seq:t.seq,players:t.players,deck:t.deck,pairs:t.pairs};});
});
async function tickTable(db,id){return db.runTransaction(async tx=>{
 const ref=db.doc('tables/'+id),s=await tx.get(ref);if(!s.exists||s.data().cardGameVersion!==1)return;
 const pub=s.data(),t=await load(tx,db,ref,pub),now=Date.now();
 if(t.closeRequested&&t.status!=='playing'&&(t.status!=='showdown'||now-t.showdownAt>=5000))return closeTable(tx,db,ref,pub,t.closeRequested.by||t.hostUid,now);
 const actor=t.players[t.turnUid],due=actor?.isBot?1500:t.type==='durak'?30000:45000;
 if(t.status!=='playing'||!actor||now-t.turnStartedAt<due)return;
 C.autoMove(t,now);await commit(tx,db,ref,t,[],now,Object.keys(t.players));
});}
exports.__cardInternals={settings,memberSeat,load,commit,closeTable,tickTable};
