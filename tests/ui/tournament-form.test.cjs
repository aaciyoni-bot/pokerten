'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')},{Simulate}=require('react-dom/test-utils');w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const calls=[],writes=[],messages=[];w.fb={db:{},auth:{currentUser:{uid:'owner',email:'owner@example.invalid',emailVerified:true}},fx:async(name,args)=>{calls.push({name,args});return{tournamentId:'created'};},updateDoc:async()=>writes.push(1),addDoc:async()=>writes.push(1),runTransaction:async()=>writes.push(1),getDocs:async()=>({docs:[]}),doc:()=>({}),collection:()=>({}),query:()=>({}),where:()=>({}),onSnapshot:()=>()=>{}};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function TournamentsTab('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.TourTest=TournamentsTab;');w.eval(script);
const root=ReactDOM.createRoot(w.document.getElementById('root'));
(async()=>{
 await React.act(async()=>root.render(React.createElement(w.TourTest,{user:{uid:'owner',role:'club_owner'},game:'poker',tournaments:[],tables:[],clubSettings:{},showToast:m=>messages.push(m),onJoinTable(){}})));
 const button=text=>[...w.document.querySelectorAll('button')].find(x=>x.textContent.includes(text));await React.act(()=>button('New tournament').click());
 const field=label=>[...w.document.querySelectorAll('label')].find(x=>x.textContent===label)?.parentElement.querySelector('input,select');
 for(const label of ['Maximum rebuys per player','Maximum re-entries per player','Seats per table','Bounty type','Mystery bounty starts at level','Progressive bounty paid now (%)','Club bounty reserve'])assert.ok(field(label),label);
 await React.act(()=>Simulate.change(field('Tournament name'),{target:{value:'Reviewed tournament'}}));await React.act(()=>Simulate.change(w.document.querySelector('input[type=date]'),{target:{value:'2026-09-14'}}));
 await React.act(()=>Simulate.change(field('Bounty type'),{target:{value:'progressive'}}));await React.act(()=>Simulate.change(field('Seats per table'),{target:{value:'6'}}));
 await React.act(async()=>button('Open registration').click());
 const request=calls.find(c=>c.name==='pkTournament');assert.ok(request);assert.equal(request.args.op,'create');assert.equal(request.args.settings.bountyMode,'progressive');assert.equal(request.args.settings.tableSize,6);assert.equal(request.args.settings.maxRebuys,3);assert.equal(request.args.settings.botRebuys,true);assert.equal(request.args.settings.anteType,'bb');assert.ok(request.args.settings.structure.length>0);assert.ok(request.args.requestId);assert.equal(writes.length,0);assert.ok(messages.includes('Tournament open for registration.'));
 await React.act(()=>root.unmount());w.close();console.log('PASS: tournament form exposes and submits entry, rebuy, ante, bounty and table controls through server authority');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
