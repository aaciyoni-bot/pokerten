'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'https://example.invalid',runScripts:'outside-only'}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client');
w.React=React;w.eval(fs.readFileSync(require.resolve('../../assets/js/table-clips.js'),'utf8'));
const calls=[],revoked=[],tracks=[],recorders=[];
w.URL.createObjectURL=()=>'blob:https://example.invalid/test-video';w.URL.revokeObjectURL=url=>revoked.push(url);
w.HTMLMediaElement.prototype.play=async function(){};
const media=()=>{const track={stopped:false,stop(){this.stopped=true;}};tracks.push(track);return {getTracks:()=>[track]};};
w.navigator.mediaDevices={getUserMedia:async()=>media()};
w.MediaRecorder=class {
  constructor(){recorders.push(this);this.state='inactive';} static isTypeSupported(){return true;}
  start(){this.state='recording';} stop(){if(this.state!=='recording')return;this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new w.Blob(['synthetic'],{type:'video/webm'})});this.onstop();});}
};
w.fb={fx:async(name,data)=>{calls.push(data);return data.op==='get'?{video:w.btoa('synthetic'),mime:'video/webm',remainingMs:5000}:{ok:true};}};
const el=w.document.getElementById('root'),root=createRoot(el);
const find=text=>[...el.querySelectorAll('button')].find(b=>b.textContent===text);
const click=async text=>{assert.ok(find(text),text);await React.act(async()=>{find(text).click();await new Promise(r=>setTimeout(r,5));});};
test('record, preview and explicitly share once; release camera and object URLs; user can discard',async()=>{
 const feature=w.PokerTableClips;
 await React.act(()=>root.render(React.createElement(feature.Composer,{tableId:'table'})));
 await click('SnapCam');await click('Record without sound');await click('Stop');
 assert.ok(tracks.at(-1).stopped);assert.equal(calls.length,0);assert.ok(el.querySelector('video[controls]'));
 await click('Cancel');assert.equal(calls.length,0);assert.ok(revoked.length);
 await click('SnapCam');await click('Record without sound');await click('Stop');await click('Share with table');
 assert.equal(calls.length,1);assert.equal(calls[0].op,'send');assert.equal(calls[0].tableId,'table');
 assert.ok(!el.querySelector('video'));assert.ok(find('SnapCam'));
 await click('SnapCam');await click('Record without sound');
 await React.act(()=>root.render(null));assert.ok(tracks.every(t=>t.stopped));assert.equal(calls.length,1);
 const entry={uid:'sender',clipId:'fixture'};
 await React.act(()=>root.render(React.createElement(feature.ClipPlayer,{tableId:'table',entry,canRemove:true,canWatch:false})));
 assert.ok(!find('Watch clip'));assert.ok(find('Remove clip'));
 await React.act(()=>root.render(React.createElement(feature.ClipPlayer,{tableId:'table',entry,canRemove:false,canWatch:true})));
 assert.ok(!find('Remove clip'));await click('Watch clip');assert.equal(calls.at(-1).op,'get');assert.ok(el.querySelector('video'));
 await click('Close video');assert.ok(!el.querySelector('video'));
 await React.act(()=>root.unmount());w.close();
});
