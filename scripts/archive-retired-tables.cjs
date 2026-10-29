'use strict';
// Bounded repair of the reviewed pre-authority records. No wallet, gameLog,
// settlement journal, tournament or cycle writes. The shared transaction keeps
// each original table and private document before removing the live blocker.
const Legacy=require('../functions/pokerLegacyTables');
const PROJECT='pokerten',CLUB='1A1WtR98JoD6wZ9wT5Pf';
const IDS=['5z0ho6gofGQ3EuDXgTqV','8fjGCCtpkf7N4kNO4aSY','D6FFDPGWaOQifPX8rDme','GsvZDCAu0ocjqZquIxee','JDRmKnH4mZriSLcsDiM3','LI0OTAaRQsGQWlO6A30U','MkhEaH6EtWgENbDdnlUQ','NAk0mtyXhSnyiuDKWJ4J','NwMWPaPoUXkSqOwgan8B','TfXTxrxswOvJSR9JQJPa','XyjVsgnRbTdcUGBZOYpq','iNHOBJcYpDDdcqjdh3LA','uoeqEh8IxbiMU9zlnfTP'];
async function repair(db,{apply=false,now=Date.now()}={}){
 const club=await db.doc('clubs/'+CLUB).get();if(!club.exists)throw Error('Reviewed club missing');
 const snaps=await db.getAll(...IDS.map(id=>db.doc('tables/'+id)));
 // Validate every target before the first archive; changes are rechecked inside
 // each transaction. Reruns accept only our intact original archives.
 for(const snap of snaps){
  if(snap.exists){if(snap.data().clubId!==CLUB||!Legacy.archiveReason(snap.data(),now))throw Error('A reviewed table changed; stop for accounting review: '+snap.id);}
  else{const archive=await db.doc('_pkClosedTables/'+snap.id).get();if(!archive.exists||archive.data().clubId!==CLUB||archive.data().legacyArchive?.version!==1)throw Error('Missing reviewed table and verified archive: '+snap.id);}
 }
 if(!apply)return{reviewed:IDS.length,eligible:snaps.filter(s=>s.exists).length,applied:false};
 for(const initial of snaps)await db.runTransaction(async tx=>{
  const snap=await tx.get(initial.ref);if(!snap.exists)return;
  if(snap.data().clubId!==CLUB)throw Error('Reviewed club changed');
  await Legacy.archiveTable(tx,db,snap.ref,snap.data(),'repair-retired-tables-2026-10-29',now);
 });
 const live=await db.collection('tables').where('clubId','==',CLUB).get();
 const remaining=live.docs.filter(d=>d.data().authorityVersion!==2);
 for(const id of IDS){const archive=await db.doc('_pkClosedTables/'+id).get();if(!archive.exists||archive.data().legacyArchive?.moneyEffects!==0)throw Error('Archive verification failed');}
 if(remaining.length)throw Error('Other legacy tables still need accounting review; count='+remaining.length);
 return{reviewed:IDS.length,archived:IDS.length,legacyRemaining:0,applied:true,moneyEffects:0,cycleChanged:false};
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.FIREBASE_TOKEN)throw Error('Run through the authorized deployment workflow');
 const {getAccessToken}=require('firebase-tools/lib/auth');
 const {Firestore}=require('../functions/node_modules/@google-cloud/firestore');
 const {OAuth2Client}=require('../functions/node_modules/google-auth-library');
 const token=await getAccessToken(process.env.FIREBASE_TOKEN,['https://www.googleapis.com/auth/cloud-platform']);
 if(!token.access_token)throw Error('Deployment authentication failed');
 const authClient=new OAuth2Client();authClient.setCredentials({access_token:token.access_token});
 // Firestore's Admin wrapper only accepts certificate/ADC credentials. Pass the
 // existing deployment OAuth credential directly to the Google Cloud client.
 // It stays in memory and is never written to disk or printed.
 const db=new Firestore({projectId:PROJECT,databaseId:'(default)',authClient});
 try{console.log('LEGACY_TABLE_REPAIR '+JSON.stringify(await repair(db,{apply:process.argv.includes('--apply')})));}finally{await db.terminate();}
}
module.exports={repair,IDS,CLUB};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
