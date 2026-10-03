'use strict';
// Real BackofficeView / SettlementSection / pokerCommand; Firebase responses only are simulated.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};
w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.BackofficeTest=BackofficeView;window.selectTestClub=setActiveClub;');
w.eval(script);w.__pkMuted=true;
const doc=w.document,root=ReactDOM.createRoot(doc.getElementById('root'));
const club={id:'main',name:'Approval test club',ownerUid:'owner',rakePct:6};
const owner={id:'owner_main',uid:'owner',clubId:'main',username:'Owner',role:'club_owner',status:'approved',balance:1000};
const pending=name=>{const uid=name.toLowerCase().replace(/ /g,'_');return{id:uid+'_main',uid,clubId:'main',username:name,role:'player',status:'pending',balance:0};};
const rows=[owner,pending('New Alice'),pending('New Bob'),pending('New Carol')];
const calls=[],writes=[],toasts=[];let firstDirectory=true,initialReject,memberRequest,failDirectory=false,failAction=false,holdDirectories=false;
const heldDirectories=[];
const initialDirectory=new Promise((resolve,reject)=>{initialReject=reject;});
const serverError=()=>Object.assign(new Error('SECRET raw server diagnostic that must not appear'),{code:'functions/internal'});
const response=()=>({members:structuredClone(rows),treasury:{uid:'owner',balance:1000}});
const denyWrite=()=>{writes.push(1);throw Error('No direct client writes');};
const ref=(_, ...parts)=>({path:parts.join('/')});
w.fb={db:{},auth:{currentUser:{uid:'owner',email:'owner@example.invalid',emailVerified:true}},
 doc:ref,collection:ref,where:(...x)=>x,query:(q,...filters)=>({...q,filters}),
 getDoc:async()=>({exists:()=>false}),getDocs:async()=>({docs:[]}),
 fx:async(name,args)=>{
  calls.push({name,args});
  if(name==='pkClubDirectory'){
   if(args.directoryOnly){
    assert.equal(args.includeReports,undefined);assert.equal(args.includeSecurity,undefined,'approval list must not depend on activity logs');
    if(firstDirectory){firstDirectory=false;return initialDirectory;}
    if(failDirectory)throw serverError();
    if(holdDirectories)return new Promise(resolve=>heldDirectories.push(resolve));
    return response();
   }
   // Accounting can fail independently while approvals remain usable.
   throw serverError();
  }
  if(name==='pkClubMember'){
   if(failAction)throw serverError();
   return new Promise(resolve=>{memberRequest={args,complete:()=>{rows.find(r=>r.uid===args.targetUid).status=args.op==='approve'?'approved':'rejected';resolve({ok:true});}};});
  }
  throw Error('Unexpected callable '+name);
 },updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite};
w.selectTestClub(club);
const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const requestCard=name=>[...doc.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Approve').map(b=>b.parentElement.parentElement).find(card=>card.textContent.includes(name));
(async()=>{
 await React.act(async()=>root.render(React.createElement(w.BackofficeTest,{user:owner,clubSettings:club,tables:[],showToast:(message,type)=>toasts.push({message,type})})));
 assert.match(doc.body.textContent,/Loading club members/);
 assert.doesNotMatch(doc.body.textContent,/No pending requests|Join requests|Agents \(0\)/,'pending load is not an empty successful list');
 await React.act(async()=>initialReject(serverError()));
 assert.match(doc.querySelector('[role="alert"]').textContent,/Could not load club members.*internal/);
 assert.doesNotMatch(doc.body.textContent,/SECRET|No pending requests|Join requests/);
 assert.ok(button('Retry member list'));
 await React.act(async()=>button('Retry member list').click());
 assert.match(doc.body.textContent,/Join requests \(3\)/);
 assert.ok(requestCard('New Alice'));
 assert.match(doc.body.textContent,/Could not refresh security alerts.*internal/);
 assert.doesNotMatch(doc.body.textContent,/Weekly Settlement/,'settlement is no longer mounted in management');
 assert.doesNotMatch(doc.body.textContent,/Club rake \(verified humans\)/,'financial totals are separate from management');
 assert.doesNotMatch(doc.body.textContent,/SECRET/);

 const approve=requestCard('New Alice').querySelector('button');
 await React.act(async()=>approve.click());
 assert.equal(memberRequest.args.op,'approve');assert.equal(memberRequest.args.targetUid,'new_alice');
 assert.ok(memberRequest.args.requestId.length>=16);assert.equal(memberRequest.args.clubId,'main');
 assert.ok(button('Saving…')?.disabled,'approval is disabled until the callable confirms success');
 await React.act(async()=>approve.click());
 assert.equal(calls.filter(c=>c.name==='pkClubMember').length,1,'rapid duplicate approval is suppressed');
 await React.act(async()=>memberRequest.complete());
 assert.match(doc.body.textContent,/Join requests \(2\)/);
 assert.equal(requestCard('New Alice'),undefined,'confirmed player leaves pending list');
 assert.ok(toasts.some(t=>t.type==='success'&&t.message==='Player approved.'));
 assert.ok(calls.filter(c=>c.name==='pkClubDirectory'&&c.args.directoryOnly).length>=3,'successful decision refreshes server member data');

 failAction=true;
 await React.act(async()=>requestCard('New Bob').querySelector('button').click());
 assert.ok(requestCard('New Bob'),'failed approval retains the pending request');
 assert.ok(toasts.some(t=>/Could not approve player.*internal/.test(t.message)));
 assert.equal(toasts.some(t=>/SECRET/.test(t.message)),false);
 assert.equal(requestCard('New Bob').querySelector('button').disabled,false,'failed action can be retried');
 failAction=false;
 const reject=requestCard('New Bob').querySelectorAll('button')[1];
 await React.act(async()=>reject.click());
 assert.equal(memberRequest.args.op,'reject');
 await React.act(async()=>memberRequest.complete());
 assert.match(doc.body.textContent,/Join requests \(1\)/);
 assert.equal(requestCard('New Bob'),undefined,'rejected request must not reappear as pending');

 failDirectory=true;
 await React.act(async()=>w.dispatchEvent(new w.Event('pk-club-changed')));
 assert.match(doc.body.textContent,/Showing the last loaded member list/);
 assert.ok(requestCard('New Carol'),'a later polling failure preserves the last successful list');
 failDirectory=false;
 await React.act(async()=>button('Retry member list').click());
 assert.doesNotMatch(doc.body.textContent,/Could not load club members|Showing the last loaded member list/);
 assert.ok(requestCard('New Carol'));
 assert.equal(writes.length,0);
 // Revoke the same UID's manager role during a request: old promises cannot refill a narrower view.
 const manager={...owner,role:'manager'};
 await React.act(async()=>root.render(React.createElement(w.BackofficeTest,{user:manager,clubSettings:club,tables:[],showToast:(message,type)=>toasts.push({message,type})})));
 assert.ok(requestCard('New Carol'));
 holdDirectories=true;
 await React.act(async()=>w.dispatchEvent(new w.Event('pk-club-changed')));
 assert.equal(heldDirectories.length,1);
 const agent={...manager,role:'agent'};
 await React.act(async()=>root.render(React.createElement(w.BackofficeTest,{user:agent,clubSettings:club,tables:[],showToast:(message,type)=>toasts.push({message,type})})));
 assert.equal(heldDirectories.length,2,'different role scope does not reuse an authorized-manager request');
 assert.doesNotMatch(doc.body.textContent,/New Alice|New Carol|Players · Chips/,'old manager data is hidden before restricted reload');
 await React.act(async()=>heldDirectories[0](response()));
 assert.doesNotMatch(doc.body.textContent,/New Alice|New Carol/,'late previous-role response cannot restore old data');
 const assigned={...pending('Assigned newcomer'),agentUid:agent.uid};
 await React.act(async()=>heldDirectories[1]({members:[agent,assigned],treasury:null}));
 assert.match(doc.body.textContent,/Assigned newcomer/);
 assert.match(doc.body.textContent,/Awaiting manager approval/);
 assert.equal(button('Approve'),undefined,'agent sees referral status but no approval action denied by server');
 assert.doesNotMatch(doc.body.textContent,/New Alice|New Carol/);
 await React.act(()=>root.unmount());w.close();
 console.log('PASS: real Backoffice distinguishes failed/loading member requests, retries, approves/rejects via callable once, refreshes on success, and remains usable when accounting fails');
})().catch(async error=>{console.error(error);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
