'use strict';
// Owner-triggered release check. No public diagnostic route, admin credentials,
// altered odds, or real money. Uses a fresh temporary anonymous play-chip pilot.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

if (!process.argv.includes('--confirm-play-money-production')) {
  throw new Error('Live verification requires --confirm-play-money-production');
}
const root = path.resolve(__dirname, '../..');
const config = fs.readFileSync(path.join(root, 'aviator-src/live/module.html'), 'utf8');
const key = config.match(/apiKey:\s*"([^"]+)"/)?.[1];
assert(key, 'Public Firebase client configuration is missing');
const base = 'https://us-central1-pokerten.cloudfunctions.net/';
const deadline = Date.now() + 240000;
const receipts = [], timings = [];
let idToken, uid;
const streamed=[],streamController=new AbortController();
let streamTask;
async function observeStream() {
  while (!streamController.signal.aborted && Date.now()<deadline) {
    const response=await fetch(base+'avStream',{headers:{Authorization:'Bearer '+idToken},signal:streamController.signal});
    assert.equal(response.status,200,'Authoritative stream is unavailable');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    try {
      while (!streamController.signal.aborted) {
        const {done,value}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();
        for(const line of lines)if(line){const packet=JSON.parse(line);streamed.push({...packet,receivedAt:Date.now()});}
      }
    } finally {await reader.cancel().catch(()=>{});}
  }
}
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
const requestId = () => randomUUID().replaceAll('-', '');

async function json(url, options = {}) {
  const response = await fetch(url, {...options, signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  if (!response.ok || body.error) {
    const status = body.error?.status || response.status;
    throw Object.assign(new Error('Live API request failed: ' + status), {status});
  }
  return body;
}
async function auth(operation, data) {
  return json('https://identitytoolkit.googleapis.com/v1/accounts:' + operation + '?key=' + key, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
}
async function call(name, data = {}) {
  const start = performance.now();
  const body = await json(base + name, {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + idToken},
    body:JSON.stringify({data})
  });
  const rtt = Math.round(performance.now() - start);
  timings.push({name, rtt});
  assert(body.result && typeof body.result === 'object', name + ' has no result');
  return {...body.result, measuredRtt:rtt};
}
async function ownDocument(collection, id) {
  const doc = await json('https://firestore.googleapis.com/v1/projects/pokerten/databases/(default)/documents/' + collection + '/' + id, {
    headers:{Authorization:'Bearer ' + idToken}
  });
  return Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k,
    'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue :
    'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : v.stringValue]));
}
async function tickUntil(predicate) {
  while (Date.now() < deadline) {
    const tick = await call('avTick');
    assert.equal(tick.state.protocol, 2, 'Live server has not activated timing protocol 2');
    const found = predicate(tick);
    if (found) return tick;
    await pause();
  }
  throw new Error('Timed out waiting for a verifiable live round');
}
async function place(autoAt, previousRound) {
  const tick = await tickUntil(r => r.state.phase === 'waiting' && r.state.roundId !== previousRound &&
    r.state.phaseAt + r.state.waitMs - r.serverNow > 1500);
  const roundId = tick.state.roundId;
  const before = (await ownDocument('aviatorPlayers', uid)).balance;
  const payload = {roundId, requestId:requestId(), amount:101, autoAt};
  await call('avBet', payload);
  await call('avBet', payload);
  assert.equal((await ownDocument('aviatorPlayers', uid)).balance, before - 101, 'Bet retry must debit once');
  return {roundId, before};
}
async function checkManual(previousRound) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const {roundId, before} = await place(null, previousRound);
    previousRound = roundId;
    const tick = await tickUntil(r => r.state.roundId !== roundId || r.state.phase === 'crashed' ||
      (r.state.phase === 'flying' && r.quote?.maxCents >= 101 && r.measuredRtt < 1500));
    if (tick.state.roundId !== roundId || tick.state.phase === 'crashed') continue;
    const seenCents = tick.quote.maxCents;
    const payload = {roundId, requestId:requestId(), seenCents, quote:tick.quote};
    let result;
    try { result = await call('avCashout', payload); }
    catch (error) {
      // A natural early crash can win the race to the function; never change it.
      if (error.status !== 'FAILED_PRECONDITION') throw error;
      await call('avTick');
      const bet = await ownDocument('aviatorBets', roundId + '_' + uid);
      if (bet.lost && !bet.cashedAt) continue;
      throw error;
    }
    const expected = Number(101n * BigInt(seenCents) / 100n);
    assert.equal(result.roundId, roundId);
    assert.equal(result.requestId, payload.requestId);
    assert.equal(result.auto, false);
    assert.equal(result.mult, seenCents / 100, 'Accepted manual price must equal the submitted price');
    assert.equal(result.win, expected, 'Whole-chip payout differs from integer pricing');
    const bet = await ownDocument('aviatorBets', roundId + '_' + uid);
    assert.equal(bet.cashedAt, result.mult);assert.equal(bet.win, expected);
    assert.equal((await ownDocument('aviatorPlayers', uid)).balance, before - 101 + expected);
    const retry = await call('avCashout', payload);
    assert.equal(retry.mult, result.mult);assert.equal(retry.win, expected);
    assert.equal((await ownDocument('aviatorPlayers', uid)).balance, before - 101 + expected, 'Cashout retry paid twice');
    receipts.push({kind:'manual', seenCents, paidCents:seenCents, chips:expected,
      cashoutRttMs:result.measuredRtt, serverProcessingMs:result.serverNow-result.serverReceivedAt,
      serverTiming:result.serverTiming,
      quoteRttMs:tick.measuredRtt, duplicateCredit:false});
    return roundId;
  }
  throw new Error('Four natural early crashes prevented manual verification');
}
async function checkAutomatic(previousRound) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const {roundId, before} = await place(1.2, previousRound);
    previousRound = roundId;
    // No avCashout call is sent: avTick advances the room, as other connected
    // players do. Settlement must enforce the stored target without our exit.
    await tickUntil(r => r.state.roundId !== roundId || r.state.phase === 'crashed');
    const bet = await ownDocument('aviatorBets', roundId + '_' + uid);
    const round = await ownDocument('aviatorRounds', roundId);
    if (round.crashPoint <= 1.2) {
      assert.equal(bet.lost, true);assert.equal(bet.cashedAt, null);
      assert.equal((await ownDocument('aviatorPlayers', uid)).balance, before-101);
      continue;
    }
    assert.equal(bet.auto, true);assert.equal(bet.cashedAt, 1.2);assert.equal(bet.win, 121);
    assert.equal((await ownDocument('aviatorPlayers', uid)).balance, before-101+121);
    receipts.push({kind:'automatic', targetCents:120, paidCents:120, chips:121, manualExitSent:false});
    return;
  }
  throw new Error('Four natural early crashes prevented automatic-target verification');
}
async function main() {
  try {
    const account = await auth('signUp', {returnSecureToken:true});
    idToken = account.idToken;uid = account.localId;
    assert(idToken && uid, 'Anonymous verification sign-in failed');
    await call('avJoin', {name:'AVIATOR release check'});
    streamTask=observeStream().catch(error=>{if(!streamController.signal.aborted)throw error;});
    streamTask.catch(()=>{});
    let manualRound;
    for (let sample = 0; sample < 3; sample++) manualRound = await checkManual(manualRound);
    await checkAutomatic(manualRound);
    const ticks = timings.filter(r=>r.name==='avTick').map(r=>r.rtt).sort((a,b)=>a-b);
    streamController.abort();await streamTask;
    const prices=streamed.filter(p=>p.quote),gaps=[];
    for(let i=1;i<prices.length;i++)if(prices[i].quote.roundId===prices[i-1].quote.roundId)
      gaps.push(prices[i].receivedAt-prices[i-1].receivedAt);
    gaps.sort((a,b)=>a-b);
    assert(prices.length>30,'Continuous price delivery was not observed');
    assert(gaps[Math.floor(gaps.length/2)]<150,'The stream is buffered or too slow');
    const stops=streamed.filter(p=>p.state?.phase==='crashed');
    assert(stops.length>0,'A live stop announcement was not observed');
    console.log(JSON.stringify({verification:'passed',
      stream:{pricePackets:prices.length,intervalMedianMs:gaps[Math.floor(gaps.length/2)],
        intervalP95Ms:gaps[Math.floor(gaps.length*.95)],
        stops:stops.map(p=>({roundId:p.state.roundId,crash:p.state.crashPoint,
          serverAnnouncementDelayMs:Math.round(p.serverNow-p.state.phaseAt)}))}, transport:'Firebase callable API',
      measurementOrigin:'GitHub Actions runner; not the player device', browserTested:false,
      receipts, tickSamples:ticks.length, tickMedianMs:ticks[Math.floor(ticks.length/2)],
      tickP95Ms:ticks[Math.min(ticks.length-1,Math.ceil(ticks.length*0.95)-1)]}, null, 2));
  } finally {
    streamController.abort();
    if (streamTask) await streamTask.catch(()=>{});
    if (idToken) {
      try { await auth('delete', {idToken}); }
      catch { console.warn('Temporary verification login cleanup failed; no credentials are printed.'); }
    }
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
