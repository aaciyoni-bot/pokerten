'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client'),fixture=require('./settlement-fixture.cjs');w.React=React;
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-settlement-ui.js'),'utf8'));
const doc=w.document,root=createRoot(doc.getElementById('root'));
let current,previous,mode='ok',held=[],calls=[],key=0;
function setup(role='owner'){
 current=fixture(role,role==='player'?'other':'owner');current.cycle={...current.cycle,id:'cycle_3',number:3,startAt:3000};current.currentCycleId='cycle_3';
 const old={id:'cycle_2',number:2,startAt:2000,endAt:3000,status:'closed'},older={...old,id:'cycle_1',number:1,startAt:1000,endAt:2000};
 current.cycles=[older,current.cycle,{...old,id:'void-cycle',number:99,status:'void'},old];
 if(role==='player'){current.player.totals.result=7503;current.player.closing=-86246;current.player.opening=-93749;}
 else {Object.assign(current.details[0],{opening:-93749,closing:-86246,activity:7503,paid:0});current.details[0].totals.result=7503;current.funds[0].totalResult=-85145;}
 previous=structuredClone(current);previous.cycle=old;
 if(role==='player')previous.player.totals.result=-12100;
 else{previous.details[0].totals.result=-12100;previous.details[0].closing=-93749;}
 mode='ok';calls=[];
}
const call=async(name,args)=>{
 calls.push({name,args});assert.equal(name,'pkSettlementReport','viewing results must never write financial data');
 if(!args.cycleId||args.cycleId===current.currentCycleId)return structuredClone(current);
 assert.equal(args.cycleId,'cycle_2','select the latest closed cycle, not array order or a void cycle');
 if(mode==='fail')throw Error('Temporary report failure');
 if(mode==='held')return new Promise(resolve=>held.push(resolve));
 if(mode==='wrong')return structuredClone(current);
 if(mode==='missing')return {...structuredClone(previous),details:undefined};
 return structuredClone(previous);
};
const button=name=>[...doc.querySelectorAll('button')].find(b=>b.textContent===name);
const click=async name=>React.act(async()=>button(name).click());
const mount=async(remount=true,clubId='club')=>React.act(async()=>root.render(React.createElement(w.PokerSettlement.Settlement,{key:remount?++key:key,user:{uid:current.role==='player'?'other':'owner',role:current.role},clubId,call})));
const openAccount=async()=>{await click('Players');await React.act(async()=>doc.querySelector('.st-account-head').click());};
const previousValue=()=>doc.querySelector('.st-previous-cycle strong').textContent;
(async()=>{
 setup();const original=structuredClone(current);await mount();assert.equal(calls.length,1,'history is not loaded before an account is opened');await openAccount();
 const due=doc.querySelector('.st-account-due');assert.match(due.textContent,/Player receives\+75\.03Current cycle only/);
 assert.equal(previousValue(),'-121.00','previous result is read from saved game totals, not opening -937.49');
 assert.equal(doc.querySelector('.st-cycle-line strong').textContent,'+75.03');
 assert.doesNotMatch(doc.body.textContent,/Lifetime|851\.45/);assert.equal(doc.querySelector('select[aria-label="Select cycle"] option[value="all"]'),null);
 assert.equal(doc.querySelector('.st-ledger-details').open,false,'carried balances are in optional details');
 assert.match(doc.querySelector('.st-ledger-details').textContent,/-862\.46.*-937\.49/);
 assert.deepEqual(current,original,'display changes preserve balances, payments and cycle data');
 await click('Previous cycle');assert.match(doc.querySelector('.st-account-due').textContent,/Player pays-121\.00Selected period only/);assert.equal(button('Record payment'),undefined);assert.equal(doc.querySelector('.st-previous-cycle'),null,'history is not mislabeled as the current cycle');
 await click('Current cycle');assert.match(doc.querySelector('.st-account-due').textContent,/Player receives\+75\.03/);
 // A fresh cycle can have zero game result while previous debt is still saved.
 current.details[0].totals.result=0;await mount();await openAccount();assert.match(doc.querySelector('.st-account-due').textContent,/Balanced0\.00Current cycle only/);
 // History errors and mismatched responses must not silently become 0.00.
 for(const failure of ['fail','wrong','missing']){mode=failure;await mount();await openAccount();assert.match(previousValue(),/Unavailable/);assert.doesNotMatch(previousValue(),/0\.00/);}
 mode='ok';await click('Retry previous cycle');assert.equal(previousValue(),'-121.00');
 // Missing player activity in a verified report is legitimately zero.
 previous.details=[];await mount();await openAccount();assert.equal(previousValue(),'0.00');
 // Results stay scoped to the relevant agent, including a saved legacy cycle.
 previous.details=[{...structuredClone(original.details[0]),agentId:'another-agent',totals:{result:99900}}];await mount();await openAccount();assert.equal(previousValue(),'0.00');
 previous.legacy=true;previous.legacyReport={players:[{uid:'other',agentUid:'agent',result:-4000,totalResult:-999999}]};await mount();await openAccount();assert.equal(previousValue(),'-40.00');assert.doesNotMatch(doc.body.textContent,/9,999\.99/);
 // No fabricated previous balance before the first saved cycle.
 current.cycles=[current.cycle];await mount();await openAccount();assert.equal(button('Previous cycle').disabled,true);assert.match(doc.querySelector('.st-previous-cycle').textContent,/No previous saved cycle/);assert.equal(previousValue(),'—');
 // An old request cannot fill the next user's account, even if it resolves last.
 setup();mode='held';await mount();await openAccount();assert.match(previousValue(),/Loading/);assert.equal(held.length,1);const oldReport=structuredClone(previous);
 setup('player');await mount(false,'another-club');assert.equal(doc.querySelector('.st-net strong').textContent,'+75.03');assert.equal(previousValue(),'-121.00');
 oldReport.details[0].totals.result=987654;await React.act(async()=>held[0](oldReport));assert.doesNotMatch(doc.body.textContent,/9,876\.54|Other human player|Lifetime|Rake|Commission/);
 assert.equal(previousValue(),'-121.00');
 await React.act(()=>root.unmount());w.close();console.log('PASS: cycle-only pays/receives, previous saved cycle, hidden lifetime, lazy scoped history, retry and stale response isolation; no financial mutations');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
