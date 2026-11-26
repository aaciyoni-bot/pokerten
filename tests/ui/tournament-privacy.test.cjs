'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {identities,mockComponentGrant}=require('../god-session-fixture.cjs');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client');w.React=React;
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
w.eval(html.slice(html.indexOf('const isGodUser ='),html.indexOf('const isClubOversightUser ='))+'\nwindow.isGod=isGodUser;');
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-god-lobby.js'),'utf8'));
const root=createRoot(w.document.getElementById('root'));
let user={uid:'viewer',role:'super_admin',godMode:true},hidden=false,resolvePending;
Object.defineProperty(w.document,'hidden',{get:()=>hidden,configurable:true});
let tour={id:'event',game:'poker',clubId:'main',players:{a:{name:'Alice'},b:{name:'Alex'},removed:{removed:true}}};
let calls=[],pending=false;
const answer={tables:[{tableId:'event',humans:1,bots:1,unknown:0,seated:2,occupancyKey:'["a","b"]'}]};
w.fb={auth:{currentUser:{uid:'viewer',email:'ordinary@example.invalid',emailVerified:true}},fx:async(name,data)=>{calls.push({name,data});return pending?new Promise(resolve=>{resolvePending=resolve;}):answer;}};
mockComponentGrant(w.fb);
function Fixture(){
 const state=w.PokerGodLobby.useCounts({user,tables:[tour],clubId:'main',isGodUser:w.isGod,tournamentMode:true});
 const row=state.byTable.event;
 return React.createElement('p',null,row&&row.occupancyKey===w.PokerGodLobby.participantKey(tour)?row.humans+' human / '+row.bots+' bots':'No private counts');
}
const render=()=>React.act(()=>root.render(React.createElement(Fixture)));
const flush=()=>React.act(()=>new Promise(resolve=>setTimeout(resolve,300)));
(async()=>{try{
 await render();await flush();assert.equal(calls.length,0);assert.equal(w.document.body.textContent,'No private counts');
 w.fb.auth.currentUser.email=identities.supervisors[0];await render();await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{name:'godLobbyCounts',data:{clubId:'main',tableIds:['event'],mode:'tournaments'}});
 assert.equal(w.document.body.textContent,'1 human / 1 bots','counts come from authorized server response, never public entrant flags');
 hidden=true;await React.act(()=>w.document.dispatchEvent(new w.Event('visibilitychange')));assert.equal(w.document.body.textContent,'No private counts');
 pending=true;hidden=false;await React.act(()=>w.document.dispatchEvent(new w.Event('visibilitychange')));
 hidden=true;await React.act(()=>w.document.dispatchEvent(new w.Event('visibilitychange')));
 await React.act(async()=>resolvePending(answer));assert.equal(w.document.body.textContent,'No private counts','a late response cannot restore hidden-session data');
 hidden=false;w.fb.auth.currentUser={uid:'another',email:'ordinary@example.invalid',emailVerified:true};user={uid:'another',role:'manager'};
 await render();const count=calls.length;await flush();assert.equal(calls.length,count);assert.equal(w.document.body.textContent,'No private counts','account switch clears the authorized user view');
 assert.match(html,/collection\(window\.fb\.db, "tournamentViews"\)/);
 assert.match(html,/doc\(window\.fb\.db,\s*'tournamentViews',\s*id\)/);
 console.log('PASS: tournament projection routing, server-only participant counts, role spoof denial, background and account-switch isolation');
 }finally{await React.act(()=>root.unmount());w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
