"use strict";
// In-memory dependency fixture. Never connects to Firebase or alters owner credentials.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Core = require('../aviatorCore');
const server = fs.readFileSync(__dirname + '/../aviator.js', 'utf8');
function setup({time=10000, phase='flying', phaseAt=0, crash=10, autoAt=null, roundId='r1'}={}) {
  let now = time, seq=0, beforeTransaction = null;
  const data = new Map([
    ['aviator/state', {phase,phaseAt,waitMs:7000,crashHold:3200,roundId,hash:'fixture'}],
    ['aviator/_engine',{roundId,crashPoint:crash,seed:'fixture'}],
    ['aviatorPlayers/u1',{uid:'u1',name:'Audit',balance:9900,net:0}],
    ['aviatorBets/'+roundId+'_u1',{uid:'u1',roundId,amount:100,autoAt,cashedAt:null,lost:false,win:0}],
  ]);
  const snap = (ref, value=data.get(ref.path)) => ({ref,exists:value!==undefined,data:()=>structuredClone(value)});
  const db = {
    doc:path=>({path,get:async()=>snap({path})}),
    collection:path=>({doc:()=>({path:path+'/generated-'+(++seq)}),where:(key,op,value)=>({collection:path,key,value})}),
    runTransaction:async fn=>{
      if (beforeTransaction){ const hook=beforeTransaction; beforeTransaction=null; await hook(); }
      const writes=[];
      const tx={
        get:async ref=>{
          assert.equal(writes.length,0,'Firestore reads must precede writes');
          if(ref.collection) return {docs:[...data].filter(([k,v])=>k.startsWith(ref.collection+'/')&&v[ref.key]===ref.value).map(([path,v])=>snap({path},v))};
          return snap(ref);
        },
        set:(ref,value)=>writes.push(['set',ref,value]),
        create:(ref,value)=>writes.push(['create',ref,value]),
        update:(ref,value)=>writes.push(['update',ref,value]),
        delete:ref=>writes.push(['delete',ref]),
      };
      const result=await fn(tx);
      for(const [op,ref,v] of writes){
        if(op==='delete'){data.delete(ref.path);continue;}
        if(op==='create') assert(!data.has(ref.path));
        const value=op==='update'?{...data.get(ref.path)}:{};
        for(const [k,item] of Object.entries(v)) value[k]=item&&typeof item==='object'&&'increment' in item?(value[k]||0)+item.increment:item;
        data.set(ref.path,value);
      }
      return result;
    },
  };
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  class Clock extends Date {static now(){return now;}}
  const ctx={exports:{},Date:Clock,require:id=>{
    if(id==='firebase-functions/v2/https')return{onCall:(_,fn)=>fn,HttpsError};
    if(id==='firebase-admin/firestore')return{getFirestore:()=>db,FieldValue:{increment:value=>({increment:value})}};
    if(id==='crypto')return crypto;
    if(id==='./aviatorCore')return Core;
    throw Error('Unexpected module '+id);
  }};
  // Dependency fixture: replace only the configured password hash in this in-memory
  // source copy. The original file and the live authentication path are untouched.
  const fixtureHash=crypto.createHash('sha256').update('audit-fixture-only').digest('hex');
  const fixtureServer=server.replace(/(const OWNER_CODE_HASH\s*=\s*)"[a-f0-9]{64}"/, '$1"'+fixtureHash+'"');
  vm.runInNewContext(fixtureServer,ctx,{filename:'functions/aviator.js'});
  const req=payload=>({auth:{uid:'u1',token:{}},data:payload});
  return {data,call:(name,payload={})=>ctx.exports[name](req(payload)),setNow:t=>now=t, beforeNextTransaction:fn=>beforeTransaction=fn};
}


module.exports = {setup};
