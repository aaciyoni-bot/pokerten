const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),packCode=fs.readFileSync(path.join(root,'assets/js/poker-sound-pack.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/sounds/zynga-23-29-705/catalog.json')));
const events=JSON.parse(fs.readFileSync(path.join(root,'assets/sounds/zynga-23-29-705/events.json')));
function fixture(){
 const handlers={},played=[],requests=[],stopped=[];let theme='zynga-23-29-705';
 const param=()=>({value:1,setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}});
 const ctx={state:'running',sampleRate:24000,currentTime:1,destination:{},resume:async()=>{},
  createBuffer:(_,n)=>{const data=new Float32Array(n);return{getChannelData:()=>data};},
  decodeAudioData:async bytes=>({digest:crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex')}),
  createBufferSource:()=>{const src={playbackRate:{value:1},connect(){},start(t){played.push({src,t,buffer:src.buffer});},stop(){stopped.push(src);src.onended?.();}};return src;},
  createGain:()=>({gain:param(),connect(){}})};
 const w={__pkVolume:.55,addEventListener:(ev,fn)=>handlers[ev]=fn};
 const d={hidden:false,addEventListener:(ev,fn)=>handlers[ev]=fn};
 const c={window:w,document:d,localStorage:{getItem:()=>null,setItem(){}},console,Date,Map,Set,Math,setTimeout(){},setInterval(){},
  fetch:async url=>{requests.push(url);if(url==='assets/sounds/theme.json')return{ok:true,json:async()=>({active:theme})};
   const data=fs.readFileSync(path.join(root,url));return{ok:true,json:async()=>JSON.parse(data),arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};}};
 vm.createContext(c);vm.runInContext(packCode,c);
 vm.runInContext(html.slice(html.indexOf('const SFX = {'),html.indexOf('const creditRakeToClub ='))+'\nwindow.audioTest={SFX,playSnd,sfxPlay,setSfxLevel};',c);
 w.audioTest.SFX.ctx=ctx;w.audioTest.SFX.bus={};
 return{w,d,ctx,context:c,played,requests,stopped,pack:w.PokerSoundPack,engine:w.audioTest,handlers,setTheme:value=>theme=value};
}
test('every one of the 379 original clips survives as a complete, hashed MP3 slice',()=>{
 assert.equal(catalog.count,379);assert.equal(catalog.clips.length,379);assert.equal(new Set(catalog.clips.map(x=>x.name)).size,379);
 const bankBytes=catalog.banks.map(b=>{const bytes=fs.readFileSync(path.join(root,'assets/sounds/zynga-23-29-705',b.file));assert.equal(bytes.length,b.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),b.sha256);return bytes;});
 const ends=new Map();
 for(const clip of catalog.clips){assert.ok(clip.duration>0);assert.equal(clip.offset,ends.get(clip.bank)||0);const data=bankBytes[clip.bank].subarray(clip.offset,clip.offset+clip.bytes);assert.equal(data.length,clip.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),clip.sha256);assert.equal(data.subarray(0,3).toString(),'ID3');ends.set(clip.bank,clip.offset+clip.bytes);}
 for(const [i,bytes] of bankBytes.entries())assert.equal(ends.get(i),bytes.length);
 for(const name of [...Object.values(events.events).flat(),...Object.values(events.aliases),events.music])assert.ok(catalog.clips.some(c=>c.name===name),name);
});
test('real audio entry point routes imported check once and keeps all-in, turn, wins and chat distinct',async()=>{
 const f=fixture();await f.pack.refresh();f.handlers.pointerdown();await f.pack.preload();
 for(const type of ['check','allin','turn','win','bigwin','msg'])f.engine.playSnd(type);
 assert.equal(f.played.length,6,'imported check already contains its full knock sequence');
 assert.equal(new Set(f.played.map(p=>p.buffer.digest)).size,6);
 const coreBankRequests=f.requests.filter(x=>x.endsWith('.bin'));assert.equal(new Set(coreBankRequests).size,2,'gameplay does not download all 379 clips');
 assert.equal(coreBankRequests.length,2,'one fetch per bank');
 f.w.__pkMuted=true;f.engine.playSnd('allin');f.w.__pkMuted=false;f.w.__pkVolume=0;f.engine.playSnd('turn');f.w.__pkVolume=.5;f.d.hidden=true;f.engine.playSnd('bigwin');assert.equal(f.played.length,6);
});
test('בטל צלילים restores original synthesized wins, quiet chat, double check and direct roulette sound',async()=>{
 const f=fixture();await f.pack.refresh();f.handlers.pointerdown();await f.pack.preload();
 f.engine.playSnd('deal',3,.2);assert.equal(f.played.length,3);
 f.setTheme('original');await f.pack.refresh();assert.equal(f.pack.active,false);assert.equal(f.stopped.length,3,'scheduled imported sounds stop on rollback');
 f.engine.SFX.buf.check_knock={original:'check'};f.engine.SFX.buf.roulette_roll={original:'roulette'};
 f.engine.playSnd('check');assert.equal(f.played.length,5);assert.equal(f.played[3].buffer.original,'check');assert.equal(f.played[4].buffer.original,'check');
 f.engine.playSnd('allin');f.engine.playSnd('win');f.engine.playSnd('bigwin');assert.equal(f.played.length,8);assert.notEqual(f.played[5].buffer,f.played[6].buffer);assert.equal(f.played[6].buffer,f.played[7].buffer);
 f.engine.playSnd('msg');f.engine.playSnd('join');assert.equal(f.played.length,8);
 f.engine.sfxPlay('roulette_roll');assert.equal(f.played.at(-1).buffer.original,'roulette');
});
test('lobby music loops only in the lobby and stops on table entry, backgrounding and rollback',async()=>{
 const f=fixture();await f.pack.refresh();f.handlers.pointerdown();await f.pack.preload();await f.pack.loadClip(events.music);
 f.pack.setView('lobby');await f.pack.syncMusic();await new Promise(r=>setImmediate(r));
 const loop=f.played.find(x=>x.src.loop);assert.ok(loop);
 f.pack.setView('poker-table');assert.ok(f.stopped.includes(loop.src));
 f.engine.playSnd('win');const winner=f.played.at(-1).src;f.d.hidden=true;f.handlers.visibilitychange();assert.ok(f.stopped.includes(winner));
 f.setTheme('original');await f.pack.refresh();f.d.hidden=false;f.pack.setView('lobby');await f.pack.syncMusic();assert.equal(f.played.filter(x=>x.src.loop).length,1);
});
test('sound library exposes all clips, filters, previews one at a time and stops when dismissed',async()=>{
 const {JSDOM}=require('./ui/node_modules/jsdom');
 const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});
 // jsdom lacks native dialog methods; retain their real open/close event contract.
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new dom.window.Event('close'));};
 const f=fixture();f.context.document=dom.window.document;await f.pack.refresh();f.handlers.pointerdown();await f.pack.preload();
 await f.pack.openLibrary();const dialog=dom.window.document.querySelector('dialog');assert.ok(dialog.open);assert.equal(dialog.querySelectorAll('.pk-sound-item').length,379);
 const search=dialog.querySelector('input[type=search]');search.value='all_in';search.dispatchEvent(new dom.window.Event('input'));assert.equal(dialog.querySelectorAll('.pk-sound-item').length,2);
 dialog.querySelector('.pk-sound-item').click();await new Promise(r=>setImmediate(r));assert.equal(f.played.length,1);assert.match(dialog.querySelector('[role=status]').textContent,/Playing:/);
 dialog.querySelector('.pk-sound-item').click();await new Promise(r=>setImmediate(r));assert.equal(f.played.length,2);assert.ok(f.stopped.includes(f.played[0].src));
 dialog.querySelector('header button').click();assert.equal(dom.window.document.querySelector('dialog'),null);assert.ok(f.stopped.includes(f.played[1].src));dom.window.close();
});
