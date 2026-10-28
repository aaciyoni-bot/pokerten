'use strict';
const crypto=require('node:crypto'),{onCall}=require('firebase-functions/v2/https'),{getFirestore}=require('firebase-admin/firestore');
const A=require('./pokerAuthority'),T=require('./pokerTournamentCore'),C=require('./pokerCore'),{prepareLedger}=require('./pokerLedger');
const {key,cash,number,fail,payee}=A;
const {botName,renameGenericBots}=require('./botNames');
const all=t=>Object.values(t.players||{}),entryBuyIn=(t,reentry=false)=>reentry?(t.reentryBuyIn??t.buyIn):t.buyIn,price=(t,reentry=false)=>cash(entryBuyIn(t,reentry)+t.fee+(t.bountyFree?0:t.bounty));
const clock=(t,now=Date.now())=>T.clock(t,t.structure,now);
async function tables(tx,db,id){const q=await tx.get(db.collection('tables').where('tournamentId','==',id));return q.docs.map(d=>({...d.data(),docId:d.id}));}
const numericLabels={buyIn:'Buy-in',reentryBuyIn:'Re-entry buy-in',fee:'Club entry fee',bounty:'Bounty per knockout',addedPrize:'Guaranteed prize',bountyBudgetRemaining:'Club bounty reserve',earlyRegistrationBonusPct:'Early registration bonus (%)',startStack:'Starting stack',startAt:'Start date/time',maxPlayers:'Maximum entries',minPlayers:'Minimum players to start',tableSize:'Seats per table',actionTime:'Action time (seconds)',levelMins:'Level length (minutes)',lateRegUntilLevel:'Late registration until level',maxRebuys:'Maximum rebuys per player',rebuyUntilLevel:'Rebuy until level',addonLevel:'Add-on level',maxReentries:'Maximum re-entries per player',anteFromLevel:'Ante starts at level',breakEvery:'Break every levels',breakMins:'Break length (minutes)',progressiveCashPct:'Progressive bounty paid now (%)',mysteryStartLevel:'Mystery bounty starts at level',paidPct:'Paid places (%)'};
function tournamentNumber(value,fallback,min,max,integer,label){
 try{return number(value,fallback,min,max,integer);}catch(error){
  if(error.code!=='invalid-argument')throw error;
  fail('invalid-argument',label+': received '+JSON.stringify(value==null?fallback:value)+'. Enter '+(integer?'a whole number':'a number with at most 2 decimal places')+' from '+min+' to '+max+'.');
 }
}
function config(raw,clubId,creatorUid,now){
 const t={clubId,creatorUid,name:String(raw.name||'').trim().slice(0,80),game:'poker',authorityVersion:2,feeAccountingVersion:2,pokerType:raw.pokerType||'NLH',status:'reg',players:{},entryCount:0,bountyEvents:{},createdAt:now,round:0,mttMode:true,serverEngine:true};
 if(!t.name||!C.GAME_CARDS[t.pokerType])fail('invalid-argument','Tournament name and valid poker type required');
 for(const [k,def,min,max,int]of [['buyIn',0,0,10000000],['reentryBuyIn',raw.buyIn==null?0:Number(raw.buyIn),0,10000000],['fee',0,0,1000000],['bounty',0,0,10000000],['addedPrize',0,0,10000000],['bountyBudgetRemaining',0,0,10000000],['earlyRegistrationBonusPct',0,0,100],['startStack',10000,100,10000000,true],['startAt',now,0,9000000000000000,true],['maxPlayers',36,2,180,true],['minPlayers',2,2,180,true],['tableSize',9,2,9,true],['actionTime',25,10,120,true],['levelMins',5,1,120,true],['lateRegUntilLevel',0,0,100,true],['maxRebuys',3,0,100,true],['rebuyUntilLevel',2,1,100,true],['addonLevel',3,1,100,true],['maxReentries',1,0,20,true],['anteFromLevel',10,1,100,true],['breakEvery',0,0,100,true],['breakMins',0,0,60,true],['progressiveCashPct',50,1,100],['mysteryStartLevel',3,1,100,true],['paidPct',0,0,50]]){
  const mode=raw.bountyMode||(raw.mysteryBounty?'mystery':'fixed');
  const inactive=(k==='progressiveCashPct'&&mode!=='progressive')||(k==='mysteryStartLevel'&&mode!=='mystery')||['rebuyUntilLevel','maxRebuys'].includes(k)||(k==='addonLevel'&&raw.addon!==true)||(k==='anteFromLevel'&&raw.anteType==='none');
  t[k]=tournamentNumber(inactive?undefined:raw[k],def,min,max,int,numericLabels[k]);
 }
 if(t.minPlayers>t.maxPlayers)fail('invalid-argument','Minimum exceeds maximum entrants');t.tableSize=T.capacity(t);
 for(const k of ['rebuys','addon','reentry','bountyFree','botFill','demoOnly','prizeAsBonus','finishAtPaidPlaces'])t[k]=raw[k]===true;t.finishAtPaidPlaces=false;t.rebuys=false;t.botRebuys=false;t.maxRebuys=0;t.rebuyUntilLevel=0;t.reentryToPrizePool=raw.reentryToPrizePool!==false;
 t.bountyMode=raw.bountyMode||(raw.mysteryBounty?'mystery':'fixed');if(!['fixed','progressive','mystery'].includes(t.bountyMode))fail('invalid-argument','Invalid bounty mode');t.mysteryBounty=t.bountyMode==='mystery';t.anteType=raw.anteType||'bb';if(!['none','each','bb'].includes(t.anteType))fail('invalid-argument','Invalid ante type');
 if(t.demoOnly&&(t.buyIn||t.reentryBuyIn||t.fee||t.bounty||t.addedPrize||t.bountyBudgetRemaining))fail('invalid-argument','Bots-only demonstrations have no money fees or prizes');
 if(!raw.lateRegClosesAt&&t.mysteryBounty&&t.mysteryStartLevel<=Math.max(t.lateRegUntilLevel,t.rebuys?t.rebuyUntilLevel:0))fail('invalid-argument','Mystery starts after entry and rebuy close');
 const rows=raw.structure||Array.from({length:25},(_,i)=>({sb:Math.round(10*Math.pow(1.5,i)),bb:Math.round(20*Math.pow(1.5,i)),ante:i+1>=t.anteFromLevel?Math.round((t.anteType==='each'?10:20)*Math.pow(1.5,i)):0,mins:t.levelMins}));
 if(!Array.isArray(rows)||!rows.length||rows.length>100)fail('invalid-argument','Blind structure must have 1–100 levels');t.structure=rows.map((r,i)=>{const label='Blind structure level '+(i+1),sb=tournamentNumber(r.sb,NaN,.01,10000000,false,label+' small blind');return{sb,bb:tournamentNumber(r.bb,NaN,sb,10000000,false,label+' big blind'),ante:tournamentNumber(r.ante,0,0,10000000,false,label+' ante'),mins:tournamentNumber(r.mins,t.levelMins,1,120,false,label+' minutes')};});
 if(raw.lateRegClosesAt!=null&&raw.lateRegClosesAt!==0)t.lateRegClosesAt=registrationDeadline(t,raw.lateRegClosesAt,now);
 t.payouts=Array.isArray(raw.payouts)&&raw.payouts.length?raw.payouts.map((v,i)=>tournamentNumber(v,NaN,0,100,false,'Prize for place '+(i+1)+' (%)')):[50,30,20];if(Math.abs(t.payouts.reduce((a,b)=>a+b,0)-100)>.01)fail('invalid-argument','Prize percentages must total 100');
 t.prizePoolMode=prizePoolMode(raw.prizePoolMode);if(t.prizePoolMode==='fixed'&&t.addedPrize<=0)fail('invalid-argument','Fixed prize pool must be greater than zero');
 t.earlyRegistrationBonusUntilStart=raw.earlyRegistrationBonusUntilStart===true;
 t.prizePool=t.addedPrize;t.feeTotal=0;t.bountyPool=0;if(!t.bountyFree)t.bountyBudgetRemaining=0;return t;
}
function prizePoolMode(value){const mode=value??'entries';if(!['entries','fixed'].includes(mode))fail('invalid-argument','Invalid prize pool type');return mode;}
function registrationDeadline(t,value,now){
 const start=t.startedAt||t.startAt||now,deadline=tournamentNumber(value,NaN,Math.max(now+1000,start+1),Math.max(now,start)+7*86400000,true,'Late registration closing date/time');
 if(t.mysteryBounty){let at=start;for(let i=0;i<t.mysteryStartLevel-1;i++){at+=(t.structure[i]?.mins||t.levelMins)*60000;if(t.breakEvery&&(i+1)%t.breakEvery===0)at+=t.breakMins*60000;}if(deadline>at)fail('invalid-argument','Late registration must close before mystery bounties start');}
 return deadline;
}
function removeSeat(t,row,uid,now){
 if(row&&!T.idle(row))return false;
 const e=t.players[uid],p=row?.players?.[uid];if(!e)return true;
 if(p){t.initialChips=cash(t.initialChips-p.stack-(p.pendingTournamentChips||0));delete row.players[uid];row.changed=true;}
 Object.assign(e,{out:true,removed:true,removalRequested:false,removedAt:now,rank:null});delete e.tableId;return true;
}
function seat(p,index,stack){return{uid:p.uid,name:p.name,photo:p.photo||'',avatarSeed:p.uid,playerId:p.playerId||'',isBot:!!p.isBot,...(p.isBot?{fundingUid:p.fundingUid,botStyle:p.botStyle}:{}),seatIndex:index,stack,bet:0,buyTotal:0,status:'waiting',cards:[],cardCount:0,hasActed:false,actionText:'',lastSeen:Date.now()};}
function tableDoc(t,players,now){return{authorityVersion:2,type:'poker',clubId:t.clubId,createdBy:t.creatorUid,createdAt:now,tournamentId:t.id,players,chat:[],tournament:{name:t.name,torId:t.id,mttMode:true,startedAt:t.startedAt,structure:t.structure,levelMins:t.levelMins,anteType:t.anteType,anteFromLevel:t.anteFromLevel,breakEvery:t.breakEvery,breakMins:t.breakMins,rebuyUntil:t.rebuys?t.rebuyUntilLevel-1:-1,addonAt:t.addon?t.addonLevel-1:-1,startStack:t.startStack,bounty:t.bounty,round:1,final:false,finished:false,demoOnly:t.demoOnly},settings:{serverEngine:true,baseGameType:t.pokerType,maxPlayers:t.tableSize,blinds:t.structure[0].sb,actionTime:t.actionTime,rakePercent:0,autoStart:2,omahaPotLimit:true,demoOnly:t.demoOnly,botGodGuard:false},gameState:{phase:'waiting',board:[],pots:[],highestBet:0,minRaise:t.structure[0].bb,activeTurnUid:null,turnStartedAt:null,handN:0,__seq:0}};}
function docOf(t){const {id,...doc}=t;return doc;}
function funding(t,effects,p,reentry=false){const {pool:buyIn,fee}=T.entryFunding(t,reentry),cost=price(t,reentry);if(t.bountyFree&&t.bountyBudgetRemaining<t.bounty)fail('failed-precondition','Club bounty reserve needs funding');if(cost)effects.push({type:'credit',uid:payee(p),amount:-cost});p.paid=cash((p.paid||0)+cost);p.feesPaid=cash((p.feesPaid||0)+fee);p.bountyValue=t.bounty;t.prizePool=cash(t.prizePool+buyIn);t.feeTotal=cash(t.feeTotal+fee);t.bountyPool=cash(t.bountyPool+t.bounty);if(t.bountyFree)t.bountyBudgetRemaining=cash(t.bountyBudgetRemaining-t.bounty);}
function entryStack(t,p,now,reentry=false){
 p.registeredAt=now;p.earlyRegistrationBonusChips=T.earlyRegistrationBonus(t,now,reentry);p.entryStartStack=t.startStack+p.earlyRegistrationBonusChips;
}
function addBots(t,ownerUid,effects,now,limit=Infinity){
 const added=[];const missing=Math.min(limit,t.maxPlayers-all(t).filter(p=>!p.out).length);for(let i=0,n=0;n<missing;i++){const uid='bot_'+t.id+'_'+i;if(t.players[uid]||t.removedPlayers?.[uid])continue;n++;const p={uid,name:botName(uid,all(t).map(p=>p.name),{tableNames:[]}),isBot:true,fundingUid:ownerUid,botStyle:['tight','balanced','aggressive'][i%3],out:false,rank:null,bounties:0,bountyWon:0,paid:0,rebuys:0,reentries:0,addon:false};entryStack(t,p,now);funding(t,effects,p);t.players[uid]=p;t.entryCount++;added.push(p);}return added;
}
function start(tx,db,t,now){
 const entrants=all(t).filter(p=>!p.out);if(entrants.length<t.minPlayers)fail('failed-precondition','Not enough registered players');for(let i=entrants.length-1;i>0;i--){const j=crypto.randomInt(i+1);[entrants[i],entrants[j]]=[entrants[j],entrants[i]];}
 t.startedAt=now;t.status='running';t.round=1;t.seededRound=1;t.initialChips=entrants.reduce((sum,p)=>sum+(p.entryStartStack??t.startStack),0);const count=Math.ceil(entrants.length/t.tableSize),groups=Array.from({length:count},()=>({}));
 entrants.forEach((p,i)=>{const g=i%count;p.tableId='tour_'+t.id+'_'+g;groups[g][p.uid]=seat(p,Object.keys(groups[g]).length,p.entryStartStack??t.startStack);});groups.forEach((players,i)=>{renameGenericBots(players,t.players);tx.set(db.doc('tables/tour_'+t.id+'_'+i),tableDoc(t,players,now));});
}
function canRebuy(){return false;}

async function final(tx,db,t,rows,champion,now,pendingEffects=[]){
 const finishers=Array.isArray(champion)?champion:[champion];finishers.forEach((uid,i)=>{t.players[uid].rank=i+1;});champion=finishers[0];const ranked=all(t).filter(p=>!p.removed).sort((a,b)=>(a.rank||999)-(b.rank||999)),count=t.paidPct?Math.max(1,Math.floor(ranked.length*t.paidPct/100)):Math.min(ranked.length,t.payouts.length);
 const weights=t.paidPct?Array.from({length:count},(_,i)=>1/Math.pow(i+1,.9)):t.payouts.slice(0,count),sum=weights.reduce((a,b)=>a+b,0),total=Math.round(t.prizePool*100),amounts=weights.map(w=>Math.floor(total*w/sum));amounts[0]+=total-amounts.reduce((a,b)=>a+b,0);
 if(finishers.length>1){const stacks=Object.fromEntries(rows.flatMap(row=>Object.values(row.players||{}).map(p=>[p.uid,p.stack+(p.pendingTournamentChips||0)])));for(let i=0;i<finishers.length;){let j=i+1;while(j<finishers.length&&stacks[finishers[j]]===stacks[finishers[i]])j++;if(j-i>1){const pot=amounts.slice(i,j).reduce((a,b)=>a+b,0),base=Math.floor(pot/(j-i));for(let k=i;k<j;k++)amounts[k]=base+(k-i<pot-base*(j-i)?1:0);}i=j;}}
 const effects=[...pendingEffects],results=[];for(let i=0;i<ranked.length;i++){const p=ranked[i],prize=cash((amounts[i]||0)/100+(i===0?t.bountyPool:0));if(prize)effects.push({type:'credit',uid:payee(p),amount:prize,fields:t.prizeAsBonus?{bonusTotal:prize,bonusOpen:prize}:{}});if(!p.isBot)effects.push({type:'gameLog',entries:[{uid:p.uid,username:p.name,profit:cash(prize+(p.bountyWon||0)-(p.paid||0)),rake:0}]});results.push({uid:p.uid,name:p.name,rank:i+1,prize,bounties:p.bounties||0,finalChips:finishers.includes(p.uid)?cash(rows.reduce((n,row)=>n+(row.players?.[p.uid]?.stack||0)+(row.players?.[p.uid]?.pendingTournamentChips||0),0)):0});}
 if(t.feeTotal){const known=t.feeAccountingVersion===2&&cash(all(t).reduce((n,p)=>n+(p.feesPaid||0),0))===t.feeTotal;effects.push(known?{type:'rake',rake:t.feeTotal,allocations:require('./pokerRake').allocateRake(t.feeTotal,all(t).map(p=>({...p,weight:p.feesPaid||0})))}:{type:'rake',rake:t.feeTotal,rakeSource:'unclassified'});}if(t.bountyBudgetRemaining)effects.push({type:'credit',uid:t.bountyFundingUid,amount:t.bountyBudgetRemaining});
 effects.push({type:'settlementHands',entries:ranked.filter(p=>!p.isBot).map(p=>({uid:p.uid,hands:p.settlementHands||0,tableName:t.name||t.id,gameType:t.pokerType||'poker'}))});
 const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+t.id,now);write();tx.update(db.doc('tournaments/'+t.id),{status:'done',players:t.players,initialChips:t.initialChips,results,finishedAt:now,finalPrizePool:t.prizePool,finalFeeTotal:t.feeTotal,prizePool:0,feeTotal:0,bountyPool:0,bountyBudgetRemaining:0,paidPrizes:Object.fromEntries(ranked.map(p=>[p.uid,true])),feesDistributed:true,reserveRefunded:true,winnerUids:ranked.slice(0,count).map(p=>p.uid)});for(const row of rows)tx.update(db.doc('tables/'+row.docId),{players:Object.fromEntries(Object.entries(row.players).filter(([uid])=>uid===champion).map(([uid,p])=>[uid,{...p,cards:[],cardCount:0,bet:0,status:'waiting',actionText:'',reveal:false}])),gameState:{...row.gameState,__seq:(row.gameState?.__seq||0)+1,phase:'waiting',board:[],board2:null,pots:[],activeTurnUid:null,turnStartedAt:null,highestBet:0,lastWinners:null,allInReveal:false},'tournament.finished':true,'tournament.final':true,'tournament.tableWinner':champion,'tournament.balanceHoldUntil':0});
}
async function tickTournament(id,now=Date.now()){
 const db=getFirestore(),ref=db.doc('tournaments/'+key(id));return db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists)return{};const t={...snap.data(),id};if(t.authorityVersion!==2)return{};const effects=[];
  if(['reg','running'].includes(t.status)){const club=await tx.get(db.doc('clubs/'+t.clubId));if(club.exists&&club.data().archived===true)return{};}
  const namesChanged=renameGenericBots(t.players,null,{table:false});
  if(t.status==='reg'){
   if(now<t.startAt){if(namesChanged)tx.set(ref,docOf(t));return{};}if(t.botFill){const c=await tx.get(db.doc('clubs/'+t.clubId));if(!c.exists||!c.data().ownerUid)fail('failed-precondition','Bot sponsor missing');if(c.data().botsAuto!==false)addBots(t,c.data().ownerUid,effects,now);}if(all(t).length<t.minPlayers){if(namesChanged)tx.set(ref,docOf(t));return{};}
   const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+id,now);write();start(tx,db,t,now);tx.set(ref,docOf(t));return{started:true};
  }
  if(t.status!=='running')return{};const rebuySettingsChanged=t.rebuys===true||t.botRebuys===true||t.maxRebuys>0;t.rebuys=false;t.botRebuys=false;t.maxRebuys=0;t.rebuyUntilLevel=0;const rows=await tables(tx,db,id),banks=new Map();let changed=namesChanged||rebuySettingsChanged;for(const row of rows)if(row.tournament?.rebuyUntil>=0){row.tournament.rebuyUntil=-1;row.changed=true;changed=true;}
  for(const [uid,e]of Object.entries(t.players||{}))if(e.removalRequested){const row=rows.find(row=>row.players?.[uid]);if(removeSeat(t,row,uid,now))changed=true;}
  for(const row of rows)if(renameGenericBots(row.players,t.players)){row.changed=true;changed=true;}
  for(const row of rows){if(!T.idle(row))continue;for(const p of Object.values(row.players||{})){
   const e=t.players[p.uid];if(!e||e.out||p.stack!==0||p.pendingTournamentChips>0||p.status!=='busted'||!p.bustedAt)continue;
   if(p.isBot&&now-p.bustedAt>=3000&&canRebuy(t,e,now)){
    const uid=payee(e),cost=price(t);if(!banks.has(uid)){const b=await tx.get(db.doc(`memberships/${uid}_${t.clubId}`));banks.set(uid,b.exists?b.data().balance:-1);}
    if(banks.get(uid)>=cost&&(!t.bountyFree||t.bountyBudgetRemaining>=t.bounty)){banks.set(uid,cash(banks.get(uid)-cost));funding(t,effects,e);e.rebuys++;Object.assign(p,{stack:t.startStack,status:'waiting',bustedAt:null,_reported:false});t.initialChips+=t.startStack;row.changed=true;changed=true;continue;}
   }
   if(!canRebuy(t,e,now)||p.isBot&&now-p.bustedAt>=3000||now-p.bustedAt>=45000){e.out=true;e.outAt=now;e.rank=all(t).filter(p=>!p.out).length+1;p.status='out';row.changed=true;changed=true;}
  }}
  if(Math.abs(T.chips(rows)-t.initialChips)>.001){tx.update(ref,{integrityIssue:'chip-conservation'});return{issue:'chip-conservation'};}
  const plan=T.plan(t,rows,now);if(plan.issue){tx.update(ref,{integrityIssue:plan.issue});return{issue:plan.issue};}if(plan.champion||plan.finishers){await final(tx,db,t,rows,plan.finishers||plan.champion,now,effects);return{done:true};}
  const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+id,now);write();const updated=new Set();for(const u of plan.updates){renameGenericBots(u.patch.players,t.players);tx.update(db.doc('tables/'+u.id),u.patch);updated.add(u.id);for(const p of Object.values(u.patch.players))if(t.players[p.uid]&&!t.players[p.uid].out)t.players[p.uid].tableId=u.id;}
  for(const x of plan.deletes)tx.delete(db.doc('tables/'+x));for(const row of rows)if(row.changed&&!updated.has(row.docId)&&!plan.deletes.includes(row.docId))tx.update(db.doc('tables/'+row.docId),{players:row.players,tournament:row.tournament,'gameState.__seq':(row.gameState?.__seq||0)+1});
  if(changed||plan.updates.length||plan.deletes.length||t.integrityIssue){t.integrityIssue=null;t.tableRevision=(t.tableRevision||0)+1;tx.set(ref,docOf(t));}return{};
 });
}
function settleHand(S){
 if(!S.tor||!S.settledWinners)return;const t=S.tor,id=S.id+'_'+S.gameState.handN;if(t.bountyEvents?.[id])return;
 if(t.settlementHandIds?.[S.id]!==S.gameState.handN){for(const p of Object.values(S.players)){if(p.cardCount>0&&t.players[p.uid])t.players[p.uid].settlementHands=(t.players[p.uid].settlementHands||0)+1;}t.settlementHandIds={...t.settlementHandIds,[S.id]:S.gameState.handN};S.torDirty=true;}
 const busts=Object.values(S.players).filter(p=>p.status==='busted'&&p.bustedAt===S.now&&t.players[p.uid]&&!t.players[p.uid].out);if(!busts.length)return;
 busts.sort((a,b)=>(S.gameState.handStartStacks?.[a.uid]||0)-(S.gameState.handStartStacks?.[b.uid]||0)||a.seatIndex-b.seatIndex);let remaining=all(t).filter(p=>!p.out).length;const grace=[];
 for(const p of busts){const e=t.players[p.uid];if(canRebuy(t,e,S.now))grace.push(p.uid);e.out=true;e.rank=remaining--;e.outAt=S.now;p.status='out';p._reported=true;}
 const event={id,level:clock(t,S.now).lvl+1,busts:busts.map(p=>({uid:p.uid,winners:(S.knockoutWinners?.[p.uid]||[...S.settledWinners]).filter(uid=>S.players[uid]?.stack>0)}))};const b=T.bountyPlan(t,event,()=>crypto.randomInt(1000000)/1000000);
 if(b){t.players=b.players;t.bountyPool=b.pool;for(const [uid,amount]of Object.entries(b.credits))if(amount)S.effects.push({type:'credit',uid:payee(t.players[uid]),amount});}
 for(const uid of grace){Object.assign(t.players[uid],{out:false,rank:null});delete t.players[uid].outAt;S.players[uid].status='busted';}
 const eliminated=busts.filter(p=>!grace.includes(p.uid));let rank=all(t).filter(p=>!p.out).length+eliminated.length;for(const p of eliminated)t.players[p.uid].rank=rank--;
 t.bountyEvents={...t.bountyEvents,[id]:{at:S.now,busts:event.busts,credits:b?.credits||{}}};for(const p of eliminated){delete S.players[p.uid];delete S.priv[p.uid];S.privateDeletes=[...(S.privateDeletes||[]),p.uid];}S.torDirty=true;
}
exports.pkTournament=onCall({region:'us-central1',timeoutSeconds:120},async r=>{
 require('./pokerSecurity').requirePokerAvailable();const uid=A.uid(r),op=r.data?.op;
 if(op==='tick'){const db=getFirestore(),ref=db.doc('tournaments/'+key(r.data.tournamentId)),s=await ref.get();if(!s.exists)fail('not-found','Tournament missing');const m=await db.doc(`memberships/${uid}_${s.data().clubId}`).get();if(!A.root(r)&&(!m.exists||m.data().status!=='approved'))fail('permission-denied','Club membership required');return tickTournament(r.data.tournamentId);}
 return A.command(r,'tournament',async(tx,db,uid,now)=>{
  const id=op==='create'?'event_'+crypto.createHash('sha256').update(uid+r.data.requestId).digest('hex').slice(0,24):key(r.data.tournamentId),ref=db.doc('tournaments/'+id),snap=await tx.get(ref),effects=[];
  if(op==='create'){const cid=key(r.data.clubId),club=await A.tableManager(tx,db,cid,r);A.assertClubOpen(club);if(snap.exists)return{ok:true,tournamentId:id};const t=config(r.data.settings||{},cid,uid,now);t.bountyFundingUid=club.ownerUid;const cost=cash(t.addedPrize+t.bountyBudgetRemaining),write=await prepareLedger(db,tx,cid,cost?[{type:'credit',uid:club.ownerUid,amount:-cost}]:[],id,now);write();tx.set(ref,t);return{ok:true,tournamentId:id};}
  if(!snap.exists)fail('not-found','Tournament missing');const t={...snap.data(),id};if(t.authorityVersion!==2)fail('failed-precondition','Protected tournaments only');
  const managing=['start','fillbots','registration','prizeconfig','cancel','archive','removeplayer'].includes(op),club=managing?await A.tableManager(tx,db,t.clubId,r):null;if(!managing)await A.member(tx,db,t.clubId,r);
  if(t.archived){if(op==='archive')return{ok:true,tournamentId:id};fail('failed-precondition','This tournament was deleted');}
  if(['register','start','fillbots','registration','prizeconfig','rebuy','addon'].includes(op)){if(club)A.assertClubOpen(club);else await A.activeClub(tx,db,t.clubId);}
  const rows=t.status==='running'?await tables(tx,db,id):[],mine=t.players[uid],late=t.status==='running'&&T.lateRegistrationOpen(t,t.structure,now);let queued=false;
  if(op==='register'){
   if(t.removedPlayers?.[uid]||mine?.removed||mine?.removalRequested)fail('permission-denied','You were removed from this tournament');
   if(t.demoOnly)fail('failed-precondition','This demonstration is bots only');if(!['reg','running'].includes(t.status)||t.status==='running'&&!late)fail('failed-precondition','Registration closed');if(mine&&!mine.out)return{ok:true,tournamentId:id};if(mine&&(!t.reentry||(mine.reentries||0)>=t.maxReentries))fail('failed-precondition','Re-entry unavailable');if(all(t).filter(p=>!p.out).length>=t.maxPlayers)fail('failed-precondition','Tournament full');
   const us=await tx.get(db.doc('users/'+uid)),profile=us.exists?us.data():{};for(const row of rows){const old=row.players[uid];if(old){if(!T.idle(row)||!mine?.out||old.stack!==0||old.bet>0)fail('failed-precondition','Previous hand still settling');delete row.players[uid];row.changed=true;}}
   const p={uid,name:profile.username||'Player',photo:profile.photo||'',playerId:profile.playerId||'',isBot:false,out:false,rank:null,bounties:mine?.bounties||0,bountyWon:mine?.bountyWon||0,paid:mine?.paid||0,feesPaid:mine?.feesPaid||0,settlementHands:mine?.settlementHands||0,rebuys:0,reentries:mine?(mine.reentries||0)+1:0,addon:false};entryStack(t,p,now,!!mine);funding(t,effects,p,!!mine);t.players[uid]=p;t.entryCount++;
   if(t.status==='running'){
    let row=mine?null:rows.filter(T.idle).filter(row=>Object.values(row.players).filter(p=>p.status!=='out').length<t.tableSize).sort((a,b)=>Object.keys(a.players).length-Object.keys(b.players).length)[0];
    if(!row){const tid='tour_'+id+'_'+t.entryCount;row={...tableDoc(t,{},now),docId:tid,isNew:true};rows.push(row);}for(const [who,old]of Object.entries(row.players))if(old.status==='out'&&old.stack===0)delete row.players[who];const used=new Set(Object.values(row.players).map(p=>p.seatIndex));let si=0;while(used.has(si))si++;row.players[uid]=seat(p,si,t.startStack);p.tableId=row.docId;row.changed=true;t.initialChips+=t.startStack;
   }
  }else if(op==='unregister'){
   if(t.status!=='reg'||!mine)fail('failed-precondition','Registration already started');effects.push({type:'credit',uid:payee(mine),amount:price(t)});t.prizePool=cash(t.prizePool-T.entryFunding(t).pool);t.feeTotal=cash(t.feeTotal-T.entryFunding(t).fee);t.bountyPool=cash(t.bountyPool-t.bounty);if(t.bountyFree)t.bountyBudgetRemaining=cash(t.bountyBudgetRemaining+t.bounty);delete t.players[uid];t.entryCount--;
  }else if(op==='fillbots'){
   if(!['reg','running'].includes(t.status))fail('failed-precondition','Tournament is no longer accepting entries');if(t.status==='running'&&!late)fail('failed-precondition','Late registration is closed — bots cannot enter');if(all(t).filter(p=>!p.out).length>=t.maxPlayers)fail('failed-precondition','Tournament full');const added=addBots(t,club.ownerUid,effects,now,1);
   if(t.status==='running'){for(const p of added){const tid='tour_'+id+'_'+t.entryCount;const row={...tableDoc(t,{[p.uid]:seat(p,0,t.startStack)},now),docId:tid,isNew:true,changed:true};p.tableId=tid;rows.push(row);t.initialChips+=t.startStack;}}

  }else if(op==='prizeconfig'){
   if(t.status!=='reg')fail('failed-precondition','Prize and early bonus settings can change only before the tournament starts');
   const mode=prizePoolMode(r.data.prizePoolMode),addedPrize=tournamentNumber(r.data.addedPrize,NaN,0,10000000,false,'House-funded prize');
   const bonus=tournamentNumber(r.data.earlyRegistrationBonusPct,NaN,0,100,false,'Early registration bonus (%)');
   if(mode==='fixed'&&addedPrize<=0)fail('invalid-argument','Fixed prize pool must be greater than zero');
   if(t.demoOnly&&addedPrize)fail('invalid-argument','Bots-only demonstrations have no money fees or prizes');
   const before=T.entryFunding(t),previous={prizePoolMode:t.prizePoolMode||'entries',addedPrize:t.addedPrize,earlyRegistrationBonusPct:t.earlyRegistrationBonusPct||0,earlyRegistrationBonusUntilStart:!!t.earlyRegistrationBonusUntilStart};
   const reserveChange=cash(addedPrize-t.addedPrize);if(reserveChange)effects.push({type:'credit',uid:t.bountyFundingUid||club.ownerUid,amount:-reserveChange});
   t.prizePoolMode=mode;t.addedPrize=addedPrize;t.earlyRegistrationBonusPct=bonus;t.earlyRegistrationBonusUntilStart=r.data.earlyRegistrationBonusUntilStart===true;
   const after=T.entryFunding(t),entrants=all(t);t.prizePool=cash(t.prizePool+reserveChange+(after.pool-before.pool)*entrants.length);t.feeTotal=cash(t.feeTotal+(after.fee-before.fee)*entrants.length);
   if(mode==='fixed'&&t.prizePool!==addedPrize)fail('failed-precondition','Tournament funding needs review before switching to a fixed pool');
   for(const p of entrants){p.feesPaid=cash((p.feesPaid||0)+after.fee-before.fee);const registeredAt=p.registeredAt??now;p.earlyRegistrationBonusChips=T.earlyRegistrationBonus(t,registeredAt,(p.reentries||0)>0);p.entryStartStack=t.startStack+p.earlyRegistrationBonusChips;}
   t.prizeConfigChanges=[...(t.prizeConfigChanges||[]),{by:uid,at:now,previous,next:{prizePoolMode:mode,addedPrize,earlyRegistrationBonusPct:bonus,earlyRegistrationBonusUntilStart:t.earlyRegistrationBonusUntilStart}}].slice(-20);
  }else if(op==='registration'){
   if(!['reg','running'].includes(t.status))fail('failed-precondition','Only an active tournament can change registration');
   const byLevel=r.data.lateRegUntilLevel!=null;
   const level=byLevel?tournamentNumber(r.data.lateRegUntilLevel,NaN,0,t.structure.length,true,'Late registration through the end of level'):t.lateRegUntilLevel;
   if(byLevel&&t.mysteryBounty&&level>=t.mysteryStartLevel)fail('invalid-argument','Late registration must close before mystery bounties start');
   const deadline=byLevel?0:registrationDeadline(t,r.data.lateRegClosesAt,now);
   t.registrationChanges=[...(t.registrationChanges||[]),{by:uid,at:now,previousClosesAt:t.lateRegClosesAt||null,previousLevel:t.lateRegUntilLevel||0,closesAt:deadline,level}].slice(-20);
   t.lateRegClosesAt=deadline;t.lateRegUntilLevel=level;
  }else if(op==='start'){
   if(t.status!=='reg')return{ok:true,tournamentId:id};if(t.botFill&&club.botsAuto!==false)addBots(t,club.ownerUid,effects,now);if(all(t).length<t.minPlayers)fail('failed-precondition','Not enough players');
  }else if(['rebuy','addon','decline'].includes(op)){
   if(t.status!=='running'||!mine||mine.out)fail('failed-precondition','You are not active');const row=rows.find(row=>row.players[uid]);if(!row)fail('failed-precondition','Tournament seat is moving; retry');const p=row.players[uid];
   if(p.pendingTournamentChips>0)fail('failed-precondition','Your purchase is already queued for the next hand');
   queued=!T.idle(row);
   if(op==='rebuy'){if(!canRebuy(t,mine,now)||p.stack!==0||p.status!=='busted')fail('failed-precondition','Rebuy unavailable');funding(t,effects,mine);mine.rebuys++;if(queued)p.pendingTournamentChips=t.startStack;else Object.assign(p,{stack:t.startStack,status:'waiting',bustedAt:null,_reported:false});t.initialChips+=t.startStack;}
   else if(op==='addon'){if(queued)fail('failed-precondition','Add-ons are available between hands');if(!t.addon||mine.addon||clock(t,now).lvl+1!==t.addonLevel||p.stack<=0)fail('failed-precondition','Add-on unavailable');effects.push({type:'credit',uid,amount:-t.buyIn});mine.addon=true;mine.paid=cash(mine.paid+t.buyIn);if(t.prizePoolMode==='fixed'){t.feeTotal=cash(t.feeTotal+t.buyIn);mine.feesPaid=cash((mine.feesPaid||0)+t.buyIn);}else t.prizePool=cash(t.prizePool+t.buyIn);p.stack+=t.startStack;t.initialChips+=t.startStack;}
   else{if(queued)fail('failed-precondition','Wait until the hand ends');if(p.stack!==0||p.status!=='busted')fail('failed-precondition','No rebuy pending');mine.out=true;mine.outAt=now;mine.rank=all(t).filter(p=>!p.out).length+1;p.status='out';}row.changed=true;
  }else if(op==='removeplayer'){
   if(!['reg','running'].includes(t.status))fail('failed-precondition','Tournament is no longer active');
   const target=key(r.data.playerUid,'player'),e=t.players[target];if(t.removedPlayers?.[target]||e?.removed)return{ok:true,tournamentId:id};if(!e)fail('not-found','Player is not registered');
   t.removedPlayers={...t.removedPlayers,[target]:{uid:target,name:e.name,by:uid,at:now}};
   if(t.status==='reg'){
    effects.push({type:'credit',uid:payee(e),amount:e.paid||0});t.prizePool=cash(t.prizePool-T.entryFunding(t).pool);t.feeTotal=cash(t.feeTotal-T.entryFunding(t).fee);t.bountyPool=cash(t.bountyPool-t.bounty);if(t.bountyFree)t.bountyBudgetRemaining=cash(t.bountyBudgetRemaining+t.bounty);
    delete t.players[target];t.entryCount--;
   }else{
    const row=rows.find(row=>row.players?.[target]);e.removalRequested=true;e.removalRequestedBy=uid;e.removalRequestedAt=now;queued=!removeSeat(t,row,target,now);
   }
  }else if(op==='archive'){
   const wasRunning=t.status==='running';
   if(t.status==='reg'){
    for(const p of all(t))effects.push({type:'credit',uid:payee(p),amount:p.paid});
    effects.push({type:'credit',uid:t.bountyFundingUid,amount:cash(t.addedPrize+t.bountyBudgetRemaining+(t.bountyFree?t.bountyPool:0))});
    t.status='cancelled';t.prizePool=t.feeTotal=t.bountyPool=t.bountyBudgetRemaining=0;t.refundedAt=now;
   }else if(wasRunning){
    t.status='cancelled';t.cancelledAt=now;t.cancellationAccounting='retained-no-automatic-refund';
    for(const row of rows){row.tournament={...row.tournament,finished:true,cancelled:true};row.changed=true;row.archiveTournament=true;}
   }
   t.archived=true;t.archivedAt=now;t.archivedBy=uid;
  }else if(op==='cancel'){
   if(t.status==='cancelled')return{ok:true,tournamentId:id};if(t.status!=='reg')fail('failed-precondition','Only an unstarted tournament can be cancelled');for(const p of all(t))effects.push({type:'credit',uid:payee(p),amount:p.paid});effects.push({type:'credit',uid:t.bountyFundingUid,amount:cash(t.addedPrize+t.bountyBudgetRemaining+(t.bountyFree?t.bountyPool:0))});t.status='cancelled';t.prizePool=t.feeTotal=t.bountyPool=t.bountyBudgetRemaining=0;t.refundedAt=now;
  }else fail('invalid-argument','Unknown tournament operation');
  const write=await prepareLedger(db,tx,t.clubId,effects,'tournament:'+id,now);write();if(op==='start')start(tx,db,t,now);
  for(const row of rows)if(row.changed){if(row.isNew){const {docId,isNew,changed,...doc}=row;tx.set(db.doc('tables/'+docId),doc);}else tx.update(db.doc('tables/'+row.docId),{players:row.players,...(row.archiveTournament?{tournament:row.tournament}:{}),'gameState.__seq':(row.gameState?.__seq||0)+1});}tx.set(ref,docOf(t));return{ok:true,tournamentId:id,queued,tableId:op==='register'?t.players[uid]?.tableId||null:null};
 });
});
module.exports.tickTournament=tickTournament;module.exports.settleHand=settleHand;module.exports.clock=clock;module.exports.config=config;

