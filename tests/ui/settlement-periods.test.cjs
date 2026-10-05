'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const assertEnglishUi=require('./english-ui.cjs'),fixture=require('./settlement-fixture.cjs');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM=require('react-dom/client'),{Simulate}=require('react-dom/test-utils');w.React=React;
const timers=new Map();let nextTimer=0,clubChanges=0;w.setInterval=fn=>{timers.set(++nextTimer,fn);return nextTimer;};w.clearInterval=id=>timers.delete(id);w.addEventListener('pk-club-changed',()=>clubChanges++);
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-settlement-ui.js'),'utf8'));
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
let current,calls=[],rangeTrusted=true,key=0,deferredReport=null,failMutation=false;
const legacy=(role,{unknown=false,range=null}={})=>{
 const result=unknown?null:-12500,row={uid:'player',name:'Example Player',balance:67543,onTables:0,chips:67543,result,totalResult:-32500,rake:unknown?null:1200,commission:unknown?null:600,toClub:unknown?null:11900,openSessions:0};
 return {active:false,legacy:true,role,needsPeriodStart:unknown,canSetPeriodStart:role==='owner',supportsDateRange:true,canClose:role==='owner'&&!unknown&&!range,readOnly:!!range,...(range?{dateRange:range}:{}),cycle:{id:range?'date_range':'legacy_current',number:0,status:range?'range':'open',startAt:range?.fromAt??(unknown?null:new Date(2025,1,1).getTime()),endAt:range?.toAt??null},cycles:[],currentCycleId:'legacy_current',legacyReport:{players:[row],totals:row,agents:[],asOf:Date.now()}};
};
const call=async(name,args)=>{
 calls.push({name,args});
 if(name==='pkSettlementReport'){
  if(deferredReport)return deferredReport;
  if(args.fromAt!=null)return rangeTrusted?legacy(current.role,{range:{fromAt:args.fromAt,toAt:args.toAt}}):structuredClone(current);
  if(args.cycleId)return {...structuredClone(current),cycle:{...current.cycle,id:args.cycleId,status:'closed'}};
  return structuredClone(current);
 }
 if(name==='pkSettlement'){
  if(failMutation){failMutation=false;throw Error('Test mutation was not saved');}
  if(args.action==='setLegacyPeriodStart'){current=legacy(current.role);current.cycle.startAt=args.startAt;}
  return {ok:true};
 }
 throw Error('Unexpected preview operation');
};
const mount=async()=>{await React.act(async()=>root.render(React.createElement(w.PokerSettlement.Settlement,{key:++key,user:{uid:current.role==='owner'?'owner':'player',role:current.role},clubId:'example-club',call})));assertEnglishUi(doc.body,'Manual cycle report');};
const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent===text);
const change=async(el,value)=>React.act(async()=>Simulate.change(el,{target:{value}}));
const submit=async(el)=>React.act(async()=>Simulate.submit(el));
const setDates=async(from,to)=>{const form=doc.querySelector('form[aria-label="Report date range"]');await change(form.querySelectorAll('input')[0],from);await change(form.querySelectorAll('input')[1],to);await submit(form);};
(async()=>{
 // A slow report can span multiple 30-second polling intervals without overlapping calls.
 current=legacy('player');let releaseReport;deferredReport=new Promise(resolve=>{releaseReport=resolve;});await mount();
 const requestsWhilePending=calls.filter(c=>c.name==='pkSettlementReport').length;
 await React.act(async()=>{for(let tick=0;tick<4;tick++)for(const poll of timers.values())poll();});
 assert.equal(calls.filter(c=>c.name==='pkSettlementReport').length,requestsWhilePending);
 deferredReport=null;await React.act(async()=>releaseReport(structuredClone(current)));
 await React.act(async()=>{for(const poll of timers.values())poll();});
 assert.equal(calls.filter(c=>c.name==='pkSettlementReport').length,requestsWhilePending+1,'polling resumes after the request settles');
 // A missing anchor is unknown, never zero and never inferred from the wallet.
 current=legacy('player',{unknown:true});await mount();
 assert.match(doc.body.textContent,/Current cycle start is required|result is unavailable/);
 assert.match(doc.body.textContent,/675\.43/);assert.doesNotMatch(doc.body.textContent,/0\.00|325\.00/);
 assert.equal(doc.querySelector('input[type="datetime-local"]'),null);assert.equal(button('Close cycle and start next'),undefined);
 assert.equal(doc.querySelector('.st-net'),null);
 current=legacy('owner',{unknown:true});await mount();
 const startForm=()=>doc.querySelector('form[aria-label="Set current cycle start"]');
 assert.equal(startForm().querySelector('input').value,'','the manager must choose the actual start; no date is guessed');
 assert.equal(button('Save cycle start').disabled,true);
 let writes=calls.filter(c=>c.name==='pkSettlement').length;
 await change(startForm().querySelector('input'),'2099-01-01T00:00');await submit(startForm());
 assert.match(doc.querySelector('[role="alert"]').textContent,/cannot be in the future/);assert.equal(calls.filter(c=>c.name==='pkSettlement').length,writes);
 await change(startForm().querySelector('input'),'2025-03-28T02:30');await submit(startForm());
 assert.match(doc.querySelector('[role="alert"]').textContent,/valid, unambiguous club time/);assert.equal(calls.filter(c=>c.name==='pkSettlement').length,writes,'DST spring gap cannot silently shift the start');
 await change(startForm().querySelector('input'),'2025-10-26T01:30');await submit(startForm());
 assert.match(doc.querySelector('[role="alert"]').textContent,/valid, unambiguous club time/);assert.equal(calls.filter(c=>c.name==='pkSettlement').length,writes,'DST repeated hour needs an unambiguous start');
 assert.equal(clubChanges,0,'invalid inputs cannot announce changed balances');
 await change(startForm().querySelector('input'),'2025-02-01T09:30');await submit(startForm());
 const setStart=calls.findLast(c=>c.name==='pkSettlement');
 assert.deepEqual(JSON.parse(JSON.stringify(setStart.args)),{clubId:'example-club',action:'setLegacyPeriodStart',startAt:Date.parse('2025-02-01T07:30:00Z')});
 assert.equal(clubChanges,1,'confirmed start refreshes management and balance widgets');
 assert.match(doc.body.textContent,/Current cycle · Open/);assert.equal(doc.querySelector('.st-net .st-balance-line strong').textContent,'675.43');assert.equal(doc.querySelector('.st-net .st-cycle-line strong').textContent,'-125.00');assert.match(doc.querySelector('.st-net .st-lifetime-note').textContent,/Lifetime profit\/loss/);
 assert.ok(!calls.some(c=>c.name==='pkSettlement'&&/close|activate|setEnd/i.test(c.args.action)),'setting the period does not close or reset anything');

 // Stale automatic settings cannot produce automatic controls or closing calls.
 current=fixture('owner','owner');current.supportsDateRange=true;current.cycle.autoClose=true;current.cycle.endAt=Date.now()-86400000;current.cycles=[current.cycle,{...current.cycle,id:'old-cycle',number:0,status:'closed'}];await mount();
 assert.match(doc.body.textContent,/Open until manually closed/);
 await React.act(()=>button('Cycle management').click());
 assert.doesNotMatch(doc.body.textContent,/Close automatically|Save end time|Scheduled end/);assert.equal(doc.querySelector('input[type="checkbox"]'),null);
 writes=calls.filter(c=>c.name==='pkSettlement').length;w.confirm=()=>false;
 await React.act(()=>button('Close cycle now').click());assert.equal(calls.filter(c=>c.name==='pkSettlement').length,writes);
 w.confirm=()=>true;await React.act(async()=>button('Close cycle now').click());assert.equal(calls.findLast(c=>c.name==='pkSettlement').args.action,'close');assert.equal(clubChanges,2);
 failMutation=true;await React.act(async()=>button('Close cycle now').click());assert.equal(clubChanges,2,'failed mutation emits no refresh event');assert.match(doc.querySelector('[role="alert"]').textContent,/not saved/);
 await React.act(()=>button('Settlement report').click());
 // Selecting historical cycles disables financial/report editing.
 await change(doc.querySelector('select[aria-label="Select cycle"]'),'old-cycle');
 assert.match(doc.body.textContent,/Historical report · Read only/);assert.equal(button('Record payment'),undefined);assert.equal(button('Approve report'),undefined);

 // Reversed dates cause no request, and range requests omit the selected cycle ID.
 let reportCalls=calls.filter(c=>c.name==='pkSettlementReport').length;
 await setDates('2025-02-04','2025-02-02');assert.equal(calls.filter(c=>c.name==='pkSettlementReport').length,reportCalls);assert.match(doc.querySelector('[role="alert"]').textContent,/valid start and end date/);
 writes=calls.filter(c=>c.name==='pkSettlement').length;
 await setDates('2025-02-01','2025-02-02');
 const request=calls.findLast(c=>c.name==='pkSettlementReport');
 assert.deepEqual(JSON.parse(JSON.stringify(request.args)),{clubId:'example-club',fromAt:Date.parse('2025-01-31T22:00:00Z'),toAt:Date.parse('2025-02-02T22:00:00Z')});
 assert.match(doc.body.textContent,/Date range · Read only|Recorded results in selected dates|Current balance/);assert.match(doc.body.textContent,/in selected dates/);
 assert.doesNotMatch(doc.body.textContent,/At closing|Current cycle · Open/);assert.equal(button('Close cycle and start next'),undefined);assert.equal(button('Record payment'),undefined);assert.equal(button('Approve report'),undefined);
 assert.equal(calls.filter(c=>c.name==='pkSettlement').length,writes);assertEnglishUi(doc.body,'Historical date range');
 assert.match(doc.body.textContent,/club time \(Asia\/Jerusalem\)/);
 let dateInputs=doc.querySelectorAll('form[aria-label="Report date range"] input');assert.equal(dateInputs[0].value,'2025-02-01');assert.equal(dateInputs[1].value,'2025-02-02');
 await setDates('2025-03-28','2025-03-28');let dstRequest=calls.findLast(c=>c.name==='pkSettlementReport').args;
 assert.equal(dstRequest.fromAt,Date.parse('2025-03-27T22:00:00Z'));assert.equal(dstRequest.toAt,Date.parse('2025-03-28T21:00:00Z'));assert.equal(dstRequest.toAt-dstRequest.fromAt,23*3600000);
 await setDates('2025-10-26','2025-10-26');dstRequest=calls.findLast(c=>c.name==='pkSettlementReport').args;
 assert.equal(dstRequest.fromAt,Date.parse('2025-10-25T21:00:00Z'));assert.equal(dstRequest.toAt,Date.parse('2025-10-26T22:00:00Z'));assert.equal(dstRequest.toAt-dstRequest.fromAt,25*3600000);
 dateInputs=doc.querySelectorAll('form[aria-label="Report date range"] input');assert.equal(dateInputs[0].value,'2025-10-26');assert.equal(dateInputs[1].value,'2025-10-26');
 assert.equal(calls.filter(c=>c.name==='pkSettlement').length,writes,'history never writes settlement data');assert.equal(clubChanges,2);

 await React.act(async()=>button('Back to current cycle').click());
 assert.deepEqual(JSON.parse(JSON.stringify(calls.findLast(c=>c.name==='pkSettlementReport').args)),{clubId:'example-club'});assert.match(doc.body.textContent,/in current cycle/);

 // A server that ignores the requested dates must not masquerade as a filtered report.
 rangeTrusted=false;await setDates('2025-02-01','2025-02-02');
 assert.match(doc.querySelector('[role="alert"]').textContent,/date range could not be verified/);assert.equal(doc.querySelector('.st-net'),null);
 assert.ok(button('Back to current cycle'));await React.act(async()=>button('Back to current cycle').click());
 assert.match(doc.body.textContent,/in current cycle/);
 current=legacy('player');rangeTrusted=true;await mount();await setDates('2025-02-01','2025-02-02');
 assert.match(doc.body.textContent,/Recorded results in selected dates/);assert.doesNotMatch(doc.body.textContent,/Lifetime profit\/loss|Rakeback|Rake generated|Commission/i);assert.equal(button('Save cycle start'),undefined);assert.equal(button('Close cycle and start next'),undefined);
 await React.act(()=>root.unmount());w.close();console.log('PASS: manual-only cycles, explicit missing start, funds preserved, club-time DST boundaries, refresh events, non-overlapping polling, read-only history and verified range responses');
})().catch(async error=>{console.error(error);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
