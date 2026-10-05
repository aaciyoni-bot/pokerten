'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Core=require('./aviatorCore');
const streamFactory=require('./aviatorStream');
const {setup}=require('./test/aviatorFixture');

function room(crash=2.4,phase='waiting') {
  return {state:{roundId:'r1',phase,phaseAt:0,waitMs:7000,crashHold:3200},
    engine:{roundId:'r1',seed:'fixture',crashPoint:crash}};
}
test('server stream reveals neither future stop nor seed; instant crash skips flight',()=>{
  for (const crash of [1,1.01,2.4,5000]) {
    const {state,engine}=room(crash);
    const end=7000+Core.timeForMult(crash);
    for (const time of [0,6999,7000,end-1,end,end+1]) {
      const p=Core.flightPacket(state,engine,'u1',time);
      if (time<end) {
        assert.equal(p.state.seed,undefined);assert.equal(p.state.crashPoint,undefined);
        if(p.quote) assert(p.quote.maxCents<Core.toCents(crash));
      } else {
        assert.equal(p.state.phase,'crashed');assert.equal(p.state.phaseAt,end);
        assert.equal(p.state.crashPoint,crash);assert.equal(p.quote,undefined);
      }
    }
  }
  assert.equal(Core.flightPacket({roundId:'r2'},room().engine,'u1',1),null);
});
test('a streamed takeoff price cashes out before the phase transaction commits',async()=>{
  const f=setup({time:7100,phase:'waiting',phaseAt:0,crash:2.4});
  const p=Core.flightPacket(f.data.get('aviator/state'),f.data.get('aviator/_engine'),'u1',7050);
  assert.equal(p.state.phase,'flying');
  const r=await f.call('avCashout',{roundId:'r1',requestId:'streamed-takeoff',seenCents:p.quote.maxCents,quote:p.quote});
  assert.equal(r.mult,p.quote.maxCents/100);
});
test('stream sends 20 prices/sec and stops on time while settlement remains blocked',async()=>{
  let time=7000,reads=0,advanced=0,settle;
  const source=room(1.2), packets=[];
  const release=new Promise(r=>{settle=r;});
  const stream=streamFactory({now:()=>time,duration:2200,
    verifyIdToken:async()=>({uid:'u1'}),
    db:{doc:path=>({path}),getAll:async()=>{reads++;return [source.state,source.engine].map(v=>({exists:true,data:()=>v}));}},
    advance:async()=>{advanced++;await release;},
    pause:async ms=>{time+=ms;if(time>=9000)settle();}
  });
  const response={on(){},setHeader(){},flushHeaders(){},write:s=>{packets.push({at:time,...JSON.parse(s)});return true;},end(){}};
  await stream({method:'GET',headers:{authorization:'Bearer fixture'}},response);
  const crash=packets.find(p=>p.state?.phase==='crashed');
  const expected=7000+Core.timeForMult(1.2);
  assert(crash.at-expected>=0 && crash.at-expected<=1);
  assert(crash.at<9000,'announcement must precede settlement');
  const prices=packets.filter(p=>p.quote);
  assert(prices.length>=27);
  for(let i=1;i<prices.length;i++)assert.equal(prices[i].at-prices[i-1].at,50);
  assert(reads<5,'there must not be a Firestore read for every frame');
  assert(advanced>=1);
});
test('stream requires a valid Firebase identity and closes on backpressure',async()=>{
  const source=room(),events=[];
  const db={doc:path=>({path}),getAll:async()=>[source.state,source.engine].map(v=>({exists:true,data:()=>v}))};
  const res={status:c=>{events.push(c);return res;},end:()=>events.push('end'),on(){},setHeader(){},flushHeaders(){},write:()=>false};
  const handler=streamFactory({db,verifyIdToken:async()=>({uid:'u1'}),advance:async()=>{},now:()=>1});
  await handler({method:'GET',headers:{}},res);assert.deepEqual(events,[401,'end']);
  events.length=0;await handler({method:'GET',headers:{authorization:'Bearer fixture'}},res);
  assert.deepEqual(events,['end']);
});
test('owner top-up is protected and the same retry adds chips only once',async()=>{
  const f=setup(),p={uid:'u1',amount:10000,requestId:'credit-retry-1'};
  await assert.rejects(f.call('avCredit',p),/מנהל בלבד/);
  p.code='audit-fixture-only';
  const first=await f.call('avCredit',p),retry=await f.call('avCredit',p);
  assert.equal(first.balance,19900);assert.deepEqual(retry,first);
  assert.equal(f.data.get('aviatorPlayers/u1').balance,19900);
});
