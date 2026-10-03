'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {computeCycle,cents,pairKey}=require('../functions/settlementEngine');
const base={primaryAgentId:'agentA',agentType:'rake',agentPct:50,secondaryPct:0,rakebackPct:0,tableId:'t',tableName:'NLH'};
const sessions=[['A',-1200,350,410,30],['A',-1000,200,180,30],['A',200,50,95,30],['B',1200,400,520,0],['C',-500,250,300,0],['D',3000,2000,800,0]].map(([playerId,result,rake,hands,rakebackPct],i)=>({...base,playerId,result:cents(result),rake:cents(rake),hands,rakebackPct,tableId:'t'+i,...(playerId==='D'?{primaryAgentId:'agentB',agentPct:40}:{})}));
test('brief acceptance example, exact cents and privacy',()=>{
 const r=computeCycle({sessions});
 for(const [v,expected] of [[r.players.A.totals.result,-2000],[r.players.A.rakebackTotal,180],[r.players.A.closing,-1820],[r.agents.agentA.playersResult,-1300],[r.agents.agentA.rake,1250],[r.agents.agentA.commission,625],[r.agents.agentA.earnings,445],[r.agents.agentA.toClub,675],[r.agents.agentB.commission,800],[r.agents.agentB.toClub,-3800],[r.club.totals.playersResult,1700],[r.club.totals.rake,3250],[r.club.totals.commission,1425],[r.club.totals.toClub,-3125]])assert.equal(v,cents(expected));
 assert.equal(r.players.A.totals.hands,685);assert.equal(r.players.A.rows.length,3);
 assert.doesNotMatch(JSON.stringify(r.players),/"rake"|Pct|agentType/);
 assert.doesNotMatch(JSON.stringify(r.players.B),/rakeback/i);
 const carry={pairs:Object.values(r.pairs).map(p=>({agentId:p.agentId,playerId:p.playerId,amount:p.closing})),agents:Object.values(r.agents).map(a=>({agentId:a.agentId,amount:a.closing}))};
 const next=computeCycle({openings:carry,payments:[{type:'player',agentId:'agentA',playerId:'A',fromId:'A',toId:'agentA',amount:cents(1000)}]});assert.equal(next.players.A.closing,cents(-820));
});
test('fractional chips, mixed agreements, leads and changing assignment do not overwrite past activity',()=>{
 const r=computeCycle({sessions:[{...base,playerId:'a',result:cents(-340.17),rake:cents(10.01),hands:2},{...base,playerId:'a',agentType:'result',agentPct:30,result:cents(100),rake:cents(2),hands:1},{...base,playerId:'b',primaryAgentId:'agentB',result:cents(1),rake:cents(10),hands:1,secondaryAgentId:'agentA',secondaryPct:10}]});
 assert.equal(r.agents.agentA.commission,501-3000);assert.equal(r.agents.agentA.agentType,'mixed');assert.equal(r.agents.agentA.leadsIncome,100);assert.equal(r.players.a.totals.result,-24017);
 const collision=computeCycle({sessions:[{...base,primaryAgentId:'a_b',playerId:'c',result:100,rake:0},{...base,primaryAgentId:'a',playerId:'b_c',result:200,rake:0}]});assert.equal(Object.keys(collision.pairs).length,2);assert.notEqual(pairKey('a_b','c'),pairKey('a','b_c'));
});
test('zero opening, direct rakeback and freeroll never infer debt from wallet balances',()=>{
 const r=computeCycle({sessions:[{...base,playerId:'x',primaryAgentId:null,result:-40000,rake:10000,rakebackPct:20},{...base,playerId:'y',result:30000,rake:0,kind:'tournament',rakebackPct:30}]});
 assert.equal(r.players.x.opening,0);assert.equal(r.players.x.closing,-38000);assert.equal(r.players.y.closing,30000);assert.equal(r.agents.agentA.commission,0);assert.doesNotMatch(JSON.stringify(r.players.y),/rakeback/i);
 assert.throws(()=>computeCycle({sessions:[{...base,playerId:'x',result:1.2,rake:0}]}));
});
module.exports={sessions};
