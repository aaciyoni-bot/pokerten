'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../functions/settlementPeriod'),{buildAccounting,ownAccounting}=require('../functions/pokerAccounting'),{buildLegacy,projectLegacy}=require('../functions/legacySettlement');
const before=Date.parse('2026-10-04T20:59:59Z'),after=Date.parse('2026-10-05T03:00:00Z');
const startAt=Date.parse('2026-09-30T09:15:00Z');
const confirmed={startAt,source:'manager-confirmed',confirmedAt:Date.parse('2026-10-02T10:00:00Z'),confirmedBy:'fixture_manager'};
const members=[{uid:'a',status:'approved',role:'player',agentUid:'manager',balance:713.42},{uid:'manager',status:'approved',role:'agent',balance:0}];
const games=[{uid:'a',profit:-86.58,rake:3,at:Date.parse('2026-10-03T10:00:00Z')}];
test('confirmed legacy boundary and result survive Monday and arbitrary elapsed time',()=>{
 for(const now of [before,after,after+21*86400000]){
  const cycle=P.legacyPeriod(confirmed,now),r=buildAccounting(members,games,[],{now,cycle,god:true});
  assert.equal(cycle.startAt,startAt);assert.equal(cycle.endAt,null);assert.equal(cycle.autoClose,false);assert.equal(r.needsPeriodStart,false);assert.equal(r.players.a.result,-86.58);assert.equal(r.players.a.rake,3);assert.equal(r.players.a.chips,713.42);
 }
});
test('missing or unverified anchors never guess a Monday, fabricate zero, or hide existing funds',()=>{
 for(const raw of [null,{startAt},{...confirmed,source:'inferred'},{...confirmed,confirmedBy:''},{...confirmed,confirmedAt:after+1}]){
  const cycle=P.legacyPeriod(raw,after),r=buildAccounting(members,games,[],{now:after,cycle,god:true});
  assert.equal(cycle.startAt,null);assert.equal(r.players.a.result,null);assert.equal(r.players.a.rake,null);assert.equal(r.agents.manager.result,null);assert.equal(r.club.result,null);assert.equal(r.players.a.chips,713.42);assert.equal(r.players.a.totalResult,-86.58);
  const full=buildLegacy(members,games,[],[],{now:after,period:cycle});assert.equal(full.club.toClub,null);assert.equal(full.agents[0].commission,null);
  const own=projectLegacy(full,{uid:'a',role:'player'});assert.equal(own.totals.result,null);assert.doesNotMatch(JSON.stringify(own),/rake|commission|totalResult/);
 }
 const fallback=buildAccounting(members,games,[],{now:after});assert.equal(fallback.start,null);assert.equal(fallback.needsPeriodStart,true);assert.equal(ownAccounting(fallback,'a').players.a.result,null);
});
test('historical ranges use inclusive From and exclusive To without adding current table profit',()=>{
 const range=P.dateRange(startAt,startAt+86400000,after),atStart={uid:'a',profit:12,rake:1,at:startAt},atEnd={uid:'a',profit:999,rake:8,at:startAt+86400000};
 const tables=[{players:{a:{uid:'a',stack:75,buyTotal:50}},gameState:{phase:'showdown'}}];
 const full=buildLegacy(members,[atStart,atEnd],tables,[{agentUid:'manager',amount:.5,rakeSource:'human',accountingVersion:2,at:startAt}],{now:after,period:range});
 assert.equal(full.players[0].result,1200);assert.equal(full.players[0].chips,78842);assert.equal(full.players[0].totalResult,103600);assert.equal(full.agents[0].commission,50);assert.equal(full.basis,'historical-recorded-sessions');
 assert.equal(P.inPeriod(startAt,range,after),true);assert.equal(P.inPeriod(startAt+86400000,range,after),false);
 for(const pair of [[null,startAt],[startAt,startAt],[startAt+1,startAt],['1',startAt],[after+1,after+100]])assert.throws(()=>P.dateRange(...pair,after),RangeError);
});
