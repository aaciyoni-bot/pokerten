'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {scanLogOutput,summary}=require('./verify-bot-lobby-variety.cjs');
const now=Date.parse('2026-09-27T11:20:00.000Z'),release='bot-lobby-netabel-texas-2026-09-27';
const row={at:now,release,coverage:[{slotId:'main-0',game:'Omaha 6',smallBlind:.5,minBuyIn:50,seated:6,playable:6,matchesSettings:true,closing:false,humanCount:0}]};
const message=value=>'BOT_LOBBY_VARIETY_STATUS '+JSON.stringify(value);
const line=text=>'2026-09-27T11:20:00.000000Z I tableautodrive: '+text;
const scan=text=>scanLogOutput(text,{minAt:now-120000,now});

test('reads plain timestamped CLI messages among multiple unrelated lines',()=>{
 const found=scan(line('Ordinary scheduler line')+'\n'+line(message(row))+'\n');
 assert.equal(found.latest.at,now);assert.equal(found.diagnostics.logEntries,2);
 assert.equal(found.diagnostics.statusMarkers,1);assert.equal(found.diagnostics.parseFailures,0);
 assert.equal(summary(found.latest).readySlots,1);
});
test('unwraps structured CLI jsonPayload message instead of parsing escaped inner JSON',()=>{
 for(const payload of [{severity:'INFO',message:message(row)},{jsonPayload:{message:message(row)}},{textPayload:message(row)},JSON.stringify(message(row))]){
  const found=scan(line(JSON.stringify(payload)));
  assert.equal(found.latest.at,now);assert.equal(found.diagnostics.parseFailures,0);
 }
});
test('ignores stale status and rejects a different release without retaining log content',()=>{
 const found=scan(line(message({...row,at:now-120001}))+'\n'+line(message({...row,release:'previous-release'})));
 assert.equal(found.latest,null);assert.equal(found.diagnostics.staleStatusMarkers,1);assert.equal(found.diagnostics.parseFailures,1);
 assert.equal(JSON.stringify(found).includes('previous-release'),false);
});
test('accepts ANSI around prefixes and messages and selects the newest valid status',()=>{
 const found=scan('\u001b[32m'+line(message({...row,at:now-1}))+'\u001b[0m\n'+line('\u001b[36m'+message(row)+'\u001b[0m'));
 assert.equal(found.latest.at,now);assert.equal(found.diagnostics.statusMarkers,2);
});
test('reports only explicit whitelisted scheduler skip and failure reasons',()=>{
 for(const reason of ['not-unique','disabled-or-unconfigured','no-cash-template','bootstrap-insufficient-existing-funds','maintenance-failed']){
  const found=scan(line(message({at:now,release,reason,uid:'PRIVATE',error:'PRIVATE'})));
  assert.equal(summary(found.latest).reason,reason);assert.equal(JSON.stringify(found).includes('PRIVATE'),false);
 }
 const found=scan(line(message({at:now,release,reason:'PRIVATE-ERROR'})));
 assert.equal(found.latest,null);assert.equal(found.diagnostics.parseFailures,1);assert.equal(JSON.stringify(found).includes('PRIVATE-ERROR'),false);
});
test('whitelists coverage fields, rejects unknown slot identifiers and deduplicates ready counts',()=>{
 const item={...row.coverage[0],token:'PRIVATE',playerNames:['PRIVATE']};
 const found=scan(line(message({...row,ownerUid:'PRIVATE',coverage:[item,item,{...item,slotId:'PRIVATE'}]})));
 const result=summary(found.latest);
 assert.equal(result.readySlots,1);assert.equal(result.coverage.length,1);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('funded playable players, not occupied busted seats, determine readiness',()=>{
 const found=scan(line(message({...row,coverage:[{...row.coverage[0],playable:1}]})));
 assert.equal(summary(found.latest).readySlots,0);assert.equal(summary(found.latest).state,'pending');
});
test('distinguishes fresh scheduler logs without markers from malformed status payloads',()=>{
 const found=scan(line('Routine invocation')+'\n'+line('BOT_LOBBY_VARIETY_STATUS PRIVATE-MALFORMED'));
 assert.equal(found.latest,null);assert.equal(found.diagnostics.freshLogEntries,2);assert.equal(found.diagnostics.statusMarkers,1);
 assert.equal(found.diagnostics.parseFailures,1);assert.equal(JSON.stringify(found).includes('PRIVATE-MALFORMED'),false);
});
