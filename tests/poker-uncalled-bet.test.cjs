'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../functions/pokerCore');
const E=require('../functions/pokerEngine').__engineInternals;
const card=(val,suit)=>({val,suit,id:val+suit});
const board=[card('8','♠'),card('7','♦'),card('A','♥'),card('7','♣'),card('3','♠')];
const good=[card('7','♥'),card('6','♦')],bad=[card('2','♣'),card('2','♦')];
function state(stacks=[202000,32000],tournament=false){
 const players=Object.fromEntries(stacks.map((stack,i)=>['u'+i,{uid:'u'+i,name:'Player '+i,seatIndex:i,stack,bet:0,buyTotal:stack,status:'active',cards:[],isBot:false}]));
 return {id:'uncalled-fixture',settings:{blinds:1500,baseGameType:'NLH',rakePercent:6},players,gameState:{phase:'waiting'},table:{clubId:'synthetic',handCount:0,history:[],...(tournament?{tournamentId:'synthetic-tour'}:{})},raw:{players:structuredClone(players)},priv:{},deck:null,now:1700000000000,effects:[]};
}
const visiblePot=S=>C.round2((S.gameState.pots||[]).reduce((n,p)=>n+p.amount,0)+Object.values(S.players).reduce((n,p)=>n+(p.bet||0),0));
const wealth=S=>C.round2(visiblePot(S)+Object.values(S.players).reduce((n,p)=>n+p.stack,0));

for(const tournament of [false,true])for(const heroWins of [false,true])test(`${tournament?'tournament':'cash'}: 202k shove versus 32k returns 170k before runout, larger stack ${heroWins?'wins':'loses'}`,()=>{
 const S=state(undefined,tournament);E.startHand(S);
 assert.equal(S.gameState.activeTurnUid,'u0');
 E.applyAction(S,'u0','raise',202000,false);
 assert.equal(S.players.u0.stack,0,'do not refund while the opponent still has a decision');
 assert.equal(S.players.u0.bet,202000);
 assert.equal(S.gameState.activeTurnUid,'u1');
 E.applyAction(S,'u1','call',undefined,false);
 assert.equal(S.players.u0.stack,170000);
 assert.equal(S.players.u0.bet,32000);
 assert.equal(S.players.u1.stack,0);
 assert.equal(S.gameState.highestBet,32000);
 assert.notEqual(S.players.u0.actionText,'All-in');
 assert.equal(S.gameState.allInReveal,true);
 assert.equal(S.gameState.activeTurnUid,null);
 assert.equal(visiblePot(S),64000);
 assert.equal(wealth(S),234000);
 for(let n=0;S.gameState.phase!=='river';n++){
  assert.ok(n<4);E.advancePhase(S);
  assert.equal(visiblePot(S),64000);assert.equal(S.players.u0.stack,170000);
  assert.equal(S.gameState.activeTurnUid,null,'returned chips must not reopen betting against an all-in player');
  assert.equal(wealth(S),234000);
 }
 assert.equal(S.gameState.pots.length,1,'no phantom side pot for the uncalled amount');
 S.gameState.board=board;S.priv={u0:heroWins?good:bad,u1:heroWins?bad:good};
 E.advancePhase(S);
 const rake=tournament?0:3840,award=64000-rake;
 assert.equal(S.table.history.at(-1).rake,rake);
 assert.equal(S.gameState.lastWinAmount,award);
 assert.deepEqual(S.gameState.lastAwards.map(a=>[a.uid,a.amount]),[[heroWins?'u0':'u1',award]]);
 assert.equal(S.players.u0.stack,170000+(heroWins?award:0));
 assert.equal(S.players.u1.stack,heroWins?0:award);
 assert.equal(C.round2(wealth(S)+rake),234000);
});

test('multiway: wait for every response and keep real main/side pots',()=>{
 const S=state([202000,70000,32000]);E.startHand(S);
 E.applyAction(S,'u0','raise',202000,false);
 E.applyAction(S,'u1','call',undefined,false);
 assert.equal(S.players.u0.stack,0);assert.equal(S.players.u0.bet,202000);
 assert.equal(S.gameState.activeTurnUid,'u2');
 E.applyAction(S,'u2','call',undefined,false);
 assert.equal(S.players.u0.stack,132000);assert.equal(visiblePot(S),172000);
 E.advancePhase(S);
 assert.deepEqual(S.gameState.pots.map(p=>p.amount),[96000,76000]);
 assert.deepEqual(S.gameState.pots.map(p=>[...p.eligible].sort()),[['u0','u1','u2'],['u0','u1']]);
 assert.equal(wealth(S),304000);
});

test('folded matching chips remain in the pot, while unmatched excess returns once',()=>{
 const g={highestBet:200,pots:[]},pl={a:{uid:'a',status:'active',stack:0,bet:200,actionText:'All-in'},b:{uid:'b',status:'active',stack:0,bet:32},c:{uid:'c',status:'folded',stack:50,bet:70}};
 assert.equal(C.returnUncalledBet(g,pl),130);
 assert.equal(C.returnUncalledBet(g,pl),0,'refund is idempotent');
 C.gatherBetsToPots(g,pl);
 assert.equal(pl.a.stack,130);assert.equal(pl.c.stack,50);
 assert.deepEqual(g.pots,[{amount:96,eligible:['b','a']},{amount:76,eligible:['a']}]);
});

test('equal all-ins create no refund; a gathered in-flight overbet is normalized',()=>{
 const g={highestBet:32,pots:[]},pl={a:{uid:'a',status:'active',stack:0,bet:32},b:{uid:'b',status:'active',stack:0,bet:32}};
 assert.equal(C.returnUncalledBet(g,pl),0);C.gatherBetsToPots(g,pl);
 assert.equal(g.pots[0].amount,64);assert.equal(pl.a.stack,0);
 pl.a.bet=100;pl.b.bet=20;g.highestBet=100;
 C.gatherBetsToPots(g,pl);
 assert.equal(pl.a.stack,80);assert.equal(g.pots.reduce((n,p)=>n+p.amount,0),104);
});

test('decimal bets conserve every cent through repeated gathering',()=>{
 for(let i=1;i<=200;i++){
  const g={pots:[]},pl={a:{uid:'a',status:'active',stack:0,bet:(i+701)/100},b:{uid:'b',status:'active',stack:0,bet:i/100}};
  C.gatherBetsToPots(g,pl);C.gatherBetsToPots(g,pl);
  assert.equal(pl.a.stack,7.01);assert.equal(g.pots[0].amount,C.round2(i*2/100));
 }
});

test('run-it-twice keeps the refund outside both board awards and rake',()=>{
 const S=state();E.startHand(S);E.applyAction(S,'u0','raise',202000,false);E.applyAction(S,'u1','call',undefined,false);
 C.gatherBetsToPots(S.gameState,S.players);
 Object.assign(S.gameState,{phase:'river',board,board2:board});S.priv={u0:bad,u1:good};
 E.runShowdown(S);
 assert.equal(S.players.u0.stack,170000);assert.equal(S.players.u1.stack,60160);
 assert.equal(S.table.history.at(-1).rake,3840);assert.equal(S.gameState.lastWinAmount,60160);
});

test('web and installed apps receive the corrected pot and stack in the public snapshot',async()=>{
 const admin=require('../functions/node_modules/firebase-admin');
 const app=admin.initializeApp({projectId:'demo-pokerten-uncalled-snapshot'});
 try{
  const S=state();E.startHand(S);E.applyAction(S,'u0','raise',202000,false);E.applyAction(S,'u1','call',undefined,false);
  const writes=[];
  const tx={set:(ref,data)=>writes.push({path:ref.path,data}),update:(ref,data)=>writes.push({path:ref.path,data}),delete:()=>assert.fail('no deletion expected'),get:()=>assert.fail('no network read expected')};
  const update=await E.commitState(tx,S);
  const persisted=writes.find(w=>w.path==='tables/'+S.id).data;
  for(const snapshot of [update,persisted]){
   assert.equal(visiblePot(snapshot),64000);
   assert.equal(snapshot.players.u0.stack,170000);
   assert.equal(snapshot.players.u1.stack,0);
   assert.equal(snapshot.gameState.allInReveal,true);
   assert.equal(snapshot.gameState.activeTurnUid,null);
  }
 }finally{await app.delete();}
});
