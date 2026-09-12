/* Continuous, authenticated server prices. No clock-based price prediction. */
let streamController=null, streamLastAt=0, streamRetryAt=0, streamFailures=0;
let lastPaintAt=0;
function streamFresh(){ return streamLastAt && performance.now()-streamLastAt<600; }
function paintConfirmedPrice(){
  if (S.phase !== 'flying') return;
  renderFlightValue();
  const text=S.mult.toFixed(2)+'x';
  if ($('#mult').textContent!==text) $('#mult').textContent=text;
  const amount=$('#cashAmt');
  if (amount && myBet && !myBet.cashedAt)
    amount.textContent=text+' · '+fmt(chipPayout(myBet.amount,S.cents))+' chips';
  // Keep graph and readout together when animation frames are throttled.
  if (performance.now()-lastPaintAt>80) { draw(eNow()); lastPaintAt=performance.now(); }
}
function receiveFlightPacket(packet){
  if (packet.state) applyState(packet.state);
  streamLastAt=performance.now(); streamFailures=0;
  if (packet.quote) acceptQuote(packet.quote, Math.max(0,eNow()-packet.quote.issuedAt));
  paintConfirmedPrice(); updateSyncStatus();
}
async function connectFlightStream(){
  if (!joined || !user || streamController || navigator.onLine===false ||
      document.visibilityState!=='visible' || performance.now()<streamRetryAt) return;
  const controller=new AbortController(); streamController=controller;
  let reader;
  const started=performance.now();
  try {
    const token=await user.getIdToken();
    if (controller.signal.aborted) return;
    const response=await fetch('https://us-central1-pokerten.cloudfunctions.net/avStream', {
      headers:{Authorization:'Bearer '+token}, signal:controller.signal, cache:'no-store'
    });
    if (!response.ok || !response.body) throw Error('Flight stream unavailable');
    reader=response.body.getReader();
    const decoder=new TextDecoder(); let buffer='';
    while (!controller.signal.aborted) {
      const {done,value}=await reader.read(); if (done) break;
      buffer+=decoder.decode(value,{stream:true});
      if (buffer.length>65536) throw Error('Flight stream packet too large');
      const lines=buffer.split('\n'); buffer=lines.pop();
      for (const line of lines) if (line.trim()) receiveFlightPacket(JSON.parse(line));
    }
  } catch { /* Poll fallback remains available during reconnection. */ }
  finally {
    if (reader) await reader.cancel().catch(()=>{});
    if (streamController===controller) streamController=null;
    streamLastAt=0;
    const lived=performance.now()-started;
    streamFailures=lived>5000?0:streamFailures+1;
    streamRetryAt=performance.now()+Math.min(5000,250*2**streamFailures);
  }
}
function stopFlightStream(){
  if (streamController) streamController.abort();
  streamLastAt=0;
}
// Networking must never depend on requestAnimationFrame or expensive graphics.
setInterval(()=>{
  if (document.visibilityState!=='visible' || navigator.onLine===false) return;
  if (streamLastAt && performance.now()-streamLastAt>1200) stopFlightStream();
  connectFlightStream();
  if (!streamFresh()) maybeTick();
  updateSyncStatus();
},100);
addEventListener('offline',stopFlightStream);
document.addEventListener('visibilitychange',()=>{
  if (document.visibilityState!=='visible') stopFlightStream();
  else { streamRetryAt=0; connectFlightStream(); }
});
