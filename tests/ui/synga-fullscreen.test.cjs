'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../assets/js/synga-fullscreen.js'),'utf8');
function page({parent,installed=false,reject=false,unsupported=false}={}) {
  const events={},calls=[];
  const document={fullscreenElement:null,addEventListener:(n,f)=>{events[n]=f;},removeEventListener(){}};
  document.documentElement=unsupported?{}:{requestFullscreen(options){calls.push(options);if(reject)return Promise.reject(Error('denied'));document.fullscreenElement=this;events.fullscreenchange?.();return Promise.resolve();}};
  document.exitFullscreen=()=>{document.fullscreenElement=null;events.fullscreenchange?.();return Promise.resolve();};
  const window={document,matchMedia:()=>({matches:installed})};window.parent=parent||window;
  if(!parent)window.SyngaEntry={isHost:true};
  const context=vm.createContext({window,document,Promise});vm.runInContext(source,context);
  return {window,document,events,calls,context,api:window.SyngaFullscreen};
}
const click=(p,{trusted=true,excluded=false}={})=>p.events.click({isTrusted:trusted,target:{closest:()=>excluded},defaultPrevented:false});
(async()=>{
  const host=page(),initial=host.api;
  vm.runInContext(source,host.context);assert.equal(host.api,host.window.SyngaFullscreen,'only one controller');
  assert.equal(host.calls.length,0,'never requests on load or intro timers');
  click(host,{trusted:false});click(host,{excluded:true});assert.equal(host.calls.length,0,'synthetic clicks and input/control clicks ignored');
  const {JSDOM}=require('jsdom');
  const authDOM=new JSDOM('<div class="auth-screen"><button><span>Continue with Google</span></button></div>');
  host.events.click({isTrusted:true,defaultPrevented:false,target:authDOM.window.document.querySelector('span')});
  assert.equal(host.calls.length,0,'Google popup retains the user gesture instead of fullscreen consuming it');
  click(host);await Promise.resolve();assert.equal(host.calls.length,1);assert.equal(host.calls[0].navigationUI,'hide');assert.equal(host.api.active,true);
  await host.api.toggle();assert.equal(host.api.active,false);click(host);await Promise.resolve();assert.equal(host.calls.length,1,'does not trap the user after exiting fullscreen');
  await host.api.toggle();assert.equal(host.calls.length,2,'explicit re-entry works');
  let updates=0;const unsubscribe=host.api.subscribe(()=>updates++);await host.api.toggle();assert.equal(updates,1);unsubscribe();
  const outer=page(),middle={parent:outer.window,document:{}},child=page({parent:middle});
  click(child);await Promise.resolve();assert.equal(outer.calls.length,1);assert.equal(child.calls.length,0,'child gesture fullscreens outer document');assert.equal(child.api.active,true);
  await child.api.toggle();assert.equal(outer.api.active,false,'table toggle exits the same outer fullscreen');
  const denied=page({reject:true});assert.equal(await denied.api.enter(true),false);assert.equal(await denied.api.enter(true),false);assert.equal(denied.calls.length,1);await denied.api.toggle();assert.equal(denied.calls.length,2,'manual retry remains available after denial');
  const absent=page({unsupported:true});assert.equal(absent.api.available,false);assert.equal(await absent.api.enter(true),false);
  const pwa=page({installed:true});assert.equal(pwa.api.available,false);assert.equal(await pwa.api.enter(true),true);assert.equal(pwa.calls.length,0,'installed fullscreen needs no API request');
  console.log('PASS: trusted gesture, hidden navigation request, nested host ownership, manual exit/re-entry, denial and installed-app fallbacks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
