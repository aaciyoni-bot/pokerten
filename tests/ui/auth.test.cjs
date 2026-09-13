'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),babel=require('@babel/core');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('function AuthView('))[1].replace(/const root = ReactDOM.createRoot[\s\S]*$/,'window.AuthTest=AuthView; window.AppTest=App;');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM={...require('react-dom'),...require('react-dom/client')};w.React=React;w.ReactDOM=ReactDOM;w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
w.eval(fs.readFileSync(path.join(__dirname,'../../assets/js/poker-auth.js'),'utf8'));
w.eval(babel.transformSync(source,{plugins:[[require('@babel/plugin-transform-react-jsx'),{runtime:'classic'}]]}).code);
const root=ReactDOM.createRoot(w.document.getElementById('root'));
const button=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===text || b.textContent.includes(text));
const fill=async(label,value)=>React.act(()=>{const el=w.document.querySelector(`input[aria-label="${label}"]`);assert.ok(el,label);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));});
const click=async text=>React.act(async()=>{const el=button(text);assert.ok(el,text);el.click();});
(async()=>{
 let googleCalls=0;const commands=[],tokens=[];
 w.fb={auth:{},signIn:async()=>{googleCalls++;throw {code:'auth/network-request-failed'};},fx:async(name,data)=>{commands.push({name,data});return {token:'test-token',loginId:'P123456789'};},signInCode:async token=>tokens.push(token)};
 await React.act(()=>root.render(React.createElement(w.AuthTest)));
 await click('Google');assert.equal(googleCalls,1);assert.ok(w.document.querySelector('[role=alert]'));assert.equal(button('Google').disabled,false);
 assert.equal(button('מספר טלפון'),undefined,'SMS entry is absent');assert.equal(w.document.querySelector('input[type=tel]'),null);
 await click('כניסה עם קוד אישי');await fill('מספר שחקן','p123456789');await fill('קוד אישי','83492716');
 await React.act(async()=>w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
 assert.deepEqual(JSON.parse(JSON.stringify(commands[0])),{name:'pkPinLogin',data:{loginId:'P123456789',pin:'83492716'}});assert.deepEqual(tokens,['test-token']);
 await click('שחקן חדש?');await fill('השם שלך','New Player');await fill('קוד אישי','39182647');await fill('אימות קוד אישי','39182647');
 await React.act(async()=>w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(commands[1].name,'pkPinRegister');assert.equal(tokens.length,2);
 await React.act(()=>root.render(null));
 // Exercise the actual App authentication controller. Only the club presentation
 // is stubbed: no club is selected, which reproduced the production deadlock.
 w.eval("ClubsView = function({user}) { return React.createElement('main', {'data-testid':'clubs'}, user.username + '|' + user.balance + '|' + user.playerId); };");
 for(const mode of ['existing','new','retry']){
   let callback,ensures=0,failed=mode==='retry';const reads=[],subscriptions=[];
   const user={uid:'google-'+mode,email:'player@example.test',emailVerified:true,displayName:'Player'};
   let profile=mode==='new'?null:{username:'Existing',status:'approved',role:'player',balance:425,playerId:'P123456789'};
   const snap=()=>({id:user.uid,exists:()=>!!profile,data:()=>profile});
   w.fb={auth:{currentUser:user},
     onAuthStateChanged:(_,fn)=>{callback=fn;return()=>{};},
     fx:async(name)=>{assert.equal(name,'pkEnsurePlayer');ensures++;if(failed)throw Error('offline');if(!profile)profile={username:'New',status:'pending',role:'player',balance:0,playerId:'P987654321'};return {playerId:profile.playerId};},
     doc:(_,collection,id)=>({path:collection+'/'+id}),collection:(_,name)=>({path:name}),where:(...args)=>args,query:ref=>ref,
     getDoc:async ref=>{reads.push(ref.path);return snap();},
     onSnapshot:(ref,fn)=>{subscriptions.push(ref.path);if(ref.path.startsWith('users/'))fn(snap());else fn({docs:[],forEach(){}});return()=>{};},
     getDocs:async()=>({docs:[],forEach(){}}), updateDoc:()=>{throw Error('No client identity writes');}
   };
   await React.act(()=>root.render(React.createElement(w.AppTest)));
   await React.act(async()=>callback(user));
   if(mode==='retry'){assert.ok(w.document.querySelector('[role=alert]'));assert.equal(w.document.querySelector('[data-testid=clubs]'),null);failed=false;await click('ניסיון נוסף');assert.equal(ensures,2);}
   assert.ok(w.document.querySelector('[data-testid=clubs]'),mode+' reaches clubs without selecting a club');
   assert.match(w.document.querySelector('[data-testid=clubs]').textContent,mode==='new'?/New\|0\|P987654321/:/Existing\|425\|P123456789/);
   assert.ok(subscriptions.includes('users/'+user.uid),'profile listens before club selection');
   assert.ok(!subscriptions.includes('tables')&&!subscriptions.includes('tournaments'),'no out-of-club game reads');
   assert.deepEqual(reads,['users/'+user.uid]);
   await React.act(()=>root.render(null));
 }
 assert.ok(!html.includes('signInWithPhoneNumber')&&!html.includes('RecaptchaVerifier'),'no SMS SDK path');
 await React.act(()=>root.unmount());w.close();console.log('PASS: Google-to-clubs for existing/new accounts, profile failure retry, preserved balance, personal-code login/registration, and no SMS path');
})().catch(e=>{console.error(e);w.close();process.exitCode=1;});
