import test from 'node:test';
import assert from 'node:assert/strict';
import {clearStaleResume} from '../src/update-resume.mjs';
function fixture(players={}){
  const values=new Map([['pkResume','table-1'],['auth','keep'],['settings','keep']]);
  const reads=[];
  const root={__pkAppView:'clubs',localStorage:{getItem:k=>values.get(k),removeItem:k=>values.delete(k)},
    fb:{auth:{currentUser:{uid:'p1'}},db:{},doc:(_,collection,id)=>({collection,id}),
      getDocFromServer:async ref=>{reads.push(ref);return {exists:()=>true,data:()=>({players})};}}};
  return {root,values,reads};
}
test('server-confirmed stale resume markers are removed without changing auth or settings',async()=>{
  const f=fixture({other:{}});await clearStaleResume(f.root);
  assert.equal(f.values.has('pkResume'),false);assert.equal(f.values.get('auth'),'keep');assert.equal(f.values.get('settings'),'keep');
  assert.deepEqual(f.reads,[{collection:'tables',id:'table-1'}]);
});
test('a seated player, active table view, denied read or offline state keeps the marker',async()=>{
  const seated=fixture({p1:{}});await clearStaleResume(seated.root);assert.equal(seated.values.get('pkResume'),'table-1');
  for(const view of ['poker-table','durak-table','ofc-table']){
    const f=fixture();f.root.__pkAppView=view;await clearStaleResume(f.root);assert.equal(f.reads.length,0);assert.equal(f.values.get('pkResume'),'table-1');
  }
  const offline=fixture();offline.root.fb.getDocFromServer=async()=>{throw Error('offline');};
  await clearStaleResume(offline.root);assert.equal(offline.values.get('pkResume'),'table-1');
});
test('late reads cannot clear another account, a newer resume target or an active table',async()=>{
  for(const change of [f=>f.root.fb.auth.currentUser={uid:'p2'},f=>f.values.set('pkResume','table-2'),f=>f.root.__pkAppView='poker-table']){
    const f=fixture();let resolve;f.root.fb.getDocFromServer=()=>new Promise(r=>resolve=r);
    const pending=clearStaleResume(f.root);change(f);resolve({exists:()=>false});await pending;
    assert.ok(f.values.has('pkResume'));
  }
});
