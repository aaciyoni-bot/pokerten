'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const fromFunctions=createRequire(require.resolve('../functions/package.json'));
const {getFirestore}=fromFunctions('firebase-admin/firestore');
const gate=require('../functions').pkCanInstallUpdate;

test('existing Android clients receive a server-confirmed restart decision',async t=>{
  const db=getFirestore(),uid='p1',clubId='c1';
  let tables=[],events=[],member=true;
  const snapshot=data=>({get:key=>String(key).split('.').reduce((v,k)=>v?.[k],data)});
  t.mock.method(db,'runTransaction',(read,opts)=>{
    assert.equal(opts.readOnly,true);
    return read({get:async target=>{
      if(target.path==='memberships/p1_c1')return {exists:member,data:()=>({status:'approved'})};
      return {docs:(target._queryOptions.collectionId==='tables'?tables:events).map(snapshot)};
    }});
  });
  const check=()=>gate.run({auth:{uid,token:{}},data:{clubId}});
  const players={[uid]:{status:'active'}};
  for(const table of [{archived:true,players},{tournament:{finished:true},players},{spinDone:true,players},{players:{p1:{left:true}}}]){
    tables=[table];assert.deepEqual(await check(),{allowed:true,uid,clubId});
  }
  tables=[{players}];assert.equal((await check()).allowed,false);
  tables=[];events=[{status:'running',players}];assert.equal((await check()).allowed,false);
  events=[{status:'running',players:{p1:{removed:true}}}];assert.equal((await check()).allowed,true);
  member=false;await assert.rejects(check(),/membership required/i);
});
