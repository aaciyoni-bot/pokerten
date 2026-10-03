'use strict';
// Exercise the real App -> club entry -> navigation -> BackofficeView flow.
// Only Firebase is simulated; no UI component or access predicate is replaced.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};
w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.ManagementAppTest=App;');
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-settlement-ui.js'),'utf8'));
w.eval(script);w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const HAIM='haim29071994@gmail.com';
const club={id:'main',name:'Management Regression Club',ownerUid:'owner',rakePct:6};
const record=(id,data)=>({id,exists:()=>data!==null,data:()=>structuredClone(data),metadata:{fromCache:false}});
const records=rows=>{const docs=rows.map(row=>record(row.id||row.uid,row));return{docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:false},forEach:fn=>docs.forEach(fn)};};
function firebaseFixture(email,membershipStatus){
 const identity={uid:'haim-auth-uid',email,emailVerified:true};
 // Profile metadata deliberately claims HAIM even for the ordinary identity.
 const profile={uid:identity.uid,username:'HAIM2907',email:HAIM,role:'player',status:'approved',playerId:'P123456789',balance:0};
 const membership={id:identity.uid+'_main',uid:identity.uid,clubId:'main',username:profile.username,role:'player',status:membershipStatus,balance:25};
 const other={id:'other_main',uid:'other',clubId:'main',username:'Other human player',role:'player',status:'approved',balance:80};
 const owner={id:'owner_main',uid:'owner',clubId:'main',username:'Owner',role:'club_owner',status:'approved',balance:1000};
 const calls=[],writes=[];let tokenChanged;
 const ref=(_, ...parts)=>({path:parts.join('/')});
 const snapshot=target=>{
  if(target.path==='users/'+identity.uid)return record(identity.uid,profile);
  if(target.path==='memberships/'+membership.id)return record(membership.id,membership);
  if(target.path==='clubs/main')return record('main',club);
  if(target.path==='clubs')return records([club]);
  if(target.path==='memberships')return records((target.filters?.some(f=>f[0]==='uid')?[membership]:[owner,membership,other]));
  if(target.path==='tables'||target.path==='tournaments')return records([]);
  return record(target.path.split('/').at(-1),null);
 };
 const denyWrite=async()=>{writes.push(1);throw Error('This access regression must never write application data');};
 w.fb={db:{},auth:{currentUser:identity},
  onIdTokenChanged:(_,fn)=>{tokenChanged=fn;return()=>{};},
  onAuthStateChanged:()=>{throw Error('Management must observe identity-token refreshes, not just sign-in changes');},
  doc:ref,collection:ref,where:(...filter)=>filter,query:(target,...filters)=>({...target,filters}),
  getDoc:async target=>snapshot(target),getDocs:async target=>snapshot(target),
  onSnapshot:(target,options,next)=>{const fn=typeof options==='function'?options:next;fn(snapshot(target));return()=>{};},
  fx:async(name,args)=>{
   calls.push({name,args});
   if(name==='pkSettlementTerms')return{role:'owner',members:[]};
   if(name==='pkEnsurePlayer')return{playerId:profile.playerId};
   if(name==='pkClubDirectory'&&args.accountingOnly)return{accounting:{players:{[membership.uid]:{balance:membership.balance,chips:membership.balance,totalResult:-200,result:-200,onTables:0}}}};
   if(name==='pkClubDirectory'&&args.reportSection)return{records:[],hasMore:false,nextCursor:null};
   if(name==='pkClubDirectory')return{members:[owner,membership,other],treasury:{uid:'owner',balance:1000},securityAlerts:[],agentLog:[],gameLog:[]};
   throw Error('Unexpected callable during management navigation: '+name);
  },
  updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite
 };
 return{identity,membership,calls,writes,refresh:()=>tokenChanged(identity)};
}
const manage=()=>[...doc.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Manage')||null;
async function mountAndEnter(fixture){
 w.localStorage.clear();
 await React.act(async()=>root.render(React.createElement(w.ManagementAppTest)));
 await React.act(async()=>fixture.refresh());
 const enter=doc.querySelector('.blue-club-orb[role=button][aria-label^="Enter "]');
 assert.ok(enter,'the real club directory offers an authorized entry');
 await React.act(async()=>enter.click());
 assert.ok([...doc.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Clubs'),'club entry reaches the real app navigation');
}
async function assertFullManagement(fixture){
 assert.ok(manage(),'verified HAIM has the top Manage button despite stale membership metadata');
 await React.act(async()=>manage().click());
 assert.ok(doc.querySelector('.club-admin'),'the Manage button opens BackofficeView');
 assert.ok(doc.getElementById('bo-settings'),'full Club Settings are mounted');
 assert.ok(doc.getElementById('bo-players'),'member management is mounted');
 assert.ok(doc.getElementById('bo-terms'),'terms management is mounted');
 assert.match(doc.body.textContent,/Club Settings/);
 assert.doesNotMatch(doc.body.textContent,/Export full club report|Weekly Settlement/);
 assert.match(doc.body.textContent,/Other human player/);
 assert.ok(doc.querySelector('[title="Set role and agent assignment"]'),'management includes member-role controls');
 assert.ok(fixture.calls.some(call=>call.name==='pkClubDirectory'&&call.args.reportSection==='securityAlerts'));
 assert.equal(fixture.calls.some(call=>call.name==='pkClubDirectory'&&call.args.reportSection==='gameLog'),false);
 assert.equal(fixture.writes.length,0,'oversight entry must not create or promote a membership');
}
(async()=>{
 const haim=firebaseFixture(HAIM,'pending');
 await mountAndEnter(haim);
 await assertFullManagement(haim);
 assert.equal(haim.membership.role,'player');assert.equal(haim.membership.status,'pending');
 // Revocation changes the trusted identity on the same mounted App and UID.
 haim.identity.emailVerified=false;
 await React.act(async()=>haim.refresh());
 assert.equal(manage(),null,'an unverified identity cannot retain Manage');
 assert.equal(doc.querySelector('.club-admin'),null,'revocation removes the privileged view');
 await React.act(()=>root.render(null));

 const ordinary=firebaseFixture('ordinary@example.invalid','approved');
 await mountAndEnter(ordinary);
 assert.equal(manage(),null,'an ordinary approved player gets no Manage button from HAIM profile name/email');
 assert.equal(doc.querySelector('.club-admin'),null);
 assert.equal(ordinary.calls.some(call=>call.name==='pkClubDirectory'&&!call.args.accountingOnly),false,'ordinary club entry loads only its own totals, never management reports');
 // A verified identity refresh must update access without signing out/remounting.
 ordinary.identity.email=HAIM;
 await React.act(async()=>ordinary.refresh());
 await assertFullManagement(ordinary);
 assert.equal(ordinary.calls.filter(call=>call.name==='pkEnsurePlayer').length,2,'both initial login and token refresh load the effective account');
 await React.act(()=>root.unmount());w.close();
 console.log('PASS: real App club entry grants verified HAIM full management with stale membership, denies forged profile identity, and follows token refresh/revocation');
})().catch(async error=>{console.error(error);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
