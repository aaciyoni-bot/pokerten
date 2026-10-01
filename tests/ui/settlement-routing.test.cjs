'use strict';
// Exercise the real App -> club entry -> both report links -> internal report/back flow.
// Only Firebase is simulated; no UI component or access predicate is replaced.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};
w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.ManagementAppTest=App;');
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-auth.js'),'utf8'));
w.eval(fs.readFileSync(require.resolve('../../assets/js/club-ui.js'),'utf8'));
w.eval(script);w.__pkMuted=true;
w.open=()=>assert.fail('Reports must not open another site or lose the current authenticated session');
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const HAIM='haim29071994@gmail.com';
const club={id:'main',name:'Management Regression Club',ownerUid:'owner',rakePct:6};
const record=(id,data)=>({id,exists:()=>data!==null,data:()=>structuredClone(data),metadata:{fromCache:false}});
const records=rows=>{const docs=rows.map(row=>record(row.id||row.uid,row));return{docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:false},forEach:fn=>docs.forEach(fn)};};
function firebaseFixture(email,membershipStatus,role='player'){
 const identity={uid:'haim-auth-uid',email,emailVerified:true};
 // Profile metadata deliberately claims HAIM even for the ordinary identity.
 const profile={uid:identity.uid,username:'HAIM2907',email:HAIM,role:'player',status:'approved',playerId:'P123456789',balance:0};
 const membership={id:identity.uid+'_main',uid:identity.uid,clubId:'main',username:profile.username,role,status:membershipStatus,balance:25};
 const other={id:'other_main',uid:'other',clubId:'main',username:'Other human player',role:'player',status:'approved',balance:80};
 const owner={id:'owner_main',uid:'owner',clubId:'main',username:'Owner',role:'club_owner',status:'approved',balance:1000};
 const calls=[],writes=[],queries=[];let tokenChanged,reportDenied=false;
 const ref=(_, ...parts)=>({path:parts.join('/')});
 const snapshot=target=>{
  if(target.path==='users/'+identity.uid)return record(identity.uid,profile);
  if(target.path==='memberships/'+membership.id)return record(membership.id,membership);
  if(target.path==='clubs/main')return record('main',club);
  if(target.path==='clubs')return records([club]);
  if(target.path==='memberships')return records((target.filters?.some(f=>f[0]==='uid')?[membership]:[owner,membership,other]));
  if(target.path==='tables'||target.path==='tournaments')return records([]);
  if(target.path==='gameLog')return records([{id:'own-result',uid:identity.uid,game:'NLH',clubId:'main',profit:25,at:Date.now()},{id:'other-result',uid:'other',game:'NLH',clubId:'main',profit:999,at:Date.now()}].filter(row=>(target.filters||[]).every(([key,op,value])=>op==='=='&&row[key]===value)));
  return record(target.path.split('/').at(-1),null);
 };
 const denyWrite=async()=>{writes.push(1);throw Error('This access regression must never write application data');};
 w.fb={db:{},auth:{currentUser:identity},
  onIdTokenChanged:(_,fn)=>{tokenChanged=fn;return()=>{};},
  onAuthStateChanged:()=>{throw Error('Management must observe identity-token refreshes, not just sign-in changes');},
  doc:ref,collection:ref,where:(...filter)=>filter,query:(target,...filters)=>({...target,filters}),
  getDoc:async target=>snapshot(target),getDocs:async target=>{queries.push(target);return snapshot(target);},
  onSnapshot:(target,options,next)=>{const fn=typeof options==='function'?options:next;fn(snapshot(target));return()=>{};},
  fx:async(name,args)=>{
   calls.push({name,args});
   if(name==='pkEnsurePlayer')return{playerId:profile.playerId};
   if(name==='pkClubDirectory'&&reportDenied)throw Object.assign(new Error('Club staff only'),{code:'functions/permission-denied'});
   if(name==='pkClubDirectory'&&args.reportSection)return{records:[],hasMore:false,nextCursor:null};
   if(name==='pkClubDirectory')return{members:[owner,membership,other],treasury:{uid:'owner',balance:1000},securityAlerts:[],agentLog:[],gameLog:[]};
   throw Error('Unexpected callable during management navigation: '+name);
  },
  updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite
 };
 return{identity,membership,calls,writes,queries,denyReports:value=>{reportDenied=value;},refresh:()=>tokenChanged(identity)};
}
const manage=()=>[...doc.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Manage')||null;
async function mountAndEnter(fixture){
 w.localStorage.clear();
 await React.act(async()=>root.render(React.createElement(w.ManagementAppTest)));
 await React.act(async()=>fixture.refresh());
 const enter=[...doc.querySelectorAll('button.cl-cta')].find(button=>button.textContent.trim()==='Enter club');
 assert.ok(enter,'the real club directory offers an authorized entry');
 await React.act(async()=>enter.click());
 assert.ok([...doc.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Clubs'),'club entry reaches the real app navigation');
}
const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const reportLink=label=>doc.querySelector('button[aria-label="'+label+'"]');
const back=async()=>{assert.ok(button('Back to lobby'));await React.act(async()=>button('Back to lobby').click());assert.ok(button('Cashier'));};
async function assertStaffLinks(fixture){
 for(const source of ['lobby','cashier']){
  if(source==='cashier')await React.act(async()=>button('Cashier').click());
  const links=[...doc.querySelectorAll('button[aria-label="Club settlement"]')];
  assert.equal(links.length,source==='cashier'?2:1);
  await React.act(async()=>links.at(source==='cashier'?-1:0).click());
  assert.equal(new URL(w.location.href).searchParams.get('v'),'settlement');
  assert.match(doc.body.textContent,/Weekly Settlement/);
  assert.match(doc.body.textContent,/Other human player/);
  const call=fixture.calls.findLast(c=>c.name==='pkClubDirectory');
  assert.equal(call.args.clubId,'main');assert.equal(call.args.reportSection,'gameLog');
  assert.equal(button('Close'),undefined,'cashier dialog is gone after report navigation');
  await back();
 }
 assert.equal(fixture.writes.length,0,'reading settlement must not write profiles, memberships or balances');
}
async function assertPlayerLinks(fixture){
 assert.equal(manage(),null,'card viewing or a profile claim must not grant club management');
 for(const source of ['lobby','cashier']){
  if(source==='cashier')await React.act(async()=>button('Cashier').click());
  const links=[...doc.querySelectorAll('button[aria-label="My results"]')];
  assert.equal(links.length,source==='cashier'?2:1);
  await React.act(async()=>links.at(source==='cashier'?-1:0).click());
  assert.equal(new URL(w.location.href).searchParams.get('v'),'profile');
  assert.match(doc.body.textContent,/My game report/);
  assert.equal(doc.querySelector('.club-admin'),null);
  assert.equal(fixture.calls.some(c=>c.name==='pkClubDirectory'),false);
  const query=fixture.queries.findLast(q=>q.path==='gameLog');
  assert.deepEqual(query.filters,[['uid','==',fixture.identity.uid]],'existing personal history stays scoped to the signed-in user');
  assert.doesNotMatch(doc.body.textContent,/Other human player/);
  await back();
 }
 assert.equal(fixture.writes.length,0);
}
(async()=>{
 const haim=firebaseFixture(HAIM,'pending');await mountAndEnter(haim);await assertStaffLinks(haim);
 // A permission failure must remain an error with recovery, never turn into an empty successful report.
 haim.denyReports(true);await React.act(async()=>reportLink('Club settlement').click());
 assert.match(doc.querySelector('[role="alert"]').textContent,/אין הרשאה/);assert.doesNotMatch(doc.body.textContent,/Weekly Settlement/);
 haim.denyReports(false);await React.act(async()=>button('נסה שוב').click());assert.match(doc.body.textContent,/Weekly Settlement/);await back();
 await React.act(()=>root.render(null));
 const godOnly=firebaseFixture('info.bagso@gmail.com','approved');await mountAndEnter(godOnly);await assertPlayerLinks(godOnly);await React.act(()=>root.render(null));
 const ordinary=firebaseFixture('ordinary@example.invalid','approved');await mountAndEnter(ordinary);await assertPlayerLinks(ordinary);await React.act(()=>root.render(null));
 const manager=firebaseFixture('manager@example.invalid','approved','manager');await mountAndEnter(manager);await assertStaffLinks(manager);
 await React.act(()=>root.unmount());w.close();
 console.log('PASS: both report links keep the session, show staff club settlement or own-player history, retain back/retry, and never promote GOD card access into management');
})().catch(async error=>{console.error(error);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
