/* Shared, presentation-only club screens. Financial mutations stay in the app. */
(function (w) {
  'use strict';
  const R = w.React, h = R.createElement;
  const amount = n => (Number(n) || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const icon = name => h('i', {className:'fa-solid fa-' + name, 'aria-hidden':true});

  function LobbyOverview({user, tables = [], brand, onResume}) {
    const mine = tables.find(t => t.players && t.players[user.uid]);
    const seats = tables.reduce((n,t) => n + Object.keys(t.players || {}).length, 0);
    return h('section', {className:'club-welcome', dir:'ltr', 'aria-label':'Lobby overview'},
      h('div', {className:'club-welcome-copy'},
        h('span', {className:'club-eyebrow'}, brand + ' / YOUR CLUB'),
        h('h1', null, 'Your next hand starts here.'),
        h('p', null, `Welcome, ${user.username || 'player'}. Find a table or return to your seat.`),
        mine && onResume && h('button', {className:'club-primary', onClick:()=>onResume(mine)}, icon('arrow-rotate-left'), 'Return to my table')),
      h('dl', {className:'club-lobby-facts'},
        h('div', null, h('dt', null, icon('table-cells'), 'Club tables'), h('dd', null, tables.length)),
        h('div', null, h('dt', null, icon('users'), 'Occupied seats'), h('dd', null, seats)),
        h('div', null, h('dt', null, icon('id-card'), 'Player ID'), h('dd', {className:'club-player-id',dir:'ltr'}, user.playerId || '—'))));
  }

  function SettlementPlayerCards({players = [], results = {}, rakes = {}, showRake = false, members = {}, logs = [], period, formatAmount = amount}) {
    const [selected, setSelected] = R.useState(null), [page, setPage] = R.useState(0);
    const dialog = R.useRef(null);
    const signature = players.map(p=>p.uid || p.id).join('|');
    R.useEffect(()=>setPage(0), [signature, period]);
    const current = players.find(p=>(p.uid || p.id) === selected);
    R.useEffect(()=>{if(selected && !current)setSelected(null);},[selected,current]);
    R.useEffect(()=>{
      if(!selected)return;
      const before=w.document.activeElement;
      dialog.current?.querySelector('button')?.focus();
      return()=>{if(before?.isConnected)before.focus();};
    },[selected]);
    const maxPage = Math.max(0, Math.ceil(players.length/12)-1), actualPage = Math.min(page,maxPage);
    const keys = e => {
      if(e.key==='Escape'){e.stopPropagation();setSelected(null);}
      if(e.key!=='Tab')return;
      const list=[...dialog.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')];
      const first=list[0], last=list[list.length-1];
      if(e.shiftKey && w.document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && w.document.activeElement===last){e.preventDefault();first.focus();}
    };
    return h('section',{className:'settlement-cards',dir:'ltr','aria-label':'Player account cards'},
      h('div',{className:'club-card-grid'},players.slice(actualPage*12,actualPage*12+12).map(p=>h('button',{
        key:p.uid || p.id, className:'club-account-card', onClick:()=>setSelected(p.uid || p.id),
        'aria-label':'Open account for ' + (p.username || p.playerId || '')
      },
        h('span',{className:'club-account-identity'},h('span',{className:'club-avatar'},icon('user')),h('span',null,h('strong',null,p.username || '—'),h('small',{dir:'ltr'},p.playerId || '—')),icon('arrow-up-right-from-square')),
        h('span',{className:'club-account-result'},h('small',null,'Period result'),h('strong',{className:(results[p.uid] || 0)<0?'club-negative':'club-positive',dir:'ltr'},formatAmount(results[p.uid]))),
        h('span',{className:'club-account-numbers'},h('span',null,h('small',null,'Current balance'),h('b',{dir:'ltr'},formatAmount(p.balance))),showRake && h('span',null,h('small',null,'Period rake'),h('b',{dir:'ltr'},formatAmount(rakes[p.uid])))),
        h('span',{className:'club-account-agent'},icon('handshake'),members[p.agentUid]?.username || 'No assigned agent')))),
      !players.length && h('p',{className:'club-empty'},'No players match these filters.'),
      maxPage>0 && h('nav',{className:'club-pagination','aria-label':'Player pages'},
        h('button',{disabled:actualPage===0,onClick:()=>setPage(actualPage-1)},'Previous'),
        h('span',null,`${actualPage+1} / ${maxPage+1}`),
        h('button',{disabled:actualPage===maxPage,onClick:()=>setPage(actualPage+1)},'Next')),
      current && w.ReactDOM.createPortal(h('div',{className:'club-account-backdrop',onClick:e=>{if(e.target===e.currentTarget)setSelected(null);}},
        h('section',{ref:dialog,className:'club-account-dialog',role:'dialog','aria-modal':true,'aria-label':'Player account: '+(current.username||''),dir:'ltr',onKeyDown:keys},
          h('button',{className:'club-dialog-close',onClick:()=>setSelected(null)},icon('xmark'),'Close'),
          h('span',{className:'club-eyebrow'},'PLAYER ACCOUNT'),
          h('h2',null,current.username || '—'),
          h('p',null,'Player ID: ',h('bdi',null,current.playerId || '—')),
          h('dl',{className:'club-profile-facts'},
            h('div',null,h('dt',null,'Current balance'),h('dd',{dir:'ltr'},formatAmount(current.balance))),
            h('div',null,h('dt',null,'Period result'),h('dd',{dir:'ltr'},formatAmount(results[current.uid]))),
            h('div',null,h('dt',null,'Agent'),h('dd',null,members[current.agentUid]?.username || '—')),
            h('div',null,h('dt',null,'Phone'),h('dd',{dir:'ltr'},current.phone || '—'))),
          h('h3',null,'Game activity · ',period),
          h('p',{className:'club-explainer'},'Current balance and game results measure different things. Recent game entries below do not include deposits or withdrawals.'),
          logs.filter(e=>e.uid===current.uid).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,20).map((e,i)=>h('div',{className:'club-game-entry',key:i},
            h('span',null,e.game || e.type || 'Game',h('small',null,new Date(e.at || 0).toLocaleString('en-GB',{timeZone:'Asia/Jerusalem'}))),
            h('b',{className:(e.profit || 0)<0?'club-negative':'club-positive',dir:'ltr'},formatAmount(e.profit)))),
          !logs.some(e=>e.uid===current.uid) && h('p',{className:'club-empty'},'No game activity recorded in this period.'),
          h('small',null,'Showing up to 20 recent entries for the selected period.'))),w.document.body));
  }
  w.ClubUI={LobbyOverview,SettlementPlayerCards};
})(window);
