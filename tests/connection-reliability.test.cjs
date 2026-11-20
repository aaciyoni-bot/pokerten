'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {actionTransport,createTimings,startTickLoop}=require('../assets/js/poker-runtime');

test('regional actions use one receipt through an uncertain response and circuit recovery',async()=>{
 let now=0,primary=0,fallback=0,writes=0;const receipts=new Map();
 const payload={requestId:'stable-action-id',tableId:'table',action:'call'};
 const commit=data=>{if(!receipts.has(data.requestId)){writes++;receipts.set(data.requestId,{ok:true});}return receipts.get(data.requestId);};
 const call=actionTransport(async data=>{primary++;assert.equal(data,payload);commit(data);throw {code:'functions/unavailable'};},async data=>{fallback++;assert.equal(data,payload);return commit(data);},()=>now);
 await call(payload);await call(payload);assert.equal(writes,1);assert.equal(primary,1);assert.equal(fallback,2);
 now=30001;await call(payload);assert.equal(primary,2);assert.equal(writes,1);
});
test('rejected actions never fall back or bypass permission and turn validation',async()=>{
 for(const code of ['permission-denied','unauthenticated','failed-precondition','invalid-argument','not-found']){
  const call=actionTransport(async()=>{throw {code:'functions/'+code};},()=>assert.fail('must not retry semantic rejections'));
  await assert.rejects(call({requestId:'stable-action-id'}),e=>e.code==='functions/'+code);
 }
});
test('timings separate handler and transport overhead without recording payload or result',async()=>{
 let now=0;const timings=createTimings(()=>now);
 const result={timing:{serverMs:30},privateCard:'never-record',uid:'never-record'};
 assert.equal(await timings.measure('pkAct',async()=>{now=100;return result;}),result);
 const rows=timings.summary();assert.equal(rows.find(x=>x.stage==='pkAct:server').medianMs,30);
 assert.equal(rows.find(x=>x.stage==='pkAct:transport-and-platform').medianMs,70);
 assert.equal(JSON.stringify(rows).includes('never-record'),false);
 for(let i=0;i<400;i++)timings.add('table:render',i);
 assert.equal(timings.summary().reduce((n,r)=>n+r.count,0),300);
 timings.reset();assert.deepEqual(timings.summary(),[]);
});
test('slow ticks do not add another second after the response and never overlap',async()=>{
 let now=0,calls=0,resolve,scheduled;
 const stop=startTickLoop(()=>{calls++;return new Promise(r=>resolve=r);},{now:()=>now,setTimeout:(fn,ms)=>{scheduled={fn,ms};return 1;},clearTimeout:()=>{scheduled=null;}});
 now=1700;assert.equal(calls,1);assert.equal(scheduled,undefined);resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(scheduled.ms,100);scheduled.fn();assert.equal(calls,2);stop();resolve();await Promise.resolve();await Promise.resolve();assert.equal(scheduled,null);
});

test('Firebase callables initialize even before optional runtime diagnostics are available',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 const start=html.indexOf('const _fx = getFunctions(app);');
 const source=html.slice(start,html.indexOf('// Keep popup errors visible.',start));
 for(const runtime of [undefined,{},require('../assets/js/poker-runtime')]){
  const calls=[],window={fb:{},PokerRuntime:runtime};
  vm.runInNewContext(source,{window,app:{},getFunctions:(_,region)=>region||'us-central1',httpsCallable:(region,name)=>async data=>{calls.push({region,name,data});return {data:{ok:true}};}});
  assert.equal((await window.fb.fx('pkSecurityStatus',{})).ok,true);
  const request={requestId:'existing-receipt'};await window.fb.fx('pkAct',request);
  assert.equal(calls[0].name,'pkSecurityStatus');assert.equal(calls[0].region,'us-central1');
  assert.equal(calls[1].name,runtime?.actionTransport?'pkActEurope':'pkAct');
  assert.equal(calls[1].data,request);
 }
});
