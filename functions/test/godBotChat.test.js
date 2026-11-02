'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const localRequire=createRequire(path.join(__dirname,'../pokerEngine.js'));
const engine=fs.readFileSync(path.join(__dirname,'../pokerEngine.js'),'utf8');
const guard={};vm.runInNewContext(engine.match(/const GOD_EMAILS = [^;]+;/)[0]+'\n'+engine.match(/const isGodAuth = [^;]+;/)[0]+'\nthis.check=isGodAuth;',guard);
const GOD='haim29071994@gmail.com',OTHER_GOD='info.bagso@gmail.com';
function fixture(){
 const docs=new Map([['tables/tableA',{type:'poker',authorityVersion:2,clubId:'clubA',settings:{serverEngine:true},
  players:{botA:{uid:'botA',name:'Alex',isBot:true,stack:125,status:'active'},human:{uid:'human',name:'Human',isBot:false,stack:50,status:'active'}},
  gameState:{phase:'turn',activeTurnUid:'human',turnStartedAt:200,pots:[{amount:75}]},chat:[]}],['memberships/god_clubA',{status:'approved',role:'player'}]]);
 let auto=0,now=50000,transactions=0;const reads=[];
 class Clock extends Date{static now(){return now;}}
 const ref=path=>({path}),db={doc:ref,collection:p=>({doc:id=>ref(p+'/'+(id||'audit-'+(++auto)))}),async runTransaction(fn){
  transactions++;let writing=false;const staged=[];
  const tx={async get(r){assert.equal(writing,false,'all reads before writes');reads.push(r.path);return{exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))};},
   set(r,d){writing=true;staged.push(()=>docs.set(r.path,structuredClone(d)));},
   update(r,patch){writing=true;staged.push(()=>docs.set(r.path,{...docs.get(r.path),...structuredClone(patch)}));}};
  const result=await fn(tx);staged.forEach(f=>f());return result;
 }};
 const a={module:{exports:{}},Date:Clock,require:n=>n==='firebase-admin/firestore'?{getFirestore:()=>db}:localRequire(n)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pokerAuthority.js'),'utf8'),a);
 const c={module:{exports:{}},require:n=>n==='./pokerAuthority'?a.module.exports:localRequire(n)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../godBotChat.js'),'utf8'),c);
 const call=c.module.exports.createCallable({onCall:(_,fn)=>fn,HttpsError:localRequire('firebase-functions/v2/https').HttpsError,isGodAuth:guard.check,CALL_OPTS:{}});
 const request=(data={},auth={uid:'god',token:{email:GOD,email_verified:true}})=>({auth,data:{tableId:'tableA',targetUid:'botA',text:'Good hand!',requestId:'chat-request-00000001',...data}});
 return{docs,reads,request,call,advance:ms=>{now+=ms;},get transactions(){return transactions;}};
}
test('GOD posts under the seated character, privately records the operator, and preserves gameplay',async()=>{
 const f=fixture(),before=structuredClone(f.docs.get('tables/tableA'));
 const r=await f.call(f.request({name:'Forged name',uid:'human',isBot:false,emoji:'spoof'}));
 const t=f.docs.get('tables/tableA'),m=t.chat[0];assert.equal(m.uid,'botA');assert.equal(m.name,'Alex');assert.equal(m.text,'Good hand!');
 assert.deepEqual(Object.keys(m).sort(),['at','id','name','text','uid']);assert.deepEqual(JSON.parse(JSON.stringify(r.message)),m);
 assert.deepEqual({...t,chat:[]},before,'no cards, turn, seat or stack changes');
 const audits=[...f.docs].filter(([p])=>p.startsWith('_pkAudit/'));assert.equal(audits.length,1);
 assert.equal(audits[0][1].uid,'god');assert.equal(audits[0][1].targetUid,'botA');assert.equal(audits[0][1].text,m.text);
 const replay=await f.call(f.request({name:'Forged name',uid:'human',isBot:false,emoji:'spoof'}));assert.deepEqual(JSON.parse(JSON.stringify(replay)),JSON.parse(JSON.stringify(r)));
 assert.equal(f.docs.get('tables/tableA').chat.length,1);assert.equal([...f.docs.keys()].filter(p=>p.startsWith('_pkAudit/')).length,1);
 await assert.rejects(f.call(f.request({text:'Different message'})),e=>e.code==='invalid-argument');
});
test('ordinary managers, forged profile fields and unverified or revoked GOD identities cannot post',async()=>{
 for(const auth of [null,{uid:'god',token:{email:GOD,email_verified:false}},{uid:'god',token:{email:'ordinary@example.test',email_verified:true},role:'super_admin'},
  {uid:'god',token:{email:'easymarcelos@gmail.com',email_verified:true}}]){
  const f=fixture();await assert.rejects(f.call(f.request({role:'super_admin',email:GOD},auth)),e=>e.code===(auth?'permission-denied':'unauthenticated'));
  assert.equal(f.transactions,0);assert.equal(f.reads.length,0);
 }
});
test('GOD outside the management allowlist still needs approved membership in this table club',async()=>{
 const f=fixture(),auth={uid:'god',token:{email:OTHER_GOD,email_verified:true}};
 f.docs.delete('memberships/god_clubA');await assert.rejects(f.call(f.request({},auth)),e=>e.code==='permission-denied');
 assert.equal(f.docs.get('tables/tableA').chat.length,0);
 f.docs.set('memberships/god_clubA',{status:'approved',role:'player'});await f.call(f.request({},auth));assert.equal(f.docs.get('tables/tableA').chat.length,1);
});
test('cannot impersonate humans, departed or eliminated characters, or another table seat',async()=>{
 for(const targetUid of ['human','missing','botElsewhere']){
  const f=fixture();await assert.rejects(f.call(f.request({targetUid})),e=>e.code==='failed-precondition');assert.equal(f.docs.get('tables/tableA').chat.length,0);
 }
 const f=fixture();f.docs.get('tables/tableA').players.botA.status='out';await assert.rejects(f.call(f.request()),e=>e.code==='failed-precondition');
});
test('respects mute, closed tournaments, protected tables and message validation',async()=>{
 for(const patch of [{chatMuted:true},{archived:true},{tournament:{finished:true}},{tournament:{cancelled:true}},{type:'durak'},{authorityVersion:1},{settings:{serverEngine:false}}]){
  const f=fixture();Object.assign(f.docs.get('tables/tableA'),patch);await assert.rejects(f.call(f.request()),e=>e.code==='failed-precondition');
 }
 for(const text of ['', '   ', 'x'.repeat(241),{toString:'forged'}]){const f=fixture();await assert.rejects(f.call(f.request({text})),e=>e.code==='invalid-argument');assert.equal(f.transactions,0);}
 const f=fixture();f.docs.delete('tables/tableA');await assert.rejects(f.call(f.request()),e=>e.code==='not-found');
});
test('limits rapid repeat messages and retains at most sixty chat entries',async()=>{
 const f=fixture(),t=f.docs.get('tables/tableA');t.tournamentId='running-tour';t.tournament={finished:false};
 t.chat=Array.from({length:60},(_,i)=>({uid:'human',name:'Human',text:String(i),at:i}));
 await f.call(f.request());assert.equal(f.docs.get('tables/tableA').chat.length,60);assert.equal(f.docs.get('tables/tableA').chat[0].text,'1');
 await assert.rejects(f.call(f.request({requestId:'chat-request-00000002'})),e=>e.code==='resource-exhausted');
 f.advance(1500);await f.call(f.request({requestId:'chat-request-00000002'}));assert.equal(f.docs.get('tables/tableA').chat.length,60);
});
