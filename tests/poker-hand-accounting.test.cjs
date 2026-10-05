'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../functions/pokerEngine').__engineInternals;
const C=require('../functions/pokerCore');
function state(stacks=[100,100,100],settings={}){
 const players=Object.fromEntries(stacks.map((stack,i)=>['u'+i,{uid:'u'+i,name:'Player '+i,seatIndex:i,stack,bet:0,buyTotal:stack,status:'active',cards:[],isBot:false}]));
 return{id:'accounting-fixture',settings:{blinds:1,baseGameType:'NLH',rakePercent:0,...settings},players,gameState:{phase:'waiting'},table:{clubId:'synthetic-accounting',handCount:0,history:[]},raw:{players:structuredClone(players)},priv:{},deck:null,now:1700000000000,effects:[]};
}
for(const [label,stacks,settings,ante] of [
 ['normal ante',[40,70,90],{ante:2},2],
 ['partial ante',[.35,70,90],{ante:2},2],
 ['bomb ante',[.35,70,90],{ante:1,bombEvery:1,bombAnte:3},6],
 ['no ante',[40,70,90],{},0],
])test(`hand accounting captures opening funds before ${label}`,()=>{
 const S=state(stacks,settings);assert.equal(E.startHand(S),'dealt');
 assert.deepEqual(S.gameState.handStartWealth,Object.fromEntries(stacks.map((stack,i)=>['u'+i,stack])));
 for(let i=0;i<stacks.length;i++)assert.equal(S.gameState.handStartStacks['u'+i],C.round2(Math.max(0,stacks[i]-ante)),'existing cash handStartStacks semantics remain post-ante');
 const held=Object.values(S.players).reduce((sum,p)=>sum+p.stack+(p.bet||0),0)+(S.gameState.pots||[]).reduce((sum,p)=>sum+p.amount,0);
 assert.equal(C.round2(held),C.round2(stacks.reduce((sum,n)=>sum+n,0)),'recording accounting metadata cannot create or consume chips');
});
test('opening funds stay stable through betting, folding and a queued top-up',()=>{
 const S=state([100,100,100],{ante:2});E.startHand(S);const opening=structuredClone(S.gameState.handStartWealth);
 E.applyAction(S,S.gameState.activeTurnUid,'raise',12,false);
 const folded=S.gameState.activeTurnUid;E.applyAction(S,folded,'fold',undefined,false);
 const called=S.gameState.activeTurnUid;E.applyAction(S,called,'call',undefined,false);
 assert.equal(S.gameState.phase,'flop');assert.equal(S.players[folded].status,'folded');
 S.players[called].pendingTopUp=25;S.players[called].buyTotal+=25;
 assert.deepEqual(S.gameState.handStartWealth,opening);
 assert.equal(S.gameState.handStartWealth[called]+S.players[called].pendingTopUp-S.players[called].buyTotal,0,'queued funding is not a playing profit');
 assert.equal(S.gameState.handStartWealth[folded]-S.players[folded].buyTotal,0,'unfinished hands are held until the pot is awarded');
});
test('the authoritative public commit keeps opening funds and leaves cards and deck private',async()=>{
 // Real Firestore references, fake transaction writes: this test performs no RPC.
 const admin=require('../functions/node_modules/firebase-admin');const app=admin.initializeApp({projectId:'demo-pokerten-accounting-snapshot'});
 try{
  const S=state([40,70,90],{ante:2});E.startHand(S);const writes=[];
  const tx={set:(ref,data)=>writes.push({path:ref.path,data}),update:(ref,data)=>writes.push({path:ref.path,data}),delete:()=>assert.fail('a deal must not delete documents'),get:()=>assert.fail('this pure snapshot test must not read Firestore')};
  const update=await E.commitState(tx,S);
  const table=writes.find(w=>w.path==='tables/'+S.id).data;
  assert.deepEqual(update.gameState.handStartWealth,{u0:40,u1:70,u2:90});assert.deepEqual(table.gameState.handStartWealth,update.gameState.handStartWealth);
  assert.equal('deck' in update,false);assert.equal('priv' in update,false);assert.ok(Object.values(update.players).every(p=>p.cards.length===0));
  assert.ok(writes.some(w=>w.path===`tables/${S.id}/priv/_engine`&&Array.isArray(w.data.deck)));
  for(const uid of Object.keys(S.players))assert.equal(writes.find(w=>w.path===`tables/${S.id}/priv/${uid}`).data.cards.length,2);
 }finally{await app.delete();}
});
