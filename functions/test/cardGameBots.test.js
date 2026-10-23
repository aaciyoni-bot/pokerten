'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../cardGamesCore'),B=require('../cardGameBots');
const card=(v,suit)=>({id:v+suit,v,suit});
function durak(cards){return{turnUid:'bot',defenderUid:'bot',trumpSuit:'♠',deckCount:20,settings:{variant:'classic',deckSize:36},roundCap:6,pairs:[{a:card(7,'♥'),d:null,by:'other'}],players:{bot:{uid:'bot',seatIndex:0,cards,cardCount:cards.length},other:{uid:'other',seatIndex:1,cards:[],cardCount:4}}};}
test('Durak preserves trumps, weighs taking, transfers and attacks repeated ranks',()=>{
 let t=durak([card(14,'♠'),card(9,'♥'),card(6,'♦')]);assert.equal(B.durakMove(t).cardId,'9♥');
 t=durak([card(13,'♠'),card(6,'♦')]);assert.equal(B.durakMove(t).op,'take');t.deckCount=0;assert.equal(B.durakMove(t).cardId,'13♠');
 t=durak([card(7,'♦'),card(9,'♥')]);t.settings.variant='perevodnoy';assert.equal(B.durakMove(t).cardId,'7♦');
 t=durak([card(6,'♥'),card(7,'♦'),card(7,'♣')]);t.defenderUid='other';t.pairs=[];assert.equal(B.durakMove(t).cardId,'7♦');
});
test('Durak covers the complete attack and does not waste a card on an impossible defense',()=>{
 const t=durak([card(8,'♥'),card(14,'♠')]);t.pairs.push({a:card(13,'♠'),d:null,by:'other'});assert.equal(B.durakMove(t).cardId,'8♥');
 t.pairs[1].a=card(14,'♠');assert.equal(B.durakMove(t).op,'take');
});
function ofc(p,street=4){return{type:'ofc',turnUid:'bot',street,players:{bot:{uid:'bot',flC:0,top:[],mid:[],bot:[],pending:[],disc:[],...p}}};}
const apply=(p,stage)=>{const out=C.clone(p);for(const [id,row]of Object.entries(stage))out[row].push(p.pending.find(c=>c.id===id));return out;};
test('OFC avoids a tempting third queen on top to preserve a legal royalty-paying board',()=>{
 const t=ofc({top:[card(12,'♠'),card(12,'♥')],mid:[card(13,'♠'),card(13,'♥'),card(9,'♣'),card(8,'♦')],bot:[card(14,'♠'),card(14,'♥'),card(7,'♠'),card(6,'♠'),card(5,'♦')],pending:[card(2,'♣'),card(12,'♦'),card(3,'♥')]});
 const stage=B.ofcMove(t),board=C.ofcBoard(apply(t.players.bot,stage));assert.equal(Object.keys(stage).length,2);assert.notEqual(stage['12♦'],'top');assert.equal(board.foul,false);assert.equal(board.flNext,14);assert.equal(board.roy,7);
});
test('Fantasyland searches three rows, discards the surplus and earns royalties legally',()=>{
 const pending=[[14,'♠'],[14,'♥'],[14,'♦'],[2,'♠'],[2,'♥'],[13,'♠'],[13,'♥'],[13,'♦'],[11,'♣'],[9,'♠'],[12,'♠'],[12,'♥'],[3,'♣'],[4,'♣']].map(([v,s])=>card(v,s));
 const t=ofc({flC:14,pending},0),stage=B.ofcMove(t),p=apply(t.players.bot,stage),board=C.ofcBoard(p);assert.equal(Object.keys(stage).length,13);assert.deepEqual([p.top.length,p.mid.length,p.bot.length],[3,5,5]);assert.equal(board.foul,false);assert.ok(board.roy>=7);
});
function sample(seed){
 const t=C.newTable('ofc',{buyIn:100,stake:5,rakePercent:6,maxPlayers:2},'a','club',0);for(const [i,uid]of ['a','b'].entries())t.players[uid]={uid,name:uid,seatIndex:i,stack:100,isBot:true,flNext:0,cards:[],top:[],mid:[],bot:[],pending:[],disc:[]};C.begin(t,0);
 const deck=[];let i=0;for(const suit of ['♠','♥','♦','♣'])for(let v=2;v<=14;v++)deck.push({id:'o'+i++,suit,v});deck.push({id:'oj1',v:0,suit:'🃏'},{id:'oj2',v:0,suit:'🃏'});
 let n=seed;for(let k=deck.length-1;k>0;k--){n=(Math.imul(n,1664525)+1013904223)>>>0;const j=n%(k+1);[deck[k],deck[j]]=[deck[j],deck[k]];}t.players.a.pending=deck.splice(0,5);t.deck=deck;return t;
}
test('Bot decisions cannot use GOD data, hidden cards or deck order',()=>{
 const a=sample(23),b=C.clone(a);b.deck.reverse();b.players.b.pending=[card(14,'♥')];b.players.b.disc=[card(13,'♥')];
 const av=C.botView(a,'a'),bv=C.botView(b,'a'); // Opponent pending count is public, values are not.
 bv.players.b.pending=av.players.b.pending;assert.deepEqual(av,bv);assert.deepEqual(B.ofcMove(av),B.ofcMove(bv));
 const d=durak([card(6,'♥')]);d.pairs=[{a:{id:'blind-0',hidden:true},blind:true,by:'other'},{a:card(7,'♣'),d:card(8,'♣')}];assert.deepEqual(B.durakMove(d),{op:'accept'});
});
test('Seeded OFC decisions reduce fouls versus the former fill-bottom-first policy',()=>{
 let smart=0,naive=0,smartRoyal=0,naiveRoyal=0;
 for(let seed=1;seed<=12;seed++)for(const policy of ['smart','naive']){
  const t=sample(seed);while(t.status==='playing'){
   if(policy==='smart')C.autoMove(t,1000);
   else{const p=t.players[t.turnUid],cap={top:3-p.top.length,mid:5-p.mid.length,bot:5-p.bot.length},stage={};for(const c of [...p.pending].sort((a,b)=>(b.v||15)-(a.v||15)).slice(0,t.street?2:5)){const row=['bot','mid','top'].find(r=>cap[r]>0);stage[c.id]=row;cap[row]--;}C.ofcAction(t,p.uid,stage,1000);}
  }
  for(const r of t.lastResults.rows){if(policy==='smart'){smart+=!r.foul;smartRoyal+=r.roy;}else{naive+=!r.foul;naiveRoyal+=r.roy;}}
 }
 assert.ok(smart>naive,`legal boards: smart=${smart}, former=${naive}`);assert.ok(smartRoyal>naiveRoyal,`royalties: smart=${smartRoyal}, former=${naiveRoyal}`);
 console.log(`OFC fixed-deal comparison: legal ${smart}/24 vs ${naive}/24; royalties ${smartRoyal} vs ${naiveRoyal}`);
});
