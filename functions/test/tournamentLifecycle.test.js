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

test('legacy paid-place cutoff never ends a tournament with three survivors',()=>{
 const t={id:'tor',status:'running',tableSize:6,payouts:[50,30,20],finishAtPaidPlaces:true,players:{a:{},b:{},c:{}}};
 const players=Object.fromEntries(['a','b','c'].map((uid,i)=>[uid,{uid,stack:100,bet:0,status:'active',seatIndex:i}]));
 const row={docId:'table',tournamentId:'tor',players,tournament:{final:true},gameState:{phase:'showdown',showdownAt:NOW-10000,pots:[]}};
 const result=T.plan(t,[row],NOW);assert.equal(result.champion,null);assert.equal(result.finishers,undefined);assert.equal(result.issue,null);
});

test('paid places preserve normal play until one champion remains',async t=>{
 const f=fixture(77),id=await create(f,{maxPlayers:18,finishAtPaidPlaces:true});await startHumans(f,id,18);let ticks=0;
 for(;ticks<500&&f.tour(id).status==='running';ticks++){
  f.advance(2000);await f.tours.tickTournament(id,f.now());
  if(f.tour(id).status!=='running')break;
  for(const [i,row]of f.tables(id).entries())if(ticks%(i+1)===0)await playOne(f,row);
 }
 const done=f.tour(id);assert.equal(done.status,'done');assert.equal(done.winnerUids.length,3);
 assert.equal(Object.values(done.players).filter(p=>!p.out).length,1);
 assert.deepEqual(done.results.slice(0,3).map(p=>p.prize).sort((a,b)=>a-b),[36,54,90]);
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
 const weights=scenario.paidPct?Array.from({length:scenario.places},(_,i)=>1/Math.pow(i+1,.9)):scenario.payouts;const cents=scenario.entrants*1000,sum=weights.reduce((n,w)=>n+w,0),expected=weights.map(w=>Math.floor(cents*w/sum));expected[0]+=cents-expected.reduce((n,w)=>n+w,0);assert.deepEqual(awarded.map(p=>p.prize),expected.map(x=>x/100));assert.equal(survivors,1);
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
 assert.equal(f.tables(id).every(row=>row.tournament.finished),true);assert.equal(done.results[0].finalChips,done.initialChips);assert.ok(done.results.slice(1).every(r=>r.finalChips===0));assert.equal(f.tables(id).flatMap(row=>Object.values(row.players)).length,1);assert.ok(f.tables(id).every(row=>row.gameState.phase==='waiting'&&row.gameState.board.length===0&&row.gameState.activeTurnUid===null));
 assert.equal([...f.docs].filter(([p])=>p.startsWith('memberships/')).reduce((n,[,d])=>n+d.balance,0),118000,'Wallet funds conserved through entries, prizes and fees');
 const settled=copy([...f.docs]);for(let i=0;i<3;i++)await f.tours.tickTournament(id,f.now()+i*10000);assert.deepEqual([...f.docs],settled,'Repeated finish ticks cannot pay again');
 t.diagnostic(JSON.stringify({pokerType,ticks,actions,tableCounts:sizes,moves,paidWinners:done.winnerUids.length}));
});

test('eliminated players leave the seat and use paid re-entry; late entry and add-on retain server accounting',async()=>{
 const f=fixture(27),id=await create(f,{maxPlayers:6,rebuys:true,maxRebuys:1,rebuyUntilLevel:1,reentry:true,maxReentries:1,lateRegUntilLevel:1,addon:true,addonLevel:2,structure:[{sb:1,bb:2,ante:0,mins:1},{sb:2,bb:4,ante:1,mins:120}]});await startHumans(f,id,3);
 const tid=f.tables(id)[0].docId;await f.action(tid,s=>f.engine.startHand(s));
 let steps=0;while(f.tables(id)[0].gameState.phase!=='showdown'&&steps++<60)await playOne(f,f.tables(id)[0]);
 const busted=Object.entries(f.tour(id).players).map(([uid,p])=>({...p,uid})).find(p=>p.out);assert.ok(busted);assert.equal(f.tables(id).some(row=>row.players[busted.uid]),false,'eliminated seat is removed by settlement itself');assert.equal(f.tour(id).players[busted.uid].out,true);assert.equal(f.tour(id).rebuys,false);assert.equal(f.tour(id).maxRebuys,0);
 await f.command(busted.uid,'register',{tournamentId:id},'fixed-reentry-idempotent-request');assert.equal(f.balance(busted.uid),978);assert.equal(f.tour(id).initialChips,400);
 await f.command(busted.uid,'register',{tournamentId:id},'fixed-reentry-idempotent-request');assert.equal(f.balance(busted.uid),978);
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

test('freeroll supports independently priced, idempotent re-entry with server limits',async()=>{
 for(const buyIn of [0,10])for(const reentryToPrizePool of [false,true])for(const reentryBuyIn of [0,50]){
  const f=fixture(7),id=await create(f,{buyIn,fee:0,reentryBuyIn,reentryToPrizePool,reentry:true,maxReentries:1,lateRegUntilLevel:1,rebuys:false,maxPlayers:6});
  await startHumans(f,id,3);const tour=f.tour(id),row=f.docs.get('tables/'+f.tables(id)[0].docId);
  const lost=row.players.human0.stack;row.players.human0.stack=0;row.players.human0.status='out';row.players.human1.stack+=lost;tour.players.human0.out=true;tour.players.human0.rank=3;
  const pool=tour.prizePool;await f.command('human0','register',{tournamentId:id},'reentry-once-request-id');
  assert.equal(f.balance('human0'),1000-buyIn-reentryBuyIn);assert.equal(f.tour(id).prizePool,pool+(reentryToPrizePool?reentryBuyIn:0));assert.equal(f.tour(id).feeTotal,reentryToPrizePool?0:reentryBuyIn);assert.equal(f.tour(id).players.human0.feesPaid,reentryToPrizePool?0:reentryBuyIn);assert.equal(f.tour(id).players.human0.reentries,1);
  assert.equal(f.tables(id).flatMap(t=>Object.values(t.players)).find(p=>p.uid==='human0').stack,100);
  await f.command('human0','register',{tournamentId:id},'reentry-once-request-id');assert.equal(f.balance('human0'),1000-buyIn-reentryBuyIn);
  f.tour(id).players.human0.out=true;await assert.rejects(f.command('human0','register',{tournamentId:id}),e=>e.message==='Re-entry unavailable');
 }
});
test('re-entry rejects insufficient balance and closed registration without charging',async()=>{
 for(const closed of [false,true]){
  const f=fixture(7),id=await create(f,{buyIn:0,fee:0,reentryBuyIn:50,reentry:true,maxReentries:1,lateRegUntilLevel:1,rebuys:false,maxPlayers:6,structure:[{sb:1,bb:2,ante:0,mins:1},{sb:2,bb:4,ante:0,mins:120}]});
  await startHumans(f,id,3);f.tour(id).players.human0.out=true;
  const row=f.docs.get('tables/'+f.tables(id)[0].docId);row.players.human1.stack+=row.players.human0.stack;row.players.human0.stack=0;row.players.human0.status='out';
  if(closed)f.advance(60000);else f.docs.get('memberships/human0_clubA').balance=49;
  const before=f.balance('human0'),pool=f.tour(id).prizePool;
  await assert.rejects(f.command('human0','register',{tournamentId:id}));assert.equal(f.balance('human0'),before);assert.equal(f.tour(id).prizePool,pool);assert.equal(f.tour(id).players.human0.out,true);
 }
});
test('legacy tournaments retain entry price and explicit re-entry zero is preserved',()=>{
 const f=fixture(),base={name:'Price test',buyIn:25,fee:2};
 assert.equal(f.tours.config(base,'clubA','owner',NOW).reentryBuyIn,25);
 assert.equal(f.tours.config({...base,reentryBuyIn:0},'clubA','owner',NOW).reentryBuyIn,0);
 assert.throws(()=>f.tours.config({...base,reentryBuyIn:-1},'clubA','owner',NOW),e=>e.message.includes('Re-entry buy-in'));
});

test('bot button adds exactly one funded entrant, is idempotent and respects capacity',async()=>{
 const f=fixture(1),id=await create(f,{maxPlayers:2});
 await f.command('owner','fillbots',{tournamentId:id},'single-bot-request-one');
 assert.equal(Object.keys(f.tour(id).players).length,1);assert.equal(f.balance('owner'),99989);
 await f.command('owner','fillbots',{tournamentId:id},'single-bot-request-one');assert.equal(Object.keys(f.tour(id).players).length,1);
 await f.command('owner','fillbots',{tournamentId:id});assert.equal(Object.keys(f.tour(id).players).length,2);assert.equal(f.balance('owner'),99978);
 await assert.rejects(f.command('owner','fillbots',{tournamentId:id}),e=>e.message==='Tournament full');
});
test('delete before start refunds entries and sponsor once, retaining records',async()=>{
 const f=fixture(),id=await create(f,{addedPrize:50});f.member('human');await f.command('human','register',{tournamentId:id});
 assert.equal(f.balance('human'),989);assert.equal(f.balance('owner'),99950);
 await f.command('owner','archive',{tournamentId:id});assert.equal(f.balance('human'),1000);assert.equal(f.balance('owner'),100000);assert.equal(f.tour(id).archived,true);assert.equal(f.tour(id).status,'cancelled');
 await f.command('owner','archive',{tournamentId:id});assert.equal(f.balance('human'),1000);assert.equal(f.balance('owner'),100000);
 await assert.rejects(f.command('human','register',{tournamentId:id}),e=>e.message==='This tournament was deleted');
});
test('delete running stops tables, retains accounting, and prevents future dealing',async()=>{
 const f=fixture(1),id=await create(f,{addedPrize:50});await startHumans(f,id,3);
 const tid=f.tables(id)[0].docId;await f.action(tid,s=>f.engine.startHand(s));const before=f.balance('human0'),pool=f.tour(id).prizePool;
 await f.command('owner','archive',{tournamentId:id});assert.equal(f.tour(id).status,'cancelled');assert.equal(f.tour(id).prizePool,pool);assert.equal(f.balance('human0'),before);assert.equal(f.tables(id).every(t=>t.tournament.finished&&t.tournament.cancelled),true);
 const snapshots=copy([...f.docs]);await f.tours.tickTournament(id,f.now());assert.deepEqual([...f.docs],snapshots);
});
test('manager actions reject ordinary players',async()=>{
 const f=fixture(),id=await create(f);f.member('ordinary');f.member('human');await f.command('human','register',{tournamentId:id});
 for(const op of ['fillbots','archive','removeplayer'])await assert.rejects(f.command('ordinary',op,{tournamentId:id,playerUid:'human'}),e=>e.code==='permission-denied');
 assert.equal(f.tour(id).archived,undefined);assert.equal(Object.keys(f.tour(id).players).length,1);
});
test('removing before start refunds one player and blocks re-entry',async()=>{
 const f=fixture(),id=await create(f);f.member('human');await f.command('human','register',{tournamentId:id});
 await f.command('owner','removeplayer',{tournamentId:id,playerUid:'human'});assert.equal(f.balance('human'),1000);assert.equal(f.tour(id).prizePool,0);assert.equal(f.tour(id).feeTotal,0);assert.equal(f.tour(id).players.human,undefined);
 await f.command('owner','removeplayer',{tournamentId:id,playerUid:'human'});assert.equal(f.balance('human'),1000);
 await assert.rejects(f.command('human','register',{tournamentId:id}),e=>e.code==='permission-denied');
});
test('running removal waits for a settled hand and preserves chip accounting',async()=>{
 const f=fixture(13),id=await create(f,{reentry:true,maxReentries:3,lateRegUntilLevel:4,finishAtPaidPlaces:false,rebuys:false});await startHumans(f,id,4);
 const tid=f.tables(id)[0].docId;await f.action(tid,s=>f.engine.startHand(s));const rowBefore=copy(f.tables(id)[0]),balance=f.balance('human0');
 const result=await f.command('owner','removeplayer',{tournamentId:id,playerUid:'human0'});assert.equal(result.queued,true);assert.deepEqual(f.tables(id)[0].players,rowBefore.players);assert.equal(f.tour(id).players.human0.removalRequested,true);
 let n=0;while(f.tables(id)[0].gameState.phase!=='showdown'&&n++<80)await playOne(f,f.tables(id)[0]);
 await f.tours.tickTournament(id,f.now());assert.equal(f.tour(id).players.human0.removed,true);assert.equal(f.tour(id).players.human0.out,true);assert.equal(f.balance('human0'),balance);assert.equal(T.chips(f.tables(id)),f.tour(id).initialChips);
 assert.equal(f.tables(id).some(t=>t.players.human0),false);await assert.rejects(f.command('human0','register',{tournamentId:id}),e=>e.code==='permission-denied');
});

test('removed participant gets no final prize while all entry fees remain accounted',async()=>{
 const f=fixture(5),id=await create(f,{finishAtPaidPlaces:false,rebuys:false});await startHumans(f,id,4);await f.command('owner','removeplayer',{tournamentId:id,playerUid:'human0'});
 let steps=0;while(f.tour(id).status==='running'&&steps++<300){f.advance(6000);await f.tours.tickTournament(id,f.now());if(f.tour(id).status!=='running')break;for(const row of f.tables(id))await playOne(f,row);}
 assert.equal(f.tour(id).status,'done');assert.equal(f.tour(id).results.some(r=>r.uid==='human0'),false);assert.equal(f.balance('human0'),989);assert.equal(f.tour(id).results.reduce((n,p)=>n+p.prize,0),40);assert.equal(f.tour(id).finalFeeTotal,4);
});

test('coordinator removes eliminated zero seats only at safe hand boundaries',()=>{
 const seat=(uid,stack,status='active')=>({uid,stack,status,bet:0,seatIndex:uid==='a'?0:1});
 const t={id:'tor',status:'running',tableSize:2,players:{a:{},b:{},gone:{out:true}}};
 const row={docId:'one',tournamentId:'tor',tournament:{final:true},players:{a:seat('a',100),b:seat('b',100),gone:seat('gone',0,'out')},gameState:{phase:'showdown',showdownAt:NOW-6000,pots:[]}};
 const cleaned=T.plan(t,[row],NOW);assert.equal(cleaned.issue,null);assert.equal(cleaned.updates[0].patch.players.gone,undefined);assert.equal(T.chips([row]),T.chips([{...row,...cleaned.updates[0].patch}]));
 row.gameState.phase='river';assert.equal(T.plan(t,[row],NOW).updates.length,0);assert.ok(row.players.gone);
});
test('new deal reaps eliminated seats but retains paid pending rebuy',async()=>{
 const f=fixture(),id=await create(f,{rebuys:true});await startHumans(f,id,3);const row=f.tables(id)[0];
 const d=f.docs.get('tables/'+row.docId);d.players.human2.stack=0;d.players.human2.status='out';f.tour(id).players.human2.out=true;
 await f.action(row.docId,s=>f.engine.startHand(s));assert.equal(f.tables(id)[0].players.human2,undefined);
});
test('consolidation holds busy tables before their next deal, preventing missed showdown windows',()=>{
 const now=NOW,roster={},rows=[2,2,1].map((count,i)=>{const players={};for(let j=0;j<count;j++){const uid='p'+i+j;roster[uid]={};players[uid]={uid,stack:100,bet:0,status:'active',seatIndex:j};}return{docId:'t'+i,tournamentId:'tor',players,tournament:{},gameState:{phase:i===1?'river':'showdown',showdownAt:now-10000,pots:[]}};});
 const t={id:'tor',status:'running',tableSize:3,players:roster};const hold=T.plan(t,rows,now);
 assert.equal(hold.deletes.length,0);assert.equal(hold.updates.length,3);assert.equal(hold.updates.find(u=>u.id==='t1').patch.gameState.phase,'river');
 for(const u of hold.updates)Object.assign(rows.find(r=>r.docId===u.id),u.patch);
 rows[1].gameState={...rows[1].gameState,phase:'showdown',showdownAt:now+1000};
 const moved=T.plan(t,rows,now+7000);assert.equal(moved.issue,null);assert.equal(moved.deletes.length,1);assert.equal(moved.updates.reduce((sum,u)=>sum+Object.keys(u.patch.players).length,0),5);
});
test('legacy rebuy grace exits immediately without charge; re-entry waits alone with a funded stack',async()=>{
 const f=fixture(),id=await create(f,{reentry:true,maxReentries:2,lateRegUntilLevel:4,reentryBuyIn:50,bounty:5,fee:2});await startHumans(f,id,3);
 const row=f.docs.get('tables/'+f.tables(id)[0].docId);Object.assign(row.players.human0,{stack:0,status:'busted',bustedAt:f.now()});row.players.human1.stack=200;
 Object.assign(f.tour(id),{rebuys:true,botRebuys:true,maxRebuys:3});const before=f.balance('human0');await f.tours.tickTournament(id,f.now());
 assert.equal(f.tour(id).players.human0.out,true);assert.equal(f.tour(id).rebuys,false);assert.equal(f.balance('human0'),before);assert.equal(f.tables(id).some(r=>r.players.human0),false);
 await assert.rejects(f.command('human0','rebuy',{tournamentId:id}),e=>e.code==='failed-precondition');const pool=f.tour(id).prizePool,bounty=f.tour(id).bountyPool;
 const joined=await f.command('human0','register',{tournamentId:id});assert.ok(joined.tableId);const waiting=f.tables(id).find(r=>r.docId===joined.tableId);
 assert.equal(Object.keys(waiting.players).length,1);assert.equal(waiting.players.human0.stack,100);assert.equal(waiting.gameState.phase,'waiting');assert.equal(f.balance('human0'),before-57);assert.equal(f.tour(id).prizePool,pool+50);assert.equal(f.tour(id).bountyPool,bounty+5);
 f.advance(7000);await f.tours.tickTournament(id,f.now());assert.equal(f.tour(id).integrityIssue||null,null);assert.equal(f.tables(id).length,1);assert.equal(T.chips(f.tables(id)),400);
});

test('one funded bot can join a running tournament during late registration without touching an active hand',async()=>{
 const f=fixture(),id=await create(f,{bounty:5,lateRegUntilLevel:1,structure:[{sb:1,bb:2,ante:0,mins:3},{sb:2,bb:4,ante:0,mins:3}]});
 for(const uid of ['a','b']){f.member(uid);await f.command(uid,'register',{tournamentId:id});}await f.command('owner','start',{tournamentId:id});
 const before=f.tables(id)[0];f.docs.get('tables/'+before.docId).gameState.phase='preflop';const active=structuredClone(f.docs.get('tables/'+before.docId));
 const balance=f.balance('owner'),chips=f.tour(id).initialChips;await f.command('owner','fillbots',{tournamentId:id},'late-bot-request-once');
 const bot=Object.values(f.tour(id).players).find(p=>p.isBot);assert.ok(bot);assert.equal(f.balance('owner'),balance-16);assert.equal(f.tour(id).initialChips,chips+100);
 assert.deepEqual(f.docs.get('tables/'+before.docId),active);const waiting=f.docs.get('tables/'+bot.tableId);assert.equal(Object.keys(waiting.players).length,1);assert.equal(waiting.gameState.phase,'waiting');assert.equal(waiting.players[bot.uid].stack,100);
 await f.command('owner','fillbots',{tournamentId:id},'late-bot-request-once');assert.equal(Object.values(f.tour(id).players).filter(p=>p.isBot).length,1);assert.equal(f.balance('owner'),balance-16);
 f.advance(180000);await assert.rejects(f.command('owner','fillbots',{tournamentId:id}),e=>e.message.includes('Late registration is closed'));assert.equal(f.balance('owner'),balance-16);
});

test('90-minute deadline admits humans and one bot at minute 38 despite level 2 cutoff, then closes exactly on time',async()=>{
 const f=fixture(),deadline=NOW+90*60000,id=await create(f,{startAt:NOW,lateRegClosesAt:deadline,lateRegUntilLevel:2,bounty:5,structure:Array.from({length:20},(_,i)=>({sb:i+1,bb:(i+1)*2,ante:0,mins:10}))});
 await startHumans(f,id,2);f.advance(38*60000);assert.equal(f.tours.clock(f.tour(id),f.now()).lvl,3);
 f.member('lateHuman');await f.command('lateHuman','register',{tournamentId:id});assert.equal(f.balance('lateHuman'),984);
 const botBalance=f.balance('owner');await f.command('owner','fillbots',{tournamentId:id});assert.equal(f.balance('owner'),botBalance-16);assert.equal(Object.values(f.tour(id).players).filter(p=>p.isBot).length,1);assert.equal(T.chips(f.tables(id)),400);
 f.advance(52*60000);f.member('tooLate');await assert.rejects(f.command('tooLate','register',{tournamentId:id}),/Registration closed/);await assert.rejects(f.command('owner','fillbots',{tournamentId:id}),/Late registration is closed/);assert.equal(f.balance('tooLate'),1000);assert.equal(f.balance('owner'),botBalance-16);
});

test('manager can correct live registration deadline, with authorization, validation, audit and replay safety',async()=>{
 const f=fixture(),id=await create(f,{lateRegUntilLevel:0});await startHumans(f,id,3);const deadline=NOW+90*60000;
 const seats=copy(f.tables(id)),balance=f.balance('owner');await assert.rejects(f.command('human0','registration',{tournamentId:id,lateRegClosesAt:deadline}),e=>e.code==='permission-denied');
 await assert.rejects(f.command('owner','registration',{tournamentId:id,lateRegClosesAt:NOW-1}),/Late registration closing/);
 await f.command('owner','registration',{tournamentId:id,lateRegClosesAt:deadline},'registration-deadline-once');await f.command('owner','registration',{tournamentId:id,lateRegClosesAt:deadline},'registration-deadline-once');
 assert.equal(f.tour(id).lateRegClosesAt,deadline);assert.equal(f.tour(id).registrationChanges.length,1);assert.equal(f.tour(id).registrationChanges[0].by,'owner');assert.equal(f.balance('owner'),balance);assert.deepEqual(f.tables(id),seats);
 // An eliminated participant can re-enter during the same corrected window.
 const t=f.tour(id),row=f.docs.get('tables/'+f.tables(id)[0].docId);t.reentry=true;t.maxReentries=1;t.reentryBuyIn=20;t.bounty=5;t.players.human0.out=true;row.players.human1.stack+=row.players.human0.stack;row.players.human0.stack=0;row.players.human0.status='out';
 const wallet=f.balance('human0');await f.command('human0','register',{tournamentId:id});assert.equal(f.balance('human0'),wallet-26);assert.equal(f.tour(id).players.human0.out,false);
 f.tour(id).status='done';await assert.rejects(f.command('owner','registration',{tournamentId:id,lateRegClosesAt:deadline}),/Only an active tournament/);
});

test('time-based registration cannot overlap mystery bounties or start before the tournament',()=>{
 const f=fixture(),base={name:'Time validation',startAt:NOW,lateRegUntilLevel:2,structure:[{sb:1,bb:2,mins:10},{sb:2,bb:4,mins:10},{sb:3,bb:6,mins:10}]};
 assert.throws(()=>f.tours.config({...base,lateRegClosesAt:NOW-1},'clubA','owner',NOW),/Late registration closing/);
 assert.throws(()=>f.tours.config({...base,bountyMode:'mystery',mysteryStartLevel:3,lateRegClosesAt:NOW+30*60000},'clubA','owner',NOW),/before mystery bounties/);
 assert.equal(f.tours.config({...base,bountyMode:'mystery',mysteryStartLevel:3,lateRegClosesAt:NOW+20*60000},'clubA','owner',NOW).lateRegClosesAt,NOW+20*60000);
});
