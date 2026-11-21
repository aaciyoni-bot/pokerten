'use strict';
const {project}=require('../functions/tournamentPublicView');
const {isDeepStrictEqual}=require('node:util');

// Projection only: never alter the source tournament, seats, balances or logs.
// Each snapshot is re-read transactionally so a concurrent registration or
// payout cannot be replaced by an older projection from the scan.
async function backfill(db,{pageSize=100}={}){
 let cursor=null,scanned=0,written=0;
 for(;;){
  let query=db.collection('tournaments').where('authorityVersion','==',2).orderBy('__name__').limit(pageSize);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  for(const source of page.docs){
   scanned++;
   const changed=await db.runTransaction(async tx=>{
    const live=await tx.get(source.ref);
    if(!live.exists||live.data().authorityVersion!==2||live.data().game!=='poker')return false;
    const viewRef=db.doc('tournamentViews/'+live.id),old=await tx.get(viewRef),next=project(live.data());
    if(old.exists&&isDeepStrictEqual(old.data(),next))return false;
    tx.set(viewRef,next);return true;
   });
   if(changed)written++;
  }
  if(page.docs.length<pageSize)break;
  cursor=page.docs.at(-1).id;
 }
 return{scanned,written,sourceWrites:0,balanceWrites:0};
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.FIREBASE_TOKEN)throw Error('Run through the authorized deployment workflow');
 const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
 const cliRequire=createRequire(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()+'/firebase-tools/package.json');
 const {getAccessToken}=cliRequire('./lib/auth');
 const {Firestore}=require('../functions/node_modules/@google-cloud/firestore');
 const {OAuth2Client}=require('../functions/node_modules/google-auth-library');
 const token=await getAccessToken(process.env.FIREBASE_TOKEN,['https://www.googleapis.com/auth/cloud-platform']);
 if(!token.access_token)throw Error('Deployment authentication failed');
 const authClient=new OAuth2Client();authClient.setCredentials({access_token:token.access_token});
 const db=new Firestore({projectId:'pokerten',databaseId:'(default)',authClient});
 try{
  console.log('TOURNAMENT_VIEW_BACKFILL '+JSON.stringify(await backfill(db)));
  console.log('TABLE_LOBBY_BACKFILL '+JSON.stringify(await require('../functions/tableLobbyView').backfill(db)));
 }finally{await db.terminate();}
}
module.exports={backfill};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
