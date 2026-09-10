"use strict";
// Local-only browser fixture. Uses the real handlers with in-memory Firestore.
// Run: node functions/test/preview.js, then open http://terminal.local:4173/.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {setup} = require('./aviatorFixture');
const Core = require('../aviatorCore');
const root = path.resolve(__dirname, '../..');
let room, offset = 0, sequence = 0, delayed = false, offline = false;
function reset(){
  offset=0; room=setup({phase:'waiting',phaseAt:Date.now(),time:Date.now(),crash:2.4,roundId:'r'+(++sequence)});
  room.data.delete('aviatorBets/r'+sequence+'_u1');
  room.data.get('aviatorPlayers/u1').balance=10000;
  Object.assign(room.data.get('aviator/state'),{protocol:2,waitMs:60000});
}
reset();
const bridge=`<script type="module">
const watchers = new Set();
let latest = {};
const snapshot = target => target.kind==='doc' ? {
  exists:()=>!!latest[target.path], data:()=>latest[target.path]
} : {docs:Object.entries(latest).filter(([key,val])=>key.startsWith(target.path+'/') &&
  (!target.filter || val[target.filter.key]===target.filter.value)).map(([key,val])=>({id:key.split('/').pop(),data:()=>val})),
  forEach(fn){ this.docs.forEach(fn); }};
const refresh = async () => {
  const r=await fetch('/fixture');latest=await r.json();
  for(const watcher of watchers){const snap=snapshot(watcher.target);const key=JSON.stringify(snap.docs?snap.docs.map(x=>x.data()):snap.data());
    if(key!==watcher.key){watcher.key=key;watcher.callback(snap);}}
};
window.avFB={auth:{},db:{},onAuthStateChanged:(_,fn)=>fn({uid:'u1',displayName:'Test Pilot'}),signInAnonymously:async()=>{},
  doc:(_,path)=>({kind:'doc',path}),collection:(_,path)=>({kind:'query',path}),
  where:(key,op,value)=>({key,value}),orderBy:()=>null,limit:()=>null,
  query:(base,...args)=>({...base,filter:args.find(x=>x&&x.key)}),
  onSnapshot:(target,callback)=>{const w={target,callback};watchers.add(w);refresh();return()=>watchers.delete(w);},
  getDocs:async target=>{await refresh();return snapshot(target);},
  fx:async(name,data)=>{const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await r.json();if(name==='avCashout'){document.getElementById('qaReceipt').textContent=JSON.stringify({sent:data.seenCents,roundId:data.roundId,requestId:data.requestId,result});}if(!r.ok) throw Object.assign(new Error(result.message),{code:result.code});return result;}
};
const controls=document.createElement('div');controls.style='position:fixed;left:8px;top:8px;z-index:9999;background:#fff;color:#000;padding:6px;font:11px sans-serif;max-width:90vw';
controls.innerHTML='<b>LOCAL TEST · NO LIVE CHIPS</b> '+['reset','start','near-crash','crash','delay','offline','instant','auto'].map(x=>'<button data-control="'+x+'">'+x+'</button>').join('');
controls.addEventListener('click',async e=>{if(e.target.dataset.control){await fetch('/control/'+e.target.dataset.control,{method:'POST'});await refresh();}});
const receipt=document.createElement('output');receipt.id='qaReceipt';receipt.style='display:block;max-width:600px;overflow-wrap:anywhere';controls.append(receipt);document.body.append(controls);
setInterval(refresh,150);await refresh();window.dispatchEvent(new Event('fb-ready'));
</script>`;
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/fixture'){
      res.setHeader('Content-Type','application/json');
      const data=Object.fromEntries([...room.data].filter(([key])=>key!=='aviator/_engine'));
      return res.end(JSON.stringify(data));
    }
    if(url.pathname.startsWith('/control/')){
      const action=url.pathname.slice(9),s=room.data.get('aviator/state');
      if(action==='reset'){reset();delayed=false;offline=false;}
      if(action==='instant')room.data.get('aviator/_engine').crashPoint=1;
      if(action==='auto'){const b=room.data.get('aviatorBets/'+s.roundId+'_u1');if(b)b.autoAt=2;}
      if(action==='start')s.phaseAt=Date.now()-s.waitMs;
      if(action==='near-crash'&&s.phase==='flying')offset=s.phaseAt+Core.timeForMult(2.2)-Date.now();
      if(action==='crash'&&s.phase==='flying')offset=s.phaseAt+Core.timeForMult(2.4)+20-Date.now();
      if(action==='delay')delayed=!delayed;
      if(action==='offline')offline=!offline;
      if(!['reset','delay','offline'].includes(action)){room.setNow(Math.floor(Date.now()+offset));await room.call('avTick');}
      return res.end('OK');
    }
    if(url.pathname.startsWith('/api/')){
      const name=url.pathname.slice(5);let text='';for await(const chunk of req)text+=chunk;
      room.setNow(Math.floor(Date.now()+offset));
      if(offline&&name==='avTick'){res.statusCode=503;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({code:'unavailable',message:'Fixture offline'}));}
      const result=await room.call(name,JSON.parse(text||'{}'));
      if(delayed)await new Promise(r=>setTimeout(r,name==='avCashout'?1800:700));
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
    }
    if(url.pathname==='/review.html'){res.setHeader('Content-Type','text/html');return res.end('<title>Aviator mobile QA</title><style>body{margin:0;background:#20242a}iframe{display:block;margin:12px auto;border:0;width:390px;height:844px}</style><iframe title="Mobile preview" src="/"></iframe>');}
    if(url.pathname==='/'){
      let html=fs.readFileSync(path.join(root,'aviator-live.html'),'utf8');
      html=html.replace(/<script type="module">[\s\S]*?<\/script>/,bridge);
      // Keep the fixture completely separate from production service workers.
      html=html.replace(/navigator.serviceWorker.register\([^)]*\)/g,'Promise.resolve()');
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
    }
    const file=path.resolve(root,'.'+url.pathname);
    if(!file.startsWith(root+'/')||!url.pathname.startsWith('/assets/')&&!url.pathname.startsWith('/aviator-src/live/assets/')){res.statusCode=404;return res.end('Not found');}
    if(!fs.existsSync(file)){res.statusCode=404;return res.end('Fixture asset omitted');}
    const types={'.wav':'audio/wav','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:e.message,code:e.code}));}
}) .listen(Number(process.argv[process.argv.indexOf('--port')+1]) || 4173,'0.0.0.0',()=>console.log('Local in-memory preview ready'));
