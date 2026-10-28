const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('./ui/node_modules/jsdom');
const code=fs.readFileSync(require.resolve('../assets/js/app-update.js'),'utf8');
function setup(){
  const dom=new JSDOM('<meta name="app-version" content="335"><body></body>',{pretendToBeVisual:true});
  const handlers={},requests=[],navigations=[],registrations=[];let version=335,offline=false,updates=0;
  const registration={update:async()=>updates++};
  const w={location:{href:'https://pokerten.com/?club=demo',replace:url=>navigations.push(url)},addEventListener:(n,f)=>handlers[n]=f};
  const context={window:w,document:dom.window.document,navigator:{serviceWorker:{register:async(...args)=>{registrations.push(args);return registration;}}},URL,setInterval(){},
    fetch:async(url,options)=>{requests.push({url,options});if(offline)throw Error('offline');return{ok:true,json:async()=>({version})};}};
  vm.runInNewContext(code,context);
  return{dom,w,handlers,requests,navigations,registrations,setVersion:v=>version=v,setOffline:v=>offline=v,get updates(){return updates;}};
}
test('checks on foreground and registers SW without the HTTP cache',async()=>{
  const f=setup();await f.handlers.load();await f.w.PokerAppUpdate.check();
  assert.equal(f.registrations[0][1].updateViaCache,'none');
  const before=f.requests.length;f.dom.window.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));await f.w.PokerAppUpdate.check();
  assert.ok(f.requests.length>before);assert.ok(f.requests.every(r=>r.options.cache==='no-store'));assert.ok(f.updates>0);assert.equal(f.navigations.length,0);f.dom.window.close();
});
test('new releases never interrupt a table; explicit update in lobby preserves URL context',async()=>{
  const f=setup();f.setVersion(336);f.w.PokerAppUpdate.setView('poker-table');await f.w.PokerAppUpdate.check();
  const button=[...f.dom.window.document.querySelectorAll('button')].find(x=>x.textContent==='Update now');
  assert.equal(button.disabled,true);button.click();assert.equal(f.navigations.length,0);
  assert.match(f.dom.window.document.body.textContent,/Return to the lobby/);
  for(const view of ['durak-table','ofc-table']){f.w.PokerAppUpdate.setView(view);button.click();assert.equal(f.navigations.length,0);}
  f.w.PokerAppUpdate.setView('lobby');assert.equal(button.disabled,false);assert.equal(f.navigations.length,0);button.click();
  assert.equal(f.navigations[0],'https://pokerten.com/?club=demo&v=336');f.dom.window.close();
});
test('manual checks identify the loaded version and recover from offline without deleting data',async()=>{
  const f=setup();await f.w.PokerAppUpdate.check(true);assert.match(f.dom.window.document.body.textContent,/up to date · v335/);
  f.setOffline(true);await f.w.PokerAppUpdate.check(true);assert.match(f.dom.window.document.body.textContent,/Could not check/);
  f.setOffline(false);f.setVersion(336);await f.w.PokerAppUpdate.check(true);assert.match(f.dom.window.document.body.textContent,/new version is ready/);assert.equal(f.navigations.length,0);f.dom.window.close();
});
