'use strict';
const cash=n=>Math.round((Number(n)||0)*100)/100;
function cycleStart(now=Date.now()) {
 const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const wall=epoch=>{const p=Object.fromEntries(f.formatToParts(new Date(epoch)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);};
 const w=wall(now),d=new Date(w);let target=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7,0,1);
 if(w<target)target-=7*86400000;let epoch=target;for(let i=0;i<3;i++)epoch=target-(wall(epoch)-epoch);return epoch;
}
// Legacy and lifetime results include an unsettled sitting once, so joining,
// topping up and cashing out cannot change those results. Explicit cycle results
// below use the settlement journal's completed sessions instead.
// An unfinished hand is held at its opening value until its pot is awarded.
function buildAccounting(members,logs,tables,{now=Date.now(),ownerUid,god=false,cycle=null}={}) {
 const start=cycle?cycle.startAt:cycleStart(now),players={};
 const included=members.filter(m=>!m.isBot&&!String(m.uid).startsWith('bot_')&&['approved','banned'].includes(m.status)&&!(m.role==='super_admin'&&m.uid!==ownerUid));
 for(const m of included)players[m.uid]={name:String(m.username||m.uid),balance:cash(m.balance),onTables:0,chips:cash(m.balance),result:0,totalResult:0,openResult:0,openSessions:0,...(god?{rake:0,totalRake:0}:{})};
 // Lifetime P/L is independent of settlement cycle activation/closing and chip
 // transfers. Reuse the original history, never infer it from wallet balance.
 for(const e of logs){const p=players[e.uid];if(!p||e.at>now||e.rakeSource==='bot')continue;p.totalResult=cash(p.totalResult+cash(e.profit));if(god)p.totalRake=cash(p.totalRake+cash(e.rake));if(!Number.isFinite(e.at)||e.at<start)continue;p.result=cash(p.result+cash(e.profit));if(god)p.rake=cash(p.rake+cash(e.rake));}
 for(const t of tables){
  if(t.settings?.spinMode||t.tournamentId)continue; // tournament stacks are not redeemable chips
  const g=t.gameState||{},live=['preflop','flop','discard','turn','river'].includes(g.phase);
  for(const seat of Object.values(t.players||{})){
   const p=players[seat.uid];if(!p||seat.isBot)continue;
   const available=cash(cash(seat.stack)+cash(seat.bet)+cash(seat.pendingTopUp));
   let held=available;
   if(live&&Number.isFinite(g.handStartStacks?.[seat.uid])){
    // Cash handStartStacks is recorded after the ante. Restore the ante for
    // an open hand; it is charged normally once the hand has settled.
    const ante=g.bombPot?(Number(t.settings?.bombAnte)||2)*(g.handBB||Number(t.settings?.blinds)*2||1):(Number(t.settings?.ante)||0);
    held=cash(g.handStartStacks[seat.uid]+ante+cash(seat.pendingTopUp));
   }
   const gain=cash(held-cash(seat.buyTotal??held));
   p.onTables=cash(p.onTables+held);p.chips=cash(p.balance+p.onTables);p.openResult=cash(p.openResult+gain);p.result=cash(p.result+gain);p.totalResult=cash(p.totalResult+gain);p.openSessions++;
  }
 }
 // Once a club has an explicit cycle, its journal is the authority for cycle
 // activity. Weekly cash-out history and live sitting gains are not a substitute:
 // they can contain activity from before activation or a manually closed cycle.
 // The journal already subtracts each sitting's activation baseline on cash-out.
 if(cycle){
  for(const p of Object.values(players)){p.result=0;if(god)p.rake=0;}
  for(const entry of cycle.sessions||[]){
   if(entry.cycleId!==cycle.id||entry.at>now)continue;
   const p=players[entry.playerId];if(!p)continue;
   p.result=cash(p.result+(Number(entry.result)||0)/100);
   if(god)p.rake=cash(p.rake+(Number(entry.rake)||0)/100);
  }
 }
 const sum=ids=>ids.reduce((out,id)=>{const p=players[id];if(!p)return out;for(const k of ['balance','onTables','chips','result','totalResult','openResult','openSessions',...(god?['rake','totalRake']:[])])out[k]=cash((out[k]||0)+p[k]);out.players++;return out;},{players:0,balance:0,onTables:0,chips:0,result:0,totalResult:0,openResult:0,openSessions:0,...(god?{rake:0,totalRake:0}:{})});
 const agents={};for(const m of included)if(['agent','manager'].includes(m.role))agents[m.uid]=sum(included.filter(p=>p.agentUid===m.uid&&p.uid!==m.uid).map(p=>p.uid));
 return{start,asOf:now,basis:cycle?'settlement-cycle-completed-sessions':'cycle-cashouts-and-open-sessions',...(cycle?{cycleId:cycle.id,cycleStatus:cycle.status}:{}),rakeVisible:god,players,agents,club:sum(included.filter(m=>m.uid!==ownerUid).map(m=>m.uid))};
}
async function currentCycle(tx,db,cid){
 const S=require('./settlementStore'),ctx=await S.context(tx,db,cid);
 if(!ctx.config)return null;
 const sessions=await tx.get(ctx.ref.collection('sessions').where('cycleId','==',ctx.config.currentCycleId));
 return{...ctx.cycle,id:ctx.config.currentCycleId,sessions:sessions.docs.map(d=>d.data())};
}
function ownAccounting(summary,uid){
 const p=summary.players[uid],own=p?{name:p.name,balance:p.balance,onTables:p.onTables,chips:p.chips,result:p.result,openSessions:p.openSessions}:null;
 return{start:summary.start,asOf:summary.asOf,basis:summary.basis,...(summary.cycleId?{cycleId:summary.cycleId,cycleStatus:summary.cycleStatus}:{}),rakeVisible:false,players:p?{[uid]:own}:{}};
}
function publicGameLog(row,god){if(god)return row;const {rake,rakeSource,accountingVersion,...safe}=row;return safe;}
function publicAgentLog(row,god){if(god)return row;const {playerUid,...safe}=row;return safe;}
module.exports={cycleStart,buildAccounting,currentCycle,ownAccounting,publicGameLog,publicAgentLog};
