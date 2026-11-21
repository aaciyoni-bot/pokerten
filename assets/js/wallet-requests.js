(function(root) {
  'use strict';
  function WalletRequests({clubId, uid, call, queue=false, refreshBalance}) {
    const {createElement:h,useState,useEffect,useRef} = root.React;
    const [rows,setRows] = useState([]), [amount,setAmount] = useState(''), [direction,setDirection] = useState('deposit');
    const [version,refresh] = useState(0), [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
    const [loading,setLoading] = useState(true), [complete,setComplete] = useState(false);
    const [filter,setFilter] = useState('all'), [search,setSearch] = useState('');
    const lock = useRef(false), alive = useRef(true);
    const storageKey = 'pk-wallet-request:'+clubId+':'+uid;
    useEffect(() => {alive.current=true;return () => {alive.current=false;};},[]);
    useEffect(() => {
      let active = true;
      setLoading(true);setComplete(false);
      (async () => {
        const loaded=[], seen=new Set();
        let cursor;
        do {
          const page=await call('pkWalletRequests',{clubId,queue,...(cursor ? {cursor} : {})});
          if (!active) return;
          if (!Array.isArray(page?.rows) || (page.nextCursor && seen.has(page.nextCursor))) throw Error('Could not read wallet requests.');
          loaded.push(...page.rows);cursor=page.nextCursor;seen.add(cursor);
        } while (cursor);
        setRows(loaded);setComplete(true);
      })().catch(e => {if(active)setMessage(e.message || 'Could not read requests.');}).finally(() => {if(active)setLoading(false);});
      return () => {active=false;};
    },[clubId,uid,queue,version]);
    const submit = async (op,row) => {
      if(lock.current) return;
      lock.current=true;setBusy(true);setMessage('');
      try {
        let payload={clubId,op};
        if(op === 'submit') {
          const value=Number(amount);
          if (!Number.isFinite(value) || value < .01 || value > 10000000 || Math.abs(Math.round(value*100)-value*100)>1e-6) throw Error('Enter a chip amount with up to two decimal places.');
          const saved=JSON.parse(root.sessionStorage.getItem(storageKey)||'null');
          const requestId=saved?.direction===direction && saved?.amount===value ? saved.requestId : root.crypto.randomUUID();
          payload={...payload,direction,amount:value,requestId};
          root.sessionStorage.setItem(storageKey,JSON.stringify(payload));
        } else payload.id=row.id;
        await call('pkWalletRequest',payload);
        if(op==='submit')root.sessionStorage.removeItem(storageKey);
        if(alive.current) {setAmount('');setMessage(op==='submit'?'Request submitted.':op==='approve'?'Transfer approved.':'Request rejected.');refresh(n=>n+1);refreshBalance?.();}
      } catch(e) {if(alive.current){setMessage(e.message || 'Request could not be confirmed. Refresh to check its status.');refresh(n=>n+1);}}
      finally {lock.current=false;if(alive.current)setBusy(false);}
    };
    const button='btn-outline rounded-xl px-3 py-2', input='bg-slate-900 rounded-lg px-2 py-2 text-white border border-white/20';
    const visible=rows.filter(r=>(filter==='all'||r.status===filter)&&[r.id,r.name,r.direction,r.amount].some(v=>String(v).toLowerCase().includes(search.trim().toLowerCase())));
    return h('section',{className:'glass-panel p-4 my-3 rounded-xl space-y-3','aria-label':queue?'Club transfer requests':'My transfer requests'},
      h('h3',{className:'font-bold'},queue?'Pending transfer requests':'My chip requests'),
      !queue&&h('form',{className:'flex gap-2 flex-wrap',onSubmit:e=>{e.preventDefault();submit('submit');}},
        h('select',{'aria-label':'Request type',className:input,value:direction,onChange:e=>setDirection(e.target.value)},h('option',{value:'deposit'},'Add chips'),h('option',{value:'withdraw'},'Withdraw chips')),
        h('input',{className:input,'aria-label':'Chip amount',type:'number',inputMode:'decimal',min:.01,max:10000000,step:.01,required:true,value:amount,onChange:e=>setAmount(e.target.value),placeholder:'Chips'}),
        h('button',{type:'submit',className:button,disabled:busy||!complete||rows.some(r=>r.status==='pending')},'Send request'),
        h('p',{className:'text-xs w-full'},'0.01–10,000,000 chips per request. No fee. Withdrawals use available regular chips when approved.')),
      h('button',{className:button,type:'button',disabled:loading||busy,onClick:()=>{setMessage('');refresh(n=>n+1);}},'Refresh requests'),
      loading&&h('p',{role:'status'},'Loading requests…'),message&&h('p',{role:'status'},message),
      rows.length>0&&h('div',{className:'flex flex-wrap gap-2'},h('input',{className:input,'aria-label':'Search requests',placeholder:'Search requests',value:search,onChange:e=>setSearch(e.target.value)}),
        !queue&&h('select',{className:input,'aria-label':'Request status',value:filter,onChange:e=>setFilter(e.target.value)},['all','pending','approved','rejected'].map(s=>h('option',{key:s,value:s},s)))),
      complete&&!visible.length&&h('p',null,rows.length?'No matching requests.':'No requests.'),
      visible.map(r=>h('article',{key:r.id,className:'border-t border-white/10 pt-2'},h('strong',null,(queue?r.name+' · ':'')+(r.direction==='withdraw'?'Withdraw':'Add')+' '+r.amount.toLocaleString('en-US')+' chips'),
        h('p',{className:'text-xs'},new Date(r.createdAt).toLocaleString()+' · '+r.status),
        h('details',null,h('summary',null,'Request details'),h('p',null,'Reference '+r.id),h('p',null,'Fee '+r.fee),r.reviewedAt&&h('p',null,'Reviewed '+new Date(r.reviewedAt).toLocaleString())),
        queue&&h('div',{className:'flex gap-2'},['approve','reject'].map(op=>h('button',{key:op,type:'button',className:button,disabled:busy||loading,onClick:()=>submit(op,r)},op==='approve'?'Approve':'Reject'))))));
  }
  function AccountMovements({clubId,call}) {
    const {createElement:h,useState,useEffect}=root.React;
    const [open,setOpen]=useState(false),[records,setRecords]=useState(null),[error,setError]=useState(''),[revision,retry]=useState(0);
    const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(30);
    useEffect(()=>{
      if(!open)return;
      let active=true;
      setRecords(null);setError('');
      (async()=>{
        let cursor;
        const loaded=[],seen=new Set();
        do {
          const page=await call('pkWalletHistory',{clubId,...(cursor?{cursor}:{})});
          if(!active)return;
          if(!Array.isArray(page?.records)||(page.nextCursor&&seen.has(page.nextCursor)))throw Error('Incomplete history.');
          loaded.push(...page.records);cursor=page.nextCursor;seen.add(cursor);
        }while(cursor);
        setRecords(loaded.sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)));
      })().catch(()=>{if(active)setError('Could not load your account history.');});
      return ()=>{active=false;};
    },[open,revision,clubId]);
    const date=r=>r.at?new Date(r.at).toISOString():'';
    const rows=(records||[]).filter(r=>(filter==='all'||(filter==='in'?r.amount>0:r.amount<0))&&[r.id,r.type,date(r),r.amount].some(v=>String(v).toLowerCase().includes(search.trim().toLowerCase())));
    const exportCsv=()=>{
      const csv=[['Reference','Date (UTC)','Type','Chips'],...rows.map(r=>[r.id,date(r),r.type,r.amount])].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download='pokerten-chip-movements.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    };
    const button='btn-outline rounded-lg px-3 py-2',input='bg-slate-900 rounded-lg p-2';
    return h('section',{className:'glass-panel p-4 rounded-xl my-3'},h('button',{type:'button',className:button,'aria-expanded':open,onClick:()=>setOpen(!open)},'Account movements'),
      open&&h(root.React.Fragment,null,error?h('p',{role:'alert'},error,h('button',{className:button,onClick:()=>retry(n=>n+1)},'Retry')):records===null?h('p',{role:'status'},'Loading account history…'):
        h(root.React.Fragment,null,h('div',{className:'flex flex-wrap gap-2 my-2'},
          h('input',{className:input,'aria-label':'Search account movements',placeholder:'Date, amount or reference',value:search,onChange:e=>{setSearch(e.target.value);setLimit(30);}}),
          h('select',{className:input,'aria-label':'Movement direction',value:filter,onChange:e=>{setFilter(e.target.value);setLimit(30);}},[['all','All movements'],['in','Chips in'],['out','Chips out']].map(([v,label])=>h('option',{key:v,value:v},label))),
          h('button',{className:button,disabled:!rows.length,onClick:exportCsv},'Export CSV')),
          !rows.length&&h('p',null,'No matching movements.'),
          rows.slice(0,limit).map(r=>h('details',{key:r.id,className:'border-t border-white/10 py-2'},h('summary',null,(r.at?new Date(r.at).toLocaleDateString():'')+' · '+r.type+' · '+(r.amount>0?'+':'')+r.amount),h('p',null,date(r)),h('p',null,'Reference '+r.id))),
          rows.length>limit&&h('button',{className:button,onClick:()=>setLimit(limit+30)},'Show more'))));
  }
  root.AccountMovements=AccountMovements;
  root.WalletRequests=WalletRequests;
})(window);
