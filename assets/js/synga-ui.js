/* SYNGA presentation layer. The original engine, commands and roles remain authoritative. */
(function () {
  'use strict';
  const h = React.createElement;
  let api;
  const icon = name => h('i', {className:'fa-solid fa-'+name, 'aria-hidden':true});
  const money = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(n)||0);
  const art = cell => h('div',{className:'synga-game-art synga-modern-art','aria-hidden':true},icon(['layer-group','grip','shuffle','shield-halved','table-cells','bolt'][cell]));
  const games = [
    {id:'holdem',title:'TEXAS',sub:'HOLD’EM',cell:0,filter:t=>t.type==='poker'&&!t.settings?.isDealerChoice&&!t.settings?.spinMode&&['NLH','Pineapple'].includes(t.settings?.baseGameType||'NLH')},
    {id:'omaha',title:'OMAHA',sub:'4 · 5 · 6 CARDS',cell:1,filter:t=>t.type==='poker'&&!t.settings?.isDealerChoice&&!t.settings?.spinMode&&String(t.settings?.baseGameType).startsWith('Omaha')},
    {id:'dealer',title:'DEALER',sub:'CHOICE',cell:2,filter:t=>t.type==='poker'&&t.settings?.isDealerChoice},
    {id:'durak',title:'DURAK',sub:'PLAY YOUR CARDS',cell:3,filter:t=>t.type==='durak'},
    {id:'ofc',title:'CHINESE',sub:'POKER',cell:4,filter:t=>t.type==='ofc'},
    {id:'spin',title:'SPIN & CASH',sub:'THREE PLAYERS',cell:5,filter:t=>t.type==='poker'&&t.settings?.spinMode&&!t.spinDone}
  ];
  function Modal({title,onClose,children,wide=false}) {
    const ref=React.useRef(null);
    React.useEffect(()=>{const prior=document.activeElement;ref.current?.querySelector('button')?.focus();return()=>prior?.focus?.();},[]);
    return ReactDOM.createPortal(h('div',{className:'synga-modal-shade',onClick:onClose},h('section',{ref,role:'dialog','aria-modal':true,'aria-label':title,className:'synga-modal'+(wide?' synga-modal-wide':''),onClick:e=>e.stopPropagation(),onKeyDown:e=>{
      if(e.key==='Escape')onClose();
      if(e.key==='Tab'){const all=[...ref.current.querySelectorAll('button:not(:disabled),a,input,select,textarea,[tabindex="0"]')].filter(n=>n.getClientRects().length);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    }},h('header',{className:'synga-modal-head'},h('h2',null,title),h('button',{className:'synga-round',onClick:onClose,'aria-label':'Close '+title},icon('xmark'))),children)),document.getElementById('root')||document.body);
  }
  function Nav(p) {
    const [menu,setMenu]=React.useState(false),[sounds,setSounds]=React.useState(false),[muted,setMuted]=React.useState(!!window.__pkMuted);
    const actions=[['building-columns','My clubs',p.onClubs,true],['house','Lobby',p.onLobby,true],['chart-line','Manage club',p.onManage,api.canManage(p.user)],['wallet','Cashier',p.onCashier,api.canManage(p.user)],['file-invoice-dollar','Account & settlement',p.onSettlement,true],['ranking-star','Rankings',p.onRanks,true],['user','My profile',p.onProfile,true],['download','Install app',p.onInstall,p.showInstall]];
    return h('header',{className:'synga-nav'},
      h('button',{className:'synga-player-link',onClick:p.onProfile,'aria-label':'My profile'},h('img',{src:api.avatar(p.user),alt:''}),h('span',null,h('strong',null,p.user.username||p.user.name||'Player'),h('small',null,p.club.name||'SYNGA POKER'))),
      h('button',{className:'synga-logo-link',onClick:p.onLobby,'aria-label':'Club lobby'},h('img',{src:'assets/synga/midnight-wordmark.webp',alt:'SYNGA POKER'})),
      h('button',{className:'synga-nav-clubs',onClick:p.onClubs},icon('building-columns'),'MY CLUBS'),
      h('div',{className:'synga-nav-right'},h('button',{className:'synga-balance',onClick:p.onSettlement,'aria-label':'My chips and results'},h('img',{className:'synga-chip-icon',src:'assets/synga/midnight-chips.webp',alt:''}),h('span',null,money(p.user.balance))),h(FullscreenButton),h('button',{className:'synga-round',onClick:()=>setMenu(true),'aria-label':'Open navigation'},icon('bars'))),
      menu&&h(Modal,{title:'SYNGA POKER',onClose:()=>setMenu(false)},h('div',{className:'synga-menu'},actions.filter(x=>x[3]&&x[2]).map(([i,label,fn])=>h('button',{key:label,onClick:()=>{setMenu(false);fn();}},icon(i),label)),h('button',{onClick:()=>{setMenu(false);setSounds(true);}},icon('volume-high'),'Sound'))),
      sounds&&h(SoundPanel,{onClose:()=>setSounds(false)}));
  }
  function Lobby(p) {
    const [gamePage,setGamePage]=React.useState(0);
    const [selected,setSelected]=React.useState(null),[tableIndex,setTableIndex]=React.useState(0),[live,setLive]=React.useState(false),[legacy,setLegacy]=React.useState(false),[tour,setTour]=React.useState(false),[gameFilter,setGameFilter]=React.useState('all');
    const strip=React.useRef(null),stakesStrip=React.useRef(null);
    React.useEffect(()=>{const row=stakesStrip.current,card=row?.querySelector('.is-selected');if(row&&card)row.scrollTo({left:card.offsetLeft-(row.clientWidth-card.offsetWidth)/2,behavior:'smooth'});},[selected,tableIndex,gameFilter]);
    const all=(p.tables||[]).filter(t=>!t.tournamentId&&!t.closeRequested&&!t.spinDone);
    const hasPlayers=t=>Object.keys(t.players||{}).length>0;
    const available=all.filter(t=>(!live||hasPlayers(t))&&(!selected||selected.filter(t))&&(gameFilter==='all'||t.settings?.baseGameType===gameFilter));
    const chosen=available[Math.min(tableIndex,Math.max(0,available.length-1))];
    const running=(p.tournaments||[]).filter(t=>!['done','cancelled'].includes(t.status));
    const openGame=g=>{setSelected(g);setTableIndex(0);setGameFilter('all');};
    const join=t=>{if(!t)return;if(t.type==='poker')p.onJoinPoker(t);else if(t.type==='durak')p.onJoinDurak(t);else p.onJoinOfc(t);};
    const scroll=()=>setGamePage(v=>v?0:1);
    return h('section',{className:'synga-lobby','aria-label':'Game lobby'},
      h('div',{className:'synga-lobby-heading'},h('div',null,h('span',{className:'synga-eyebrow'},'YOUR CLUB. YOUR GAME.'),h('h1',null,p.clubSettings?.name||'Welcome to SYNGA')),h('button',{className:'synga-live'+(live?' is-on':''),onClick:()=>setLive(v=>!v),'aria-pressed':live},icon('tower-broadcast'),' LIVE TABLES')),
      h('div',{className:'synga-carousel',ref:strip},
        games.slice(gamePage*3,gamePage*3+3).map(g=>{const count=all.filter(g.filter).filter(t=>!live||hasPlayers(t)).length;return h('button',{key:g.id,className:'synga-game-tile synga-game-'+g.id,onClick:()=>openGame(g),'aria-label':g.title+' '+g.sub},h('span',{className:'synga-tile-count'},p.tablesLoaded?count+' TABLE'+(count===1?'':'S'):'LOADING…'),h('div',{className:'synga-tile-title'},h('strong',null,g.title),h('span',null,g.sub),g.id==='holdem'&&h('p',{className:'synga-game-description'},'The classic. Always a good table.')),h('span',{className:'synga-green-button'},'SELECT A TABLE',icon('chevron-right')));})),
      h('button',{className:'synga-carousel-arrow prev',onClick:()=>scroll(-1),'aria-label':'Previous games'},icon('chevron-left')),
      h('button',{className:'synga-carousel-arrow next',onClick:()=>scroll(1),'aria-label':'More games'},gamePage?'POKER GAMES':'MORE GAMES',icon('chevron-right')),
      h('footer',{className:'synga-footer'},h('button',{onClick:()=>setLegacy(true)},icon('sliders'),h('span',null,'CLUB TABLES')),h('button',{onClick:p.onSettlement},icon('chart-column'),h('span',null,'MY RESULTS')),h('button',{className:'synga-rewards',onClick:()=>setLegacy(true)},icon('gift'),h('span',null,'CLUB REWARDS')),h('button',{onClick:()=>setTour(true)},icon('trophy'),h('span',null,'TOURNAMENTS')),api.canManage(p.user)&&h('button',{onClick:p.onCreatePoker},icon('circle-plus'),h('span',null,'CREATE TABLE'))),
      selected&&h('section',{className:'synga-select-screen synga-select-'+selected.id,'aria-label':'Choose a '+selected.title+' table'},h('header',{className:'synga-select-head'},h('button',{className:'synga-round',onClick:()=>setSelected(null),'aria-label':'Back to games'},icon('chevron-left')),h('div',null,h('h2',null,selected.title+' '+selected.sub),h('span',null,'CHOOSE YOUR TABLE')),h('span',{className:'synga-select-balance'},icon('coins'),money(p.user.balance))),
        selected.id==='omaha'&&h('div',{className:'synga-variant-tabs'},['all','Omaha 4','Omaha 5','Omaha 6'].map(v=>h('button',{key:v,onClick:()=>{setGameFilter(v);setTableIndex(0);},'aria-pressed':gameFilter===v},v==='all'?'ALL OMAHA':v))),
        h('div',{className:'synga-stakes-strip',ref:stakesStrip},!p.tablesLoaded?h('p',{className:'synga-empty',role:'status'},'Loading club tables…'):available.length===0?h('div',{className:'synga-empty'},icon('chair'),h('h3',null,'No open tables yet'),h('p',null,'Your club manager can open a table for this game.'),api.canManage(p.user)&&h('button',{className:'synga-green-button',onClick:()=>{setSelected(null);setLegacy(true);}},'OPEN CLUB CONTROLS')):available.map((t,i)=>{const st=t.settings||{},n=Object.keys(t.players||{}).length;return h('button',{key:t.docId||t.id,className:'synga-stake-card'+(chosen===t?' is-selected':''),onClick:()=>setTableIndex(i),'aria-pressed':chosen===t},h('small',null,t.type==='poker'?'BLINDS':'BUY-IN'),h('strong',{className:'synga-stakes'},t.type==='poker'?api.short(st.blinds||.5)+' / '+api.short((st.blinds||.5)*2):api.short(st.buyIn||st.stake||0)),h('span',{className:'synga-buyin'},'BUY-IN: '+api.short(api.minBuyIn(st))+' – '+api.short(api.maxBuyIn(st))),h('h3',null,st.tableName||st.name||st.baseGameType||selected.title),h('div',{className:'synga-stake-detail'},icon('users'),n+' / '+(st.maxPlayers||6)+' players'+((t.waitlist||[]).length?' · '+t.waitlist.length+' waiting':'')),h('div',{className:'synga-stake-detail'},icon('clock'),(st.actionTime||30)+' sec per turn'),h('div',{className:'synga-stake-detail'},icon(hasPlayers(t)?'circle-play':'chair'),hasPlayers(t)?'Game in progress':'Seats available'));})),
        h('footer',{className:'synga-select-footer'},h('button',{className:'synga-panel-button',onClick:()=>{setSelected(null);setLegacy(true);}},icon('sliders'),'TABLE CONTROLS'),h('button',{className:'synga-green-button synga-play',disabled:!chosen,onClick:()=>join(chosen)},'PLAY NOW'),h('button',{className:'synga-panel-button',onClick:p.onSettlement},icon('coins'),'MY CHIPS'))),
      legacy&&h(Modal,{title:'CLUB TABLES & REWARDS',wide:true,onClose:()=>setLegacy(false)},h('div',{className:'synga-legacy'},h(api.LegacyLobby,p))),
      tour&&h(Modal,{title:'TOURNAMENTS',wide:true,onClose:()=>setTour(false)},h('div',{className:'synga-legacy'},h(api.Tournaments,{...p,game:'poker',onJoinTable:p.onJoinPoker})))
    );
  }
  function replayIntro() {
    let host=window;
    try { while(!host.SyngaEntry?.isHost&&host!==host.parent)host=host.parent;host.SyngaEntry?.replay?.(); } catch (_) {}
  }
  function FullscreenButton() {
    const controller=window.SyngaFullscreen;
    const [active,setActive]=React.useState(!!controller?.active),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(false);
    React.useEffect(()=>controller?.subscribe(()=>setActive(controller.active)),[controller]);
    if(!controller?.available)return null;
    return h(React.Fragment,null,h('button',{type:'button',className:'synga-round','data-synga-fullscreen':true,'aria-label':active?'Exit fullscreen':'Enter fullscreen',title:active?'Exit fullscreen':'Fullscreen','aria-pressed':active,disabled:busy,onClick:async()=>{setBusy(true);const ok=await controller.toggle();setBusy(false);setError(!ok);}},icon(active?'compress':'expand')),
      error&&h(Modal,{title:'FULL SCREEN',onClose:()=>setError(false)},h('p',{style:{padding:'20px'}},'This browser did not allow full screen. Open the site in your browser or launch the installed app from your home screen.')));
  }
  function SoundPanel({onClose}) {
    const [muted,setMuted]=React.useState(!!window.__pkMuted);
    const cues={shuffle:'Shuffle',deal:'Deal cards',flip:'Reveal a card',chip:'Chips',check:'Check',fold:'Fold',turn:'Your turn',allin:'All-in',win:'Win',bigwin:'Big win'};
    return h(Modal,{title:'SYNGA SOUNDS',onClose,wide:true},h('div',{className:'synga-sound-panel'},
      h('div',{className:'synga-sound-sample'},h('h3',null,'HEAR THE GAME'),h('p',null,'Shuffle · deal · chips · your turn · all-in · win'),h('audio',{controls:true,preload:'metadata',src:'assets/sounds/synga-demo.mp3','aria-label':'Play sound demonstration'})),
      h('button',{className:'synga-panel-button synga-mute','aria-pressed':!muted,onClick:()=>{const next=!muted;setMuted(next);window.__pkMuted=next;try{localStorage.setItem('pkMuted',next?'1':'0');}catch(_){}}},icon(muted?'volume-xmark':'volume-high'),muted?'Game sound off':'Game sound on'),
      h('div',{className:'synga-sound-grid'},Object.entries(cues).map(([cue,label])=>h('button',{key:cue,disabled:muted,onClick:()=>api.sound(cue)},icon('play'),label)))));
  }
  function Clubs(p) {
    const [code,setCode]=React.useState(''),[sounds,setSounds]=React.useState(false);
    const strip=React.useRef(null);
    return h('section',{className:'synga-club-hub','aria-label':'My clubs'},
      h('header',{className:'synga-clubs-head'},h('img',{src:'assets/synga/midnight-wordmark.webp',alt:'SYNGA POKER'}),h('div',null,h('h1',null,'MY CLUBS'),h('p',null,'Your friends. Your tables. Your game.')),
        h('div',{className:'synga-club-head-actions'},h('button',{className:'synga-panel-button',onClick:()=>setSounds(true)},icon('volume-high'),'SOUNDS'),h(FullscreenButton),h('button',{className:'synga-round',onClick:replayIntro,'aria-label':'Replay SYNGA introduction'},icon('film')))),
      h('div',{className:'synga-club-welcome'},h('span',null,'Welcome, '+(p.user.username||p.user.name||'Player')),h('span',null,'SELECT YOUR CLUB')),
      h('div',{className:'synga-club-strip',ref:strip},!p.directoryReady?h('p',{role:'status'},'Loading your clubs…'):p.clubs.map((c,i)=>{const m=p.memOf(c.id),approved=m?.status==='approved'||p.god;return h('article',{key:c.id,className:'synga-club-card synga-club-style-'+i%3},
        h('span',{className:'synga-club-ribbon'},c.ownerUid===p.user.uid?'YOUR CLUB':approved?'MEMBER':'PENDING APPROVAL'),
        h('img',{className:'synga-club-emblem',src:(!c.logo||/assets\/synga\/(brand\.webp|icon-512\.png)$/.test(c.logo))?'assets/synga/luminous-crest.webp':c.logo,alt:''}),
        h('h2',null,c.name),h('span',{className:'synga-club-code'},'CLUB ID '+p.clubCode(c.id)),
        h('div',{className:'synga-club-balance'},h('small',null,'YOUR CHIPS'),h('strong',null,Number.isFinite(m?.balance)?money(m.balance):'—')),
        h('button',{className:'synga-green-button',disabled:!approved,onClick:()=>p.onEnter(c)},approved?'ENTER CLUB':'AWAITING APPROVAL'),
        p.canArchive(c)&&h('button',{className:'synga-club-remove','aria-label':'Remove club '+c.name,onClick:()=>p.onArchive(c)},icon('box-archive')));
      }),p.directoryReady&&h('button',{className:'synga-club-card synga-club-create',onClick:p.onCreate},icon('circle-plus'),h('h2',null,'YOUR OWN CLUB'),h('p',null,'Bring your players together.'),h('span',{className:'synga-green-button'},'CREATE CLUB'))),
      h('button',{className:'synga-club-scroll prev','aria-label':'Previous clubs',onClick:()=>strip.current?.scrollBy({left:-strip.current.clientWidth*.65,behavior:'smooth'})},icon('chevron-left')),
      h('button',{className:'synga-club-scroll next','aria-label':'More clubs',onClick:()=>strip.current?.scrollBy({left:strip.current.clientWidth*.65,behavior:'smooth'})},icon('chevron-right')),
      h('footer',{className:'synga-clubs-footer'},h('form',{onSubmit:e=>{e.preventDefault();p.onSearch(code);}},h('label',{htmlFor:'synga-club-code'},'HAVE A CLUB CODE?'),h('input',{id:'synga-club-code',value:code,onChange:e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6)),inputMode:'numeric',pattern:'[0-9]{6}',maxLength:6,placeholder:'6-digit code',required:true,autoComplete:'off'}),h('button',{type:'submit',className:'synga-green-button'},'FIND CLUB')),
        p.archivedCount>0&&h('button',{className:'synga-panel-button',onClick:p.onArchived},icon('box-archive'),'ARCHIVED CLUBS'),h('button',{className:'synga-panel-button',onClick:p.onCreate},icon('circle-plus'),'CREATE CLUB')),
      p.foundClub&&!p.memOf(p.foundClub.id)&&h(Modal,{title:'JOIN A CLUB',onClose:p.onClearSearch},h('div',{className:'synga-club-found'},h('h3',null,p.foundClub.name),h('p',null,'Send a request to the club manager.'),h('button',{className:'synga-green-button',onClick:()=>{p.onJoin(p.foundClub);p.onClearSearch();}},'REQUEST TO JOIN'))),
      sounds&&h(SoundPanel,{onClose:()=>setSounds(false)}));
  }
  function Welcome() {
    return h('main',{className:'synga-welcome'},h('img',{className:'synga-welcome-logo',src:'assets/synga/midnight-wordmark.webp',alt:'SYNGA POKER'}),h('section',null,h('span',{className:'synga-eyebrow'},'A NEW HOME FOR YOUR POKER CLUB'),h('h1',null,'Your friends.',h('br'),'Your table.'),h('p',null,'Explore the new lobby and table design.'),h('a',{className:'synga-green-button',href:'preview.html',target:'_top'},'OPEN DESIGN PREVIEW'),h('small',null,'Preview only · Multiplayer is awaiting setup.')));
  }
  let bound=false;
  window.SyngaUI={Nav,Lobby,Clubs,SoundPanel,Welcome,Modal,games,bind(deps){api=deps;if(!bound){bound=true;document.addEventListener('click',event=>{if(event.target.closest('.synga-carousel button,.synga-footer button,.synga-select-screen button'))api.sound?.('ui');});}}};
})();
