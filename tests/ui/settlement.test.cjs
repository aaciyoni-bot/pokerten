'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;
Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')}, {Simulate}=require('react-dom/test-utils');
w.React=React;w.ReactDOM=ReactDOM;w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
w.__club={ownerUid:'owner',closedWeeks:{}};
const mems=[{uid:'owner',username:'Owner',role:'club_owner'},{uid:'agent',username:'Agent',role:'agent'},
  {uid:'a',username:'Alice',playerId:'111',role:'player',agentUid:'agent',balance:100},
  {uid:'b',username:'Bob',playerId:'222',role:'player',balance:200}];
const logs=[{uid:'a',profit:25,rake:5,at:Date.now(),game:'NLH'},{uid:'a',profit:90,rake:15,at:1,game:'Old game'},{uid:'b',profit:-30,rake:7,at:Date.now(),game:'NLH'}];
let writes=0;
w.fb={db:{},auth:{},doc:(_, ...p)=>p.join('/'),collection:(_,p)=>p,query:x=>x,where:()=>null,
  getDocs:async p=>({docs:(p==='memberships'?mems:p==='gameLog'?logs:[]).map((v,i)=>({id:String(i),data:()=>v}))}),updateDoc:()=>writes++,setDoc:()=>writes++};
w.eval(fs.readFileSync(path.join(__dirname,'../../assets/js/club-ui.js'),'utf8'));
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
let source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
source=source.replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.SettlementTest=SettlementSection;');
w.eval(source);w.__club={ownerUid:'owner',closedWeeks:{}};const root=ReactDOM.createRoot(w.document.getElementById('root'));
const render=uid=>React.act(async()=>root.render(React.createElement(w.SettlementTest,{key:uid,user:{uid,email:uid+'@example.invalid',role:uid==='owner'?'club_owner':'agent'},showToast:()=>{}})));
(async()=>{
  await render('owner');assert.equal(w.document.querySelectorAll('.club-account-card').length,4);
  const alice=[...w.document.querySelectorAll('.club-account-card')].find(b=>b.textContent.includes('Alice'));
  assert.match(alice.textContent,/Period result25\.00Current balance100\.00/);
  await React.act(()=>alice.click());assert.match(w.document.querySelector('[role=dialog]').textContent,/NLH/);assert.doesNotMatch(w.document.querySelector('[role=dialog]').textContent,/Old game/);
  await React.act(()=>w.document.querySelector('.club-dialog-close').click());
  assert.ok(w.document.querySelector('details.club-report-details'),'the original detailed report remains available');
  const search=w.document.querySelector('input[placeholder="Search…"]');await React.act(()=>Simulate.change(search,{target:{value:'Alice'}}));
  assert.equal(w.document.querySelectorAll('.club-account-card').length,1);
  await render('agent');assert.equal(w.document.querySelectorAll('.club-account-card').length,1);assert.doesNotMatch(w.document.body.textContent,/Bob/);
  assert.equal(writes,0,'reading account cards must never mutate finances');
  await React.act(()=>root.unmount());w.close();console.log('PASS: actual settlement cards, current-period entries, original report, filters and agent scope with zero writes');
})().catch(e=>{console.error(e);w.close();process.exitCode=1;});
