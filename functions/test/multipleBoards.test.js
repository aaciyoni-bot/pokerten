'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {maybeOfferRit,resolveRitIfDue,advancePhase,runShowdown}=require('../pokerEngine').__engineInternals;
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
