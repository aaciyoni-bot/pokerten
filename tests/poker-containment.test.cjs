"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const engine=require("../functions/pokerEngine");
test("all public poker mutation endpoints reject before opening a database transaction",async()=>{
 for(const name of ["pkDeal","pkAct","pkTick","pkLeave","pkRit","pkReveal","pkPickGame","pkDiscard"]){
  await assert.rejects(engine[name].run({auth:{uid:"player",token:{email_verified:true}},data:{tableId:"legacy-table",action:"raise",amount:10000}}),e=>e.code==="unavailable",name);
 }
});

test("public security readiness reports only the enforced maintenance state",async()=>{
 assert.deepEqual(await engine.pkSecurityStatus.run({data:{}}),{available:false,reason:"security-review"});
});
