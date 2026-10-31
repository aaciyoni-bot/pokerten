'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createActionRouter}=require('../pokerActionRegion');
const request=()=>({auth:{uid:'test-player'},data:{requestId:'test-action-request-0001',tableId:'test-table',action:'call',expectedTurn:{handN:1,phase:'preflop',turnStartedAt:100,highestBet:2}},rawRequest:{headers:{authorization:'Bearer test-token','x-firebase-appcheck':'test-app-check',cookie:'must-not-forward'}}});
const confirmation={ok:true,tableId:'test-table',tableUpdate:{gameState:{__seq:2},players:{}}};
const response=(result,status=200)=>({ok:status>=200&&status<300,json:async()=>result});
const options={emulator:false,report:()=>{},projectId:'demo-pokerten-security'};

test('legacy action forwards only callable credentials and preserves the request receipt',async()=>{
 let calls=0;
 const route=createActionRouter({...options,fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'https://europe-west1-demo-pokerten-security.cloudfunctions.net/pkActEurope');
  assert.deepEqual(JSON.parse(init.body),{data:request().data});
  assert.deepEqual(init.headers,{'Content-Type':'application/json',Authorization:'Bearer test-token','X-Firebase-AppCheck':'test-app-check'});
  assert.equal(init.redirect,'error');return response({result:confirmation});
 }});
 assert.deepEqual(await route(request(),()=>assert.fail('no local write on success')),confirmation);assert.equal(calls,1);
});

test('lost confirmation retries the identical request locally and opens the circuit',async()=>{
 let time=1000,remote=0,writes=0;const receipts=new Map();
 const local=async r=>{const key=r.data.requestId;if(!receipts.has(key)){writes++;receipts.set(key,confirmation);}return receipts.get(key);};
 const route=createActionRouter({...options,now:()=>time,fetchImpl:async(url,init)=>{remote++;await local(JSON.parse(init.body));throw Error('response lost after commit');}});
 const r=request();assert.deepEqual(await route(r,local),confirmation);assert.equal(writes,1);
 assert.deepEqual(await route(r,local),confirmation);assert.equal(remote,1);assert.equal(writes,1);
 time+=30001;await route(r,local);assert.equal(remote,2);assert.equal(writes,1);
});

test('game, authentication and permission rejections never execute a local fallback',async()=>{
 for(const status of ['FAILED_PRECONDITION','UNAUTHENTICATED','PERMISSION_DENIED','INVALID_ARGUMENT','NOT_FOUND']){
  const route=createActionRouter({...options,fetchImpl:async()=>response({error:{status,message:'Rejected',details:{retry:false}}},400)});
  await assert.rejects(route(request(),()=>assert.fail('must preserve rejection')),e=>e.code===status.toLowerCase().replaceAll('_','-')&&e.details.retry===false);
 }
});

test('timeout, server unavailability and malformed confirmations use the safe local receipt',async()=>{
 for(const fetchImpl of [
  async()=>response({error:{status:'UNAVAILABLE',message:'Unavailable'}},503),
  async()=>response({result:{ok:true,tableId:'other',tableUpdate:{}}}),
  async()=>({ok:false,json:async()=>{throw Error('invalid json');}}),
  async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))
 ]){
  const route=createActionRouter({...options,timeoutMs:10,fetchImpl});let localCalls=0;
  assert.deepEqual(await route(request(),async r=>{localCalls++;assert.deepEqual(r,request());return confirmation;}),confirmation);assert.equal(localCalls,1);
 }
});

test('emulators, unauthenticated requests and missing receipts never leave the local handler',async()=>{
 const inputs=[{...request(),auth:null},{...request(),rawRequest:null},{...request(),data:{tableId:'test-table'}}];
 const route=createActionRouter({...options,fetchImpl:()=>assert.fail('must not forward')});
 for(const r of inputs)assert.equal(await route(r,async()=>42),42);
 const emulator=createActionRouter({...options,emulator:true,fetchImpl:()=>assert.fail('must not access production')});
 assert.equal(await emulator(request(),async()=>42),42);
});
