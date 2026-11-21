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
