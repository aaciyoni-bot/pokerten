'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {project,write}=require('../tournamentPublicView');
const {backfill}=require('../../scripts/backfill-tournament-views.cjs');
const source=()=>({authorityVersion:2,game:'poker',clubId:'club',status:'reg',name:'Event',buyIn:100,fee:5,
 prizePool:4000,initialChips:30000,botFill:true,bountyFundingUid:'private-sponsor',bountyEvents:{private:'audit'},
 removedPlayers:{private:'audit'},prizeConfigChanges:[{by:'private-admin'}],feeTotal:25,
 players:{person:{uid:'person',name:'Player',rank:1,tableId:'table',isBot:false,paid:105,feesPaid:5},
 automated:{uid:'automated',name:'Alex',isBot:true,botStyle:'private-strategy',fundingUid:'private-sponsor',
  manualControl:{uid:'private-admin'},futureSecret:'private-secret',entryStartStack:30000}},
 results:[{uid:'person',name:'Player',rank:1,prize:4000,finalChips:30000,fundingUid:'private-sponsor'}],
 structure:[{sb:100,bb:200,ante:0,mins:10,private:'private-secret'}],payouts:[100],winnerUids:['person'],futureSecret:'private-secret'});
test('public projection preserves gameplay/entry/results while excluding unknown and operational fields at every level',()=>{
 const original=source(),saved=structuredClone(original),view=project(original);
 assert.deepEqual(original,saved,'projection does not mutate authoritative state');
 assert.equal(view.players.person.tableId,'table');assert.equal(view.players.automated.entryStartStack,30000);
 assert.deepEqual(view.structure,[{sb:100,bb:200,ante:0,mins:10}]);assert.equal(view.results[0].prize,4000);
 assert.equal(view.prizePool,4000);assert.equal(view.fee,5);assert.equal(view.prizeConfigRevision,1);
 assert.doesNotMatch(JSON.stringify(view),/private-|isBot|botStyle|fundingUid|feeTotal|feesPaid|manualControl|futureSecret|bountyEvents|removedPlayers/);
 assert.throws(()=>project({...original,authorityVersion:1}));assert.throws(()=>project({...original,game:'ofc'}));
});
test('source and projection are queued in the same transaction; invalid source queues neither',()=>{
 const calls=[],db={doc:path=>({path})},tx={set:(ref,value)=>calls.push([ref.path,value])};
 write(tx,db,'event',{...source(),id:'event'});
 assert.deepEqual(calls.map(c=>c[0]),['tournaments/event','tournamentViews/event']);
 assert.equal(calls[0][1].players.automated.fundingUid,'private-sponsor');assert.equal(calls[0][1].id,undefined);
 assert.deepEqual(calls[1][1],project(source()));
 calls.length=0;assert.throws(()=>write(tx,db,'legacy',{authorityVersion:1}));assert.equal(calls.length,0);
});
test('backfill paginates, re-reads concurrent changes, is rerunnable and never writes balances or engine records',async()=>{
 const docs=new Map([['tournaments/a',source()],['tournaments/b',{...source(),name:'B'}],['tournaments/legacy',{authorityVersion:1}]]);
 const writes=[],snap=path=>({id:path.split('/').at(-1),ref:{path},exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 let raced=false;
 const query=(cursor='',limit=100)=>({where:()=>query(cursor,limit),orderBy:()=>query(cursor,limit),limit:n=>query(cursor,n),startAfter:id=>query(id,limit),get:async()=>{
  const page=[...docs.keys()].filter(p=>p.startsWith('tournaments/')&&docs.get(p).authorityVersion===2&&p.split('/')[1]>cursor).sort().slice(0,limit).map(snap);
  if(!raced){raced=true;docs.get('tournaments/a').prizePool=5000;}
  return{docs:page};
 }});
 const db={collection:name=>{assert.equal(name,'tournaments');return query();},doc:path=>({path}),runTransaction:async body=>{
  let writing=false;const pending=[];
  const result=await body({get:async ref=>{assert.equal(writing,false);return snap(ref.path);},set:(ref,data)=>{writing=true;assert.match(ref.path,/^tournamentViews\//);pending.push([ref.path,structuredClone(data)]);}});
  for(const [path,data]of pending){writes.push(path);docs.set(path,data);}return result;
 }};
 assert.deepEqual(await backfill(db,{pageSize:1}),{scanned:2,written:2,sourceWrites:0,balanceWrites:0});
 assert.equal(docs.get('tournamentViews/a').prizePool,5000,'latest committed source wins over a scanned snapshot');
 const original=[...docs].filter(([p])=>p.startsWith('tournaments/'));
 assert.deepEqual(await backfill(db,{pageSize:1}),{scanned:2,written:0,sourceWrites:0,balanceWrites:0});
 assert.deepEqual([...docs].filter(([p])=>p.startsWith('tournaments/')),original);assert.equal(writes.length,2);
});
