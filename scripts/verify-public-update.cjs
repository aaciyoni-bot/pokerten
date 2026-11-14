'use strict';
// Read-only delivery check: validate the public website and the exact OTA archive.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const version=require('../assets/release.json').version;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function read(url){
  const response=await fetch(url+(url.includes('?')?'&':'?')+'verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('Public update request failed: '+response.status+' '+url);
  return Buffer.from(await response.arrayBuffer());
}
async function verify(){
  for(const origin of ['https://pokerten.com','https://pokerten.web.app']){
    for(const file of ['assets/release.json','assets/js/app-update.js','index.html']){
      if(sha(await read(origin+'/'+file))!==sha(fs.readFileSync(path.join(__dirname,'..',file))))throw Error('Public file does not match this release: '+origin+'/'+file);
    }
    console.log('Verified web v'+version+' at '+origin);
  }
  const manifest=JSON.parse(await read('https://pokerten.com/mobile-updates/android-13/latest.json'));
  const url=new URL(manifest.url);
  if(manifest.runtime!=='android-13'||!manifest.version.startsWith('0.'+version+'.')||
    !Number.isSafeInteger(manifest.size)||manifest.size<=0||manifest.size>50000000||
    !/^[a-f0-9]{64}$/.test(manifest.checksum)||url.origin!=='https://pokerten.com'||
    !url.pathname.startsWith('/mobile-updates/android-13/')||!url.pathname.endsWith('.zip')||url.username||url.password||url.search||url.hash)throw Error('Unexpected Android update manifest');
  const zip=await read(url.href);
  if(zip.length!==manifest.size||sha(zip)!==manifest.checksum)throw Error('Published Android archive checksum or size mismatch');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pokerten-public-update-'));
  try{
    const file=path.join(dir,'update.zip');fs.writeFileSync(file,zip);
    const entry=name=>execFileSync('unzip',['-p',file,name],{encoding:'utf8',maxBuffer:4000000});
    const html=entry('index.html'),updater=entry('assets/js/native-update.js');
    if(!html.includes('<meta name="app-version" content="'+version+'">')||
      !html.includes('assets/js/native-update.js?v='+version)||!updater.includes('getDocFromServer')||
      !updater.includes('Starting the updated game'))throw Error('Published Android client is missing the update-button fix');
    console.log('Verified Android '+manifest.version+', checksum, native updater and game version');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  for(let attempt=0;attempt<4;attempt++){
    try{await verify();return;}catch(error){if(attempt===3)throw error;console.log('Waiting for public delivery: '+error.message);await new Promise(resolve=>setTimeout(resolve,15000));}
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
