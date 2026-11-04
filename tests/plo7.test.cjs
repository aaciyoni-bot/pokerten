'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../functions/pokerCore'),E=require('../functions/pokerEngine').__engineInternals;
const card=text=>({id:text,val:text.slice(0,-1),suit:text.slice(-1)}),cards=text=>text.split(' ').map(card);
function state(n=5){return{id:'plo7',settings:{baseGameType:'Omaha 7',maxPlayers:n,blinds:.5,rakePercent:0,omahaPotLimit:false,runTwice:true},players:Object.fromEntries(Array.from({length:n},(_,i)=>['u'+i,{uid:'u'+i,name:'P'+i,seatIndex:i,stack:100,bet:0,buyTotal:100,status:'active',cards:[],isBot:false}])),gameState:{phase:'waiting'},table:{clubId:'test',handCount:0,history:[]},raw:{},priv:{},deck:null,now:1700000000000,effects:[]};}
const total=s=>C.round2(Object.values(s.players).reduce((n,p)=>n+p.stack+p.bet,0)+(s.gameState.pots||[]).reduce((n,p)=>n+p.amount,0));
test('PLO7 deals five distinct seven-card private hands, completes a full board, and conserves chips',()=>{
 const s=state();E.startHand(s);assert.equal(Object.values(s.priv).flat().length,35);assert.equal(new Set(Object.values(s.priv).flat().map(c=>c.id)).size,35);assert.equal(s.deck.length,17);
 for(const p of Object.values(s.players)){assert.equal(p.cardCount,7);assert.equal(p.cards.length,0);}
 let guard=0;while(s.gameState.phase!=='showdown'&&guard++<60)E.applyAction(s,s.gameState.activeTurnUid,'call',undefined,false);
 assert.equal(s.gameState.phase,'showdown');assert.equal(s.gameState.board.length,5);assert.equal(new Set([...Object.values(s.priv).flat(),...s.gameState.board].map(c=>c.id)).size,40);
 assert.equal(s.deck.length,9);assert.equal(total(s),500);assert.equal(s.table.history[0].game,'Omaha 7');
});
test('PLO7 enforces Pot Limit even when selected from a No Limit DC table',()=>{
 const s=state();E.startHand(s);const actor=s.gameState.activeTurnUid;E.applyAction(s,actor,'raise',100,false);assert.equal(s.players[actor].bet,3.5);assert.equal(total(s),500);
});
test('PLO7 rejects six-seat DC before touching the deck or player money',()=>{
 const s=state(6),before=structuredClone(s);assert.equal(C.gameFitsTable('Omaha 7',s.settings,3),false);assert.throws(()=>E.executeDeal(s,'Omaha 7'),/at most 5 seats/);assert.deepEqual(s,before);
 assert.equal(C.gameFitsTable('Omaha 7',{maxPlayers:5},6),false);assert.equal(C.gameFitsTable('Omaha 7',{maxPlayers:5},5),true);
 assert.equal(C.gameFitsTable('Omaha 6',{maxPlayers:7},7),true);
});
test('PLO7 keeps one board during all-in runout, including two-handed tables',()=>{
 for(const seats of [2,5]){const s=state(seats);for(const p of Object.values(s.players)){p.stack=1;p.buyTotal=1;}E.startHand(s);let guard=0;
 while(!s.gameState.allInReveal&&s.gameState.activeTurnUid&&guard++<20)E.applyAction(s,s.gameState.activeTurnUid,'call',undefined,false);
 assert.equal(s.gameState.ritOffer,null);while(s.gameState.phase!=='showdown'&&guard++<35)E.advancePhase(s);assert.equal(s.gameState.board.length,5);assert.equal(s.gameState.board2,null);assert.equal(total(s),seats);}
});
test('PLO7 does not use a single suited hole card or all five board cards',()=>{
 const hole=cards('A♠ K♥ Q♥ J♦ 9♣ 8♥ 2♣'),board=cards('K♠ Q♠ J♠ 10♠ 3♠');assert.ok(C.bestScoreFull(hole,board,'Omaha 7')<5000000);
 const seventh=cards('2♥ 3♥ 4♦ 5♦ 6♣ A♠ K♠');assert.equal(C.handName(C.bestScoreFull(seventh,board,'Omaha 7')),'Straight Flush');
});

test('five-handed PLO7 bots retain weighted decisions with seven-card conditional ranges',()=>{
 const R=require('../functions/pokerRangeModel');let seed=722;
 const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const deck=C.SUITS.flatMap(suit=>C.CARD_VALUES.map(val=>({id:val+suit,val,suit})));
 const hero=cards('A♠ K♠ Q♥ J♦ 9♣ 8♥ 2♣'),board=cards('Q♠ 7♠ Q♦ 3♠ 6♥');
 const core={score:C.bestScoreFull,deck,preflop:E.preflopTier,discard:E.botDiscardIndex,random};
 const ranges=Array.from({length:4},(_,i)=>R.buildRange({uid:'v'+i,hero,board,history:[],gameType:'Omaha 7',holeCount:7},core));
 for(const range of ranges)assert.ok(range.combos.every(c=>c.hand.length===7&&new Set(c.hand.map(c=>c.id)).size===7));
 // Force the sparse-particle condition deterministically. Conditional sampling
 // must preserve weights, exclusions and all 90 complete simulated deals.
 const known=new Set([...hero,...board].map(c=>c.id));let conditionalCalls=0;
 for(const range of ranges){const original=range.conditional;range.conditional=used=>{conditionalCalls++;const r=original(used);for(const c of r.combos)assert.ok(c.hand.every(x=>!used.has(x.id)));return r;};}
 const result=R.equity({hero,board,gameType:'Omaha 7'},ranges,core);assert.equal(result.samples,90);assert.ok(conditionalCalls>0);assert.ok(result.equity>=0&&result.equity<=1);assert.ok(result.callEquity>=0&&result.callEquity<=1);
 const s=state();s.gameState={phase:'river',currentGameType:'Omaha 7',board,pots:[{amount:20}],highestBet:0,minRaise:1,handBB:1,dealerUid:'u0'};s.priv={u0:hero};
 for(const uid of Object.keys(s.players).slice(1))Object.defineProperty(s.priv,uid,{get(){assert.fail('Read hidden opponent cards');}});
 Object.defineProperty(s,'deck',{get(){assert.fail('Read future deck');}});
 const start=performance.now(),move=E.botAction(s,'u0');assert.ok(['call','fold','raise'].includes(move.action));assert.notEqual(s.botDecisionDebug.reason,'range-unavailable');assert.equal(s.botDecisionDebug.samples,90);assert.equal(s.botDecisionDebug.ranges.length,4);console.log('PLO7 five-seat river decision:',Math.round(performance.now()-start),'ms');
});
