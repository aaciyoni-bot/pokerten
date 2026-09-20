'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const calls=[],messages=[];let next,settle,created=0,newTables=0;
const current={authorityVersion:2,clubId:'main',settings:{serverEngine:true,maxPlayers:6,baseGameType:'NLH',blinds:1,minBuyIn:40,maxBuyIn:200,straddle:true},players:{},gameState:{phase:'waiting',pots:[],board:[],__seq:1}};
const ref=(...a)=>({path:a.slice(1).join('/')});w.fb={db:{},auth:{currentUser:{uid:'viewer'}},doc:ref,collection:ref,query:r=>r,where:()=>({}),getDoc:async()=>({exists:()=>false}),getDocs:async()=>({docs:[]}),fx:(name,args)=>{if(name==='pkTick')return Promise.resolve({});calls.push({name,args});return new Promise((resolve,reject)=>{settle={resolve,reject};});},onSnapshot:(r,opts,fn)=>{const cb=typeof opts==='function'?opts:fn;if(r.path==='tables/test'){next=cb;queueMicrotask(()=>cb({id:'test',exists:()=>true,data:()=>structuredClone(current),metadata:{fromCache:false}}));}else queueMicrotask(()=>cb({exists:()=>false,docs:[]}));return()=>{};}};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function PokerTable('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.TableTest=PokerTable;window.CreateTest=PokerCreateView;');w.eval(script);w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document,byTitle=t=>doc.querySelector('button[title="'+t+'"]');
const render=async role=>React.act(async()=>root.render(React.createElement(w.TableTest,{key:role,tableDocId:'test',user:{uid:'viewer',role,managedGames:[],balance:1000},clubSettings:{},onLeave(){},onCreateTable(){newTables++;},showToast:(m,type)=>messages.push({m,type})})));
const menu=async()=>React.act(()=>byTitle('Table menu').click());
(async()=>{
 await render('player');await React.act(()=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()==='Spectate the table').click());assert.ok(byTitle('Table menu'));await menu();
 assert.ok(byTitle('Sound on/off'));for(const t of ['Add chips','Sit out','Add bot','Fill empty seats with bots','Create a new table','Edit table settings'])assert.equal(byTitle(t),null,t+' is unavailable to a regular spectator');assert.equal(calls.length,0);
 for(const role of ['club_owner','manager','super_admin']){
  await render(role);await React.act(()=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()==='Spectate the table').click());await menu();
  const fill=byTitle('Fill empty seats with bots');assert.ok(fill);assert.ok(byTitle('Add bot'));assert.ok(byTitle('Create a new table'));assert.equal(byTitle('Add chips'),null);
  const before=calls.length;await React.act(async()=>{fill.click();fill.click();});assert.equal(calls.length,before+1);assert.equal(calls.at(-1).args.op,'fillbots');assert.equal(calls.at(-1).args.tableId,'test');
  await React.act(async()=>settle.reject(new Error('Insufficient club funds')));assert.equal(messages.at(-1).m,'Insufficient club funds');
  await menu();await React.act(async()=>byTitle('Fill empty seats with bots').click());await React.act(async()=>settle.resolve({ok:true,added:6}));assert.match(messages.at(-1).m,/6 bots/);
  await menu();await React.act(()=>byTitle('Create a new table').click());
 }
 assert.equal(newTables,3);
 w.fb.auth.currentUser={uid:'viewer',email:'aaci.yoni@gmail.com',emailVerified:true};
 const baseFx=w.fb.fx,board=['A','K','Q','J','10'].map(val=>({val,suit:'♠'}));w.fb.fx=(name,args)=>name==='godPeek'?Promise.resolve({hands:{},finalBoard:board}):baseFx(name,args);
 current.gameState={phase:'preflop',activeTurnUid:'other',turnStartedAt:Date.now(),highestBet:2,minRaise:2,handN:1,__seq:2,pots:[],board:[]};current.players={other:{uid:'other',name:'Other',stack:98,bet:2,cards:[],cardCount:2,status:'active',seatIndex:3}};
 await render('player');await render('super_admin');const watch=[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()==='Spectate the table');if(watch)await React.act(()=>watch.click());await menu();await React.act(async()=>byTitle('GOD view').click());
 const preview=doc.querySelector('[aria-label="GOD mode board preview"]');assert.ok(preview);assert.ok(preview.parentElement.classList.contains('poker-room'));assert.equal(preview.closest('.pt-stage'),null);assert.equal(preview.nextElementSibling.classList.contains('pt-stage'),true,'runout has its own row before the seat area');assert.equal(preview.querySelectorAll('.card-face').length,5);
 w.fb.auth.currentUser.emailVerified=false;await render('player');assert.equal(doc.querySelector('.poker-god-runout'),null,'unverified spectator cannot retain the privileged preview');w.fb.fx=baseFx;

 await React.act(async()=>root.render(React.createElement(w.CreateTest,{user:{uid:'viewer',role:'club_owner'},clubSettings:{},onBack(){},onCreated(){created++;},showToast:(m,type)=>messages.push({m,type})})));
 const select=doc.querySelector('[aria-label="Bots at table creation"]');assert.ok([...select.options].some(o=>o.value==='full'));await React.act(()=>{select.value='full';select.dispatchEvent(new w.Event('change',{bubbles:true}));});
 const create=[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()==='Open table');assert.ok(create);await React.act(async()=>create.click());assert.equal(calls.at(-1).name,'pkTableCreate');assert.equal(calls.at(-1).args.botCount,'full');await React.act(async()=>settle.resolve({tableId:'new'}));assert.equal(created,1);
 await React.act(()=>root.unmount());w.close();console.log('PASS: spectator menu, role-scoped bot controls, atomic fill request, error retry and fully populated table creation');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
