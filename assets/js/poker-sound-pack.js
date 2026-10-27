/* Optional audio theme. The original POKERTEN engine/files remain the fallback. */
(function (root) {
  'use strict';
  const ID = 'zynga-23-29-705', BASE = 'assets/sounds/' + ID + '/';
  const banks = new Map(), pending = new Map(), sources = new Set(), last = new Map(), deferred = new Map(), bankErrors = new Map();
  let bridge, catalog, spec, index, ready, active = true, unlocked = false, view = 'auth';
  let warming, loadState = 'loading', lastAttempt = 0;
  // This script is the selected imported pack. A config-network failure must
  // not silently select the original engine; retain an explicit prior rollback.
  try { const saved=JSON.parse(localStorage.getItem('pkSoundTheme'));if(saved?.active==='original')active=false; } catch (_) {}
  let music = [], musicLoading = false, musicOn = true, preview = [], previewToken = 0, dialog;
  const gain = {deal:.65,flip:.65,chip:.7,chip1:.65,raise:.7,check:.75,fold:.65,turn:.55,tick:.4,
    win:.65,bigwin:.65,allin:.7,msg:.35,join:.4,shuffle:.6,bust:.6,tile:.55,dice:.55,
    click:.3,menuOpen:.35,menuClose:.35,slider:.3,emote:.45,gift:.45,collect:.6,reward:.6,
    tournamentWin:.65,bomb:.55,timeout:.4,switchTable:.4,roulette:.6};
  try { musicOn = localStorage.getItem('pkLobbyMusic') !== '0'; } catch (_) {}
  const audible = () => active && unlocked && !root.__pkMuted && root.__pkVolume !== 0 && !document.hidden;
  const key = name => 'apk:' + name;
  const stop = list => { list.splice(0).forEach(s => { try { s.stop(); } catch (_) {} }); };
  const stopAll = () => { deferred.clear(); previewToken++; stop(preview); stop(music); for (const s of sources) { try { s.stop(); } catch (_) {} } sources.clear(); };
  async function read(url,format,options={}) {
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),15000):null;
    try{const r=await fetch(url,{...options,...(controller?{signal:controller.signal}:{})});
      if(!r.ok)throw new Error('Audio unavailable');return await r[format]();
    }finally{if(controller)clearTimeout(timer);}
  }
  const json = url => read(url,'json',{cache:'no-cache'});
  function metadata() {
    if (!ready) ready = Promise.all([json(BASE+'catalog.json'),json(BASE+'events.json')]).then(([c,s]) => {
      catalog=c;spec=s;index=new Map(c.clips.map(clip=>[clip.name,clip]));return c;
    }).catch(e=>{ready=null;throw e;});
    return ready;
  }
  async function loadClip(name) {
    if (!bridge) return;
    if (bridge.buffers[key(name)]) return bridge.buffers[key(name)];
    if (pending.has(name)) return pending.get(name);
    const task = (async()=>{
      await metadata();
      const clip=index.get(name); if(!clip) return;
      if(bankErrors.has(clip.bank)&&Date.now()-bankErrors.get(clip.bank)<5000)throw new Error('Audio bank temporarily unavailable');
      if(!banks.has(clip.bank)) banks.set(clip.bank,read(BASE+catalog.banks[clip.bank].file,'arrayBuffer').catch(e=>{banks.delete(clip.bank);bankErrors.set(clip.bank,Date.now());throw e;}));
      const bytes=await banks.get(clip.bank);
      if(bytes.byteLength!==catalog.banks[clip.bank].bytes){banks.delete(clip.bank);bankErrors.set(clip.bank,Date.now());throw new Error('Incomplete sound bank');}
      const ctx=bridge.getContext(); if(!ctx)return;
      const decoded=await ctx.decodeAudioData(bytes.slice(clip.offset,clip.offset+clip.bytes));
      bridge.buffers[key(name)]=decoded;
      return decoded;
    })().finally(()=>pending.delete(name));
    pending.set(name,task);return task;
  }
  const coreReady = () => !!spec && !!bridge && Object.values(spec.events).every(names=>names.some(n=>bridge.buffers[key(n)])) && Object.values(spec.aliases).every(n=>bridge.buffers[key(n)]);
  function status(){return {theme:active?'imported':'original',state:active?(coreReady()?'ready':loadState):'ready'};}
  function updateStatus(){
    const el=dialog?.querySelector('.pk-sound-readiness');if(!el)return;
    const s=status();el.textContent=s.theme==='original'?'Original POKERTEN sounds active':s.state==='ready'?'New table sounds ready':s.state==='error'?'New sounds could not load. Tap Retry sounds.':'Loading new table sounds…';
  }
  function preload(force=false) {
    if(!active||!bridge||coreReady())return Promise.resolve();
    if(warming)return warming;
    if(!force&&loadState==='error'&&Date.now()-lastAttempt<5000)return Promise.resolve();
    if(force)bankErrors.clear();
    lastAttempt=Date.now();loadState='loading';updateStatus();
    warming=(async()=>{
      try {
        await metadata();
        // One playable sample per event first; remaining variants follow.
        const names=[...new Set([...Object.values(spec.events).map(a=>a[0]),...Object.values(spec.aliases),...Object.values(spec.events).flat()])];
        let next=0;
        await Promise.all(Array.from({length:4},async()=>{
          while(next<names.length && active) {const name=names[next++];try{await loadClip(name);}catch(_){} }
        }));
      } catch (_) {}
      loadState=coreReady()?'ready':'error';updateStatus();
    })().finally(()=>{warming=null;});
    return warming;
  }
  async function refresh() {
    try {
      const cfg=await json('assets/sounds/theme.json');
      if(![ID,'original'].includes(cfg.active))throw new Error('Unknown sound theme');
      const enabled=cfg.active===ID;
      if(active&&!enabled){stopAll();if(dialog?.open)dialog.close();}
      active=enabled;
      try{localStorage.setItem('pkSoundTheme',JSON.stringify({active:cfg.active,revision:cfg.revision}));}catch(_){}
    } catch (_) { /* Preserve the selected pack, including the first visit. */ }
    // Retry failed metadata/banks even when the configured theme did not change.
    if(active){await preload(true);syncMusic();}
    updateStatus();
  }
  function play(type,times=1,gapSec=0) {
    if(!active||!Object.prototype.hasOwnProperty.call(gain,type))return false;
    if(!audible()||!bridge)return true;
    const variants=spec?.events[type];
    if(!variants || !variants.some(n=>bridge.buffers[key(n)])) {
      const ticket={at:Date.now()};deferred.set(type,ticket);
      (async()=>{try{
        await metadata();const names=spec.events[type];if(!names?.length)return;
        await loadClip(names[0]);
        // Short cold-load feedback only. Never replay old bets after a stall,
        // backgrounding, a muted interval, or an explicit theme rollback.
        if(deferred.get(type)===ticket && Date.now()-ticket.at<500 && audible())play(type,times,gapSec);
      }catch(_){}finally{if(deferred.get(type)===ticket)deferred.delete(type);}})();
      preload();return true;
    }
    const available=variants.filter(n=>bridge.buffers[key(n)]);
    const now=Date.now(),spacing=type==='tick'?1900:type==='slider'?100:type==='click'?50:0;
    if(spacing&&now-(last.get(type)||0)<spacing)return true;
    last.set(type,now);
    const n=['deal','flip'].includes(type)?Math.max(1,Math.min(type==='deal'?36:5,Math.floor(times)||1)):1;
    const gap=gapSec||(type==='flip'?.22:.12);
    for(let i=0;i<n;i++)bridge.emit(key(available[Math.floor(Math.random()*available.length)]),i*gap,gain[type]??.6,1);
    return true;
  }
  function resolve(name) {
    if(!active||!spec||name.startsWith('apk:'))return name;
    const replacement=spec.aliases[name];
    if(replacement){if(!bridge?.buffers[key(replacement)])loadClip(replacement).catch(()=>{});return key(replacement);}
    return name;
  }
  async function syncMusic() {
    if(root.__pkMuted||root.__pkVolume===0||document.hidden)deferred.clear();
    const shouldPlay=audible()&&musicOn&&['clubs','lobby'].includes(view)&&!dialog?.open;
    if(!shouldPlay){stop(music);return;}
    if(music.length||musicLoading||!bridge)return;
    musicLoading=true;
    try {
      await metadata();await loadClip(spec.music);
      if(audible()&&musicOn&&['clubs','lobby'].includes(view)&&!dialog?.open&&!music.length)
        bridge.emit(key(spec.music),0,.13,1,0,music,true);
    }catch(_){}finally{musicLoading=false;}
  }
  function track(src) { sources.add(src);src.onended=()=>sources.delete(src); }
  function setView(next) {
    view=next;
    // Navigation is not a deal/bet; table sounds come from new game events.
    preload();syncMusic();
  }
  function unlock(){unlocked=true;try{bridge?.getContext();}catch(_){}preload();syncMusic();}
  function category(name) {
    if(/music_/i.test(name))return 'Music';
    if(/card|deal|shuffle|fold|check|your_turn|timer|all_in|bet_|chip_stacks|chips_moving/i.test(name))return 'Table';
    if(/chat|emote|notif|join/i.test(name))return 'Social';
    if(/win|reward|fanfare|flourish|collect|jackpot/i.test(name))return 'Rewards';
    return 'Menus & effects';
  }
  async function openLibrary(){
    unlock();
    if(dialog?.open)return;
    dialog=document.createElement('dialog');dialog.className='pk-sound-library';
    dialog.setAttribute('aria-label','Sound library');
    dialog.innerHTML='<header><div><h2>Sound library</h2><p>Loading sounds…</p></div><button type="button" aria-label="Close sound library">✕</button></header><p class="pk-sound-readiness" role="status"></p><div class="pk-sound-quick" aria-label="Test table sounds"></div><button type="button" class="pk-sound-retry">Retry sounds</button><div class="pk-sound-options"><label>Lobby music <input type="checkbox" aria-label="Lobby music"></label><button type="button" class="pk-sound-stop">Stop preview</button></div><input class="pk-sound-search" type="search" aria-label="Search sounds" placeholder="Search sounds"><div class="pk-sound-status" role="status"></div><div class="pk-sound-list"></div>';
    document.body.appendChild(dialog);const current=dialog;dialog.showModal();syncMusic();
    const status=dialog.querySelector('.pk-sound-status'),list=dialog.querySelector('.pk-sound-list');
    updateStatus();
    current.querySelector('.pk-sound-retry').addEventListener('click',async()=>{await refresh();updateStatus();});
    const checkbox=dialog.querySelector('input[type=checkbox]');checkbox.checked=musicOn;
    checkbox.addEventListener('change',()=>{musicOn=checkbox.checked;try{localStorage.setItem('pkLobbyMusic',musicOn?'1':'0');}catch(_){}syncMusic();});
    const stopPreview=()=>{previewToken++;stop(preview);status.textContent='';};
    dialog.querySelector('header button').addEventListener('click',()=>current.close());
    dialog.querySelector('.pk-sound-stop').addEventListener('click',stopPreview);
    dialog.addEventListener('close',()=>{stopPreview();current.remove();if(dialog===current)dialog=null;syncMusic();},{once:true});
    try {
      await metadata();if(!current.open)return;
      current.querySelector('header p').textContent=catalog.count+' sounds · '+(active?'Imported sound pack':'Original POKERTEN sounds active');
      const quick=current.querySelector('.pk-sound-quick');
      for(const [event,label] of [['deal','Deal'],['check','Check'],['chip','Bet'],['allin','All-in'],['win','Win'],['turn','Your turn']]){
        const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label','Test '+label);
        b.addEventListener('click',async()=>{
          stopPreview();const token=previewToken;
          if(!active){status.textContent='Original sounds are active.';return;}
          if(root.__pkMuted||root.__pkVolume===0){status.textContent='Turn sound on to preview.';return;}
          status.textContent='Loading…';
          try{const name=spec.events[event][0];await loadClip(name);
            if(token!==previewToken||!current.open||!audible())return;
            bridge.emit(key(name),0,gain[event]??.6,1,0,preview);status.textContent='New table sound: '+label;
          }catch(_){if(token===previewToken)status.textContent='Could not load this sound. Tap Retry sounds.';}
        });quick.append(b);
      }
      const render=()=>{
        const q=current.querySelector('.pk-sound-search').value.toLowerCase();list.replaceChildren();
        for(const clip of catalog.clips.filter(c=>(c.name+' '+category(c.name)).toLowerCase().includes(q))){
          const button=document.createElement('button');button.type='button';button.className='pk-sound-item';
          const label=document.createElement('span');label.textContent=clip.name.replace(/^(sfx_|foley_|flourish_|fanfare_)/i,'').replace(/_/g,' ');
          const detail=document.createElement('small');detail.textContent=category(clip.name)+' · '+clip.duration.toFixed(2)+'s';
          button.append(label,detail);button.setAttribute('aria-label','Play '+clip.name);
          button.addEventListener('click',async()=>{
            stopPreview();const token=previewToken;
            if(root.__pkMuted||root.__pkVolume===0){status.textContent='Turn sound on to preview.';return;}
            status.textContent='Loading…';
            try {
              await loadClip(clip.name);
              if(token!==previewToken||!current.open||!audible())return;
              bridge.emit(key(clip.name),0,.65,1,0,preview);status.textContent='Playing: '+label.textContent;
              // Keep optional previews bounded; common gameplay buffers stay ready.
              const common=new Set(Object.values(spec.events).flat().concat(Object.values(spec.aliases),spec.music));
              for(const k of Object.keys(bridge.buffers))if(k.startsWith('apk:')&&!common.has(k.slice(4))&&k!==key(clip.name))delete bridge.buffers[k];
            }catch(_){if(token===previewToken)status.textContent='Could not load this sound. Tap to retry.';}
          });list.append(button);
        }
      };
      current.querySelector('.pk-sound-search').addEventListener('input',render);render();
    }catch(_){status.textContent='Could not load the library. Close and try again.';}
  }
  const api={get active(){return active;},attach(b){bridge=b;preload();refresh();},preload,play,resolve,track,setView,syncMusic,openLibrary,refresh,
    // Catalog stays accessible without synthesizing unrelated game events.
    metadata,loadClip,category,status};
  root.PokerSoundPack=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.addEventListener){
    ['pointerdown','touchstart','keydown'].forEach(ev=>root.addEventListener(ev,unlock,{capture:true,passive:true}));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();else{refresh();syncMusic();}});
    const tap = e => {
      const button=e.target.closest?.('button,a,[role="button"],[role="tab"]');
      if(!button||button.disabled||button.getAttribute('aria-disabled')==='true'||button.closest('[aria-hidden="true"],.pk-sound-library'))return;
      if(e.type==='keydown'&&(!['Enter',' '].includes(e.key)||e.repeat||button.matches('button,a')))return;
      if(view.endsWith('-table')&&!button.matches('.poker-menu-tile'))return;
      if(view==='auth')return;
      play('click');
    };
    // Capture before React navigation removes a card or stops propagation.
    document.addEventListener('click',tap,true);
    document.addEventListener('keydown',tap,true);
    document.addEventListener('input',e=>{if(e.target.matches?.('input[type=range]')&&e.target.getAttribute('aria-label')!=='Sound volume')play('slider');});
    setInterval(refresh,60000);
  }
})(typeof window==='object'?window:globalThis);
