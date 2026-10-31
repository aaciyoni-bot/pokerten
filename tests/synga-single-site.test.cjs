'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(email='aaci.yoni@gmail.com',verified=true){
 const docs={'clubs/synga_main':{ownerUid:'owner'},'users/owner':{username:'Owner'},'memberships/owner_synga_main':{uid:'owner',balance:700,status:'approved'}},exports={};let postings=0;
 const doc=path=>({path}),snap=ref=>({ref,exists:!!docs[ref.path],data:()=>docs[ref.path]});
 const tx={getAll:async(...refs)=>refs.map(snap),create:(ref,data)=>{assert.equal(docs[ref.path],undefined);docs[ref.path]=data;}};
 const db={doc,collection:name=>({doc:()=>doc(name+'/'+Object.keys(docs).length)}),runTransaction:async fn=>fn(tx)};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 vm.runInNewContext(fs.readFileSync('synga-backend/siteAccess.js','utf8'),{exports,Date,require:n=>n==='firebase-functions/v2/https'?{onCall:(_,f)=>f,HttpsError}:n==='firebase-admin/firestore'?{getFirestore:id=>{assert.equal(id,'synga');return db;}}:{prepareLedger:async(_db,_tx,club,effects)=>{assert.equal(club,'synga_main');return()=>{postings++;docs['memberships/owner_synga_main'].balance+=effects[0].amount;};}}});
 return {docs,exports,call:()=>exports.siteAccess({auth:{uid:'owner',token:{email,email_verified:verified}}}),postings:()=>postings};
}
test('owner reserve adds exactly ten million once without resetting existing balance',async()=>{const f=fixture();await f.call();await f.call();assert.equal(f.docs['memberships/owner_synga_main'].balance,10000700);assert.equal(f.postings(),1);assert.equal(f.docs['_syngaIssuance/owner-reserve-v1'].amount,10000000);});
test('unverified and other identities cannot issue owner chips',async()=>{for(const f of [fixture('aaci.yoni@gmail.com',false),fixture('other@example.com')]){await f.call();assert.equal(f.postings(),0);}});
test('new account remains pending and receives no reserve',async()=>{const f=fixture('other@example.com');delete f.docs['memberships/owner_synga_main'];const r=await f.call();assert.equal(r.status,'pending');assert.equal(f.docs['memberships/owner_synga_main'].balance,0);assert.equal(f.postings(),0);});
test('site club cannot be created or archived through removed commands',async()=>{const f=fixture();for(const name of ['pkClubCreate','pkClubArchive'])await assert.rejects(f.exports[name](),e=>e.code==='failed-precondition');});
test('frontend no longer includes studio intro or selectable club creation/archive controls',()=>{const html=fs.readFileSync('index.html','utf8'),ui=fs.readFileSync('assets/js/synga-ui.js','utf8'),entry=fs.readFileSync('assets/js/synga-entry.js','utf8');assert.ok(!html.includes('id="orizis-intro"'));assert.ok(!entry.includes('ORIZIS'));const gate=ui.slice(ui.indexOf('function Clubs'),ui.indexOf('function Welcome'));assert.ok(!/onArchive|onCreate|YOUR OWN CLUB/.test(gate));assert.ok(gate.includes("member?.status==='approved'"));});
