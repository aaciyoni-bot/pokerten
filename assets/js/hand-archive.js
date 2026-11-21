(function(root){
 'use strict';
 function CashSessions({clubId,call}){
  const {createElement:h,useState,useRef}=root.React;
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(undefined);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),running=useRef(false);
  async function more(){
   if(running.current||cursor===null)return;
   running.current=true;setBusy(true);setError(false);
   try{
    const result=await call('pkMyHands',{clubId,view:'sessions',...(cursor?{cursor}:{})});
    if(!Array.isArray(result.rows)||result.nextCursor===cursor)throw Error();
    setRows(previous=>[...previous,...result.rows]);setCursor(result.nextCursor);
   }catch{setError(true);}finally{running.current=false;setBusy(false);}
  }
  const signed=n=>(n>0?'+':'')+n.toLocaleString(undefined,{maximumFractionDigits:2});
  return h('details',{className:'my-3',onToggle:e=>{if(e.currentTarget.open&&cursor===undefined)more();}},
   h('summary',null,'Cash sessions'),
   rows.map(r=>h('section',{key:r.id,className:'border-t border-white/10 py-2'},
    h('strong',null,r.name),h('p',null,(r.partialStart?'Tracked from ':'Seated ')+new Date(r.since).toLocaleString()),
    h('p',null,'Last recorded hand '+new Date(r.through).toLocaleString()),
    h('p',null,r.hands+' hands · '+r.winningHands+' won · Net '+signed(r.netCents/100)),
    r.measuredHands<r.hands&&h('small',null,'Net includes '+r.measuredHands+' hands with a recorded opening stack.'))),
   !rows.length&&cursor===null&&h('p',null,'No cash sessions recorded yet.'),
   error&&h('p',{role:'alert'},'Could not load cash sessions.'),
   cursor!==null&&h('button',{type:'button',className:'btn-outline px-3 py-2 rounded-xl',disabled:busy,onClick:more},busy?'Loading…':error?'Retry':'Load cash sessions'));
 }
 function HandArchive({clubId,call}){
  const {createElement:h,useState,useRef}=root.React;
  const [open,setOpen]=useState(false),[hands,setHands]=useState([]),[page,setPage]=useState(undefined);
  const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[selected,select]=useState('all'),[current,setCurrent]=useState(null);
  const running=useRef(false);
  async function load(){
   if(running.current||page===null)return;
   running.current=true;setBusy(true);setErr('');
   try{const r=await call('pkMyHands',{clubId,...(page?{cursor:page}:{})});
    if(!Array.isArray(r.rows)||r.nextCursor===page)throw Error();
    setHands(old=>[...old,...r.rows]);setPage(r.nextCursor);
   }catch(_){setErr('Could not load hands.');}finally{running.current=false;setBusy(false);}
  }
  const names=new Map(hands.map(r=>[r.table,r.name])),filtered=hands.filter(r=>selected==='all'||r.table===selected);
  let total=0;const scores=[0];
  for(const r of [...filtered].reverse())if(!r.tournament&&Number.isFinite(r.result)){total=Math.round((total+r.result)*100)/100;scores.push(total);}
  const hi=Math.max(...scores),lo=Math.min(...scores),points=scores.map((v,i)=>[2+296*i/(scores.length-1||1),56-52*(v-lo)/(hi-lo||1)].join(',')).join(' ');
  const b='btn-outline px-3 py-2 rounded-xl';
  return h('section',{className:'glass-panel rounded-xl p-4 my-3'},h('button',{className:b,'aria-expanded':open,onClick:()=>{setOpen(!open);if(!open&&page===undefined)load();}},'My hand archive'),
   open&&h(root.React.Fragment,null,h(CashSessions,{clubId,call}),h('p',{className:'text-xs my-2'},'Hands recorded since the archive was enabled.'),
    hands.length>0&&h('select',{className:'bg-slate-900 p-2','aria-label':'Filter by table',value:selected,onChange:e=>{select(e.target.value);setCurrent(null);}},h('option',{value:'all'},'All tables'),[...names].map(([id,n])=>h('option',{key:id,value:id},n))),
    scores.length>1&&h('figure',{className:'my-2'},h('figcaption',null,'Cash result · loaded hands: '+(total>0?'+':'')+total),h('svg',{viewBox:'0 0 300 60',width:'100%',height:60,role:'img','aria-label':'Cumulative cash results over '+(scores.length-1)+' loaded hands'},h('polyline',{points,fill:'none',stroke:'#65d9db',strokeWidth:2}))),
    filtered.map(r=>h('article',{key:r.id,className:'border-t border-white/10 py-2'},h('button',{className:'text-left',onClick:()=>setCurrent(current?.id===r.id?null:{id:r.id,step:0})},new Date(r.at).toLocaleString()+' · '+r.game+' · Hand '+r.hand),
      current?.id===r.id&&h('div',null,h('p',null,r.name),r.actions.slice(0,current.step).map((a,i)=>h('p',{key:i},a.street+' · '+a.name+' · '+a.action+(a.amount?' '+a.amount:''))),
       current.step<r.actions.length?h('button',{className:b,onClick:()=>setCurrent({id:r.id,step:current.step+1})},'Next action'):h('p',null,[r.board.join(' '),r.board2.join(' '),(r.board3||[]).join(' '),r.winners+' · '+r.amount].filter(Boolean).join(' / ')),
       current.step>0&&h('button',{className:b,onClick:()=>setCurrent({id:r.id,step:0})},'Replay')))),
    !busy&&!err&&page===null&&!hands.length&&h('p',null,'No archived hands yet.'),err&&h('p',{role:'alert'},err),
    page!==null&&h('button',{className:b,disabled:busy,onClick:load},busy?'Loading…':err?'Retry':'Load more hands')));}
 root.HandArchive=HandArchive;
})(window);
