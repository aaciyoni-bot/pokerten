'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../assets/js/poker-viewer-access');
function fixture(){
 let time=1000,id=0;const tasks=new Map(),pending=[];
 const events=new EventTarget();events.Event=Event;
 const document=new EventTarget();document.hidden=false;
 const fb={auth:{currentUser:{uid:'a',email:'a@example.test',emailVerified:true}},fx:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
 const access=create({fb,document,events,now:()=>time,schedule:(fn,ms)=>{tasks.set(++id,{fn,at:time+ms});return id;},cancel:id=>tasks.delete(id)});
 const flush=async()=>{await Promise.resolve();await Promise.resolve();};
 const advance=async ms=>{const target=time+ms;while(true){const next=[...tasks].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;tasks.delete(next[0]);time=next[1].at;next[1].fn();await flush();}time=target;await flush();};
 const grant=async(uid='a',extra={})=>{pending.shift().resolve({uid,god:true,oversight:false,...extra});await flush();};
 return{fb,access,events,document,pending,grant,advance,flush};
}
test('UI grant expires and denial removes it without a hand, route or token change',async()=>{
 const f=fixture();f.access.refresh();await f.grant();assert.equal(f.fb.viewerGrant.god,true);
 await f.advance(20000);assert.equal(f.pending.length,1);
 await f.grant('a',{god:false});assert.equal(f.fb.viewerGrant,null);
 f.access.refresh();await f.grant();await f.advance(30000);
 assert.equal(f.fb.viewerGrant,null,'a hanging refresh never prolongs a grant');f.access.stop();
});
test('identity switch clears immediately and late privileged replies cannot restore the previous viewer',async()=>{
 const f=fixture();f.access.refresh();const old=f.pending.shift();
 f.fb.auth.currentUser={uid:'b',email:'b@example.test',emailVerified:true};f.access.refresh();
 old.resolve({uid:'a',god:true,oversight:true});await f.flush();assert.equal(f.fb.viewerGrant,null);
 await f.grant('b',{god:false});assert.equal(f.fb.viewerGrant,null);f.access.stop();
});
test('background, browser restoration and rejected privileged commands discard cached grants',async()=>{
 const f=fixture();f.access.refresh();await f.grant();const first=f.fb.viewerGrant.generation;
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.fb.viewerGrant,null);
 f.document.hidden=false;f.events.dispatchEvent(new Event('pageshow'));assert.equal(f.fb.viewerGrant,null);
 await f.grant();assert.ok(f.fb.viewerGrant.generation>first);
 f.events.dispatchEvent(new Event('pokerten-access-denied'));assert.equal(f.fb.viewerGrant,null);
 f.access.stop();f.events.dispatchEvent(new Event('pageshow'));assert.equal(f.pending.length,0);
});
test('verified email and matching server UID are mandatory; unverified clients make no access request',async()=>{
 const f=fixture();f.fb.auth.currentUser.emailVerified=false;await f.access.refresh();assert.equal(f.pending.length,0);
 f.fb.auth.currentUser.emailVerified=true;f.access.refresh();await f.grant('someone-else');assert.equal(f.fb.viewerGrant,null);f.access.stop();
});
test('slow and failed access replies cannot retain old permissions',async()=>{
 const f=fixture();f.access.refresh();const late=f.pending.shift();await f.advance(10000);
 late.resolve({uid:'a',god:true});await f.flush();assert.equal(f.fb.viewerGrant,null);
 await f.advance(5000);await f.grant();await f.advance(20000);
 f.pending.shift().reject({code:'functions/permission-denied'});await f.flush();assert.equal(f.fb.viewerGrant,null);f.access.stop();
});
