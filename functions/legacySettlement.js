'use strict';
// Read-only adapter for the live, pre-migration ledger. Never fabricates
// payments, reprices past commissions, initializes a cycle, or moves chips.
const E=require('./settlementEngine');
const Accounting=require('./pokerAccounting'),Period=require('./settlementPeriod');
const cents=n=>E.cents(Number(n)||0);
function buildLegacy(members,games,tables,agentLogs,{ownerUid,now=Date.now(),period=null}={}){
 const accounting=Accounting.buildAccounting(members,games,tables,{ownerUid,god:true,now,cycle:period});
 const known=!accounting.needsPeriodStart;
 const players=members.filter(m=>accounting.players[m.uid]).map(m=>{const p=accounting.players[m.uid];return{uid:m.uid,name:m.username||m.uid,agentUid:m.agentUid||null,balance:cents(p.balance),onTables:cents(p.onTables),chips:cents(p.chips),result:known?cents(p.result):null,totalResult:cents(p.totalResult??p.result),rake:known?cents(p.rake):null,openSessions:p.openSessions};});
 const cuts=Object.create(null);
 for(const e of agentLogs){if(!known||!Period.inPeriod(e.at,period,now)||e.accountingVersion!==2||e.rakeSource!=='human'||!e.agentUid)continue;cuts[e.agentUid]=(cuts[e.agentUid]||0)+cents(e.amount);}
 const sum=rows=>rows.reduce((s,p)=>{for(const k of ['balance','onTables','chips','result','totalResult','rake','openSessions'])s[k]+=p[k]||0;s.players++;return s;},{balance:0,onTables:0,chips:0,result:0,totalResult:0,rake:0,openSessions:0,players:0});
 const scopedSum=rows=>{const totals=sum(rows);if(!known){totals.result=null;totals.rake=null;}return totals;};
 const agents=members.filter(m=>!m.isBot&&['approved','banned'].includes(m.status)&&(['agent','manager','club_owner'].includes(m.role)||cuts[m.uid]||players.some(p=>p.agentUid===m.uid))).map(m=>{const totals=scopedSum(players.filter(p=>p.agentUid===m.uid&&p.uid!==m.uid)),commission=known?cuts[m.uid]||0:null;return{uid:m.uid,name:m.username||m.uid,...totals,commission,toClub:known?-totals.result-commission:null};});
 const club=scopedSum(players.filter(p=>p.uid!==ownerUid));club.commission=known?agents.reduce((s,a)=>s+a.commission,0):null;club.toClub=known?-club.result-club.commission:null;
 return{start:accounting.start,needsPeriodStart:!known,asOf:now,basis:accounting.basis,ownerUid,players,agents,club};
}
function projectLegacy(full,auth){
 const {uid,role}=auth;
 const publicPlayer=p=>({uid:p.uid,name:p.name,balance:p.balance,onTables:p.onTables,chips:p.chips,result:p.result,openSessions:p.openSessions});
 if(role==='player'){
  const p=full.players.find(p=>p.uid===uid)||{uid,name:auth.me?.username||uid,balance:cents(auth.me?.balance),onTables:0,chips:cents(auth.me?.balance),result:full.needsPeriodStart?null:0,totalResult:0,openSessions:0};
  return{players:[publicPlayer(p)],totals:publicPlayer(p),asOf:full.asOf};
 }
 if(role==='agent'){
  const a=full.agents.find(a=>a.uid===uid)||{uid,name:auth.me?.username||uid,balance:0,onTables:0,chips:0,result:full.needsPeriodStart?null:0,totalResult:0,rake:full.needsPeriodStart?null:0,commission:full.needsPeriodStart?null:0,toClub:full.needsPeriodStart?null:0,players:0,openSessions:0};
  return{players:full.players.filter(p=>p.agentUid===uid&&p.uid!==uid),totals:a,agents:[a],asOf:full.asOf};
 }
 return{players:full.players,totals:full.club,agents:full.agents,asOf:full.asOf};
}
module.exports={buildLegacy,projectLegacy};
