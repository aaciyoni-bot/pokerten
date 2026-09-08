"use strict";
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const Core = require('./aviatorCore');
const tFor = Core.timeForMult;
const K = Core.GROWTH_K;
const ids = (roundId='r1', requestId='fixture-request-1') => ({roundId, requestId});
function quote(cents, now, roundId='r1') { return Core.makeQuote('fixture', 'u1', roundId, cents, Math.floor(now)); }
const {setup} = require('./test/aviatorFixture');

test('hundredths and whole-chip payout remain exact across decimal boundaries', () => {
  for (let cents=100; cents<=500000; cents++) assert.equal(Core.toCents(cents/100), cents);
  assert.equal(Core.payout(101, 201), 203);
  assert.equal(Core.payout(1e12, 500000), 5e15);
  assert.throws(()=>Core.payout(1.5, 201));
});

test('signed quotes bind player, round, ceiling and lifetime', () => {
  const q=quote(240, 10000);
  assert(Core.validQuote(q,'fixture','u1','r1',201,10100));
  for(const changed of [{...q,maxCents:999},{...q,roundId:'r2'},{...q,issuedAt:10001},{...q,token:'x'}])
    assert(!Core.validQuote(changed,'fixture','u1','r1',201,10100));
  assert(!Core.validQuote(q,'fixture','u2','r1',201,10100));
  assert(!Core.validQuote(q,'fixture','u1','r1',241,10100));
  assert(!Core.validQuote(q,'fixture','u1','r1',201,12501));
});

test('manual cashout pays the displayed integer hundredth once', async () => {
  const time=Math.ceil(tFor(2.1)), s=setup({time});
  const payload={...ids(),seenCents:201,quote:quote(210,time)};
  const first=await s.call('avCashout',payload);
  assert.equal(first.mult,2.01); assert.equal(first.win,201);
  const balance=s.data.get('aviatorPlayers/u1').balance;
  const second=await s.call('avCashout',payload);
  assert.equal(second.mult,first.mult); assert.equal(second.win,first.win);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,balance);
  assert.equal([...s.data.keys()].filter(x=>x.startsWith('aviatorLedger/')).length,1);
});

test('a forged future price cannot credit chips', async () => {
  const time=Math.ceil(tFor(1.5)), s=setup({time});
  await assert.rejects(s.call('avCashout',{...ids(),seenCents:900,quote:quote(150,time)}),/המכפיל/);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,9900);
});

test('a request for the previous round never touches the current bet', async () => {
  const time=Math.ceil(tFor(2)), s=setup({time,roundId:'r2'});
  await assert.rejects(s.call('avCashout',{...ids('r1'),seenCents:150,quote:quote(200,time)}));
  assert.equal(s.data.get('aviatorBets/r2_u1').cashedAt,null);
});

test('crash boundary rejects identical late arrivals before and after settlement', async () => {
  const time=tFor(2.4), payload={...ids(),seenCents:235,quote:quote(235,time-50)};
  for (const settleFirst of [false,true]) {
    const s=setup({time,crash:2.4});
    if(settleFirst) await s.call('avTick');
    await assert.rejects(s.call('avCashout',payload),/התרסק/);
    assert.equal(s.data.get('aviatorPlayers/u1').balance,9900);
  }
});

test('timely request delayed behind settlement keeps its original arrival and payout', async () => {
  const arrival=tFor(2.4)-10, s=setup({time:arrival,crash:2.4});
  s.beforeNextTransaction(async () => { s.setNow(tFor(2.4)+100); await s.call('avTick'); });
  const r=await s.call('avCashout',{...ids(),seenCents:235,quote:quote(235,arrival-20)});
  assert.equal(r.mult,2.35); assert.equal(r.serverReceivedAt,arrival);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,10135);
  assert.equal(s.data.get('aviatorPlayers/u1').net,135);
  assert.equal(s.data.get('aviatorBets/r1_u1').lost,false);
  assert.equal(s.data.get('aviatorRounds/r1').totalPaid,235);
});

test('automatic exit uses stored target before or after settlement, including offline', async () => {
  for(const settleFirst of [false,true]) {
    const time=Math.ceil(tFor(3.2)), s=setup({time,crash:3,autoAt:2});
    if(settleFirst) await s.call('avTick');
    const r=await s.call('avCashout',{...ids(),seenCents:280,quote:quote(280,time-500)});
    assert.equal(r.mult,2); assert.equal(r.auto,true); assert.equal(r.win,200);
    assert.equal(s.data.get('aviatorPlayers/u1').balance,10100);
  }
});

test('automatic exit at exactly the crash value loses', async () => {
  const s=setup({time:Math.ceil(tFor(2.4))+100,crash:2.4,autoAt:2.4});
  await s.call('avTick');
  assert.equal(s.data.get('aviatorBets/r1_u1').lost,true);
  assert.equal(s.data.get('aviatorBets/r1_u1').cashedAt,null);
});

test('waiting deadlines are enforced even before a tick advances the round', async () => {
  const s=setup({phase:'waiting',time:7000});
  await assert.rejects(s.call('avCancelBet',ids()),/סגור/);
  await assert.rejects(s.call('avBet',{...ids(),amount:200}),/סגור/);
  assert.equal(s.data.get('aviatorBets/r1_u1').amount,100);
});

test('bet and cancel retries debit and refund only once', async () => {
  const s=setup({phase:'waiting',time:1000});
  const bet={...ids(),amount:200,autoAt:2.01};
  await s.call('avBet',bet);await s.call('avBet',bet);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,9800);
  assert.equal(s.data.get('aviatorBets/r1_u1').autoAt,2.01);
  const cancel=ids('r1','fixture-cancel-1');
  await s.call('avCancelBet',cancel);await s.call('avCancelBet',cancel);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,10000);
  await assert.rejects(s.call('avBet',{...cancel,amount:100}),/מזהה/);
});

test('instant crash has no speculative flying state; takeoff uses scheduled deadline', async () => {
  const instant=setup({phase:'waiting',time:7100,crash:1});
  const r=await instant.call('avTick');
  assert.equal(r.state.phase,'crashed'); assert.equal(r.state.crashPoint,1); assert.equal(r.state.startedAt,7000);
  assert.equal(r.quote,undefined);
  const flying=setup({phase:'waiting',time:8000,crash:10});
  const f=await flying.call('avTick');
  assert.equal(f.state.phase,'flying');assert.equal(f.state.phaseAt,7000);
  assert.equal(f.quote.maxCents,Core.centsAt(1000));
});

test('GOD MODE validates code, active bet, exact round, and watch-only lock', async () => {
  const s=setup({phase:'waiting',time:1000,crash:2.4});
  await assert.rejects(s.call('avPeek',{code:'incorrect',roundId:'r1'}),/קוד/);
  await assert.rejects(s.call('avPeek',{code:'audit-fixture-only',roundId:'r1'}),/הימור פעיל/);
  s.data.delete('aviatorBets/r1_u1');
  await assert.rejects(s.call('avPeek',{code:'audit-fixture-only',roundId:'r2'}),/הסיבוב השתנה/);
  const r=await s.call('avPeek',{code:'audit-fixture-only',roundId:'r1'});
  assert.equal(r.crashPoint,2.4);assert.equal(r.roundId,'r1');
  await assert.rejects(s.call('avBet',{...ids(),amount:100}),/מצב בקרה/);
});

test('manual arrival before auto target wins even when auto settlement obtains the lock first', async () => {
  const arrival=tFor(2)-20, s=setup({time:arrival,crash:2.4,autoAt:2});
  s.beforeNextTransaction(async()=>{s.setNow(tFor(2.4)+50);await s.call('avTick');});
  const payload={...ids(),seenCents:198,quote:quote(198,arrival-20)};
  const r=await s.call('avCashout',payload);
  assert.equal(r.auto,false);assert.equal(r.mult,1.98);assert.equal(r.win,198);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,10098);
  assert.equal(s.data.get('aviatorPlayers/u1').net,98);
  assert.equal(s.data.get('aviatorRounds/r1').totalPaid,198);
  await s.call('avCashout',payload);
  assert.equal(s.data.get('aviatorPlayers/u1').balance,10098);
});

test('a stored automatic target retains the existing server limit of 1000x', async () => {
  const s=setup({phase:'waiting',time:1000});
  const r=await s.call('avBet',{...ids(),amount:100,autoAt:1000});
  assert.equal(r.bet.autoAt,1000);
});

test('rollout bridge settles existing legacy bets exactly and rejects protocol-2 downgrade', async () => {
  const time=Math.ceil(tFor(2.1)), legacy=setup({time});
  const r=await legacy.call('avCashout',{seen:2.01});assert.equal(r.win,201);
  await legacy.call('avCashout',{seen:2.01});assert.equal(legacy.data.get('aviatorPlayers/u1').balance,10101);
  const modern=setup({time});modern.data.get('aviatorBets/r1_u1').protocol=2;
  await assert.rejects(modern.call('avCashout',{seen:2.01}),/לרענן/);
  assert.equal(modern.data.get('aviatorPlayers/u1').balance,9900);
});

test('rollout bridge refunds an existing legacy bet once, without allowing new legacy bets', async () => {
  const s=setup({phase:'waiting',time:1000});
  await s.call('avCancelBet',{});await s.call('avCancelBet',{});
  assert.equal(s.data.get('aviatorPlayers/u1').balance,10000);
  await assert.rejects(s.call('avBet',{amount:100}),/לרענן/);
  const r=await s.call('avBet',{...ids(),amount:100});assert.equal(r.bet.protocol,2);
});


test('in-flight price reads do not acquire transaction locks needed by cashout', async () => {
  const time=Math.ceil(tFor(2)), s=setup({time,crash:3});
  let transactionStarted=false;
  s.beforeNextTransaction(()=>{transactionStarted=true;});
  const r=await s.call('avTick');
  assert.equal(transactionStarted,false);
  assert.equal(r.quote.maxCents,Core.centsAt(time));
  assert(Core.validQuote(r.quote,'fixture','u1','r1',200,time));
});
