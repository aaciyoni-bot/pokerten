(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x)),cash=n=>Math.round(n*100)/100;
const capacity=t=>Math.max(2,Math.min(9,Math.floor(44/(Number(String(t.pokerType||'').match(/Omaha\s*(\d)/i)?.[1])||2)),Math.floor(Number(t.tableSize)||9)));
const idle=t=>['waiting','showdown'].includes(t.gameState?.phase||'waiting')&&!(t.gameState?.pots||[]).some(p=>p.amount>0)&&!Object.values(t.players||{}).some(p=>p.bet>0);
const chips=rows=>cash(rows.reduce((sum,t)=>sum+Object.values(t.players||{}).reduce((n,p)=>n+Number(p.stack||0)+Number(p.bet||0),0)+(t.gameState?.pots||[]).reduce((n,p)=>n+Number(p.amount||0),0),0));
function clock(t,rows,now=Date.now()){
 const started=Number(t.startedAt)||now,elapsed=Math.max(0,now-started),every=Math.max(0,Math.floor(Number(t.breakEvery)||0)),pause=Math.max(0,Number(t.breakMins)||0)*60000;let acc=0;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],duration=Math.max(1,Number(row.mins)||5)*60000,breakNext=!!(every&&pause&&(i+1)%every===0&&i+1<rows.length);
  if(elapsed<acc+duration)return{lvl:i,row,inBreak:false,phaseEndsAt:started+acc+duration,next:rows[i+1]||null,breakNext};acc+=duration;
  if(breakNext){if(elapsed<acc+pause)return{lvl:i+1,row:rows[i+1],inBreak:true,phaseEndsAt:started+acc+pause,next:rows[i+1],breakNext:false};acc+=pause;}
 }
 return{lvl:rows.length-1,row:rows.at(-1),inBreak:false,phaseEndsAt:Infinity,next:null,breakNext:false};
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
 const ready=row=>idle(row)&&(row.gameState?.phase!=='showdown'||now-(row.gameState.showdownAt||0)>=5000);
 const save=row=>updates.set(row.docId,{id:row.docId,patch:{players:row.players,tournament:row.tournament,gameState:{...row.gameState,__seq:(input.find(x=>x.docId===row.docId).gameState?.__seq||0)+1}}});
 const finish=champion=>chips(rows.filter(r=>!deleted.has(r.docId)))===chips(input)?{updates:[...updates.values()].filter(u=>!deleted.has(u.id)),deletes:[...deleted],champion:champion||null,issue:null}:none('chip-conservation');
 const hold=targets=>{if(targets.every(ready))return true;for(const row of targets.filter(idle)){if((row.tournament?.balanceHoldUntil||0)<now+10000){row.tournament={...row.tournament,balanceHoldUntil:now+30000};save(row);}}return false;};
 const clean=row=>{for(const [uid,p]of Object.entries(row.players))if(p.status==='out'&&p.stack===0)delete row.players[uid];};
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
const api={capacity,idle,chips,clock,split,bountyPlan,plan};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerTournament=api;
})(typeof window!=='undefined'?window:globalThis);
