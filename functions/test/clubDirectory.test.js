'use strict';
// The actual callable, Firestore transaction/query SDK and callable JSON encoder
// run here. Only Firestore's RPC transport is replaced; no credentials or live
// club data are used. This catches protocol/serialization errors hidden by a
// hand-written Query/Transaction mock.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {Firestore,FieldPath}=require('firebase-admin/firestore');
const https=require('firebase-functions/v2/https');
const {encode}=require(path.join(path.dirname(require.resolve('firebase-functions/v2/https')),'../../common/providers/https.js'));
const A=require('../pokerAuthority');
const source=fs.readFileSync(path.join(__dirname,'../pokerProfile.js'),'utf8');
const auth=(uid='root',email='haim29071994@gmail.com',verified=true)=>({uid,token:{email,email_verified:verified}});
const stamp={seconds:'1',nanos:0};
function fixture({failCollection,records=3}={}){
 const db=new Firestore({projectId:'demo-pokerten-directory',databaseId:'(default)'});
 const documents=new Map([
  ['clubs/clubA',{ownerUid:'owner'}],
  ['memberships/owner_clubA',{uid:'owner',clubId:'clubA',status:'approved',role:'club_owner',balance:100}],
  ['memberships/alice_clubA',{uid:'alice',clubId:'clubA',status:'pending',role:'player',agentUid:'agentA',balance:0}],
  ['memberships/bob_clubA',{uid:'bob',clubId:'clubA',status:'approved',role:'player',agentUid:'agentB',balance:4}],
  ['memberships/agentA_clubA',{uid:'agentA',clubId:'clubA',status:'approved',role:'agent',balance:1}],
  ['memberships/other_otherClub',{uid:'other',clubId:'otherClub',status:'pending',role:'player'}],
  ['agentLog/agentA',{clubId:'clubA',agentUid:'agentA',amount:1,at:1}],
  ['agentLog/agentB',{clubId:'clubA',agentUid:'agentB',amount:2,at:2}],
  ['securityAlerts/example',{clubId:'clubA',at:1}]
 ]);
 for(let i=0;i<records;i++)documents.set('gameLog/g'+i,{clubId:'clubA',uid:i%2?'bob':'alice',profit:i,at:i});
 const requests=[],logs=[],options=[];
 const proto=(docPath,data)=>({name:db.formattedName+'/documents/'+docPath,fields:db._serializer.encodeFields(data),createTime:stamp,updateTime:stamp});
 const match=(data,filter)=>!filter||(filter.compositeFilter?filter.compositeFilter.filters.every(f=>match(data,f)):filter.fieldFilter.op==='EQUAL'&&data[filter.fieldFilter.field.fieldPath]===db._serializer.decodeValue(filter.fieldFilter.value));
 db.initializeIfNeeded=async()=>{};
 db.request=async method=>{assert.fail('No write/commit/RPC request is permitted: '+method);};
 db.requestStream=async(method,bidirectional,request)=>{
  requests.push({method,request});
  const transaction=Buffer.from('read-only-test-transaction');
  if(method==='batchGetDocuments')return Readable.from(request.documents.map(name=>{
   const docPath=name.split('/documents/')[1],data=documents.get(docPath);
   return{...(data?{found:proto(docPath,data)}:{missing:name}),readTime:stamp,transaction};
  }),{objectMode:true});
  assert.equal(method,'runQuery');
  const query=request.structuredQuery,collection=query.from[0].collectionId;
  if(collection===failCollection){const error=new Error('private-player@example.test and private financial data');error.code=4;throw error;}
  const parent=request.parent.split('/documents/')[1]||'',prefix=(parent?parent+'/':'')+collection+'/';
  let rows=[...documents].filter(([p,data])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')&&match(data,query.where));
  if(query.orderBy?.length){
   assert.deepEqual(query.orderBy,[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]);
   rows.sort(([a],[b])=>a<b?-1:a>b?1:0);
  }
  if(query.startAt){
   assert.equal(query.startAt.before===true,false,'A report cursor must exclude the last scanned document (protobuf defaults before to false)');
   const after=query.startAt.values[0].referenceValue.split('/documents/')[1];
   rows=rows.filter(([p])=>p>after);
  }
  if(query.limit)rows=rows.slice(0,query.limit.value);
  return Readable.from(rows.length?rows.map(([p,data])=>({document:proto(p,data),readTime:stamp,transaction})):[{readTime:stamp,transaction}],{objectMode:true});
 };
 const runTransaction=db.runTransaction.bind(db);
 db.runTransaction=(callback,opts)=>{options.push(opts);return runTransaction(callback,opts);};
 const sandbox={exports:{},require:name=>name==='firebase-functions/v2/https'?https:name==='./pokerAuthority'?A:name==='./pokerAccounting'?require('../pokerAccounting'):name==='firebase-admin/firestore'?{getFirestore:()=>db,FieldPath}:(()=>{throw Error('Unexpected import '+name);})(),Date,console:{error:(...args)=>logs.push(args)},Buffer};
 new Function('require','exports','console',source)(sandbox.require,sandbox.exports,sandbox.console);
 return{history:(data={},identity=auth())=>sandbox.exports.pkGameHistory.run({auth:identity,data}),run:(data={},identity=auth())=>sandbox.exports.pkClubDirectory.run({auth:identity,data:{clubId:'clubA',...data}}),requests,options,logs,documents,endpoint:sandbox.exports.pkClubDirectory.__endpoint};
}
const collections=f=>f.requests.filter(r=>r.method==='runQuery').map(r=>r.request.structuredQuery.from[0].collectionId);

test('directoryOnly returns pending approvals without touching any optional history or alerts',async()=>{
 const f=fixture({failCollection:'agentLog'});
 const result=await f.run({directoryOnly:true,includeReports:true,includeSecurity:true});
 assert.deepEqual(collections(f),['memberships']);
 assert.equal(result.members.find(m=>m.uid==='alice').status,'pending');
 assert.equal(result.members.some(m=>m.clubId==='otherClub'),false);
 assert.equal(result.historyIncluded,false);
 for(const key of ['agentLog','gameLog','securityAlerts'])assert.equal(result[key].length,0);
 assert.equal(result.treasury.balance,100);
 assert.equal(JSON.parse(JSON.stringify(encode(result))).members.length,4);
});

test('Firestore SDK actually begins a read-only transaction and never commits',async()=>{
 const f=fixture();await f.run({directoryOnly:true});
 assert.equal(f.options[0].readOnly,true);
 const first=f.requests[0].request;
 assert.deepEqual(first.newTransaction,{readOnly:{}});
 assert.equal(f.requests.slice(1).every(r=>Buffer.isBuffer(r.request.transaction)),true);
});

test('existing full-report calls preserve all results and alerts without truncation',async()=>{
 const f=fixture({records:1203}),result=await f.run({includeReports:true,includeSecurity:true});
 assert.deepEqual(collections(f),['memberships','agentLog','gameLog','securityAlerts']);
 assert.equal(result.gameLog.length,1203);
 assert.equal(result.agentLog.length,2);
 assert.equal(result.securityAlerts.length,1);
 assert.equal(result.historyIncluded,true);
 assert.equal(JSON.parse(JSON.stringify(encode(result))).gameLog.at(-1).profit,1202);
});

test('agents only receive their own members, commission records and assigned player results',async()=>{
 const f=fixture(),result=await f.run({includeReports:true,includeSecurity:true},auth('agentA','agent@example.test'));
 assert.deepEqual(Array.from(result.members,m=>m.uid).sort(),['agentA','alice']);
 assert.equal(result.agentLog.every(row=>row.agentUid==='agentA'),true);
 assert.equal(result.gameLog.every(row=>row.uid==='alice'),true);
 assert.equal(result.treasury,null);
 assert.equal(collections(f).includes('securityAlerts'),false);
});

test('unverified oversight and unapproved members are denied before the directory/history reads',async()=>{
 for(const identity of [auth('root','haim29071994@gmail.com',false),auth('alice','player@example.test')]){
  const f=fixture();await assert.rejects(f.run({directoryOnly:true},identity),e=>e.code==='permission-denied');
  assert.deepEqual(collections(f),[]);
 }
});

test('failed history keeps its original error and logs only safe diagnostic metadata',async()=>{
 const f=fixture({failCollection:'gameLog'});
 await assert.rejects(f.run({includeReports:true}),e=>e.code===4);
 assert.equal(f.logs.length,1);
 assert.equal(f.logs[0][0],'CLUB_DIRECTORY_DIAGNOSTIC');
 const diagnostic=JSON.parse(f.logs[0][1]);
 assert.deepEqual(Object.keys(diagnostic).sort(),['stage','code','elapsedMs','memberCount','agentLogCount','gameLogCount'].sort());
 assert.equal(diagnostic.stage,'game-history');assert.equal(diagnostic.code,'4');
 assert.equal(diagnostic.memberCount,4);assert.equal(diagnostic.agentLogCount,2);
 assert.equal(JSON.stringify(f.logs).includes('private-player'),false);
});


test('report pages use bounded real SDK queries, preserve every historical result and skip the full membership list',async()=>{
 const f=fixture({records:1203});
 f.documents.set('gameLog/legacy',{clubId:'clubA',uid:'alice',profit:7});
 const records=[];let cursor=null,pages=0;
 do{
  const result=await f.run({reportSection:'gameLog',pageSize:200,cursor});
  const wire=JSON.parse(JSON.stringify(encode(result)));
  records.push(...wire.records);pages++;
  assert.equal(result.hasMore,!!result.nextCursor);
  cursor=result.nextCursor;
 }while(cursor);
 assert.equal(pages,7);assert.equal(records.length,1204);
 assert.equal(new Set(records.map(r=>r.id)).size,1204);
 assert.equal(records.reduce((sum,row)=>sum+row.profit,0),1202*1203/2+7);
 assert.equal(collections(f).every(name=>name==='gameLog'),true);
 for(const request of f.requests.filter(r=>r.method==='runQuery'))assert.equal(request.request.structuredQuery.limit.value,201);
 assert.equal(f.options.every(options=>options.readOnly),true);
 assert.equal(f.requests.filter(r=>r.request.newTransaction).length,7,'Authorization and snapshot are renewed for every page');
});

test('agent result pages advance after empty filtered pages without exposing another agent player',async()=>{
 const f=fixture({records:0}),identity=auth('agentA','agent@example.test');
 for(const [id,uid] of [['a','bob'],['b','bob'],['c','alice'],['d','bob'],['e','alice']])f.documents.set('gameLog/'+id,{clubId:'clubA',uid,profit:1});
 const first=await f.run({reportSection:'gameLog',pageSize:2},identity);
 assert.equal(first.records.length,0);assert.equal(first.hasMore,true);assert.equal(first.nextCursor,'b');
 const second=await f.run({reportSection:'gameLog',pageSize:2,cursor:first.nextCursor},identity);
 const third=await f.run({reportSection:'gameLog',pageSize:2,cursor:second.nextCursor},identity);
 assert.deepEqual([...second.records,...third.records].map(row=>row.uid),['alice','alice']);
 assert.equal(third.hasMore,false);assert.equal(third.nextCursor,null);
 assert.equal(collections(f).every(name=>name==='memberships'||name==='gameLog'),true);
});

test('agent commission pages remain scoped and security-alert pages remain unavailable',async()=>{
 const f=fixture(),identity=auth('agentA','agent@example.test');
 const commissions=await f.run({reportSection:'agentLog'},identity);
 assert.deepEqual(commissions.records.map(row=>row.agentUid),['agentA']);
 const security=await f.run({reportSection:'securityAlerts'},identity);
 assert.deepEqual(security,{records:[],hasMore:false,nextCursor:null});
 assert.deepEqual(collections(f),['agentLog']);
});

test('report cursors, page sizes and section names are validated before reading private documents',async()=>{
 for(const data of [{cursor:'a/b'},{cursor:''},{cursor:{}},{cursor:'.'},{cursor:'..'},{cursor:'a'.repeat(1501)},{cursor:'א'.repeat(751)},{pageSize:0},{pageSize:201},{pageSize:1.5},{pageSize:'200'},{reportSection:'memberships'},{directoryOnly:true}]){
  const f=fixture();await assert.rejects(f.run({reportSection:'gameLog',...data}),e=>e.code==='invalid-argument');
  assert.equal(f.requests.length,0);
 }
});

test('a revoked agent cannot fetch the next page using an earlier valid cursor',async()=>{
 const f=fixture(),identity=auth('agentA','agent@example.test');
 const first=await f.run({reportSection:'gameLog',pageSize:1},identity);
 assert.equal(first.hasMore,true);
 f.documents.set('memberships/agentA_clubA',{uid:'agentA',clubId:'clubA',role:'agent',status:'banned'});
 const before=collections(f).length;
 await assert.rejects(f.run({reportSection:'gameLog',cursor:first.nextCursor},identity),e=>e.code==='permission-denied');
 assert.equal(collections(f).length,before);
});

test('directory endpoint has bounded concurrency and the compatibility memory allowance',()=>{
 const f=fixture();assert.equal(f.endpoint.concurrency,8);assert.equal(f.endpoint.availableMemoryMb,512);
});


test('legacy Firestore document IDs with punctuation, spaces and Unicode can continue pagination',async()=>{
 const f=fixture({records:0}),legacy='legacy:2026-09-30 date '+ 'עברית'.repeat(30);
 f.documents.set('gameLog/'+legacy,{clubId:'clubA',uid:'alice',profit:7});
 f.documents.set('gameLog/z-last',{clubId:'clubA',uid:'alice',profit:9});
 const first=await f.run({reportSection:'gameLog',pageSize:1});
 assert.equal(first.nextCursor,legacy);assert.equal(first.hasMore,true);
 const last=await f.run({reportSection:'gameLog',pageSize:1,cursor:first.nextCursor});
 assert.equal(last.records[0].id,'z-last');assert.equal(last.hasMore,false);
 assert.equal(first.records[0].profit+last.records[0].profit,16);
 // The byte limit follows Firestore's UTF-8 bound, not JS character count.
 const boundary=await f.run({reportSection:'gameLog',cursor:'א'.repeat(750)});
 assert.equal(boundary.hasMore,false);
});


test('accounting-only reports enforce staff scope and GOD rake omission on the server',async()=>{
 const f=fixture({records:0});f.documents.set('settlementClubs/clubA/state/legacyPeriod',{startAt:Date.now()-86400000,source:'manager-confirmed',confirmedAt:Date.now()-100,confirmedBy:'owner'});f.documents.get('memberships/alice_clubA').status='approved';
 f.documents.set('gameLog/profit',{clubId:'clubA',uid:'alice',profit:-340.17,rake:7,at:Date.now()-1000});
 const agent=await f.run({accountingOnly:true},auth('agentA','agent@example.test'));
 assert.equal(agent.accounting.players.alice.result,-340.17);
 assert.equal(agent.accounting.players.bob,undefined);
 assert.equal('rake' in agent.accounting.players.alice,false);
 assert.equal('rake' in agent.accounting.agents.agentA,false);
 const god=await f.run({accountingOnly:true});assert.equal(god.accounting.players.alice.rake,7);
 const owner=await f.run({reportSection:'gameLog'},auth('owner','owner@example.test'));
 assert.equal(owner.records[0].profit,-340.17);assert.equal('rake' in owner.records[0],false);
});
test('filtered history keeps own results accessible without exposing rake or another player',async()=>{
 const f=fixture({records:0});f.documents.get('memberships/alice_clubA').status='approved';
 f.documents.set('gameLog/alice',{uid:'alice',clubId:'clubA',profit:-3,rake:7,at:1});
 f.documents.set('gameLog/bob',{uid:'bob',clubId:'clubA',profit:3,rake:8,at:1});
 const alice=auth('alice','alice@example.test');
 const own=await f.history({targetUid:'alice'},alice);assert.equal(own.records.length,1);assert.equal(own.records[0].profit,-3);assert.equal('rake' in own.records[0],false);
 await assert.rejects(f.history({targetUid:'bob'},alice),e=>e.code==='permission-denied');
 await assert.rejects(f.history({clubId:'clubA',targetUid:'bob'},alice),e=>e.code==='permission-denied');
 const board=await f.history({clubId:'clubA',leaderboard:true},alice);assert.equal(board.records.length,2);assert.equal(JSON.stringify(board).includes('rake'),false);
 const assigned=await f.history({clubId:'clubA',targetUid:'alice'},auth('agentA','agent@example.test'));assert.equal(assigned.records.length,1);
 await assert.rejects(f.history({clubId:'clubA',targetUid:'bob'},auth('agentA','agent@example.test')),e=>e.code==='permission-denied');
});

test('ordinary players receive only own chip totals and cycle P/L without lifetime, staff or rake fields',async()=>{
 const f=fixture({records:0});f.documents.get('memberships/alice_clubA').status='approved';
 f.documents.get('memberships/alice_clubA').balance=800;
 f.documents.set('gameLog/alice',{clubId:'clubA',uid:'alice',profit:-200,rake:7,at:1});
 f.documents.set('gameLog/bob',{clubId:'clubA',uid:'bob',profit:200,rake:8,at:1});
 const who=auth('alice','alice@example.test'),r=await f.run({accountingOnly:true},who);
 assert.deepEqual(Object.keys(r.accounting.players),['alice']);assert.equal('totalResult'in r.accounting.players.alice,false);assert.equal(r.accounting.players.alice.result,null);assert.equal(r.accounting.needsPeriodStart,true);assert.equal(r.accounting.start,null);assert.equal(r.accounting.players.alice.chips,800);
 assert.equal('club'in r.accounting,false);assert.equal('agents'in r.accounting,false);assert.equal('rake'in r.accounting.players.alice,false);assert.equal('totalRake'in r.accounting.players.alice,false);
 await assert.rejects(f.run({accountingOnly:true,targetUid:'bob'},who),e=>e.code==='permission-denied');
 await assert.rejects(f.run({accountingOnly:true,directoryOnly:true},who),e=>e.code==='permission-denied');
 await assert.rejects(f.run({accountingOnly:true,reportSection:'gameLog'},who),e=>e.code==='permission-denied');
 await assert.rejects(f.run({directoryOnly:true},who),e=>e.code==='permission-denied');
 f.documents.get('memberships/alice_clubA').status='pending';await assert.rejects(f.run({accountingOnly:true},who),e=>e.code==='permission-denied');
});

test('explicit active cycle overrides weekly and lifetime totals using only its scoped settlement journal',async()=>{
 const f=fixture({records:0}),now=Date.now(),cycleStart=now-5000;
 f.documents.get('memberships/alice_clubA').status='approved';f.documents.get('memberships/alice_clubA').balance=800;
 f.documents.set('gameLog/old',{clubId:'clubA',uid:'alice',profit:-196,rake:143.96,at:now-6000});
 f.documents.set('settlementClubs/clubA',{currentCycleId:'cycle_2',activatedAt:now-100000});
 f.documents.set('settlementClubs/clubA/cycles/cycle_2',{id:'cycle_2',number:2,status:'open',startAt:cycleStart});
 f.documents.set('settlementClubs/clubA/sessions/old',{playerId:'alice',cycleId:'cycle_1',result:-19600,rake:14396,at:now-6000});
 f.documents.set('settlementClubs/clubA/sessions/current',{playerId:'alice',cycleId:'cycle_2',result:-2517,rake:417,at:now-1000});
 f.documents.set('settlementClubs/other/sessions/foreign',{playerId:'alice',cycleId:'cycle_2',result:999900,rake:999900,at:now-1000});
 f.documents.set('settlementClubs/clubA/sessions/bob',{playerId:'bob',cycleId:'cycle_2',result:50000,rake:10000,at:now-1000});
 const god=(await f.run({accountingOnly:true})).accounting;
 assert.equal(god.start,cycleStart);assert.equal(god.cycleId,'cycle_2');assert.equal(god.basis,'settlement-cycle-live-sessions');
 assert.equal(god.players.alice.result,-25.17);assert.equal(god.players.alice.rake,4.17);assert.equal(god.players.alice.totalResult,-196);assert.equal(god.players.alice.totalRake,143.96);
 assert.equal(god.agents.agentA.result,-25.17);assert.equal(god.club.result,474.83);
 const agent=(await f.run({accountingOnly:true},auth('agentA','agent@example.test'))).accounting;
 assert.equal(agent.players.alice.result,-25.17);assert.equal(agent.players.bob,undefined);assert.equal('rake'in agent.players.alice,false);assert.doesNotMatch(JSON.stringify(agent),/totalResult|totalRake/);
 const own=(await f.run({accountingOnly:true},auth('alice','alice@example.test'))).accounting;
 assert.equal(own.players.alice.result,-25.17);assert.equal(own.players.alice.chips,800);assert.equal(own.cycleId,'cycle_2');assert.doesNotMatch(JSON.stringify(own),/totalResult|totalRake|"rake"|openResult|"club"|"agents"/);
 // Starting another empty cycle is a real zero even with old gameLog and journal activity.
 f.documents.set('settlementClubs/clubA',{currentCycleId:'cycle_3'});
 f.documents.set('settlementClubs/clubA/cycles/cycle_3',{id:'cycle_3',number:3,status:'open',startAt:now});
 const next=(await f.run({accountingOnly:true})).accounting;
 assert.equal(next.players.alice.result,0);assert.equal(next.players.alice.rake,0);assert.equal(next.players.alice.totalResult,-196);assert.equal(next.players.alice.chips,800);
 assert.equal(f.options.every(o=>o.readOnly),true);
 f.documents.delete('settlementClubs/clubA/cycles/cycle_3');
 await assert.rejects(f.run({accountingOnly:true}),e=>e.code==='failed-precondition','a missing active cycle must fail instead of silently substituting weekly history');
});


test('lifetime accounting is manager-only while agents retain current-cycle results and assigned balances',async()=>{
 const f=fixture({records:0}),now=Date.now(),startAt=now-10000;
 f.documents.set('settlementClubs/clubA/state/legacyPeriod',{startAt,source:'manager-confirmed',confirmedAt:now-100,confirmedBy:'owner'});
 Object.assign(f.documents.get('memberships/alice_clubA'),{status:'approved',balance:79});
 f.documents.set('gameLog/previous',{clubId:'clubA',uid:'alice',profit:-500,rake:12,at:startAt-1000});
 f.documents.set('gameLog/current',{clubId:'clubA',uid:'alice',profit:-25.01,rake:3,at:now-1000});
 const agentIdentity=auth('agentA','agent@example.test');
 const ordinary=(await f.run({accountingOnly:true,role:'manager',isGod:true},agentIdentity)).accounting;
 assert.equal(ordinary.players.alice.result,-25.01);assert.equal(ordinary.players.alice.chips,79);
 assert.equal(ordinary.agents.agentA.result,-25.01);assert.equal(ordinary.club.result,-25.01);
 assert.deepEqual(Object.keys(ordinary.players).sort(),['agentA','alice']);
 assert.doesNotMatch(JSON.stringify(ordinary),/totalResult|totalRake|"rake"/);
 const owner=(await f.run({accountingOnly:true},auth('owner','owner@example.test'))).accounting;
 assert.equal(owner.players.alice.totalResult,-525.01);assert.equal(owner.agents.agentA.totalResult,-525.01);assert.equal(owner.club.totalResult,-525.01);assert.equal('totalRake'in owner.players.alice,false);
 f.documents.get('memberships/agentA_clubA').role='manager';
 const manager=(await f.run({accountingOnly:true},agentIdentity)).accounting;
 assert.equal(manager.players.alice.totalResult,-525.01);assert.equal(manager.players.alice.result,-25.01);assert.equal('rake'in manager.players.alice,false);assert.equal('totalRake'in manager.players.alice,false);
 const root=(await f.run({accountingOnly:true})).accounting;
 assert.equal(root.players.alice.totalResult,-525.01);assert.equal(root.players.alice.totalRake,15);assert.equal(root.players.alice.rake,3);
 // Every request rechecks the stored role; a prior manager result grants no rights.
 f.documents.get('memberships/agentA_clubA').role='agent';
 const demoted=(await f.run({accountingOnly:true},agentIdentity)).accounting;assert.doesNotMatch(JSON.stringify(demoted),/totalResult|totalRake/);
 f.documents.delete('settlementClubs/clubA/state/legacyPeriod');
 const unknown=(await f.run({accountingOnly:true},agentIdentity)).accounting;
 assert.equal(unknown.needsPeriodStart,true);assert.equal(unknown.players.alice.result,null);assert.equal(unknown.players.alice.chips,79);assert.doesNotMatch(JSON.stringify(unknown),/totalResult|totalRake/);
 assert.equal(f.options.every(o=>o.readOnly),true);
});
