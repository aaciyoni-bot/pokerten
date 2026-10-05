'use strict';
const Core = require('./aviatorCore');

// One trusted room snapshot per warm instance, not a database read per frame
// or per pilot. A round is immutable until its next phase boundary.
module.exports = function createFlightStream({db, verifyIdToken, advance,
  now=Date.now, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)), duration=55000}) {
  let room, loading, advancing, retryAt=0;
  async function refresh() {
    if (!loading) loading = db.getAll(db.doc('aviator/state'), db.doc('aviator/_engine'))
      .then(([s,e])=>{ room=s.exists && e.exists ? {state:s.data(),engine:e.data()} : null; })
      .finally(()=>{loading=null;});
    await loading;
  }
  function advanceRoom(uid) {
    if (advancing || now()<retryAt) return;
    advancing = advance(uid).then(refresh).catch(()=>{retryAt=now()+500;})
      .finally(()=>{advancing=null;});
  }
  return async function stream(req,res) {
    if (req.method !== 'GET') { res.status(405).end(); return; }
    let pilot;
    try {
      const match=/^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!match) throw Error('missing token');
      pilot=await verifyIdToken(match[1]);
      if (!pilot.uid) throw Error('missing uid');
    } catch { res.status(401).end(); return; }
    let closed=false;
    res.on('close',()=>{closed=true;});
    res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-transform');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders();
    const endAt=now()+duration;
    let stateKey='';
    try {
      if (!room) await refresh();
      while (!closed && now()<endAt) {
        const time=now();
        const packet=room && Core.flightPacket(room.state,room.engine,pilot.uid,time);
        if (!packet) { advanceRoom(pilot.uid); await pause(100); continue; }
        const s=packet.state;
        const key=s.roundId+':'+s.phase;
        // Crash is transmitted BEFORE Firestore settlement, never after it.
        // Backpressure closes this stream instead of queueing obsolete prices.
        const message={serverNow:packet.serverNow,quote:packet.quote};
        if (key !== stateKey) {message.state=s;stateKey=key;}
        if (!res.write(JSON.stringify(message)+'\n')) break;
        if (s.phase !== room.state.phase ||
            (s.phase==='crashed' && time>=s.phaseAt+s.crashHold)) advanceRoom(pilot.uid);
        // Wake at the actual phase deadline, not at the next 50/100 ms slot.
        // The crash deadline stays entirely on the server.
        const boundary=s.phase==='waiting' ? s.phaseAt+s.waitMs :
          s.phase==='flying' ? s.phaseAt+Core.timeForMult(room.engine.crashPoint) : Infinity;
        await pause(Math.max(1,Math.min(s.phase==='flying'?50:100,Math.ceil(boundary-now()))));
      }
    } catch { /* Disconnect: the client freezes and reconnects with backoff. */ }
    finally {
      // Keep the invocation alive until pending durable work completes.
      if (advancing) await advancing;
      res.end();
    }
  };
};
