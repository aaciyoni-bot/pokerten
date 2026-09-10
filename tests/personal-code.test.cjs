'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
  const data=new Map(),users=new Map(); let serial=Promise.resolve();
  const snap=key=>({exists:data.has(key),data:()=>structuredClone(data.get(key)),ref:{path:key}});
  const db={doc:key=>({path:key,get:async()=>snap(key)}),runTransaction:fn=>{
    const next=serial.then(async()=>{const writes=[];const tx={get:async ref=>snap(ref.path),set:(ref,val)=>writes.push(()=>data.set(ref.path,structuredClone(val))),update:(ref,val)=>writes.push(()=>data.set(ref.path,{...data.get(ref.path),...structuredClone(val)})),create:(ref,val)=>{if(data.has(ref.path))throw Error('exists');writes.push(()=>data.set(ref.path,structuredClone(val)));}};
      const result=await fn(tx);writes.forEach(w=>w());return result;});serial=next.catch(()=>{});return next;},
    collection:()=>({where:()=>({get:async()=>({docs:[]})})}),batch:()=>({update(){},commit:async()=>{}})};
  const auth={createCustomToken:async uid=>'token:'+uid,createUser:async user=>users.set(user.uid,user),getUser:async uid=>users.get(uid)||{uid,email:'player@example.test',displayName:'Player'}};
  class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
  const exports={};const req=name=>name==='firebase-functions/v2/https'?{onCall:(_,fn)=>fn,HttpsError}:name==='firebase-admin/firestore'?{getFirestore:()=>db}:name==='firebase-admin/auth'?{getAuth:()=>auth}:require(name);
  vm.runInNewContext('(function(require,exports){'+fs.readFileSync(path.join(__dirname,'../functions/personalCode.js'),'utf8')+'})',{Buffer,Date,console})(req,exports);
  return{data,db,users,auth,api:exports};
}
test('player IDs are unique across providers, stable per UID, and retain balances',async()=>{
 const{db,data,api}=fixture();data.set('users/google-uid',{balance:425,username:'Existing',playerId:'OLD123'});
 const one=await api._test.ensurePlayerId(db,'google-uid',null,()=> 'P123456789');let candidates=['P123456789','P987654321'];
 const two=await api._test.ensurePlayerId(db,'code-uid',{balance:0},()=>candidates.shift());
 assert.notEqual(one,two);assert.equal(await api._test.ensurePlayerId(db,'google-uid'),one);assert.equal(data.get('users/google-uid').balance,425);assert.equal(data.get('users/google-uid').username,'Existing');
 assert.equal(data.get('_pkPlayerIds/'+one).uid,'google-uid');
 const many=await Promise.all(Array.from({length:12},(_,i)=>api._test.ensurePlayerId(db,'u'+i,{balance:0})));assert.equal(new Set(many).size,12);
});
test('invalid PIN attempts persist and block the seventh attempt even on failure',async()=>{
 const{api,db,data}=fixture();for(let i=0;i<6;i++){await api._test.consume(db,'account',6,100);}
 await assert.rejects(api._test.consume(db,'account',6,100),e=>e.code==='resource-exhausted');assert.equal([...data.values()][0].count,6);await api._test.consume(db,'account',6,100+15*60*1000);
 assert.equal([...data.values()][0].count,1);
});
test('registration issues a separate player ID, hashes the secret, and login preserves UID',async()=>{
 const{api,data}=fixture();const made=await api.pkPinRegister({data:{name:'Test player',pin:'83492716'},rawRequest:{ip:'test-ip'}});
 assert.match(made.loginId,/^P\d{9}$/);const credential=data.get('_pkPinCredentials/'+made.loginId);assert.equal(credential.pin,undefined);assert.notEqual(credential.hash,'83492716');assert.equal(data.get('users/'+credential.uid).playerId,made.loginId);
 const signed=await api.pkPinLogin({data:{loginId:made.loginId,pin:'83492716'},rawRequest:{ip:'test-ip'}});assert.equal(signed.token,'token:'+credential.uid);
 await assert.rejects(api.pkPinLogin({data:{loginId:made.loginId,pin:'99999999'},rawRequest:{ip:'test-ip'}}),e=>e.code==='unauthenticated');
 const before=data.get('users/'+credential.uid);const auth={uid:credential.uid,token:{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}}};
 const enrolled=await api.pkPinEnroll({auth,data:{pin:'39182647'}});assert.equal(enrolled.loginId,made.loginId);assert.deepEqual(data.get('users/'+credential.uid),before);
 await assert.rejects(api.pkPinLogin({data:{loginId:made.loginId,pin:'83492716'},rawRequest:{ip:'test-ip'}}),e=>e.code==='unauthenticated');
});
test('enrollment rejects anonymous sessions, stale authentication and weak codes',async()=>{
 const{api}=fixture();await assert.rejects(api.pkPinEnroll({data:{pin:'83492716'}}),e=>e.code==='unauthenticated');
 await assert.rejects(api.pkPinEnroll({auth:{uid:'u',token:{firebase:{sign_in_provider:'anonymous'}}},data:{pin:'83492716'}}),e=>e.code==='failed-precondition');
 await assert.rejects(api.pkPinEnroll({auth:{uid:'u',token:{auth_time:1}},data:{pin:'83492716'}}),e=>e.code==='failed-precondition');
 assert.throws(()=>api._test.validatePin('1234'),e=>e.code==='invalid-argument');
});
test('readiness never returns a token or creates an account, and signing failures remain closed',async()=>{
 const {api,auth,users,data}=fixture();
 const ready=await api.pkPinStatus({data:{}});assert.equal(ready.available,true);assert.deepEqual(Object.keys(ready),['available']);
 for(const [message,reason] of [
  ['Permission iam.serviceAccounts.signBlob denied for PRIVATE_ACCOUNT','signing-permission'],
  ['IAM Service Account Credentials API has not been used or is disabled: PRIVATE_PROJECT','signing-api-disabled'],
  ['Failed to determine service account ID: PRIVATE_ACCOUNT','signing-configuration'],
  ['Unexpected PRIVATE_SECRET','signing-unavailable']
 ]){
  auth.createCustomToken=async()=>{throw Error(message);};
  const failed=await api.pkPinStatus({data:{}});assert.equal(failed.available,false);assert.equal(failed.reason,reason);assert.equal(JSON.stringify(failed).includes('PRIVATE'),false);
 }
 assert.equal(users.size,0);assert.equal(data.size,0);
});
