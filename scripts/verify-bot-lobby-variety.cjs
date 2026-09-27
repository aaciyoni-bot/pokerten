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
async function main(){
 const started=Date.now(),deadline=started+150000;let latest=null;
 while(Date.now()<deadline){
  const result=spawnSync('firebase',['functions:log','--only','tableAutoDrive','--lines','60','--project','pokerten','--non-interactive'],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
  if(result.status!==0){
   console.log('BOT_LOBBY_LIVE_CHECK '+JSON.stringify({state:'unavailable',reason:'Scheduler logs could not be read. Deployment is unaffected.'}));return;
  }
  for(const line of (result.stdout||'').split('\n')){
   const at=line.indexOf(marker);if(at<0)continue;
   try{
    const payload=line.slice(at+marker.length).replace(/\u001b\[[0-9;]*m/g,'').trim();
    const row=JSON.parse(payload);
    if(row.release===release&&Number.isFinite(row.at)&&row.at>=started-120000&&(!latest||row.at>latest.at))latest=row;
   }catch{}
  }
  if(latest){
   const coverage=Array.isArray(latest.coverage)?latest.coverage:[];
   const ready=coverage.filter(row=>{const e=expected.get(row.slotId);return e&&!row.closing&&row.matchesSettings&&row.playable>=2&&row.game===e[0]&&row.smallBlind===e[1]&&row.minBuyIn===e[2];});
   const state=latest.disabled?'disabled':ready.length===expected.size?'ready':latest.fundingBlocked?'funding-blocked':'pending';
   console.log('BOT_LOBBY_LIVE_CHECK '+JSON.stringify({state,at:latest.at,readySlots:ready.length,expectedSlots:expected.size,missingSlots:[...expected.keys()].filter(id=>!ready.some(row=>row.slotId===id)),coverage}));
   if(state!=='pending')return;
  }
  await new Promise(resolve=>setTimeout(resolve,20000));
 }
 console.log('BOT_LOBBY_LIVE_CHECK '+JSON.stringify({state:'pending',reason:latest?'Remaining tables are waiting for safe rotation.':'No fresh scheduler observation yet. Deployment is unaffected.'}));
}
main().catch(()=>{console.log('BOT_LOBBY_LIVE_CHECK '+JSON.stringify({state:'unavailable',reason:'Read-only observation failed. Deployment is unaffected.'}));});
