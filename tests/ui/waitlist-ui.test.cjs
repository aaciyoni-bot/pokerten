'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('function pokerWaitlistSummary(');
const end = html.indexOf('function LobbyView(', start);
assert.ok(start > 0 && end > start, 'Load the actual lobby/table waitlist UI');
const {pokerWaitlistSummary, PokerWaitlistIndicator} = new Function('React', html.slice(start, end) + ';return {pokerWaitlistSummary,PokerWaitlistIndicator};')(React);
const render = props => renderToStaticMarkup(React.createElement(PokerWaitlistIndicator, props));

assert.equal(render({table:{}, uid:'me'}), '', 'No invented waiters on an empty queue');
assert.match(render({table:{}, uid:'me', showEmpty:true}), /0 waiting/, 'A full table can truthfully show an empty queue');
assert.equal(pokerWaitlistSummary(null, 'me').count, 0);
assert.equal(pokerWaitlistSummary({waitlist:{}}, 'me').count, 0);

const table = {waitlist:[
  {uid:'bot_one', name:'Bot one', isBot:true, buyAmt:50},
  {uid:'other', name:'Other player', buyAmt:50},
  {uid:'bot_two', name:'Bot two', isBot:true, buyAmt:50},
  {uid:'me', name:'Me', buyAmt:100}
]};
const before = structuredClone(table);
const summary = pokerWaitlistSummary(table, 'me');
assert.equal(summary.count, 4);
assert.equal(summary.bots, 2);
assert.equal(summary.position, 2, 'Bot entries do not push back a player in the human-priority queue');
assert.equal(summary.firstPlayer.uid, 'other');
assert.equal(summary.firstPlayer.buyAmt, 50);
const markup = render({table, uid:'me'});
assert.match(markup, /4 waiting/);
assert.match(markup, /2 bots/);
assert.match(markup, /You: #2/);
assert.match(markup, /Players are seated before bots/);
assert.doesNotMatch(render({table, uid:'spectator'}), /You: #/);
assert.equal(pokerWaitlistSummary({waitlist:[table.waitlist[0]]}, 'me').firstPlayer, null);
assert.deepEqual(table, before, 'Rendering queue status must never reserve seats or change queue order');
assert.equal(pokerWaitlistSummary({players:{me:{uid:'me'}},waitlist:[{uid:'me'},{uid:'other'},{uid:'other'},null]},'me').count,1,'Seated/duplicate entries must not inflate queue counts');

const heartbeatStart=html.indexOf('  const queuedPlayer = pokerWaitlistSummary(');
const heartbeatEnd=html.indexOf('  useEffect(() => {if(!srvEngine)return;',heartbeatStart);
assert.ok(heartbeatStart>0&&heartbeatEnd>heartbeatStart,'Load the actual queue lease effect');
function heartbeatFixture(state){
  let callback=null,cleanup=null,delay=null,cleared=false;
  const calls=[];
  vm.runInNewContext(html.slice(heartbeatStart,heartbeatEnd),{
    pokerWaitlistSummary,tableState:state,user:{uid:'me'},srvEngine:true,buyAmt:50,tableDocId:'tableA',
    useEffect:fn=>{cleanup=fn();},setInterval:(fn,ms)=>{callback=fn;delay=ms;return 7;},clearInterval:id=>{assert.equal(id,7);cleared=true;},
    pokerCommand:async(name,data)=>{calls.push({name,data:JSON.parse(JSON.stringify(data))});}
  });
  return{tick:()=>callback?.(),stop:()=>cleanup?.(),calls,delay,hasTimer:!!callback,wasCleared:()=>cleared};
}
(async()=>{
  const live=heartbeatFixture(table);
  assert.equal(live.delay,60000);
  await live.tick();
  assert.deepEqual(live.calls,[{name:'pkSeat',data:{tableId:'tableA',op:'wait',amount:100}}],'A heartbeat refreshes interest with the saved buy-in, never purchases a seat');
  live.stop();await live.tick();
  assert.equal(live.wasCleared(),true);assert.equal(live.calls.length,1,'Leaving the table stops lease renewal');
  for(const state of [{waitlist:[]},{...table,players:{me:{uid:'me'}}},{...table,closeRequested:true}])assert.equal(heartbeatFixture(state).hasTimer,false,'Only an unseated queued player keeps a lease');
  console.log('PASS: actual waitlist display, human priority, read-only rendering, and queued-player heartbeat lifecycle');
})().catch(error=>{console.error(error);process.exitCode=1;});
