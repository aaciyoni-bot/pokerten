import test from 'node:test';
import assert from 'node:assert/strict';
import {canUpdate, validRelease, createAutoUpdater} from '../src/update-controller.mjs';
const context = {uid:'p1',clubId:'c1',ready:true,tables:[],tournaments:[]};
const current = {runtime:'android-13',version:'0.352.1'};
const release = {...current,version:'0.353.1',url:'https://pokerten.com/mobile-updates/android-13/new.zip',checksum:'a'.repeat(64),size:100};
const flush = () => new Promise(resolve=>setImmediate(resolve));
function fixture(changes={}) {
 const events=[];let timeout;
 const options={current,render:s=>events.push(['render',s]),fetchRelease:async()=>release,
  ota:{list:async()=>({bundles:[]}),download:async()=>({id:'new'}),set:async x=>events.push(['apply',x])},
  store:{setSafeContext:async()=>{},check:async()=>({status:'current'}),startUpdate:async()=>events.push(['store'])},
  delay:fn=>{timeout=fn;return 1;},cancel:()=>{},...changes};
 const updater=createAutoUpdater(options);
 const start=()=>{updater.setView('lobby');updater.setGameContext(context);};
 return {updater,events,start,expire:()=>timeout(),options};
}
test('blocks updates for unknown state, resume, seated player and enrolled tournament even in lobby',()=>{
 assert.equal(canUpdate(context,'lobby',false),true);
 for(const [c,v,resume] of [[null,'lobby',false],[{...context,ready:false},'lobby',false],[context,'poker-table',false],[context,'lobby',true],[{...context,tables:[{players:{p1:{}}}]},'lobby',false],[{...context,tournaments:[{status:'running',players:{p1:{out:true}}}]},'lobby',false],[{...context,tournaments:[{status:'reg',players:{p1:{}}}]},'lobby',false]]) assert.equal(canUpdate(c,v,resume),false);
});
test('rejects different native runtime, insecure/foreign URLs, absent hashes, oversized and older bundles',()=>{
 assert.equal(validRelease(release,current),true);
 for(const patch of [{runtime:'android-14'},{url:'http://pokerten.com/mobile-updates/x.zip'},{url:'https://evil.example/mobile-updates/x.zip'},{checksum:''},{size:50000001},{version:'0.351.1'},{version:current.version}])assert.equal(validRelease({...release,...patch},current),false);
});
test('downloads and applies automatically without a button or store prompt',async()=>{
 const f=fixture();f.start();await flush();assert.equal(f.events.filter(e=>e[0]==='apply').length,1);assert.equal(f.events.some(e=>e[0]==='store'),false);
 f.updater.setView('lobby');await flush();assert.equal(f.events.filter(e=>e[0]==='apply').length,1);
});
test('a table entered while download is pending cancels reload',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const f=fixture();f.options.ota.download=()=>pending;f.start();await flush();f.updater.setView('poker-table');resolve({id:'new'});await flush();assert.equal(f.events.some(e=>e[0]==='apply'),false);
});
test('a tournament enrollment received during download cancels reload',async()=>{
 let resolve;const f=fixture();f.options.ota.download=()=>new Promise(r=>resolve=r);f.start();await flush();f.updater.setGameContext({...context,tournaments:[{status:'running',players:{p1:{}}}]});resolve({id:'new'});await flush();assert.equal(f.events.some(e=>e[0]==='apply'),false);
});
test('timeout lets the player continue and late download never applies',async()=>{
 let resolve;const f=fixture();f.options.ota.download=()=>new Promise(r=>resolve=r);f.start();await flush();f.expire();await flush();resolve({id:'new'});await flush();assert.equal(f.events.some(e=>e[0]==='apply'),false);assert.deepEqual(f.events.at(-1),['render',null]);
});
test('failed bundle is not reinstalled after native rollback',async()=>{
 const f=fixture();f.options.ota.list=async()=>({bundles:[{version:release.version,status:'error'}]});f.start();await flush();assert.equal(f.events.some(e=>e[0]==='apply'),false);
});
test('offline or corrupt download keeps game usable',async()=>{
 const f=fixture({fetchRelease:async()=>{throw Error('offline');}});f.start();await flush();assert.equal(f.events.some(e=>e[0]==='apply'),false);assert.deepEqual(f.events.at(-1),['render',null]);
});
test('native upgrades open only Google consent, with no additional custom prompt',async()=>{
 const f=fixture({fetchRelease:async()=>({...release,version:current.version})});f.options.store.check=async()=>({status:'available'});f.start();await flush();assert.equal(f.events.filter(e=>e[0]==='store').length,1);
});
