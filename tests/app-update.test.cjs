const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('./ui/node_modules/jsdom');
const code=fs.readFileSync(require.resolve('../assets/js/app-update.js'),'utf8');
function setup(options={}){
  const dom=new JSDOM('<meta name="app-version" content="337"><body><button id="repair-update">Update</button><output id="repair-status"></output></body>',{pretendToBeVisual:true});
  const handlers={},swHandlers={},requests=[],navigations=[],registrations=[],timers=new Map();let version=337,htmlVersion=337,offline=false,updates=0,fetchHook=null,timerId=0;
  const registration={update:async()=>updates++};
  const w={location:{href:options.url||'https://pokerten.com/?v=lobby&club=demo',replace:url=>navigations.push(url)},addEventListener:(n,f)=>handlers[n]=f};
  const context={window:w,document:dom.window.document,navigator:{serviceWorker:{register:(...args)=>{registrations.push(args);return options.registration||Promise.resolve(registration);},addEventListener:(n,f)=>swHandlers[n]=f}},URL,AbortController,setInterval(){},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,settings)=>{requests.push({url,settings});if(fetchHook)await fetchHook(url,settings);if(offline)throw Error('offline');return{ok:true,json:async()=>({version}),text:async()=>`<meta name="app-version" content="${htmlVersion}">`};}};
  vm.runInNewContext(code,context);
  return{dom,w,handlers,swHandlers,requests,navigations,registrations,timers,setVersion:v=>{version=v;htmlVersion=v;},setHtmlVersion:v=>htmlVersion=v,setOffline:v=>offline=v,setFetchHook:f=>fetchHook=f,get updates(){return updates;},close:()=>dom.window.close()};
}
test('registration never blocks release checks; focus, online and controller changes check fresh URLs',async()=>{
  const f=setup({registration:new Promise(()=>{})});f.handlers.load();await f.w.PokerAppUpdate.check();
  assert.equal(f.registrations[0][1].updateViaCache,'none');
  for(const fire of [()=>f.handlers.focus(),()=>f.handlers.online(),()=>f.swHandlers.controllerchange(),()=>f.dom.window.document.dispatchEvent(new f.dom.window.Event('visibilitychange'))]){
    const before=f.requests.length;fire();await f.w.PokerAppUpdate.check();assert.ok(f.requests.length>before);
  }
  assert.ok(f.requests.every(r=>r.settings.cache==='no-store'&&r.url.includes('?check=')));assert.equal(f.navigations.length,0);f.close();
});
test('all table views block navigation; lobby updates preserve the route and verify the new HTML',async()=>{
  const f=setup();f.setVersion(338);
  for(const view of ['poker-table','durak-table','ofc-table']){f.w.PokerAppUpdate.setView(view);await f.w.PokerAppUpdate.reload();assert.equal(f.navigations.length,0);assert.match(f.dom.window.document.body.textContent,/Return to the lobby/);}
  f.w.PokerAppUpdate.setView('lobby');await f.w.PokerAppUpdate.reload();
  const url=new URL(f.navigations[0]);assert.equal(url.searchParams.get('v'),'lobby');assert.equal(url.searchParams.get('club'),'demo');assert.equal(url.searchParams.get('appVersion'),'338');assert.ok(url.searchParams.get('reload'));assert.equal(f.requests.at(-1).settings.cache,'no-store');f.close();
});
test('offline and stale HTML cannot claim a successful update; retry recovers',async()=>{
  const f=setup();await f.w.PokerAppUpdate.check(true);assert.match(f.dom.window.document.body.textContent,/up to date · v337/);
  f.setOffline(true);await f.w.PokerAppUpdate.reload();assert.match(f.dom.window.document.body.textContent,/Could not check/);assert.equal(f.navigations.length,0);
  f.setOffline(false);f.setVersion(338);f.setHtmlVersion(337);await f.w.PokerAppUpdate.reload();assert.match(f.dom.window.document.body.textContent,/update could not load/);assert.equal(f.navigations.length,0);
  f.setHtmlVersion(338);await f.w.PokerAppUpdate.reload();assert.equal(f.navigations.length,1);f.close();
});
test('a hung version request times out and releases the checking lock for retry',async()=>{
  const f=setup();f.setFetchHook((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')))));
  const pending=f.w.PokerAppUpdate.check(true);assert.equal(f.timers.size,1);[...f.timers.values()][0]();await pending;
  assert.equal(f.timers.size,0);assert.match(f.dom.window.document.body.textContent,/Could not check/);
  f.setFetchHook(null);f.setVersion(338);await f.w.PokerAppUpdate.check(true);assert.match(f.dom.window.document.body.textContent,/new version is ready/);f.close();
});
test('entering a table while the HTML is loading cancels navigation',async()=>{
  const f=setup();let release;const waiting=new Promise(r=>release=r);f.setFetchHook(url=>url.startsWith('https:')?waiting:Promise.resolve());
  const pending=f.w.PokerAppUpdate.reload();await new Promise(r=>setImmediate(r));f.w.PokerAppUpdate.setView('poker-table');release();await pending;
  assert.equal(f.navigations.length,0);assert.match(f.dom.window.document.body.textContent,/Return to the lobby/);f.close();
});
test('the recovery page can reload the current release at the same origin without touching auth storage',async()=>{
  const f=setup({url:'https://pokerten.com/update.html?club=demo'});await f.w.PokerAppUpdate.reload();
  const url=new URL(f.navigations[0]);assert.equal(url.origin,'https://pokerten.com');assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('appVersion'),'337');assert.equal(url.searchParams.get('club'),'demo');f.close();
});
