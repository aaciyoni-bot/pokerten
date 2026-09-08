'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('window.fb.reauthPlayerWithGoogle ='),end=html.indexOf('// Robust Google sign-in:',start);
function setup({google=false,collision=false}={}){
 const calls=[];const user={uid:'existing-player',providerData:[{providerId:google?'google.com':'phone'}],getIdToken:async fresh=>{calls.push(['token',fresh]);return 'not-exported';}};
 const auth={currentUser:user},window={fb:{}};
 class Provider{setCustomParameters(){}static credentialFromResult(result){assert.equal(result.user.uid,user.uid);return {providerId:'google.com'};}}
 vm.runInNewContext(html.slice(start,end),{window,_auth:auth,GoogleAuthProvider:Provider,
 linkWithPopup:async player=>{calls.push(['link',player.uid]);if(collision)throw Object.assign(new Error('taken'),{code:'auth/credential-already-in-use'});return {user:player};},
 reauthenticateWithCredential:async(player)=>{calls.push(['reauth-credential',player.uid]);},
 reauthenticateWithPopup:async(player)=>{calls.push(['reauth-popup',player.uid]);}});
 return{run:window.fb.reauthPlayerWithGoogle,calls,auth};
}
test('existing SMS session links and freshly verifies Google while preserving the player UID',async()=>{
 const f=setup();assert.equal((await f.run()).uid,'existing-player');assert.deepEqual(f.calls,[['link','existing-player'],['reauth-credential','existing-player'],['token',true]]);assert.equal(f.auth.currentUser.uid,'existing-player');
});
test('an existing Google player reauthenticates without creating or relinking accounts',async()=>{
 const f=setup({google:true});await f.run();assert.deepEqual(f.calls,[['reauth-popup','existing-player'],['token',true]]);
});
test('a Google identity belonging to another player is rejected without switching accounts',async()=>{
 const f=setup({collision:true});await assert.rejects(f.run(),e=>e.code==='auth/credential-already-in-use');assert.equal(f.auth.currentUser.uid,'existing-player');assert.deepEqual(f.calls,[['link','existing-player']]);
 const empty=setup();empty.auth.currentUser=null;await assert.rejects(empty.run(),e=>e.code==='auth/no-current-user');assert.equal(empty.calls.length,0);
});
