'use strict';
const crypto=require('node:crypto'),{onCall}=require('firebase-functions/v2/https'),{getFirestore}=require('firebase-admin/firestore');
const A=require('./pokerAuthority'),T=require('./pokerTournamentCore'),C=require('./pokerCore'),{prepareLedger}=require('./pokerLedger');
const {key,cash,number,fail,payee}=A;
const all=t=>Object.values(t.players||{}),price=t=>cash(t.buyIn+t.fee+(t.bountyFree?0:t.bounty));
const clock=(t,now=Date.now())=>T.clock(t,t.structure,now);
async function tables(tx,db,id){const q=await tx.get(db.collection('tables').where('tournamentId','==',id));return q.docs.map(d=>({...d.data(),docId:d.id}));}
function config(raw,clubId,creatorUid,now){
 const t={clubId,creatorUid,name:String(raw.name||'').trim().slice(0,80),game:'poker',authorityVersion:2,pokerType:raw.pokerType||'NLH',status:'reg',players:{},entryCount:0,bountyEvents:{},createdAt:now,round:0,mttMode:true,serverEngine:true};
 if(!t.name||!C.GAME_CARDS[t.pokerType])fail('invalid-argument','Tournament name and valid poker type required');
 for(const [k,def,min,max,int]of [['buyIn',0,0,10000000],['fee',0,0,1000000],['bounty',0,0,10000000],['addedPrize',0,0,10000000],['bountyBudgetRemaining',0,0,10000000],['startStack',10000,100,10000000,true],['startAt',now,0,9000000000000000,true],['maxPlayers',36,2,180,true],['minPlayers',2,2,180,true],['tableSize',9,2,9,true],['actionTime',25,10,120,true],['levelMins',5,1,120,true],['lateRegUntilLevel',0,0,100,true],['maxRebuys',3,0,100,true],['rebuyUntilLevel',2,1,100,true],['addonLevel',3,1,100,true],['maxReentries',1,0,20,true],['anteFromLevel',10,1,100,true],['breakEvery',0,0,100,true],['breakMins',0,0,60,true],['progressiveCashPct',50,1,100],['mysteryStartLevel',3,1,100,true],['paidPct',0,0,50]])t[k]=number(raw[k],def,min,max,int);
 if(t.minPlayers>t.maxPlayers)fail('invalid-argument','Minimum exceeds maximum entrants');t.tableSize=T.capacity(t);
 for(const k of ['rebuys','addon','reentry','bountyFree','botFill','demoOnly','prizeAsBonus'])t[k]=raw[k]===true;t.botRebuys=raw.botRebuys!==false;
 t.bountyMode=raw.bountyMode||(raw.mysteryBounty?'mystery':'fixed');if(!['fixed','progressive','mystery'].includes(t.bountyMode))fail('invalid-argument','Invalid bounty mode');t.mysteryBounty=t.bountyMode==='mystery';t.anteType=raw.anteType||'bb';if(!['none','each','bb'].includes(t.anteType))fail('invalid-argument','Invalid ante type');
 if(t.demoOnly&&(t.buyIn||t.fee||t.bounty||t.addedPrize||t.bountyBudgetRemaining))fail('invalid-argument','Bots-only demonstrations have no money fees or prizes');
 if(t.mysteryBounty&&t.mysteryStartLevel<=Math.max(t.lateRegUntilLevel,t.rebuys?t.rebuyUntilLevel:0))fail('invalid-argument','Mystery starts after entry and rebuy close');
 const rows=raw.structure||Array.from({length:25},(_,i)=>({sb:Math.round(10*Math.pow(1.5,i)),bb:Math.round(20*Math.pow(1.5,i)),ante:i+1>=t.anteFromLevel?Math.round((t.anteType==='each'?10:20)*Math.pow(1.5,i)):0,mins:t.levelMins}));
 if(!Array.isArray(rows)||!rows.length||rows.length>100)fail('invalid-argument','Blind structure must have 1–100 levels');t.structure=rows.map(r=>{const sb=number(r.sb,NaN,.01,10000000);return{sb,bb:number(r.bb,NaN,sb,10000000),ante:number(r.ante,0,0,10000000),mins:number(r.mins,t.levelMins,1,120)};});
 t.payouts=Array.isArray(raw.payouts)&&raw.payouts.length?raw.payouts.map(v=>number(v,NaN,0,100)):[50,30,20];if(Math.abs(t.payouts.reduce((a,b)=>a+b,0)-100)>.01)fail('invalid-argument','Prize percentages must total 100');
 t.prizePool=t.addedPrize;t.feeTotal=0;t.bountyPool=0;if(!t.bountyFree)t.bountyBudgetRemaining=0;return t;
}
function seat(p,index,stack){return{uid:p.uid,name:p.name,photo:p.photo||'',avatarSeed:p.uid,playerId:p.playerId||'',isBot:!!p.isBot,...(p.isBot?{fundingUid:p.fundingUid,botStyle:p.botStyle}:{}),seatIndex:index,stack,bet:0,buyTotal:0,status:'waiting',cards:[],cardCount:0,hasActed:false,actionText:'',lastSeen:Date.now()};}
function tableDoc(t,players,now){return{authorityVersion:2,type:'poker',clubId:t.clubId,createdBy:t.creatorUid,createdAt:now,tournamentId:t.id,players,chat:[],tournament:{name:t.name,torId:t.id,mttMode:true,startedAt:t.startedAt,structure:t.structure,levelMins:t.levelMins,anteType:t.anteType,anteFromLevel:t.anteFromLevel,breakEvery:t.breakEvery,breakMins:t.breakMins,rebuyUntil:t.rebuys?t.rebuyUntilLevel-1:-1,addonAt:t.addon?t.addonLevel-1:-1,startStack:t.startStack,bounty:t.bounty,round:1,final:false,finished:false,demoOnly:t.demoOnly},settings:{serverEngine:true,baseGameType:t.pokerType,maxPlayers:t.tableSize,blinds:t.structure[0].sb,actionTime:t.actionTime,rakePercent:0,autoStart:2,omahaPotLimit:true,demoOnly:t.demoOnly,botGodGuard:false},gameState:{phase:'waiting',board:[],pots:[],highestBet:0,minRaise:t.structure[0].bb,activeTurnUid:null,turnStartedAt:null,handN:0,__seq:0}};}
function docOf(t){const {id,...doc}=t;return doc;}
function funding(t,effects,p){const cost=price(t);if(t.bountyFree&&t.bountyBudgetRemaining<t.bounty)fail('failed-precondition','Club bounty reserve needs funding');if(cost)effects.push({type:'credit',uid:payee(p),amount:-cost});p.paid=cash((p.paid||0)+cost);p.bountyValue=t.bounty;t.prizePool=cash(t.prizePool+t.buyIn);t.feeTotal=cash(t.feeTotal+t.fee);t.bountyPool=cash(t.bountyPool+t.bounty);if(t.bountyFree)t.bountyBudgetRemaining=cash(t.bountyBudgetRemaining-t.bounty);}
function addBots(t,ownerUid,effects){
 const missing=t.maxPlayers-all(t).filter(p=>!p.out).length;for(let i=0,n=0;n<missing;i++){const uid='bot_'+t.id+'_'+i;if(t.players[uid])continue;n++;const p={uid,name:'Bot '+(i+1),isBot:true,fundingUid:ownerUid,botStyle:['tight','balanced','aggressive'][i%3],out:false,rank:null,bounties:0,bountyWon:0,paid:0,rebuys:0,reentries:0,addon:false};funding(t,effects,p);t.players[uid]=p;t.entryCount++;}
}
function start(tx,db,t,now){
 const entrants=all(t).filter(p=>!p.out);if(entrants.length<t.minPlayers)fail('failed-precondition','Not enough registered players');for(let i=entrants.length-1;i>0;i--){const j=crypto.randomInt(i+1);[entrants[i],entrants[j]]=[entrants[j],entrants[i]];}
 t.startedAt=now;t.status='running';t.round=1;t.seededRound=1;t.initialChips=entrants.length*t.startStack;const count=Math.ceil(entrants.length/t.tableSize),groups=Array.from({length:count},()=>({}));
 entrants.forEach((p,i)=>{const g=i%count;p.tableId='tour_'+t.id+'_'+g;groups[g][p.uid]=seat(p,Object.keys(groups[g]).length,t.startStack);});groups.forEach((players,i)=>tx.set(db.doc('tables/tour_'+t.id+'_'+i),tableDoc(t,players,now)));
}
function canRebuy(t,p,now){return t.rebuys&&(!p.isBot||t.botRebuys)&&clock(t,now).lvl+1<=t.rebuyUntilLevel&&(p.rebuys||0)<t.maxRebuys;}
async function final(tx,db,t,rows,champion,now){
 t.players[champion].rank=1;const ranked=all(t).sort((a,b)=>(a.rank||999)-(b.rank||999)),count=t.paidPct?Math.max(1,Math.floor(ranked.length*t.paidPct/100)):Math.min(ranked.length,t.payouts.length);
 const weights=t.paidPct?Array.from({length:count},(_,i)=>1/Math.pow(i+1,.9)):t.payouts.slice(0,count),sum=weights.reduce((a,b)=>a+b,0),total=Math.round(t.prizePool*100),amounts=weights.map(w=>Math.floor(total*w/sum));amounts[0]+=total-amounts.reduce((a,b)=>a+b,0);
 const effects=[],results=[];for(let i=0;i<ranked.length;i++){const p=ranked[i],prize=cash((amounts[i]||0)/100+(i===0?t.bountyPool:0));if(prize)effects.push({type:'credit',uid:payee(p),amount:prize,fields:t.prizeAsBonus?{bonusTotal:prize,bonusOpen:prize}:{}});if(!p.isBot)effects.push({type:'gameLog',entries:[{uid:p.uid,username:p.name,profit:cash(prize+(p.bountyWon||0)-(p.paid||0)),rake:0}]});results.push({uid:p.uid,name:p.name,rank:i+1,prize,bounties:p.bounties||0});}
 if(t.feeTotal)effects.push({type:'rake',rake:t.feeTotal,uids:ranked.filter(p=>!p.isBot).map(p=>p.uid)});if(t.bountyBudgetRemaining)effects.push({type:'credit',uid:t.bountyFundingUid,amount:t.bountyBudgetRemaining});
 const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+t.id,now);write();tx.update(db.doc('tournaments/'+t.id),{status:'done',players:t.players,results,finishedAt:now,finalPrizePool:t.prizePool,finalFeeTotal:t.feeTotal,prizePool:0,feeTotal:0,bountyPool:0,bountyBudgetRemaining:0,paidPrizes:Object.fromEntries(ranked.map(p=>[p.uid,true])),feesDistributed:true,reserveRefunded:true});for(const row of rows)tx.update(db.doc('tables/'+row.docId),{'tournament.finished':true,'tournament.final':true,'tournament.tableWinner':champion,'tournament.balanceHoldUntil':0});
}
async function tickTournament(id,now=Date.now()){
 const db=getFirestore(),ref=db.doc('tournaments/'+key(id));return db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists)return{};const t={...snap.data(),id};if(t.authorityVersion!==2)return{};const effects=[];
  if(t.status==='reg'){
   if(now<t.startAt)return{};if(t.botFill){const c=await tx.get(db.doc('clubs/'+t.clubId));if(!c.exists||!c.data().ownerUid)fail('failed-precondition','Bot sponsor missing');addBots(t,c.data().ownerUid,effects);}if(all(t).length<t.minPlayers)return{};
   const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+id,now);write();start(tx,db,t,now);tx.set(ref,docOf(t));return{started:true};
  }
  if(t.status!=='running')return{};const rows=await tables(tx,db,id),banks=new Map();let changed=false;
  for(const row of rows){if(!T.idle(row))continue;for(const p of Object.values(row.players||{})){
   const e=t.players[p.uid];if(!e||e.out||p.stack!==0||p.status!=='busted'||!p.bustedAt)continue;
   if(p.isBot&&now-p.bustedAt>=3000&&canRebuy(t,e,now)){
    const uid=payee(e),cost=price(t);if(!banks.has(uid)){const b=await tx.get(db.doc(`memberships/${uid}_${t.clubId}`));banks.set(uid,b.exists?b.data().balance:-1);}
    if(banks.get(uid)>=cost&&(!t.bountyFree||t.bountyBudgetRemaining>=t.bounty)){banks.set(uid,cash(banks.get(uid)-cost));funding(t,effects,e);e.rebuys++;Object.assign(p,{stack:t.startStack,status:'waiting',bustedAt:null,_reported:false});t.initialChips+=t.startStack;row.changed=true;changed=true;continue;}
   }
   if(p.isBot&&now-p.bustedAt>=3000||now-p.bustedAt>=45000){e.out=true;e.outAt=now;e.rank=all(t).filter(p=>!p.out).length+1;p.status='out';row.changed=true;changed=true;}
  }}
  if(Math.abs(T.chips(rows)-t.initialChips)>.001){tx.update(ref,{integrityIssue:'chip-conservation'});return{issue:'chip-conservation'};}
  const plan=T.plan(t,rows,now);if(plan.issue){tx.update(ref,{integrityIssue:plan.issue});return{issue:plan.issue};}if(plan.champion){await final(tx,db,t,rows,plan.champion,now);return{done:true};}
  const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+id,now);write();const updated=new Set();for(const u of plan.updates){tx.update(db.doc('tables/'+u.id),u.patch);updated.add(u.id);for(const p of Object.values(u.patch.players))if(t.players[p.uid]&&!t.players[p.uid].out)t.players[p.uid].tableId=u.id;}
  for(const x of plan.deletes)tx.delete(db.doc('tables/'+x));for(const row of rows)if(row.changed&&!updated.has(row.docId)&&!plan.deletes.includes(row.docId))tx.update(db.doc('tables/'+row.docId),{players:row.players,'gameState.__seq':(row.gameState?.__seq||0)+1});
  if(changed||plan.updates.length||plan.deletes.length||t.integrityIssue){t.integrityIssue=null;t.tableRevision=(t.tableRevision||0)+1;tx.set(ref,docOf(t));}return{};
 });
}
function settleHand(S){
 if(!S.tor||!S.settledWinners)return;const t=S.tor,id=S.id+'_'+S.gameState.handN;if(t.bountyEvents?.[id])return;
 const busts=Object.values(S.players).filter(p=>p.status==='busted'&&p.bustedAt===S.now&&t.players[p.uid]&&!t.players[p.uid].out);if(!busts.length)return;
 busts.sort((a,b)=>(S.gameState.handStartStacks?.[a.uid]||0)-(S.gameState.handStartStacks?.[b.uid]||0)||a.seatIndex-b.seatIndex);let remaining=all(t).filter(p=>!p.out).length;const grace=[];
 for(const p of busts){const e=t.players[p.uid];if(canRebuy(t,e,S.now))grace.push(p.uid);e.out=true;e.rank=remaining--;e.outAt=S.now;p.status='out';p._reported=true;}
 const event={id,level:clock(t,S.now).lvl+1,busts:busts.map(p=>({uid:p.uid,winners:(S.knockoutWinners?.[p.uid]||[...S.settledWinners]).filter(uid=>S.players[uid]?.stack>0)}))};const b=T.bountyPlan(t,event,()=>crypto.randomInt(1000000)/1000000);
 if(b){t.players=b.players;t.bountyPool=b.pool;for(const [uid,amount]of Object.entries(b.credits))if(amount)S.effects.push({type:'credit',uid:payee(t.players[uid]),amount});}
 for(const uid of grace){Object.assign(t.players[uid],{out:false,rank:null});delete t.players[uid].outAt;S.players[uid].status='busted';}
 t.bountyEvents={...t.bountyEvents,[id]:{at:S.now,busts:event.busts,credits:b?.credits||{}}};S.torDirty=true;
}
exports.pkTournament=onCall({region:'us-central1',timeoutSeconds:120},async r=>{
 require('./pokerSecurity').requirePokerAvailable();const uid=A.uid(r),op=r.data?.op;
 if(op==='tick'){const db=getFirestore(),ref=db.doc('tournaments/'+key(r.data.tournamentId)),s=await ref.get();if(!s.exists)fail('not-found','Tournament missing');const m=await db.doc(`memberships/${uid}_${s.data().clubId}`).get();if(!A.root(r)&&(!m.exists||m.data().status!=='approved'))fail('permission-denied','Club membership required');return tickTournament(r.data.tournamentId);}
 return A.command(r,'tournament',async(tx,db,uid,now)=>{
  const id=op==='create'?'event_'+crypto.createHash('sha256').update(uid+r.data.requestId).digest('hex').slice(0,24):key(r.data.tournamentId),ref=db.doc('tournaments/'+id),snap=await tx.get(ref),effects=[];
  if(op==='create'){const cid=key(r.data.clubId);await A.owner(tx,db,cid,r);if(snap.exists)return{ok:true,tournamentId:id};const t=config(r.data.settings||{},cid,uid,now);t.bountyFundingUid=uid;const cost=cash(t.addedPrize+t.bountyBudgetRemaining),write=await prepareLedger(db,tx,cid,cost?[{type:'credit',uid,amount:-cost}]:[],id,now);write();tx.set(ref,t);return{ok:true,tournamentId:id};}
  if(!snap.exists)fail('not-found','Tournament missing');const t={...snap.data(),id};if(t.authorityVersion!==2)fail('failed-precondition','Protected tournaments only');
  const managing=['start','fillbots','cancel'].includes(op),club=managing?await A.owner(tx,db,t.clubId,r):null;if(!managing)await A.member(tx,db,t.clubId,r);
  const rows=t.status==='running'?await tables(tx,db,id):[],mine=t.players[uid],late=t.status==='running'&&clock(t,now).lvl<t.lateRegUntilLevel;
  if(op==='register'){
   if(t.demoOnly)fail('failed-precondition','This demonstration is bots only');if(!['reg','running'].includes(t.status)||t.status==='running'&&!late)fail('failed-precondition','Registration closed');if(mine&&!mine.out)return{ok:true,tournamentId:id};if(mine&&(!t.reentry||(mine.reentries||0)>=t.maxReentries))fail('failed-precondition','Re-entry unavailable');if(all(t).filter(p=>!p.out).length>=t.maxPlayers)fail('failed-precondition','Tournament full');
   const us=await tx.get(db.doc('users/'+uid)),profile=us.exists?us.data():{};for(const row of rows){const old=row.players[uid];if(old){if(!T.idle(row)||!mine?.out||old.stack!==0||old.bet>0)fail('failed-precondition','Previous hand still settling');delete row.players[uid];row.changed=true;}}
   const p={uid,name:profile.username||'Player',photo:profile.photo||'',playerId:profile.playerId||'',isBot:false,out:false,rank:null,bounties:mine?.bounties||0,bountyWon:mine?.bountyWon||0,paid:mine?.paid||0,rebuys:0,reentries:mine?(mine.reentries||0)+1:0,addon:false};funding(t,effects,p);t.players[uid]=p;t.entryCount++;
   if(t.status==='running'){
    let row=rows.filter(T.idle).filter(row=>Object.values(row.players).filter(p=>p.status!=='out').length<t.tableSize).sort((a,b)=>Object.keys(a.players).length-Object.keys(b.players).length)[0];
    if(!row){const tid='tour_'+id+'_'+t.entryCount;row={...tableDoc(t,{},now),docId:tid,isNew:true};rows.push(row);}for(const [who,old]of Object.entries(row.players))if(old.status==='out'&&old.stack===0)delete row.players[who];const used=new Set(Object.values(row.players).map(p=>p.seatIndex));let si=0;while(used.has(si))si++;row.players[uid]=seat(p,si,t.startStack);p.tableId=row.docId;row.changed=true;t.initialChips+=t.startStack;
   }
  }else if(op==='unregister'){
   if(t.status!=='reg'||!mine)fail('failed-precondition','Registration already started');effects.push({type:'credit',uid:payee(mine),amount:price(t)});t.prizePool=cash(t.prizePool-t.buyIn);t.feeTotal=cash(t.feeTotal-t.fee);t.bountyPool=cash(t.bountyPool-t.bounty);if(t.bountyFree)t.bountyBudgetRemaining=cash(t.bountyBudgetRemaining+t.bounty);delete t.players[uid];t.entryCount--;
  }else if(op==='fillbots'){
   if(t.status!=='reg')fail('failed-precondition','Tournament already started');addBots(t,club.ownerUid,effects);
  }else if(op==='start'){
   if(t.status!=='reg')return{ok:true,tournamentId:id};if(t.botFill)addBots(t,club.ownerUid,effects);if(all(t).length<t.minPlayers)fail('failed-precondition','Not enough players');
  }else if(['rebuy','addon','decline'].includes(op)){
   if(t.status!=='running'||!mine||mine.out)fail('failed-precondition','You are not active');const row=rows.find(row=>row.players[uid]);if(!row||!T.idle(row))fail('failed-precondition','Wait until the hand ends');const p=row.players[uid];
   if(op==='rebuy'){if(!canRebuy(t,mine,now)||p.stack!==0||p.status!=='busted')fail('failed-precondition','Rebuy unavailable');funding(t,effects,mine);mine.rebuys++;Object.assign(p,{stack:t.startStack,status:'waiting',bustedAt:null,_reported:false});t.initialChips+=t.startStack;}
   else if(op==='addon'){if(!t.addon||mine.addon||clock(t,now).lvl+1!==t.addonLevel||p.stack<=0)fail('failed-precondition','Add-on unavailable');effects.push({type:'credit',uid,amount:-t.buyIn});mine.addon=true;mine.paid=cash(mine.paid+t.buyIn);t.prizePool=cash(t.prizePool+t.buyIn);p.stack+=t.startStack;t.initialChips+=t.startStack;}
   else{if(p.stack!==0||p.status!=='busted')fail('failed-precondition','No rebuy pending');mine.out=true;mine.outAt=now;mine.rank=all(t).filter(p=>!p.out).length+1;p.status='out';}row.changed=true;
  }else if(op==='cancel'){
   if(t.status==='cancelled')return{ok:true,tournamentId:id};if(t.status!=='reg')fail('failed-precondition','Only an unstarted tournament can be cancelled');for(const p of all(t))effects.push({type:'credit',uid:payee(p),amount:p.paid});effects.push({type:'credit',uid:t.bountyFundingUid,amount:cash(t.addedPrize+t.bountyBudgetRemaining+(t.bountyFree?t.bountyPool:0))});t.status='cancelled';t.prizePool=t.feeTotal=t.bountyPool=t.bountyBudgetRemaining=0;t.refundedAt=now;
  }else fail('invalid-argument','Unknown tournament operation');
  const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+id,now);write();if(op==='start')start(tx,db,t,now);
  for(const row of rows)if(row.changed){if(row.isNew){const {docId,isNew,changed,...doc}=row;tx.set(db.doc('tables/'+docId),doc);}else tx.update(db.doc('tables/'+row.docId),{players:row.players,'gameState.__seq':(row.gameState?.__seq||0)+1});}tx.set(ref,docOf(t));return{ok:true,tournamentId:id};
 });
});
module.exports.tickTournament=tickTournament;module.exports.settleHand=settleHand;module.exports.clock=clock;module.exports.config=config;
