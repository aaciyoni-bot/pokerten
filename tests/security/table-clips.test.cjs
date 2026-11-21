'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Tests require the Firestore emulator.');
const admin=require('../../functions/node_modules/firebase-admin');
const app=admin.initializeApp({projectId:'demo-pokerten-security'},'clips');
const db=app.firestore();
const clips=require('../../functions/tableClips');
// Generate a solid color locally. The repository and test logs contain no video recordings.
const generated=new Map();
function sample(name){
 if(generated.has(name))return generated.get(name);
 const mp4=name.endsWith('.mp4'),duration=name.startsWith('five-')?'5':'1';
 const args=['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=32x32:r=4','-t',duration,'-an','-map_metadata','-1'];
 if(mp4)args.push('-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4');
 else args.push('-c:v','libvpx','-f','webm');
 const bytes=execFileSync('ffmpeg',[...args,'pipe:1']);
 generated.set(name,bytes);return bytes;
}
after(()=>app.delete());

test('accepts real MP4 and WebM, rejects oversized timelines and malformed media',async()=>{
 for(const type of ['mp4','webm'])await clips.validateVideo(sample('one-second.'+type),'video/'+type);
 await assert.rejects(clips.validateVideo(sample('five-seconds.webm'),'video/webm'),{code:'invalid-argument'});
 await assert.rejects(clips.validateVideo(Buffer.from('not a movie'),'video/mp4'),{code:'invalid-argument'});
});
test('sharing, audience checks, sender cooldown, moderation and expiration use the authoritative seat',async()=>{
 const tableId='table_'+randomUUID(),clubId='club_'+randomUUID(),clipId=randomUUID();
 const sender='sender',viewer='viewer',observer='observer',owner='owner',unapproved='unapproved';
 const ref=db.doc('tables/'+tableId);
 const clipRef=db.collection('_pkTableClips').doc(createHash('sha256').update(JSON.stringify([tableId,sender])).digest('hex'));
 const base={op:'send',tableId,clipId,mime:'video/webm',video:sample('one-second.webm').toString('base64')};
 const req=(who,data)=>({auth:{uid:who,token:{}},data});
 const run=(who,op,more={})=>clips.handle(db,req(who,{tableId,sender,clipId,op,...more}));
 await db.doc('clubs/'+clubId).set({ownerUid:owner});
 await Promise.all([sender,viewer,owner,observer].map(u=>db.doc('memberships/'+u+'_'+clubId).set({status:'approved',role:'player'})));
 await ref.set({authorityVersion:2,clubId,type:'poker',players:{[sender]:{name:'Sender'},[viewer]:{name:'Viewer'},[unapproved]:{name:'Waiting'}},chat:[]});
 await assert.rejects(clips.handle(db,{data:base}),{code:'unauthenticated'});
 await assert.rejects(clips.handle(db,req(observer,base)),{code:'permission-denied'});
 await assert.rejects(clips.handle(db,req(unapproved,base)),{code:'permission-denied'});
 await clips.handle(db,req(sender,base));
 await clips.handle(db,req(sender,base));
 let table=(await ref.get()).data();assert.equal(table.chat.length,1);
 assert.equal(JSON.stringify(table).includes(base.video),false);
 assert.equal((await run(viewer,'get')).video,base.video);
 await assert.rejects(run(observer,'get'),{code:'permission-denied'});
 await ref.update({['players.'+viewer]:admin.firestore.FieldValue.delete()});
 await assert.rejects(run(viewer,'get'),{code:'permission-denied'});
 await assert.rejects(clips.handle(db,req(sender,{...base,clipId:randomUUID()})),{code:'resource-exhausted'});
 await assert.rejects(run(viewer,'remove'),{code:'permission-denied'});
 await run(owner,'remove');
 assert.equal((await ref.get()).get('chat').length,0);
 assert.equal((await clipRef.get()).data().bytes,undefined);
 await assert.rejects(run(sender,'get'),{code:'not-found'});
 await ref.update({chatMuted:true});await assert.rejects(clips.handle(db,req(sender,{...base,clipId:randomUUID()})),{code:'failed-precondition'});
 await ref.update({chatMuted:false});await clipRef.delete();
 await clips.handle(db,req(sender,base));await clipRef.update({expires:Date.now()-1});
 await assert.rejects(run(sender,'get'),{code:'not-found'});
 await clips.cleanup(db,Date.now());assert.equal((await clipRef.get()).exists,false);
});
