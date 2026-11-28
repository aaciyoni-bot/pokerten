'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {maybeOfferRit,resolveRitIfDue,advancePhase,runShowdown,tickMayAdvance,applyAction}=require('../pokerEngine').__engineInternals;
const card=(val,suit)=>({id:val+suit,val,suit});
const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const deck=['♠','♥','♦','♣'].flatMap(s=>ranks.map(v=>card(v,s)));
const players=()=>Object.fromEntries(['a','b','c'].map((uid,i)=>[uid,{uid,name:uid,seatIndex:i,status:'active',stack:0,bet:0,cards:[],cardCount:2}]));
function state(size){
 return {id:'sample',now:100000,settings:{runTwice:true,maxRuns:3,blinds:1},players:players(),effects:[],raw:{},table:{history:[],clubId:'test'},priv:{},deck:deck.slice(0,size),gameState:{phase:'preflop',currentGameType:'NLH',handN:1,board:[],allInReveal:true,pots:[]}};
}
test('three boards need unanimous consent, enough cards including burns, and eligible cash rules',()=>{
 for(const [size,runs] of [[15,null],[16,2],[23,2],[24,3]]){
  const s=state(size);maybeOfferRit(s);assert.equal(s.gameState.ritOffer?.runs??null,runs);
 }
 for(const configure of [s=>{s.table.tournamentId='event';},s=>{s.gameState.currentGameType='Omaha 7';}]){
  const s=state(40);configure(s);maybeOfferRit(s);assert.equal(s.gameState.ritOffer,undefined);
 }
 const no=state(24);maybeOfferRit(no);no.gameState.ritAgree={a:true,b:true,c:false};resolveRitIfDue(no);assert.equal(no.gameState.board2,undefined);
 const s=state(24);maybeOfferRit(s);s.gameState.ritAgree={a:true,b:true};assert.equal(resolveRitIfDue(s),false);
 s.gameState.ritAgree.c=true;assert.equal(resolveRitIfDue(s),true);
 for(let i=0;i<3;i++)advancePhase(s);
 const boards=[s.gameState.board,s.gameState.board2,s.gameState.board3];
 assert.deepEqual(boards.map(b=>b.length),[5,5,5]);assert.equal(new Set(boards.flat().map(c=>c.id)).size,15);assert.equal(s.deck.length,0);
});
test('each runout divides each side pot independently down to the last cent',()=>{
 const s=state(0);
 const vals=(v,suits)=>[...suits].map(suit=>card(v,suit));
 s.priv={a:vals('A','♠♥'),b:vals('K','♠♥'),c:vals('Q','♠♥')};
 const board=rank=>[card(rank,'♦'),card('2','♣'),card('5','♠'),card('8','♥'),card('J','♣')];
 Object.assign(s.gameState,{board:board('A'),board2:board('K'),board3:board('Q'),pots:[{amount:3.02,eligible:['a','b','c']},{amount:1.01,eligible:['b','c']}]});
 runShowdown(s);
 assert.deepEqual(Object.values(s.players).map(p=>p.stack),[1.01,1.69,1.33]);
 assert.equal(s.gameState.lastWinAmount,4.03);
});

test('tournament and spin tables discard a stale multiple-board offer',()=>{
 for(const configure of [s=>s.table.tournamentId='event',s=>s.tor={id:'event'},s=>s.settings.spinMode=true]){
  const s=state(30);
  configure(s);
  maybeOfferRit(s);
  assert.ok(!s.gameState.ritOffer);
  s.gameState.ritOffer={runs:2,until:s.now+8000};
  s.gameState.ritAgree={a:true,b:true,c:true};
  assert.equal(resolveRitIfDue(s),true);
  assert.ok(!s.gameState.board2);
 }
});
test('one decline ends voting immediately and missing votes expire to a single board',()=>{
 for(const vote of [false,true]){
  const s=state(24);
  maybeOfferRit(s);
  s.gameState.ritAgree.a=vote;
  assert.equal(resolveRitIfDue(s),!vote);
  if(vote){s.now+=8000;assert.equal(resolveRitIfDue(s),true);}
  assert.ok(!s.gameState.ritOffer);
  assert.ok(!s.gameState.board2);
 }
});
test('matched all-ins open the preflop board promptly and a live call is preserved',()=>{
 for(const coveringBet of [5,10]){
  const s=state(20);
  Object.assign(s.players.a,{stack:10});
  Object.assign(s.players.b,{stack:50,bet:coveringBet});
  Object.assign(s.players.c,{bet:10});
  Object.assign(s.gameState,{allInReveal:false,activeTurnUid:'a',highestBet:10});
  s.settings.runTwice=false;
  applyAction(s,'a','call',0,false);
  if(coveringBet<10){
   assert.equal(s.gameState.activeTurnUid,'b');
   applyAction(s,'b','call',0,false);
  }
  assert.equal(s.gameState.activeTurnUid,null);
  assert.ok(s.gameState.allInReveal);
  assert.equal(tickMayAdvance(s,s.now+649),false);
  assert.equal(tickMayAdvance(s,s.now+650),true);
  s.gameState.phase='flop';
  assert.equal(tickMayAdvance(s,s.now+1299),false);
  assert.equal(tickMayAdvance(s,s.now+1300),true);
 }
});
