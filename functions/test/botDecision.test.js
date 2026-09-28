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
 // All six split the main pot, but only the two funded players contest
 // this street's new 50-chip side pot. A call returns 12.5 + 25 for 25.
 assert.ok(Math.abs(seeded(.5,()=>E.equityOf(s.priv.hero,s.gameState.board,5,'NLH',1))-1/6)<1e-12);
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'call');
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

test('a short stack prices only matched wagers and eligible pots',()=>{
 const s=state({hole:['7♣','2♦'],board:[],stack:10,pot:0,toCall:1000,opponents:1});
 s.players.p1.bet=1000;s.gameState.phase='preflop';
 assert.deepEqual(E.botCallPrice(s.gameState,s.players,s.players.hero),{cost:10,pot:10,odds:.5});
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'fold','An unmatched 1000-chip wager is not a cheap 1% call');
 s.gameState.pots=[{amount:60,eligible:['hero','p1']},{amount:500,eligible:['p1','out']}];
 assert.deepEqual(E.botCallPrice(s.gameState,s.players,s.players.hero),{cost:10,pot:70,odds:.125});
});
test('a live flush draw calls a well-priced all-in instead of demanding an arbitrary 45% equity',()=>{
 const s=state({hole:['7♠','6♠'],board:['K♠','8♠','2♥'],stack:20,pot:80,toCall:20,opponents:2});
 s.gameState.phase='flop';s.players.p1.bet=20;
 assert.ok(Math.abs(E.botCallPrice(s.gameState,s.players,s.players.hero).odds-1/6)<1e-12);
 for(const draw of [.1,.5,.9])assert.equal(seeded(draw,()=>E.botAction(s,'hero')).action,'call');
});
test('the same draw folds an expensive turn shove',()=>{
 const s=state({hole:['7♠','6♠'],board:['K♠','8♠','2♥','Q♦'],stack:100,pot:20,toCall:100,opponents:2});
 s.gameState.phase='turn';s.players.p1.bet=100;
 assert.ok(E.botCallPrice(s.gameState,s.players,s.players.hero).odds>.45);
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'fold');
});
test('money already invested does not justify a negative-value river call',()=>{
 const s=state({hole:['6♣','2♦'],board:['A♠','K♥','J♦','9♣','2♥'],stack:60,pot:45,toCall:55,opponents:2});
 s.players.p1.bet=55;
 assert.ok(E.botCallPrice(s.gameState,s.players,s.players.hero).odds>1/3);
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'fold','A weak pair cannot justify a bad call with money already committed');
});
test('short-stack Omaha premium raises respect the pot limit in the decision itself',()=>{
 const s=state({hole:['A♠','A♥','K♠','K♥'],board:[],game:'Omaha 4',stack:10,pot:0,toCall:1,opponents:2});
 s.gameState.phase='preflop';s.players.p1.bet=1;s.players.p2.bet=.5;
 const move=seeded(.95,()=>E.botAction(s,'hero'));
 assert.equal(move.action,'raise');assert.equal(move.amount,3.5);
});
test('a playable marginal hand opens on the button without copying that open in early position',()=>{
 const s=state({hole:['A♣','2♦'],board:[],stack:100,pot:0,toCall:1,opponents:5});
 s.gameState.phase='preflop';s.players.p1.bet=1;s.players.p2.bet=.5;
 s.gameState.dealerUid='hero';assert.equal(seeded(.2,()=>E.botAction(s,'hero')).action,'raise');
 s.gameState.dealerUid='p3';assert.equal(seeded(.2,()=>E.botAction(s,'hero')).action,'call');
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

test('private river nuts raise normal bets and tiny blocking bets instead of automatically paying',()=>{
 for(const {wager,pot} of [{wager:1,pot:1000},{wager:20,pot:100}])for(const r of [.01,.4,.8,.999]){
  const s=state({hole:['A♠','K♠'],board:['Q♠','J♠','10♠','2♥','3♦'],pot,stack:500,toCall:wager,opponents:1});
  s.players.p1.bet=wager;
  const action=seeded(r,()=>E.botAction(s,'hero'));
  assert.equal(action.action,'raise','Nuts should take river value even against a tiny blocking bet');
  assert.ok(action.amount>wager&&action.amount<=500);
 }
});
test('private river nuts only call when the bettor is already all-in',()=>{
 const s=state({hole:['A♠','K♠'],board:['Q♠','J♠','10♠','2♥','3♦'],pot:100,stack:500,toCall:20,opponents:1});
 s.players.p1.bet=20;s.players.p1.stack=0;
 assert.equal(seeded(.1,()=>E.botAction(s,'hero')).action,'call','There is no additional opponent stack to value-raise');
});
test('small pairs do not pay eight blinds to set-mine an opponent with only two blinds left',()=>{
 const s=state({hole:['2♣','2♦'],board:[],pot:0,stack:100,toCall:8,opponents:1});
 s.gameState.phase='preflop';s.players.p1.bet=8;s.players.p1.stack=2;
 for(const r of [.01,.5,.99])assert.equal(seeded(r,()=>E.botAction(s,'hero')).action,'fold');
});
test('a small pair can still set-mine a modest raise when effective stacks are deep',()=>{
 const s=state({hole:['2♣','2♦'],board:[],pot:0,stack:100,toCall:3,opponents:1});
 s.gameState.phase='preflop';s.players.p1.bet=3;s.players.p1.stack=97;
 assert.equal(seeded(.5,()=>E.botAction(s,'hero')).action,'call');
});

test('six-handed river call is valued separately for its small main pot and large heads-up side pot',()=>{
 const s=state({hole:['2♣','3♦'],board:['10♥','J♥','Q♥','K♥','A♥'],stack:100,pot:0,toCall:60,opponents:5});
 s.gameState.pots=[{amount:30,eligible:Object.keys(s.players)},{amount:100,eligible:['hero','p1']}];
 s.players.p1.bet=60;for(let i=2;i<=5;i++)s.players['p'+i].stack=0;
 const price=E.botCallPrice(s.gameState,s.players,s.players.hero,true),valuation={pots:price.equityPots};
 const equity=seeded(.5,()=>E.equityOf(s.priv.hero,s.gameState.board,5,'NLH',3,valuation));
 assert.ok(Math.abs(equity-1/6)<1e-12,'All six still contest the main pot');
 assert.deepEqual(price.equityPots,[{amount:30,opponents:[0,1,2,3,4]},{amount:100,opponents:[0]},{amount:120,opponents:[0]}]);
 assert.equal(price.cost,60);assert.equal(price.pot,190);
 assert.ok(Math.abs(valuation.callEquity*(price.pot+price.cost)-115)<1e-10,'Call receives 30/6 + (100+120)/2');
 for(const r of [.01,.5,.99])assert.equal(seeded(r,()=>E.botAction(s,'hero')).action,'call','Do not fold a guaranteed +55 call by charging the side pot for ineligible opponents');
});
test('projected current wagers preserve partial all-in tiers and pending players who can still match',()=>{
 const s=state({hole:['A♣','K♦'],board:[],stack:100,pot:0,toCall:60,opponents:3});
 s.players.p1.bet=60;s.players.p2.bet=10;s.players.p2.stack=0;s.players.p3.stack=100;
 const price=E.botCallPrice(s.gameState,s.players,s.players.hero,true);
 assert.deepEqual(price.equityPots,[{amount:30,opponents:[0,1,2]},{amount:100,opponents:[0,2]}]);
 assert.equal(price.equityPots.reduce((n,p)=>n+p.amount,0),price.pot+price.cost);
 s.gameState.pots=[{amount:1000,eligible:['p1','p2']}];
 assert.equal(E.botCallPrice(s.gameState,s.players,s.players.hero,true).equityPots.reduce((n,p)=>n+p.amount,0),130,'An ineligible settled pot is never counted');
});
