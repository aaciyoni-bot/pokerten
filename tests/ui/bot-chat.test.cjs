'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{createRoot}=require('react-dom/client'),{Simulate}=require('react-dom/test-utils');w.React=React;
w.eval('const {useState,useEffect,useRef,useMemo}=React;const round2=n=>Math.round(n*100)/100;const isGodUser=u=>u.god===true;const MISSIONS=[];const botMissions=()=>({});const canManageGame=()=>false;'+
 html.slice(html.indexOf('function canChatAsBot('),html.indexOf('const SPIN_SEGS ='))+
 html.slice(html.indexOf('function useTableChat('),html.indexOf('function ChatPanel('))+
 '\nwindow.testApi={canChatAsBot,BotChatComposer,BotTurnPanel,PlayerPeek,useTableChat};');
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
 await mountProfile({god:true});await React.act(()=>[...doc.querySelectorAll('button')].find(b=>b.textContent==='Write as Alex').click());
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
 const turnTable={...table,gameState:{handN:7,phase:'preflop',activeTurnUid:'h',turnStartedAt:123,highestBet:2,minRaise:2,currentGameType:'Omaha 7'}};
 const bot={...table.players.b,bet:0,stack:100};
 const moves=[];const send=async payload=>{moves.push(payload);return {controlId:'record-a'};};
 const panel=async()=>React.act(()=>root.render(React.createElement(api.PlayerPeek,{key:'betting',peek:bot,clubId:'c',onClose(){},
   botTurnPanel:React.createElement(api.BotTurnPanel,{table:turnTable,tableId:'table-a',player:bot,pot:2,send})})));
 const btn=label=>[...doc.querySelectorAll('button')].find(b=>b.textContent===label);
 await panel();await React.act(()=>btn('Play this hand').click());assert.equal(moves[0].op,'claim');
 bot.manualControl={handN:7,id:'record-a'};await panel();assert.match(doc.body.textContent,/Waiting for Alex/);assert.equal(btn('Fold'),undefined);
 turnTable.gameState.activeTurnUid='b';await panel();
 assert.ok(btn('Call 2'));assert.ok(btn('Fold'));assert.equal(btn('Check'),undefined);
 let raiseInput=doc.querySelector('input[type=number]');assert.equal(raiseInput.min,'4');assert.equal(raiseInput.max,'6');
 await React.act(()=>Simulate.change(raiseInput,{target:{value:'7'}}));assert.equal(btn('Raise to 7').disabled,true);
 await React.act(()=>Simulate.change(raiseInput,{target:{value:'6'}}));await React.act(()=>btn('Raise to 6').click());
 assert.equal(moves[1].op,'raise');assert.equal(moves[1].amount,6);assert.equal(moves[1].targetUid,'b');assert.equal(moves[1].turnStartedAt,123);
 bot.bet=2;turnTable.gameState.turnStartedAt=456;await panel();
 assert.ok(btn('Check'));await React.act(()=>btn('Let bot decide this turn').click());assert.equal(moves.at(-1).op,'autoTurn');
 await React.act(()=>btn('Return to automatic play').click());assert.equal(moves.at(-1).op,'release');
 let hook;
 function ChatProbe({state}){hook=api.useTableChat(state,'t',{uid:'me'},'poker',()=>{});return null;}
 const old=Array.from({length:60},(_,i)=>({uid:'h',text:'Old '+i,at:0}));
 await React.act(()=>root.render(React.createElement(ChatProbe,{state:{chat:old}})));assert.equal(hook.bubbles.b,undefined);
 const update={uid:'b',name:'Alex',text:'Good hand!',at:Date.now()};
 await React.act(()=>root.render(React.createElement(ChatProbe,{state:{chat:[...old.slice(1),update]}})));
 assert.equal(hook.bubbles.b,'Good hand!','a new message renders the character bubble even at the 60-entry limit');
 await React.act(()=>root.unmount());w.close();console.log('PASS: GOD-only character composer, human exclusion, safe retry, draft isolation, muted chat and bounded-history speech bubbles');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
