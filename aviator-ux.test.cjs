const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Behaviour fixture only: these tests do not claim browser/layout verification.
function fixture(send = async () => {}) {
  const elements = new Map();
  const doc = {activeElement:null,getElementById:id=>elements.get(id)};
  class Element {
    constructor(id='') {
      this.id=id; this.value=''; this.textContent=''; this.children=[];
      this.events={}; this.attrs={}; this.isConnected=true;
      this.scrollTop=0; this.clientHeight=300; this.scrollHeight=600;
      const classes=new Set();
      this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),
        toggle:(c,on)=>on?classes.add(c):classes.delete(c)};
    }
    addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
    async fire(name,extra={}) {
      const event={target:this,preventDefault(){this.prevented=true;},...extra};
      await Promise.all((this.events[name]||[]).map(fn=>fn(event)));return event;
    }
    setAttribute(k,v){this.attrs[k]=v;}
    focus(){doc.activeElement=this;}
    append(...children){this.children.push(...children);}
    replaceChildren(fragment){this.children=[...fragment.children];}
    querySelectorAll(){return ['chatClose','chatList','chatInput','chatSend'].map(id=>elements.get(id)).filter(e=>!e.disabled);}
  }
  for(const id of ['app','chatModal','chatInput','chatSend','chatList','chatStatus','chatBtn','chatClose','chatCount','chatForm']) elements.set(id,new Element(id));
  doc.createElement=()=>new Element();doc.createDocumentFragment=()=>new Element();
  const context={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/aviator-ux.js','utf8'),context);
  const controller=context.window.AviatorUX.createChat({document:doc,send,getUser:()=>({uid:'test-user'}),getName:()=> 'Test pilot'});
  const get=id=>elements.get(id);
  return {doc,get,controller};
}

test('failed send keeps the draft and dialog open; retry clears only after success',async()=>{
  let attempts=0;
  const f=fixture(async()=>{if(++attempts===1)throw new Error('offline');});
  f.get('chatBtn').focus();await f.get('chatBtn').fire('click');
  f.get('chatInput').value='טיוטה שלא הולכת לאיבוד';
  await f.get('chatForm').fire('submit');
  assert.equal(f.get('chatInput').value,'טיוטה שלא הולכת לאיבוד');
  assert.ok(f.get('chatModal').classList.contains('on'));
  assert.ok(f.get('chatStatus').classList.contains('error'));
  assert.equal(f.get('chatSend').disabled,false);
  await f.get('chatForm').fire('submit');
  assert.equal(f.get('chatInput').value,'');assert.equal(attempts,2);
  assert.equal(f.get('chatCount').textContent,'0/140');
  assert.ok(f.get('chatModal').classList.contains('on'));
});

test('double submission while pending creates one request and shows a busy state',async()=>{
  let complete,calls=0;
  const f=fixture(()=>{calls++;return new Promise(resolve=>{complete=resolve;});});
  f.get('chatInput').value='hello';
  const first=f.get('chatForm').fire('submit');
  await f.get('chatForm').fire('submit');
  assert.equal(calls,1);assert.equal(f.get('chatSend').disabled,true);
  assert.equal(f.get('chatForm').attrs['aria-busy'],'true');
  complete();await first;
  assert.equal(f.get('chatForm').attrs['aria-busy'],'false');
});

test('keyboard focus stays inside the dialog and Escape restores the opener',async()=>{
  const f=fixture();f.get('chatBtn').focus();await f.get('chatBtn').fire('click');
  assert.equal(f.doc.activeElement.id,'chatClose');assert.equal(f.get('app').inert,true);
  await f.get('chatModal').fire('keydown',{key:'Tab',shiftKey:true});
  assert.equal(f.doc.activeElement.id,'chatSend');
  await f.get('chatModal').fire('keydown',{key:'Tab',shiftKey:false});
  assert.equal(f.doc.activeElement.id,'chatClose');
  await f.get('chatModal').fire('keydown',{key:'Escape'});
  assert.equal(f.doc.activeElement.id,'chatBtn');assert.equal(f.get('app').inert,false);
  assert.equal(f.get('chatBtn').attrs['aria-expanded'],'false');
});

test('render treats message markup as text and preserves older-message scroll position',()=>{
  const f=fixture();f.get('chatList').scrollTop=22;
  f.controller.render([{uid:'x',name:'<script>name</script>',text:'<img src=x onerror=alert(1)>',ts:0}]);
  const row=f.get('chatList').children[0];
  assert.equal(row.children[0].children[0].textContent,'<script>name</script>');
  assert.equal(row.children[1].textContent,'<img src=x onerror=alert(1)>');
  assert.equal(f.get('chatList').scrollTop,22);
});

test('empty message does not send and empty room has a readable prompt',async()=>{
  let sends=0;const f=fixture(async()=>{sends++;});
  f.controller.render([]);assert.ok(f.get('chatList').children[0].textContent);
  f.get('chatInput').value='   ';await f.get('chatForm').fire('submit');
  assert.equal(sends,0);assert.equal(f.doc.activeElement.id,'chatInput');
});

test('mute controls the common output for active effects as well as ambience',()=>{
  const html=fs.readFileSync(__dirname+'/aviator-live.html','utf8');
  const a=html.indexOf('function updateSoundOutput(){');
  const b=html.indexOf('function loadBuffer(url){');
  const gainCalls=[],buttons={soundBtn:{setAttribute(k,v){this[k]=v;}}};
  const context={muted:true,document:{visibilityState:'visible'},AC:{currentTime:2},
    masterGain:{gain:{cancelScheduledValues(){},setTargetAtTime(value){gainCalls.push(value);}}},
    $:selector=>buttons[selector.slice(1)]};
  vm.createContext(context);vm.runInContext(html.slice(a,b),context);
  context.updateSoundOutput();assert.equal(gainCalls.at(-1),0);
  context.muted=false;context.updateSoundOutput();assert.equal(gainCalls.at(-1),.75);
  context.document.visibilityState='hidden';context.updateSoundOutput();assert.equal(gainCalls.at(-1),0);
  assert.equal((html.match(/\.connect\(AC\.destination\)/g)||[]).length,1);
});

test('an audio resume failure remains retryable on the next gesture',async()=>{
  const html=fs.readFileSync(__dirname+'/aviator-live.html','utf8');
  const code=html.slice(html.indexOf('function unlockAudio(){'),html.indexOf('function loadBuffer(url){'));
  let attempts=0;
  const context={AC:{state:'suspended',resume(){attempts++;if(attempts===1)return Promise.reject(new Error('blocked'));this.state='running';return Promise.resolve();}},
    audioUnlocked:false,audioResumePending:false,muted:false,entered:false,S:{phase:'waiting'},
    $:()=>({classList:{toggle(){}}})};
  vm.createContext(context);vm.runInContext(code,context);
  context.unlockAudio();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.audioUnlocked,false);assert.equal(context.audioResumePending,false);
  context.unlockAudio();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.audioUnlocked,true);assert.equal(attempts,2);
});
