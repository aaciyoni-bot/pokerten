'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildAccounting,cycleStart,publicGameLog}=require('../functions/pokerAccounting');
const now=Date.parse('2026-10-03T14:00:00Z');
const members=[{uid:'owner',role:'club_owner',status:'approved',balance:8000},{uid:'agent',role:'agent',status:'approved',balance:20},{uid:'loss',agentUid:'agent',status:'approved',balance:159.83},{uid:'win',agentUid:'agent',status:'approved',balance:1000},{uid:'bot_x',isBot:true,status:'approved',balance:900},{uid:'ghost',role:'super_admin',status:'approved',balance:9999}];
const logs=[{uid:'loss',profit:-340.17,rake:3.41,at:now-100},{uid:'win',profit:500,rake:5,at:now-100},{uid:'loss',profit:-10,rake:20,at:cycleStart(now)-1},{uid:'bot_x',profit:900,rake:100,at:now-100}];
const options={now,ownerUid:'owner',god:true};
test('requested decimal examples, agent and club totals use one arithmetic source',()=>{
 const r=buildAccounting(members,logs,[],options);
 assert.equal(r.players.loss.result,-340.17);assert.equal(r.players.win.result,500);
 assert.deepEqual(r.agents.agent,{players:2,balance:1159.83,onTables:0,chips:1159.83,result:159.83,totalResult:149.83,openResult:0,openSessions:0,rake:8.41,totalRake:28.41});
 assert.equal(r.club.result,159.83);assert.equal(r.club.balance,1179.83);assert.equal(r.club.rake,8.41);
 assert.equal(r.players.bot_x,undefined);assert.equal(r.players.ghost,undefined);
});
test('buy-in, pending top-up and cash-out do not create profit or double count a session',()=>{
 const member={uid:'p',status:'approved',balance:0};
 const table={settings:{blinds:1},players:{p:{uid:'p',stack:159.83,bet:0,buyTotal:500}},gameState:{phase:'showdown'}};
 const live=buildAccounting([member],[],[table],options).players.p;
 const closed=buildAccounting([{...member,balance:159.83}],[{uid:'p',profit:-340.17,at:now}],[],options).players.p;
 assert.equal(live.result,closed.result);assert.equal(live.chips,closed.chips);
 table.players.p.pendingTopUp=100;table.players.p.buyTotal=600;
 const topped=buildAccounting([member],[],[table],options).players.p;
 assert.equal(topped.result,-340.17);assert.equal(topped.chips,259.83);
 table.gameState={phase:'flop',handStartStacks:{p:159.83}};table.players.p.stack=129.83;table.players.p.bet=30;
 assert.equal(buildAccounting([member],[],[table],options).players.p.result,-340.17,'unsettled bets are not booked as a loss');
});
test('rake never enters a non-GOD report or sanitized player history',()=>{
 const report=buildAccounting(members,logs,[],{...options,god:false});
 assert.equal(report.rakeVisible,false);assert.equal(JSON.stringify(report).includes('"rake":'),false);
 assert.deepEqual(publicGameLog({uid:'p',profit:-3,rake:7,rakeSource:'human',accountingVersion:2},false),{uid:'p',profit:-3});
});
test('cycles use Monday 00:01 Israel across daylight saving, never browser timezone',()=>{
 assert.equal(new Date(cycleStart(now)).toISOString(),'2026-09-27T21:01:00.000Z');
 assert.equal(new Date(cycleStart(Date.parse('2026-10-26T00:00:00Z'))).toISOString(),'2026-10-25T22:01:00.000Z');
 assert.equal(new Date(cycleStart(Date.parse('2026-09-27T21:00:30Z'))).toISOString(),'2026-09-20T21:01:00.000Z');
});

test('total result survives cycle boundaries and chip transfers without resetting old history',()=>{
 const oldAt=cycleStart(now)-1000, m={uid:'p',status:'approved',balance:800};
 const before=buildAccounting([m],[{uid:'p',profit:-200,at:oldAt}],[],options).players.p;
 assert.equal(before.chips,800);assert.equal(before.totalResult,-200);assert.equal(before.result,0);
 const loaded=buildAccounting([{...m,balance:1300}],[{uid:'p',profit:-200,at:oldAt}],[],options).players.p;
 assert.equal(loaded.totalResult,-200,'chip load is not profit');assert.equal(loaded.chips,1300);
 const inPlay=buildAccounting([{...m,balance:300}],[{uid:'p',profit:-200,at:oldAt}],[{players:{p:{uid:'p',stack:550,buyTotal:500}},gameState:{phase:'showdown'}}],options).players.p;
 assert.equal(inPlay.balance,300);assert.equal(inPlay.onTables,550);assert.equal(inPlay.chips,850);assert.equal(inPlay.totalResult,-150);assert.equal(inPlay.result,50);
 assert.equal(buildAccounting([{...m,balance:1200}],[{uid:'p',profit:200,at:now}],[],options).players.p.totalResult,200);
 const legacy=buildAccounting([m],[{uid:'p',profit:-200}],[],options).players.p;assert.equal(legacy.totalResult,-200,'legacy rows without a timestamp remain in total history');assert.equal(legacy.result,0,'undated legacy rows cannot be assigned to a current cycle');
});
