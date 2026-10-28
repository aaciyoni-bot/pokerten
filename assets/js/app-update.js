/* Check the deployed release without interrupting a seat or changing app data. */
(function(root){
  'use strict';
  const current=Number(document.querySelector('meta[name="app-version"]')?.content)||335;
  let view='auth',latest=current,checking,registration,banner,message,button;
  const atTable=()=>String(root.__pkAppView||view).endsWith('-table');
  function render(text){
    if(!banner){
      banner=document.createElement('aside');banner.className='app-update-notice';banner.setAttribute('aria-label','App update');
      message=document.createElement('span');message.setAttribute('role','status');
      button=document.createElement('button');button.type='button';button.textContent='Update now';button.addEventListener('click',apply);
      const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss update notice');close.addEventListener('click',()=>banner.hidden=true);
      banner.append(message,button,close);document.body.append(banner);
    }
    banner.hidden=false;
    message.textContent=text||(atTable()?'Update ready. Return to the lobby to update.':'A new version is ready.');
    button.hidden=latest<=current;button.disabled=atTable();
  }
  async function check(manual=false){
    if(checking)return checking;
    if(document.hidden&&!manual)return;
    checking=(async()=>{
      try{
        registration?.update().catch(()=>{});
        const response=await fetch('assets/release.json',{cache:'no-store'});
        if(!response.ok)throw Error('Release unavailable');
        const release=await response.json(),version=Number(release.version);
        if(!Number.isSafeInteger(version)||version<1)throw Error('Invalid release');
        latest=version;
        if(latest>current)render();else if(manual)render('You’re up to date · v'+current);
      }catch(_){if(manual)render('Could not check for updates. Try again when online.');}
    })().finally(()=>checking=null);
    return checking;
  }
  function apply(){
    if(atTable()||latest<=current)return;
    const url=new URL(root.location.href);url.searchParams.set('v',String(latest));
    root.location.replace(url.href);
  }
  root.PokerAppUpdate={version:current,check,setView(next){view=next;if(banner&&!banner.hidden&&latest>current)render();}};
  async function start(){
    if('serviceWorker' in navigator){
      try{registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});}catch(_){}
    }
    check();
  }
  if(document.readyState==='complete')start();else root.addEventListener('load',start,{once:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  root.addEventListener('pageshow',()=>check());
  setInterval(()=>check(),60000);
})(window);
