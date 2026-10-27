/* Club counter: existing server ledger, explicit review, receipt-safe batch transfers. */
(function(root){
  'use strict';
  const money=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const round=n=>Math.round(n*100)/100;
  const bonus=m=>round(Math.max(0,Math.min(Number(m.balance)||0,Number(m.bonusOpen??m.bonusTotal)||0)));
  const available=m=>round(Math.max(0,(Number(m.balance)||0)-bonus(m)));
  const role=m=>['club_owner','manager'].includes(m.role)?'manager':m.role==='super_admin'?'sa':m.role==='agent'?'agent':'player';
  const human=m=>!m.isBot&&!String(m.uid).startsWith('bot_');
  const definitive=e=>/^(?:functions\/)?(?:invalid-argument|failed-precondition|permission-denied|unauthenticated|not-found|resource-exhausted)$/.test(e.code||'');
  function Cashier({members=[],treasury,accounting,loading,error,onRefresh,onBack,onSettlement,onManage,onMember,avatarUrl,canTransfer=false,clubId,viewerId='',call}){
    const {createElement:h,useState,useRef,useEffect}=root.React;
    const [tab,setTab]=useState('trade'),[search,setSearch]=useState(''),[sort,setSort]=useState('balance'),[filter,setFilter]=useState('all'),[applicants,setApplicants]=useState(false);
    const [selected,setSelected]=useState([]),[expanded,setExpanded]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null);
    const [history,setHistory]=useState(null),[historyError,setHistoryError]=useState(''),[historyVersion,setHistoryVersion]=useState(0),[batch,setBatch]=useState(null);
    const lock=useRef(false),queue=useRef(null),dialog=useRef(null);
    const storageKey='pk-counter:'+viewerId+':'+clubId;
    const icon=(name,cls='')=>h('i',{className:'fa-solid fa-'+name+' '+cls,'aria-hidden':true});
    const chip=(blue=false)=>icon('life-ring',blue?'cashier-chip blue':'cashier-chip');
    const label=m=>m.username||m.playerId||'Player';
    const people=members.filter(human).filter(m=>m.uid!==treasury?.uid&&['approved','banned'].includes(m.status));
    const memberList=members.filter(human).filter(m=>applicants?m.status==='pending':['approved','banned'].includes(m.status));
    const rows=(tab==='members'?memberList:people).filter(m=>filter==='all'||role(m)===filter)
      .filter(m=>[m.username,m.playerId,m.uid,m.alias,members.find(a=>a.uid===m.agentUid)?.username].some(v=>String(v||'').toLowerCase().includes(search.trim().toLowerCase())))
      .sort((a,b)=>sort==='name'?label(a).localeCompare(label(b)):sort==='result'?(accounting?.players?.[b.uid]?.result??-Infinity)-(accounting?.players?.[a.uid]?.result??-Infinity):Number(b.balance||0)-Number(a.balance||0));
    const picked=people.filter(m=>selected.includes(m.uid));
    const changeTab=next=>{if(!draft&&!queue.current){setTab(next);setSearch('');setFilter('all');setSelected([]);setExpanded(null);}};
    const persist=q=>{root.sessionStorage.setItem(storageKey,JSON.stringify(q));queue.current=q;setBatch({...q,items:[...q.items]});};
    useEffect(()=>{try{const saved=JSON.parse(root.sessionStorage.getItem(storageKey)||'null');if(saved?.items?.length&&saved.clubId===clubId&&saved.viewerId===viewerId){queue.current=saved;setBatch(saved);setDraft({direction:saved.direction,entries:[]});setNotice({ok:false,text:'An unfinished transfer is saved. Review its status before continuing.'});}}catch(_){}},[storageKey]);
    useEffect(()=>{
      if(!draft)return;
      const before=root.document.activeElement,d=dialog.current;
      if(d?.showModal&&!d.open)d.showModal();
      d?.querySelector('input,button')?.focus();
      return()=>{if(d?.open&&d.close)d.close();if(before?.isConnected)before.focus();};
    },[!!draft]);
    useEffect(()=>{
      if(tab!=='history'||!canTransfer)return;let alive=true;setHistory(null);setHistoryError('');
      (async()=>{const records=[],seen=new Set();let cursor;
        for(;;){const page=await call('pkClubDirectory',{clubId,reportSection:'cashierHistory',pageSize:200,...(cursor?{cursor}:{})});
          if(!Array.isArray(page?.records)||typeof page.hasMore!=='boolean')throw Error('Transfer history is not available yet.');
          records.push(...page.records);if(!page.hasMore)break;
          if(!page.nextCursor||seen.has(page.nextCursor))throw Error('History could not finish loading.');seen.add(page.nextCursor);cursor=page.nextCursor;
        }
        if(alive)setHistory(records.sort((a,b)=>b.at-a.at));
      })().catch(()=>{if(alive)setHistoryError('Trade records could not load. Please retry.');});return()=>{alive=false;};
    },[tab,historyVersion,canTransfer,clubId]);
    const open=direction=>{if(lock.current||queue.current||!canTransfer||loading||!picked.length)return;setNotice(null);setDraft({direction,entries:picked.map(m=>({uid:m.uid,name:label(m),amount:''})),same:''});};
    const entries=draft?.entries||[],claim=draft?.direction==='claim';
    const amounts=entries.map(e=>{const m=people.find(p=>p.uid===e.uid),n=Number(e.amount);return{...e,member:m,value:n,valid:!!m&&e.amount.trim()!==''&&Number.isFinite(n)&&n>0&&n<=10000000&&Math.abs(round(n)-n)<1e-7&&(claim?n<=available(m):m.status==='approved')};});
    const total=round(amounts.reduce((s,e)=>s+(Number.isFinite(e.value)?e.value:0),0));
    const valid=amounts.length>0&&amounts.every(e=>e.valid)&&!!treasury&&(claim||total<=Number(treasury.balance));
    const unresolved=batch?.items.some(e=>e.status==='unknown'||e.status==='sending');
    const complete=batch&&batch.items.every(e=>e.status==='done');
    const close=()=>{if(busy||unresolved)return;root.sessionStorage.removeItem(storageKey);queue.current=null;setBatch(null);setDraft(null);setSelected([]);onRefresh?.();};
    const submit=async e=>{
      e.preventDefault();if(lock.current||!canTransfer||(!queue.current&&(!valid||loading)))return;
      lock.current=true;setBusy(true);setNotice(null);
      try{
        let q=queue.current;
        if(!q){q={clubId,viewerId,direction:draft.direction,items:amounts.map(e=>({uid:e.uid,name:e.name,amount:claim?-e.value:e.value,requestId:root.crypto.randomUUID(),status:'ready'}))};persist(q);}
        for(const item of q.items){
          if(item.status==='done')continue;
          // Persist the exact receipt before any network mutation. Retry never invents a new ID.
          item.status='sending';persist(q);
          try{await call('pkClubMember',{clubId,targetUid:item.uid,op:'cashier-transfer',amount:item.amount,requestId:item.requestId});item.status='done';persist(q);}
          catch(err){item.status=definitive(err)?'rejected':'unknown';persist(q);setNotice({ok:false,text:definitive(err)?'Transfer rejected. Completed rows stay completed; remaining rows were not sent. Close and refresh before creating another transfer.':'Confirmation was interrupted. Retry checks the same receipts and skips completed players.'});break;}
        }
        if(q.items.every(i=>i.status==='done')){setNotice({ok:true,text:(q.direction==='claim'?'Claim Back':'Send Out')+' completed for '+q.items.length+' member'+(q.items.length===1?'':'s')+'.'});setHistoryVersion(n=>n+1);onRefresh?.();}
      }catch(err){setNotice({ok:false,text:'Could not save the transfer status. Keep this screen open and retry; no new transfer will be created.'});}
      finally{lock.current=false;setBusy(false);}
    };
    const value=(name,n,signed=false)=>h('div',{className:'cashier-number'},h('span',null,name),h('strong',{className:signed&&Number.isFinite(n)?(n<0?'negative':'positive'):''},Number.isFinite(n)?(signed&&n>0?'+':'')+money(n):'—'));
    const memberCard=m=>{const a=accounting?.players?.[m.uid],agent=members.find(p=>p.uid===m.agentUid),isOpen=expanded===m.uid;return h('article',{key:m.uid,className:'cashier-member'+(selected.includes(m.uid)?' is-selected':''),'data-player-id':m.uid},
      h('div',{className:'cashier-member-main'},tab==='trade'&&canTransfer&&h('label',{className:'cashier-select'},h('input',{type:'checkbox','aria-label':'Select '+label(m),checked:selected.includes(m.uid),disabled:!!draft||loading,onChange:e=>setSelected(ids=>e.target.checked?[...ids,m.uid]:ids.filter(id=>id!==m.uid))}),icon('circle-check')),
        h('button',{type:'button',className:'cashier-person','aria-expanded':isOpen,onClick:()=>setExpanded(isOpen?null:m.uid)},h('img',{src:avatarUrl?avatarUrl(m):m.photo||'assets/avatars/av-bussinesman.webp',alt:'',loading:'lazy',decoding:'async',className:'cashier-avatar'}),h('span',null,h('strong',null,label(m)),h('small',null,'(ID : '+(m.playerId||'—')+')'))),
        h('div',{className:'cashier-wallet',title:'Chips in wallet'},chip(),h('span',null,money(m.balance)))),
      h('div',{className:'cashier-member-meta'},agent&&h('span',{className:'cashier-agent'},h('b',null,'Agent'),label(agent)),h('span',null,'Alias',h('b',null,m.alias||'—')),m.status==='banned'&&h('small',null,'Banned')),
      isOpen&&h('div',{className:'cashier-expanded'},h('div',{className:'cashier-numbers'},value('Available',available(m)),value('Bonus in wallet',bonus(m)),value('At tables',error?null:a?.onTables),value('Cycle result',error?null:a?.result,true)),Number(m.promoBalance)>0&&h('small',null,'Legacy bonus wallet: '+money(m.promoBalance)),onMember&&h('button',{type:'button',onClick:()=>onMember(m)},'Open player account'),m.status==='pending'&&onManage&&h('button',{type:'button',onClick:onManage},'Manage application')));};
    const tabs=[['trade','Trade'],['members','Members'],...(canTransfer?[['history','Trade Record']]:[]),...(onSettlement?[['results','Results']]:[])];
    return h('section',{className:'club-cashier'+(tab==='members'?' is-members':''),dir:'ltr','aria-label':'Club cashier'},
      h('header',{className:'cashier-heading'},h('button',{type:'button','aria-label':tab==='members'?'Back to counter':'Back to lobby',onClick:()=>tab==='members'?changeTab('trade'):onBack?.(),disabled:!!draft},icon('chevron-left')),h('h2',null,tab==='members'?'Club Members':'Counter'),h('button',{type:'button','aria-label':'Refresh counter',onClick:()=>{onRefresh?.();setHistoryVersion(n=>n+1);},disabled:busy||loading},icon('rotate-right'))),
      tab!=='members'&&h('nav',{className:'cashier-tabs','aria-label':'Counter sections'},tabs.map(([id,title])=>h('button',{key:id,type:'button','aria-current':tab===id?'page':undefined,disabled:!!draft,onClick:()=>id==='results'?onSettlement():changeTab(id)},title))),
      h('div',{className:'cashier-content'},
        tab==='trade'&&h('div',{className:'cashier-treasury'},h('div',{className:'cashier-club-balance'},h('span',null,'Club Balance'),h('strong',null,chip(true),canTransfer&&treasury?money(treasury.balance):'—')),h('div',{className:'cashier-totals'},h('div',null,h('span',null,'Total Agent Chips'),h('strong',null,chip(true),money(people.filter(m=>role(m)==='agent').reduce((s,m)=>s+Number(m.balance||0),0)))),h('div',null,h('span',null,'Total Member Chips'),h('strong',null,chip(),money(people.filter(m=>role(m)!=='agent').reduce((s,m)=>s+Number(m.balance||0),0)))))),
        !canTransfer&&h('p',{className:'cashier-help'},'Your assigned players. Transfers are handled by an approved club manager.'),
        tab==='members'&&h('nav',{className:'cashier-tabs sub','aria-label':'Member lists'},h('button',{'aria-current':!applicants?'page':undefined,onClick:()=>setApplicants(false)},'Member List'),h('button',{'aria-current':applicants?'page':undefined,onClick:()=>setApplicants(true)},'Applicants List')),
        error&&h('p',{role:'alert',className:'cashier-warning'},error),
        !draft&&notice&&h('p',{role:'status',className:notice.ok?'cashier-success':'cashier-warning'},notice.text),
        tab!=='history'&&h(root.React.Fragment,null,
          h('div',{className:'cashier-role-tabs','aria-label':'Filter members by role'},[['all','All'],['manager','Manager'],['sa','SA'],['agent','Agent'],['player','Player']].map(([id,title])=>h('button',{key:id,type:'button','aria-pressed':filter===id,onClick:()=>{setFilter(id);setSelected([]);}},title))),
          h('div',{className:'cashier-tools'},h('label',{className:'cashier-search'},icon('magnifying-glass'),h('input',{'aria-label':'Find cashier player',placeholder:tab==='members'?'Search Member Nickname or ID':'Search Member',value:search,onChange:e=>{setSearch(e.target.value);setSelected([]);}})),h('label',{className:'cashier-sort'},icon('arrow-down-wide-short'),h('select',{'aria-label':'Sort cashier players',value:sort,onChange:e=>setSort(e.target.value)},h('option',{value:'balance'},'Chip balance'),h('option',{value:'name'},'Name'),h('option',{value:'result'},'Cycle result')))),
          h('div',{className:'cashier-list-summary'},h('span',null,tab==='members'?'Total members ':'Members ',h('b',null,rows.length)),tab==='trade'&&canTransfer&&h('label',null,h('input',{type:'checkbox','aria-label':'Select all visible members',checked:rows.length>0&&rows.every(m=>selected.includes(m.uid)),disabled:!!draft||loading,onChange:e=>setSelected(e.target.checked?rows.map(m=>m.uid):[])}),picked.length?picked.length+' selected':'Select all')),
          h('div',{className:'cashier-members'},rows.map(memberCard)),!rows.length&&h('p',{className:'cashier-empty'},loading?'Loading members…':'No members match this search.')),
        tab==='history'&&h('section',{className:'cashier-history','aria-label':'Trade records'},historyError?h('div',{role:'alert'},historyError,h('button',{onClick:()=>setHistoryVersion(n=>n+1)},'Retry history')):history===null?h('p',{role:'status'},'Loading trade records…'):history.length?history.map(r=>h('article',{key:r.id},h('div',null,h('strong',null,label(members.find(m=>m.uid===r.targetUid)||{username:r.targetUid})),h('small',null,new Date(r.at).toLocaleString('en-GB',{timeZone:'Asia/Jerusalem'}))),h('div',null,h('b',{className:r.amount>0?'positive':'negative'},(r.amount>0?'+':'')+money(r.amount)),h('small',null,r.amount>0?'Send Out':'Claim Back')))):h('p',{className:'cashier-empty'},'No chip transfers recorded.'))),
      tab==='trade'&&canTransfer&&h('footer',{className:'cashier-footer'},h('button',{type:'button',className:'cashier-claim',disabled:!picked.length||loading||!!draft||!treasury,onClick:()=>open('claim')},'Claim Back'),h('button',{type:'button',className:'cashier-send',disabled:!picked.length||loading||!!draft||!treasury,onClick:()=>open('send')},'Send Out')),
      draft&&h('dialog',{ref:dialog,open:typeof root.HTMLDialogElement?.prototype.showModal!=='function'?true:undefined,className:'cashier-dialog','aria-label':claim?'Claim Back':'Send Out',onCancel:e=>{e.preventDefault();close();}},h('form',{onSubmit:submit},
        h('h2',null,claim?'Claim Back':'Send Out'),h('p',null,batch?'Transfer status':entries.length+' selected member'+(entries.length===1?'':'s')),
        h('p',{className:'cashier-help'},'Transfers move regular wallet chips. Bonus chips, table chips and game profit / loss stay separate.'),
        !batch&&entries.length>1&&h('label',{className:'cashier-same'},'Amount for everyone',h('input',{type:'number',inputMode:'decimal',min:'.01',step:'.01','aria-label':'Amount for everyone',value:draft.same,onChange:e=>setDraft(d=>({...d,same:e.target.value,entries:d.entries.map(v=>({...v,amount:e.target.value}))}))})),
        !batch&&claim&&h('button',{type:'button',className:'cashier-all-available',onClick:()=>setDraft(d=>({...d,entries:d.entries.map(e=>({...e,amount:String(available(people.find(m=>m.uid===e.uid)))}))}))},'Use available balances'),
        h('div',{className:'cashier-review'},batch?batch.items.map(e=>h('div',{key:e.uid,className:'cashier-review-row'},h('span',null,e.name,h('small',null,({done:'Completed',ready:'Not sent',sending:'Checking…',unknown:'Unconfirmed',rejected:'Rejected'})[e.status])),h('strong',null,money(Math.abs(e.amount))))):amounts.map(e=>h('label',{key:e.uid,className:'cashier-review-row'},h('span',null,e.name,h('small',null,'Available '+money(available(e.member||{})))),h('input',{type:'number',inputMode:'decimal',min:'.01',step:'.01','aria-label':'Amount for '+e.name,value:e.amount,onChange:ev=>setDraft(d=>({...d,entries:d.entries.map(v=>v.uid===e.uid?{...v,amount:ev.target.value}:v)})),'aria-invalid':e.amount!==''&&!e.valid})))),
        !batch&&h('div',{className:'cashier-transfer-total'},h('span',null,'Total'),h('strong',null,money(total))),
        !batch&&valid&&h('p',{className:'cashier-preview'},'Club Balance: '+money(treasury.balance)+' → '+money(Number(treasury.balance)+(claim?total:-total))),
        !batch&&!valid&&amounts.some(e=>e.amount!=='')&&h('p',{role:'alert',className:'cashier-warning'},'Use positive amounts with up to 2 decimals, within available player chips and club balance.'),
        notice&&h('p',{role:notice.ok?'status':'alert',className:notice.ok?'cashier-success':'cashier-warning'},notice.text),
        h('div',{className:'cashier-dialog-actions'},!complete&&h('button',{type:'submit',className:claim?'cashier-claim':'cashier-send',disabled:busy||!canTransfer||(batch?batch.items.some(e=>e.status==='rejected'):!valid||loading)},busy?'Processing…':batch?'Retry same transfers':'Confirm '+(claim?'Claim Back':'Send Out')),h('button',{type:'button',disabled:busy||unresolved,onClick:close},complete?'Done':batch?'Close & refresh':'Cancel')))));
  }
  root.ClubCashier={Cashier,available,bonus};
})(window);
