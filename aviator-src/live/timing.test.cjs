"use strict";
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const Core = require('../../functions/aviatorCore');
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
