'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../functions/pokerEngine').__engineInternals;
function state(n){return{id:'runout',settings:{blinds:.5,baseGameType:'Omaha 6',omahaPotLimit:false,runTwice:true,rakePercent:0,maxPlayers:n},players:Object.fromEntries(Array.from({length:n},(_,i)=>['u'+i,{uid:'u'+i,name:'P'+i,seatIndex:i,stack:100,bet:0,buyTotal:100,status:'active',cards:[],isBot:false}])),gameState:{phase:'waiting'},table:{clubId:'test',handCount:0,history:[]},raw:{},priv:{},deck:null,now:1700000000000,effects:[]};}
for(const seats of [6,7])test(`Omaha 6 with ${seats} players never offers more runout cards than remain`,()=>{
 const S=state(seats);E.startHand(S);E.applyAction(S,S.gameState.activeTurnUid,'raise',100,false);
 let guard=0;while(S.gameState.activeTurnUid&&guard++<10)E.applyAction(S,S.gameState.activeTurnUid,'call',undefined,false);
 assert.equal(S.gameState.allInReveal,true);
 assert.equal(!!S.gameState.ritOffer,seats===6,'two full boards need 16 remaining cards');
 if(seats===6){S.gameState.board2=[];S.gameState.ritOffer=null;}
 while(S.gameState.phase!=='showdown'&&guard++<20)E.advancePhase(S);
 assert.equal(S.gameState.phase,'showdown');
 assert.equal(S.gameState.board.length,5);assert.ok(S.gameState.board.every(Boolean));
 if(seats===6){assert.equal(S.gameState.board2.length,5);assert.ok(S.gameState.board2.every(Boolean));}
 assert.equal(Object.values(S.players).reduce((n,p)=>n+p.stack,0),seats*100);
});
