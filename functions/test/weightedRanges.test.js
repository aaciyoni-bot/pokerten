'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../pokerRangeModel'),O=require('../pokerOpponentModel'),C=require('../pokerCore'),E=require('../pokerEngine').__engineInternals;
const cards=a=>a.map(id=>({id,val:id.slice(0,-1),suit:id.slice(-1)}));
const deck=C.SUITS.flatMap(suit=>C.CARD_VALUES.map(val=>({id:val+suit,val,suit})));
let seed=919;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const core={score:C.bestScoreFull,deck,preflop:E.preflopTier,discard:E.botDiscardIndex,random};
const flop=cards(['A♠','9♥','9♣']),board=[...flop,...cards(['6♦','3♠'])],hero=cards(['A♦','K♣']);
const history=[{uid:'v',street:'flop',board:flop,action:'bet',amount:15,potBefore:20},{uid:'v',street:'turn',board:board.slice(0,4),action:'bet',amount:45,potBefore:50},{uid:'v',street:'river',board,action:'bet',amount:150,potBefore:150,allIn:true}];
const build=events=>R.buildRange({uid:'v',hero,board,history:events,gameType:'NLH',holeCount:2},core);
test('every legal Holdem combo has a normalized posterior, with all public blockers removed',()=>{
 const range=build(history),known=new Set([...hero,...board].map(c=>c.id));assert.equal(range.combos.length,990);assert.ok(Math.abs(range.combos.reduce((n,c)=>n+c.weight,0)-1)<1e-10);
 for(const c of range.combos){assert.equal(c.hand.length,2);assert.equal(new Set(c.hand.map(c=>c.id)).size,2);assert.ok(c.hand.every(c=>!known.has(c.id)));assert.ok(c.weight>0);}
 const broad=build([]),mid=r=>r.combos.filter(c=>c.features.category==='bluff-catcher'||c.features.category==='thin value').reduce((n,c)=>n+c.weight,0);
 assert.ok(mid(range)<mid(broad)*.1,'Repeated large bets remove most medium-strength holdings');assert.ok(range.categories.find(c=>c.category==='strong value').percent>80);
});
test('Bayesian evidence and observed bluff samples change the posterior rather than a board exception',()=>{
 const tight=build(history),loose=R.buildRange({uid:'v',hero,board,history,gameType:'NLH',holeCount:2,model:{hands:150,bigShowdowns:40,bluffsShown:28}},core);
 const calc=range=>R.equity({hero,board,gameType:'NLH'},[range],core).equity;
 assert.ok(calc(tight)<.12);assert.ok(calc(loose)>calc(tight)+.2);
 assert.equal(R.modelRead({bigShowdowns:2,bluffsShown:2}).provenBluffer,false);assert.ok(R.modelRead({bigShowdowns:40,bluffsShown:28}).provenBluffer);
});
test('PLO6 uses weighted compatible particles and legal showdown evaluation',()=>{
 const h=cards(['A♠','K♠','Q♥','J♥','6♦','3♦']),b=cards(['2♠','8♠','K♦']);
 const ranges=['x','y'].map(uid=>R.buildRange({uid,hero:h,board:b,history:[{uid,street:'flop',board:b,action:'bet',amount:40,potBefore:50}],gameType:'Omaha 6',holeCount:6},core));
 const seen=new Set([...h,...b].map(c=>c.id));for(const r of ranges){assert.equal(r.exact,false);assert.ok(r.combos.every(c=>c.hand.every(x=>!seen.has(x.id))));assert.ok(new Set(r.combos.map(c=>c.weight.toFixed(8))).size>1);}
 const eq=R.equity({hero:h,board:b,gameType:'Omaha 6'},ranges,core);assert.ok(eq.equity>=0&&eq.equity<=1);assert.equal(eq.method,'weighted-monte-carlo');
});
test('opponent stats use public actions and exposed showdowns only, count c-bets and folds once',()=>{
 const S={players:{v:{uid:'v',cardCount:2,status:'active',stack:100,bet:0,cards:[]}},gameState:{phase:'preflop',handN:1,dealerUid:'v',currentGameType:'NLH'},publicModels:{}};
 Object.defineProperty(S,'priv',{get(){assert.fail('Model read hidden hands');}});Object.defineProperty(S,'deck',{get(){assert.fail('Model read undealt cards');}});
 O.start(S);S.players.v.bet=3;S.players.v.stack=97;O.action(S,'v',{street:'preflop',board:[],stack:100,bet:0,highestBet:1,call:1,pot:1.5});
 assert.equal(S.publicModels.v.vpip,1);assert.equal(S.publicModels.v.pfr,1);
 S.players.v.bet=20;O.action(S,'v',{street:'flop',board:flop,stack:97,bet:0,highestBet:0,call:0,pot:20});assert.equal(S.publicModels.v.cbet,1);assert.equal(S.publicModels.v.cbetOpportunities,1);
 S.players.v.bet=0;S.players.v.status='folded';O.action(S,'v',{street:'turn',board:board.slice(0,4),stack:77,bet:0,highestBet:20,call:20,pot:60});assert.equal(S.publicModels.v.foldToBet,1);
 S.gameState.phase='showdown';O.showdown(S);assert.equal(S.publicModels.v.bigShowdowns,0,'Mucked cards are not observations');
 S.players.v.cards=cards(['7♦','2♣']);S.players.v.mucked=false;O.showdown(S);O.showdown(S);assert.equal(S.publicModels.v.bigShowdowns,1);assert.equal(S.publicModels.v.bluffsShown,1);
});
test('mixed calls remain positive-price decisions and trace frequencies sum to one',()=>{
 const cases=require('../../scripts/bot-range-scenarios.cjs').scenarios;for(const c of cases){const ranges=c.history||[];assert.ok(ranges.every(e=>e.board));}
 const state={settings:{blinds:.5},players:{h:{uid:'h',isBot:true,botStyle:'balanced',status:'active',stack:300,bet:0},v:{uid:'v',status:'active',stack:300,bet:30}},priv:{h:cards(['Q♦','A♠'])},gameState:{phase:'river',board:cards(['Q♠','9♠','6♠','2♦','3♣']),highestBet:30,minRaise:1,handBB:1,currentGameType:'NLH',pots:[{amount:100}]}};
 E.botAction(state,'h');const d=state.botDecisionDebug;assert.ok(d&&d.ranges.length);assert.ok(Math.abs(Object.values(d.frequencies).reduce((a,b)=>a+b)-1)<1e-10);if(d.frequencies.call>0)assert.ok(d.callEquity>=d.requiredEquity);
 assert.ok(d.ranges.every(r=>Math.abs(r.categories.reduce((n,c)=>n+c.percent,0)-100)<.25));assert.doesNotMatch(JSON.stringify(d),/"cards"|"deck"|finalBoard/);
});
test('a close bluff-catcher actually mixes calls and folds across fixed seeds',()=>{
 const hero=cards(['6♦','A♣']),board=cards(['Q♠','9♥','6♣','2♦','3♣']),bet=45;
 const input={uid:'h',hero,board,gameType:'NLH',opponents:[{uid:'v',stack:200,bet,position:'early'}],history:[],price:{cost:bet,pot:145,odds:45/190},stack:200,pot:145,highestBet:bet};
 const moves={fold:0,call:0,raise:0};let trace;
 for(let i=0;i<100;i++){const r=R.decide(input,{...core,decisionRandom:(i+.5)/100});moves[r.action]++;trace=r.debug;}
 assert.ok(trace.callEquity>=trace.requiredEquity);assert.ok(moves.call>=60&&moves.call<=95);assert.ok(moves.fold>=5);assert.equal(moves.raise,0);
 assert.ok(Math.abs(moves.call/100-trace.frequencies.call)<.015);
});
