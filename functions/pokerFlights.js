'use strict';
const T=require('./pokerTournamentCore');
const {cash,fail}=require('./pokerAuthority');
const {prepareLedger}=require('./pokerLedger');
const ref=(db,id)=>db.doc('tournaments/'+id);

function endTime(flight){
 return T.lateRegistrationDeadline({...flight,lateRegUntilLevel:flight.bagAfter,lateRegClosesAt:0},flight.structure);
}

function schedule(t,id,settings,now){
 const dates=settings.starts,after=settings.bagAfter,finalAt=settings.finalAt;
 if(!Array.isArray(dates)||dates.length<2||dates.length>8||!Number.isInteger(after)||after<1||after>=t.structure.length)
  fail('invalid-argument','Choose 2–8 qualifying flights and a last qualifying level before the final levels.');
 if(t.bounty||t.addon||t.bountyBudgetRemaining||t.mysteryBounty||t.lateRegClosesAt)
  fail('invalid-argument','The multi-day trial supports standard tournaments with level-based registration and no bounties or add-ons.');
 const times=[...dates,finalAt];
 if(times.some((at,i)=>!Number.isSafeInteger(at)||at<now||(i>0&&at<=times[i-1])))
  fail('invalid-argument','Enter future flight times in order, followed by the final.');
 const capacity=Math.min(t.maxPlayers,Math.floor(180/dates.length));
 if(capacity<t.minPlayers)fail('invalid-argument','Minimum players exceeds flight capacity.');
 const ids=dates.map((_,i)=>id+'_d'+(i+1));
 const flights=dates.map((at,i)=>{
  const label='Day 1'+String.fromCharCode(65+i);
  const flight={...t,name:t.name+' · '+label,startAt:at,maxPlayers:capacity,addedPrize:0,prizePool:0,
   flightOf:id,flightLabel:label,bagAfter:after,lateRegUntilLevel:Math.min(after,t.lateRegUntilLevel)};
  if(times[i+1]<endTime(flight))fail('invalid-argument','Schedule the next session after the qualifying levels finish.');
  return flight;
 });
 const final={...t,name:t.name+' · Final',startAt:finalAt,flightIds:ids,bags:{},buyIn:0,fee:0,reentry:false,addon:false,
  lateRegUntilLevel:0,lateRegClosesAt:0,botFill:false,earlyRegistrationBonusPct:0,minPlayers:1,maxPlayers:180,
  structure:t.structure.slice(after),anteFromLevel:Math.max(1,t.anteFromLevel-after)};
 return {flights,ids,final};
}

async function checkEntry(tx,db,flight,uid){
 const series=(await tx.get(ref(db,flight.flightOf))).data();
 if(!series||series.status!=='reg'||series.archived||series.bags?.[uid])fail('failed-precondition','A qualified player already has a seat in the final or entries are closed.');
 const others=series.flightIds.filter(id=>id!==flight.id);
 const snapshots=await tx.getAll(...others.map(id=>ref(db,id)));
 if(snapshots.some(s=>{const t=s.data();return t&&['reg','running'].includes(t.status)&&t.players[uid]&&!t.players[uid].out;}))
  fail('failed-precondition','You already have an entry in another flight.');
}

async function seal(tx,db,flight,rows,now){
 if(rows.some(r=>!T.idle(r)||(r.gameState.phase==='showdown'&&now-r.gameState.showdownAt<T.showdownDelay(r.gameState))))return {finishing:true};
 const seriesRef=ref(db,flight.flightOf),series=(await tx.get(seriesRef)).data();
 if(!series||series.status!=='reg'||series.archived)fail('failed-precondition','Final is unavailable.');
 const seats=new Map();
 for(const row of rows)for(const p of Object.values(row.players)){
  if(seats.has(p.uid))fail('failed-precondition','Duplicate flight seat');
  seats.set(p.uid,p);
 }
 const effects=[],bags={},entrants=Object.values(flight.players);
 for(const p of entrants){
  const stack=flight.status==='reg'?(p.entryStartStack??flight.startStack):cash((seats.get(p.uid)?.stack||0)+(seats.get(p.uid)?.pendingTournamentChips||0));
  if(p.out||stack<=0){
   if(!p.isBot&&!p.removed)effects.push({type:'gameLog',entries:[{uid:p.uid,username:p.name,profit:cash(-(p.paid||0)),rake:0}]});
   continue;
  }
  if(series.bags[p.uid])fail('failed-precondition','Duplicate chip bag');
  const bag={uid:p.uid,name:p.name,amount:stack,flight:flight.flightLabel,flightId:flight.id,sealedAt:now};
  bags[p.uid]=bag;series.bags[p.uid]=bag;
  series.players[p.uid]={...p,tableId:null,out:false,rank:null,feesPaid:0,settlementHands:0,entryStartStack:stack};
 }
 if(flight.status==='running'&&cash(Object.values(bags).reduce((n,b)=>n+b.amount,0))!==flight.initialChips)
  fail('failed-precondition','Bagged stacks do not match the chips in play.');
 if(flight.feeTotal)effects.push({type:'rake',rake:flight.feeTotal,allocations:require('./pokerRake').allocateRake(flight.feeTotal,entrants.map(p=>({...p,weight:p.feesPaid||0})))});
 effects.push({type:'settlementHands',entries:entrants.filter(p=>!p.isBot&&!p.removed).map(p=>({uid:p.uid,hands:p.settlementHands||0,tableName:flight.name,gameType:flight.pokerType}))});
 const write=await prepareLedger(db,tx,flight.clubId,effects,'flight:'+flight.id,now);
 write();
 tx.update(seriesRef,{players:series.players,bags:series.bags,entryCount:Object.keys(series.bags).length,prizePool:cash(series.prizePool+flight.prizePool)});
 tx.update(ref(db,flight.id),{status:'done',finishedAt:now,bags,qualifiedCount:Object.keys(bags).length,prizePool:0,feeTotal:0,transferredPrizePool:flight.prizePool});
 for(const row of rows)tx.update(db.doc('tables/'+row.docId),{players:{},'tournament.finished':true,'tournament.flightSealed':true,'gameState.phase':'waiting','gameState.board':[],'gameState.activeTurnUid':null});
 return {sealed:true};
}

async function finalReady(tx,db,t){
 const docs=await tx.getAll(...t.flightIds.map(id=>ref(db,id)));
 return docs.every(s=>s.exists&&['done','cancelled'].includes(s.data().status));
}
module.exports={endTime,schedule,checkEntry,seal,finalReady};
