'use strict';
// Real App + PokerTable + result dialog, with only Firebase transport replaced.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};
w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-viewer-access.js'),'utf8'));
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-auth.js'),'utf8'));
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8');
w.eval([...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function App()'))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.FinishAppTest=App;'));
w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const record=(id,data)=>({id,exists:()=>!!data,data:()=>structuredClone(data),metadata:{fromCache:false}});
const records=rows=>({docs:rows.map(row=>record(row.id,row)),metadata:{fromCache:false}});
function fixture(multiple=false,delayPreviews=false){
 const identity={uid:'winner',email:'winner@example.test',emailVerified:true};
 const club={id:'main',name:'Finish test',ownerUid:'owner'};
 const profile={uid:'winner',username:'Winner',email:identity.email,status:'approved',role:'player',playerId:'P123456789'};
 const membership={id:'winner_main',uid:'winner',clubId:'main',username:'Winner',role:'player',status:'approved',balance:100};
 const tor={id:'event',clubId:'main',authorityVersion:2,game:'poker',name:'Final event',status:'running',startedAt:Date.now(),startStack:30000,prizePool:4000,payouts:[100],paidPlaces:1,tableSize:8,structure:[{sb:100,bb:200,ante:0,mins:10}],players:{winner:{uid:'winner',name:'Winner',tableId:'final'},other:{uid:'other',name:'Other',tableId:'final'}}};
 const table={id:'final',docId:'final',type:'poker',clubId:'main',authorityVersion:2,tournamentId:'event',tournament:{finished:false,final:true},settings:{serverEngine:true,baseGameType:'NLH',maxPlayers:8,blinds:100,actionTime:15},gameState:{__seq:1,phase:'waiting',handN:1,board:[],pots:[]},players:{winner:{uid:'winner',name:'Winner',stack:30000,bet:0,status:'active',seatIndex:0,cardCount:0},other:{uid:'other',name:'Other',stack:30000,bet:0,status:'active',seatIndex:1,cardCount:0}}};
 const extra=[];
 if(multiple)for(const [id,seated] of [['cash-b',true],['cash-c',false]]){
  const cash=structuredClone(table);Object.assign(cash,{id,docId:id});delete cash.tournament;delete cash.tournamentId;
  cash.settings.tableName=seated?'Evening cash':'Open cash';if(!seated)delete cash.players.winner;
  extra.push(cash);
 }
 const cards=(id)=>id==='cash-b'?['2♠','3♥','4♦','5♣','6♠','7♥','8♦']:['A♥','K♣'];
 const listeners=new Map(),calls=[];let tokenChanged;
 const ref=(_, ...parts)=>({path:parts.join('/')});
 const snapshot=target=>{
  const path=target.path;
  if(path==='users/winner')return record('winner',profile);
  if(path==='memberships/winner_main')return record(membership.id,membership);
  if(path==='clubs/main')return record('main',club);
  if(path==='clubs')return records([club]);
  if(path==='memberships')return records([membership]);
  if(path==='tableLobbyViews')return records([table,...extra]);
  if(path==='tournamentViews')return records([tor]);
  if(path==='tables/final')return record('final',table);
  const cash=extra.find(t=>path==='tables/'+t.id);if(cash)return record(cash.id,cash);
  if(path==='tournamentViews/event')return record('event',tor);
  return record(path.split('/').at(-1),null);
 };
 const denyWrite=()=>assert.fail('Finishing navigation must not write game data');
 w.fb={db:{},auth:{currentUser:identity},doc:ref,collection:ref,where:(...f)=>f,query:(r,...filters)=>({...r,filters}),
  onIdTokenChanged:(_,fn)=>{tokenChanged=fn;return()=>{};},
  getDoc:async r=>snapshot(r),getDocs:async r=>snapshot(r),
  onSnapshot:(r,options,next)=>{const fn=typeof options==='function'?options:next;const rows=listeners.get(r.path)||new Set();rows.add(fn);listeners.set(r.path,rows);fn(snapshot(r));return()=>rows.delete(fn);},
  fx:async(name,args)=>{calls.push({name,args});if(name==='pkEnsurePlayer')return{playerId:profile.playerId};if(name==='pkSeatPreview'&&delayPreviews)return new Promise(()=>{});
   if(name==='pkSeatPreview'&&multiple)return {preview:{
    cards:cards(args.tableId).map(c=>({val:c[0],suit:c[1]})),turn:true,bettingTurn:true,deadline:Date.now()+19000}};
   if(name==='pkTick'||name==='pkTournament'&&args.op==='tick'||name==='pkSeat'&&args.op==='heartbeat')return{};throw Error('Unexpected mutation: '+name);},
  updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite};
 return{table,tor,calls,extra,signIn:()=>tokenChanged(identity),emit:path=>{for(const fn of [...(listeners.get(path)||[])])fn(snapshot({path}));}};
}
const view=()=>new URL(w.location.href).searchParams.get('v');
const dialog=()=>doc.querySelector('[role="dialog"][aria-label="Champion"]');
async function start(f){
 w.localStorage.clear();await React.act(()=>root.render(React.createElement(w.FinishAppTest)));
 await React.act(async()=>f.signIn());
 await React.act(()=>doc.querySelector('.blue-club-orb[aria-label^="Enter "]').click());
 await React.act(()=>doc.querySelector('[data-resume-table="final"]').click());
 assert.equal(view(),'poker-table');assert.ok(doc.querySelector('.poker-room'));assert.equal(w.localStorage.getItem('pkResume'),'final');
}
function finishTable(f){f.table.tournament.finished=true;f.table.gameState.__seq++;delete f.table.players.other;f.table.players.winner.stack=60000;}
function finishEvent(f){Object.assign(f.tor,{status:'done',finishedAt:Date.now(),finalPrizePool:4000,prizePool:0,results:[{uid:'winner',name:'Winner',rank:1,prize:4000,finalChips:60000}]});f.tor.players.winner.rank=1;f.tor.players.other.out=true;f.tor.players.other.rank=2;}
(async()=>{try{
 const regular=fixture(true);await start(regular);
 const mini=()=>doc.querySelector('.multi-thumb .multi-switch');
 const assertPublic=()=>assert.doesNotMatch([doc.querySelector('#root').textContent,...[...doc.querySelectorAll('[title],[aria-label]')].map(n=>(n.title||'')+' '+(n.getAttribute('aria-label')||''))].join(' '),/\bbots?\b|בוט|god (?:mode|view)/i);
 assert.equal(mini().querySelectorAll('.multi-card').length,7);assert.ok(mini().querySelector('[role="timer"]'));assertPublic();
 await React.act(()=>doc.querySelector('.multi-add').click());
 assert.equal(view(),'lobby');assert.equal(doc.querySelectorAll('.multi-picker-seats .multi-thumb').length,2);
 assert.equal(doc.querySelectorAll('.multi-picker-seats [role="timer"]').length,2,'simultaneous turns survive the picker');
 const row=doc.querySelector('.additional-table-grid');assert.match(row.textContent,/Open cash/);assert.doesNotMatch(row.textContent,/Evening cash/);
 await React.act(()=>[...doc.querySelectorAll('.additional-table-lobby nav button')].find(b=>b.textContent==='Tournaments').click());
 assert.equal(row.children.length,0,'registered tournament cannot be entered twice');assertPublic();
 await React.act(()=>doc.querySelector('.additional-table-lobby header button').click());
 await React.act(()=>mini().querySelector('.multi-card').click());assert.equal(w.localStorage.getItem('pkResume'),'cash-b');
 assert.equal(mini().querySelectorAll('.multi-card').length,2);assert.match(mini().getAttribute('aria-label'),/A♥ K♣/);assertPublic();
 const moved=structuredClone(regular.table);Object.assign(moved,{id:'moved',docId:'moved'});regular.extra.push(moved);
 regular.tor.players.winner.tableId='moved';
 await React.act(()=>{regular.emit('tableLobbyViews');regular.emit('tournamentViews');});
 assert.equal(doc.querySelectorAll('.multi-thumb').length,1,'stale roster never creates a second entry for one tournament');
 await React.act(()=>mini().click());assert.equal(w.localStorage.getItem('pkResume'),'moved','switch follows table balancing');
 assert.equal(regular.calls.some(c=>c.name==='pkLeave'||c.name==='pkAct'||c.name==='pkTournament'&&c.args.op!=='tick'),false);
 await React.act(()=>root.render(null));
 const slow=fixture(true,true);await start(slow);
 const cashTicks=()=>slow.calls.filter(c=>c.name==='pkTick'&&c.args.tableId==='cash-b').length;
 const ticksBefore=cashTicks();assert.ok(ticksBefore>0);assert.equal(mini().querySelector('[role=timer]'),null);
 await React.act(async()=>{await new Promise(done=>setTimeout(done,1150));});
 assert.ok(cashTicks()>ticksBefore,'a pending private hand read cannot delay the regular game timer');
 assert.equal(slow.calls.some(c=>c.name==='pkAct'||c.name==='pkLeave'),false);
 await React.act(()=>root.render(null));
 for(const order of ['table-first','result-first','already-dismissed']){
  const f=fixture();await start(f);
  await React.act(()=>f.emit('tables/final'));assert.equal(view(),'poker-table','running tournament never redirects');
  if(order==='already-dismissed')w.localStorage.setItem('tourCele_event','1');
  if(order==='result-first'){finishEvent(f);await React.act(()=>f.emit('tournamentViews'));assert.ok(dialog());assert.equal(view(),'poker-table');}
  finishTable(f);await React.act(()=>f.emit('tables/final'));
  assert.equal(view(),'lobby','a completed table returns to the real lobby');assert.equal(doc.querySelector('.poker-room'),null);assert.equal(w.localStorage.getItem('pkResume'),null);
  if(order!=='result-first'){finishEvent(f);await React.act(()=>f.emit('tournamentViews'));}
  await React.act(()=>f.emit('tableLobbyViews'));
  assert.equal(doc.querySelector('[data-resume-table="final"]'),null,'completed winner seat is not advertised as an active game');
  if(order==='already-dismissed')assert.equal(dialog(),null,'previously seen prize is not replayed');
  else{assert.ok(dialog(),'champion dialog survives navigation and snapshot ordering');assert.match(dialog().textContent,/4,000.00/);await React.act(()=>[...dialog().querySelectorAll('button')].find(b=>b.textContent==='Continue').click());assert.equal(dialog(),null);assert.equal(view(),'lobby');}
  await React.act(()=>f.emit('tournamentViews'));assert.equal(dialog(),null,'repeated snapshots do not replay the result');
  assert.equal(f.calls.some(c=>c.name==='pkLeave'||c.name==='pkSeat'&&c.args.op!=='heartbeat'||c.name==='pkTournament'&&c.args.op!=='tick'),false,'navigation never cashes out tournament chips or repeats payout');
  await React.act(()=>root.render(null));
 }
 // Deliver the tournament and table snapshots independently, as Firestore does.
 let now=0, timerId=0;
 const timers=new Map();
 Object.defineProperty(w.performance,'now',{value:()=>now});
 w.setTimeout=(fn,ms=0)=>{const id=++timerId;timers.set(id,{fn,at:now+ms});return id;};
 w.clearTimeout=id=>timers.delete(id);
 async function advance(ms){
  const until=now+ms;
  while(true){
   const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!due)break;
   now=due[1].at;timers.delete(due[0]);await React.act(async()=>due[1].fn());
  }
  now=until;
 }
 const outDialog=()=>doc.querySelector('[aria-label="Your tournament result"]');
 for(const scenario of ['roster-first','table-first','final','reduced']){
  const f=fixture();
  w.matchMedia=query=>({matches:scenario==='reduced'&&query.includes('prefers-reduced-motion'),addEventListener(){},removeEventListener(){}});
  Object.assign(f.table.gameState,{phase:'river',currentGameType:'NLH',activeTurnUid:'other',pots:[{amount:900}]});
  f.table.players.third={uid:'third',name:'Third',stack:2000,bet:0,status:'active',seatIndex:2,cardCount:2};
  f.table.players.fourth={uid:'fourth',name:'Fourth',stack:100,bet:0,status:'active',seatIndex:3,cardCount:2};
  f.tor.players.third={uid:'third',name:'Third',tableId:'final'};
  await start(f);
  const rail=()=>[...doc.querySelectorAll('.poker-seat')].map(x=>[x.dataset.playerUid,x.style.left,x.style.top]);
  const beforeRail=rail();
  const markOut=async()=>{
   Object.assign(f.tor.players.winner,{out:true,rank:scenario==='final'?2:3});
   if(scenario==='final')Object.assign(f.tor,{status:'done',finishedAt:Date.now(),results:[{uid:'other',rank:1,prize:3000},{uid:'winner',rank:2,prize:1000}]});
   await React.act(()=>{f.emit('tournamentViews/event');f.emit('tournamentViews');});
  };
  if(scenario!=='table-first')await markOut();
  assert.equal(doc.querySelector('.pt-tour-finish'),null,'roster must not cover the live river');
  Object.assign(f.table.gameState,{phase:'showdown',__seq:2,showdownAt:Date.now(),activeTurnUid:null,pots:[],lastWinners:'Other, Third',lastWinAmount:900,lastAwards:[{uid:'other',amount:600},{uid:'third',amount:300}]});
  delete f.table.players.fourth;
  delete f.table.players.winner;
  f.table.players.other.stack+=600;f.table.players.third.stack+=300;
  await React.act(()=>f.emit('tables/final'));
  if(scenario==='table-first')await markOut();
  assert.deepEqual(rail(),beforeRail,'every seat stays in position through a double knockout');
  assert.ok(doc.querySelector('[data-player-uid="winner"]'),'eliminated seat stays on the rail');
  assert.equal(outDialog(),null);
  if(scenario==='final'){
   f.table.tournament.finished=true;
   Object.assign(f.table.gameState,{__seq:3,phase:'waiting',lastAwards:[],lastWinners:null});
   delete f.table.players.third;
   await React.act(()=>f.emit('tables/final'));
  }
  if(scenario==='reduced'){
   assert.equal(doc.querySelector('.poker-pot-award'),null);
   await advance(450);assert.ok(doc.querySelector('.poker-seat-winner'));
   assert.equal(outDialog(),null);await advance(1350);
  }else{
   assert.equal(doc.querySelectorAll('.poker-pot-award').length,2);
   await advance(2710);
   assert.equal(view(),'poker-table');
   assert.ok(doc.querySelector('.poker-seat-winner'));
   const won=[...doc.querySelectorAll('strong')].map(n=>n.textContent).find(line=>line.includes('Other +600'));
   assert.ok(won);assert.doesNotMatch(won,/\.00/);
   assert.equal(doc.querySelector('[data-player-uid="third"] .poker-stack-amount').textContent,'2,000');
   assert.equal(doc.querySelector('.pt-tour-finish'),null,'second award still in flight');
   await advance(100);
   assert.equal(doc.querySelector('[data-player-uid="third"] .poker-stack-amount').textContent,'2,300');
   assert.equal(doc.querySelector('.pt-tour-finish'),null,'credited stack is visible before the result');
   await advance(1350);
  }
  if(scenario==='final'){
   assert.equal(view(),'lobby');assert.ok(doc.querySelector('.pt-tour-finish'),'paid finalist sees prize after exit');
  }else{
   assert.ok(outDialog(),'normal elimination options restored after payout');
   await React.act(()=>[...outDialog().querySelectorAll('button')].find(b=>b.textContent==='Back to lobby').click());
   assert.equal(view(),'lobby');
  }
  await React.act(()=>root.render(null));
 }
 // A result notification for a different event must not eject an active game.
 const f=fixture();delete f.table.tournamentId;delete f.table.tournament;await start(f);
 finishEvent(f);await React.act(()=>f.emit('tournamentViews'));assert.ok(dialog());
 await React.act(()=>[...dialog().querySelectorAll('button')].find(b=>b.textContent==='Continue').click());assert.equal(view(),'poker-table');assert.ok(doc.querySelector('.poker-room'));
 console.log('PASS: real tournament finish returns to lobby, preserves trophy in either listener order, recovers previously dismissed finish, clears resume and leaves unrelated games intact');
 }finally{await React.act(()=>root.unmount());w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
