'use strict';
const {execFileSync,spawnSync}=require('node:child_process');

const project='pokerten', secret='POKERTEN_GOD_ACCOUNTS';
const baseArgs=['--project',project,'--non-interactive','--json'];
const metadata=spawnSync('firebase',['functions:secrets:get',secret,...baseArgs],{encoding:'utf8'});
if(metadata.error)throw metadata.error;
if(metadata.status===0){
  const versions=JSON.parse(metadata.stdout).result?.secrets;
  if(!Array.isArray(versions)||!versions.some(v=>v.state==='ENABLED'))throw Error('Existing access secret has no enabled version');
  console.log('Existing access secret is configured.');
} else {
  const error=metadata.stdout+' '+metadata.stderr;
  if(!/HTTP Error: 404|HTTP 404|NOT_FOUND|Secret [^\n]+ not found/i.test(error))throw Error('Cannot check access secret metadata');
  // Import the previously deployed verified accounts only on the first migration.
  // The pinned object is the release before the list was removed. Never log its contents.
  const deployed='773e2ac47013172bcfdb972692667844ad27cf0b';
  const file=name=>execFileSync('git',['show',deployed+':functions/'+name],{encoding:'utf8'});
  const poker=file('pokerEngine.js').match(/^const GOD_EMAILS = (\[[^\n]+\]);$/m);
  const cards=file('cardGames.js').match(/const allowed=(\[[^\n;]+\]);/);
  if(!poker||!cards)throw Error('Missing legacy access configuration');
  const accounts=JSON.parse(poker[1]),other=JSON.parse(cards[1].replace(/'/g,'"'));
  if(!Array.isArray(accounts)||accounts.length!==7||new Set(accounts).size!==7||
     accounts.some(email=>typeof email!=='string'||!email.includes('@')||email!==email.trim().toLowerCase())||
     JSON.stringify([...accounts].sort())!==JSON.stringify(other.sort()))throw Error('Unexpected legacy access configuration');
  const saved=spawnSync('firebase',['functions:secrets:set',secret,'--data-file','-',...baseArgs],{input:JSON.stringify(accounts),stdio:['pipe','ignore','ignore']});
  if(saved.error||saved.status!==0)throw Error('Could not provision the private access secret');
  console.log('Initialized the private access secret.');
}
