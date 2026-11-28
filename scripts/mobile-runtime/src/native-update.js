import { Capacitor, registerPlugin } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { createAutoUpdater } from './update-controller.mjs';
import { clearStaleResume } from './update-resume.mjs';
import release from '../ota-release.json';
const version = Number(document.querySelector('meta[name="app-version"]')?.content);
const storeUrl = 'https://play.google.com/store/apps/details?id=com.orizis.pokerten';
let overlay, text, controller, acknowledgement, started = false, manualCheck;
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
// The native rollback deadline measures whether the local JS bundle boots.
function acknowledgeShell() {
  if (!Capacitor.isNativePlatform()) return;
  if (!acknowledgement) acknowledgement=CapacitorUpdater.notifyAppReady().catch(()=>{acknowledgement=null;});
}
if (Capacitor.getPlatform() === 'android') {
  const store = registerPlugin('PokertenAppUpdate');
  controller = createAutoUpdater({ota:CapacitorUpdater,store,current:release,render,
    verifyEntrance:async()=>{
      const fb = window.fb;
      await fb.auth.authStateReady();
      const uid = fb.auth.currentUser?.uid;
      if (!uid) return true;
      const memberships = await fb.getDocs(fb.query(fb.collection(fb.db,'memberships'),fb.where('uid','==',uid)));
      if (memberships.metadata.fromCache || fb.auth.currentUser?.uid !== uid) return false;
      const clubs = memberships.docs.map(doc=>doc.data()).filter(m=>m.status==='approved');
      const checks = await Promise.all(clubs.map(m=>fb.fx('pkCanInstallUpdate',{clubId:m.clubId})));
      return fb.auth.currentUser?.uid === uid && checks.every((r,i)=>r?.allowed===true && r.uid===uid && r.clubId===clubs[i].clubId);
    },
    verifySeat:async(uid,clubId)=>{
      const fb=window.fb;
      if(fb?.auth?.currentUser?.uid!==uid)return false;
      const result=await fb.fx('pkCanInstallUpdate',{clubId});
      return result?.allowed===true && result.uid===uid && result.clubId===clubId && fb.auth.currentUser?.uid===uid;
    },
    hasResume:()=>{try{return !!localStorage.getItem('pkResume');}catch(_){return true;}},
    fetchRelease:async()=>{
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 8000);
      try {
        const url = 'https://pokerten.com/mobile-updates/' + release.runtime + '/latest.json?check=' + Date.now();
        const response = await fetch(url, {cache:'no-store', signal:abort.signal});
        if (!response.ok) throw Error('Update unavailable');
        return await response.json();
      } finally { clearTimeout(deadline); }
    }});
  CapacitorUpdater.addListener('download',event=>controller.progress(event.percent)).catch(()=>{});
}
window.PokerAppUpdate = {
  version, storeUrl,
  check(manual=false){
    if(!controller)return Promise.resolve('Check the App Store for updates on this device.');
    if(!manual)return controller.check();
    if(manualCheck)return manualCheck;
    manualCheck=clearStaleResume(window).then(()=>controller.check(true)).finally(()=>{manualCheck=null;});
    return manualCheck;
  },
  reload(){return this.check(true);},
  shellReady:acknowledgeShell,
  ready(){
    acknowledgeShell();
    if(!started && controller){started=true;controller.start();}
  },
  setView(view){controller?.setView(view);},
  setGameContext(context){controller?.setGameContext(context);}
};
