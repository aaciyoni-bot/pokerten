"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const vm=require('node:vm'),fs=require('node:fs'),securityPath=require.resolve('../functions/pokerSecurity');
const emergency={exports:{}};vm.runInNewContext(fs.readFileSync(securityPath,'utf8').replace(/const POKER_SECURITY_PAUSED = (true|false);/,'const POKER_SECURITY_PAUSED = true;'),{module:emergency,exports:emergency.exports,require:require('node:module').createRequire(securityPath)});
require(securityPath);require.cache[securityPath].exports=emergency.exports;
const engine=require("../functions/pokerEngine");
test("all public poker mutation endpoints reject before opening a database transaction",async()=>{
 for(const name of ["pkDeal","pkAct","pkTick","pkLeave","pkRit","pkReveal","pkPickGame","pkDiscard"]){
  await assert.rejects(engine[name].run({auth:{uid:"player",token:{email_verified:true}},data:{tableId:"legacy-table",action:"raise",amount:10000}}),e=>e.code==="unavailable",name);
 }
});

test("public security readiness reports only the enforced maintenance state",async()=>{
 assert.deepEqual(await engine.pkSecurityStatus.run({data:{}}),{available:false,reason:"security-review"});
});
