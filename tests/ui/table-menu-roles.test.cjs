'use strict';
const assertEnglishUi=require('./english-ui.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
const calls=[];let tableNext,tokenNext,managed=0,created=0;
let current={authorityVersion:2,clubId:'main',settings:{serverEngine:true,maxPlayers:6,baseGameType:'NLH',blinds:1,minBuyIn:40,maxBuyIn:200,straddle:true,actionTime:30},gameState:{__seq:1,phase:'waiting',board:[],pots:[],handN:1},players:{a:{uid:'a',name:'Alpha',stack:100,bet:0,status:'active',seatIndex:1,cards:[],cardCount:0},b:{uid:'b',name:'Beta',stack:100,bet:0,status:'active',seatIndex:2,cards:[],cardCount:0}}};
const ref=(...a)=>({id:a.at(-1),path:a.slice(1).join('/')});
const snapshot=()=>({id:'menu-test',exists:()=>true,data:()=>structuredClone(current),metadata:{fromCache:false}});
w.fb={db:{},auth:{currentUser:{uid:'viewer',email:'player@example.invalid',emailVerified:true}},doc:ref,collection:ref,query:r=>r,where:()=>({}),
 onIdTokenChanged:(_,cb)=>{tokenNext=cb;return()=>{tokenNext=null;};},
 getDoc:async()=>({exists:()=>false}),getDocs:async()=>({docs:[]}),
 fx:async(name,args)=>{calls.push({name,args});return name==='godPeek'?{tableId:args.tableId,contextKey:args.contextKey,hands:{},finalBoard:[]}:{ok:true};},
 onSnapshot:(r,opts,fn)=>{const cb=typeof opts==='function'?opts:fn;let active=true;queueMicrotask(()=>{if(!active)return;if(r.path==='tables/menu-test'){tableNext=cb;cb(snapshot());}else cb({exists:()=>false,docs:[]});});return()=>{active=false;};}};
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8'),source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function PokerTable('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.TableTest=PokerTable;');w.eval(source);w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const title=t=>doc.querySelector('button[title="'+t+'"]');
const privileged=['GOD view','Add bot','Fill empty seats with bots','Create a new table','Deal now','Force-unstick a frozen table','Edit table settings','Sit out and open Club Management'];
const staff=['Add bot','Fill empty seats with bots','Create a new table','Edit table settings','Sit out and open Club Management'];
let user={uid:'viewer',role:'player',status:'approved',balance:1000};
async function render(patch={}){
 user={uid:'viewer',role:'player',status:'approved',balance:1000,...patch};
 // Always supply callbacks: visibility must be enforced inside this component.
 await React.act(async()=>root.render(React.createElement(w.TableTest,{tableDocId:'menu-test',user,clubSettings:{name:'Club'},onManage(){managed++;},onCreateTable(){created++;},onLeave(){},showToast(){}})));
 const watch=[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()==='Spectate the table');if(watch)await React.act(()=>watch.click());
 if(!doc.querySelector('.poker-menu-panel'))await React.act(()=>title('Table menu').click());
 assertEnglishUi(doc.querySelector('.poker-menu-panel'),'Table menu '+user.role+' '+user.status);
}
async function update(){await React.act(async()=>{current.gameState.__seq++;tableNext(snapshot());});assertEnglishUi(doc.querySelector('.poker-menu-panel'),'Updated table menu');}
function absent(titles,label){for(const t of titles)assert.equal(!!title(t),false,label+': '+t+' stays absent from the DOM');}
function present(titles,label){for(const t of titles)assert.ok(title(t),label+': '+t+' is available');}
(async()=>{try{
 for(const role of ['player','agent']){
  await render({role});absent(privileged,role);
  assert.ok(doc.querySelector('[aria-label="Table details"]'));present(['Hand history','My table look — only you see it','Sound on/off'],role);
  assert.ok(doc.querySelector('[aria-label="Sound volume"]'));assert.ok(doc.querySelector('[aria-label="Leave table"]'));
 }
 for(const status of ['pending','banned'])for(const role of ['manager','club_owner','super_admin']){
  await render({role,status});absent(privileged,status+' '+role);
 }
 for(const role of ['manager','club_owner']){
  await render({role});present(staff,role);absent(['GOD view','Deal now','Force-unstick a frozen table'],role);
 }
 await render({role:'super_admin'});present([...staff,'Deal now','Force-unstick a frozen table'],'super admin');absent(['GOD view'],'role alone');
 // No prior admin render, role flag or callback may persist after demotion.
 await render({role:'player',email:'haim29071994@gmail.com',godMode:true});absent(privileged,'demoted player with forged profile GOD fields');
 // A GOD-only account has peek access without gaining management permissions.
 w.fb.auth.currentUser={uid:'viewer',email:'info.bagso@gmail.com',emailVerified:true};await render();present(['GOD view'],'verified GOD');absent(privileged.filter(t=>t!=='GOD view'),'GOD-only player');
 assert.equal(calls.filter(c=>c.name==='godPeek').length,0,'opening a menu never requests hidden cards');
 w.fb.auth.currentUser.emailVerified=false;
 await React.act(async()=>tokenNext(w.fb.auth.currentUser));absent(privileged,'verification revoked while menu open');
 w.fb.auth.currentUser={uid:'another-user',email:'haim29071994@gmail.com',emailVerified:true};await render();absent(privileged,'different signed-in UID');
 // Verified oversight keeps its existing owner/manager-equivalent access.
 w.fb.auth.currentUser={uid:'viewer',email:'haim29071994@gmail.com',emailVerified:true};await render();present([...staff,'GOD view'],'verified oversight player');absent(['Deal now','Force-unstick a frozen table'],'oversight player role');
 w.fb.auth.currentUser={uid:'viewer',email:'player@example.invalid',emailVerified:true};await render({role:'manager'});
 current.tournamentId='event1';await update();absent(['Add bot','Fill empty seats with bots','Edit table settings'],'tournament');
 delete current.tournamentId;current.closeRequested={by:'owner',at:Date.now()};await update();absent(['Add bot','Fill empty seats with bots','Edit table settings'],'closing table');
 delete current.closeRequested;current.settings.spinMode=true;current.spin={};await update();absent(['Add bot','Fill empty seats with bots','Edit table settings'],'started Spin');
 current.settings.spinMode=false;delete current.spin;
 current.players.viewer={uid:'viewer',name:'Viewer',stack:100,bet:0,status:'active',seatIndex:0,cards:[],cardCount:0};await update();await render();
 absent(privileged,'seated ordinary player');present(['Add chips','Sit out','Straddle when eligible (2×BB blind — you act last preflop)'],'seated player');
 assert.ok(doc.querySelector('[aria-label="Stand up"]'));
 current.tournamentId='event1';await update();absent(['Add chips','Straddle when eligible (2×BB blind — you act last preflop)'],'seated tournament player');
 delete current.tournamentId;current.settings.spinMode=true;current.spin={};await update();absent(['Add chips','Straddle when eligible (2×BB blind — you act last preflop)'],'seated Spin player');
 present(['Sit out'],'seated Spin player');assert.ok(doc.querySelector('[aria-label="Stand up"]'),'Spin retains seat exit control');
 assert.equal(managed,0);assert.equal(created,0);assert.equal(calls.filter(c=>['pkTableManage','pkTableCreate','pkDeal','godPeek'].includes(c.name)||c.name==='pkSeat'&&c.args.op!=='heartbeat').length,0,'opening menus causes no financial or privileged command');
 console.log('PASS: table-menu role matrix, callback defense, pending/banned denial, demotion, GOD identity/revocation and cash/tournament/Spin limits');
 }finally{await React.act(()=>root.unmount());w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
