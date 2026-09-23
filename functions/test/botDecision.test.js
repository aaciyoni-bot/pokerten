'use strict';
// Actual exported server decisions/evaluator with deterministic public-card sampling.
// Run: node --test functions/test/botDecision.test.js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const C=require('../pokerCore');
const E=require('../pokerEngine').__engineInternals;
const card=id=>({id,val:id.slice(0,-1),suit:id.slice(-1)});
const cards=ids=>ids.map(card);
function seeded(first,run){
 const oldRandom=crypto.randomInt,oldDeck=C.pokerDeck;let count=0,state=1234;
 crypto.randomInt=(min,max)=>{const r=count++===0?first:((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);return min+Math.floor(r*(max-min));};
 C.pokerDeck=()=>C.SUITS.flatMap(suit=>C.CARD_VALUES.map(val=>({id:val+suit,val,suit})));
 try{return run();}finally{crypto.randomInt=oldRandom;C.pokerDeck=oldDeck;}
}
function state({hole,board,game='NLH',stack=100,pot=100,toCall=0,opponents=2}){
 const players={hero:{uid:'hero',name:'Hero',seatIndex:0,status:'active',isBot:true,botStyle:'balanced',stack,bet:0,cards:[],cardCount:hole.length,hasActed:false}};
 for(let i=1;i<=opponents;i++)players['p'+i]={uid:'p'+i,name:'Opponent '+i,seatIndex:i,status:'active',isBot:false,stack:1000,bet:0,cards:[],cardCount:hole.length,hasActed:false};
 return{settings:{blinds:.5,baseGameType:game,omahaPotLimit:true},players,priv:{hero:cards(hole)},gameState:{phase:'river',currentGameType:game,board:cards(board),handBB:1,highestBet:toCall,minRaise:1,pots:[{amount:pot}],activeTurnUid:'hero',dealerUid:'p1'},table:{clubId:'test'},raw:{},effects:[],now:123456};
}
const SCREEN_BOARD=['3♦','A♣','4♦','2♥','8♥'];
const DANA=['K♥','J♠','10♥','9♣','6♥','3♠'];
const dana=()=>state({hole:DANA,board:SCREEN_BOARD,game:'Omaha 6',stack:75.53,pot:106.5,opponents:2});
test('Dana screenshot: bottom pair does not become a random 59-chip multiway river bluff',()=>{
 for(const r of [.01,.05,.10,.30,.90]){
  const s=dana(),before=s.players.hero.stack;
  assert.equal(C.handName(C.bestScoreFull(s.priv.hero,s.gameState.board,'Omaha 6')),'Pair');
  const action=seeded(r,()=>E.botAction(s,'hero'));
  assert.equal(action.action,'call','check must be chosen when no bet is faced, random='+r);
  E.applyAction(s,'hero',action.action,action.amount,false);
  assert.equal(s.players.hero.actionText,'Check');
  assert.equal(s.players.hero.stack,before);
  assert.equal(s.players.hero.bet,0);
 }
});
test('multiway Holdem river air is checked without disabling heads-up bluffing',()=>{
 const settings={hole:['7♣','2♦'],board:['A♠','K♥','J♦','9♣','4♥'],stack:100,pot:50};
 const multi=state({...settings,opponents:2}),head=state({...settings,opponents:1});
 assert.equal(seeded(.05,()=>E.botAction(multi,'hero')).action,'call');
 assert.equal(seeded(.05,()=>E.botAction(head,'hero')).action,'raise');
});
test('private river royal flush value-bets against an opponent who can call, including old slowplay seeds',()=>{
 for(const r of [.001,.01,.04,.5,.99]){
  const s=state({hole:['A♠','K♠'],board:['Q♠','J♠','10♠','2♥','3♦'],pot:50,stack:100,opponents:1});
  const action=seeded(r,()=>E.botAction(s,'hero'));
  assert.equal(action.action,'raise','private nuts should value-bet on river, random='+r);
  assert.ok(action.amount>=1&&action.amount<=100);
  const before=Object.values(s.players).reduce((sum,p)=>sum+p.stack+p.bet,0);
  E.applyAction(s,'hero',action.action,action.amount,false);
  assert.equal(Object.values(s.players).reduce((sum,p)=>sum+p.stack+p.bet,0),before);
 }
});
test('an unbeatable board shared by everyone is checked, not treated as private nuts',()=>{
 const s=state({hole:['2♣','3♦'],board:['10♥','J♥','Q♥','K♥','A♥'],opponents:2});
 assert.equal(seeded(.01,()=>E.botAction(s,'hero')).action,'call');
});
test('river nuts cannot bet against opponents who are all already all-in',()=>{
 const s=state({hole:['A♠','K♠'],board:['Q♠','J♠','10♠','2♥','3♦'],opponents:2});
 s.players.p1.stack=0;s.players.p2.stack=0;
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'call');
});
test('all live opponents, including zero-stack all-ins, enter multiway equity',()=>{
 const s=state({hole:['2♣','3♦'],board:['10♥','J♥','Q♥','K♥','A♥'],stack:1000,pot:75,toCall:25,opponents:5});
 s.players.p1.bet=25;for(let i=2;i<=5;i++)s.players['p'+i].stack=0;
 assert.equal(E.activesOf(s.players).length,6);
 // A guaranteed sixth-share is below 25/(100+25). The old three-opponent
 // cap incorrectly estimated a quarter-share and called this price.
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'fold');
});
test('Ben screenshot has a wheel; the opposing 6-high straight is stronger',()=>{
 const board=cards(SCREEN_BOARD);
 const ben=cards(['A♦','10♦','7♠','5♣','4♠','2♣']);
 const men=cards(['J♥','6♠','5♦','4♣','3♣','2♦']);
 const benScore=C.bestScoreFull(ben,board,'Omaha 6'),menScore=C.bestScoreFull(men,board,'Omaha 6');
 assert.equal(benScore,4050000);assert.equal(menScore,4060000);
 assert.equal(C.handName(benScore),'Straight');assert.ok(menScore>benScore);
});
test('real-player private cards and unrevealed deck are never consulted by bot policy',()=>{
 const s=dana();
 for(const uid of ['p1','p2'])Object.defineProperty(s.priv,uid,{get(){assert.fail('Opponent hidden cards were read');}});
 Object.defineProperty(s,'deck',{get(){assert.fail('Future deck was read');}});
 assert.equal(seeded(.05,()=>E.botAction(s,'hero')).action,'call');
});

test('multiway flop air without a straight or flush draw checks across random seeds',()=>{
 for(const r of [.01,.05,.5,.9]){
  const s=state({hole:['7♣','2♦'],board:['A♠','K♥','9♦'],pot:50,opponents:2});s.gameState.phase='flop';
  assert.equal(C.handName(C.bestScoreFull(s.priv.hero,s.gameState.board,'NLH')),'High Card');
  assert.equal(seeded(r,()=>E.botAction(s,'hero')).action,'call');
 }
});
test('live nut-flush and open-ended straight draws retain multiway semi-bluffs',()=>{
 for(const setup of [
  {hole:['A♠','K♠'],board:['Q♠','8♠','2♥']},
  {hole:['J♣','10♦'],board:['9♠','8♥','2♦']}
 ]){
  const s=state({...setup,pot:50,stack:100,opponents:2});s.gameState.phase='flop';
  assert.equal(C.handName(C.bestScoreFull(s.priv.hero,s.gameState.board,'NLH')),'High Card');
  const action=seeded(.05,()=>E.botAction(s,'hero'));
  assert.equal(action.action,'raise','A real live draw may semi-bluff');
  assert.ok(action.amount>0&&action.amount<=100);
 }
});

