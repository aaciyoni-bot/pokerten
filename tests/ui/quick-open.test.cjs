'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const {Simulate}=require('react-dom/test-utils');
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const calls=[],writes=[],messages=[];let settle;
const forbidden=async()=>{writes.push(1);throw new Error('Client table writes are forbidden');};
w.fb={db:{},auth:{currentUser:{uid:'owner'}},fx:(name,args)=>{calls.push({name,args});return new Promise((resolve,reject)=>{settle={resolve,reject};});},updateDoc:forbidden,addDoc:forbidden,setDoc:forbidden,runTransaction:forbidden,getDocs:async()=>({docs:[]}),getDoc:async()=>({exists:()=>false}),doc:()=>({}),collection:()=>({}),query:()=>({}),where:()=>({}),onSnapshot:()=>()=>{}};
const templates=[{name:'My NLH',settings:{serverEngine:false,baseGameType:'NLH',blinds:'2',buyIn:'200',maxPlayers:6}},{name:'My PLO6',settings:{baseGameType:'Omaha6',tableName:'Six card night',blinds:'5',buyIn:'500',maxPlayers:7,showcaseBots:3}}];
w.localStorage.setItem('pokerTpl_main',JSON.stringify(templates));
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function LobbyView('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.LobbyTest=LobbyView;');w.eval(script);
const root=ReactDOM.createRoot(w.document.getElementById('root'));
(async()=>{
 await React.act(async()=>root.render(React.createElement(w.LobbyTest,{tablesLoaded:true,user:{uid:'owner',role:'club_owner'},tables:[],tournaments:[],clubSettings:{},tab:'poker',setTab(){},showToast:(m,type)=>messages.push({m,type})})));
 const button=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===text);
 const nl=button('My NLH');assert.ok(nl);
 await React.act(async()=>{nl.click();nl.click();});
 assert.equal(calls.length,1,'rapid repeated clicks create one server request');assert.ok(nl.disabled);assert.ok(button('My PLO6').disabled);
 assert.equal(calls[0].name,'pkTableCreate');assert.equal(calls[0].args.clubId,'main');assert.equal(calls[0].args.settings.serverEngine,true);assert.equal(calls[0].args.settings.name,'My NLH');assert.equal(calls[0].args.settings.buyIn,'200');assert.equal(calls[0].args.botCount,0);assert.ok(calls[0].args.requestId.length>=16);
 await React.act(async()=>settle.resolve({tableId:'first'}));assert.equal(button('My NLH').disabled,false);assert.equal(messages.at(-1).type,'success');
 await React.act(async()=>button('My PLO6').click());assert.equal(calls[1].args.botCount,3);assert.equal(calls[1].args.settings.name,'Six card night');assert.equal(calls[1].args.settings.baseGameType,'Omaha6');
 await React.act(async()=>settle.reject(Object.assign(new Error('Insufficient club funds'),{code:'functions/failed-precondition'})));
 assert.equal(messages.at(-1).m,'Insufficient club funds');assert.equal(button('My PLO6').disabled,false,'failure allows retry');
 await React.act(async()=>button('My PLO6').click());assert.equal(calls.length,3);assert.notEqual(calls[1].args.requestId,calls[2].args.requestId);
 await React.act(async()=>settle.resolve({tableId:'second'}));
 assert.equal(writes.length,0,'quick open never writes table state, stacks or balances from the browser');assert.deepEqual(JSON.parse(w.localStorage.getItem('pokerTpl_main')),templates,'existing templates remain intact');

 // Built-ins must exist on a fresh browser, without saving any template first.
 w.localStorage.removeItem('pokerTpl_main');let joined=0;
 const emptyTable={docId:'empty',type:'poker',authorityVersion:2,clubId:'main',settings:{serverEngine:true,baseGameType:'NLH',blinds:.5,minBuyIn:40,maxBuyIn:200,maxPlayers:6},players:{},gameState:{phase:'waiting'}};
 const render=role=>React.act(async()=>root.render(React.createElement(w.LobbyTest,{key:role,tablesLoaded:true,user:{uid:'spectating-manager',role,managedGames:[]},tables:[emptyTable],tournaments:[],clubSettings:{rakePct:6},tab:'poker',setTab(){},onJoinPoker(){joined++;},showToast:(m,type)=>messages.push({m,type})})));
 await render('manager');const doc=w.document,quick=doc.querySelector('[aria-label="Quick bot tables"]');assert.ok(quick);assert.equal(quick.querySelectorAll('input').length,2,'only buy-in and rake need editing');
 await React.act(()=>{Simulate.change(quick.querySelector('[aria-label="Quick table buy-in"]'),{target:{value:'250'}});Simulate.change(quick.querySelector('[aria-label="Quick table rake"]'),{target:{value:'4'}});});
 for(const game of ['NLH','Omaha 4','Omaha 5','Omaha 6','Pineapple']){
  const open=doc.querySelector('[aria-label="Open '+game+' with bots"]'),before=calls.length;
  await React.act(async()=>{open.click();open.click();});assert.equal(calls.length,before+1);const c=calls.at(-1);assert.equal(c.name,'pkTableCreate');assert.equal(c.args.botCount,'full');assert.equal(c.args.settings.baseGameType,game);assert.equal(c.args.settings.minBuyIn,250);assert.equal(c.args.settings.maxBuyIn,250);assert.equal(c.args.settings.rakePercent,4);assert.equal(c.args.settings.maxPlayers,6);assert.equal(c.args.settings.blinds,.5);
  await React.act(async()=>settle.resolve({tableId:'quick-'+game}));
 }
 await React.act(()=>Simulate.change(quick.querySelector('[aria-label="Quick table rake"]'),{target:{value:'21'}}));assert.ok(doc.querySelector('[aria-label="Open NLH with bots"]').disabled);
 await React.act(()=>Simulate.change(quick.querySelector('[aria-label="Quick table rake"]'),{target:{value:'0'}}));assert.equal(doc.querySelector('[aria-label="Open NLH with bots"]').disabled,false,'zero rake is valid');
 const fill=doc.querySelector('[aria-label="Fill table with bots"]');assert.ok(fill);const count=calls.length;await React.act(async()=>{fill.click();fill.click();});assert.equal(calls.length,count+1);assert.equal(calls.at(-1).name,'pkSeat');assert.equal(calls.at(-1).args.op,'fillbots');assert.equal(calls.at(-1).args.tableId,'empty');assert.equal(joined,0,'lobby fill never enters or seats the manager');
 await React.act(async()=>settle.reject(Error('Insufficient club funds')));assert.equal(fill.disabled,false);assert.equal(messages.at(-1).m,'Insufficient club funds');
 await render('player');assert.equal(doc.querySelector('[aria-label="Quick bot tables"]'),null);assert.equal(doc.querySelector('[aria-label="Fill table with bots"]'),null);assert.equal(writes.length,0);
 await React.act(()=>root.unmount());w.close();console.log('PASS: saved NLH/PLO templates use server creation, preserve settings, prevent double opens and recover from errors');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
