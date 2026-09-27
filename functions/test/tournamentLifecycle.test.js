'use strict';
// Real callable, tournament coordinator, dealing/settlement and sponsor ledger;
// only Firestore transport and the clock/random source are replaced.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),crypto=require('node:crypto');
const T=require('../pokerTournamentCore');
const localRequire=createRequire(path.join(__dirname,'../pokerTournaments.js'));
const copy=x=>structuredClone(x),NOW=Date.parse('2026-09-27T12:00:00Z');
function fixture(seed=1){
 const docs=new Map([['clubs/clubA',{ownerUid:'owner',botsAuto:true}],['memberships/owner_clubA',{uid:'owner',clubId:'clubA',role:'club_owner',status:'approved',balance:100000}]]);
 let now=NOW,auto=0,request=0,rng=seed;
 const randomInt=(min,max)=>{if(max===undefined){max=min;min=0;}rng=(Math.imul(rng,1664525)+1013904223)>>>0;return min+Math.floor(rng/4294967296*(max-min));};
 class Clock extends Date{static now(){return now;}}
 const snap=p=>({id:p.split('/').at(-1),ref:ref(p),exists:docs.has(p),data:()=>copy(docs.get(p))});
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:n=>collection(p+'/'+n),get:async()=>snap(p)});
 const collection=(p,filters=[])=>({path:p,filters,query:true,doc:id=>ref(p+'/'+(id||'auto'+(++auto))),where:(...f)=>collection(p,[...filters,f])});
 const db={doc:ref,collection,async runTransaction(body){
  let writing=false;const writes=[];
  const tx={async get(target){assert.equal(writing,false,'Firestore reads precede writes');if(!target.query)return snap(target.path);
   return{docs:[...docs.keys()].filter(p=>p.startsWith(target.path+'/')&&p.split('/').length===target.path.split('/').length+1).filter(p=>target.filters.every(([field,op,value])=>op==='=='&&field.split('.').reduce((x,k)=>x?.[k],docs.get(p))===value)).map(snap)};
  },getAll:(...refs)=>Promise.all(refs.map(r=>tx.get(r))),set(r,data){writing=true;writes.push(()=>docs.set(r.path,copy(data)));},update(r,patch){writing=true;writes.push(()=>{assert.ok(docs.has(r.path));const d=copy(docs.get(r.path));for(const [field,value]of Object.entries(patch)){const keys=field.split('.');let at=d;for(const k of keys.slice(0,-1))at=at[k]??={};at[keys.at(-1)]=copy(value);}docs.set(r.path,d);});},delete(r){writing=true;writes.push(()=>docs.delete(r.path));}};
  const result=await body(tx);writes.forEach(write=>write());return result;
 }};
 const cached={};
 function load(file){
  if(cached[file])return cached[file];const module={exports:{}};cached[file]=module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{module,exports:module.exports,console,Date:Clock,Buffer,setTimeout,
   require:name=>name==='firebase-admin/firestore'?{getFirestore:()=>db}:name==='firebase-functions/v2/https'?{...localRequire(name),onCall:(_,fn)=>fn}:name==='firebase-functions/v2/scheduler'?{onSchedule:(_,fn)=>fn}:name==='./pokerSecurity'?{requirePokerAvailable(){},POKER_SECURITY_PAUSED:false}:['crypto','node:crypto'].includes(name)?{...crypto,randomInt}:['./pokerAuthority','./pokerTournaments','./pokerEngine'].includes(name)?load(name.slice(2)+'.js'):localRequire(name)
  },{filename:file});cached[file]=module.exports;return module.exports;
 }
 const tours=load('pokerTournaments.js'),engine=load('pokerEngine.js').__engineInternals;
 const f={docs,db,tours,engine,now:()=>now,advance:ms=>{now+=ms;},tables:id=>[...docs].filter(([p,d])=>p.split('/').length===2&&p.startsWith('tables/')&&d.tournamentId===id).map(([p,d])=>({...copy(d),docId:p.split('/')[1]})),tour:id=>docs.get('tournaments/'+id),balance:uid=>docs.get(`memberships/${uid}_clubA`).balance,
  member(uid){docs.set('users/'+uid,{username:uid});docs.set(`memberships/${uid}_clubA`,{uid,clubId:'clubA',role:'player',status:'approved',balance:1000});},
  command:(uid,op,extra={},rid)=>tours.pkTournament({auth:{uid,token:{email:uid+'@example.test',email_verified:true}},data:{op,clubId:'clubA',requestId:rid||'tournament-request-'+(++request),...extra}}),
  async action(id,mutate){return db.runTransaction(async tx=>{const s=await engine.loadState(tx,id,{withCards:true});s.now=now;const result=mutate(s);await engine.commitState(tx,s,{});return result;});}
 };return f;
}
async function create(f,settings={}){
 const result=await f.command('owner','create',{settings:{name:'Lifecycle test',startAt:NOW+99999999,buyIn:10,fee:1,startStack:100,maxPlayers:18,minPlayers:2,tableSize:6,payouts:[50,30,20],finishAtPaidPlaces:false,structure:[{sb:1,bb:2,ante:0,mins:120}],...settings}});
 return result.tournamentId;
}
async function startHumans(f,id,count){for(let i=0;i<count;i++){const uid='human'+i;f.member(uid);await f.command(uid,'register',{tournamentId:id});}await f.command('owner','start',{tournamentId:id});}
const positive=row=>Object.values(row.players).filter(p=>p.stack>0);
async function playOne(f,row){
 return f.action(row.docId,s=>{
  const g=s.gameState;
  if(['waiting','showdown'].includes(g.phase)){if(g.phase==='showdown'&&f.now()-(g.showdownAt||0)<5100)return;return f.engine.startHand(s);}
  if(g.phase==='discard'){for(const p of Object.values(s.players))if((s.priv[p.uid]||[]).length===3)f.engine.applyDiscard(s,p.uid,0);return;}
  if(g.allInReveal){return f.engine.advancePhase(s);}
  const p=s.players[g.activeTurnUid];assert.ok(p,'Every unsettled betting hand has an actor');
  const canRaise=p.bet+p.stack>g.highestBet&&Object.values(s.players).some(q=>q.uid!==p.uid&&q.status==='active'&&q.stack>0);
  f.engine.applyAction(s,p.uid,canRaise?'raise':'call',p.stack+p.bet,false);
 });
}

test('multi-winner finish holds settled tables while another final hand is running',()=>{
 const roster=Object.fromEntries(Array.from({length:8},(_,i)=>['p'+i,{out:i>=3}]));
 const seat=(uid,seatIndex)=>({uid,seatIndex,stack:100,bet:0,status:'active'});
 const t={id:'tor',status:'running',pokerType:'NLH',tableSize:2,payouts:[50,30,20],finishAtPaidPlaces:true,players:roster};
 const rows=[{docId:'a',tournamentId:'tor',players:{p0:seat('p0',0),p1:seat('p1',1)},tournament:{},gameState:{phase:'showdown',showdownAt:NOW-6000,pots:[]}},{docId:'b',tournamentId:'tor',players:{p2:seat('p2',0)},tournament:{},gameState:{phase:'river',pots:[]}}];
 const plan=T.plan(t,rows,NOW);
 assert.equal(plan.finishers,undefined);assert.ok(plan.updates.some(u=>u.id==='a'&&u.patch.tournament.balanceHoldUntil>NOW),'Settled table must wait for the final running hand');
});

test('multi-winner cutoff holds through rebuy grace and includes already paid queued chips',()=>{
 const t={id:'tor',status:'running',pokerType:'NLH',tableSize:6,payouts:[50,30,20],finishAtPaidPlaces:true,players:{a:{out:false},b:{out:false},c:{out:false},d:{out:true}}};
 const row={docId:'table',tournamentId:'tor',players:{a:{uid:'a',stack:200,bet:0,status:'waiting'},b:{uid:'b',stack:100,bet:0,status:'waiting'},c:{uid:'c',stack:0,bet:0,status:'busted'}},tournament:{},gameState:{phase:'waiting',pots:[]}};
 const waiting=T.plan(t,[row],NOW);assert.equal(waiting.finishers,undefined);assert.ok(waiting.updates[0].patch.tournament.balanceHoldUntil>NOW);
 row.players.c.pendingTournamentChips=300;
 const paid=T.plan(t,[row],NOW);assert.deepEqual(paid.finishers,['c','a','b']);assert.equal(paid.issue,null);
});

test('configured multi-winner tournament completes with three survivors and splits tied prizes',async t=>{
 const f=fixture(77),id=await create(f,{maxPlayers:18,finishAtPaidPlaces:true});await startHumans(f,id,18);let ticks=0;
 for(;ticks<500&&f.tour(id).status==='running';ticks++){
  f.advance(2000);await f.tours.tickTournament(id,f.now());
  if(f.tour(id).status!=='running')break;
  for(const [i,row]of f.tables(id).entries())if(ticks%(i+1)===0)await playOne(f,row);
 }
 const done=f.tour(id);assert.equal(done.status,'done');assert.equal(done.winnerUids.length,3);
 assert.ok(Object.values(done.players).filter(p=>!p.out).length>1,'Configured format must not continue until only one survivor');
 assert.deepEqual(done.results.slice(0,3).map(p=>p.prize).sort((a,b)=>a-b),[60,60,60]);
 const snapshot=copy([...f.docs]);await f.tours.tickTournament(id,f.now()+10000);assert.deepEqual([...f.docs],snapshot);
 t.diagnostic(JSON.stringify({ticks,survivors:Object.values(done.players).filter(p=>!p.out).length,payouts:done.results.slice(0,3).map(p=>p.prize)}));
});

// The user chooses the number of winners. Three above is only one scenario.
// These equal-stack all-in hands intentionally cross the cutoff by eliminating
// several entrants at once; qualifying eliminated ranks must still get paid.
for(const scenario of [
 {name:'2 fixed places',entrants:18,payouts:[70,30],places:2,expected:[126,54]},
 {name:'4 fixed places',entrants:18,payouts:[40,30,20,10],places:4,expected:[54,54,54,18]},
 {name:'5 fixed places',entrants:18,payouts:[40,25,15,12,8],places:5,expected:[48,48,48,21.6,14.4]},
 {name:'25% of 18 entrants',entrants:18,paidPct:25,payouts:[100],places:4,expected:[52.16,52.15,52.15,23.54]},
 {name:'25% of 20 entrants',entrants:20,paidPct:25,payouts:[100],places:5,expected:[45.17,45.17,45.17,45.16,19.33]}
])test('user-configured '+scenario.name+' controls completion and actual wallet awards',async t=>{
 const f=fixture(77),id=await create(f,{maxPlayers:scenario.entrants,payouts:scenario.payouts,paidPct:scenario.paidPct||0,finishAtPaidPlaces:true});
 assert.deepEqual(f.tour(id).payouts,scenario.payouts);assert.equal(f.tour(id).paidPct,scenario.paidPct||0);
 await startHumans(f,id,scenario.entrants);let ticks=0;const aliveCounts=[scenario.entrants];
 for(;ticks<500&&f.tour(id).status==='running';ticks++){
  f.advance(2000);await f.tours.tickTournament(id,f.now());
  assert.equal(f.tour(id).integrityIssue||null,null);assert.equal(T.chips(f.tables(id)),f.tour(id).initialChips);
  if(f.tour(id).status!=='running')break;
  for(const [i,row]of f.tables(id).entries())if(ticks%(i+1)===0){
   await playOne(f,row);const count=Object.values(f.tour(id).players).filter(p=>!p.out).length;
   if(count!==aliveCounts.at(-1))aliveCounts.push(count);
  }
 }
 const done=f.tour(id);assert.equal(done.status,'done');
 const awarded=done.results.filter(p=>p.prize>0),survivors=Object.values(done.players).filter(p=>!p.out).length;
 assert.equal(done.winnerUids.length,scenario.places);assert.equal(awarded.length,scenario.places);
 assert.deepEqual(awarded.map(p=>p.prize),scenario.expected,'Saved percentages apply; equal survivor stacks split only their combined rank prizes');
 assert.equal(Math.round(awarded.reduce((n,p)=>n+p.prize,0)*100),scenario.entrants*1000);
 for(const result of done.results)assert.equal(f.balance(result.uid),Math.round((989+result.prize)*100)/100,'Each paid result matches its wallet exactly');
 assert.equal(f.balance('owner'),100000+scenario.entrants,'All entry fees reach the owner once');
 if(survivors<scenario.places){
  const lastAbove=aliveCounts.findLast(n=>n>scenario.places);assert.ok(lastAbove>scenario.places);
  assert.equal(awarded.filter(p=>done.players[p.uid].out).length,scenario.places-survivors,'A simultaneous bust across the cutoff retains every configured paid rank');
 }
 const snapshot=copy([...f.docs]);await f.tours.tickTournament(id,f.now()+10000);assert.deepEqual([...f.docs],snapshot);
 t.diagnostic(JSON.stringify({configuration:scenario.name,ticks,aliveCounts,survivors,paidWinners:awarded.length,awards:awarded.map(p=>p.prize)}));
});

for(const pokerType of ['NLH','Omaha 4','Omaha 5','Omaha 6','Pineapple'])test(pokerType+': 18 entrants consolidate from three tables to one, finish and pay exactly once',async t=>{
 const f=fixture(100+['NLH','Omaha 4','Omaha 5','Omaha 6','Pineapple'].indexOf(pokerType)),id=await create(f,{pokerType});await startHumans(f,id,18);
 const sizes=[f.tables(id).length];let ticks=0,actions=0,moves=0;const seen=new Set();
 for(;ticks<1500&&f.tour(id).status==='running';ticks++){
  f.advance(2000);const before=f.tables(id);await f.tours.tickTournament(id,f.now());const after=f.tables(id);
  assert.equal(f.tour(id).integrityIssue||null,null);
  assert.equal(T.chips(after),f.tour(id).initialChips,'No tournament chips disappear during rebalance');
  if(after.length!==sizes.at(-1))sizes.push(after.length);
  for(const row of after){for(const p of Object.values(row.players)){if(p.status==='out')continue;const key=p.uid+'@'+row.docId;if(!seen.has(key)){if([...seen].some(k=>k.startsWith(p.uid+'@')))moves++;seen.add(key);}assert.ok(p.seatIndex>=0&&p.seatIndex<6);}
   const old=before.find(b=>b.docId===row.docId);if(old&&!T.idle(old))assert.deepEqual(Object.keys(row.players),Object.keys(old.players),'No seat moves during live hand');
  }
  if(f.tour(id).status!=='running')break;
  for(const [i,row]of after.entries())if(ticks%(i+1)===0){await playOne(f,row);actions++;}
 }
 assert.equal(f.tour(id).status,'done','Tournament completed before progress bound');
 assert.equal(sizes[0],3);assert.ok(sizes.includes(2));assert.equal(sizes.at(-1),1);assert.ok(moves>0);
 const done=f.tour(id);assert.equal(done.results.length,18);assert.equal(done.winnerUids.length,3);assert.equal(done.results.reduce((n,p)=>n+p.prize,0),180);assert.equal(done.finalFeeTotal,18);assert.deepEqual(done.results.slice(0,3).map(p=>p.prize),[90,54,36]);
 assert.equal(f.tables(id).every(row=>row.tournament.finished),true);
 assert.equal([...f.docs].filter(([p])=>p.startsWith('memberships/')).reduce((n,[,d])=>n+d.balance,0),118000,'Wallet funds conserved through entries, prizes and fees');
 const settled=copy([...f.docs]);for(let i=0;i<3;i++)await f.tours.tickTournament(id,f.now()+i*10000);assert.deepEqual([...f.docs],settled,'Repeated finish ticks cannot pay again');
 t.diagnostic(JSON.stringify({pokerType,ticks,actions,tableCounts:sizes,moves,paidWinners:done.winnerUids.length}));
});

test('rebuy grace, late entry and add-on use real payments and close at configured levels',async()=>{
 const f=fixture(27),id=await create(f,{maxPlayers:6,rebuys:true,maxRebuys:1,rebuyUntilLevel:1,lateRegUntilLevel:1,addon:true,addonLevel:2,structure:[{sb:1,bb:2,ante:0,mins:1},{sb:2,bb:4,ante:1,mins:120}]});await startHumans(f,id,3);
 const tid=f.tables(id)[0].docId;await f.action(tid,s=>f.engine.startHand(s));
 let steps=0;while(f.tables(id)[0].gameState.phase!=='showdown'&&steps++<60)await playOne(f,f.tables(id)[0]);
 const busted=Object.values(f.tables(id)[0].players).find(p=>p.status==='busted');assert.ok(busted);assert.equal(f.tour(id).players[busted.uid].out,false);
 await f.command(busted.uid,'rebuy',{tournamentId:id},'fixed-rebuy-idempotent-request');assert.equal(f.balance(busted.uid),978);assert.equal(f.tour(id).initialChips,400);
 await f.command(busted.uid,'rebuy',{tournamentId:id},'fixed-rebuy-idempotent-request');assert.equal(f.balance(busted.uid),978);
 f.member('late');await f.command('late','register',{tournamentId:id});assert.equal(f.tour(id).initialChips,500);
 f.advance(60000);f.member('closed');await assert.rejects(f.command('closed','register',{tournamentId:id}),e=>e.code==='failed-precondition');
 await assert.rejects(f.command(busted.uid,'rebuy',{tournamentId:id}),e=>e.code==='failed-precondition');
 await f.command(busted.uid,'addon',{tournamentId:id});assert.equal(f.balance(busted.uid),968);assert.equal(f.tour(id).initialChips,600);assert.equal(T.chips(f.tables(id)),600);
 await assert.rejects(f.command(busted.uid,'addon',{tournamentId:id}),e=>e.code==='failed-precondition');
 await f.tours.tickTournament(id,f.now());assert.equal(f.tour(id).integrityIssue||null,null);
});

test('disconnected players time out and do not stall the server table',async()=>{
 const f=fixture(3),id=await create(f,{maxPlayers:3});await startHumans(f,id,3);const tid=f.tables(id)[0].docId;
 await f.engine.tickTable(tid,f.now());assert.equal(f.tables(id)[0].gameState.phase,'preflop');
 for(let i=0;i<10&&f.tables(id)[0].gameState.phase!=='showdown';i++){f.advance(40000);await f.engine.tickTable(tid,f.now());}
 assert.equal(f.tables(id)[0].gameState.phase,'showdown');assert.equal(T.chips(f.tables(id)),300);
});
