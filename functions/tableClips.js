'use strict';

const {createHash} = require('node:crypto');
const {onCall} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {getFirestore} = require('firebase-admin/firestore');
const A = require('./pokerAuthority');

const maxBytes = 256 * 1024;
const lifetimeMs = 90_000;
const cooldownMs = 30_000;
const collection = '_pkTableClips';

function videoBytes(data, mime) {
  if (!['video/webm', 'video/mp4'].includes(mime) || typeof data !== 'string' ||
      data.length < 16 || data.length > 4 * Math.ceil(maxBytes / 3) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) A.fail('invalid-argument', 'Invalid clip.');
  const bytes = Buffer.from(data, 'base64');
  const header = mime === 'video/webm' ? bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])) :
    bytes.toString('ascii',4,8) === 'ftyp';
  if (!header || bytes.length > maxBytes || bytes.toString('base64') !== data)
    A.fail('invalid-argument', 'Unsupported clip.');
  return bytes;
}

async function validateVideo(bytes, mime) {
  const {Input,BufferSource,WEBM,MP4}=await import('mediabunny');
  const input=new Input({source:new BufferSource(bytes),formats:[mime==='video/webm'?WEBM:MP4]});
  try {
    const tracks=await input.getTracks();
    const videos=await input.getVideoTracks();
    if(videos.length!==1 || tracks.length>2)throw Error();
    const [width,height,duration]=await Promise.all([
      videos[0].getDisplayWidth(),videos[0].getDisplayHeight(),input.computeDuration(tracks,{skipLiveWait:true})
    ]);
    if(!Number.isFinite(duration)||duration<=0||duration>3.25||width<1||height<1||
        Math.max(width,height)>1920||width*height>1920*1080)throw Error();
  } catch { A.fail('invalid-argument','Choose a valid clip up to 3 seconds.'); }
  finally { input.dispose(); }
}

async function handle(db, request) {
  const uid = A.uid(request), data = request.data || {}, op = data.op;
  const id = A.key(data.tableId, 'table'), clipId = A.key(data.clipId, 'clip');
  if (!['send','get','remove'].includes(op) || !/^[a-f0-9-]{36}$/.test(clipId)) A.fail('invalid-argument', 'Invalid clip request.');
  const sender = op === 'send' ? uid : A.key(data.sender, 'sender');
  const bytes = op === 'send' ? videoBytes(data.video, data.mime) : null;
  const key = createHash('sha256').update(JSON.stringify([id,sender])).digest('hex');
  const clip = db.collection(collection).doc(key), table = db.doc('tables/' + id);
  let validation;
  return db.runTransaction(async tx => {
    const t = (await tx.get(table)).data();
    if (!t || t.authorityVersion !== 2 || t.type !== 'poker') A.fail('not-found','Table unavailable.');
    await A.member(tx, db, t.clubId, request);
    if (op === 'remove' && sender !== uid) await A.tableManager(tx, db, t.clubId, request);
    else if (op !== 'remove' && !t.players?.[uid]) A.fail('permission-denied','Take a seat to use table video.');
    const row = (await tx.get(clip)).data(), now = Date.now();
    const prev = row?.clubId===t.clubId && row.opened===(t.createdAt??null) ? row : null;
    if (op === 'send') {
      if (t.chatMuted || t.archived || t.tournament?.finished) A.fail('failed-precondition','Table video is closed.');
      if (prev?.clipId === clipId) return {ok:true};
      if (prev && now - prev.at < cooldownMs) A.fail('resource-exhausted','Wait 30 seconds between clips.');
      await (validation ||= validateVideo(bytes,data.mime));
      const entry = {uid, name:t.players[uid].name || 'Player', at:now, clipId, text:'Camera clip'};
      tx.set(clip, {clipId,clubId:t.clubId,opened:t.createdAt??null,mime:data.mime,bytes,at:now,expires:now+lifetimeMs});
      tx.update(table, {chat:[...(t.chat || []).slice(-59),entry]});
      return {ok:true};
    }
    if (!prev || prev.clipId !== clipId || prev.expires <= now || !prev.bytes)
      A.fail('not-found','This clip has expired.');
    if (op === 'get') return {mime:prev.mime, video:Buffer.from(prev.bytes).toString('base64'), remainingMs:prev.expires-now};
    tx.set(clip, {clipId,clubId:t.clubId,opened:t.createdAt??null,at:prev.at,expires:prev.expires});
    tx.update(table, {chat:(t.chat || []).filter(m => m.clipId !== clipId || m.uid !== sender)});
    return {ok:true};
  });
}

// At most one clip per seat. Conditional deletes preserve a replacement shared during cleanup.
async function cleanup(db, now) {
  const old = await db.collection(collection).where('expires','<=',now).limit(400).get();
  const writer = db.bulkWriter();
  const pending = old.docs.map(s => writer.delete(s.ref,{lastUpdateTime:s.updateTime}).catch(e => {
    if (![5,9].includes(e.code)) throw e;
  }));
  const results=Promise.allSettled(pending);
  await writer.close();
  const failed=(await results).find(r=>r.status==='rejected');
  if(failed)throw failed.reason;
}
exports.validateVideo = validateVideo;
exports.handle = handle;
exports.cleanup = cleanup;
exports.pkTableClip = onCall({region:'us-central1'}, r => handle(getFirestore(),r));
exports.pkExpireTableClips = onSchedule({schedule:'every 15 minutes',region:'us-central1'}, () => cleanup(getFirestore(),Date.now()));
