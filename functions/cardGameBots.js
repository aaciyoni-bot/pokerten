'use strict';
// Bounded, deterministic game policies. The caller supplies a redacted botView,
// never the canonical engine. Unknown cards are sampled, not read from the deck.
const C=require('./cardGamesCore');
const ROWS=['top','mid','bot'],CAP={top:3,mid:5,bot:5};
const beats=(c,a,trump)=>c.suit===a.suit&&c.v>a.v||c.suit===trump&&a.suit!==trump;
function random(seed){let n=2166136261;for(const c of seed)n=Math.imul(n^c.charCodeAt(0),16777619);return()=>{n+=0x6D2B79F5;let x=Math.imul(n^n>>>15,1|n);x^=x+Math.imul(x^x>>>7,61|x);return((x^x>>>14)>>>0)/4294967296;};}
function durakMove(t){
 const p=t.players[t.turnUid],hand=p.cards,trump=t.trumpSuit,pairs=t.pairs||[],stock=t.deckCount||0;
 const value=c=>c.v+(c.suit===trump?20:0),play=c=>({op:'play',cardId:c.id});
 const visible=pairs.flatMap(x=>[x.a,x.d].filter(c=>c&&!c.hidden)),ranks=new Set(visible.map(c=>c.v));
 if(p.uid===t.defenderUid){
  const open=pairs.filter(x=>!x.d);
  if(open.some(x=>x.blind)){
   // Challenge only from visible information, never from the face-down rank.
   const known=[...hand,...visible],remaining=[...ranks].reduce((n,v)=>n+4-known.filter(c=>c.v===v).length,0);
   return{op:remaining===0?'challenge':'accept'};
  }
  const active=Object.values(t.players).filter(q=>!q.out&&!q.left).sort((a,b)=>a.seatIndex-b.seatIndex),ix=active.findIndex(q=>q.uid===p.uid),next=active[(ix+1)%active.length];
  if(t.settings.variant==='perevodnoy'&&pairs.length<6&&pairs.every(x=>!x.d)&&next?.cardCount>=pairs.length+1){
   const transfer=hand.filter(c=>pairs.every(x=>x.a.v===c.v)).sort((a,b)=>value(a)-value(b))[0];
   if(transfer)return play(transfer);
  }
  // Plan coverage of every open attack using the same first-match rule as the
  // server. Avoid spending a trump when another suit can cover the whole set.
  let best=null;
  function coverCost(cards,attacks){
   const size=1<<attacks.length,dp=Array(size).fill(Infinity);dp[0]=0;
   for(const c of cards)for(let mask=size-1;mask>=0;mask--)if(Number.isFinite(dp[mask]))for(let i=0;i<attacks.length;i++)if(!(mask&(1<<i))&&beats(c,attacks[i],trump))dp[mask|(1<<i)]=Math.min(dp[mask|(1<<i)],dp[mask]+value(c));
   return dp[size-1];
  }
  for(const card of hand){const ix=open.findIndex(x=>beats(card,x.a,trump));if(ix<0)continue;const cost=value(card)+coverCost(hand.filter(c=>c.id!==card.id),open.filter((_,i)=>i!==ix).map(x=>x.a));if(Number.isFinite(cost)&&(!best||cost<best.cost))best={card,cost};}
  if(!best)return{op:'take'};
  const expensive=best.card.suit===trump&&best.card.v>=12;
  if(stock>6&&open.length===1&&open[0].a.suit!==trump&&open[0].a.v<=9&&hand.length<=6&&expensive)return{op:'take'};
  return play(best.card);
 }
 const legal=hand.filter(c=>!pairs.length||pairs.length<t.roundCap&&ranks.has(c.v));
 if(!legal.length)return{op:'pass'};
 // Duplicate low ranks invite a follow-up; keep trumps for defense. With an
 // empty stock and one or two cards, a strong attack helps finish immediately.
 const endgame=!stock&&hand.length<=2;
 legal.sort((a,b)=>endgame?value(b)-value(a):(value(a)-3*hand.filter(c=>c.v===a.v).length)-(value(b)-3*hand.filter(c=>c.v===b.v).length));
 return play(legal[0]);
}
function combinations(cards,n){const out=[];function walk(start,arr){if(arr.length===n){out.push(arr);return;}for(let i=start;i<=cards.length-(n-arr.length);i++)walk(i+1,[...arr,cards[i]]);}walk(0,[]);return out;}
function evaluator(){
 const cache=new Map();
 return(cards,top=false)=>{
  const key=(top?'t':'f')+cards.map(c=>c.id||c.v+c.suit).sort().join(',');if(cache.has(key))return cache.get(key);
  const fn=top?C.ofcEval3:C.ofcEval5,rest=cards.filter(c=>c.v),jokers=cards.length-rest.length;
  let best;
  if(!jokers)best=fn(cards);
  else{
   // A joker suit matters only for a five-card flush; at most 91 rank pairs
   // replace the 2,704 suit/rank pairs of an exhaustive two-joker evaluator.
   const suit=rest.length&&rest.every(c=>c.suit===rest[0].suit)?rest[0].suit:'♠';
   for(let v=2;v<=14;v++)for(let w=jokers===2?v:2;w<=(jokers===2?14:2);w++){
    const e=fn([...rest,{v,suit},...(jokers===2?[{v:w,suit}]:[])]);if(!best||C.ofcCmp(e,best)>0)best=e;
   }
  }
  cache.set(key,best);return best;
 };
}
const strength=e=>e[0]*3+(e[1]||0)/14+(e[2]||0)/210;
function finalScore(board,ev){
 const t=ev(board.top,true),m=ev(board.mid),b=ev(board.bot);
 if(C.ofcCmp(t,m)>0||C.ofcCmp(m,b)>0)return -120+strength(b)+strength(m)*.1;
 const roy=C.ofcRoyalTop(t)+C.ofcRoyalMid(m)+C.ofcRoyalBot(b);
 const fantasy=board.flC?(t[0]===3||b[0]>=7):t[0]===3||t[0]===1&&t[1]>=12;
 return 40+roy*2+(fantasy?12:0)+strength(t)+strength(m)+strength(b);
}
function partialScore(board,ev){
 if(ROWS.every(r=>board[r].length===CAP[r]))return finalScore(board,ev);
 let score=0;const full={};
 for(const row of ROWS){
  const cards=board[row],space=CAP[row]-cards.length;if(!cards.length)continue;
  if(!space){const e=ev(cards,row==='top');full[row]=e;score+=strength(e)+(row==='top'?C.ofcRoyalTop(e):row==='mid'?C.ofcRoyalMid(e):C.ofcRoyalBot(e))*1.2;continue;}
  const counts={},suits={};let jokers=0;for(const c of cards){if(!c.v){jokers++;continue;}counts[c.v]=(counts[c.v]||0)+1;suits[c.suit]=(suits[c.suit]||0)+1;}
  const groups=Object.entries(counts).sort((a,b)=>b[1]-a[1]||b[0]-a[0]),best=(groups[0]?.[1]||0)+jokers;
  score+=(best>=3?10:best>=2?5:0)+(groups[1]?.[1]>=2?4:0)+jokers*2;
  if(row!=='top'){
   const suited=Math.max(0,...Object.values(suits))+jokers;
   if(suited+space>=5)score+=Math.max(0,suited-1)*1.6*(row==='bot'?1.25:1);
   const ranks=new Set(cards.map(c=>c.v===14?1:c.v).filter(Boolean));let run=0;
   for(let low=1;low<=10;low++){let hits=0;for(let v=low;v<low+5;v++)if(ranks.has(v)||v===14&&ranks.has(1))hits++;run=Math.max(run,hits+jokers);}
   if(run+space>=5)score+=Math.max(0,run-1)*.5;
  }else if(best>=2&&(Number(groups[0]?.[0])>=12||jokers))score+=3;
  score+=cards.reduce((n,c)=>n+(c.v||14),0)/100;
 }
 // Finished lower rows cap every row above. Penalize dead arrangements before
 // searching future draws; unfinished upper rows retain room to improve.
 for(const [upper,lower]of [['top','mid'],['mid','bot'],['top','bot']])if(full[upper]&&full[lower]&&C.ofcCmp(full[upper],full[lower])>0)score-=150;
 if(full.bot&&full.bot[0]===0)score-=12;
 if(full.mid&&full.mid[0]===0&&board.top.length<3)score-=5;
 return score;
}
function placements(board,cards,need){
 const out=[];
 for(const selected of combinations(cards,need)){
  function put(i,rows,stage){if(i===selected.length){out.push({board:rows,stage});return;}
   for(const row of ROWS)if(rows[row].length<CAP[row])put(i+1,{...rows,[row]:[...rows[row],selected[i]]},{...stage,[selected[i].id]:row});
  }
  put(0,board,{});
 }
 return out;
}
function futureDraws(t,p,rng,count){
 const seen=new Set([...p.pending,...p.disc,...ROWS.flatMap(r=>p[r])].map(c=>c.id));
 for(const q of Object.values(t.players))if(q.uid!==p.uid)for(const row of ROWS)for(const c of q[row])if(!c.hidden)seen.add(c.id);
 const pool=[];let i=0;for(const suit of ['♠','♥','♦','♣'])for(let v=2;v<=14;v++){const c={id:'o'+i++,suit,v};if(!seen.has(c.id))pool.push(c);}
 for(const id of ['oj1','oj2'])if(!seen.has(id))pool.push({id,suit:'🃏',v:0});
 for(let k=pool.length-1;k>0;k--){const j=Math.floor(rng()*(k+1));[pool[k],pool[j]]=[pool[j],pool[k]];}
 return Array.from({length:count},(_,j)=>pool.slice(j*3,j*3+3));
}
function rollout(board,draws,ev){
 let beam=[{board,score:partialScore(board,ev)}];
 for(const draw of draws){
  const candidates=beam.flatMap(b=>placements(b.board,draw,2).map(c=>({...c,score:partialScore(c.board,ev)})));
  candidates.sort((a,b)=>b.score-a.score);beam=[];const keys=new Set();
  for(const c of candidates){const key=ROWS.map(r=>c.board[r].map(x=>x.id).sort().join(',')).join('|');if(!keys.has(key)){keys.add(key);beam.push(c);}if(beam.length===4)break;}
 }
 return beam[0]?.score??-200;
}
function fantasyMove(p,ev){
 const cards=p.pending;
 const bottoms=combinations(cards,5).map(bot=>({bot,score:strength(ev(bot))+C.ofcRoyalBot(ev(bot))*2})).sort((a,b)=>b.score-a.score).slice(0,36);
 let best=null;
 for(const {bot}of bottoms){
  const ids=new Set(bot.map(c=>c.id)),rest=cards.filter(c=>!ids.has(c.id)),b=ev(bot);
  const mids=combinations(rest,5).map(mid=>({mid,e:ev(mid)})).filter(x=>C.ofcCmp(x.e,b)<=0).sort((a,b)=>(strength(b.e)+C.ofcRoyalMid(b.e)*2)-(strength(a.e)+C.ofcRoyalMid(a.e)*2)).slice(0,16);
  for(const {mid}of mids){const used=new Set(mid.map(c=>c.id));for(const top of combinations(rest.filter(c=>!used.has(c.id)),3)){
   const board={top,mid,bot,flC:p.flC},score=finalScore(board,ev);if(!best||score>best.score)best={board,score};
  }}
 }
 // Every set has a legal row allocation; pathological unavoidable fouls still
 // produce exactly 13 cards and the engine scores them normally.
 if(!best)best={board:{bot:cards.slice(0,5),mid:cards.slice(5,10),top:cards.slice(10,13)}};
 return Object.fromEntries(ROWS.flatMap(r=>best.board[r].map(c=>[c.id,r])));
}
function ofcMove(t){
 const p=t.players[t.turnUid],ev=evaluator();
 if(p.flC)return fantasyMove(p,ev);
 const board={top:p.top,mid:p.mid,bot:p.bot,flC:0},need=t.street===0?5:2;
 const candidates=placements(board,p.pending,need).map(c=>({...c,score:partialScore(c.board,ev)})).sort((a,b)=>b.score-a.score);
 if(!candidates.length)throw new Error('No legal OFC placement');
 const left=4-t.street;
 if(!left){
  // Final joker assignments are scored by the authoritative joint evaluator,
  // which can select a weaker wildcard value to keep all three rows legal.
  for(const c of candidates){const b=C.ofcBoard(c.board);c.score=b.foul?-1000:40+b.roy*2+(b.flNext?12:0)+strength(b.t)+strength(b.m)+strength(b.b);}
  return candidates.sort((a,b)=>b.score-a.score)[0].stage;
 }
 const rng=random(p.pending.map(c=>c.id).join(',')+JSON.stringify(board)),draws=Array.from({length:4},()=>futureDraws(t,p,rng,left));
 let best=null;
 for(const c of candidates.slice(0,t.street===0?16:12)){
  const score=draws.reduce((n,d)=>n+rollout(c.board,d,ev),0)/draws.length+c.score*.03;
  if(!best||score>best.score)best={...c,score};
 }
 return best.stage;
}
module.exports={durakMove,ofcMove};
