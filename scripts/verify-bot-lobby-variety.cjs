'use strict';
// Read-only release observation. It never creates tables, changes club settings,
// reads credentials, or publishes raw production logs.
const {spawnSync}=require('node:child_process');
const release='bot-lobby-netabel-texas-2026-09-27';
const marker='BOT_LOBBY_VARIETY_STATUS ';
const expected=new Map([
 ['main-0',['Omaha 6',.5,50]],['main-1',['Omaha 6',1,100]],['main-2',['Omaha 6',2,200]],
 ['nlh-0',['NLH',.5,50]],['nlh-1',['NLH',1,100]],['nlh-2',['NLH',2,200]],
 ['omaha4-4max',['Omaha 4',.5,50]],['omaha5-4max',['Omaha 5',.5,50]],['pineapple-4max',['Pineapple',.5,50]]
]);
const reasons=new Set(['not-unique','disabled-or-unconfigured','no-cash-template','bootstrap-insufficient-existing-funds','maintenance-failed']);
const games=new Set([...expected.values()].map(row=>row[0]));
const stripAnsi=text=>String(text||'').replace(/\u001b\[[0-9;]*m/g,'');
const finite=value=>Number.isFinite(value)?value:0;

// CLI prints textPayload or JSON.stringify(jsonPayload) after a timestamp and
// name prefix. Unwrap structured messages before looking for the status marker.
function cliMessage(line){
 const clean=stripAnsi(line).trim();
 const match=clean.match(/^(\d{4}-\d\d-\d\dT\S+)\s+\S\s+[^:]+:\s*(.*)$/);
 let message=match?match[2]:clean;
 const timestamp=match?Date.parse(match[1]):NaN;
 for(let depth=0;depth<4;depth++){
  try{
   const value=JSON.parse(message);
   const nested=typeof value==='string'?value:value?.textPayload??value?.jsonPayload?.message??value?.message;
   if(typeof nested!=='string')break;
   message=nested;
  }catch{break;}
 }
 return{message:stripAnsi(message),timestamp};
}
function safeObservation(row){
 if(!row||row.release!==release||!Number.isFinite(row.at))return null;
 if(row.reason!==undefined&&!reasons.has(row.reason))return null;
 if(!row.reason&&!Array.isArray(row.coverage)&&row.disabled!==true)return null;
 const coverage=new Map();
 for(const item of Array.isArray(row.coverage)?row.coverage:[]){
  if(!item||!expected.has(item.slotId))continue;
  // Only these aggregate fields may leave the captured production-log buffer.
  coverage.set(item.slotId,{
   slotId:item.slotId,...(item.missing===true?{missing:true}:{}),
   game:games.has(item.game)?item.game:'unknown',smallBlind:finite(item.smallBlind),minBuyIn:finite(item.minBuyIn),
   seated:finite(item.seated),playable:finite(item.playable),closing:item.closing===true,
   matchesSettings:item.matchesSettings===true,humanCount:finite(item.humanCount)
  });
 }
 return{at:row.at,release,coverage:[...coverage.values()],fundingBlocked:row.fundingBlocked===true,disabled:row.disabled===true,...(row.reason?{reason:row.reason}:{})};
}
function scanLogOutput(stdout,{minAt,now=Date.now()}){
 let latest=null;
 const diagnostics={logEntries:0,freshLogEntries:0,statusMarkers:0,parseFailures:0,staleStatusMarkers:0,latestLogAt:null};
 for(const line of String(stdout||'').split('\n')){
  const {message,timestamp}=cliMessage(line);
  if(Number.isFinite(timestamp)){
   diagnostics.logEntries++;
   if(timestamp>=minAt)diagnostics.freshLogEntries++;
   diagnostics.latestLogAt=Math.max(diagnostics.latestLogAt||0,timestamp);
  }
  const at=message.indexOf(marker);if(at<0)continue;
  diagnostics.statusMarkers++;
  let row;
  try{row=safeObservation(JSON.parse(message.slice(at+marker.length).trim()));}catch{}
  if(!row){diagnostics.parseFailures++;continue;}
  if(row.at<minAt||row.at>now+60000){diagnostics.staleStatusMarkers++;continue;}
  if(!latest||row.at>=latest.at)latest=row;
 }
 return{latest,diagnostics};
}
function summary(row){
 if(row.reason){
  const state=row.reason==='bootstrap-insufficient-existing-funds'?'funding-blocked':row.reason==='maintenance-failed'?'unavailable':'configuration-blocked';
  return{state,at:row.at,reason:row.reason};
 }
 const coverage=row.coverage;
 const ready=coverage.filter(item=>{const e=expected.get(item.slotId);return e&&!item.closing&&item.matchesSettings&&item.playable>=2&&item.game===e[0]&&item.smallBlind===e[1]&&item.minBuyIn===e[2];});
 const state=row.disabled?'disabled':ready.length===expected.size?'ready':row.fundingBlocked?'funding-blocked':'pending';
 return{state,at:row.at,readySlots:ready.length,expectedSlots:expected.size,missingSlots:[...expected.keys()].filter(id=>!ready.some(item=>item.slotId===id)),coverage};
}
async function main(){
 const started=Date.now(),deadline=started+150000;let latest=null,diagnostics={};
 const report=value=>console.log('BOT_LOBBY_LIVE_CHECK '+JSON.stringify(value));
 while(Date.now()<deadline){
  const result=spawnSync('firebase',['functions:log','--only','tableAutoDrive','--lines','120','--project','pokerten','--non-interactive'],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
  if(result.status!==0){report({state:'unavailable',reason:'Scheduler logs could not be read. Deployment is unaffected.'});return;}
  const observed=scanLogOutput(result.stdout,{minAt:started-120000});diagnostics=observed.diagnostics;
  if(observed.latest&&(!latest||observed.latest.at>=latest.at))latest=observed.latest;
  if(latest){
   const status=summary(latest);report({...status,diagnostics});
   if(status.state!=='pending')return;
  }
  await new Promise(resolve=>setTimeout(resolve,20000));
 }
 if(latest)report({...summary(latest),reason:'Remaining tables are waiting for safe rotation.',diagnostics});
 else report({state:'pending',reason:'No fresh scheduler observation yet. Deployment is unaffected.',diagnostics});
}
if(require.main===module)main().catch(()=>console.log('BOT_LOBBY_LIVE_CHECK '+JSON.stringify({state:'unavailable',reason:'Read-only observation failed. Deployment is unaffected.'})));
module.exports={cliMessage,safeObservation,scanLogOutput,summary};
