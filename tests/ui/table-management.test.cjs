'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const calls=[],writes=[],messages=[],joined=[];let settle,createOpened=0;w.confirm=()=>true;
const forbidden=async()=>{writes.push(1);throw new Error('Client table writes are forbidden');};
w.fb={db:{},auth:{currentUser:{uid:'owner'}},fx:(name,args)=>{if(name==='pkClubDirectory'&&args.accountingOnly)return Promise.resolve({accounting:{players:{}}});calls.push({name,args});return new Promise((resolve,reject)=>{settle={resolve,reject};});},updateDoc:forbidden,addDoc:forbidden,setDoc:forbidden,runTransaction:forbidden,getDocs:async()=>({docs:[]}),getDoc:async()=>({exists:()=>false}),doc:()=>({}),collection:()=>({}),query:()=>({}),where:()=>({}),onSnapshot:()=>()=>{}};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function LobbyView('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.LobbyTest=LobbyView;window.ChatHook=useTableChat;');w.eval(script);
const root=ReactDOM.createRoot(w.document.getElementById('root'));
const toast=(m,type)=>messages.push({m,type}),user={uid:'owner',role:'club_owner',username:'Owner'};
const table=(id,patch={})=>({docId:id,clubId:'main',type:'poker',authorityVersion:2,settings:{serverEngine:true,baseGameType:'NLH',tableName:id,minBuyIn:40,maxBuyIn:200,maxPlayers:6,blinds:1},players:{},gameState:{phase:'waiting'},...patch});
const render=async(t,tournaments=[],viewer=user)=>React.act(async()=>root.render(React.createElement(w.LobbyTest,{tablesLoaded:true,user:viewer,tables:Array.isArray(t)?t:[t],tournaments,clubSettings:{},tab:'poker',setTab(){},onJoinPoker:t=>joined.push(t.docId),onCreatePoker:()=>createOpened++,showToast:toast})));
const del=()=>w.document.querySelector('button[aria-label="Delete table"]');
(async()=>{
 await render(table('empty'));
 const create=w.document.querySelector('button[aria-label="New poker table"]');assert.ok(create);assert.equal(create.closest('details'),null,'New table is directly available without opening a menu');
 await React.act(()=>create.click());assert.equal(createOpened,1,'New table opens the existing creation flow');assert.equal(calls.length,0,'Opening the form does not create or charge for a table');
 await React.act(async()=>{del().click();del().click();});assert.equal(calls.length,1);assert.ok(del().disabled);assert.equal(calls[0].name,'pkTableManage');assert.equal(calls[0].args.op,'delete');assert.equal(calls[0].args.tableId,'empty');assert.ok(calls[0].args.requestId.length>=16);
 await React.act(async()=>settle.reject(new Error('Only the club owner or an assigned poker manager can manage tables')));assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).m,/assigned poker manager/);assert.equal(del().disabled,false);
 await React.act(async()=>del().click());assert.notEqual(calls[0].args.requestId,calls[1].args.requestId);await React.act(async()=>settle.resolve({ok:true,deleted:true,queued:false}));assert.ok(del().disabled);assert.equal(messages.at(-1).type,'success');
 await render(table('live'));await React.act(async()=>del().click());await React.act(async()=>settle.resolve({ok:true,queued:true,deleted:false}));assert.match(messages.at(-1).m,/after this hand/);assert.ok(del().disabled);assert.match(del().title,/Closing/);
 await render(table('other-client-close',{closeRequested:{at:1,by:'owner'}}));assert.ok(del().disabled);assert.match(w.document.body.textContent,/Closing after this hand/);
 await render(table('limits'));await React.act(()=>w.document.querySelector('button[title="Edit table settings"]').click());
 const save=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Save');await React.act(async()=>save.click());assert.equal(calls.at(-1).name,'pkTableManage');assert.equal(calls.at(-1).args.op,'settings');assert.equal(calls.at(-1).args.tableId,'limits');assert.equal(calls.at(-1).args.patch.minBuyIn,40);assert.equal(calls.at(-1).args.patch.maxBuyIn,200);assert.equal(calls.at(-1).args.patch.blinds,1);assert.equal(calls.at(-1).args.patch.rakePercent,0);await React.act(async()=>settle.resolve({ok:true}));
 await render(table('seated',{players:{owner:{uid:'owner',name:'Owner',stack:100,status:'active',seatIndex:0}}}));
 const giveUp=w.document.querySelector('[title="Give up this seat"]');assert.ok(giveUp);await React.act(async()=>{giveUp.click();giveUp.click();});assert.equal(calls.at(-1).name,'pkLeave');assert.equal(calls.at(-1).args.tableId,'seated');const count=calls.length;await React.act(async()=>settle.resolve({ok:true,queued:true}));assert.equal(calls.length,count);assert.match(messages.at(-1).m,/when this hand ends/);
 await render(table('spin',{settings:{spinMode:true,spinBuyIn:10,maxPlayers:3,serverEngine:true},spin:{prize:30}}));assert.equal(w.document.querySelector('button[title="Edit table settings"]'),null);await React.act(async()=>del().click());assert.match(messages.at(-1).m,/Spin must finish/);assert.equal(calls.length,count);
 // A retained result seat is not active membership. Check both subscriptions:
 // table flags can lag the terminal/missing/archived parent tournament snapshot.
 const event={id:'old-event',clubId:'main',game:'poker',name:'Old event',status:'running',startAt:1,startedAt:1,startStack:1000,prizePool:100,buyIn:10,maxPlayers:9,minPlayers:2,payouts:[100],players:{owner:{uid:'owner',name:'Owner'}}};
 const seat=table('tournament-result',{tournamentId:event.id,tournament:{finished:false},players:{owner:{uid:'owner',stack:2000,status:'waiting',sitOut:true}}});
 const resume=()=>w.document.querySelector('[data-resume-table="tournament-result"]');
 await render(seat,[event]);assert.ok(resume(),'a sitting-out player can return to a running tournament');
 await React.act(()=>resume().click());assert.deepEqual(joined,['tournament-result']);
 const beforeResumeChecks=calls.length;
 for(const parent of [{...event,status:'done'},{...event,status:'cancelled'},{...event,status:'reg'},{...event,archived:true},{...event,clubId:'other-club'},{...event,players:{}},{...event,players:{owner:{...event.players.owner,out:true}}},{...event,players:{owner:{...event.players.owner,removed:true}}}]){
  await render(seat,[parent]);assert.equal(resume(),null,'inactive or removed participation does not offer a return');
 }
 await render(seat,[]);assert.equal(resume(),null,'missing/deleted or not-yet-loaded tournament cannot claim an active seat');
 for(const patch of [{tournament:{finished:true}},{tournament:{cancelled:true}},{archived:true},{players:{owner:{...seat.players.owner,left:true}}},{players:{owner:{...seat.players.owner,status:'left'}}},{players:{owner:{...seat.players.owner,status:'out'}}}]){
  await render({...seat,...patch},[event]);assert.equal(resume(),null,'table departure and completion flags override a stale running parent');
 }
 await render(seat,[event]);assert.ok(resume(),'a fresh active snapshot restores the shortcut');
 await render(seat,[{...event,status:'done'}]);assert.equal(resume(),null,'finishing removes the banner without a refresh');
 await React.act(()=>w.document.querySelector('button[aria-label="New poker table"]').click());assert.equal(createOpened,2,'old tournament history never blocks opening a new table');
 assert.equal(calls.length,beforeResumeChecks,'resume filtering never deletes history, refunds seats or sends game commands');
 // Two retained champion seats, including a stale unfinished table flag, must
 // disappear from the active lobby together while their result history remains.
 const past=[{...event,status:'done',finishedAt:100,results:[{uid:'owner',name:'Owner',rank:1,prize:100}],finalPrizePool:100},{...event,id:'second-ended',name:'Second ended event',status:'done',finishedAt:200,results:[{uid:'owner',name:'Owner',rank:1,prize:200}],finalPrizePool:200}];
 const retained=[seat,{...seat,docId:'second-result',tournamentId:'second-ended',tournament:{finished:true}}];
 await render(retained,past);
 assert.equal(w.document.querySelectorAll('[data-resume-table]').length,0,'neither ended event offers a return');
 assert.equal(w.document.querySelectorAll('[data-tournament-row]').length,0,'ended events are absent from the default active list');
 const history=()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Tournament history'));
 assert.match(history().textContent,/2/);await React.act(()=>history().click());
 assert.deepEqual([...w.document.querySelectorAll('[data-tournament-row]')].map(e=>e.dataset.tournamentRow),['second-ended','old-event'],'history lists newest results first');
 await React.act(()=>w.document.querySelector('[data-tournament-row="second-ended"]').click());
 await React.act(()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Final results')).click());
 assert.match(w.document.querySelector('.pt-tour-results').textContent,/200.00/,'recorded prizes remain available');
 await React.act(()=>[...w.document.querySelectorAll('.pt-tour-close')].at(-1).click());
 await React.act(()=>w.document.querySelector('.pt-tour-close').click());
 await React.act(()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Active tournaments').click());
 assert.equal(w.document.querySelectorAll('[data-tournament-row]').length,0);
 assert.equal(calls.length,beforeResumeChecks,'history viewing sends no mutation or refund command');
 for(const viewer of [{...user,role:'player'},{...user,role:'manager',status:'banned'}]){await render(seat,[],viewer);assert.equal(w.document.querySelector('button[aria-label="New poker table"]'),null,'table creation keeps existing authorization');}
 const Hook=()=>{const h=w.ChatHook({chat:[],players:{}},'floor-table',user,'poker',toast);return React.createElement(React.Fragment,null,React.createElement('button',{onClick:h.callFloor},'Call floor'),React.createElement('button',{onClick:h.clearFloor},'Clear floor'));};
 await React.act(async()=>root.render(React.createElement(Hook)));const buttons=()=>[...w.document.querySelectorAll('button')];
 await React.act(async()=>buttons()[0].click());assert.equal(calls.at(-1).name,'pkSeat');assert.equal(calls.at(-1).args.op,'floor');await React.act(async()=>settle.reject(new Error('Connection unavailable')));assert.equal(messages.at(-1).type,'error');assert.equal(messages.at(-1).m,'Connection unavailable','a failed floor call must not claim a manager was notified');
 await React.act(async()=>buttons()[0].click());await React.act(async()=>settle.resolve({ok:true}));assert.equal(messages.at(-1).type,'success');
 await React.act(async()=>buttons()[1].click());assert.equal(calls.at(-1).name,'pkTableManage');assert.equal(calls.at(-1).args.op,'clear-floor');await React.act(async()=>settle.resolve({ok:true}));
 assert.equal(writes.length,0,'management never edits balances or table state in the browser');await React.act(()=>root.unmount());w.close();console.log('PASS: lobby deletion, limits, leaving and floor requests use server authority, show failures and prevent duplicate requests');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
