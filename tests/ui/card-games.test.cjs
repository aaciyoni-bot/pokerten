'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),C=require('../../functions/cardGamesCore');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const calls=[],writes=[],errors=[],watchers=new Map();let state,privateState,peekState,failNext=false;
const forbidden=async()=>{writes.push(1);throw new Error('Client writes forbidden');};
w.fb={db:{},auth:{currentUser:{uid:'owner',email:'owner@example.test'}},fx:async(name,args)=>{if(name==='pkClubDirectory')return{accounting:{players:{}}};calls.push({name,args});if(name==='pkCardPeek')return peekState;if(failNext){failNext=false;throw new Error('Insufficient balance');}return{tableId:'new-table',ok:true};},updateDoc:forbidden,addDoc:forbidden,setDoc:forbidden,runTransaction:forbidden,getDocs:async()=>({docs:[]}),getDoc:async()=>({exists:()=>false}),doc:(db,...p)=>p.join('/'),collection:()=>({}),query:()=>({}),where:()=>({}),onSnapshot:(ref,cb)=>{watchers.set(ref,cb);queueMicrotask(()=>cb({id:'table',exists:()=>true,data:()=>ref.includes('/priv/')?privateState:state}));return()=>watchers.delete(ref);}};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function LobbyView('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.CardsTest={DurakTable,OFCTable,LobbyView};');w.eval(script);
const root=ReactDOM.createRoot(w.document.getElementById('root')),user={uid:'owner',username:'Owner',role:'club_owner',status:'approved',balance:1000},toast=(m,type)=>errors.push({m,type});
const buttons=text=>[...w.document.querySelectorAll('button')].filter(b=>b.textContent.includes(text));
function fixture(type,status){const t=C.newTable(type,{buyIn:100,stake:5,rakePercent:6,maxPlayers:3,deckSize:36},'owner','main',1);for(const [i,uid]of ['owner','guest'].entries())t.players[uid]={uid,name:uid,seatIndex:i,stack:100,isBot:false,left:false,cards:[],top:[],mid:[],bot:[],pending:[],disc:[]};if(status!=='setup')C.begin(t,Date.now());if(status==='showdown'){let n=0;Object.values(t.players).forEach(p=>p.isBot=true);while(t.status==='playing'&&n++<2000)C.autoMove(t,Date.now());}t.seq=12;return t;}
async function emit(t){state=C.publish(t);privateState=C.personal(t,'owner');await React.act(async()=>{for(const [ref,cb]of watchers)cb({id:'table',exists:()=>true,data:()=>ref.includes('/priv/')?privateState:state});});}
(async()=>{
 for(const type of ['durak','ofc']){
  let t=fixture(type,'setup');delete t.players.owner;state=C.publish(t);privateState=C.personal(t,'owner');
  await React.act(async()=>root.render(React.createElement(w.CardsTest[type==='durak'?'DurakTable':'OFCTable'],{key:type,tableDocId:'table',user,clubSettings:{},showToast:toast,onLeave(){}})));
  assert.equal(w.document.querySelector('[aria-label="GOD MODE"]'),null,'Ordinary accounts do not get GOD controls');
  assert.ok(w.document.querySelector('.'+type+'-room'));const join=buttons(type==='durak'?'Join (':'Sit with stack')[0];assert.ok(join);
  await React.act(async()=>{join.click();join.click();});assert.equal(calls.at(-1).name,'pkCardGame');assert.equal(calls.at(-1).args.op,'join');assert.equal(calls.filter(c=>c.args.op==='join').length,type==='durak'?1:2,'double clicks deduplicate');
  t=fixture(type,'playing');if(type==='durak'){while(t.turnUid!=='owner')C.autoMove(t,Date.now());}await emit(t);
  if(type==='durak'){const card=w.document.querySelector('.card-game-dock .card-face');assert.ok(card,'Own cards are delivered from private snapshot');await React.act(async()=>card.parentElement.click());assert.equal(calls.at(-1).args.op,'play');assert.equal(calls.at(-1).args.seq,12);}
  else{assert.equal(w.document.querySelectorAll('[data-ofc-row]').length,3,'All three placement rows render');assert.ok(w.document.querySelector('.ofc-hero-board'),'personal arrangement board renders');}
  assert.equal(writes.length,0,'No browser writes during play');
  t=fixture(type,'showdown');await emit(t);assert.ok(buttons(type==='durak'?'New game':'New match').length,'Result contains next-hand action');
  const keep=buttons('Keep watching')[0];await React.act(async()=>keep.click());assert.ok(buttons('Results / next hand').length);await React.act(async()=>buttons('Results / next hand')[0].click());
  await React.act(async()=>buttons(type==='durak'?'New game':'New match')[0].click());assert.equal(calls.at(-1).args.op,'start');
 }
 for(const type of ['durak','ofc']){
  const t=fixture(type,'playing');state=C.publish(t);privateState=C.personal(t,'owner');peekState={seq:t.seq,players:t.players,deck:t.deck,pairs:t.pairs};
  w.fb.auth.currentUser={uid:'owner',email:'info.bagso@gmail.com',emailVerified:true};
  await React.act(async()=>root.render(React.createElement(w.CardsTest[type==='durak'?'DurakTable':'OFCTable'],{key:'god-'+type,tableDocId:'table',user,clubSettings:{},showToast:toast,onLeave(){}})));
  const button=w.document.querySelector('[aria-label="GOD MODE"]');assert.ok(button);
  await React.act(async()=>button.click());assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(calls.at(-1).name,'pkCardPeek');
  if(type==='durak')assert.ok(w.document.querySelector('.card-game-god-stock'),'Durak GOD shows the actual next draw order');
  await React.act(async()=>button.click());assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(w.document.querySelector('.card-game-god-stock'),null);
  peekState={...peekState,seq:t.seq-1};await React.act(async()=>button.click());assert.equal(button.getAttribute('aria-pressed'),'false','Stale private snapshots never render as GOD view');
 }
 w.fb.auth.currentUser={uid:'owner',email:'owner@example.test'};
 for(const type of ['durak','ofc']){
  let opened;
  await React.act(async()=>root.render(React.createElement(w.CardsTest.LobbyView,{key:'lobby-'+type,tablesLoaded:true,user,tables:[],tournaments:[],clubSettings:{},tab:type,setTab(){},showToast:toast,onJoinDurak:t=>opened=t,onJoinOfc:t=>opened=t})));
  await React.act(async()=>buttons('New table')[0].click());
  const create=buttons('Create table')[0]||buttons('Open table')[0]||buttons('Confirm & open')[0];assert.ok(create,'creation submit exists: '+type+' '+buttons('').map(b=>b.textContent).join('|'));
  failNext=true;await React.act(async()=>create.click());assert.equal(errors.at(-1).m,'Insufficient balance');assert.equal(opened,undefined);
  await React.act(async()=>{create.click();create.click();});assert.equal(calls.at(-1).name,'pkCardTableCreate');assert.equal(calls.at(-1).args.type,type);assert.equal(opened.docId,'new-table');
 }
 assert.equal(writes.length,0);await React.act(async()=>root.unmount());w.close();console.log('Card games UI: creation, failure/retry, private cards, results, next hand; no client writes.');
})().catch(e=>{console.error(e);process.exitCode=1;w.close();});
