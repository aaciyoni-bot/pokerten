(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x)),cash=n=>Math.round(n*100)/100;
const capacity=t=>Math.max(2,Math.min(/^Omaha\s*7$/i.test(t.pokerType||'')?5:9,Math.floor(44/(Number(String(t.pokerType||'').match(/Omaha\s*(\d)/i)?.[1])||2)),Math.floor(Number(t.tableSize)||9)));
// Keep the public result visible before dealing, moving seats or finishing.
const showdownDelay=g=>g?.earlyWin?5000:8000;
const idle=t=>['waiting','showdown'].includes(t.gameState?.phase||'waiting')&&!(t.gameState?.pots||[]).some(p=>p.amount>0)&&!Object.values(t.players||{}).some(p=>p.bet>0);
const chips=rows=>cash(rows.reduce((sum,t)=>sum+Object.values(t.players||{}).reduce((n,p)=>n+Number(p.stack||0)+Number(p.bet||0)+Number(p.pendingTournamentChips||0),0)+(t.gameState?.pots||[]).reduce((n,p)=>n+Number(p.amount||0),0),0));
// One timeline drives the server deal gate, table clocks and registration deadlines.
function* levelSchedule(t,rows,start){
 let at=start;
 for(let i=0;i<rows.length;i++){
  const end=at+Math.max(1,Number(rows[i].mins)||5)*60000;
  const ordinaryBreak=i+1<rows.length&&t.breakEvery>0&&(i+1)%t.breakEvery===0;
  const dayBreak=t.dayBreak?.afterLevel===i+1;
  const nextStart=dayBreak?Math.max(end,t.dayBreak.resumeAt):end+(ordinaryBreak?(Number(t.breakMins)||0)*60000:0);
  yield {i,end,nextStart,dayBreak};
  at=nextStart;
 }
}
function clock(t,rows,now=Date.now()){
 for(const {i,end,nextStart,dayBreak} of levelSchedule(t,rows,Number(t.startedAt)||now)){
  const row=rows[i],next=rows[i+1]||null;
  if(now<end)return {lvl:i,row,inBreak:false,phaseEndsAt:end,next,breakNext:nextStart>end};
  if(now<nextStart)return {lvl:i+1,row:next,inBreak:true,phaseEndsAt:nextStart,next,breakNext:false,dayBreak};
 }
 return{lvl:rows.length-1,row:rows.at(-1),inBreak:false,phaseEndsAt:Infinity,next:null,breakNext:false};
}
// End of the selected level excludes its own break.
function lateRegistrationDeadline(t,rows){
 if(Number(t.lateRegClosesAt)>0)return Number(t.lateRegClosesAt);
 const level=Math.min(rows.length,Math.max(0,Math.floor(Number(t.lateRegUntilLevel)||0)));
 for(const {i,end} of levelSchedule(t,rows,Number(t.startedAt)||Number(t.startAt)||0)){
  if(i+1===level)return end;
 }
 return 0;
}
function lateRegistrationOpen(t,rows,now=Date.now()){
 if(!t||t.archived)return false;if(t.status==='reg')return true;if(t.status!=='running')return false;
 return now<lateRegistrationDeadline(t,rows);
}
function earlyRegistrationBonus(t,now=Date.now(),reentry=false){
 if(reentry||t.status!=='reg'||(!t.earlyRegistrationBonusUntilStart&&now>=Number(t.startAt)))return 0;
 return Math.floor(Number(t.startStack)*Math.max(0,Math.min(100,Number(t.earlyRegistrationBonusPct)||0))/100);
}
// Entry payments remain escrowed until settlement. Fixed-pool events route
// buy-ins to club income, including re-entries regardless of the legacy flag.
function entryFunding(t,reentry=false){
 const amount=Number(reentry?(t.reentryBuyIn??t.buyIn):t.buyIn)||0;
 const club=t.prizePoolMode==='fixed'||(reentry&&t.reentryToPrizePool===false);
 return {pool:club?0:amount,fee:cash((Number(t.fee)||0)+(club?amount:0))};
}
function split(value,uids){if(!uids.length)throw Error('No award recipient');const cents=Math.round(value*100),base=Math.floor(cents/uids.length),rem=cents-base*uids.length;return Object.fromEntries(uids.map((uid,i)=>[uid,(base+(i<rem?1:0))/100]));}
function bountyPlan(t,event,random=()=>.5){
 if(t.bountyEvents?.[event.id])return null;const players=copy(t.players||{}),credits={},mode=t.bountyMode||'fixed';let pool=Number(t.bountyPool)||0;const before=pool;
 for(let i=0;i<event.busts.length;i++){
  const b=event.busts[i],loser=players[b.uid],winners=[...new Set(b.winners)].filter(uid=>uid!==b.uid&&players[uid]&&!players[uid].out).sort();if(!loser||!winners.length)throw Error('missing-bounty-winner');
  if(mode==='mystery'&&event.level<(t.mysteryStartLevel||1))continue;
  let amount=loser.bountyValue??t.bounty??0,carry=0;if(!amount)continue;
  if(mode==='progressive'){const paid=Math.floor(amount*100*(t.progressiveCashPct??50)/100)/100;carry=cash(amount-paid);amount=paid;}
  if(mode==='mystery'){const slots=Math.max(1,Object.values(players).filter(p=>!p.out).length+event.busts.length-i-1),r=random(),mult=r<.4?.5:r<.75?1:r<.9?2:r<.98?3:25;amount=slots===1?pool:Math.max(0,Math.min(pool-(slots-1)*.01,cash(pool/slots*mult)));}
  if(amount>pool+.001)throw Error('insufficient-bounty-pool');pool=cash(pool-amount);loser.bountyValue=0;const cuts=split(amount,winners),heads=split(carry,winners);
  for(const uid of winners){credits[uid]=cash((credits[uid]||0)+cuts[uid]);const p=players[uid];p.bountyWon=cash((p.bountyWon||0)+cuts[uid]);p.bounties=(p.bounties||0)+1;if(mode==='progressive')p.bountyValue=cash((p.bountyValue??t.bounty??0)+heads[uid]);}
 }
 if(cash(pool+Object.values(credits).reduce((a,b)=>a+b,0))!==cash(before))throw Error('bounty-conservation');return{players,credits,pool};
}
function plan(t,input,now=Date.now()){
 const none=issue=>({updates:[],deletes:[],champion:null,issue:issue||null});if(t.status!=='running')return none();
 const rows=copy(input),roster=t.players||{},seen=new Set(),cap=capacity(t),alive=Object.keys(roster).filter(uid=>!roster[uid].out);
 for(const row of rows){if(row.tournamentId!==t.id)return none('wrong-tournament');for(const [uid,p]of Object.entries(row.players||{})){
  p.uid=uid;if(!Number.isFinite(p.stack)||p.stack<0)return none('invalid-stack');if(p.status==='out'&&p.stack===0&&roster[uid]?.out)continue;
  if(seen.has(uid))return none('duplicate-seat');seen.add(uid);if(!roster[uid]||roster[uid].out)return none('roster-mismatch');if(idle(row)&&p.stack===0&&p.status!=='busted')return none('unsettled-zero-stack');
 }}
 if(alive.some(uid=>!seen.has(uid)))return none('missing-seat');if(!alive.length)return none('no-live-player');
 const occupied=row=>Object.values(row.players||{}).filter(p=>!(p.status==='out'&&p.stack===0)),updates=new Map(),deleted=new Set();
 const ready=row=>idle(row)&&(row.gameState?.phase!=='showdown'||now-(row.gameState.showdownAt||0)>=showdownDelay(row.gameState));
 const save=row=>updates.set(row.docId,{id:row.docId,patch:{players:row.players,tournament:row.tournament,gameState:{...row.gameState,__seq:(input.find(x=>x.docId===row.docId).gameState?.__seq||0)+1}}});
 const finish=champion=>chips(rows.filter(r=>!deleted.has(r.docId)))===chips(input)?{updates:[...updates.values()].filter(u=>!deleted.has(u.id)),deletes:[...deleted],champion:champion||null,issue:null}:none('chip-conservation');
 const hold=(targets,force=false)=>{if(!force&&targets.every(ready))return true;for(const row of targets){if((row.tournament?.balanceHoldUntil||0)<now+10000){row.tournament={...row.tournament,balanceHoldUntil:now+30000};save(row);}}return false;};
 const clean=row=>{let changed=false;for(const [uid,p]of Object.entries(row.players))if(p.status==='out'&&p.stack===0&&!(p.pendingTournamentChips>0)&&roster[uid]?.out){delete row.players[uid];changed=true;}return changed;};
 for(const row of rows)if(ready(row)&&clean(row))save(row);
 const move=(src,dst,p)=>{clean(dst);const used=new Set(Object.values(dst.players).map(p=>p.seatIndex));let seat=0;while(used.has(seat)&&seat<cap)seat++;if(seat>=cap||dst.players[p.uid])throw Error('unsafe-seat');dst.players[p.uid]={...p,seatIndex:seat,bet:0,cards:[],cardCount:0,status:'waiting',hasActed:false,actionText:'',reveal:false,mucked:false,_reported:false};delete src.players[p.uid];save(src);save(dst);};
 for(const row of rows)if(!occupied(row).length&&ready(row))deleted.add(row.docId);
 const live=rows.filter(r=>occupied(r).length).sort((a,b)=>occupied(a).length-occupied(b).length||a.docId.localeCompare(b.docId));
 if(alive.length===1&&rows.every(ready)&&live.length===1&&occupied(live[0]).every(p=>p.stack>0)){const row=live[0];row.tournament={...row.tournament,finished:true,final:true,tableWinner:alive[0],balanceHoldUntil:0};save(row);return finish(alive[0]);}
 if(!live.length)return none('missing-seat');const seats=live.reduce((n,r)=>n+occupied(r).length,0),movable=r=>occupied(r).every(p=>p.stack>0);
 if(live.length>Math.ceil(seats/cap)){
  if(!hold(live)||!live.every(movable))return finish();const src=live[0],targets=live.slice(1).sort((a,b)=>occupied(b).length-occupied(a).length);
  for(const p of occupied(src)){const dst=targets.find(r=>occupied(r).length<cap);if(!dst)return none('capacity');move(src,dst,p);}deleted.add(src.docId);
  for(const row of targets){clean(row);row.tournament={...row.tournament,finished:false,final:targets.length===1,balanceHoldUntil:0};if(targets.length===1)row.gameState={...row.gameState,phase:'waiting',board:[],board2:null,pots:[],highestBet:0,activeTurnUid:null,turnStartedAt:null,lastWinners:null,allInReveal:false};save(row);}return finish();
 }
 if(live.length===1){const row=live[0];if(ready(row)&&!row.tournament?.final){row.tournament={...row.tournament,final:true,finished:false,balanceHoldUntil:0};save(row);}return finish();}
 const src=live.at(-1),dst=live[0];if(occupied(src).length-occupied(dst).length>=2&&movable(src)&&occupied(dst).length<cap){if(!hold([src,dst]))return finish();const ordered=occupied(src).sort((a,b)=>a.seatIndex-b.seatIndex),dealer=ordered.findIndex(p=>p.uid===src.gameState?.dealerUid);move(src,dst,ordered[(Math.max(-1,dealer)+3)%ordered.length]);for(const row of[src,dst]){row.tournament={...row.tournament,balanceHoldUntil:0};save(row);}}
 return finish();
}
const api={levelSchedule,showdownDelay,capacity,idle,chips,clock,lateRegistrationDeadline,lateRegistrationOpen,earlyRegistrationBonus,entryFunding,split,bountyPlan,plan};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerTournament=api;
})(typeof window!=='undefined'?window:globalThis);

