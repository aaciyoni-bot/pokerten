'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../cardGamesCore');
function table(type,n,settings={}){const t=C.newTable(type,{buyIn:100,stake:5,rakePercent:6,maxPlayers:n,deckSize:36,variant:'classic',...settings},'u0','club',0);for(let i=0;i<n;i++)t.players['u'+i]={uid:'u'+i,name:'P'+i,seatIndex:i,stack:100,isBot:true,left:false,cards:[],top:[],mid:[],bot:[],pending:[],disc:[]};return t;}
const allDurak=t=>[...t.deck,...Object.values(t.players).flatMap(p=>p.cards),...t.pairs.flatMap(p=>[p.a,...p.d?[p.d]:[]])];
test('Durak completes 2–6 player classic/transfer games and conserves every cent and card',()=>{
 for(const variant of ['classic','perevodnoy'])for(const deckSize of [36,52])for(let n=2;n<=6;n++)for(let trial=0;trial<4;trial++){
  const t=table('durak',n,{variant,deckSize,buyIn:100.03});C.begin(t,1000);let turns=0;
  while(t.status==='playing'&&turns++<3000){const cards=allDurak(t);assert.equal(cards.length+t.discard,deckSize);assert.equal(new Set(cards.map(c=>c.id)).size,cards.length);C.autoMove(t,1000+turns*1000);}
  assert.equal(t.status,'showdown',`${variant}, ${deckSize}, ${n}: did not finish`);
  assert.equal(Math.round((Object.values(t.settlement.awards).reduce((n,v)=>n+v,0)+t.settlement.rake)*100),Math.round(n*100.03*100));
  assert.equal(Math.abs(Math.round((Object.values(t.settlement.profits).reduce((n,v)=>n+v,0)+t.settlement.rake)*100)),0);
 }
});
test('OFC completes normal/fantasy hands, validates placement and conserves stack+rake',()=>{
 for(let n=2;n<=3;n++)for(let trial=0;trial<30;trial++){
  const t=table('ofc',n);if(trial%2===0)t.players.u0.flNext=14;C.begin(t,1000);
  assert.throws(()=>C.ofcAction(C.clone(t),'u1',{},2000),/turn/);
  assert.throws(()=>C.ofcAction(C.clone(t),'u0',{},2000),/exactly/);
  let moves=0;while(t.status==='playing'&&moves++<20)C.autoMove(t,2000+moves*1000);
  assert.equal(t.status,'showdown');assert.equal(Math.round((Object.values(t.players).reduce((n,p)=>n+p.stack,0)+t.settlement.rake)*100),n*10000);
  assert.ok(Object.values(t.players).every(p=>p.stack>=0));
 }
});
test('Public state never contains stock, opponents hands, blind attacks or fantasy placements',()=>{
 for(const type of ['durak','ofc']){const t=table(type,2);if(type==='ofc')t.players.u0.flNext=14;C.begin(t,1000);t.seq=7;
  if(type==='durak'){const c=t.players.u0.cards.pop();t.pairs=[{a:c,d:null,blind:true,by:'u0'}];}
  else C.autoMove(t,2000);
  const pub=C.publish(t);assert.deepEqual(pub.deck,[]);assert.equal(pub.deckCount,t.deck.length);
  const text=JSON.stringify(pub);for(const c of t.deck.filter(c=>c.id!==t.trumpCard?.id))assert.ok(!text.includes('"id":"'+c.id+'"'),'stock leaked');
  if(type==='durak'){for(const p of Object.values(t.players))for(const c of p.cards)assert.ok(!text.includes('"id":"'+c.id+'"'),'hand leaked');assert.equal(pub.pairs[0].a.hidden,true);}
  else{assert.ok(pub.players.u0.top.every(c=>c.hidden));assert.ok(pub.players.u0.bot.every(c=>c.hidden));assert.ok(pub.players.u1.pending.every(c=>c.hidden));}
  const own=C.personal(t,'u0');assert.equal(own.seq,7);assert.equal('players'in own,false);assert.equal('deck'in own,false);
 }
});
test('Invalid/stale ownership and forged card placements are rejected',()=>{
 const t=table('durak',2);C.begin(t,0);assert.throws(()=>C.durakAction(t,t.turnUid,'play',{cardId:'forged'},100),/hand/);
 const o=table('ofc',2);C.begin(o,0);const stage=Object.fromEntries(o.players.u0.pending.map(c=>[c.id,'constructor']));assert.throws(()=>C.ofcAction(o,'u0',stage,100),/Invalid row/);
});
test('Leaving a playing OFC hand cannot settle an opponent unfinished board prematurely',()=>{
 for(const nPlayers of [2,3]){const t=table('ofc',nPlayers);C.begin(t,0);C.leave(t,'u1',100);assert.equal(t.status,'playing');assert.equal(t.players.u1.left,true);
 let n=0;while(t.status==='playing'&&n++<20)C.autoMove(t,n*1000);assert.equal(t.status,'showdown');assert.equal(t.lastResults.rows.find(r=>r.uid==='u1').foul,true);
 assert.equal(C.placed(t.players.u0),13);}
});
