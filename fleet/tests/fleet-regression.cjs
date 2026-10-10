// Run from the handoff root: node tests/fleet-regression.cjs
// Exercise the actual inline application functions with synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const fleetSource = fs.readFileSync((fs.existsSync(path.join(root,'index.html')) ? path.join(root,'index.html') : path.join(root,'fleet/index.html')), 'utf8');

function extract(source, name, indent = '') {
  const start = new RegExp('^' + indent + 'function ' + name + '\\(', 'm').exec(source);
  assert.ok(start, name + ' exists');
  const lineEnd = source.indexOf('\n', start.index);
  const firstLine = source.slice(start.index, lineEnd);
  if (firstLine.trimEnd().endsWith('}')) return firstLine;
  const next = new RegExp('^' + indent + 'function \\w+\\(', 'm').exec(source.slice(lineEnd));
  assert.ok(next, name + ' has a following function');
  return source.slice(start.index, lineEnd + next.index);
}

function fleetContext() {
  const context = vm.createContext({
    STAT: {'כשיר':'ok','במשימה':'mission','תקול':'bad','בטיפול':'service','מושבת':'bad'},
    FRBY: {a:{name:'מסגרת אלפא'},b:{name:'מסגרת בטא'}},
    esc: value => String(value ?? ''),
    fleetFilter: 'all', fleetStatus: 'all', fleetSearch: '',
    needsAttention: v => !v.drivers?.length || ['תקול','מושבת'].includes(v.status)
  });
  vm.runInContext(['fleetMatches','readiness','readinessCard'].map(n => extract(fleetSource,n)).join('\n'), context);
  const vehicles = [
    {id:1,number:'12-345-67',type:'רכב מנהלה',unit:'a',status:'כשיר',drivers:['demo']},
    {id:2,number:'7654321',type:'טנדר',unit:'a',status:'תקול',drivers:[]},
    {id:3,number:'1122334',type:'רכב הובלה',unit:'b',status:'מושבת'},
    {id:4,number:'4455667',type:'רכב שירות',unit:'b',status:'בטיפול',drivers:['demo']}
  ];
  return {context, vehicles, ids: () => vehicles.filter(context.fleetMatches).map(v => v.id)};
}

test('missing-driver and combined framework filters return only matching vehicles', () => {
  const {context:c,ids} = fleetContext();
  c.fleetStatus='nodriver'; assert.deepEqual(ids(),[2,3]);
  c.fleetFilter='a'; assert.deepEqual(ids(),[2]);
});
test('fault, maintenance and attention filters preserve status distinctions', () => {
  const {context:c,ids} = fleetContext();
  c.fleetStatus='bad'; assert.deepEqual(ids(),[2,3]);
  c.fleetStatus='service'; assert.deepEqual(ids(),[4]);
  c.fleetStatus='attention'; assert.deepEqual(ids(),[2,3]);
});
test('search handles normalized numbers, vehicle type, framework and no matches', () => {
  const {context:c,ids} = fleetContext();
  c.fleetSearch='1234567'; assert.deepEqual(ids(),[1]);
  c.fleetSearch='אלפא'; assert.deepEqual(ids(),[1,2]);
  c.fleetSearch='טנדר'; assert.deepEqual(ids(),[2]);
  c.fleetSearch='אין תוצאה'; assert.deepEqual(ids(),[]);
});
test('an empty fleet has no readiness percentage or all-clear claim', () => {
  const {context:c,vehicles} = fleetContext();
  assert.match(c.readinessCard([],'מוכנות'),/אין נתונים/);
  assert.doesNotMatch(c.readinessCard([],'מוכנות'),/0%|הכול תקין/);
  assert.equal(c.readiness(vehicles).pct,25);
});
