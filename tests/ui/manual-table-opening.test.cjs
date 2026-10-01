'use strict';
// Exercise actual owner App snapshots: filling or deleting games opens nothing.
// Only Firebase is simulated; no UI component or access predicate is replaced.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};
w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.ManualOnlyAppTest=App;window.retiredTwin=spawnTwinTable;');
w.eval(script);w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const HAIM='haim29071994@gmail.com';
const club={id:'main',name:'Manual Opening Regression Club',ownerUid:'haim-auth-uid',rakePct:6};
const record=(id,data)=>({id,exists:()=>data!==null,data:()=>structuredClone(data),metadata:{fromCache:false}});
const records=rows=>{const docs=rows.map(row=>record(row.id||row.uid,row));return{docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:false},forEach:fn=>docs.forEach(fn)};};
function firebaseFixture(email,membershipStatus){
 const identity={uid:'haim-auth-uid',email,emailVerified:true};
 // Profile metadata deliberately claims HAIM even for the ordinary identity.
 const profile={uid:identity.uid,username:'HAIM2907',email:HAIM,role:'player',status:'approved',playerId:'P123456789',balance:0};
 const membership={id:identity.uid+'_main',uid:identity.uid,clubId:'main',username:profile.username,role:'player',status:membershipStatus,balance:25};
 const other={id:'other_main',uid:'other',clubId:'main',username:'Other human player',role:'player',status:'approved',balance:80};
 const owner={id:'owner_main',uid:'owner',clubId:'main',username:'Owner',role:'club_owner',status:'approved',balance:1000};
 const calls=[],writes=[],tableSubscriptions=new Set();let tokenChanged,tableRows=[];
 const ref=(_, ...parts)=>({path:parts.join('/')});
 const snapshot=target=>{
  if(target.path==='users/'+identity.uid)return record(identity.uid,profile);
  if(target.path==='memberships/'+membership.id)return record(membership.id,membership);
  if(target.path==='clubs/main')return record('main',club);
  if(target.path==='clubs')return records([club]);
  if(target.path==='memberships')return records((target.filters?.some(f=>f[0]==='uid')?[membership]:[owner,membership,other]));
  if(target.path==='tables')return records(tableRows);if(target.path==='tournaments')return records([]);
  return record(target.path.split('/').at(-1),null);
 };
 const denyWrite=async()=>{writes.push(1);throw Error('This access regression must never write application data');};
 w.fb={db:{},auth:{currentUser:identity},
  onIdTokenChanged:(_,fn)=>{tokenChanged=fn;return()=>{};},
  onAuthStateChanged:()=>{throw Error('Management must observe identity-token refreshes, not just sign-in changes');},
  doc:ref,collection:ref,where:(...filter)=>filter,query:(target,...filters)=>({...target,filters}),
  getDoc:async target=>snapshot(target),getDocs:async target=>snapshot(target),
  onSnapshot:(target,options,next)=>{const fn=typeof options==='function'?options:next;if(target.path==='tables')tableSubscriptions.add(fn);fn(snapshot(target));return()=>tableSubscriptions.delete(fn);},
  fx:async(name,args)=>{
   calls.push({name,args});
   if(name==='pkEnsurePlayer')return{playerId:profile.playerId};
   if(name==='pkClubDirectory'&&args.reportSection)return{records:[],hasMore:false,nextCursor:null};
   if(name==='pkClubDirectory')return{members:[owner,membership,other],treasury:{uid:'owner',balance:1000},securityAlerts:[],agentLog:[],gameLog:[]};
   throw Error('Unexpected automatic callable: '+name);
  },
  updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite
 };
 return{identity,membership,calls,writes,refresh:()=>tokenChanged(identity),emitTables:rows=>{assert.ok(tableSubscriptions.size,'real App subscribes to tables');tableRows=rows;for(const fn of tableSubscriptions)fn(records(rows));}};
}
const manage=()=>[...doc.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Manage')||null;
async function mountAndEnter(fixture){
 w.localStorage.clear();
 await React.act(async()=>root.render(React.createElement(w.ManualOnlyAppTest)));
 await React.act(async()=>fixture.refresh());
 const enter=doc.querySelector('.blue-club-orb[role=button][aria-label^="Enter "]');
 assert.ok(enter,'the real club directory offers an authorized entry');
 await React.act(async()=>enter.click());
 assert.ok([...doc.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Clubs'),'club entry reaches the real app navigation');
}

const table=(id,count,patch={})=>({id,docId:id,clubId:'main',authorityVersion:2,type:'poker',createdAt:1,settings:{serverEngine:true,baseGameType:'NLH',blinds:1,minBuyIn:100,maxBuyIn:400,maxPlayers:6},players:Object.fromEntries(Array.from({length:count},(_,i)=>['bot_'+i,{uid:'bot_'+i,name:'Player '+i,isBot:true,stack:100,seatIndex:i}])),gameState:{phase:'waiting',handN:0,pots:[]},...patch});
(async()=>{
 const fixture=firebaseFixture('owner@example.test','approved');
 await mountAndEnter(fixture);
 assert.equal(w.__club.ownerUid,fixture.identity.uid,'the actual signed-in user owns this club');
 for(const rows of [[table('cash',5)],[table('cash',6)],[table('cash',5)],[],[table('cash',6)],[table('spin',2,{settings:{spinMode:true,spinBuyIn:50,maxPlayers:3}})],[table('spin',3,{settings:{spinMode:true,spinBuyIn:50,maxPlayers:3},spin:{started:true}})],[]]){
  await React.act(async()=>fixture.emitTables(rows));
 }
 assert.equal(fixture.calls.filter(c=>c.name==='pkTableCreate').length,0,'owner snapshot changes never create a cash or Spin twin');
 assert.equal(fixture.writes.length,0,'lobby snapshots never write legacy table documents');
 const before=fixture.calls.length;
 for(const type of ['poker','durak','ofc'])await w.retiredTwin({...table('old-client-callback',6),type},true);
 assert.equal(fixture.calls.length,before,'all retained automatic twin callbacks are inert');assert.equal(fixture.writes.length,0);
 await React.act(()=>root.unmount());w.close();
 console.log('PASS: actual owner App available/full/deleted cash and Spin snapshots never open twins; legacy automatic callbacks are inert');
})().catch(async error=>{console.error(error);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
