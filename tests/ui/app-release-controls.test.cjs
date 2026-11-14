'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const React=require('react');
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
const component=html.slice(html.indexOf('function AppReleaseControls()'),html.indexOf('function App()'));
const web=fs.readFileSync(require.resolve('../../assets/js/app-update.js'),'utf8');
(async()=>{
 const w=new JSDOM('<meta name="app-version" content="375"><div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
 global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
 const ReactDOM=require('react-dom/client');w.React=React;w.PokerMusicButton=()=>null;
 w.eval(component+'\nwindow.Controls=AppReleaseControls;');
 const root=ReactDOM.createRoot(w.document.getElementById('root')),navigations=[];
 let release=375,offline=false,resolveFetch,hold=false;
 const updaterWindow={location:{href:w.location.href,replace:u=>navigations.push(u)},addEventListener(){},__pkAppView:'clubs'};
 vm.runInNewContext(web,{window:updaterWindow,document:w.document,navigator:{},URL,AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>{
   if(hold)await new Promise(r=>resolveFetch=r);if(offline)throw Error('offline');
   return{ok:true,json:async()=>({version:release}),text:async()=>'<meta name="app-version" content="'+release+'">'};
 }});
 w.PokerAppUpdate=updaterWindow.PokerAppUpdate;
 const button=()=>w.document.querySelector('[aria-label="Version 375. Check for updates"]');
 const status=()=>w.document.querySelector('.app-release-controls [role=status]')?.textContent||'';
 await React.act(()=>root.render(React.createElement(w.Controls)));
 await React.act(async()=>button().click());assert.match(status(),/up to date.*375/);assert.equal(navigations.length,0);
 offline=true;await React.act(async()=>button().click());assert.match(status(),/Could not check/);assert.equal(button().disabled,false);
 offline=false;release=376;hold=true;
 await React.act(()=>button().click());assert.equal(button().disabled,true);assert.match(button().textContent,/Checking/);assert.match(status(),/Checking/);
 hold=false;await React.act(async()=>resolveFetch());assert.equal(navigations.length,1);assert.match(status(),/Starting the updated game/);
 // Use the actual Android controller behind the same mounted button.
 const {createAutoUpdater}=await import('../../scripts/mobile-runtime/src/update-controller.mjs');
 const installs=[];let downloads=0;
 const controller=createAutoUpdater({current:{runtime:'android-13',version:'0.375.1'},
  fetchRelease:async()=>({runtime:'android-13',version:'0.376.1',url:'https://pokerten.com/mobile-updates/android-13/376.zip',checksum:'a'.repeat(64),size:100}),
  ota:{list:async()=>({bundles:[]}),download:async()=>{downloads++;return{id:'376'};},set:async bundle=>installs.push(bundle)},
  store:{setSafeContext:async()=>{},check:async()=>({status:'current'})},render(){}});
 controller.setView('clubs');w.PokerAppUpdate={version:375,check:manual=>controller.check(manual)};
 await React.act(async()=>button().click());assert.equal(downloads,1);assert.deepEqual(installs,[{id:'376'}]);assert.match(status(),/Starting the updated game/);
 w.PokerAppUpdate.check=async()=>undefined;
 await React.act(async()=>button().click());assert.match(status(),/did not respond/);assert.equal(button().disabled,false);
 await React.act(()=>root.unmount());w.close();console.log('PASS: actual Check update button, visible progress/current/offline feedback, one-tap web and Android installation, and retry');
})().catch(error=>{console.error(error);process.exitCode=1;});
