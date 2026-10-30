/* Keep a landscape viewport inside a rotated host, including all introductions.
   The game keeps normal DOM coordinates, pointer events and state on rotation. */
(function () {
  'use strict';
  if (window.SyngaEntry || location.href === 'about:srcdoc') return;
  const embedded = new URLSearchParams(location.search).get('synga-frame') === '1';
  if (embedded) {
    document.documentElement.dataset.syngaEmbedded = 'true';
    window.SyngaEntry = {isHost:false};
    return;
  }
  document.documentElement.dataset.syngaHost = 'true';
  const api = window.SyngaEntry = {isHost:true};
  function mount() {
    const surface = document.createElement('div');
    surface.className = 'synga-landscape-surface';
    surface.setAttribute('aria-label','SYNGA POKER');
    const previewPath = location.pathname.endsWith('/preview.html');
    const preview = previewPath && !window.SYNGA_CONFIG?.firebase?.projectId;
    const frame = document.createElement('iframe');
    frame.className = 'synga-game-frame';
    frame.title = preview ? 'SYNGA POKER design preview' : 'SYNGA POKER game';
    frame.allow = 'autoplay; fullscreen';
    const target = new URL(preview ? 'tests/ui/synga-preview.html?mode=clubs&seats=5&full&opponents' : (previewPath ? './' : location.href),location.href);
    if (!preview) target.searchParams.set('synga-frame','1');
    frame.src = target.href;
    surface.appendChild(frame);
    const splash = document.createElement('section');
    splash.className = 'synga-brand-intro';
    splash.setAttribute('aria-label','SYNGA POKER introduction');
    splash.innerHTML = '<img class="synga-intro-scene" src="assets/synga/midnight-table.webp" alt=""><div class="synga-intro-shade"></div><div class="synga-intro-brand"><span class="synga-intro-eyebrow">YOUR FRIENDS. YOUR TABLE.</span><img class="synga-intro-logo" src="assets/synga/midnight-wordmark.webp" alt="SYNGA POKER"><p>WELCOME TO YOUR POKER CLUB</p><button class="synga-intro-enter" type="button">ENTER SYNGA</button></div><small class="synga-intro-credit">BY ORIZIS TECHNOLOGY</small>';
    surface.appendChild(splash);
    const orizis = document.getElementById('orizis-intro');
    if (orizis) surface.appendChild(orizis);
    document.body.appendChild(surface);
    let endTimer,hideTimer;
    const enter = () => {
      clearTimeout(endTimer);
      splash.classList.add('is-leaving');
      splash.setAttribute('inert','');
      frame.removeAttribute('inert');
      hideTimer=setTimeout(()=>{splash.hidden=true;frame.focus();},500);
    };
    const show = (autoAdvance=true) => {
      clearTimeout(endTimer);clearTimeout(hideTimer);
      splash.hidden=false;splash.removeAttribute('inert');frame.setAttribute('inert','');
      splash.classList.remove('is-playing','is-leaving');
      // Restart the image animation when the user explicitly replays the intro.
      void splash.offsetWidth;
      splash.classList.add('is-playing');
      splash.querySelector('button').focus({preventScroll:true});
      if(autoAdvance)endTimer=setTimeout(enter,4400);
    };
    splash.querySelector('button').addEventListener('click',enter);
    splash.addEventListener('keydown',event=>{if(event.key==='Escape')enter();});
    api.replay=()=>show(false);
    frame.setAttribute('inert','');
    if (orizis) {
      splash.setAttribute('inert','');
      const observer=new MutationObserver(()=>{if(!orizis.isConnected){observer.disconnect();show();}});
      observer.observe(surface,{childList:true});
    } else show();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
