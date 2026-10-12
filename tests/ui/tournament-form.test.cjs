'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')},{Simulate}=require('react-dom/test-utils');w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const calls=[],writes=[],messages=[];w.fb={db:{},auth:{currentUser:{uid:'owner',email:'owner@example.invalid',emailVerified:true}},fx:async(name,args)=>{calls.push({name,args});return{tournamentId:'created'};},updateDoc:async()=>writes.push(1),addDoc:async()=>writes.push(1),runTransaction:async()=>writes.push(1),getDocs:async()=>({docs:[]}),doc:()=>({}),collection:()=>({}),query:()=>({}),where:()=>({}),onSnapshot:()=>()=>{}};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function TournamentsTab('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.TourTest=TournamentsTab;window.entryPrice=tourEntryOf;window.registerTour=tourRegister;');w.eval(script);
const root=ReactDOM.createRoot(w.document.getElementById('root'));
(async()=>{
 await React.act(async()=>root.render(React.createElement(w.TourTest,{user:{uid:'owner',role:'club_owner'},game:'poker',tournaments:[],tables:[],clubSettings:{},showToast:m=>messages.push(m),onJoinTable(){}})));
 const button=text=>[...w.document.querySelectorAll('button')].find(x=>x.textContent.includes(text));await React.act(()=>button('New tournament').click());
 const field=label=>[...w.document.querySelectorAll('label')].find(x=>x.textContent===label)?.parentElement.querySelector('input,select');
 for(const label of ['Re-entry price (0 = free)','Maximum rebuys per player','Maximum re-entries per player','Seats per table','Bounty type','Mystery bounty starts at level','Progressive bounty paid now (%)','Club bounty reserve'])assert.ok(field(label),label);
 await React.act(()=>Simulate.change(field('Tournament name'),{target:{value:'Reviewed tournament'}}));await React.act(()=>Simulate.change(w.document.querySelector('input[type=date]'),{target:{value:'2026-09-14'}}));
 await React.act(()=>Simulate.change(field('Bounty type'),{target:{value:'progressive'}}));await React.act(()=>Simulate.change(field('Seats per table'),{target:{value:'6'}}));
 await React.act(()=>Simulate.change(field('Re-entry price (0 = free)'),{target:{value:'50'}}));
 assert.ok([...w.document.querySelectorAll('label')].some(x=>x.textContent.includes('Add re-entry price to the prize pool')));
 await React.act(()=>button('Blind structure').click());
 assert.ok(w.document.querySelector('.tournament-blind-editor'));
 assert.equal(w.document.querySelectorAll('.tournament-blind-row:first-of-type input').length<=4,true);
 const sb=w.document.querySelector('[aria-label="Level 1 sb"]');assert.ok(sb);
 await React.act(()=>Simulate.change(sb,{target:{value:'60'}}));
 assert.equal(w.document.querySelector('[aria-label="Level 1 bb"]').value,'120','responsive editor retains SB-to-BB linking');
 await React.act(async()=>button('Open registration').click());
 const request=calls.find(c=>c.name==='pkTournament');assert.ok(request);assert.equal(request.args.op,'create');assert.equal(request.args.settings.bountyMode,'progressive');assert.equal(request.args.settings.tableSize,6);assert.equal(request.args.settings.maxRebuys,3);assert.equal(request.args.settings.reentryBuyIn,50);assert.equal(request.args.settings.reentryToPrizePool,false);assert.equal(request.args.settings.botRebuys,true);assert.equal(request.args.settings.anteType,'bb');assert.equal(request.args.settings.finishAtPaidPlaces,false);assert.ok(request.args.settings.structure.length>0);assert.equal(request.args.settings.structure[0].sb,60);assert.equal(request.args.settings.structure[0].bb,120);assert.ok(request.args.requestId);assert.equal(writes.length,0);assert.ok(messages.includes('Tournament open for registration.'));
 assert.equal(w.entryPrice({buyIn:0,fee:0,bounty:0,reentryBuyIn:50},true),50);assert.equal(w.entryPrice({buyIn:0,fee:0,bounty:0,reentryBuyIn:50}),0);assert.equal(w.entryPrice({buyIn:25,fee:2,bounty:0},true),27);assert.equal(w.entryPrice({buyIn:0,fee:0,bounty:0,reentryBuyIn:0},true),0);
 let prompt='';w.confirm=m=>{prompt=m;return false;};const before=calls.length;await w.registerTour({id:'tor',name:'Free first entry',game:'poker',buyIn:0,fee:0,bounty:0,reentryBuyIn:50,startStack:10000,players:{owner:{out:true}}},{uid:'owner'},m=>messages.push(m));assert.match(prompt,/50/);assert.equal(calls.length,before,'Rejecting price confirmation makes no request');w.confirm=()=>true;await w.registerTour({id:'tor',name:'Free first entry',game:'poker',buyIn:0,fee:0,bounty:0,reentryBuyIn:50,startStack:10000,players:{owner:{out:true}}},{uid:'owner'},m=>messages.push(m));assert.equal(calls.at(-1).args.op,'register');

 const tor={id:'managed',clubId:'main',game:'poker',name:'Managed test',status:'reg',pokerType:'NLH',buyIn:0,fee:0,bounty:0,prizePool:1000,startStack:10000,maxPlayers:36,minPlayers:2,mttMode:true,payouts:[50,30,20],startAt:Date.now()+100000,players:{owner:{uid:'owner',name:'Owner'},target:{uid:'target',name:'Target'}}};
 await React.act(()=>root.render(React.createElement(w.TourTest,{user:{uid:'owner',role:'club_owner'},game:'poker',tournaments:[tor],tables:[],clubSettings:{},showToast:m=>messages.push(m),onJoinTable(){}})));
 const bots=()=>w.document.querySelector('button[title="Add one bot"]');assert.ok(bots());const bcount=calls.filter(x=>x.args.op==='fillbots').length;
 await React.act(async()=>{bots().click();bots().click();});assert.equal(calls.filter(x=>x.args.op==='fillbots').length,bcount+1,'Double click adds one bot request');
 await React.act(()=>w.document.querySelector('.pt-tournament-roster-toggle').click());assert.ok(w.document.querySelector('button[aria-label="Remove Target"]'));
 w.confirm=()=>false;const n=calls.length;await React.act(()=>w.document.querySelector('button[aria-label="Remove Target"]').click());assert.equal(calls.length,n);
 w.confirm=()=>true;await React.act(async()=>w.document.querySelector('button[aria-label="Remove Target"]').click());assert.equal(calls.at(-1).args.op,'removeplayer');assert.equal(calls.at(-1).args.playerUid,'target');
 w.confirm=()=>false;const n2=calls.length;await React.act(()=>w.document.querySelector('button[title="Delete tournament"]').click());assert.equal(calls.length,n2);
 w.confirm=()=>true;await React.act(async()=>w.document.querySelector('button[title="Delete tournament"]').click());assert.equal(calls.at(-1).args.op,'archive');

 await React.act(()=>root.unmount());w.close();console.log('PASS: tournament form exposes and submits entry, rebuy, ante, bounty and table controls through server authority');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});


