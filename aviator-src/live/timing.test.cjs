"use strict";
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const Core = require('../../functions/aviatorCore');
const {setup} = require('../../functions/test/aviatorFixture');
const client = fs.readFileSync(__dirname + '/../../aviator-live.html', 'utf8');
const tFor = Core.timeForMult;
const K = Core.GROWTH_K;
const ids = (roundId='r1', requestId='fixture-request-1') => ({roundId, requestId});
function quote(cents, now, roundId='r1') { return Core.makeQuote('fixture', 'u1', roundId, cents, Math.floor(now)); }
function extract(start,end){ const a=client.indexOf(start), b=client.indexOf(end,a); assert(a>=0&&b>a); return client.slice(a,b); }

test('client rendering never exceeds a server-confirmed ceiling during silence', () => {
  const ctx={S:{confirmedCents:240,cents:201,mult:2.01},quoteFresh:()=>true};
  vm.runInNewContext(extract('function renderFlightValue(){','/* Shared chat behaviour'),ctx);
  for(let frame=0;frame<10000;frame++){ctx.renderFlightValue();assert(ctx.S.cents<=240);}
  assert.equal(ctx.S.mult,2.4);
});

test('client ignores old-round and lower-phase states', () => {
  const ctx={S:{roundId:'r2',phase:'crashed'},GROWTH_K:0.132};
  vm.runInNewContext(extract('function applyState(s){','/* =====================================================================\n   SUBSCRIPTIONS'),ctx);
  ctx.applyState({roundId:'r1',phase:'crashed'});ctx.applyState({roundId:'r2',phase:'flying'});
  assert.equal(ctx.S.roundId,'r2');assert.equal(ctx.S.phase,'crashed');
});

test('takeoff cannot expose the previous round price before the first animation frame', () => {
  const els={'#mult':{textContent:'7.19x',className:'dead'}};
  const el=id=>els[id]||(els[id]={classList:{remove(){}}});
  let exposed;
  Object.defineProperty(el('#flightNums'),'hidden',{set(hidden){
    if(!hidden) exposed=el('#mult').textContent;
  }});
  const ctx={S:{cents:100,mult:1},$:el,toneStart(){},play(){},updateAction(){}};
  vm.runInNewContext(extract('function onFlying(){','function onCrashed(){'),ctx);
  ctx.onFlying();
  assert.equal(exposed,'1.00x');
  assert.equal(el('#mult').className,'');
});

test('pending cashout feedback is immediate and failures are visible', async () => {
  let reject,ui=0,errors=0;
  const ctx={performance,cashing:false,joined:true,pendingCash:null,myBet:{amount:100},
    S:{phase:'flying',roundId:'r1',cents:201,quote:{}},quoteFresh:()=>true,newRequestId:()=> 'fixture-id',
    sendAction:()=>new Promise((_,r)=>reject=r),updateAction:()=>ui++,haptic:()=>{},
    maybeTick:()=>{},toastErr:()=>errors++};
  vm.runInNewContext(extract('async function doCashout(){','addEventListener("offline"'),ctx);
  const pending=ctx.doCashout();assert.equal(ui,1);assert.equal(ctx.pendingCash.seenCents,201);
  reject(new Error('network unavailable'));await pending;
  assert.equal(errors,1);assert.equal(ctx.cashing,false);assert.equal(ctx.pendingCash,null);
});

test('late cashout response cannot mark the next round as paid', async () => {
  let resolve,confirms=0;
  const ctx={performance,cashing:false,joined:true,pendingCash:null,myBet:{amount:100},
    S:{phase:'flying',roundId:'r1',cents:201,quote:{}},quoteFresh:()=>true,newRequestId:()=> 'fixture-id',
    sendAction:()=>new Promise(r=>resolve=r),updateAction:()=>{},haptic:()=>{},confirmCashout:()=>confirms++,
    maybeTick:()=>{},toastErr:()=>{}};
  vm.runInNewContext(extract('async function doCashout(){','addEventListener("offline"'),ctx);
  const pending=ctx.doCashout();ctx.S.roundId='r2';ctx.myBet={amount:200};
  resolve({roundId:'r1',mult:2.01,win:201});await pending;
  assert.equal(confirms,0);assert.equal(ctx.myBet.cashedAt,undefined);
});

test('GOD MODE discards old-round and disabled-mode responses', async () => {
  for(const change of [ctx=>ctx.S.roundId='r2',ctx=>ctx.supMode=false]) {
    let resolve;const els={};
    const ctx={supGeneration:0,supMode:true,joined:true,supRound:'',S:{roundId:'r1'},store:{get:()=>''},
      FX:()=>new Promise(r=>resolve=r),$:id=>els[id]||(els[id]={hidden:true}),updateAction:()=>{},toastErr:()=>{}};
    vm.runInNewContext(extract('async function supPeek(){','let supTaps'),ctx);
    const pending=ctx.supPeek();change(ctx);resolve({roundId:'r1',crashPoint:2.4});await pending;
    assert.equal(ctx.supRound,'');assert.equal(els['#supPill'].hidden,true);
  }
});

test('clock estimate excludes time spent processing on the server', () => {
  const ctx={clockOffset:0,coBestRtt:Infinity,coAt:0,Date:{now:()=>100600}};
  vm.runInNewContext(extract('function noteServerNow(sn, rtt, receivedAt){','const eNow ='),ctx);
  ctx.noteServerNow(100500,600,100100);assert.equal(ctx.clockOffset,0);
});

test('unconfirmed automatic exits are not rendered as paid', () => {
  const els={};const ctx={user:{uid:'u1'},roundBets:[{uid:'u1',amount:100,autoAt:2,cashedAt:null,lost:false}],
    S:{phase:'flying',mult:2.6},$:id=>els[id]||(els[id]={}),esc:String,avatarFor:()=>'',fmt:String};
  vm.runInNewContext(extract('function renderPlayers(){','function updateAction(){'),ctx);
  ctx.renderPlayers();assert.doesNotMatch(els['#players'].innerHTML,/class="prow me cashed"/);
});

test('expired quote response cannot restart the display after a slow network round trip', () => {
  const ctx={S:{phase:'flying',roundId:'r1',confirmedCents:100,quote:null},performance,
    quoteFresh:()=>false,updateAction:()=>{throw Error('stale quote enabled input');}};
  vm.runInNewContext(extract('function acceptQuote(q,','function renderFlightValue'),ctx);
  ctx.acceptQuote(quote(240,10000),1800);
  assert.equal(ctx.S.quote,null);assert.equal(ctx.S.confirmedCents,100);
});

test('disconnection freezes immediately, including the smoothing toward a confirmed ceiling', () => {
  const ctx={S:{confirmedCents:240,cents:201,mult:2.01},quoteFresh:()=>false};
  vm.runInNewContext(extract('function renderFlightValue(){','/* Shared chat behaviour'),ctx);
  for(let i=0;i<100;i++)ctx.renderFlightValue();
  assert.equal(ctx.S.cents,201);assert.equal(ctx.S.mult,2.01);
});

test('late failure from an old round cannot show an error on the new round', async () => {
  let reject,errors=0;
  const ctx={performance,cashing:false,joined:true,pendingCash:null,myBet:{amount:100},
    S:{phase:'flying',roundId:'r1',cents:201,quote:{}},quoteFresh:()=>true,newRequestId:()=> 'fixture-id',
    sendAction:()=>new Promise((_,r)=>reject=r),updateAction:()=>{},haptic:()=>{},
    maybeTick:()=>{},toastErr:()=>errors++};
  vm.runInNewContext(extract('async function doCashout(){','addEventListener("offline"'),ctx);
  const p=ctx.doCashout();ctx.S.roundId='r2';reject(new Error('too late'));await p;
  assert.equal(errors,0);
});

test('solo GOD display follows the current solo round and hides on disable', () => {
  const solo=fs.readFileSync(__dirname+'/../../aviator.html','utf8');
  const a=solo.indexOf('function updateGod'), b=solo.indexOf('async function',a);
  const els={};const ctx={godMode:true,S:{crashPoint:2.4},$:id=>els[id]||(els[id]={})};
  vm.runInNewContext(solo.slice(a,b),ctx);
  ctx.updateGod();assert.equal(els['#godVal'].textContent,'2.40x');
  ctx.S.crashPoint=1;ctx.updateGod();assert.equal(els['#godVal'].textContent,'1.00x');
  ctx.godMode=false;ctx.updateGod();assert.equal(els['#godPill'].hidden,true);
});

test('world-map geometry is local and cached between frames; only a resize rerasterizes it', () => {
  const visuals=fs.readFileSync(__dirname+'/flight-visuals.js','utf8')
    .replace('/*__WORLD_LAND__*/ []',fs.readFileSync(__dirname+'/assets/world-110m.json','utf8'));
  let geometryDraws=0,bitmapDraws=0;
  const map={setTransform(){},translate(){},scale(){},fill(){geometryDraws++;},stroke(){}};
  const layer={getContext:()=>map};
  const ctx={W:600,H:360,DPR:2,document:{createElement:()=>layer},
    Path2D:class {moveTo(){}lineTo(){}closePath(){}},Image:class {},
    ctx:{drawImage(){bitmapDraws++;}}};
  vm.runInNewContext(visuals,ctx);
  for(let i=0;i<120;i++)ctx.drawWorldMap();
  assert.equal(geometryDraws,1);assert.equal(bitmapDraws,120);
  ctx.W=390;ctx.drawWorldMap();assert.equal(geometryDraws,2);
  assert(!client.includes('fetch("assets/world-110m.json")'));
});

// Runs the generated client's real pricing, frame, graph and cashout functions
// against the actual server handlers. DOM/Canvas and Firestore are dependencies
// simulated in memory: this is integration coverage, not a browser/latency claim.
function flightClient() {
  let elapsed=0, graphEnd, plane;
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',className:'',style:{},
      classList:{contains:()=>false,add(){},remove(){}},offsetWidth:600});
    return elements.get(id);
  };
  const paint=new Proxy({}, {get:(_,key)=>key==='lineTo' ? (x,y)=>{graphEnd={x,y};} :
    key==='createLinearGradient' ? ()=>({addColorStop(){}}) : ()=>{},set:()=>true});
  const f={S:{phase:'flying',roundId:'r1',phaseAt:0,protocol:2,mult:1,cents:100,
    confirmedCents:100,quote:null,quoteAt:0,lastWholeMult:1},
    performance:{now:()=>elapsed},navigator:{onLine:true},document:{visibilityState:'visible'},
    $:element,toCents:Core.toCents,chipPayout:Core.payout,timeForMult:tFor,multAt:Core.multAt,
    newRequestId:()=> 'integration-request-1',eNow:()=>elapsed,
    joined:true,cashing:false,pendingCash:null,myBet:null,REDUCED:true,
    updateAction(){},haptic(){},play(){},toneUpdate(){},toneStop(){},
    maybeTick(){},updateSyncStatus(){},updateFlightStatus(){},updateCockpit(){},
    requestAnimationFrame(){},pushHistory(){},explode(){},fmt:String,
    confirms:[],errors:[],confirmCashout:r=>f.confirms.push(r),toastErr:e=>f.errors.push(e),
    ctx:paint,W:600,H:360,PAD:{l:0,r:0,t:0,b:0},dust:[],particles:[],gridShift:0,
    view:{xMax:8,yMax:2},niceStep:()=>1,X:x=>x,Y:y=>y,godMode:false,
    Path2D:class{moveTo(){}lineTo(){}closePath(){}},drawWorldMap(){},
    drawFlightJet:(x,y)=>{plane={x,y};}
  };
  vm.createContext(f);
  for(const [a,b] of [
    ['function quoteFresh(){','/* Shared chat behaviour'],
    ['async function sendAction(name, payload){','async function doPlaceBet'],
    ['async function doCashout(){','addEventListener("offline"'],
    ['function onCrashed(){','function applyState(s){'],
    ['function draw(now){','/* =====================================================================\n   COCKPIT INSTRUMENTS'],
    ['function frame(){','/* =====================================================================\n   INPUT WIRING']
  ]) vm.runInContext(extract(a,b),f);
  return {f,element,advance:ms=>{elapsed+=ms;},graph:()=>({end:graphEnd,plane})};
}

test('graph endpoint, aircraft and readout agree after joining an already advanced flight', () => {
  const {f,element,graph}=flightClient();
  f.acceptQuote(quote(320,10000));
  // A late join/reconnect can deliver a price beyond the old viewport scale.
  f.S.cents=320;f.S.mult=3.2;
  f.frame();
  assert.equal(element('#mult').textContent,'3.20x');
  assert.equal(graph().plane.y,3.2);
  assert(Math.abs(graph().end.y-3.2)<1e-10,'the curve must reach the displayed multiplier');
  assert(Math.abs(graph().end.x-tFor(3.2)/1000)<1e-10,'the curve time must match the displayed multiplier');
});

function deferred() {
  let resolve;
  const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};
}
async function quotedFlight({crash=2.4,autoAt=null,amount=101,priceAt=Math.ceil(tFor(2.3))}={}) {
  const server=setup({time:priceAt,crash,autoAt});
  const bet=server.data.get('aviatorBets/r1_u1');bet.amount=amount;bet.protocol=2;
  server.data.get('aviatorPlayers/u1').balance=10000-amount;
  const response=await server.call('avTick');
  const c=flightClient();
  c.f.acceptQuote(response.quote);
  for(let i=0;i<30;i++) c.f.frame();
  c.f.myBet={...bet};
  return {server,...c,priceAt,amount};
}

test('rendered price is sent immediately and paid exactly despite settlement and a delayed reply', async () => {
  const {server,f,element,advance,graph,priceAt,amount}=await quotedFlight();
  const displayed=element('#mult').textContent;
  const processed=deferred(),acknowledgement=deferred(),requests=[];
  const arrival=priceAt+20;
  server.beforeNextTransaction(async()=>{
    server.setNow(Math.ceil(tFor(2.4))+100);
    await server.call('avTick');
  });
  f.FX=async(name,payload)=>{
    requests.push(structuredClone(payload));
    server.setNow(arrival);
    const result=await server.call(name,payload);
    processed.resolve(result);
    await acknowledgement.promise;
    return result;
  };
  f.updateAction=()=>assert.equal(requests.length,1,'dispatch must precede pending UI work');
  const pending=f.doCashout();
  assert.equal(requests.length,1);
  assert.equal(requests[0].seenCents,Number(displayed.replace('.', '').replace('x', '')));
  assert.equal(f.pendingCash.seenCents,requests[0].seenCents);
  assert.equal(f.confirms.length,0);
  const result=await processed.promise;
  // Rendering receives the authoritative crash while cashout acknowledgement
  // is still in transit. Neither the crash nor later frames can reprice it.
  advance(1900);f.S.phase='crashed';f.S.crashPoint=2.4;f.onCrashed();f.frame();
  assert.equal(element('#mult').textContent,'2.40x');
  assert(Math.abs(graph().end.y-2.4)<1e-10);
  assert.equal(f.confirms.length,0);
  acknowledgement.resolve();await pending;
  assert.equal(f.errors.length,0);assert.equal(f.confirms.length,1);
  assert.equal(result.serverReceivedAt,arrival);
  assert.equal(f.confirms[0].mult,Number.parseFloat(displayed));
  assert.equal(f.confirms[0].auto,false);
  const expected=Math.floor(amount*requests[0].seenCents/100);
  assert.equal(result.win,expected);
  assert.equal(server.data.get('aviatorPlayers/u1').balance,10000-amount+expected);
  assert.equal(server.data.get('aviatorRounds/r1').totalPaid,expected);
});

test('a click sent before the crash but arriving after it reports failure and never pays', async () => {
  const boundary=Math.ceil(tFor(2.4));
  for(const settleFirst of [false,true]) {
    const {server,f}=await quotedFlight({priceAt:boundary-20});
    let requests=0;
    f.FX=async(name,payload)=>{
      requests++;server.setNow(boundary);
      if(settleFirst) await server.call('avTick');
      return server.call(name,payload);
    };
    await f.doCashout();
    assert.equal(requests,1);assert.equal(f.confirms.length,0);
    assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/התרסק/);
    assert.equal(server.data.get('aviatorPlayers/u1').balance,9899);
    assert.equal(f.cashing,false);
  }
});

test('an acknowledgement lost after payment retries the original price and cannot pay twice', async () => {
  const {server,f,priceAt,amount}=await quotedFlight();
  const requests=[];
  f.FX=async(name,payload)=>{
    requests.push(structuredClone(payload));
    server.setNow(requests.length===1?priceAt+10:Math.ceil(tFor(2.4))+200);
    const result=await server.call(name,payload);
    if(requests.length===1) throw Object.assign(new Error('response lost'),{code:'unavailable'});
    return result;
  };
  await f.doCashout();
  assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);
  assert.equal(f.errors.length,0);assert.equal(f.confirms.length,1);
  const expected=Math.floor(amount*requests[0].seenCents/100);
  assert.equal(f.confirms[0].win,expected);
  assert.equal(server.data.get('aviatorPlayers/u1').balance,10000-amount+expected);
  assert.equal([...server.data.keys()].filter(k=>k.startsWith('aviatorLedger/')).length,1);
});

test('a previously reached stored target is returned to the client explicitly as automatic', async () => {
  const {server,f,priceAt}=await quotedFlight({autoAt:2});
  let sent;
  f.FX=(name,payload)=>{
    sent=structuredClone(payload);server.setNow(priceAt+10);return server.call(name,payload);
  };
  await f.doCashout();
  assert.equal(sent.seenCents,230);
  assert.equal(f.errors.length,0);assert.equal(f.confirms.length,1);
  assert.equal(f.confirms[0].auto,true);assert.equal(f.confirms[0].mult,2);
  assert.equal(f.confirms[0].win,202);
  assert.equal(server.data.get('aviatorPlayers/u1').balance,10101);
});
