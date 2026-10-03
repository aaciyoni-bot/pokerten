'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')},{Simulate}=require('react-dom/test-utils');w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
const members=[{uid:'owner',username:'Owner',role:'club_owner',status:'approved',balance:5000},{uid:'agent',username:'Agent',role:'agent',status:'approved',balance:0,agentCode:'DEMO123'},{uid:'loss',username:'Alice',role:'player',status:'approved',agentUid:'agent',balance:159.83},{uid:'win',username:'Bob',role:'player',status:'approved',agentUid:'agent',balance:1000}].map(m=>({...m,id:m.uid+'_main',clubId:'main'}));
const now=Date.now(),logs=[{uid:'loss',profit:-340.17,rake:8,at:now},{uid:'win',profit:500,rake:3,at:now}];
let god=false;
const report=()=>require('../../functions/pokerAccounting').buildAccounting(members,logs,[],{now,ownerUid:'owner',god});
const deny=()=>{throw Error('Unexpected write in accounting UI');};
w.fb={db:{},auth:{currentUser:{uid:'owner',email:'owner@example.test',emailVerified:true}},doc:()=>({}),collection:()=>({}),query:r=>r,where:()=>({}),getDoc:async()=>({exists:()=>false}),getDocs:async()=>({docs:[]}),fx:async(name,args)=>{
 if(name==='pkClubDirectory'){if(args.accountingOnly)return{accounting:report()};if(args.reportSection)return{records:[],hasMore:false,nextCursor:null};return{members,treasury:{uid:'owner',balance:5000}};}
 throw Error('Unexpected callable '+name);
},setDoc:deny,updateDoc:deny,addDoc:deny,runTransaction:deny};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');w.eval([...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.BO=BackofficeView;'));
w.__club={id:'main',ownerUid:'owner'};const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const render=key=>React.act(async()=>root.render(React.createElement(w.BO,{key,user:members[0],clubSettings:{rakePct:6},showToast(){}})));
(async()=>{
 await render('ordinary');
 const card=name=>[...doc.querySelectorAll('.club-player-card')].find(c=>c.textContent.includes(name));
 assert.match(card('Alice').textContent,/159\.83.*\(-340\.17\)/);assert.match(card('Bob').textContent,/1,000\.00.*\(\+500\.00\)/);
 assert.equal(doc.querySelectorAll('[data-cycle-rake]').length,0);
 let sort=doc.querySelector('[aria-label="סידור שחקנים"]');assert.equal([...sort.options].some(o=>o.value==='rake'),false);
 await React.act(()=>Simulate.change(sort,{target:{value:'chips'}}));assert.match(doc.querySelector('.club-player-card').textContent,/Bob/);
 assert.match(doc.querySelector('.management-agent-totals').textContent,/1,159\.83.*\(\+159\.83\)/);
 assert.match(doc.querySelector('.management-cycle-summary').textContent,/1,159\.83.*\(\+159\.83\)/);
 god=true;w.fb.auth.currentUser={uid:'owner',email:'aaci.yoni@gmail.com',emailVerified:true};await render('god');
 sort=doc.querySelector('[aria-label="סידור שחקנים"]');assert.ok([...sort.options].some(o=>o.value==='rake'));
 await React.act(()=>Simulate.change(sort,{target:{value:'rake'}}));assert.match(doc.querySelector('.club-player-card').textContent,/Alice/);
 assert.equal(card('Alice').querySelector('[data-cycle-rake]').dataset.cycleRake,'8');
 await React.act(()=>root.unmount());w.close();console.log('PASS: exact requested balance/result pairs, agent/club totals, chip/rake sorting and GOD-only rake controls');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
