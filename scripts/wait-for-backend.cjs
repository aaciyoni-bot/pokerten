'use strict';
// Hosting may expose new controls only after the matching backend has deployed.
const fs=require('node:fs');
async function main(){
 const repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA,token=process.env.GITHUB_TOKEN;
 if(!repo||!sha||!token)throw Error('GitHub workflow metadata is missing');
 const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 const get=async path=>{const r=await fetch('https://api.github.com/repos/'+repo+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!r.ok)throw Error('GitHub deployment lookup failed: '+r.status);return r.json();};
 const base=event.before&&!/^0+$/.test(event.before)?event.before:sha+'^';
 const diff=await get('/compare/'+encodeURIComponent(base)+'...'+sha),files=diff.files||[];
 if(files.length>=300)throw Error('Release diff is too large to verify backend dependencies');
 const required=[];
 if(files.some(f=>/^functions\//.test(f.filename)&&!/^functions\/(?:aviator|test\/aviator)/.test(f.filename)||f.filename==='.github/workflows/deploy-functions.yml'||['firebase.json','.firebaserc'].includes(f.filename)))required.push('Deploy Firebase Functions');
 if(files.some(f=>['firestore.rules','firebase.json'].includes(f.filename)))required.push('Deploy Firestore Rules');
 const deadline=Date.now()+12*60000;
 while(required.length){
  const {workflow_runs:runs}=await get('/actions/runs?head_sha='+sha+'&event=push&per_page=100');
  const done=required.every(name=>{const r=runs.filter(r=>r.name===name).sort((a,b)=>b.id-a.id)[0];if(r?.status==='completed'&&r.conclusion!=='success')throw Error(name+' did not deploy successfully');return r?.conclusion==='success';});
  if(done)break;if(Date.now()>deadline)throw Error('Matching backend deployment did not finish in time');
  console.log('Waiting for matching backend: '+required.join(', '));await new Promise(r=>setTimeout(r,10000));
 }
 console.log('Backend deployment dependencies verified for '+sha);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
