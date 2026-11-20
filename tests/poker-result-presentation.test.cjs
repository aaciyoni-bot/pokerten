'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const {resultTimeline, createResultPresentation} = require('../assets/js/poker-runtime');
const {showdownDelay} = require('../functions/pokerTournamentCore');
const players = Object.fromEntries(Array.from({length:9}, (_, i) => ['p'+i, {seatIndex:i, status:'active', cards:[{val:'A',suit:'♠'}], stack:100}]));
const river = {phase:'river',handN:10};
const result = {phase:'showdown',handN:10,showdownAt:123456,lastAwards:[{uid:'p8',amount:45},{uid:'p2',amount:30}]};
test('all nine hands finish revealing before the winner and all shares arrive within the server window', () => {
  for (const earlyWin of [false,true]) for (const allInReveal of [false,true]) {
    const g = {...result,earlyWin,allInReveal,lastAwards:Object.keys(players).map(uid=>({uid,amount:1}))};
    const t = resultTimeline(g,players);
    for (const delay of Object.values(t.revealDelays)) assert.ok(delay+320 < t.winnerAt);
    for (const award of t.awards) {
      assert.ok(award.delay > t.winnerAt);
      assert.ok(award.delay+t.flightMs+2500+300 < showdownDelay(g),'readable hold and fade fit without delaying the next deal');
    }
    if (earlyWin || allInReveal) assert.deepEqual(t.revealDelays,{},'already exposed cards are not dealt again');
    assert.deepEqual(t,resultTimeline(g,Object.fromEntries(Object.entries(players).reverse())),'rotating seats cannot change result order');
  }
});
test('split/side-pot stacks update on each arrival; refunds and unknown balances stay separate', () => {
  let now=0;const c=createResultPresentation(()=>now), read=()=>c.read('a',result,players);
  c.read('a',river,players);let v=read();assert.equal(v.winnerReady,false);
  assert.equal(v.stack(145,'p8'),100);assert.equal(v.stack(130,'p2'),100);
  assert.equal(v.stack(150,'p0'),150,'uncalled refund is already available');
  assert.equal(v.stack(null,'p8'),null);assert.equal(v.stack(NaN,'p8'),null);
  now=v.winnerAt;v=read();assert.equal(v.winnerReady,true);assert.equal(v.stack(145,'p8'),100);
  now=v.awards[0].delay+v.flightMs;v=read();assert.equal(v.stack(145,'p8'),145);assert.equal(v.stack(130,'p2'),100);
  now=v.awards[1].delay+v.flightMs;v=read();assert.equal(v.stack(130,'p2'),130);assert.equal(v.nextIn,null);
  assert.equal(players.p8.stack,100,'presentation never mutates authoritative data');
});
test('duplicate awards aggregate by UID without adding refunds or nonpositive values', () => {
  const t=resultTimeline({...result,lastAwards:[{uid:'p8',amount:20},{uid:'p8',amount:25},{uid:'p2',amount:-1},{uid:'p2',amount:'bad'},{uid:'p2',amount:0}]},players);
  assert.equal(t.awards.length,1);assert.equal(t.awards[0].amount,45);
});
test('late snapshots start one full flight, presence updates do not restart it, and next-hand state wins immediately', () => {
  let now=10000;const c=createResultPresentation(()=>now);c.read('a',river,players);
  let v=c.read('a',result,players);assert.equal(v.elapsed,0);
  now+=1000;v=c.read('a',result,{...players,p0:{...players.p0,lastSeen:999}});assert.equal(v.elapsed,1000);
  now+=9000;v=c.read('a',result,players);assert.equal(v.stack(145,'p8'),145);assert.equal(v.nextIn,null);
  v=c.read('a',{phase:'preflop',handN:11},players);assert.equal(v.animated,false);assert.equal(v.stack(144,'p8'),144);
});
test('opening a finished hand, changing tables, backgrounding and missed whole hands do not replay payouts', () => {
  let now=0;const c=createResultPresentation(()=>now);
  assert.equal(c.read('a',result,players).animated,false);
  c.read('a',river,players);assert.equal(c.read('a',result,players).animated,true);
  assert.equal(c.read('b',result,players).animated,false);
  c.read('b',river,players);c.read('b',result,players);c.read('b',result,players,true);
  now=100;let v=c.read('b',result,players);assert.equal(v.animated,false);assert.equal(v.stack(145,'p8'),145);
  c.read('b',river,players);assert.equal(c.read('b',{...result,handN:12},players).animated,false);
});
