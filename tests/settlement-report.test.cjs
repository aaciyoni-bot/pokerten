'use strict';
// Run the real callable and Firestore read-only transaction. Only RPC transport
// is replaced. No credentials, live data or financial writes are involved.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Readable}=require('node:stream'),{createRequire}=require('node:module');
const requireFunction=createRequire(path.resolve(__dirname,'../functions/pokerSettlement.js'));
const {Firestore}=requireFunction('firebase-admin/firestore');
const source=fs.readFileSync(path.resolve(__dirname,'../functions/pokerSettlement.js'),'utf8');
const now=Date.now(),fromAt=now-86400000,toAt=now+1000;
function fixture(){
 const db=new Firestore({projectId:'demo-pokerten-agent-report'}),requests=[],options=[],docs=new Map();
 const add=(p,v)=>docs.set(p,v);
 add('clubs/c',{ownerUid:'owner'});
 for(const [uid,role,agentUid] of [['owner','club_owner',''],['agent','agent',''],['otherAgent','agent',''],['p','player','agent'],['q','player','otherAgent'],['zero','player',''],['missing','player','']])add(`memberships/${uid}_c`,{uid,username:uid,clubId:'c',status:'approved',role,agentUid,balance:100});
 add('gameLog/p',{clubId:'c',uid:'p',profit:-340.17,rake:12,at:now-1000});add('gameLog/q',{clubId:'c',uid:'q',profit:120.30,rake:9,at:now-1000});
 const segments=[{playerId:'p',hands:40,at:now-2000},{playerId:'p',hands:3,at:now-1000,cycleBoundary:true},{playerId:'q',hands:10,at:now-1000},{playerId:'zero',hands:0,at:now-1000},{playerId:'p',hands:999,at:fromAt-1},{playerId:'p',hands:999,at:toAt},{playerId:'p',hands:999,at:now-1000,kind:'tournament'},{playerId:'p',hands:-1,at:now-1000}];
 segments.forEach((s,i)=>add('settlementClubs/c/sessions/s'+i,s));
 const stamp={seconds:'1',nanos:0},proto=(p,v)=>({name:db.formattedName+'/documents/'+p,fields:db._serializer.encodeFields(v),createTime:stamp,updateTime:stamp});
 const matches=(v,f)=>!f||(f.compositeFilter?f.compositeFilter.filters.every(x=>matches(v,x)):f.fieldFilter.op==='EQUAL'&&v[f.fieldFilter.field.fieldPath]===db._serializer.decodeValue(f.fieldFilter.value));
 db.initializeIfNeeded=async()=>{};db.request=async method=>assert.fail('Unexpected write or RPC: '+method);
 db.requestStream=async(method,bidirectional,request)=>{
  requests.push({method,request});const transaction=Buffer.from('read-only-agent-report');
  if(method==='batchGetDocuments')return Readable.from(request.documents.map(name=>{const p=name.split('/documents/')[1];return {...(docs.has(p)?{found:proto(p,docs.get(p))}:{missing:name}),transaction,readTime:stamp};}),{objectMode:true});
  assert.equal(method,'runQuery');const q=request.structuredQuery,parent=request.parent.split('/documents/')[1]||'',prefix=(parent?parent+'/':'')+q.from[0].collectionId+'/';
  const rows=[...docs].filter(([p,v])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')&&matches(v,q.where));
  return Readable.from(rows.length?rows.map(([p,v])=>({document:proto(p,v),transaction,readTime:stamp})):[{transaction,readTime:stamp}],{objectMode:true});
 };
 const run=db.runTransaction.bind(db);db.runTransaction=(cb,opts)=>{options.push(opts);return run(cb,opts);};
 const api={};new Function('require','exports',source)(name=>name==='firebase-admin/firestore'?{getFirestore:()=>db}:requireFunction(name),api);
 return{requests,options,run:uid=>api.pkSettlementReport.run({auth:{uid,token:{email:uid+'@example.invalid',email_verified:true}},data:{clubId:'c',fromAt,toAt}})};
}
test('date-range report enriches only recorded cash hand segments and preserves financial totals',async()=>{
 const f=fixture(),r=await f.run('owner'),p=r.legacyReport.players.find(p=>p.uid==='p');
 assert.equal(p.result,-34017);assert.equal(p.rake,1200);assert.equal(p.recordedHands,43);assert.equal(p.handCountStatus,'Recorded cash segments only');
 assert.equal(r.legacyReport.players.find(p=>p.uid==='zero').recordedHands,0);assert.equal(r.legacyReport.players.find(p=>p.uid==='missing').recordedHands,null);
 assert.equal(r.legacyReport.totals.result,-21987);assert.equal(r.readOnly,true);assert.deepEqual(r.dateRange,{fromAt,toAt});
 assert.ok(f.options.every(o=>o.readOnly));
 const projection=f.requests.find(r=>r.request.structuredQuery?.from[0].collectionId==='sessions').request.structuredQuery.select.fields.map(f=>f.fieldPath);
 assert.deepEqual(projection,['playerId','hands','at','kind']);
});
test('player and agent exports never receive another agent’s player counters or results',async()=>{
 const own=await fixture().run('p');assert.equal(own.legacyReport.players.length,1);assert.equal(own.legacyReport.players[0].recordedHands,43);assert.doesNotMatch(JSON.stringify(own.legacyReport),/"rake"|otherAgent|"q"|agentUid/);
 const agent=await fixture().run('agent');assert.deepEqual(agent.legacyReport.players.map(p=>p.uid),['p']);assert.equal(agent.legacyReport.players[0].recordedHands,43);assert.doesNotMatch(JSON.stringify(agent.legacyReport),/otherAgent|"q"/);
});
