'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../pokerCore');
const E = require('../pokerEngine').__engineInternals;
const cards = ids => ids.map(id => ({id, val:id.slice(0,-1), suit:id.slice(-1)}));
function seeded(run) {
  const oldRandom = crypto.randomInt, oldDeck = C.pokerDeck;
  let state = 98765;
  crypto.randomInt = (min,max) => {
    const value = (state = (Math.imul(state,1664525) + 1013904223) >>> 0) / 4294967296;
    return min + Math.floor(value * (max-min));
  };
  C.pokerDeck = () => C.SUITS.flatMap(suit => C.CARD_VALUES.map(val => ({id:val+suit,val,suit})));
  try { return run(); } finally { crypto.randomInt = oldRandom; C.pokerDeck = oldDeck; }
}
test('Omaha recognizes connected double-suited hands, premium aces and duplicate rank blockers', () => {
  assert.equal(E.preflopTier(cards(['9♠','8♠','7♥','6♥'])), 2);
  assert.equal(E.preflopTier(cards(['K♠','K♥','K♦','K♣'])), 0);
  assert.equal(E.preflopTier(cards(['A♠','A♥','K♠','K♥'])), 3);
  assert.equal(E.preflopTier(cards(['A♠','A♥','K♠','K♥','Q♦','J♦'])), 3);
  assert.equal(E.preflopTier(cards(['A♠','2♥','7♦','9♣'])), 0);
});
test('preflop classification is deterministic and Pineapple scores the best keepable pair', () => {
  const old = crypto.randomInt;
  crypto.randomInt = () => assert.fail('Hand quality must not depend on a coin flip');
  try {
    for (let i=0;i<20;i++) assert.equal(E.preflopTier(cards(['9♠','8♠','7♥','6♥'])),2);
    assert.equal(E.preflopTier(cards(['A♠','K♠','2♦'])),3);
    assert.equal(E.preflopTier(cards(['7♠','2♥','3♦'])),0);
  } finally { crypto.randomInt = old; }
});
test('Pineapple bots retain made hands or real draws instead of discarding randomly',()=>{
  const hand=cards(['A♠','K♠','2♦']);
  assert.equal(E.botDiscardIndex(hand,cards(['Q♠','J♠','3♥'])),2,'Keep the nut-flush and straight draw');
  assert.equal(E.botDiscardIndex(cards(['A♠','A♥','2♦']),cards(['A♦','8♣','3♥'])),2,'Keep the set of aces');
  assert.equal(E.botDiscardIndex(hand,cards(['Q♠','J♠','3♥','2♣','2♥'])),2,'Later streets cannot influence the flop discard');
});
test('Pineapple simulations use exactly two kept hole cards at showdown',()=>seeded(()=>{
  const original=C.bestScoreFull;
  let showdowns=0;
  C.bestScoreFull=(hole,board,game)=>{
    if(game==='Pineapple'&&board.length===5){showdowns++;assert.equal(hole.length,2);}
    return original(hole,board,game);
  };
  try{const equity=E.equityOf(cards(['A♠','K♠','2♦']),[],1,'Pineapple',2);assert.ok(equity>=0&&equity<=1);assert.ok(showdowns>0);}
  finally{C.bestScoreFull=original;}
}));
test('range pressure prices a pot-sized wager against the pot before the wager', () => {
  assert.equal(E.rangeFacing(100,200,1),4);
  assert.equal(E.rangeFacing(60,160,1),3);
  assert.equal(E.rangeFacing(30,130,1),2);
  assert.equal(E.rangeFacing(10,110,1),1);
  assert.equal(E.rangeFacing(0,100,1),1);
});
test('range conditioning includes live flush/straight draws on the current street', () => {
  const board = cards(['K♠','9♠','2♥']);
  const live = E.rangeHandStrength(cards(['A♠','Q♠']),board,'NLH');
  const dry = E.rangeHandStrength(cards(['A♥','Q♦']),board,'NLH');
  assert.ok(live > dry + 500000);
});
test('opponent alternatives are chosen before future board cards are sampled', () => seeded(() => {
  const original = C.bestScoreFull, sequence = [];
  // All hands tie so every iteration visits every opponent. The call order
  // directly detects the old bug: selecting candidate strength on the river.
  C.bestScoreFull = (hole,board) => { sequence.push(board.length); return 0; };
  try {
    const equity = E.equityOf(cards(['A♠','K♠']),cards(['Q♦','8♣','2♥']),2,'NLH',2);
    assert.ok(Math.abs(equity-1/3)<1e-12);
    assert.equal(sequence.length,200*7);
    for (let i=0;i<sequence.length;i+=7) assert.deepEqual(sequence.slice(i,i+7),[3,3,3,3,5,5,5]);
  } finally { C.bestScoreFull = original; }
}));
test('six-card multiway ranges keep all alternatives without consuming hypothetical dead cards', () => seeded(() => {
  const original = C.bestScoreFull;
  const hero = cards(['A♠','K♠','Q♥','J♥','6♦','3♦']), board = cards(['2♠','8♠','K♦']);
  const known = new Set([...hero,...board].map(c=>c.id));
  let candidates=0, currentOpponents=[];
  C.bestScoreFull = (hole,publicBoard) => {
    if(publicBoard.length===3){
      candidates++;
      assert.equal(hole.length,6);
      assert.equal(new Set(hole.map(c=>c.id)).size,6);
      assert.ok(hole.every(c=>!known.has(c.id)));
    } else if(hole[0].id===hero[0].id && hole.every((c,i)=>c.id===hero[i].id)) {
      currentOpponents=[];
      assert.equal(new Set([...hero,...publicBoard].map(c=>c.id)).size,11);
    } else {
      currentOpponents.push(...hole);
      const all=[...hero,...publicBoard,...currentOpponents];
      assert.equal(new Set(all.map(c=>c.id)).size,all.length,'Selected hands and runout must form one possible deck');
    }
    return 0;
  };
  try {
    const equity=E.equityOf(hero,board,5,'Omaha 6',4);
    assert.ok(Math.abs(equity-1/6)<1e-12);
    assert.equal(candidates,90*5*4,'Full-table PLO6 must not silently discard range strength');
  } finally { C.bestScoreFull=original; }
}));

test('river equity reuses exact hero and selected range scores without extra evaluations',()=>seeded(()=>{
 const original=C.bestScoreFull;
 const hero=cards(['A♠','K♠','Q♥','J♥','6♦','3♦']),board=cards(['2♠','8♠','K♦','7♣','9♥']);
 let heroScores=0,opponentScores=0;
 C.bestScoreFull=(hole,publicBoard)=>{
  assert.deepEqual(publicBoard,board);
  if(hole.every((c,i)=>c.id===hero[i].id))heroScores++;
  else opponentScores++;
  return 0;
 };
 try{
  assert.ok(Math.abs(E.equityOf(hero,board,5,'Omaha 6',4)-1/6)<1e-12);
  assert.equal(heroScores,1,'The known river hand needs one evaluation');
  assert.equal(opponentScores,90*5*4,'Chosen river scores are reused from range selection');
 }finally{C.bestScoreFull=original;}
}));
