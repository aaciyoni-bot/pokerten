/* Central club cashier. Transfers use the existing server ledger; no balance migration. */
(function(root){
  'use strict';
  const money=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const round=n=>Math.round(n*100)/100;
  const bonus=m=>round(Math.max(0,Math.min(Number(m.balance)||0,Number(m.bonusOpen??m.bonusTotal)||0)));
  const available=m=>round(Math.max(0,(Number(m.balance)||0)-bonus(m)));
  function Cashier({members=[],treasury,accounting,loading,error,onRefresh,canTransfer=false,clubId,call}){
    const {createElement:h,useState,useRef}=root.React;
    const [search,setSearch]=useState(''),[sort,setSort]=useState('name'),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null);
    const lock=useRef(false),request=useRef(null);
    const rows=members.filter(m=>!m.isBot&&!String(m.uid).startsWith('bot_')&&m.uid!==treasury?.uid&&['approved','banned'].includes(m.status))
      .filter(m=>[m.username,m.playerId,m.uid].some(v=>String(v||'').toLowerCase().includes(search.trim().toLowerCase())))
      .sort((a,b)=>sort==='balance'?available(b)-available(a):sort==='result'?(accounting?.players?.[b.uid]?.result??-Infinity)-(accounting?.players?.[a.uid]?.result??-Infinity):String(a.username||'').localeCompare(String(b.username||'')));
    const select=(m,direction)=>{if(lock.current||request.current)return;setDraft({uid:m.uid,name:m.username||m.playerId||'Player',direction,amount:''});setNotice(null);};
    const member=members.find(m=>m.uid===draft?.uid),amount=Number(draft?.amount),claim=draft?.direction==='claim';
    const valid=member&&draft.amount.trim()!==''&&Number.isFinite(amount)&&amount>0&&amount<=10000000&&Math.abs(round(amount)-amount)<1e-7&&
      (claim?amount<=available(member):member.status==='approved'&&treasury&&amount<=Number(treasury.balance));
    const submit=async e=>{
      e.preventDefault();if(lock.current||!canTransfer||(!request.current&&!valid))return;
      const payload=request.current||{clubId,targetUid:draft.uid,op:'cashier-transfer',amount:claim?-amount:amount,requestId:root.crypto.randomUUID()};
      request.current=payload;lock.current=true;setBusy(true);setNotice(null);
      try{await call('pkClubMember',payload);request.current=null;setDraft(null);setNotice({ok:true,text:(payload.amount>0?'Send Out':'Claim Back')+' completed · '+money(Math.abs(payload.amount))+' · '+draft.name});onRefresh?.();}
      catch(e){
        const definitive=/^(?:functions\/)?(?:invalid-argument|failed-precondition|permission-denied|unauthenticated|not-found|resource-exhausted)$/.test(e.code||'');
        if(definitive)request.current=null;
        setNotice({ok:false,text:definitive?(e.message||'Transfer rejected. Refresh the balances and try again.'):'The transfer could not be confirmed. Retry checks the same transfer without sending it twice.'});
      }finally{lock.current=false;setBusy(false);}
    };
    const value=(label,n,signed=false)=>h('div',{className:'cashier-number'},h('span',null,label),h('strong',{className:signed&&Number.isFinite(n)?(n<0?'negative':'positive'):''},Number.isFinite(n)?(signed&&n>0?'+':'')+money(n):'—'));
    return h('section',{className:'club-cashier',dir:'ltr','aria-label':'Club cashier'},
      h('header',{className:'cashier-heading'},h('div',null,h('small',null,'CLUB COUNTER'),h('h2',null,'Cashier'),h('p',null,'Player balances, cycle results and chip transfers in one place.')),h('button',{type:'button',onClick:onRefresh,disabled:busy||loading},loading?'Refreshing…':'Refresh')),
      h('div',{className:'cashier-treasury'},value('Club treasury',canTransfer&&treasury?Number(treasury.balance):null),h('p',null,canTransfer?'Send Out adds regular chips. Claim Back returns available regular chips to the club.':'Your assigned players. Chip transfers are handled by an approved club manager.')),
      h('p',{className:'cashier-explainer'},'Transfers do not change game profit / loss. Bonus chips are shown separately and cannot be claimed here. Chips at tables stay at the table.'),
      accounting?.needsPeriodStart&&h('p',{role:'status',className:'cashier-warning'},'Set the cycle start in Settlement to see cycle results. Available balances can still be used.'),
      error&&h('p',{role:'alert',className:'cashier-warning'},error,' Refresh to update the results.'),
      notice&&h('p',{role:notice.ok?'status':'alert',className:notice.ok?'cashier-success':'cashier-warning'},notice.text),
      h('div',{className:'cashier-tools'},h('input',{'aria-label':'Find cashier player',placeholder:'Search name or player ID',value:search,onChange:e=>setSearch(e.target.value),disabled:!!draft}),h('select',{'aria-label':'Sort cashier players',value:sort,onChange:e=>setSort(e.target.value)},h('option',{value:'name'},'Name'),h('option',{value:'balance'},'Available chips'),h('option',{value:'result'},'Cycle result'))),
      h('p',{className:'cashier-count'},rows.length+' players'),
      h('div',{className:'cashier-members'},rows.map(m=>{
        const a=accounting?.players?.[m.uid],editing=draft?.uid===m.uid;
        return h('article',{key:m.uid,className:'cashier-member','data-player-id':m.uid},
          h('div',{className:'cashier-person'},h('div',null,h('h3',null,m.username||'Player'),h('small',null,'ID: '+(m.playerId||'—')+(m.status==='banned'?' · Banned':''))),h('div',{className:'cashier-actions'},canTransfer&&h(root.React.Fragment,null,
            h('button',{type:'button','aria-label':'Send Out to '+(m.username||m.uid),disabled:!!draft||!treasury||m.status!=='approved',onClick:()=>select(m,'send'),className:'cashier-send'},'Send Out'),
            h('button',{type:'button','aria-label':'Claim Back from '+(m.username||m.uid),disabled:!!draft||!treasury||available(m)<=0,onClick:()=>select(m,'claim')},'Claim Back')))),
          h('div',{className:'cashier-numbers'},value('Available',available(m)),value('Bonus in wallet',bonus(m)),value('At tables',error?null:a?.onTables),value('Cycle result',error?null:a?.result,true)),
          Number(m.promoBalance)>0&&h('small',{className:'cashier-legacy'},'Legacy bonus wallet: '+money(m.promoBalance)+' · separate from available chips'),
          editing&&h('form',{className:'cashier-transfer',onSubmit:submit,'aria-label':(claim?'Claim Back':'Send Out')+' '+draft.name},
            h('strong',null,(claim?'Claim Back from ':'Send Out to ')+draft.name),
            h('label',null,'Amount',h('input',{'aria-label':'Cashier amount',type:'number',inputMode:'decimal',min:'0.01',step:'0.01',max:'10000000',autoFocus:true,value:draft.amount,disabled:busy||!!request.current,onChange:e=>{setDraft(d=>({...d,amount:e.target.value}));setNotice(null);}})),
            valid&&h('p',{className:'cashier-preview'},'Player wallet: '+money(member.balance)+' → '+money(Number(member.balance)+(claim?-amount:amount))+' · Club: '+money(treasury.balance)+' → '+money(Number(treasury.balance)+(claim?amount:-amount))),
            !valid&&draft.amount!==''&&!request.current&&h('p',{role:'alert'},'Enter a positive amount with up to 2 decimal places within the available balance.'),
            h('div',{className:'cashier-actions'},h('button',{type:'submit',disabled:busy||(!request.current&&!valid),'aria-busy':busy,className:'cashier-send'},busy?'Processing…':request.current?'Retry same transfer':'Confirm '+(claim?'Claim Back':'Send Out')),h('button',{type:'button',disabled:busy||!!request.current,onClick:()=>{setDraft(null);setNotice(null);}},'Cancel'))));
      })),!rows.length&&h('p',{className:'cashier-empty'},'No players match this search.'));
  }
  root.ClubCashier={Cashier};
})(window);
