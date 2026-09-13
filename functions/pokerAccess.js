'use strict';
const crypto=require('node:crypto');
const {onCall}=require('firebase-functions/v2/https');
const A=require('./pokerAuthority'),C=require('./pokerCore'),{prepareLedger}=require('./pokerLedger');
const {key,fail,cash,number,root,owner,member,command,capacity}=A;
const opts={region:'us-central1'};
const available=()=>require('./pokerSecurity').requirePokerAvailable();
function tableSettings(raw={}){
 const s={};for(const [k,min,max,def]of [['blinds',.01,100000,.5],['minBuyIn',.01,10000000,40],['maxBuyIn',.01,10000000,200],['minBuyInBB',0,100000,0],['maxBuyInBB',0,100000,0],['maxPlayers',2,9,6],['autoStart',2,9,2],['actionTime',10,120,30],['rakePercent',0,20,0],['rakeCap',0,100000,0],['ante',0,100000,0],['bombEvery',0,1000,0],['bombAnte',0,100,2],['leaveNoticeMins',0,120,0],['leaveNoticeBB',0,100000,0],['spinBuyIn',.01,100000,50],['spinStack',10,10000000,1000],['spinLevelSec',30,3600,180]])s[k]=number(raw[k],def,min,max);
 for(const k of ['isDealerChoice','straddle','spinMode','runTwice','autoMuck'])s[k]=raw[k]===true;
 s.omahaPotLimit=raw.omahaPotLimit!==false;s.baseGameType=raw.baseGameType||'NLH';if(!C.GAME_CARDS[s.baseGameType])fail('invalid-argument','Unknown poker game');
 if(s.maxBuyIn<s.minBuyIn)fail('invalid-argument','Maximum is below minimum');s.maxPlayers=capacity(s);s.autoStart=Math.min(Math.floor(s.autoStart),s.maxPlayers);s.serverEngine=true;
 s.aofEvery=raw.aofEvery==='orbit'?'orbit':number(raw.aofEvery,0,0,1000,true);s.name=String(raw.name||'').slice(0,60);
 if(s.spinMode)Object.assign(s,{maxPlayers:3,autoStart:3,rakePercent:0});return s;
}
exports.pkTableCreate=onCall(opts,async r=>{available();return command(r,'table-create',async(tx,db,uid,now)=>{
 const cid=key(r.data.clubId),club=await owner(tx,db,cid,r),s=tableSettings(r.data.settings),n=number(r.data.botCount,0,0,s.maxPlayers,true);
 const id='secure_'+crypto.createHash('sha256').update(uid+':'+r.data.requestId).digest('hex').slice(0,28),ref=db.doc('tables/'+id),old=await tx.get(ref);if(old.exists)return{ok:true,tableId:id};
 const players={},cost=s.spinMode?s.spinBuyIn:Math.min(s.maxBuyIn,Math.max(s.minBuyIn,100*s.blinds*2));
 const write=await prepareLedger(db,tx,cid,n?[{type:'credit',uid:club.ownerUid,amount:-cash(n*cost)}]:[],id,now);
 for(let i=0;i<n;i++){const bid='bot_'+id+'_'+i;players[bid]={uid:bid,name:'Bot '+(i+1),isBot:true,fundingUid:club.ownerUid,botStyle:['tight','balanced','aggressive'][i%3],seatIndex:i,stack:s.spinMode?s.spinStack:cost,buyTotal:s.spinMode?0:cost,spinPaid:s.spinMode?cost:0,bet:0,status:'active',cards:[],cardCount:0};}
 write();tx.set(ref,{authorityVersion:2,type:'poker',clubId:cid,createdBy:uid,createdAt:now,settings:s,players,chat:[],leftStacks:{},gameState:{phase:'waiting',board:[],pots:[],highestBet:0,minRaise:s.blinds*2,activeTurnUid:null,turnStartedAt:null,handN:0,__seq:0}});return{ok:true,tableId:id};
});});
exports.pkSeat=onCall(opts,async r=>{available();return command(r,'seat',async(tx,db,uid,now)=>{
 const tid=key(r.data.tableId),ref=db.doc('tables/'+tid),snap=await tx.get(ref);if(!snap.exists)fail('not-found','Table missing');const t=snap.data(),s=t.settings||{},cid=t.clubId||'main';
 if(t.authorityVersion!==2||!s.serverEngine)fail('failed-precondition','Open a protected table');await member(tx,db,cid,r);
 const us=await tx.get(db.doc('users/'+uid)),profile=us.exists?us.data():{},op=r.data.op,pl=t.players||{},p=pl[uid],idle=A.idle(t),patch={},effects=[];let result={ok:true};
 if(t.tournamentId&&['join','topup','rebuy','addbot'].includes(op))fail('failed-precondition','Use tournament registration');
 if(op==='join'||op==='addbot'){
  let who=uid,funding=uid,name=profile.username||'Player';if(op==='addbot'){const c=await owner(tx,db,cid,r);funding=key(c.ownerUid);who='bot_'+crypto.createHash('sha256').update(uid+r.data.requestId).digest('hex').slice(0,24);name='Bot '+(Object.keys(pl).length+1);}
  if(pl[who])return result;if(op==='join'&&r.data.fromWaitlist&&t.waitlist?.[0]?.uid!==uid)fail('failed-precondition','Waiting list changed');const cap=capacity(s),taken=new Set(Object.values(pl).map(p=>p.seatIndex));if(Object.keys(pl).length>=cap||s.spinMode&&t.spin)fail('failed-precondition','Table is full or Spin started');
  let seat=Number.isInteger(r.data.seatIndex)&&r.data.seatIndex>=0&&r.data.seatIndex<cap&&!taken.has(r.data.seatIndex)?r.data.seatIndex:0;while(taken.has(seat)&&seat<cap)seat++;if(seat>=cap)fail('failed-precondition','No seat available');
  const min=s.minBuyIn??40*s.blinds*2,max=s.maxBuyIn??200*s.blinds*2,buy=s.spinMode?s.spinBuyIn:op==='addbot'?Math.min(max,Math.max(min,100*s.blinds*2)):number(r.data.amount,NaN,min,max);
  const last=t.leftStacks?.[who];if(last&&now-last.at<43200000&&buy<last.amount)fail('failed-precondition','Return with at least your previous stack');effects.push({type:'credit',uid:funding,amount:-buy});
  patch[`players.${who}`]={uid:who,name,photo:op==='addbot'?'':profile.photo||'',avatarSeed:who,seatIndex:seat,stack:s.spinMode?s.spinStack:buy,buyTotal:s.spinMode?0:buy,spinPaid:s.spinMode?buy:0,bet:0,status:idle?'active':'waiting',cards:[],cardCount:0,hasActed:false,actionText:'',isBot:op==='addbot',...(op==='addbot'?{fundingUid:funding,botStyle:['tight','balanced','aggressive'][Object.keys(pl).length%3]}:{}),lastSeen:now};patch[`leftStacks.${who}`]=null;patch.waitlist=(t.waitlist||[]).filter(w=>w.uid!==who);
 }else if(op==='wait'||op==='unwait'){
  const waiting=(t.waitlist||[]).filter(p=>p.uid!==uid);if(op==='wait'&&!p){if(waiting.length>=30)fail('resource-exhausted','Waiting list full');waiting.push({uid,name:profile.username||'Player',at:now,buyAmt:number(r.data.amount,s.minBuyIn,s.minBuyIn,s.maxBuyIn)});}patch.waitlist=waiting;
 }else if(op==='chat'){
  if(t.chatMuted)await owner(tx,db,cid,r);const text=String(r.data.text||'').trim();if(!text||text.length>240)fail('invalid-argument','Message must be 1–240 characters');patch.chat=[...(t.chat||[]).slice(-59),{uid,name:profile.username||'Player',text,at:now,emoji:String(r.data.emoji||'').slice(0,12),gift:String(r.data.gift||'').slice(0,30),giftE:String(r.data.giftE||'').slice(0,12),to:String(r.data.to||'').slice(0,128)}];
 }else{
  if(!p)fail('failed-precondition','You are not seated');
  if(op==='topup'||op==='rebuy'){
   if(s.spinMode)fail('failed-precondition','Spin does not allow top-ups');const add=number(r.data.amount,NaN,.01,10000000),max=s.maxBuyIn??200*s.blinds*2;if(cash(p.stack+(p.bet||0)+(p.pendingTopUp||0)+add)>max)fail('invalid-argument','Buy-in limit exceeded');if(op==='rebuy'&&(!idle||p.stack>0))fail('failed-precondition','Wait until the hand ends');
   effects.push({type:'credit',uid,amount:-add});result.queued=!idle;patch[`players.${uid}.${idle?'stack':'pendingTopUp'}`]=cash((idle?p.stack:p.pendingTopUp||0)+add);patch[`players.${uid}.buyTotal`]=cash((p.buyTotal||0)+add);if(idle){patch[`players.${uid}.status`]='waiting';patch[`players.${uid}.sitOut`]=false;}
  }else if(op==='heartbeat')patch[`players.${uid}.lastSeen`]=now;
  else if(op==='leave-request')patch[`players.${uid}.leaveReq`]=now;
  else if(op==='cancel-leave'){patch[`players.${uid}.leaveReq`]=null;patch[`players.${uid}.leavingAt`]=null;patch[`players.${uid}.sitOutNext`]=false;}
  else if(op==='straddle'){if(!s.straddle||t.tournamentId||s.spinMode)fail('failed-precondition','Straddle unavailable');patch[`players.${uid}.straddleNext`]=r.data.enabled===true;}
  else if(op==='pause'){patch[`players.${uid}.${idle?'sitOut':'sitOutNext'}`]=true;patch[`players.${uid}.sitOutAt`]=now;}
  else if(op==='return'||op==='sitout'&&(p.sitOut||p.sitOutNext))Object.assign(patch,{[`players.${uid}.sitOut`]:false,[`players.${uid}.sitOutNext`]:false,[`players.${uid}.missed`]:0});
  else if(op==='sitout'){patch[`players.${uid}.${idle?'sitOut':'sitOutNext'}`]=true;patch[`players.${uid}.sitOutAt`]=now;}
  else fail('invalid-argument','Unknown seat operation');
 }
 const write=await prepareLedger(db,tx,cid,effects,tid,now);write();patch['gameState.__seq']=(t.gameState?.__seq||0)+1;tx.update(ref,patch);return result;
});});
exports.pkJoinClub=onCall(opts,async r=>{const uid=A.uid(r),cid=key(r.data?.clubId),db=require('firebase-admin/firestore').getFirestore();return db.runTransaction(async tx=>{
 const [c,m,u]=await tx.getAll(db.doc('clubs/'+cid),db.doc(`memberships/${uid}_${cid}`),db.doc('users/'+uid));if(!c.exists||!u.exists)fail('not-found','Club or profile missing');if(m.exists)return{status:m.data().status};const p=u.data(),admin=root(r)||c.data().ownerUid===uid;
 tx.set(m.ref,{uid,clubId:cid,username:p.username||'Player',playerId:p.playerId||'',photo:p.photo||'',role:admin?'club_owner':'player',status:admin?'approved':'pending',balance:0,clubProfits:0,agentProfits:0,createdAt:Date.now()});return{status:admin?'approved':'pending'};
});});
exports.pkClubCreate=onCall(opts,async r=>command(r,'club-create',async(tx,db,uid,now)=>{
 const name=String(r.data.name||'').trim();if(name.length<2||name.length>30)fail('invalid-argument','Club name must be 2–30 characters');const u=await tx.get(db.doc('users/'+uid));if(!u.exists)fail('failed-precondition','Finish profile registration');const id='club_'+crypto.createHash('sha256').update(uid+r.data.requestId).digest('hex').slice(0,18),old=await tx.get(db.doc('clubs/'+id));if(old.exists)return{id,...old.data()};const p=u.data();
 tx.set(db.doc('clubs/'+id),{name,ownerUid:uid,ownerName:p.username||'Owner',createdAt:now});tx.set(db.doc(`memberships/${uid}_${id}`),{uid,clubId:id,username:p.username||'Owner',playerId:p.playerId||'',role:'club_owner',status:'approved',balance:0,clubProfits:0,agentProfits:0});return{id,name,ownerUid:uid};
}));
exports.pkClubMember=onCall(opts,async r=>command(r,'club-member',async(tx,db,uid,now)=>{
 const cid=key(r.data.clubId),club=await owner(tx,db,cid,r),target=key(r.data.targetUid),ref=db.doc(`memberships/${target}_${cid}`),m=await tx.get(ref);if(!m.exists)fail('not-found','Membership missing');const op=r.data.op,p=m.data();
 if(op==='transfer'){
  if(target===uid)fail('invalid-argument','Choose another member');const value=number(r.data.amount,NaN,-10000000,10000000);if(!value)fail('invalid-argument','Amount required');const write=await prepareLedger(db,tx,cid,[{type:'credit',uid,amount:-value},{type:'credit',uid:target,amount:value}],`transfer:${uid}`,now);write();
 }else if(['approve','reject','role'].includes(op)){
  if(target===club.ownerUid&&op!=='approve')fail('failed-precondition','Cannot change the owner');const patch={};if(op==='approve')patch.status='approved';if(op==='reject')patch.status='rejected';
  if(op==='role'){if(!['player','agent','manager'].includes(r.data.role))fail('invalid-argument','Invalid role');patch.role=r.data.role;patch.managedGames=Array.isArray(r.data.managedGames)?r.data.managedGames.filter(x=>['poker','rummikube','rummy','durak','ofc'].includes(x)):[];patch.agentPct=number(r.data.agentPct,0,0,100);if(patch.role==='agent'){patch.agentCode=p.agentCode||crypto.randomBytes(4).toString('hex').toUpperCase();patch.agentSharePct=patch.agentPct;}}
  if(Object.prototype.hasOwnProperty.call(r.data,'agentUid')){const agent=r.data.agentUid?key(r.data.agentUid):null;if(agent){if(agent===target)fail('invalid-argument','Cannot be own agent');const a=await tx.get(db.doc(`memberships/${agent}_${cid}`));if(!a.exists||a.data().status!=='approved'||!['agent','manager','club_owner'].includes(a.data().role))fail('failed-precondition','Agent is not approved');if(op==='approve')patch.agentPct=number(a.data().agentPct,0,0,100);}patch.agentUid=agent;}
  tx.update(ref,patch);
 }else fail('invalid-argument','Unknown member operation');return{ok:true};
}));
exports.pkTableManage=onCall(opts,async r=>command(r,'table-manage',async(tx,db,uid)=>{
 const ref=db.doc('tables/'+key(r.data.tableId)),snap=await tx.get(ref);if(!snap.exists)fail('not-found','Table missing');const t=snap.data();await owner(tx,db,t.clubId||'main',r);if(t.authorityVersion!==2)fail('failed-precondition','Protected tables only');
 if(r.data.op==='mute')tx.update(ref,{chatMuted:r.data.muted===true});else if(r.data.op==='limits'&&!t.tournamentId){const min=number(r.data.min,NaN,.01,10000000),max=number(r.data.max,NaN,min,10000000);tx.update(ref,{'settings.minBuyIn':min,'settings.maxBuyIn':max});}else if(r.data.op==='spin'&&t.settings.spinMode&&!t.spin&&!Object.keys(t.players||{}).length){const entry=number(r.data.entry,NaN,.01,100000),stack=number(r.data.stack,NaN,10,10000000),sb=number(r.data.sb,NaN,.01,100000);tx.update(ref,{'settings.spinBuyIn':entry,'settings.minBuyIn':entry,'settings.maxBuyIn':entry,'settings.spinStack':stack,'settings.blinds':sb});}else fail('invalid-argument','Unknown table operation');return{ok:true};
}));
exports.__accessInternals={tableSettings};
exports.pkClubSettings=onCall(opts,async r=>command(r,'club-settings',async(tx,db,uid,now)=>{
 const cid=key(r.data.clubId);await owner(tx,db,cid,r);const raw=r.data.patch||{},patch={};
 for(const k of Object.keys(raw))if(!['name','logo','rakePct','closedWeeks'].includes(k))fail('invalid-argument','Unsupported club setting');
 if('name'in raw){patch.name=String(raw.name||'').trim();if(patch.name.length<2||patch.name.length>30)fail('invalid-argument','Club name must be 2–30 characters');}
 if('logo'in raw){const logo=raw.logo;if(logo!==null&&(typeof logo!=='string'||logo.length>80000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)))fail('invalid-argument','Invalid club logo');patch.logo=logo;}
 if('rakePct'in raw)patch.rakePct=number(raw.rakePct,NaN,0,20);
 if('closedWeeks'in raw){if(!raw.closedWeeks||Array.isArray(raw.closedWeeks)||typeof raw.closedWeeks!=='object'||JSON.stringify(raw.closedWeeks).length>100000)fail('invalid-argument','Invalid settlement report');patch.closedWeeks=raw.closedWeeks;}
 if(!Object.keys(patch).length)fail('invalid-argument','No settings supplied');tx.update(db.doc('clubs/'+cid),patch);tx.set(db.collection('_pkAudit').doc(),{clubId:cid,uid,at:now,action:'club-settings',fields:Object.keys(patch)});return{ok:true};
}));
exports.pkSettlementNote=onCall(opts,async r=>command(r,'settlement-note',async(tx,db,uid,now)=>{
 const cid=key(r.data.clubId);await owner(tx,db,cid,r);const target=key(r.data.targetUid),m=await tx.get(db.doc(`memberships/${target}_${cid}`));if(!m.exists)fail('not-found','Member missing');const note=String(r.data.note||'').trim();if(!note||note.length>120)fail('invalid-argument','A note is required');const amount=number(r.data.amount,NaN,-10000000,10000000);
 const entry={uid:target,username:m.data().username||'Player',clubId:cid,game:'adjust',profit:amount,rake:0,tableId:'',at:now,by:uid,note};tx.set(db.collection('gameLog').doc(),entry);return{ok:true,entry};
}));
