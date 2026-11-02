import { Capacitor, registerPlugin } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { createAutoUpdater } from './update-controller.mjs';
import release from '../ota-release.json';
const version = Number(document.querySelector('meta[name="app-version"]')?.content);
const storeUrl = 'https://play.google.com/store/apps/details?id=com.orizis.pokerten';
let overlay, text, controller, ready = false;
function render(state) {
  if (!state) { overlay?.remove(); overlay = null; const app=document.getElementById('root'); if(app)app.inert=false; return; }
  if (!overlay) {
    overlay = document.createElement('div'); overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','polite'); overlay.setAttribute('aria-label','Updating POKERTEN');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#06111c;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#9be7ef;font:600 18px system-ui;gap:18px;touch-action:none';
    const logo = document.createElement('strong'); logo.textContent='POKERTEN'; logo.style.cssText='font-size:30px;color:#fff;letter-spacing:3px';
    const progress=document.createElement('progress'); progress.style.cssText='width:180px;height:6px;accent-color:#6df4d0';
    text = document.createElement('span'); overlay.append(logo,progress,text); document.body.append(overlay);
    // Prevent keyboard activation of controls under the startup screen as well.
    overlay.addEventListener('keydown',event=>{ event.preventDefault(); event.stopPropagation(); });
    const app=document.getElementById('root'); if(app)app.inert=true; overlay.tabIndex=-1; overlay.focus();
  }
  text.textContent=state.text + (Number.isFinite(state.percent) ? ' ' + Math.round(state.percent) + '%' : state.size ? ' ('+(state.size/1048576).toFixed(1)+' MB)' : '');
}
if (Capacitor.getPlatform() === 'android') {
  const store = registerPlugin('PokertenAppUpdate');
  controller = createAutoUpdater({ota:CapacitorUpdater,store,current:release,render,
    hasResume:()=>{try{return !!localStorage.getItem('pkResume');}catch(_){return true;}},
    fetchRelease:async()=>{
      const response=await fetch('https://pokerten.com/mobile-updates/'+release.runtime+'/latest.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Update unavailable');return response.json();
    }});
  CapacitorUpdater.addListener('download',event=>controller.progress(event.percent)).catch(()=>{});
}
window.PokerAppUpdate = {
  version, storeUrl,
  check(manual=false){return controller?.check(manual);},
  reload(){return this.check(true);},
  ready(){
    // React has rendered successfully; acknowledge the bundle to enable rollback protection.
    if(!ready && Capacitor.isNativePlatform()){ready=true;CapacitorUpdater.notifyAppReady().catch(()=>{});}
  },
  setView(view){controller?.setView(view);},
  setGameContext(context){controller?.setGameContext(context);}
};
