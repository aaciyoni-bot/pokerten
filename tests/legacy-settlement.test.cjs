'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildLegacy,projectLegacy}=require('../functions/legacySettlement');
const {cycleStart}=require('../functions/pokerAccounting');
const now=Date.UTC(2026,9,3,20),start=cycleStart(now);
const members=[{uid:'owner',username:'Owner',role:'club_owner',status:'approved',balance:5000},{uid:'agent',username:'Agent',role:'agent',status:'approved',balance:0},{uid:'p',username:'Player',role:'player',status:'approved',agentUid:'agent',agentPct:99,balance:800},{uid:'other',username:'Other club player',role:'player',status:'approved',agentUid:'otherAgent',balance:1500},{uid:'bot_x',username:'Bot',role:'player',status:'approved',balance:9999}];
const games=[{uid:'p',profit:-200,rake:20,at:now-1000},{uid:'p',profit:100,rake:10,at:start-1000},{uid:'other',profit:500,rake:30,at:now-1000},{uid:'bot_x',profit:9999,rake:888,at:now-1000}];
const commissions=[{agentUid:'agent',amount:14,accountingVersion:2,rakeSource:'human',at:now-1000},{agentUid:'agent',amount:99,accountingVersion:2,rakeSource:'bot',at:now-1000},{agentUid:'agent',amount:99,at:now-1000},{agentUid:'agent',amount:77,accountingVersion:2,rakeSource:'human',at:start-1000}];
test('legacy current cycle keeps recorded commissions, signed cumulative result and weekly result distinct',()=>{
 const full=buildLegacy(members,games,[],commissions,{ownerUid:'owner',now}),p=full.players.find(p=>p.uid==='p'),a=full.agents.find(a=>a.uid==='agent');
 assert.equal(full.start,start);assert.equal(p.chips,80000);assert.equal(p.result,-20000);assert.equal(p.totalResult,-10000);assert.equal(a.commission,1400);assert.equal(a.toClub,18600);assert.equal(full.players.some(p=>p.uid==='bot_x'),false);
 // Financial projections must not expose another relationship or change books.
 const own=projectLegacy(full,{uid:'p',role:'player',me:members[2]});assert.equal(own.players.length,1);assert.equal(own.players[0].result,-20000);assert.doesNotMatch(JSON.stringify(own),/totalResult|rake|commission|agentUid|other|Pct|owner/i);
 const agent=projectLegacy(full,{uid:'agent',role:'agent',me:members[1]});assert.deepEqual(agent.players.map(p=>p.uid),['p']);assert.deepEqual(agent.agents.map(a=>a.uid),['agent']);assert.equal(agent.totals.commission,1400);
 const owner=projectLegacy(full,{uid:'owner',role:'owner'});assert.equal(owner.totals.result,30000);assert.equal(owner.totals.chips,230000);
});
test('unfinished hand uses opening value, and continuing sitting is counted once',()=>{
 const tables=[{settings:{blinds:1,ante:1},gameState:{phase:'flop',handStartStacks:{p:399}},players:{0:{uid:'p',stack:250,bet:20,pendingTopUp:100,buyTotal:600}}}];
 const full=buildLegacy(members,games,tables,commissions,{ownerUid:'owner',now}),p=full.players.find(p=>p.uid==='p');
 assert.equal(p.chips,130000);assert.equal(p.result,-30000);assert.equal(p.totalResult,-20000);assert.equal(p.openSessions,1);
});
