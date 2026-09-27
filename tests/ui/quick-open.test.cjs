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
 const render=(role,status)=>React.act(async()=>root.render(React.createElement(w.LobbyTest,{key:role+status,tablesLoaded:true,user:{uid:'spectating-manager',role,status,managedGames:[]},tables:[emptyTable],tournaments:[],clubSettings:{rakePct:6},tab:'poker',setTab(){},onJoinPoker(){joined++;},showToast:(m,type)=>messages.push({m,type})})));
 await render('manager');const doc=w.document,quick=doc.querySelector('[aria-label="Quick bot tables"]');assert.ok(quick);
 const control=label=>quick.querySelector('[aria-label="'+label+'"]');
 const change=async(label,value)=>React.act(()=>Simulate.change(control(label),{target:{value:String(value)}}));
 const toggle=quick.querySelector('button');assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(control('Create bot table'),null,'Form opens explicitly from the manager button');
 await React.act(()=>toggle.click());assert.equal(toggle.getAttribute('aria-expanded'),'true');
 assert.equal(control('Quick table rake').value,'6','Current club rake is retained by default');
 await change('Quick table rake',4);
 for(const game of ['NLH','Omaha 4','Omaha 5','Omaha 6','Pineapple']){
  await change('Quick table game',game);
  const seats=['Omaha 4','Omaha 5','Pineapple'].includes(game)?4:6;
  assert.equal(control('Quick table seats').value,String(seats),'Small Omaha and Pineapple tables default to four seats');
  for(const [index,sb] of [.5,1,2].entries()){
   await change('Quick table blinds',sb);await change('Quick table bot seats',index);
   assert.equal(control('Quick table min buy-in').value,String(sb*100));assert.equal(control('Quick table max buy-in').value,String(sb*400));
   const count=seats-index,open=control('Create bot table'),before=calls.length,successBefore=messages.filter(m=>m.type==='success').length;
   assert.ok(control('Initial bot funding').textContent.replace(/,/g,'').includes('Initial club chips: '+(count*sb*200).toFixed(2)),'Displayed funding matches the server 100 BB rule');
   await React.act(async()=>{open.click();open.click();});assert.equal(calls.length,before+1,'Repeated synchronous clicks create one table');
   assert.equal(messages.filter(m=>m.type==='success').length,successBefore,'No success before the server response');
   assert.equal(open.disabled,true);assert.equal(control('Quick table game').disabled,true);
   const c=calls.at(-1);assert.equal(c.name,'pkTableCreate');assert.equal(c.args.clubId,'main');assert.equal(c.args.botCount,index===0?'full':count);
   assert.equal(c.args.settings.baseGameType,game);assert.equal(c.args.settings.minBuyIn,sb*100);assert.equal(c.args.settings.maxBuyIn,sb*400);
   assert.equal(c.args.settings.rakePercent,4);assert.equal(c.args.settings.maxPlayers,seats);assert.equal(c.args.settings.blinds,sb);
   assert.equal(c.args.settings.serverEngine,true);assert.equal(c.args.settings.autoStart,2);assert.equal(c.args.settings.omahaPotLimit,true);assert.ok(c.args.requestId.length>=16);
   assert.equal('botLobby' in c.args,false,'Manual tables do not change the automatic pool');
   await React.act(async()=>settle.resolve({tableId:'quick-'+game+'-'+sb}));assert.equal(open.disabled,false);assert.match(quick.querySelector('[role="status"]').textContent,/opened with/);
  }
 }
 // Seats and buy-in limits remain editable; cost respects both server clamps.
 await change('Quick table game','Pineapple');await change('Quick table seats',6);await change('Quick table blinds',.5);await change('Quick table bot seats',1);
 await change('Quick table min buy-in',90);await change('Quick table max buy-in',95);assert.match(control('Initial bot funding').textContent,/475/);
 await change('Quick table min buy-in',300);await change('Quick table max buy-in',350);assert.match(control('Initial bot funding').textContent,/1,?500/);
 const create=control('Create bot table');await React.act(async()=>create.click());const failed=calls.at(-1);
 assert.equal(failed.args.settings.maxPlayers,6);assert.equal(failed.args.settings.minBuyIn,300);assert.equal(failed.args.settings.maxBuyIn,350);assert.equal(failed.args.botCount,5);
 const successes=messages.filter(m=>m.type==='success').length;
 await React.act(async()=>settle.reject(Error('Insufficient club funds')));
 assert.equal(quick.querySelector('[role="alert"]').textContent,'Insufficient club funds');assert.equal(quick.querySelector('[role="status"]'),null);assert.equal(create.disabled,false);
 assert.equal(messages.filter(m=>m.type==='success').length,successes,'Failure never claims that a table was opened');
 await React.act(async()=>{create.click();create.click();});assert.notEqual(calls.at(-1).args.requestId,failed.args.requestId,'Explicit retry has a fresh request id');
 await React.act(async()=>settle.resolve({tableId:'manual-retry'}));assert.equal(quick.querySelector('[role="alert"]'),null);
 await change('Quick table rake',21);assert.ok(create.disabled);
 await change('Quick table rake',0);assert.equal(create.disabled,false,'Zero rake is valid');
 await change('Quick table max buy-in',299);assert.ok(create.disabled,'Maximum below minimum is rejected');
 await change('Quick table max buy-in',350);await change('Quick table min buy-in','');assert.ok(create.disabled,'Empty buy-in is rejected');
 await change('Quick table min buy-in',300);
 const fill=doc.querySelector('[aria-label="Fill table with bots"]');assert.ok(fill);const count=calls.length;await React.act(async()=>{fill.click();fill.click();});assert.equal(calls.length,count+1);assert.equal(calls.at(-1).name,'pkSeat');assert.equal(calls.at(-1).args.op,'fillbots');assert.equal(calls.at(-1).args.tableId,'empty');assert.equal(joined,0,'lobby fill never enters or seats the manager');
 await React.act(async()=>settle.reject(Error('Insufficient club funds')));assert.equal(fill.disabled,false);assert.equal(messages.at(-1).m,'Insufficient club funds');
 await render('player');assert.equal(doc.querySelector('[aria-label="Quick bot tables"]'),null);assert.equal(doc.querySelector('[aria-label="Fill table with bots"]'),null);assert.equal(writes.length,0);
 await render('agent','approved');assert.equal(doc.querySelector('[aria-label="Quick bot tables"]'),null);
 await render('manager','banned');assert.equal(doc.querySelector('[aria-label="Quick bot tables"]'),null);
 w.fb.auth.currentUser={uid:'spectating-manager',email:'haim29071994@gmail.com',emailVerified:true};await render('player','pending');assert.ok(doc.querySelector('[aria-label="Quick bot tables"]'),'Existing verified oversight identity gets the same controls');
 w.fb.auth.currentUser.emailVerified=false;await render('player','approved');assert.equal(doc.querySelector('[aria-label="Quick bot tables"]'),null,'An unverified email does not grant management controls');
 await React.act(()=>root.unmount());w.close();console.log('PASS: saved templates and manual bot tables across five games / three stakes, seat and fill choices, funding, permissions, duplicate prevention and failure recovery');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
