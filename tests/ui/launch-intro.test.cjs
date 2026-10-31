'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const block=html.slice(html.indexOf('<div id="orizis-intro"'),html.indexOf('<!-- ═══ /ORIZIS INTRO ═══ -->'));
const script=block.match(/<script>([\s\S]*?)<\/script>/)[1];
async function run(mode){
 const w=new JSDOM(block,{url:'https://pokerten.com',runScripts:'outside-only'}).window;
 let plays=0,paused=0,id=0;const timers=new Map();
 w.matchMedia=()=>({matches:mode==='reduced'});
 w.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
 w.HTMLMediaElement.prototype.play=function(){plays++;return mode==='blocked'?Promise.reject(new Error('autoplay denied')):Promise.resolve();};
 w.HTMLMediaElement.prototype.pause=function(){paused++;};
 if(mode==='seen')w.sessionStorage.setItem('pkIntroSeen','1');
 w.eval(script);await Promise.resolve();
 const el=w.document.getElementById('orizis-intro'),video=el.querySelector('video');
 if(['reduced','seen'].includes(mode))assert.equal(plays,0);else assert.equal(plays,1);
 if(mode==='reduced'){assert.equal(video.getAttribute('src'),null);[...timers.values()].find(t=>t.delay===700).fn();}
 if(mode==='normal'){
  assert.equal(video.muted,true,'autoplay starts muted');
  el.querySelector('[data-intro-sound]').click();assert.equal(video.muted,false);
  video.dispatchEvent(new w.Event('ended'));
 }
 if(mode==='skip')el.querySelector('[data-intro-skip]').click();
 if(mode==='escape')w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));
 if(mode==='error')video.dispatchEvent(new w.Event('error'));
 if(mode==='timeout')[...timers.values()].find(t=>t.delay===6500).fn();
 assert.ok(el.classList.contains('oi-out'),mode+' must release the login screen');
 assert.equal(paused,1);assert.equal(w.sessionStorage.getItem('pkIntroSeen'),'1');
 [...timers.values()].find(t=>t.delay===260).fn();assert.equal(w.document.getElementById('orizis-intro'),null);
 w.close();
}
(async()=>{for(const mode of ['normal','skip','escape','error','timeout','blocked','reduced','seen'])await run(mode);console.log('PASS: launch intro ends, skips, handles autoplay/load errors, bounds waiting and honors reduced motion/session replay');})().catch(e=>{console.error(e);process.exitCode=1;});
