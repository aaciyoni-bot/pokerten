'use strict';
const {HttpsError}=require('firebase-functions/v2/https');

// The legacy URL stays available to installed apps. Both regions use the same
// action receipt in Firestore, so an uncertain response can be retried safely.
// Only pkAct is forwarded: do not reuse this for non-idempotent callables.
function createActionRouter({fetchImpl=globalThis.fetch, now=Date.now,
  projectId=process.env.GCLOUD_PROJECT||'pokerten',
  emulator=!!(process.env.FIRESTORE_EMULATOR_HOST||process.env.FUNCTIONS_EMULATOR),
  timeoutMs=8000, report=entry=>console.info('POKER_ACTION_ROUTE',entry)}={}) {
  let retryEuropeAt=0;
  return async function route(request,localAction) {
    const authorization=request.rawRequest?.headers?.authorization;
    const requestId=request.data?.requestId;
    if(emulator||!request.auth?.uid||typeof authorization!=='string'||!authorization.startsWith('Bearer ')||
       typeof requestId!=='string'||requestId.length<16||now()<retryEuropeAt)return localAction(request);
    const started=now(),headers={'Content-Type':'application/json',Authorization:authorization};
    const appCheck=request.rawRequest.headers['x-firebase-appcheck'];
    if(typeof appCheck==='string')headers['X-Firebase-AppCheck']=appCheck;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    let result;
    try {
      const response=await fetchImpl(`https://europe-west1-${projectId}.cloudfunctions.net/pkActEurope`,{
        method:'POST',headers,body:JSON.stringify({data:request.data}),signal:controller.signal,redirect:'error'
      });
      result=await response.json();
      if(result?.error) {
        const code=String(result.error.status||'INTERNAL').toLowerCase().replaceAll('_','-');
        const error=new HttpsError(code,result.error.message||'Action failed',result.error.details);
        if(!['unavailable','deadline-exceeded','internal'].includes(code)) {
          error.regionalActionRejected=true;
          throw error;
        }
        throw error;
      }
      if(!response.ok||!result?.result||result.result.ok!==true||result.result.tableId!==request.data.tableId||!result.result.tableUpdate)throw new Error('Regional action response unavailable');
    } catch(error) {
      if(error.regionalActionRejected)throw error;
      // No second request ID and no optimistic balance changes. If Europe
      // already committed, the local handler returns its existing receipt.
      retryEuropeAt=now()+30000;
      report({route:'local-fallback',elapsedMs:now()-started});
      return localAction(request);
    } finally {clearTimeout(timer);}
    report({route:'europe',elapsedMs:now()-started});
    return result.result;
  };
}
module.exports={createActionRouter};
