'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const React=require('react');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.test'});
global.window=dom.window;global.document=dom.window.document;
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
global.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client');
const root=createRoot(document.getElementById('root'));
const scope={window:{fb:{auth:{currentUser:{uid:'manager',email:'manager@example.test',emailVerified:true}}}}};
const definitions=['ROLES','GOD_EMAILS','SUPER_ADMIN_EMAIL','CLUB_OVERSIGHT_EMAILS'].map(name=>html.match(new RegExp('const '+name+' = [\\s\\S]*?;'))[0]).join('\n');
vm.runInNewContext(definitions+'\n'+html.slice(html.indexOf('const isGodUser ='),html.indexOf('const buyInMin ='))+'\nthis.allowed=canConfigureBotLobby;',scope);
const commands=[];let failNext=false;
const pokerCommand=async(name,payload)=>{commands.push({name,payload});if(failNext){failNext=false;throw new Error('Temporary server failure');}return{ok:true};};
const start=html.indexOf('function botLobbyTemplates('),end=html.indexOf('function BackofficeView(',start);
assert(start>0&&end>start);
const actual=new Function('React','useState','useRef','canConfigureBotLobby','CLUB_ID','GAME_CARDS','round2','formatMoney','pokerCommand',
  html.slice(start,end)+';return {botLobbyTemplates,BotLobbyControl};')(React,React.useState,React.useRef,scope.allowed,'clubA',{'NLH':2,'Omaha 6':6},n=>Math.round(n*100)/100,n=>Number(n).toFixed(2),pokerCommand);
const table=(id,patch={})=>({docId:id,clubId:'clubA',authorityVersion:2,type:'poker',settings:{serverEngine:true,baseGameType:'NLH',maxPlayers:6,blinds:.5,minBuyIn:40,maxBuyIn:200},...patch});
const eligible=table('cashA');
const user={uid:'manager',role:'manager',status:'approved'};
const clubSettings={ownerUid:'owner',botsAuto:true};
const render=async props=>React.act(async()=>{root.render(React.createElement(actual.BotLobbyControl,{user,clubSettings,tables:[eligible],...props}));});

(async()=>{
 for(const config of [undefined,{version:1,enabled:true},{version:1,enabled:false},{version:1,enabled:true,fundingBlockedAt:1700000000000,slots:[{id:'old',profile:0,templates:[eligible.settings]}]}]){
  await render({clubSettings:{...clubSettings,botLobby:config}});
  assert.equal(document.querySelector('[role="status"]').textContent,'Manual only');
  assert.match(document.body.textContent,/Deleting a table will not open a replacement/);
  assert.equal(document.querySelectorAll('button').length,0,'Old settings cannot offer an automatic-enable control');
 }
 await render({user:{...user,role:'agent'}});assert.equal(document.body.textContent,'');
 await render({user:{...user,status:'banned'}});assert.equal(document.body.textContent,'');
 await render({user:{uid:'owner',role:'player',status:'pending'}});assert.match(document.body.textContent,/Manual only/,'Actual owner sees manual-opening status');
 scope.window.fb.auth.currentUser={uid:'haim',email:'haim29071994@gmail.com',emailVerified:true};
 await render({user:{uid:'haim',role:'player',status:'pending'}});assert.match(document.body.textContent,/Manual only/,'Existing verified GOD sees manual-opening status');
 scope.window.fb.auth.currentUser.emailVerified=false;
 await render({user:{uid:'haim',role:'player',status:'pending'}});assert.equal(document.body.textContent,'');
 await render({tables:[],clubSettings:{...clubSettings,botsAuto:false}});
 assert.equal(document.querySelector('[role="status"]').textContent,'Manual only');
 assert.equal(commands.length,0,'The status panel cannot request automatic creation');
 await React.act(async()=>root.unmount());
 console.log('PASS: manual-only table opening status, obsolete config isolation, no automatic enable action, and manager/GOD permissions');
})().catch(error=>{console.error(error);process.exitCode=1;});
