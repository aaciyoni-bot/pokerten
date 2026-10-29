'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {archiveReason,RETIRED_AT}=require('../functions/pokerLegacyTables');
const {buildAccounting}=require('../functions/pokerAccounting');
const now=Date.UTC(2026,9,29),old=RETIRED_AT-2*86400000;
const bot='bot_1788994187349_ev73mw';
const table=()=>({type:'poker',clubId:'club',createdAt:old,settings:{serverEngine:true,spinMode:true},spin:{prize:100},players:{[bot]:{uid:bot,isBot:true,stack:19440,bet:0}},gameState:{phase:'showdown',showdownAt:old,pots:[],activeTurnUid:null}});
test('retired synthetic Spin winner and heartbeat remnants are archived without a payout',()=>{
 const t=table();assert.equal(archiveReason(t,now),'retired-unfunded-bots');
 t.players.human={lastSeen:old};assert.equal(archiveReason(t,now),'retired-unfunded-bots');
 delete t.players[bot];t.spinDone=true;t.players.human={lastSeen:old,cards:[],cardCount:0,bet:0,actionText:'',hasActed:false,reveal:false,status:'sitout'};
 assert.equal(archiveReason(t,now),'retired-empty-seats');
});
test('synthetic cash hand with bot-only pots is safe; a real pot claimant is not',()=>{
 const t=table();t.settings.spinMode=false;t.players[bot].bet=2;t.players[bot].buyTotal=500;t.gameState={phase:'flop',turnStartedAt:old,pots:[{amount:3,eligible:[bot]}],activeTurnUid:bot};
 assert.equal(archiveReason(t,now),'retired-unfunded-bots');
 t.gameState.pots[0].eligible.push('human');assert.equal(archiveReason(t,now),null);
});
test('real seats, funded bots, new protocols, pending deposits and recent activity stay blocked',()=>{
 const changes=[t=>t.players.human={uid:'human',stack:10},t=>t.players.human={lastSeen:old,stack:0},t=>t.players[bot].fundingUid='sponsor',t=>t.players[bot].spinPaid=50,t=>t.players[bot].pendingTopUp=10,t=>t.authorityVersion=2,t=>t.authorityVersion=3,t=>t.tournamentId='event',t=>t.createdAt=now,t=>t.gameState.turnStartedAt=now,t=>t.players[bot].lastSeen=now,t=>t.gameState.handStartStacks={human:100},t=>t.players[bot].isBot=false,t=>t.players[bot].uid='human',t=>t.pot=2,t=>t.gameState.pots=[{amount:2,eligible:[]}],t=>t.spin.fundingPending=false,t=>t.history={},t=>t.gameState.highestBet='bad'];
 for(const mutate of changes){const t=table();mutate(t);assert.equal(archiveReason(t,now),null,mutate.toString());}
 const ended=table();ended.gameState.phase='done';ended.players.human={uid:'human',stack:10};assert.equal(archiveReason(ended,now),null,'terminal label cannot hide an unpaid player');
});
test('archiving retired tables leaves all player accounting and historical cash-outs unchanged',()=>{
 const t=table();t.settings.spinMode=false;t.leftStacks={human:{amount:274.71,at:old}};t.players.human={lastSeen:old};
 const members=[{uid:'human',status:'approved',username:'Player',balance:1000}],logs=[{uid:'human',profit:74.71,rake:2,at:old}],opts={now,god:true,cycle:{id:'old',legacy:true,status:'open',startAt:old-1}};
 assert.ok(archiveReason(t,now));assert.deepEqual(buildAccounting(members,logs,[t],opts),buildAccounting(members,logs,[],opts));
});
