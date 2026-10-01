'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');
const card=(val,suit='♠')=>({val,suit,id:val+suit});
const oldHands={me:[card('A'),card('K')],other:[card('Q'),card('J')]},newHands={me:[card('8'),card('7')],other:[card('6'),card('5')]};
let current={settings:{serverEngine:true,maxPlayers:6,baseGameType:'NLH',actionTime:30,blinds:1},gameState:{__seq:1,handN:1,phase:'preflop',activeTurnUid:'other',turnStartedAt:Date.now(),highestBet:2,minRaise:2,board:[],pots:[],currentGameType:'NLH'},players:{me:{uid:'me',name:'Me',stack:100,bet:0,cards:[],cardCount:2,status:'active',seatIndex:0},other:{uid:'other',name:'Other',stack:200,bet:2,cards:[],cardCount:2,status:'active',seatIndex:1}}};
let tableNext,privateNext,tokenNext,pending=[],calls=[],tableId='test-table';
const ref=(...args)=>({id:args.at(-1),path:args.slice(1).join('/')});
const snap=()=>({id:tableId,exists:()=>true,data:()=>structuredClone(current),metadata:{fromCache:false}});
w.fb={db:{},auth:{currentUser:{uid:'me',email:'haim29071994@gmail.com',emailVerified:true}},doc:ref,collection:ref,query:r=>r,where:()=>({}),
 onIdTokenChanged:(_,cb)=>{tokenNext=cb;return()=>{tokenNext=null;};},
 fx:(name,args)=>{calls.push({name,args});if(name==='godPeek')return new Promise((resolve,reject)=>pending.push({args,resolve,reject}));return Promise.resolve({});},
 getDoc:async()=>({exists:()=>false}),getDocs:async()=>({docs:[]}),updateDoc:async()=>{},setDoc:async()=>{},addDoc:async()=>({id:'x'}),deleteDoc:async()=>{},
 onSnapshot:(r,opts,next)=>{const cb=typeof opts==='function'?opts:next;if(r.path==='tables/'+tableId){tableNext=cb;queueMicrotask(()=>cb(snap()));}
 else if(r.path==='tables/'+tableId+'/priv/me'){privateNext=cb;queueMicrotask(()=>cb({exists:()=>true,data:()=>({cards:oldHands.me})}));}
 else queueMicrotask(()=>cb({exists:()=>false,docs:[]}));return()=>{};}};
const html=fs.readFileSync(process.env.POKER_TEST_INDEX||path.join(__dirname,'../../index.html'),'utf8');
const source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function PokerTable('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.TableTest=PokerTable;');w.eval(source);w.__pkMuted=true;
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const props=()=>({tableDocId:tableId,user:{uid:'me',role:'player',balance:500},clubSettings:{name:'Club'},onLeave(){},showToast(){}});
const render=()=>React.act(async()=>root.render(React.createElement(w.TableTest,props())));
const update=()=>React.act(async()=>{current.gameState.__seq++;tableNext(snap());});
const reply=(request,hands=oldHands,overrides={})=>React.act(async()=>request.resolve({tableId:request.args.tableId,contextKey:request.args.contextKey,hands,finalBoard:[],...overrides}));
const faces=()=>doc.querySelectorAll('.poker-seat:not(.poker-seat-hero) .card-face');
const ranks=()=>[...doc.querySelectorAll('.poker-seat:not(.poker-seat-hero) .poker-card-index>span:first-child')].map(c=>c.textContent).sort();
const toggle=async()=>{await React.act(()=>doc.querySelector('[title="Table menu"]').click());await React.act(()=>doc.querySelector('[title="GOD view"]').click());};
(async()=>{try{
 await render();assert.equal(pending.length,0,'GOD identity alone does not request a peek');
 await toggle();const first=pending.shift();assert.ok(first);await reply(first);assert.deepEqual(ranks(),['J','Q']);
 // A direct preflop -> preflop jump used to reuse the old faces because the
 // effect key contained only phase and board length, not the hand number.
 current.gameState.handN=2;await update();
 assert.equal(faces().length,0,'new hand must never flash previous hand faces');
 assert.equal(doc.querySelectorAll('.poker-seat-hero .card-face').length,0,'GOD hero cannot use stale independent private stream');
 const second=pending.shift();assert.ok(second,'same-phase next hand refreshes the peek');
 current.gameState.handN=3;await update();const third=pending.shift();
 await reply(third,newHands);assert.deepEqual(ranks(),['5','6']);
 await reply(second,oldHands);assert.deepEqual(ranks(),['5','6'],'out-of-order earlier hand cannot replace current cards');
 // Bomb-pot deals advance handCount even when the older handN stays put.
 current.handCount=(current.handCount||0)+1;await update();
 assert.equal(faces().length,0,'bomb-pot handCount invalidates otherwise identical prior-hand context');
 const bombHand=pending.shift();assert.ok(bombHand);await reply(bombHand,newHands);assert.deepEqual(ranks(),['5','6']);
 // Unrelated bets/presence do not blank known cards or refetch secrets.
 const peeks=calls.filter(c=>c.name==='godPeek').length;current.players.other.bet=4;current.players.other.lastSeen=Date.now();await update();
 assert.deepEqual(ranks(),['5','6']);assert.equal(calls.filter(c=>c.name==='godPeek').length,peeks);
 current.gameState.phase='discard';current.gameState.currentGameType='Pineapple';current.players.other.cardCount=3;await update();
 const beforeDiscard=pending.shift();await reply(beforeDiscard,{...newHands,other:[...newHands.other,card('4')]});assert.equal(faces().length,3);
 current.players.other.cardCount=2;await update();assert.equal(faces().length,0,'same-phase discard invalidates three-card snapshot');
 const afterDiscard=pending.shift();await reply(afterDiscard,newHands);assert.equal(faces().length,2);
 current.gameState.handN++;await update();const offPending=pending.shift();await toggle();await reply(offPending,newHands);
 assert.equal(faces().length,0,'GOD off cannot be repopulated by a late response');
 await toggle();const beforeRevocation=pending.shift();
 w.fb.auth.currentUser.emailVerified=false;
 await React.act(async()=>{assert.ok(tokenNext);tokenNext(w.fb.auth.currentUser);});
 await reply(beforeRevocation,newHands);assert.equal(faces().length,0,'same-UID auth revocation rejects late secrets');
 assert.equal(doc.querySelector('.poker-god-runout'),null);
 // Forged profile role/email never bypasses the signed-in identity guard.
 w.fb.auth.currentUser={uid:'me',email:'ordinary@example.invalid',emailVerified:true};
 const count=calls.filter(c=>c.name==='godPeek').length;
 await React.act(async()=>root.render(React.createElement(w.TableTest,{...props(),user:{uid:'me',role:'super_admin',email:'haim29071994@gmail.com',godMode:true}})));
 await React.act(()=>doc.querySelector('[title="Table menu"]').click());assert.equal(doc.querySelector('[title="GOD view"]'),null);
 assert.equal(calls.filter(c=>c.name==='godPeek').length,count);
 await React.act(()=>doc.querySelector('[aria-label="Close table menu"]').click());
 // A table change with a pending response must not reuse its old context.
 w.fb.auth.currentUser={uid:'me',email:'haim29071994@gmail.com',emailVerified:true};await render();await toggle();const oldTable=pending.shift();
 tableId='other-table';await render();const newTable=pending.shift();assert.equal(faces().length,0);
 await reply(oldTable,oldHands);assert.equal(faces().length,0,'old-table response ignored');
 await reply(newTable,newHands);assert.deepEqual(ranks(),['5','6']);
 // Server denial closes GOD view; it never falls back to cached cards.
 current.gameState.handN++;await update();const denied=pending.shift();
 await React.act(async()=>denied.reject({code:'functions/permission-denied'}));assert.equal(faces().length,0);
 console.log('PASS: GOD hand/table/discard consistency, atomic hero source, out-of-order cancellation, toggles, token revocation and ordinary-user denial');
 }finally{await React.act(()=>root.unmount());w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
