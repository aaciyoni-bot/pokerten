'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {actionUpdate, confirmation} = require('../pokerPlayerView');

test('live and historical action receipts contain only display data, also inside arrays', () => {
  const card = {id:'As', val:'A', suit:'s', privateMarker:'private'};
  const update = {
    settings:{privateMarker:true}, history:[{privateMarker:true}], leftStacks:{privateMarker:true},
    gameState:{phase:'flop', __seq:33, board:[card], handN:4, pots:[{amount:1, eligible:['a'], privateMarker:true}],
      privateMarker:true, deck:[card], handStartWealth:{a:100},ritOffer:{until:150,privateMarker:true}},
    players:{a:{uid:'a',stack:80,bet:1,cards:[card],status:'active',fundingUid:'private',botStyle:'private',manualControl:{privateMarker:true}}}
  };
  const view=actionUpdate(update);
  assert.equal(view.gameState.__seq,33);
  assert.deepEqual(view.gameState.board,[{id:'As',val:'A',suit:'s'}]);
  assert.deepEqual(view.players.a.cards,[]);
  assert.equal(view.players.a.stack,80);assert.equal(view.players.a.bet,1);
  assert.doesNotMatch(JSON.stringify(view),/private|fundingUid|manualControl|botStyle|handStartWealth|leftStacks|history/);
  const result=confirmation({ok:true,tableId:'test',tableUpdate:update,privateMarker:true});
  assert.deepEqual(result,{ok:true,tableId:'test',tableUpdate:view});
  assert.deepEqual(confirmation(result),result);
});
test('a showdown reveals only legitimately shown hands, including an explicit reveal after a fold',()=>{
 const c={val:'K',suit:'c'},p={uid:'a',cards:[c],status:'active'};
 const view=(game,seat={})=>actionUpdate({gameState:game,players:{a:{...p,...seat}}}).players.a.cards;
 assert.deepEqual(view({phase:'turn',allInReveal:true}),[c]);
 assert.deepEqual(view({phase:'turn',allInReveal:true},{status:'folded'}),[]);
 assert.deepEqual(view({phase:'showdown',earlyWin:true}),[]);
 assert.deepEqual(view({phase:'showdown'},{mucked:true}),[]);
 assert.deepEqual(view({phase:'showdown'},{status:'folded',reveal:true}),[c]);
});

test('idle and nonparticipating seats remain private, including after a completed all-in hand',()=>{
  const {visibleCards}=require('../pokerPlayerView');
  const cards=[{val:'Q',suit:'h'}];
  const active={cards,status:'active',cardCount:2};
  for(const phase of ['waiting','dc_selection',undefined]){
    assert.deepEqual(visibleCards({...active,reveal:true},{phase,allInReveal:true}),[]);
  }
  for(const status of ['sitout','out','waiting',undefined]){
    assert.deepEqual(visibleCards({...active,status,reveal:true},{phase:'showdown'}),[]);
  }
  assert.deepEqual(visibleCards({...active,cardCount:0},{phase:'showdown'}),[]);
  assert.deepEqual(visibleCards({...active,left:true},{phase:'river',allInReveal:true}),[]);
  assert.deepEqual(visibleCards({...active,status:'busted'},{phase:'showdown'}),cards);
});

test('rabbit runouts use burn order, never consume deck cards, and appear only after a fold ends the hand',()=>{
  const {remainingRabbitCards}=require('../pokerEngine').__engineInternals;
  const {rabbitCards}=require('../pokerPlayerView');
  const deck=Array.from({length:8},(_,i)=>({val:String(i+2),suit:'c'})),original=structuredClone(deck);
  for(const [boardSize,expected] of [[0,[6,5,4,2,0]],[3,[6,4]],[4,[6]]]){
    const board=Array.from({length:boardSize},()=>({val:'J',suit:'s'}));
    const runout=remainingRabbitCards(board,deck);
    assert.deepEqual(runout,expected.map(i=>deck[i]));
    assert.deepEqual(rabbitCards({phase:'showdown',earlyWin:true,board,rabbit:runout}),runout);
    assert.equal(rabbitCards({phase:'turn',earlyWin:true,board,rabbit:runout}),null);
    assert.equal(rabbitCards({phase:'showdown',earlyWin:false,board,rabbit:runout}),null);
    assert.equal(rabbitCards({phase:'showdown',earlyWin:true,board,rabbit:runout.slice(1)}),null);
  }
  assert.equal(remainingRabbitCards([],deck.slice(1)),null);
  assert.equal(remainingRabbitCards(new Array(5),deck),null);
  assert.deepEqual(deck,original);
});

test('a fold completes settlement once and keeps unshown cards out of the written hand history',()=>{
  const {finishEarlyWin}=require('../pokerEngine').__engineInternals;
  const card={val:'A',suit:'h'};
  const state={id:'table',settings:{blinds:1},raw:{},priv:{},effects:[],now:1000,
    table:{clubId:'test',history:[]},gameState:{phase:'turn',board:[card,card,card,card],pots:[],handN:1},
    players:{a:{uid:'a',name:'A',stack:90,bet:10,status:'active',cards:[],cardCount:2},
             b:{uid:'b',name:'B',stack:90,bet:10,status:'folded',cards:[card],cardCount:2}},
    deck:[{val:'K',suit:'c'},{val:'J',suit:'d'}]};
  finishEarlyWin(state,'a');
  assert.equal(state.gameState.lastWinAmount,20);
  assert.equal(state.players.a.stack+state.players.b.stack,200);
  assert.equal(state.table.history.length,1);
  assert.ok(state.table.history[0].ps.every(player=>player.c===null));
  assert.deepEqual(state.gameState.rabbit,[{val:'K',suit:'c'}]);
});

test('additional seats show only the signed-in hand and the active decision deadline',async()=>{
  const {readSeatPreview}=require('../pokerSeatPreview');
  const hand=['♠','♥','♦','♣','♠','♥','♦'].map((suit,i)=>({suit,val:String(i+2),id:'private marker'}));
  const me={uid:'player',status:'active',cardCount:7,stack:99,bet:5};
  const game={handN:4,phase:'flop',activeTurnUid:'player',turnStartedAt:18000,currentGameType:'Omaha 7',
    highestBet:10,minRaise:10,board:hand.slice(0,3),pots:[{amount:12}]};
  const table={authorityVersion:2,type:'poker',settings:{serverEngine:true,actionTime:30},clubId:'club',
    gameState:game,players:{player:me,other:{bet:10}}};
  const member={status:'approved'},reads=[];
  const docs={'memberships/player_club':member,'tables/table':table,'tables/table/priv/player':{cards:hand}};
  const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
  const read=r=>{reads.push(r.path);return {exists:!!docs[r.path],data:()=>docs[r.path]};};
  const db={doc:ref,runTransaction:(fn,options)=>{assert.deepEqual(options,{readOnly:true});return fn({get:read,getAll:(...refs)=>refs.map(read)});}};
  const req={auth:{uid:'player'},data:{previewClubId:'club',uid:'other',targetUid:'other'}};
  const preview=()=>readSeatPreview(db,req,'table');
  for(const event of [null,'event']){
    table.tournamentId=event;
    const p=await preview();
    assert.deepEqual(p.cards,hand.map(({suit,val})=>({suit,val})));
    assert.equal(p.deadline,48000);assert.equal(p.bettingTurn,true);assert.equal(p.maxTo,42);
    assert.doesNotMatch(JSON.stringify(p),/private marker|other|player|_engine/);
    Object.assign(me,{timeBankTurn:18000,timeBankHand:4});
    assert.equal((await preview()).deadline,63000);
    me.timeBankTurn=null;
  }
  game.activeTurnUid='other';assert.equal((await preview()).deadline,null);
  game.phase='discard';me.cardCount=3;
  let p=await preview();assert.equal(p.deadline,43000);assert.equal(p.bettingTurn,false);
  reads.length=0;game.phase='waiting';assert.deepEqual((await preview()).cards,[]);
  assert.equal(reads.some(r=>r.includes('/priv/')),false);
  for(const change of [()=>{member.status='banned';},()=>{member.status='approved';me.left=true;},
    ()=>{me.left=false;me.status='out';},()=>{me.status='active';table.clubId='different';},
    ()=>{table.clubId='club';delete table.players.player;}]){change();assert.equal(await preview(),null);}
  assert.equal(reads.some(r=>r.includes('/priv/')),false);
  await assert.rejects(()=>readSeatPreview(db,{data:req.data},'table'),{code:'unauthenticated'});
});
