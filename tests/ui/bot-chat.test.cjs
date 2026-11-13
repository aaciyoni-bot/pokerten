'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client'),{Simulate}=require('react-dom/test-utils');w.React=React;
w.eval('const {useState,useEffect,useRef,useMemo}=React;const round2=n=>Math.round(n*100)/100;const isGodUser=u=>u.god===true;const MISSIONS=[];const botMissions=()=>({});const canManageGame=()=>false;'+
 html.slice(html.indexOf('function canChatAsBot('),html.indexOf('const SPIN_SEGS ='))+
 html.slice(html.indexOf('function useTableChat('),html.indexOf('function ChatPanel('))+
 '\nwindow.testApi={canChatAsBot,BotChatComposer,BotTakeControl,quickBotPlayer,positionBotTurnPanel,PlayerPeek,useTableChat};');
const api=w.testApi,root=createRoot(w.document.getElementById('root')),doc=w.document;
const table={type:'poker',authorityVersion:2,settings:{serverEngine:true},players:{b:{uid:'b',name:'Alex',isBot:true,status:'active'},h:{uid:'h',isBot:false}}};
let calls=[],complete;
const onSend=(text,requestId)=>{calls.push({text,requestId});return new Promise((resolve,reject)=>{complete={resolve,reject};});};
const mountProfile=async(user,target='b',muted=false)=>React.act(()=>root.render(React.createElement(api.PlayerPeek,{key:target,peek:{uid:target,name:target==='b'?'Alex':'Human',isBot:target==='b'},clubId:'c',onClose(){},chatMuted:muted,onChatAs:api.canChatAsBot(user,table,target)?onSend:null})));
(async()=>{
 assert.equal(api.canChatAsBot({god:true},table,'b'),true);assert.equal(api.canChatAsBot({god:true},table,'h'),false);
 assert.equal(api.canChatAsBot({god:false,role:'super_admin'},table,'b'),false);
 assert.equal(api.canChatAsBot({god:true},table,'missing'),false);
 assert.equal(api.canChatAsBot({god:true},{...table,tournament:{finished:true}},'b'),false);
 await mountProfile({god:false});assert.doesNotMatch(doc.body.textContent,/Write as|Sending as/);assert.equal(doc.querySelector('textarea'),null);
 await mountProfile({god:true});
 const chatButton=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Write as Alex');
 const rings=[...doc.querySelectorAll('div')].find(el=>el.childNodes.length && el.firstChild.nodeType===3 && el.firstChild.textContent.includes('💍'));
 assert.ok(chatButton.compareDocumentPosition(rings) & w.Node.DOCUMENT_POSITION_FOLLOWING,'chat is above the rings');
 await React.act(()=>[...doc.querySelectorAll('button')].find(b=>b.textContent==='Write as Alex').click());
 let input=doc.querySelector('textarea');assert.ok(input);assert.equal(input.maxLength,240);assert.match(doc.querySelector('form').textContent,/Sending as Alex/);
 await React.act(()=>Simulate.change(input,{target:{value:'Good hand!'}}));
 await React.act(()=>{Simulate.submit(doc.querySelector('form'));Simulate.submit(doc.querySelector('form'));});
 assert.equal(calls.length,1);assert.ok(calls[0].requestId.length>=16);assert.equal(input.disabled,true);
 await React.act(async()=>complete.reject(Error('Connection lost')));assert.equal(input.value,'Good hand!');assert.match(doc.querySelector('[role=alert]').textContent,/Connection lost/);
 await React.act(()=>Simulate.submit(doc.querySelector('form')));assert.equal(calls.length,2);assert.equal(calls[1].requestId,calls[0].requestId,'retry reuses the server receipt');
 await React.act(async()=>complete.resolve({ok:true}));assert.equal(input.value,'');assert.match(doc.querySelector('[role=status]').textContent,/Message sent/);
 await React.act(()=>Simulate.change(input,{target:{value:'New draft'}}));
 await mountProfile({god:true},'h');assert.equal(doc.querySelector('textarea'),null,'human profile has no delegated composer');
 await mountProfile({god:true},'b',true);await React.act(()=>[...doc.querySelectorAll('button')].find(b=>b.textContent==='Write as Alex').click());
 input=doc.querySelector('textarea');assert.equal(input.value,'','changing profile clears its previous draft');assert.equal(input.disabled,true);assert.match(doc.body.textContent,/Table chat is muted/);
 const turnTable={...table,gameState:{handN:7,phase:'preflop',activeTurnUid:'b',turnStartedAt:10000,highestBet:2,minRaise:2,currentGameType:'Omaha 7'}};
 const bot={...table.players.b,bet:0,stack:100};turnTable.players={...table.players,b:bot};
 const moves=[];let ticks=0, now=10000;
 const oldNow=w.Date.now;w.Date.now=()=>now;
 const panel=()=>React.act(()=>root.render(React.createElement(api.BotTakeControl,{
   key:turnTable.gameState.turnStartedAt,end:turnTable.gameState.turnStartedAt+5000,name:bot.name,
   claim:async id=>moves.push(id),tick:async()=>{ticks++;}
 })));
 assert.equal(api.quickBotPlayer(turnTable,{god:false},true),null);
 assert.equal(api.quickBotPlayer(turnTable,{god:true},false),null);
 await panel();assert.equal(doc.querySelector('[role=timer]').textContent,'5s');
 now=14999;await React.act(()=>doc.querySelector('[aria-label="Take control of Alex"]').click());
 assert.equal(moves.length,1);assert.ok(moves[0].length>=16);
 now=15000;await React.act(()=>doc.querySelector('[aria-label="Take control of Alex"]').click());
 assert.equal(moves.length,1);await React.act(async()=>{await new Promise(r=>setTimeout(r,170));});
 assert.equal(ticks,1);assert.equal(doc.querySelector('.poker-quick-bot'),null);w.Date.now=oldNow;
 turnTable.gameState.activeTurnUid='h';assert.equal(api.quickBotPlayer(turnTable,{god:true},true),null);
 // Geometry is viewport based, while the button itself lives inside the active seat.
 const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
 for(const width of [320,393,768]){
   for(const side of ['left','right','top','bottom']){
     const x=side==='left'?10:side==='right'?width-80:width/2-35;
     const y=side==='top'?50:side==='bottom'?560:300;
     const seatBox=rect(x,y,70,62), anchor=rect(x,y+42,70,20), fan=rect(x,y-30,70,30);
     const el=r=>({getBoundingClientRect:()=>r});
     const field={getBoundingClientRect:()=>rect(0,0,width,640),querySelectorAll:()=>[el(anchor),el(seatBox),el(fan)],closest:()=>null};
     const seat={getBoundingClientRect:()=>seatBox,querySelector:()=>el(anchor),closest:()=>field,clientLeft:0,clientTop:0};
     const badge={getBoundingClientRect:()=>rect(x,y,100,34),closest:()=>seat,style:{}};
     api.positionBotTurnPanel(badge);const px=x+parseFloat(badge.style.left),py=y+parseFloat(badge.style.top);
     assert.ok(px>=0 && px+100<=width && py>=0 && py+34<=640);
     for(const obstacle of [anchor,fan])assert.ok(px>=obstacle.right||px+100<=obstacle.left||py>=obstacle.bottom||py+34<=obstacle.top);
     assert.ok(Math.hypot(px+50-anchor.left-35,py+17-anchor.top-10)<115,'button stays near this nameplate');
   }
 }
 let hook;
 function ChatProbe({state}){hook=api.useTableChat(state,'t',{uid:'me'},'poker',()=>{});return null;}
 const old=Array.from({length:60},(_,i)=>({uid:'h',text:'Old '+i,at:0}));
 await React.act(()=>root.render(React.createElement(ChatProbe,{state:{chat:old}})));assert.equal(hook.bubbles.b,undefined);
 const update={uid:'b',name:'Alex',text:'Good hand!',at:Date.now()};
 await React.act(()=>root.render(React.createElement(ChatProbe,{state:{chat:[...old.slice(1),update]}})));
 assert.equal(hook.bubbles.b,'Good hand!','a new message renders the character bubble even at the 60-entry limit');
 await React.act(()=>root.unmount());w.close();console.log('PASS: GOD-only character composer, human exclusion, safe retry, draft isolation, muted chat and bounded-history speech bubbles');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
