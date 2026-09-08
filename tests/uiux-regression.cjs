// Run: node tests/uiux-regression.cjs
// Exercise the actual inline application functions with synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const fleetSource = fs.readFileSync(path.join(root, 'fleet/index.html'), 'utf8');
const greenSource = fs.readFileSync(path.join(root, 'greeneyes/index.html'), 'utf8');

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

function greenContext(solo=false) {
  const makeButton = label => ({
    textContent:label, disabled:false, attrs:{},
    setAttribute(k,v){this.attrs[k]=v;}, removeAttribute(k){delete this.attrs[k];}
  });
  const buttons=solo ? {btnSubmit:makeButton('שליחת ספירה ✓')} : {
    btnSubmit_ammo:makeButton('שליחת תחמושת ✓'),btnSubmit_equip:makeButton('שליחת צל״ם ✓')
  };
  const previous={items:{priorA:{ok:true,expected:3}},equip:{priorE:{ok:true,expected:5}},ammoTs:111,equipTs:222};
  const writes=[];
  let resolveWrite,rejectWrite;
  const context=vm.createContext({
    S:{unit:'demo',date:'2026-09-08',user:{uid:'demo'},person:{n:'Tester',pn:'demo'},
      buf:{ammo:{paper:{ok:true}},equip:{vest:{ok:true}}},counts:{demo:previous}},
    UNIT_BY_ID:{demo:{grp:'demo',full:'מסגרת הדגמה'}}, DEPT_HE:{ammo:'תחמושת',equip:'צל״ם'},
    $:id=>buttons[id], countId:()=> 'demo', isEquipDay:()=>true,
    visibleItems:k=>[{id:k==='ammo'?'paper':'vest',name:'פריט הדגמה'}],
    instOf:()=>null, expectedFor:()=>12, toast:()=>{}, celebrate:()=>{},renderCount:()=>{},
    window:{fb:{db:{},doc:()=> 'demo/document',setDoc:(ref,data)=>{
      writes.push(JSON.parse(JSON.stringify(data)));
      return new Promise((resolve,reject)=>{resolveWrite=resolve;rejectWrite=reject;});
    }}}
  });
  vm.runInContext(extract(greenSource,'submitCount','  '),context);
  return {context,buttons,previous,writes,resolve:()=>resolveWrite(),reject:()=>rejectWrite(new Error('simulated failure'))};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

for(const dept of ['ammo','equip']) {
  test('submitting '+dept+' preserves the other department and restores its button',async()=>{
    const h=greenContext(),button=h.buttons['btnSubmit_'+dept],label=button.textContent;
    const other=h.buttons['btnSubmit_'+(dept==='ammo'?'equip':'ammo')];
    h.context.submitCount(dept);
    assert.equal(h.writes.length,1);assert.equal(button.disabled,true);assert.equal(button.attrs['aria-busy'],'true');
    assert.equal(other.disabled,false);
    const preserved=dept==='ammo'?'equip':'items';
    assert.deepEqual(h.writes[0][preserved],h.previous[preserved]);
    const timestamp=dept==='ammo'?'equipTs':'ammoTs';assert.equal(h.writes[0][timestamp],h.previous[timestamp]);
    h.resolve();await flush();assert.equal(button.disabled,false);assert.equal(button.attrs['aria-busy'],undefined);assert.equal(button.textContent,label);
  });
  test('failed '+dept+' submission clears busy state and allows retry',async()=>{
    const h=greenContext(),button=h.buttons['btnSubmit_'+dept];
    h.context.submitCount(dept);h.reject();await flush();
    assert.equal(button.disabled,false);assert.equal(button.attrs['aria-busy'],undefined);assert.match(button.textContent,/ניסיון נוסף/);
  });
}
test('single-department layout uses its existing submit button',async()=>{
  const h=greenContext(true);h.context.submitCount('equip');
  assert.equal(h.buttons.btnSubmit.disabled,true);h.resolve();await flush();
  assert.equal(h.buttons.btnSubmit.textContent,'שליחת ספירה ✓');
});
test('an incomplete count is not sent',()=>{
  const h=greenContext();h.context.S.buf.ammo={};h.context.submitCount('ammo');
  assert.equal(h.writes.length,0);assert.equal(h.buttons.btnSubmit_ammo.disabled,false);
});
