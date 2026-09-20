'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {createPlayerCopies,deckFour,visibleStack,createWorkerClient}=require('../assets/js/poker-runtime');
const players=()=>({a:{uid:'a',stack:100,bet:0,cards:[],status:'active',lastSeen:10},b:{uid:'b',stack:200,bet:10,cards:[],status:'active'}});
test('a stale action cannot overwrite top-ups, seat joins, or queued chips',()=>{const copies=createPlayerCopies(),original=players(),proposed=copies.clone(original);proposed.a.stack=80;proposed.a.bet=20;
 for(const update of [p=>p.a.stack=150,p=>p.a.pendingTopUp=50,p=>p.c={uid:'c',stack:300},p=>delete p.b]){const current=structuredClone(original);update(current);assert.throws(()=>copies.merge(current,proposed),/stale-players/);}
});
test('fresh heartbeat is preserved and chained game saves retain their baseline',()=>{const c=createPlayerCopies(),original=players(),proposed=c.clone(original);proposed.a.stack=80;proposed.a.bet=20;
 const latest=structuredClone(original);latest.a.lastSeen=900;const saved=c.merge(latest,proposed);assert.equal(saved.a.lastSeen,900);assert.equal(saved.a.stack,80);c.committed(proposed,saved);
 const next=c.clone(proposed);next.a.bet=0;const nextSaved=c.merge(saved,next);assert.equal(nextSaved.a.stack,80);assert.equal(nextSaved.a.lastSeen,900);
});
test('red/black is the default; explicit four-colour preference is retained',()=>{assert.equal(deckFour({getItem:()=>null}),false);assert.equal(deckFour({getItem:()=> '0'}),false);assert.equal(deckFour({getItem:()=> '1'}),true);assert.equal(deckFour({getItem(){throw Error();}}),false);});
test('missing balance is unknown while a genuine zero remains zero',()=>{assert.equal(visibleStack(undefined),null);assert.equal(visibleStack(null),null);assert.equal(visibleStack(NaN),null);assert.equal(visibleStack(0),0);assert.equal(visibleStack(1240.5),1240.5);});
test('worker failures release pending decisions instead of freezing the UI',async()=>{let instance;class Worker{constructor(){instance=this;}postMessage(data){this.data=data;}terminate(){this.closed=true;}}
 const client=createWorkerClient(Worker);const pending=client.request('mine',[]);instance.onerror();assert.equal(await pending,null);assert.equal(instance.closed,true);
 const next=client.request('mine',[]);instance.onmessage({data:{id:instance.data.id,value:73}});assert.equal(await next,73);client.close();assert.equal(await createWorkerClient(null).request('mine',[]),null);
});
test('roulette click times follow the visual easing and slow down to the result',()=>{const {spinTickTimes}=require('../assets/js/poker-runtime');const times=spinTickTimes(2355,12,6.5);assert.equal(times.length,78);assert.ok(times.every((t,i)=>t>0&&t<6.5&&(!i||t>times[i-1])));assert.ok(times.at(-1)-times.at(-2)>times[1]-times[0]);});

test('hand display sorting preserves deal indices for discard actions', () => {
  const { handDisplayOrder } = require('../assets/js/poker-runtime');
  const cards = [{val:'2',suit:'♠'},{val:'K',suit:'♦'},{val:'A',suit:'♥'},{val:'Q',suit:'♥'},{val:'A',suit:'♣'},{val:'10',suit:'♦'}];
  const before = JSON.stringify(cards);
  assert.deepEqual(handDisplayOrder(cards), [2,4,1,3,5,0]);
  assert.deepEqual(handDisplayOrder(cards,'suit'), [2,3,1,5,4,0]);
  assert.deepEqual(handDisplayOrder(cards,'dealt'), [0,1,2,3,4,5]);
  assert.equal(JSON.stringify(cards), before);
  assert.equal(cards[handDisplayOrder(cards)[0]].val, 'A');
});

test('tick loop starts immediately, never overlaps slow requests and stops without a late retry',async()=>{
 const {startTickLoop}=require('../assets/js/poker-runtime');
 const timers=new Map();let seq=0,calls=0,resolve,reject,errors=0;
 const schedule=(fn,ms)=>{assert.equal(ms,1000);timers.set(++seq,fn);return seq;};
 const request=()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no;});};
 const flush=async()=>{await Promise.resolve();await Promise.resolve();};
 const stop=startTickLoop(request,{setTimeout:schedule,clearTimeout:id=>timers.delete(id),onError:()=>errors++});
 assert.equal(calls,1);assert.equal(timers.size,0,'no timer queues another request while the first is pending');
 resolve();await flush();assert.equal(timers.size,1);const run=timers.values().next().value;timers.clear();run();assert.equal(calls,2);assert.equal(timers.size,0);
 reject(Error('temporary network error'));await flush();assert.equal(errors,1);assert.equal(timers.size,1);
 const retry=timers.values().next().value;timers.clear();retry();assert.equal(calls,3);stop();resolve();await flush();assert.equal(timers.size,0);assert.equal(calls,3);
});
