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
test('the club-picker button downloads and installs without requiring a club', async () => {
  let reads = 0;
  const f = fixture({fetchRelease: async () => { reads++; return release; }});
  f.updater.setView('clubs');
  const message = await f.updater.check(true);
  assert.match(message, /Starting the updated game/);
  assert.equal(reads, 1);
  assert.equal(f.events.filter(([type]) => type === 'apply').length, 1);
});
test('manual checks report current, blocked, and offline states without changing play', async () => {
  const currentClient = fixture({fetchRelease:async () => currentManifest()});
  function currentManifest() { return {...release, version:current.version}; }
  currentClient.updater.setView('clubs');
  assert.match(await currentClient.updater.check(true), /up to date.*v352/);
  const seated=fixture();seated.updater.setView('lobby');
  seated.updater.setGameContext({...context,tables:[{players:{p1:{}}}]});
  assert.match(await seated.updater.check(true), /Stand up from your table/);
  const offline=fixture({fetchRelease:async()=>{throw Error('offline');}});
  offline.updater.setView('clubs');
  assert.match(await offline.updater.check(true), /Could not check/);
});
test('manual retry allows a slow download, and a late result cannot install after another hand starts', async () => {
  let download, timeoutMs, expires;
  const f=fixture({delay:(fn,ms)=>{expires=fn;timeoutMs=ms;return 1;}});
  f.options.ota.download=()=>new Promise(resolve=>{download=resolve;});
  f.start();await flush(); assert.equal(timeoutMs,15000);
  expires(); await flush(); download({id:'old'}); await flush();
  const retry = f.updater.check(true); await flush();
  assert.equal(timeoutMs,60000);
  f.updater.setView('poker-table');download({id:'retry'});
  assert.match(await retry,/Return to the club lobby/);
  assert.equal(f.events.some(([type])=>type==='apply'),false);
});
test('entrance screens never auto-install but an explicit tap installs at sign-in',async()=>{
  const f=fixture();f.updater.setView('auth');await flush();
  assert.equal(f.events.some(([type])=>type==='apply'),false);
  assert.match(await f.updater.check(true),/Starting the updated game/);
  assert.equal(f.events.filter(([type])=>type==='apply').length,1);
});
test('the club picker still blocks remembered seats and known unfinished tournaments',async()=>{
  for(const options of [{hasResume:()=>true},{active:true}]){
    const f=fixture(options);f.updater.setView('clubs');
    if(options.active)f.updater.setGameContext({...context,tournaments:[{status:'running',players:{p1:{}}}]});
    assert.match(await f.updater.check(true),options.active?/tournament finishes/:/Stand up from your table/);
    assert.equal(f.events.some(([type])=>type==='apply'),false);
  }
});
test('entering a table during a manual entrance-screen update prevents a late install',async()=>{
  let resolve;const f=fixture();f.updater.setView('clubs');
  f.options.ota.download=()=>new Promise(r=>resolve=r);
  const pending=f.updater.check(true);await flush();
  f.updater.setView('poker-table');resolve({id:'new'});
  assert.match(await pending,/Return to the club lobby/);
  assert.equal(f.events.some(([type])=>type==='apply'),false);
});
test('the native install lock deduplicates repeated manual taps',async()=>{
  let resolve,downloads=0;const f=fixture();f.updater.setView('clubs');
  f.options.ota.download=()=>{downloads++;return new Promise(r=>resolve=r);};
  const first=f.updater.check(true),second=f.updater.check(true);await flush();
  resolve({id:'new'});await Promise.all([first,second]);
  assert.equal(downloads,1);assert.equal(f.events.filter(([type])=>type==='apply').length,1);
});
