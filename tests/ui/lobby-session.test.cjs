'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.PokerRuntime=require('../../assets/js/poker-runtime');
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-viewer-access.js'),'utf8'));
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-auth.js'),'utf8'));
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');w.eval([...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.AppTest=App;'));
// Probe the real App lifecycle; table-menu navigation itself is tested separately.
w.eval(`ClubsView=({onEnter})=>React.createElement('button',{onClick:()=>onEnter({id:'main',name:'Club'})},'Enter club');
LobbyView=({tables,tablesLoaded,tablesError,onRetryTables,onJoinPoker})=>React.createElement('div',null,React.createElement('output',{'data-lobby':true},JSON.stringify({ids:tables.map(t=>t.docId),loaded:tablesLoaded,error:tablesError})),React.createElement('button',{onClick:onRetryTables},'Retry tables'),...tables.map(t=>React.createElement('button',{key:t.docId,onClick:()=>onJoinPoker(t)},'View '+t.docId)));
PokerTable=({onLobby,initialSpectate})=>React.createElement('button',{'data-spectate':String(initialSpectate),onClick:onLobby},'Back to lobby');`);
const root=ReactDOM.createRoot(w.document.getElementById('root')),calls=[],subs=[];let auth;
const user={uid:'me',emailVerified:false},profile={username:'Me',playerId:'P123456789',role:'player',status:'approved',balance:250};
const record=(id,data)=>({id,exists:()=>!!data,data:()=>data,metadata:{fromCache:false}}),empty={exists:()=>false,docs:[],forEach(){},metadata:{fromCache:false}};
const member={uid:'me',clubId:'main',status:'approved',role:'player',balance:250};
const snapshot=r=>r.path==='users/me'?record('me',profile):r.path==='memberships/me_main'?record('me_main',member):r.path==='clubs/main'?record('main',{name:'Club'}):empty;
const ref=(_, ...parts)=>({path:parts.join('/')});
w.fb={db:{},auth:{currentUser:user},onAuthStateChanged:(_,cb)=>{auth=cb;return()=>{};},doc:ref,collection:ref,query:r=>r,where(){},getDoc:async r=>snapshot(r),getDocs:async()=>empty,
 onSnapshot:(r,opts,next,fail)=>{const cb=typeof opts==='function'?opts:next;const error=typeof opts==='function'?next:fail;
  const sub={path:r.path,cb,error,stopped:false};subs.push(sub);if(r.path!=='tables'&&r.path!=='tournamentViews')cb(snapshot(r));return()=>{sub.stopped=true;};},
 fx:async(name,args)=>{calls.push({name,args});return{};}};
const button=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===text),state=()=>JSON.parse(w.document.querySelector('[data-lobby]').textContent),latest=()=>subs.filter(s=>s.path==='tables').at(-1);
const table={type:'poker',authorityVersion:2,clubId:'main',settings:{serverEngine:true},players:{me:{uid:'me',status:'active',stack:0,bet:50}},gameState:{phase:'flop'}};
(async()=>{try{
 // A timed-out provider response cannot resume the abandoned code-login chain.
 let finish,continued=false;const pending=new Promise(r=>finish=r);
 await assert.rejects(w.PokerAuthUI.withTimeout(pending,1).then(()=>{continued=true;}),e=>e.code==='auth/timeout');finish('late');await Promise.resolve();assert.equal(continued,false);
 await React.act(()=>root.render(React.createElement(w.AppTest)));await React.act(async()=>auth(user));await React.act(async()=>button('Enter club').click());
 assert.equal(state().loaded,false,'entering a club waits for its server data');
 const first=latest();await React.act(()=>first.cb({...empty,metadata:{fromCache:true}}));assert.equal(state().loaded,false,'empty offline cache is not an empty server result');
 await React.act(()=>first.cb({docs:[record('seat',table)],metadata:{fromCache:false}}));assert.equal(state().loaded,true);assert.deepEqual(state().ids,['seat']);
 assert.ok(calls.some(c=>c.name==='pkTick'&&c.args.tableId==='seat'),'all-in seat still receives ticks outside the table');
 assert.ok(calls.some(c=>c.name==='pkSeat'&&c.args.op==='heartbeat'),'lobby retains seat presence');
 await React.act(()=>button('View seat').click());assert.equal(w.document.querySelector('[data-spectate]').dataset.spectate,'true','actual App opens the table for viewing');
 await React.act(()=>button('Back to lobby').click());assert.equal(w.localStorage.getItem('pkResume'),'seat');assert.deepEqual(state().ids,['seat']);
 assert.equal(calls.filter(c=>c.name==='pkLeave'||c.name==='pkAct'||c.name==='pkSeat'&&c.args.op!=='heartbeat').length,0,'navigation issues no financial/turn/sit-out action');
 await React.act(()=>first.error({code:'permission-denied'}));assert.equal(state().loaded,false);assert.match(state().error,/access/);
 await React.act(()=>button('Retry tables').click());assert.equal(first.stopped,true);assert.equal(state().loaded,false);
 await React.act(()=>first.cb({docs:[record('stale',table)],metadata:{fromCache:false}}));assert.deepEqual(state().ids,[],'old listeners cannot fill the new lobby');
 await React.act(()=>latest().cb(empty));assert.equal(state().loaded,true);assert.deepEqual(state().ids,[],'only fresh server emptiness is final');
 w.fb.auth.currentUser=null;await React.act(async()=>auth(null));assert.equal(w.document.querySelector('[data-lobby]'),null);
 console.log('PASS: bounded auth, cache/server loading, stale listener rejection, retry, all-in background presence, direct viewing and navigation without seat/turn mutations');
}finally{await React.act(()=>root.unmount());w.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
