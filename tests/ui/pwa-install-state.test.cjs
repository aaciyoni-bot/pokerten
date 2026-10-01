'use strict';
// Exercise every real install entry point. Firebase and display-mode media
// queries are simulated; the shared hook, App navigation and prompt are real.
const fs = require('node:fs'), assert = require('node:assert/strict'), {JSDOM} = require('jsdom');
const React = require('react');
const html = fs.readFileSync(require.resolve('../../index.html'), 'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .find(match => match[1].includes('function App()'))[1]
  .replace(/const root = ReactDOM.createRoot[\s\S]*$/, 'window.PwaTest={App,InstallBanner,ClubsView};');
const manifest = JSON.parse(fs.readFileSync(require.resolve('../../manifest.json'), 'utf8'));
const club = {id:'main', name:'Install regression club', ownerUid:'owner', rakePct:6};
const identity = {uid:'player', email:'player@example.invalid', emailVerified:true};
const profile = {uid:'player', username:'Player', role:'player', status:'approved', playerId:'P123456789', balance:100};
const membership = {id:'player_main', uid:'player', clubId:'main', username:'Player', role:'player', status:'approved', balance:100};
const record = (id, data) => ({id, exists:()=>data!==null, data:()=>structuredClone(data), metadata:{fromCache:false}});
const records = rows => { const docs=rows.map(row=>record(row.id||row.uid,row)); return {docs, empty:!docs.length, size:docs.length, metadata:{fromCache:false}, forEach:fn=>docs.forEach(fn)}; };
async function fixture({mode='browser', ios=false, legacy=false}={}) {
  const w = new JSDOM('<div id="root"></div>', {url:'https://pokerten.com/', runScripts:'outside-only', pretendToBeVisual:true}).window;
  global.window=w; global.document=w.document;
  Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const ReactDOM={...require('react-dom'),...require('react-dom/client')};
  w.React=React; w.ReactDOM=ReactDOM;
  w.PokerRuntime=require('../../assets/js/poker-runtime'); w.PokerTournament=require('../../assets/js/poker-tournament');
  Object.defineProperty(w.navigator,'userAgent',{value:ios?'Mozilla/5.0 iPhone Safari':'Mozilla/5.0 Android Mobile Chrome',configurable:true});
  Object.defineProperty(w.navigator,'standalone',{value:ios,configurable:true});
  const queries=new Map();
  w.matchMedia=query=>{
    if(!queries.has(query)) {
      const listeners=new Set(), item={media:query,matches:query===`(display-mode: ${mode})`,listeners};
      if(legacy) {item.addListener=fn=>listeners.add(fn);item.removeListener=fn=>listeners.delete(fn);}
      else {item.addEventListener=(_,fn)=>listeners.add(fn);item.removeEventListener=(_,fn)=>listeners.delete(fn);}
      queries.set(query,item);
    }
    return queries.get(query);
  };
  let tokenChanged, prompts=0;
  const ref=(_, ...parts)=>({path:parts.join('/')});
  const snapshot=target=>{
    if(target.path==='users/player')return record('player',profile);
    if(target.path==='memberships/player_main')return record('player_main',membership);
    if(target.path==='clubs/main')return record('main',club);
    if(target.path==='clubs')return records([club]);
    if(target.path==='memberships')return records([membership]);
    if(target.path==='tables'||target.path==='tournaments')return records([]);
    return record(target.path.split('/').at(-1),null);
  };
  const denyWrite=async()=>{throw Error('Install visibility must not write application data');};
  w.fb={db:{},auth:{currentUser:identity},onIdTokenChanged:(_,fn)=>{tokenChanged=fn;return()=>{};},
    doc:ref,collection:ref,where:(...filter)=>filter,query:(target,...filters)=>({...target,filters}),
    getDoc:async target=>snapshot(target),getDocs:async target=>snapshot(target),
    onSnapshot:(target,options,next)=>{(typeof options==='function'?options:next)(snapshot(target));return()=>{};},
    fx:async name=>{if(name==='pkEnsurePlayer')return{playerId:profile.playerId};throw Error('Unexpected install callable: '+name);},
    updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite};
  w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-auth.js'),'utf8'));
  w.eval(script); w.__pkMuted=true;
  w.__installEvt={prompt:()=>{prompts++;},userChoice:Promise.resolve({outcome:'dismissed'})};
  const root=ReactDOM.createRoot(w.document.getElementById('root'));
  const button=label=>[...w.document.querySelectorAll('button')].find(el=>el.textContent.trim()===label)||null;
  const render=component=>React.act(async()=>root.render(component));
  const setMode=async next=>React.act(async()=>{
    mode=next;
    queries.forEach(query=>{query.matches=query.media===`(display-mode: ${mode})`;});
    queries.forEach(query=>query.listeners.forEach(listener=>listener({matches:query.matches,media:query.media})));
  });
  const mountApp=async()=>{
    await render(null);
    await render(React.createElement(w.PwaTest.App));
    await React.act(async()=>tokenChanged(identity));
    const enter=w.document.querySelector('.blue-club-orb[role=button][aria-label^="Enter "]'); assert.ok(enter,'actual App loads the club directory');
    await React.act(async()=>enter.click());
    assert.ok(w.document.querySelector('.blue-shell-nav'),'actual App enters the club lobby');
  };
  return {w,root,button,render,setMode,mountApp,get prompts(){return prompts;},
    directory:()=>React.createElement(w.PwaTest.ClubsView,{user:profile,clubs:[club],myMems:[membership],onEnter(){},showToast(){}}),
    banner:()=>React.createElement(w.PwaTest.InstallBanner,{variant:'auth'}),
    install:()=>React.act(async()=>w.dispatchEvent(new w.Event('appinstalled'))),
    close:async()=>{await React.act(()=>root.unmount());assert.equal([...queries.values()].reduce((n,q)=>n+q.listeners.size,0),0,'all display listeners are removed');w.close();}};
}
async function assertEntryPoints(options, installed) {
  const f=await fixture(options);
  try {
    await f.render(f.banner());
    assert.equal(!!f.button('Install the app'),!installed,`${JSON.stringify(options)}: auth InstallBanner`);
    await f.render(null); await f.render(f.directory());
    assert.equal(!!f.button('Install as app'),!installed,`${JSON.stringify(options)}: club directory`);
    await f.mountApp();
    assert.equal(!!f.button('Install'),!installed,`${JSON.stringify(options)}: App navigation`);
    assert.equal(!!f.button('Install the app'),!installed,`${JSON.stringify(options)}: lobby InstallBanner`);
    if(!installed) {
      for(const label of ['Install','Install the app']) await React.act(async()=>f.button(label).click());
      assert.equal(f.prompts,2,'browser navigation and banner use the captured native prompt');
    }
  } finally {await f.close();}
}
(async()=>{
  assert.equal(manifest.display,'fullscreen','exercise the installed mode requested by this app');
  for(const mode of [manifest.display,'standalone','minimal-ui','window-controls-overlay']) await assertEntryPoints({mode},true);
  await assertEntryPoints({ios:true},true);
  await assertEntryPoints({mode:'browser'},false);
  for(const legacy of [false,true]) {
    const f=await fixture({legacy});
    try {
      // Both consumers remain mounted while media changes and install events fire.
      await f.render(React.createElement(React.Fragment,null,f.directory(),f.banner()));
      await React.act(async()=>f.button('Install as app').click());
      assert.equal(f.prompts,1,'club directory preserves the browser native prompt');
      await f.setMode('fullscreen');
      assert.equal(f.button('Install as app'),null); assert.equal(f.button('Install the app'),null);
      await f.setMode('browser');
      assert.ok(f.button('Install as app')); assert.ok(f.button('Install the app'));
      await f.install();
      assert.equal(f.button('Install as app'),null); assert.equal(f.button('Install the app'),null);
      assert.equal(f.w.__installEvt,null,'successful installation discards the consumed native prompt');
      assert.equal(f.w.localStorage.length,0,'installed state is never persisted as a sticky flag');
      await f.mountApp();
      assert.equal(f.button('Install'),null,'runtime installation survives navigation/remount');
      assert.equal(f.button('Install the app'),null);
    } finally {await f.close();}
  }
  const app=await fixture();
  try {
    await app.mountApp();
    await app.setMode('standalone'); assert.equal(app.button('Install'),null);
    await app.setMode('browser'); assert.ok(app.button('Install'));
    await app.install(); assert.equal(app.button('Install'),null); assert.equal(app.button('Install the app'),null);
  } finally {await app.close();}
  await assertEntryPoints({mode:'browser'},false); // A later browser runtime can reinstall.
  console.log('PASS: all PWA install entry points respect fullscreen/standalone/minimal-ui/overlay/iOS, react to mode and installation events, preserve native prompts, clean up listeners and allow later browser installation');
})().catch(error=>{console.error(error);process.exitCode=1;});
