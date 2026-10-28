/* Refresh the app shell without clearing sign-in, saved settings or game data. */
(function(root){
  'use strict';
  const current=Number(document.querySelector('meta[name="app-version"]')?.content)||339;
  let view='auth',latest=current,checking,registration,banner,message,button,applying=false,verified=false;
  const atTable=()=>String(root.__pkAppView||view).endsWith('-table');
  async function read(url,format){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(url,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error('Update unavailable');
      return await response[format]();
    }finally{clearTimeout(timer);}
  }
  function render(text){
    if(!banner){
      banner=document.createElement('aside');banner.className='app-update-notice';banner.setAttribute('aria-label','App update');
      message=document.createElement('span');message.setAttribute('role','status');
      button=document.createElement('button');button.type='button';button.addEventListener('click',()=>apply(true));
      const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss update notice');close.addEventListener('click',()=>banner.hidden=true);
      banner.append(message,button,close);document.body.append(banner);
    }
    banner.hidden=false;
    message.textContent=text||(atTable()?'Update ready. Return to the lobby to update.':'A new version is ready.');
    button.textContent=applying?'Loading update…':latest>current?'Update now':'Reload app';
    button.hidden=!verified;button.disabled=atTable()||applying;
    const output=document.getElementById('repair-status');if(output)output.textContent=message.textContent;
  }
  async function check(manual=false){
    if(checking){await checking;if(manual)render(verified?(latest>current?undefined:'You’re up to date · v'+current):'Could not check for updates. Try again when online.');return;}
    if(document.hidden&&!manual)return;
    checking=(async()=>{
      try{
        registration?.update().catch(()=>{});
        // A fresh URL also avoids an old CDN response at the installed app's origin.
        const release=await read('assets/release.json?check='+Date.now(),'json'),version=Number(release.version);
        if(!Number.isSafeInteger(version)||version<1)throw Error('Invalid release');
        verified=true;latest=version;
        if(latest>current)render();else if(manual)render('You’re up to date · v'+current);
      }catch(_){verified=false;if(manual)render('Could not check for updates. Try again when online.');}
    })().finally(()=>checking=null);
    return checking;
  }
  async function apply(force=false){
    if(atTable()||applying||!verified||(!force&&latest<=current))return;
    applying=true;render('Loading the latest app…');
    try{
      const url=new URL(root.location.href);
      if(url.pathname.endsWith('/update.html'))url.pathname=url.pathname.slice(0,-'update.html'.length);
      // Keep v=lobby and other navigation parameters; appVersion is separate.
      url.searchParams.set('appVersion',String(latest));url.searchParams.set('reload',String(Date.now()));
      const html=await read(url.href,'text');
      const match=html.match(/<meta\s+name=["']app-version["']\s+content=["'](\d+)["']/i);
      if(!match||Number(match[1])<latest)throw Error('The latest app is not available yet');
      // A player can enter a table while the network request is pending.
      if(atTable()){render('Return to the lobby before updating.');return;}
      root.location.replace(url.href);
    }catch(_){render('The update could not load. Check your connection and try again.');}
    finally{applying=false;if(button){button.disabled=atTable();button.textContent=latest>current?'Update now':'Reload app';}}
  }
  const reload=async()=>{await check(true);return apply(true);};
  root.PokerAppUpdate={version:current,check,reload,setView(next){view=next;if(banner&&!banner.hidden&&latest>current)render();}};
  function start(){
    // A stuck registration must never prevent the version check from starting.
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>{registration=r;}).catch(()=>{});
      navigator.serviceWorker.addEventListener?.('controllerchange',()=>check());
      navigator.serviceWorker.addEventListener?.('message',event=>{if(event.data?.type==='POKERTEN_RELEASE')check();});
    }
    document.getElementById('repair-update')?.addEventListener('click',reload);
    check();
  }
  if(document.readyState==='complete')start();else root.addEventListener('load',start,{once:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  for(const event of ['pageshow','focus','online'])root.addEventListener(event,()=>check());
  setInterval(()=>check(),60000);
})(window);
