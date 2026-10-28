const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const helper=html.slice(html.indexOf('const pokerResultCue ='),html.indexOf('const SFX ='));
const start=html.indexOf('  const prevSnd = useRef('),end=html.indexOf('  if (loading || !tableState) return',start);
const effect=html.slice(start,end);
function table(uid){
  const played=[],ref={current:null},c={user:{uid},tableDocId:'table-1',headless:false,tableState:{chat:[]},players:{a:{uid:'a',name:'Same name'},b:{uid:'b',name:'Same name'},c:{uid:'c'}},setts:{blinds:1},gs:{phase:'river',board:[]},BETTING:['preflop','flop','turn','river'],navigator:{},playSnd:(...args)=>played.push(args),useRef:value=>{ref.current??=value;return ref;},useEffect:fn=>fn()};
  vm.createContext(c);vm.runInContext(helper,c);
  const run=()=>vm.runInContext('{'+effect+'}',c);run();
  return{c,played,run,result:awards=>{c.gs={phase:'showdown',board:[],lastAwards:awards};run();return played.at(-1)?.[0];}};
}
test('both split-pot winners hear applause and every other viewer hears the short result cue',()=>{
  const awards=[{uid:'a',amount:30},{uid:'b',amount:30}];
  for(const [uid,expected] of [['a','win'],['b','win'],['c','handend'],['spectator','handend']]){
    const f=table(uid);assert.equal(f.result(awards),expected);f.run();assert.equal(f.played.length,1,'repeated snapshots do not replay the result');
  }
});
test('side-pot and multiple-board awards use each recipient’s own payout, including duplicate entries',()=>{
  const awards=[{uid:'a',amount:70},{uid:'a',amount:20},{uid:'b',amount:10},{uid:'c',amount:15}];
  assert.equal(table('a').result(awards),'bigwin');assert.equal(table('b').result(awards),'win');assert.equal(table('c').result(awards),'win');
});
test('names, refunds and zero or invalid awards never count as a win',()=>{
  const f=table('b');f.c.gs.lastWinners='Same name';
  assert.equal(f.result([{uid:'a',name:'Same name',amount:200},{uid:'b',amount:0},{uid:'b',amount:-5},{uid:'b',amount:'invalid'}]),'handend');
  const refund=table('c');refund.c.players.c.refund=200;assert.equal(refund.result([{uid:'a',amount:30}]),'handend');
  assert.equal(table('a').result(undefined),'handend');assert.equal(table(null).result([{uid:null,amount:20}]),'handend');
});
test('opening a completed table and returning from a headless table never replay an old result',()=>{
  const f=table('a');f.c.tableDocId='table-2';assert.equal(f.result([{uid:'a',amount:30}]),undefined);
  f.c.gs.phase='river';f.run();f.c.headless=true;f.result([{uid:'a',amount:30}]);assert.equal(f.played.length,0);
  f.c.headless=false;f.run();assert.equal(f.played.length,0);
  f.c.gs.phase='river';f.run();assert.equal(f.result([{uid:'a',amount:30}]),'win');assert.equal(f.played.length,1);
});
