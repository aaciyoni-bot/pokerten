'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<div id="root"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;w.PokerRuntime=require('../../assets/js/poker-runtime');w.PokerTournament=require('../../assets/js/poker-tournament');w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
w.fb={db:{},auth:{currentUser:{uid:'player'}},getDocs:async()=>({docs:[],forEach(){}}),collection:()=>({})};
const html=fs.readFileSync(require.resolve('../../index.html'),'utf8'),script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function ClubsView('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.ClubsTest=ClubsView;window.getClubCode=clubCode;');w.eval(script);
const root=ReactDOM.createRoot(w.document.getElementById('root')),messages=[],entered=[];
const club={id:'main',name:'PokerTen',ownerUid:'owner'},code=w.getClubCode(club.id);
const props={user:{uid:'player',username:'Player',role:'player'},clubs:[club],myMems:[{clubId:'main',status:'approved'}],onEnter:c=>entered.push(c),showToast:(m,type)=>messages.push({m,type})};
const setInput=async value=>React.act(async()=>{const el=w.document.getElementById('clubCodeIn');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));});
(async()=>{
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,props)));
 for(let i=1;i<=6;i++)await setInput(code.slice(0,i));
 assert.equal(messages.filter(m=>m.type==='error').length,0,'typing the sixth digit uses the complete code');assert.equal(entered.length,1);assert.equal(entered[0].id,'main');
 await setInput('');await setInput(code);assert.equal(entered.length,2,'pasting a full valid code enters an approved membership');
 await setInput('000000');assert.equal(entered.length,2);assert.match(messages.at(-1).m,/No club found/);
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,myMems:[]})));await setInput('');await setInput(code);
 assert.equal(entered.length,2,'a valid code cannot bypass membership approval');assert.ok([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Request to join'));
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,myMems:[{clubId:'main',status:'pending'}]})));await setInput('');await setInput(code);
 assert.equal(entered.length,2);assert.match(w.document.body.textContent,/pending approval/);
 // Memberships and clubs arrive independently. Do not mount Create as the
 // only carousel snap target while the user's club list is still loading.
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,directoryReady:false})));
 assert.equal(w.document.querySelector('.cl-deck'),null);
 assert.match(w.document.querySelector('[role="status"]').textContent,/Loading your clubs/);
 let scrolled=0;w.HTMLElement.prototype.scrollTo=function(options){assert.equal(options.left,0);scrolled++;};
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,directoryReady:true})));
 assert.equal(scrolled,1);assert.equal(w.document.querySelector('.cl-deck .cl-name').textContent,'PokerTen');
 // Returning balances must not yank the user's manually chosen card back.
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,myMems:[{clubId:'main',status:'approved',balance:20}]})));
 assert.equal(scrolled,1);
 await React.act(async()=>root.render(null));
 w.localStorage.setItem('pkLastClub_player','recent');
 const allClubs=[{id:'oversight',name:'Oversight',ownerUid:'someone'},club,{id:'recent',name:'Recent club',ownerUid:'someone'},{id:'owned',name:'Owned club',ownerUid:'player'}];
 const memberships=[{clubId:'main',status:'approved'},{clubId:'recent',status:'approved'},{clubId:'owned',status:'approved'}];
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,clubs:allClubs,myMems:memberships})));
 assert.deepEqual([...w.document.querySelectorAll('.cl-deck .cl-name')].map(e=>e.textContent),['Recent club','Owned club','PokerTen']);
 assert.ok(w.document.querySelector('.cl-deck').lastElementChild.classList.contains('cl-card-create'));
 await React.act(async()=>root.render(React.createElement(w.ClubsTest,{...props,clubs:allClubs,myMems:memberships.filter(m=>m.clubId!=='recent')})));
 assert.equal(w.document.querySelector('.cl-deck .cl-name').textContent,'Owned club','a remembered club cannot restore removed membership');
 await React.act(()=>root.unmount());w.close();console.log('PASS: club codes, membership protection, membership-first loading, remembered club order and stable carousel');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});
