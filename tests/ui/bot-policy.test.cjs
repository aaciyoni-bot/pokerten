'use strict';
const assert = require('node:assert/strict');
const client = require('./load-client-bot.cjs')();
const server = require('../../functions/pokerEngine').__engineInternals;
const c = (val, suit) => ({ id: val + suit, val, suit });
const board = ['10', 'J', 'Q', 'K', 'A'].map(v => c(v, '♠'));
const hand = [c('2', '♥'), c('3', '♥')];
for (const opponents of [1, 2, 3]) {
  assert.equal(client.simMyEquity(hand, board, opponents, 'NLH', 1), Math.round(100 / (opponents + 1)));
  assert.ok(Math.abs(server.equityOf(hand, board, opponents, 'NLH', 1) - 1 / (opponents + 1)) < 1e-9);
}
// Omaha range sampling used to request >52 cards and silently return null.
const omaha = [c('A', '♥'), c('A', '♦'), c('K', '♥'), c('K', '♦'), c('7', '♣'), c('8', '♣')];
const flop = [c('Q', '♥'), c('J', '♥'), c('2', '♣')];
const clientEquity = client.simMyEquity(omaha, flop, 3, 'Omaha 6', 4);
const serverEquity = server.equityOf(omaha, flop, 3, 'Omaha 6', 4);
assert.ok(clientEquity !== null && clientEquity >= 0 && clientEquity <= 100);
assert.ok(serverEquity !== null && serverEquity >= 0 && serverEquity <= 1);
// Public-table policy must not consult another player's hidden cards.
let hiddenReads = 0;
const mine = { uid: 'bot', isBot: true, status: 'active', bet: 0, stack: 10, cards: hand };
const human = { uid: 'human', isBot: false, status: 'active', bet: 10, stack: 100 };
Object.defineProperty(human, 'cards', { get() { hiddenReads++; throw new Error('Hidden hand read'); } });
const game = { phase: 'river', highestBet: 10, minRaise: 1, handBB: 1, board, pots: [{ amount: 10 }] };
const table = { settings: { blinds: 0.5, botGodGuard: true }, players: { bot: mine, human } };
const priv = { bot: hand };
Object.defineProperty(priv, 'human', { get() { hiddenReads++; throw new Error('Hidden hand read'); } });
assert.ok(['call', 'fold', 'raise'].includes(client.botPokerMove(game, table, mine).type));
assert.ok(['call', 'fold', 'raise'].includes(server.botAction({ ...table, gameState: game, priv }, 'bot').action));
assert.equal(hiddenReads, 0);
console.log('PASS: actual client/server split-pot equity, six-card Omaha range capacity and human-table information boundary');

// Regressions from the reported Omaha 6 river. Keep the first policy draw
// reproducible, but use a seeded shuffle for the equity samples after it.
function withDecisionDraw(first, fn) {
  const original = Math.random;
  let initial = true, seed = 1729;
  Math.random = () => {
    if (initial) { initial = false; return first; }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try { return fn(); } finally { Math.random = original; }
}
const riverBoard = [c('3','♦'),c('A','♣'),c('4','♦'),c('2','♥'),c('8','♥')];
const danaCards = [c('K','♥'),c('J','♠'),c('10','♥'),c('9','♣'),c('6','♥'),c('3','♠')];
const dana = {uid:'dana',status:'active',stack:75.53,bet:0,cards:danaCards};
const riverGame = {phase:'river',highestBet:0,minRaise:1,handBB:1,currentGameType:'Omaha 6',board:riverBoard,pots:[{amount:106.5}]};
const riverTable = {settings:{blinds:.5},players:{dana,men:{uid:'men',status:'active',stack:95.65,bet:0},ben:{uid:'ben',status:'active',stack:123.04,bet:0}}};
for (const draw of [.01,.05,.1,.25,.75]) {
  const move = withDecisionDraw(draw,()=>client.botPokerMove(riverGame,riverTable,dana));
  assert.equal(move.type,'call','Dana must check the weak multiway river hand, rather than randomly bet 59');
}
const nuts = {...dana,cards:[c('A','♠'),c('K','♠')],stack:200};
const nutsGame = {...riverGame,currentGameType:'NLH',board:[c('Q','♠'),c('J','♠'),c('10','♠'),c('2','♦'),c('3','♣')],pots:[{amount:100}]};
const nutsTable = {...riverTable,players:{dana:nuts,men:riverTable.players.men}};
for (const draw of [.001,.01,.04,.5,.99]) {
  const move = withDecisionDraw(draw,()=>client.botPokerMove(nutsGame,nutsTable,nuts));
  assert.equal(move.type,'raise','Private river nuts must take value even on the former random-check draws');
  assert.ok(move.amt>=65 && move.amt<=100);
}
const allInTable = {...nutsTable,players:{dana:nuts,men:{...nutsTable.players.men,stack:0}}};
assert.equal(withDecisionDraw(.01,()=>client.botPokerMove(nutsGame,allInTable,nuts)).type,'call','Do not bet into only all-in opponents');
assert.equal(withDecisionDraw(.01,()=>client.botPokerMove({...nutsGame,board},nutsTable,nuts)).type,'call','A royal flush supplied entirely by the board is a split, not a value bet');
// Exercise the actual generated browser raise branch: public helpers must
// survive removal of the server-only demo guard during policy generation.
function serverMoveWithDraw(first,g,t,b){
  const crypto=require('node:crypto'),original=crypto.randomInt;
  let initial=true;
  crypto.randomInt=(min,max)=>{
    if(initial){initial=false;return min+Math.floor(first*(max-min));}
    return original(min,max);
  };
  try{
    const move=server.botAction({...t,gameState:g,priv:{[b.uid]:b.cards}},b.uid);
    return{type:move.action,...(move.amount==null?{}:{amt:move.amount})};
  }finally{crypto.randomInt=original;}
}
for(const {wager,pot} of [{wager:20,pot:100},{wager:1,pot:1000}]){
  const facing={...nutsGame,highestBet:wager,pots:[{amount:pot}]};
  for(const remaining of [100,0])for(const draw of [.01,.5,.99]){
    const tableWithBet={...nutsTable,players:{dana:nuts,men:{...nutsTable.players.men,bet:wager,stack:remaining}}};
    const move=withDecisionDraw(draw,()=>client.botPokerMove(facing,tableWithBet,nuts));
    assert.equal(move.type,remaining>0?'raise':'call','River nuts raise only when an opponent can pay more');
    assert.deepEqual({...move},serverMoveWithDraw(draw,facing,tableWithBet,nuts),'Generated browser and server must agree on value raises and all-in calls');
  }
}
const benCards=[c('A','♦'),c('10','♦'),c('7','♠'),c('5','♣'),c('4','♠'),c('2','♣')];
const menCards=[c('J','♥'),c('6','♠'),c('5','♦'),c('4','♣'),c('3','♣'),c('2','♦')];
assert.equal(client.bestScoreFull(benCards,riverBoard,'Omaha 6'),4050000,'Ben has a five-high straight, not air');
assert.equal(client.bestScoreFull(menCards,riverBoard,'Omaha 6'),4060000,'Men has the higher six-high straight');
console.log('PASS: screenshot river bluff, river nuts value, all-in-only check, board split, and Omaha straight ranks');

// A live opponent's new wager creates a side pot that the already all-in
// seats cannot win. Both real policies must value each eligible pot correctly.
const sideHero={uid:'sideHero',isBot:true,botStyle:'balanced',status:'active',seatIndex:0,stack:200,bet:0,cards:hand};
const sidePlayers={sideHero,live:{uid:'live',isBot:false,status:'active',seatIndex:1,stack:200,bet:60}};
for(let i=0;i<4;i++)sidePlayers['allin'+i]={uid:'allin'+i,isBot:false,status:'active',seatIndex:i+2,stack:0,bet:0};
const sideGame={phase:'river',currentGameType:'NLH',highestBet:60,minRaise:60,handBB:1,board,
  pots:[{amount:30,eligible:Object.keys(sidePlayers)},{amount:100,eligible:['sideHero','live']}]};
const sideTable={settings:{blinds:.5,baseGameType:'NLH'},players:sidePlayers};
for(const p of Object.values(sidePlayers).filter(p=>p.uid!=='sideHero'))Object.defineProperty(p,'cards',{get(){throw Error('Side-pot policy read opponent cards');}});
for(const draw of [.01,.5,.99]){
  const move=withDecisionDraw(draw,()=>client.botPokerMove(sideGame,sideTable,sideHero));
  assert.equal(move.type,'call','Guaranteed return is 30/6 + (100+60+60)/2 = 115 for a 60-chip call');
  assert.deepEqual({...move},serverMoveWithDraw(draw,sideGame,sideTable,sideHero));
}
const noSideValue={...sideGame,board:[c('A','♣'),c('K','♦'),c('J','♥'),c('9','♠'),c('4','♣')]};
const weakHero={...sideHero,cards:[c('7','♣'),c('2','♦')]};
const weakTable={...sideTable,players:{...sidePlayers,sideHero:weakHero}};
assert.equal(withDecisionDraw(.5,()=>client.botPokerMove(noSideValue,weakTable,weakHero)).type,'fold','Side-pot correction must not pay off river air');
assert.equal(serverMoveWithDraw(.5,noSideValue,weakTable,weakHero).type,'fold');
console.log('PASS: actual client/server side-pot call value and hidden-card boundary');

require('../../functions/test/botDecision.test.js');
require('../../functions/test/botRange.test.js');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
execFileSync(process.execPath,['scripts/sync-bot-policy.cjs','--check'],{cwd:path.join(__dirname,'../..')});
assert.equal(client.botPreflopTier([c('9','♠'),c('8','♠'),c('7','♥'),c('6','♥')]),2);
assert.equal(client.botPreflopTier([c('K','♠'),c('K','♥'),c('K','♦'),c('K','♣')]),0);
assert.equal(client.botRangeFacing(100,200,1),4);
const short={uid:'short',stack:10,bet:0};
assert.equal(client.botCallPrice({highestBet:1000,pots:[]},{short,opponent:{uid:'opponent',bet:1000}},short).odds,.5);
