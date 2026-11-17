'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
let tableNext,current={type:'poker',authorityVersion:2,clubId:'main',settings:{serverEngine:true,maxPlayers:6,baseGameType:'NLH',blinds:1,minBuyIn:40,maxBuyIn:200},gameState:{__seq:1,phase:'waiting',board:[],pots:[],handN:1},players:{viewer:{uid:'viewer',name:'Viewer',stack:100,buyTotal:100,bet:0,status:'active',seatIndex:0,cards:[],cardCount:0},alice:{uid:'alice',name:'Alice',stack:150,buyTotal:100,bet:0,status:'active',seatIndex:1,cards:[],cardCount:0}}};
const ref=(...a)=>({id:a.at(-1),path:a.slice(1).join('/')});
const snapshot=()=>({id:'result-table',exists:()=>true,data:()=>structuredClone(current),metadata:{fromCache:false}});
const calls=[],pending=[];let deferred=false,value=-219,fail=false;
w.fb={db:{},auth:{currentUser:{uid:'viewer',email:'viewer@example.test',emailVerified:true}},doc:ref,collection:ref,query:r=>r,where:()=>({}),
 getDoc:async()=>({exists:()=>false}),getDocs:async()=>({docs:[]}),
 fx:async(name,args)=>{calls.push({name,args});if(name==='pkTableResult'){if(deferred)return new Promise((resolve,reject)=>pending.push({args,resolve,reject}));if(fail)throw Error('Denied');return{...args,result:value};}return{};},
 onSnapshot:(r,opts,fn)=>{const cb=typeof opts==='function'?opts:fn;let active=true;queueMicrotask(()=>{if(!active)return;if(r.path==='tables/result-table'){tableNext=cb;cb(snapshot());}else cb({exists:()=>false,docs:[]});});return()=>{active=false;};}};
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8'),source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function PokerTable('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.TableTest=PokerTable;window.ResultTest=TablePlayerResult;');w.eval(source);w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const panel=()=>doc.querySelector('.table-player-result'),resultCalls=()=>calls.filter(c=>c.name==='pkTableResult');
const render=async(role='player',status='approved')=>React.act(async()=>root.render(React.createElement(w.TableTest,{tableDocId:'result-table',user:{uid:'viewer',role,status,balance:1000},clubSettings:{name:'Club'},onLeave(){},showToast(){}})));
const open=async label=>React.act(async()=>doc.querySelector('[aria-label="View '+label+'"]').click());
const update=async()=>React.act(async()=>{current.gameState.__seq++;tableNext(snapshot());});
const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent===text);
(async()=>{try{
 await render();await open('Alice');assert.equal(panel(),null);assert.equal(resultCalls().length,0,'opponent result is never requested by a player');
 await open('your seat');assert.match(panel().textContent,/−219\.00/);assert.equal(panel().querySelector('[role=status]').dir,'ltr');assert.equal(resultCalls().at(-1).args.targetUid,'viewer');
 await render('agent');await open('Alice');assert.equal(panel(),null,'agent assignment does not expose other table results');
 for(const role of ['manager','club_owner','super_admin']){await render(role);await open('Alice');assert.ok(panel());assert.equal(resultCalls().at(-1).args.tableId,'result-table');assert.equal(resultCalls().at(-1).args.targetUid,'alice');}
 value=125.5;current.gameState.phase='showdown';await update();assert.match(panel().textContent,/\+125\.50/);assert.ok(panel().querySelector('.text-emerald-400'));
 value=0;current.gameState.handN++;await update();assert.equal(panel().querySelector('[role=status]').textContent,'0.00');
 const before=resultCalls().length;current.players.alice.bet=30;await update();assert.equal(resultCalls().length,before,'every bet does not reload historical results');
 current.players.alice.buyTotal=200;await update();assert.equal(resultCalls().length,before+1,'rebuy refreshes the authoritative total');
 await render('player');assert.equal(panel(),null,'demotion immediately removes another player result');
 await render('manager','banned');assert.equal(panel(),null,'banned management cannot see results');
 await render('manager');current.tournamentId='event';await update();assert.equal(panel(),null,'tournament chips are not misreported as cash profit');delete current.tournamentId;current.settings.spinMode=true;await update();assert.equal(panel(),null);current.settings.spinMode=false;
 await update();await open('your seat');fail=true;current.gameState.handN++;await update();assert.match(panel().textContent,/Could not load/);assert.equal(panel().querySelector('[role=status]'),null,'failed refresh removes stale result');
 fail=false;value=42;await React.act(async()=>button('Retry').click());assert.match(panel().textContent,/\+42\.00/);
 // Deferred reads cannot replace a newer table/player/account/hand result.
 deferred=true;
 const scope={tableId:'old',targetUid:'alice',viewerUid:'viewer',refreshKey:1};
 const probe=async patch=>React.act(async()=>root.render(React.createElement(w.ResultTest,{...scope,...patch})));
 await probe();assert.match(panel().textContent,/Loading/);const old=pending.at(-1);
 await probe({tableId:'new'});const latest=pending.at(-1);
 await React.act(async()=>old.resolve({...old.args,result:9999}));assert.doesNotMatch(panel().textContent,/9,999/);
 await React.act(async()=>latest.resolve({...latest.args,result:-100}));assert.match(panel().textContent,/−100\.00/);
 await probe({tableId:'new',refreshKey:2});const changed=pending.at(-1);w.fb.auth.currentUser.uid='different';
 await React.act(async()=>changed.resolve({...changed.args,result:555}));assert.doesNotMatch(panel().textContent,/555/);
 w.fb.auth.currentUser.uid='viewer';await probe({tableId:'new',targetUid:'bob'});const wrong=pending.at(-1);
 await React.act(async()=>wrong.resolve({tableId:'new',targetUid:'alice',result:888}));assert.match(panel().textContent,/Could not load/);assert.doesNotMatch(panel().textContent,/888/);
 assert.equal(calls.some(c=>['pkClubDirectory','pkGameHistory','godPeek','pkProfile'].includes(c.name)),false,'table profile never requests club totals or private cards');
 console.log('PASS: own/manager table results, role denial, exact signs, automatic updates, retries and stale response isolation');
 }finally{await React.act(()=>root.unmount());w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
