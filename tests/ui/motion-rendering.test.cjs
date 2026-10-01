'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),babel=require('@babel/core'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only'}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client');w.React=React;
let reduced=false,sequence=0;const listeners=new Set(),frames=new Map(),timers=new Map(),sounds=[];
w.matchMedia=()=>({get matches(){return reduced;},addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)});
w.requestAnimationFrame=fn=>{const id=++sequence;frames.set(id,fn);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
w.setTimeout=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
w.PCard=()=>React.createElement('span',null,'A');w.CasinoChipStack=({amount})=>React.createElement('span',{'data-chips':amount},amount);w.formatShort=String;w.playSnd=name=>sounds.push(name);
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function PokerTable('))[1];
const names=['useReducedPokerMotion','usePokerMotionStart','pokerVisualPoint','usePokerFlightPoints','DiscardFly','CountNum','BetCollect','PotAward'],chunks=[];
for(const node of babel.parseSync(source).program.body)if(node.type==='VariableDeclaration')for(const d of node.declarations)if(names.includes(d.id.name))chunks.push(`${node.kind} ${source.slice(d.start,d.end)};`);
assert.equal(chunks.length,names.length);w.eval(chunks.join('\n')+'\nwindow.motion={'+names.join(',')+'};');
const {DiscardFly,CountNum,BetCollect,PotAward,pokerVisualPoint}=w.motion,root=createRoot(w.document.getElementById('root'));
const paint=async()=>React.act(()=>{const pending=[...frames];frames.clear();pending.forEach(([,fn])=>fn(w.performance.now()));});
const render=async(component,props)=>React.act(()=>root.render(component?React.createElement(component,props):null));
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
const originalRect=w.Element.prototype.getBoundingClientRect;
w.Element.prototype.getBoundingClientRect=function(){if(this.classList.contains('poker-table'))return rect(100,50,400,800);if(this.classList.contains('poker-collected-pot'))return rect(220,350,40,40);if(this.classList.contains('player-pod'))return rect(140,650,80,80);return originalRect.call(this);};
const scene=(component,props)=>React.createElement('div',{className:'poker-table'},React.createElement('div',{className:'poker-collected-pot'}),React.createElement('div',{className:'poker-seat','data-player-uid':'hero'},React.createElement('div',{className:'player-pod'})),React.createElement(component,props));
(async()=>{
  // Unmount precisely between the two frames. No late setState or orphan
  // animation callback may survive a table change during a visual effect.
  await render(DiscardFly,{card:{val:'A',suit:'♠'}});assert.equal(frames.size,1);await paint();assert.equal(frames.size,1);await render(null);assert.equal(frames.size,0);assert.equal(listeners.size,0);
  // Capture the chosen card before React removes it from the new GG fan.
  // The flight must not jump to the old centre-bottom origin.
  await render(DiscardFly,{card:{val:'A',suit:'♠'},from:{left:'21%',top:'73%'}});
  let discard=w.document.querySelector('.poker-discard-flight');assert.equal(discard.firstElementChild.style.left,'21%');assert.equal(discard.firstElementChild.style.top,'73%');
  await paint();await paint();assert.equal(discard.style.transform,'translate(calc(50% - 21%), calc(60% - 73%))');assert.match(discard.style.transition,/transform 0\.38s ease-in/);await render(null);
  // A responsive pot position and a lower-left winner override legacy guesses.
  const from={left:'calc(100% - 55px)',top:'calc(100% - var(--poker-hero-bottom, 158px) - 20px)'};
  await React.act(()=>root.render(scene(BetCollect,{from,to:{left:'50%',top:'35%'},amount:25,snd:true})));
  let flight=w.document.querySelector('.poker-bet-collection');assert.equal(flight.firstElementChild.style.left,from.left);assert.equal(flight.firstElementChild.style.top,from.top);
  assert.equal([...timers.values()][0].delay,350,'chip sound accompanies the faster arrival');
  await paint();await paint();assert.equal(flight.style.transform,`translate(calc(35% - ${from.left}), calc(40% - ${from.top}))`);assert.match(flight.style.transition,/transform 0\.38s ease-in/);assert.doesNotMatch(flight.style.transition,/(left|top|all)/);assert.equal(flight.style.opacity,'0.1');
  await render(null);assert.equal(timers.size,0,'leaving the table cancels its sound');
  await React.act(()=>root.render(scene(PotAward,{to:{left:'50%',top:'78%'},toUid:'hero',amount:125,dur:.6,snd:true})));
  flight=w.document.querySelector('.poker-pot-award');assert.equal(flight.firstElementChild.style.left,'35%');assert.equal(flight.firstElementChild.style.top,'40%');
  assert.ok([...timers.values()].some(t=>t.delay===480),'award sound delay stays tied to duration');assert.ok([...timers.values()].some(t=>t.delay===40),'award number still starts after 40ms');
  await paint();await paint();assert.equal(flight.style.transform,'translate(calc(20% - 35%), calc(80% - 40%))');assert.equal(flight.style.transition,'transform 0.6s ease-in-out, opacity 0.18s ease-in 0.6s');
  // Switching the OS preference while mounted stops motion immediately.
  await React.act(()=>{reduced=true;listeners.forEach(fn=>fn());});assert.equal(flight.style.transition,'none');assert.equal(frames.size,0);await render(null);assert.equal(timers.size,0);assert.equal(listeners.size,0);
  await render(CountNum,{value:10});await render(CountNum,{value:275});assert.equal(w.document.getElementById('root').textContent,'275');assert.equal(frames.size,0,'reduced motion displays the actual amount without tween frames');
  await render(CountNum,{value:null,fmt:v=>v===null?'—':String(v)});assert.equal(w.document.getElementById('root').textContent,'—');
  await render(null);reduced=false;
  await render(CountNum,{value:0});await render(CountNum,{value:100});assert.equal(frames.size,1);assert.equal(w.document.getElementById('root').textContent,'0');
  await React.act(()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(w.performance.now()+250));});assert.equal(w.document.getElementById('root').textContent,'100','default display tween finishes within a quarter second');assert.equal(frames.size,0);
  await render(null);
  const fallback={left:'50%',top:'35%'};assert.equal(pokerVisualPoint(null,null,fallback),fallback);assert.equal(pokerVisualPoint({getBoundingClientRect:()=>rect(0,0,0,0)},{getBoundingClientRect:()=>rect(0,0,10,10)},fallback),fallback,'hidden or unmeasured layouts retain a safe path');
  assert.match(html,/\.timer-ring circle\s*\{\s*transition: stroke-dasharray 1s linear/);
  const durationStatement=source.match(/const dur = [^;]*awards\[0\]\.amount[^;]*;/)?.[0];assert.ok(durationStatement);
  const awardDuration=new Function('awards',durationStatement+'return dur;');
  const durations=[.01,25,100,1000,1000000000].map(amount=>awardDuration([{amount}]));
  assert.ok(durations.every(d=>d>0&&d<=.9),'small and very large wins finish their travel within 900ms');assert.ok(durations.slice(1).every((d,i)=>d>=durations[i]),'larger awards do not move faster than small awards');
  assert.equal(sounds.length,0);await React.act(()=>root.unmount());w.close();
  console.log('PASS: actual motion components use rendered pot/winner centers, use fast bounded timing, cancel both frames, and honor live reduced-motion changes');
})().catch(error=>{console.error(error);process.exitCode=1;w.close();});
