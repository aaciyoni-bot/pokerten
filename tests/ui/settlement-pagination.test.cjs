'use strict';
// Exercise complete report assembly and real SettlementSection rendering across bounded server pages.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;
w.eval(fs.readFileSync(require.resolve('../../assets/js/club-ui.js'),'utf8'));
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
const source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.SettlementTest=SettlementSection;window.loadReportTest=loadClubDirectoryReport;');
w.eval(source);w.__pkMuted=true;w.__club={ownerUid:'owner',closedWeeks:{}};
const now=Date.now(),members=[{id:'owner_main',uid:'owner',username:'Owner',role:'club_owner',status:'approved',balance:1000},{id:'alice_main',uid:'alice',username:'Alice',role:'player',status:'approved',balance:80}];
const data={
 agentLog:Array.from({length:205},(_,i)=>({id:'agent_'+i,kind:'club',amount:1,rakeSource:'human',accountingVersion:2,at:now})),
 gameLog:Array.from({length:405},(_,i)=>({id:'game_'+i,uid:'alice',profit:1,rake:0,game:'NLH',at:now})),
 securityAlerts:Array.from({length:201},(_,i)=>({id:'alert_'+i,at:now,kind:'test'}))
};
const calls=[];let mode='defer',rejectMiddle;
const error=()=>Object.assign(new Error('middle page unavailable'),{code:'functions/internal'});
w.fb={auth:{currentUser:{uid:'owner',email:'owner@example.invalid',emailVerified:true}},fx:async(name,args)=>{
 assert.equal(name,'pkClubDirectory');calls.push(args);
 if(args.directoryOnly)return{members:structuredClone(members),treasury:{uid:'owner',balance:1000}};
 assert.ok(['agentLog','gameLog','securityAlerts'].includes(args.reportSection));assert.equal(args.pageSize,200);
 if(mode==='missing-cursor')return{records:[],hasMore:true};
 if(mode==='repeat-cursor')return{records:[],hasMore:true,nextCursor:'same_cursor'};
 const rows=data[args.reportSection],start=args.cursor?rows.findIndex(row=>row.id===args.cursor)+1:0;
 assert.ok(!args.cursor||start>0,'next request must use a server-issued cursor');
 if(mode==='defer'&&args.reportSection==='gameLog'&&start===200)return new Promise((resolve,reject)=>{rejectMiddle=reject;});
 const records=rows.slice(start,start+200),hasMore=start+records.length<rows.length;
 return{records:structuredClone(records),hasMore,nextCursor:hasMore?records.at(-1).id:null};
}};
const doc=w.document,root=ReactDOM.createRoot(doc.getElementById('root'));
const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
(async()=>{
 await React.act(async()=>root.render(React.createElement(w.SettlementTest,{user:members[0],showToast(){}})));
 assert.equal(typeof rejectMiddle,'function','report reached its second game-history page');
 assert.equal(doc.querySelectorAll('.club-account-card').length,0,'partial page results stay hidden');
 assert.doesNotMatch(doc.body.textContent,/Weekly Settlement|Owner rake \(verified\)|405\.00/);
 await React.act(async()=>rejectMiddle(error()));
 assert.match(doc.querySelector('[role="alert"]').textContent,/internal/);
 assert.equal(doc.querySelectorAll('.club-account-card').length,0);
 assert.doesNotMatch(doc.body.textContent,/Weekly Settlement|Export CSV/,'failed middle page cannot expose partial totals or export');
 mode='complete';
 await React.act(async()=>button('נסה שוב').click());
 const alice=[...doc.querySelectorAll('.club-account-card')].find(card=>card.textContent.includes('Alice'));
 assert.ok(alice);assert.match(alice.textContent,/Period result405\.00/,'all 405 entries across three pages contribute exactly once');
 assert.match(doc.body.textContent,/Owner rake \(verified\)205\.00/,'all commission pages contribute exactly once');
 assert.ok(calls.some(args=>args.reportSection==='gameLog'&&args.cursor==='game_399'));
 assert.ok(calls.some(args=>args.reportSection==='agentLog'&&args.cursor==='agent_199'));
 const before=calls.length;
 const activity=await w.loadReportTest({clubId:'main',includeSecurity:true},'activity');
 assert.equal(activity.securityAlerts.length,201);assert.equal(activity.agentLog.length,205);assert.equal(activity.gameLog.length,0);
 assert.equal(calls.slice(before).some(args=>args.reportSection==='gameLog'),false);
 for(mode of ['missing-cursor','repeat-cursor'])await assert.rejects(w.loadReportTest({clubId:'main',includeReports:true},mode),e=>e.code==='functions/internal','broken pagination rejects rather than publishing a partial successful report');
 await React.act(()=>root.unmount());w.close();
 console.log('PASS: complete bounded pages produce exact settlement totals; delayed/failed middle pages and missing/repeated cursors never expose partial reports or exports');
})().catch(async error=>{console.error(error);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
