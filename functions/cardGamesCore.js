'use strict';
const crypto=require('node:crypto');
const ofcName = v => v === 0 ? '🃏' : v === 14 ? 'A' : v === 13 ? 'K' : v === 12 ? 'Q' : v === 11 ? 'J' : String(v);
const ofcDeck = () => {
  const suits = ['♠', '♥', '♦', '♣'];
  let d = [],
    i = 0;
  for (const suit of suits) for (let v = 2; v <= 14; v++) d.push({
    id: `o${i++}`,
    suit,
    v
  });
  d.push({
    id: 'oj1',
    suit: '🃏',
    v: 0
  });
  d.push({
    id: 'oj2',
    suit: '🃏',
    v: 0
  });
  for (let k = d.length - 1; k > 0; k--) {
    const j = crypto.randomInt(k + 1);
    [d[k], d[j]] = [d[j], d[k]];
  }
  return d;
};
const OFC_ALL52 = (() => {
  const a = [];
  for (const su of ['♠', '♥', '♦', '♣']) for (let v = 2; v <= 14; v++) a.push({
    v,
    suit: su
  });
  return a;
})();
const ofcEval5 = cards => {
  const vs = cards.map(c => c.v).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const flush = suits.every(su => su === suits[0]);
  const uniq = [...new Set(vs)];
  let straightHi = 0;
  if (uniq.length === 5) {
    if (vs[0] - vs[4] === 4) straightHi = vs[0];else if (vs.join() === '14,5,4,3,2') straightHi = 5;
  }
  const cnt = {};
  vs.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
  const groups = Object.entries(cnt).map(([v, n]) => [Number(v), n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (flush && straightHi) return [8, straightHi];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...vs];
  if (straightHi) return [4, straightHi];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(g => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map(g => g[0])];
  return [0, ...vs];
};
const ofcEval3 = cards => {
  const vs = cards.map(c => c.v).sort((a, b) => b - a);
  const cnt = {};
  vs.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
  const groups = Object.entries(cnt).map(([v, n]) => [Number(v), n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0][1] === 3) return [3, groups[0][0]];
  if (groups[0][1] === 2) return [1, groups[0][0], groups[1][0]];
  return [0, ...vs];
};
const ofcCmp = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
};
const ofcEval5J = cards => {
  const jok = cards.filter(c => c.v === 0),
    rest = cards.filter(c => c.v !== 0);
  if (!jok.length) return ofcEval5(cards);
  let best = null;
  if (jok.length === 1) {
    for (const r of OFC_ALL52) {
      const e = ofcEval5([...rest, r]);
      if (!best || ofcCmp(e, best) > 0) best = e;
    }
  } else {
    for (const r1 of OFC_ALL52) for (const r2 of OFC_ALL52) {
      const e = ofcEval5([...rest, r1, r2]);
      if (!best || ofcCmp(e, best) > 0) best = e;
    }
  }
  return best;
};
const ofcEval3J = cards => {
  const jok = cards.filter(c => c.v === 0),
    rest = cards.filter(c => c.v !== 0);
  if (!jok.length) return ofcEval3(cards);
  let best = null;
  if (jok.length === 1) {
    for (const r of OFC_ALL52) {
      const e = ofcEval3([...rest, r]);
      if (!best || ofcCmp(e, best) > 0) best = e;
    }
  } else {
    for (const r1 of OFC_ALL52) for (const r2 of OFC_ALL52) {
      const e = ofcEval3([...rest, r1, r2]);
      if (!best || ofcCmp(e, best) > 0) best = e;
    }
  }
  return best;
};
const ofcRoyalBot = ev => ev[0] === 8 ? ev[1] === 14 ? 25 : 15 : ev[0] === 7 ? 10 : ev[0] === 6 ? 6 : ev[0] === 5 ? 4 : ev[0] === 4 ? 2 : 0;
const ofcRoyalMid = ev => ev[0] === 8 ? ev[1] === 14 ? 50 : 30 : ev[0] === 7 ? 20 : ev[0] === 6 ? 12 : ev[0] === 5 ? 8 : ev[0] === 4 ? 4 : ev[0] === 3 ? 2 : 0;
const ofcRoyalTop = ev => ev[0] === 3 ? ev[1] - 2 + 10 : ev[0] === 1 && ev[1] >= 6 ? ev[1] - 5 : 0;
const ofcBoardBetter = (A, B) => {
  if (!B) return true;
  if (!A) return false;
  if (A.foul !== B.foul) return !A.foul;
  if (A.roy !== B.roy) return A.roy > B.roy;
  let c = ofcCmp(A.b, B.b);
  if (c) return c > 0;
  c = ofcCmp(A.m, B.m);
  if (c) return c > 0;
  c = ofcCmp(A.t, B.t);
  if (c) return c > 0;
  return (A.flNext || 0) > (B.flNext || 0);
};
const ofcBoard = p => {
  const top = [...(p.top || [])],
    mid = [...(p.mid || [])],
    bot = [...(p.bot || [])];
  const slots = [];
  top.forEach((c, i) => {
    if (c.v === 0) slots.push(['top', i, c.id]);
  });
  mid.forEach((c, i) => {
    if (c.v === 0) slots.push(['mid', i, c.id]);
  });
  bot.forEach((c, i) => {
    if (c.v === 0) slots.push(['bot', i, c.id]);
  });
  const scoreOf = assign => {
    const T = [...top],
      M = [...mid],
      B = [...bot],
      byRow = {
        top: T,
        mid: M,
        bot: B
      };
    slots.forEach((s, k) => {
      byRow[s[0]][s[1]] = assign[k];
    });
    const t = T.length === 3 ? ofcEval3(T) : ofcEval3J(T);
    const m = M.length === 5 ? ofcEval5(M) : ofcEval5J(M);
    const b = B.length === 5 ? ofcEval5(B) : ofcEval5J(B);
    const foul = ofcCmp(t, m) > 0 || ofcCmp(m, b) > 0;
    const roy = foul ? 0 : ofcRoyalTop(t) + ofcRoyalMid(m) + ofcRoyalBot(b);
    let flNext = 0;
    if (!foul) {
      if (p.flC) {
        if (t[0] === 3 || b[0] >= 7) flNext = 14;
      } else if (t[0] === 3) flNext = 16;else if (t[0] === 1 && t[1] >= 12) flNext = t[1] === 12 ? 14 : t[1] === 13 ? 15 : 16;
    }
    return {
      t,
      m,
      b,
      foul,
      roy,
      flNext,
      assign
    };
  };
  let best = null;
  if (!slots.length) best = scoreOf([]);else {
    const rec = (k, cur) => {
      if (k === slots.length) {
        const r = scoreOf(cur);
        if (ofcBoardBetter(r, best)) best = r;
        return;
      }
      for (const c of OFC_ALL52) {
        cur.push(c);
        rec(k + 1, cur);
        cur.pop();
      }
    };
    rec(0, []);
  }
  const resolved = {};
  slots.forEach((s, k) => {
    resolved[s[2]] = best.assign[k];
  });
  return {
    t: best.t,
    m: best.m,
    b: best.b,
    foul: best.foul,
    roy: best.roy,
    flNext: best.flNext,
    resolved
  };
};
const ofcHandName = (ev, isTop) => {
  if (!ev) return '';
  const n = ofcName(ev[1] || 0);
  if (isTop) return ev[0] === 3 ? `Three ${n}s` : ev[0] === 1 ? `Pair of ${n}` : `${n} high`;
  switch (ev[0]) {
    case 8:
      return ev[1] === 14 ? 'Royal Flush! 👑' : 'Straight Flush';
    case 7:
      return `Four ${n}s`;
    case 6:
      return 'Full House';
    case 5:
      return 'Flush';
    case 4:
      return 'Straight';
    case 3:
      return `Three ${n}s`;
    case 2:
      return 'Two Pair';
    case 1:
      return `Pair of ${n}`;
    default:
      return `${n} high`;
  }
};

const cents=n=>Math.round(n*100),cash=n=>Math.round(n*100)/100;
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const clone=t=>JSON.parse(JSON.stringify(t));
const ordered=t=>Object.values(t.players).filter(p=>!p.left).sort((a,b)=>a.seatIndex-b.seatIndex);
const active=t=>ordered(t).filter(p=>!p.out);
const next=(t,uid)=>{const arr=active(t),seat=t.players[uid]?.seatIndex??-1;return(arr.find(p=>p.seatIndex>seat)||arr.find(p=>p.uid!==uid))?.uid||null;};
const beats=(c,a,trump)=>c.suit===a.suit&&c.v>a.v||c.suit===trump&&a.suit!==trump;
const ranks=pairs=>new Set(pairs.flatMap(p=>p.d?[p.a.v,p.d.v]:[p.a.v]));
const placed=p=>(p.top||[]).length+(p.mid||[]).length+(p.bot||[]).length;
function split(total,weights){
 const entries=Object.entries(weights).filter(([,n])=>n>0),sum=entries.reduce((n,[,v])=>n+v,0),result={};let used=0;
 for(const [id,v]of entries){result[id]=Math.floor(total*v/sum);used+=result[id];}
 for(let i=0;used<total;i++,used++)result[entries[i%entries.length][0]]++;
 return result;
}
function newTable(type,settings,hostUid,clubId,now){return{type,settings,hostUid,clubId,authorityVersion:2,cardGameVersion:1,createdAt:now,status:'setup',players:{},deck:[],pairs:[],pot:0,street:0,seq:0,handN:0,chat:[],waitlist:[],turnUid:null,turnStartedAt:null,lastResults:null,finishOrder:[],discard:0,trumpCard:null,trumpSuit:null};}
function begin(t,now){
 assert(['setup','showdown'].includes(t.status),'Game already running');
 const ps=ordered(t).filter(p=>t.type==='durak'||p.stack>0);assert(ps.length>=2,'Need at least two players with chips');
 // Keep zero-stack seats visible for cash-out/rebuy; only funded seats play.
 for(const p of Object.values(t.players))p.inHand=ps.includes(p);
 t.handN++;t.status='playing';t.lastResults=null;t.showdownAt=null;t.street=0;t.turnStartedAt=now;t.finishOrder=[];t.pairs=[];t.passed=[];t.discard=0;
 if(t.type==='durak'){
  const deck=[];for(const suit of ['♠','♥','♦','♣'])for(let v=t.settings.deckSize===52?2:6;v<=14;v++)deck.push({id:ofcName(v)+suit,v,val:ofcName(v),suit});
  for(let i=deck.length-1;i>0;i--){const j=crypto.randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  ps.forEach(p=>{p.cards=[];p.out=false;p.left=false;});
  for(let i=0;i<6;i++)for(const p of ps)p.cards.push(deck.pop());
  // Six players with 36 cards leaves no stock: the final dealt card fixes trump.
  t.trumpCard=deck[0]||ps.at(-1).cards.at(-1);t.trumpSuit=t.trumpCard.suit;t.deck=deck;
  t.attackerUid=ps.reduce((best,p)=>{const v=Math.min(99,...p.cards.filter(c=>c.suit===t.trumpSuit).map(c=>c.v));return v<best.v?{uid:p.uid,v}:best;},{uid:ps[0].uid,v:99}).uid;
  t.defenderUid=next(t,t.attackerUid);t.turnUid=t.attackerUid;t.roundCap=6;t.pot=cash(t.settings.buyIn*ps.length);
 }else{
  ps.forEach(p=>Object.assign(p,{top:[],mid:[],bot:[],pending:[],disc:[],flC:p.flNext||0,flNext:0,left:false}));
  t.deck=ofcDeck();t.turnUid=ps[0].uid;ps[0].pending=t.deck.splice(0,ps[0].flC||5);
 }
 return t;
}
function endDurak(t,loser,now){
 const ps=Object.values(t.players).filter(p=>p.inHand),winners=ps.filter(p=>!p.left&&p.uid!==loser);
 const pot=cents(t.pot),rake=Math.min(pot,Math.round(pot*t.settings.rakePercent/100));
 assert(winners.length>0,'No winner available');const awards=split(pot-rake,Object.fromEntries(winners.map(p=>[p.uid,1])));
 t.settlement={rake:rake/100,awards:Object.fromEntries(ps.map(p=>[p.uid,(awards[p.uid]||0)/100])),profits:Object.fromEntries(ps.map(p=>[p.uid,((awards[p.uid]||0)-cents(t.settings.buyIn))/100]))};
 t.lastResults={durakName:loser?t.players[loser]?.name:null,winners:winners.map(p=>p.name),winnerAmounts:winners.map(p=>(awards[p.uid]||0)/100),share:(pot-rake)/100/winners.length,rake:rake/100,pot:pot/100};
 t.pot=0;t.status='showdown';t.showdownAt=now;t.turnUid=null;t.pairs=[];
}
function finishRound(t,kind,now,busterUid){
 const pairs=t.pairs,recipient=kind==='take'?t.players[t.defenderUid]:kind==='busted'?t.players[busterUid]:null;
 if(recipient){for(const p of pairs){recipient.cards.push(p.a);if(p.d)recipient.cards.push(p.d);}recipient.out=false;t.finishOrder=t.finishOrder.filter(id=>id!==recipient.uid);}
 else t.discard+=pairs.reduce((n,p)=>n+1+!!p.d,0);
 const ps=ordered(t),start=ps.findIndex(p=>p.uid===t.attackerUid),order=[...ps.slice(Math.max(0,start)),...ps.slice(0,Math.max(0,start))].filter(p=>p.uid!==t.defenderUid);
 if(t.players[t.defenderUid]&&!t.players[t.defenderUid].left)order.push(t.players[t.defenderUid]);
 for(const p of order)while(p.cards.length<6&&t.deck.length)p.cards.push(t.deck.pop());
 for(const p of ps){p.out=!p.cards.length&&!t.deck.length;if(p.out&&!t.finishOrder.includes(p.uid))t.finishOrder.push(p.uid);}
 if(active(t).length<=1){endDurak(t,active(t)[0]?.uid||null,now);return;}
 let attacker=kind==='take'?next(t,t.defenderUid):t.defenderUid;
 if(!t.players[attacker]||t.players[attacker].out||t.players[attacker].left)attacker=next(t,attacker);
 t.attackerUid=attacker;t.defenderUid=next(t,attacker);t.turnUid=attacker;t.roundCap=Math.min(6,t.players[t.defenderUid].cards.length);t.pairs=[];t.passed=[];t.turnStartedAt=now;
}
function durakAction(t,uid,op,data,now){
 assert(t.status==='playing'&&t.turnUid===uid,'Wait for your turn');const p=t.players[uid],prs=t.pairs,open=prs.filter(x=>!x.d),def=uid===t.defenderUid;
 assert(p&&!p.left,'You are not playing');
 if(op==='take'){assert(def&&prs.length,'Only the defender can take');finishRound(t,'take',now);return;}
 if(op==='accept'||op==='challenge'){
  assert(def&&open.some(x=>x.blind),'No face-down attack');const bp=open.find(x=>x.blind);bp.blind=false;
  if(op==='challenge')finishRound(t,ranks(prs.filter(x=>x!==bp)).has(bp.a.v)?'take':'busted',now,bp.by);else t.turnStartedAt=now;return;
 }
 if(op==='pass'){
  assert(!def&&prs.length&&!open.length,'Defend the attack first');t.passed=[...new Set([...t.passed,uid])];
  const order=active(t),i=order.findIndex(p=>p.uid===uid),rot=[...order.slice(i+1),...order.slice(0,i+1)],n=rot.find(p=>p.uid!==t.defenderUid&&!t.passed.includes(p.uid)&&p.cards.length);
  if(!n||prs.length>=t.roundCap)finishRound(t,'bita',now);else{t.turnUid=n.uid;t.turnStartedAt=now;}return;
 }
 assert(op==='play','Unknown Durak move');const card=p.cards.find(c=>c.id===data.cardId);assert(card,'Card is not in your hand');
 const remove=()=>{p.cards=p.cards.filter(c=>c.id!==card.id);};
 if(def){
  assert(open.length&&!open.some(x=>x.blind),'Reveal or challenge the face-down card first');
  const n=next(t,uid);
  if(t.settings.variant==='perevodnoy'&&prs.every(x=>!x.d&&x.a.v===card.v)&&n&&t.players[n].cards.length>=prs.length+1&&prs.length<6){
   remove();prs.push({a:card,d:null,by:uid});t.defenderUid=n;t.roundCap=Math.min(6,t.players[n].cards.length);t.turnUid=n;
  }else{
   const target=open.find(x=>beats(card,x.a,t.trumpSuit));assert(target,'This card does not beat an open card');remove();target.d=card;
   if(prs.every(x=>x.d)){
    const attackers=ordered(t).filter(q=>q.uid!==uid&&q.cards.length);
    if(!p.cards.length&&!t.deck.length||!attackers.length||prs.length>=t.roundCap){finishRound(t,'bita',now);return;}
    t.turnUid=attackers.find(q=>q.uid===t.attackerUid)?.uid||attackers[0].uid;
   }
  }
 }else{
  assert(!open.length&&prs.length<t.roundCap,'Waiting for the defender');
  const blind=!!data.blind&&t.settings.bluffEnabled&&prs.length>0;
  assert(prs.length?blind||ranks(prs).has(card.v):uid===t.attackerUid,'Only matching ranks can be added');
  remove();prs.push({a:card,d:null,by:uid,blind});t.turnUid=t.defenderUid;
 }
 t.passed=[];t.turnStartedAt=now;
}
function ofcSettle(t,now){
 const ps=Object.values(t.players).filter(p=>p.inHand),boards={},pts=Object.fromEntries(ps.map(p=>[p.uid,0]));
 ps.forEach(p=>boards[p.uid]=placed(p)===13&&!p.left?ofcBoard(p):{foul:true,roy:0,flNext:0});
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
  const a=boards[ps[i].uid],b=boards[ps[j].uid];let d=0;
  if(a.foul)d=b.foul?0:-6-b.roy;else if(b.foul)d=6+a.roy;else{d=['t','m','b'].reduce((n,k)=>n+ofcCmp(a[k],b[k]),0);if(Math.abs(d)===3)d*=2;d+=a.roy-b.roy;}
  pts[ps[i].uid]+=d;pts[ps[j].uid]-=d;
 }
 const pv=Math.max(.01,cash(t.settings.stake/10)),losses={},weights={};let total=0;
 for(const p of ps){const raw=cents(pts[p.uid]*pv);if(raw<0){losses[p.uid]=Math.min(cents(p.stack),-raw);total+=losses[p.uid];}else if(raw>0)weights[p.uid]=raw;}
 const rake=Math.round(total*t.settings.rakePercent/100),wins=split(total-rake,weights),profits={};
 for(const p of ps){profits[p.uid]=((wins[p.uid]||0)-(losses[p.uid]||0))/100;p.stack=cash(p.stack+profits[p.uid]);p.flNext=boards[p.uid].flNext||0;p.pending=[];}
 t.settlement={rake:rake/100,profits,awards:{}};t.lastResults={rows:ps.map(p=>({uid:p.uid,name:p.name,pts:pts[p.uid],roy:boards[p.uid].roy,foul:boards[p.uid].foul,fl:p.flNext,money:profits[p.uid],stack:p.stack,busted:p.stack===0,isBot:!!p.isBot,hands:boards[p.uid].foul?null:{t:ofcHandName(boards[p.uid].t,true),m:ofcHandName(boards[p.uid].m),b:ofcHandName(boards[p.uid].b)}})).sort((a,b)=>b.pts-a.pts),pv,stake:t.settings.stake,rake:rake/100,endedAt:now};
 t.status='showdown';t.showdownAt=now;t.turnUid=null;
}
function ofcAdvance(t,now){
 const order=ordered(t).filter(p=>p.inHand),target=p=>p.flC?13:5+2*t.street;
 if(!order.length){ofcSettle(t,now);return;}
 const current=t.players[t.turnUid];let n=order.find(p=>p.seatIndex>(current?.seatIndex??-1)&&placed(p)<target(p));
 while(!n&&t.street<4){t.street++;n=order.find(p=>placed(p)<target(p));}
 if(!n){ofcSettle(t,now);return;}
 const count=n.flC|| (t.street===0?5:3);assert(t.deck.length>=count,'Deck cannot supply the next hand');n.pending=t.deck.splice(0,count);t.turnUid=n.uid;t.turnStartedAt=now;
}
function ofcAction(t,uid,stage,now){
 assert(t.status==='playing'&&t.turnUid===uid,'Wait for your turn');const p=t.players[uid];assert(p&&!p.left,'You are not playing');
 assert(stage&&typeof stage==='object'&&!Array.isArray(stage),'Place your cards');const entries=Object.entries(stage),need=p.flC?13:t.street===0?5:2;
 assert(entries.length===need,'Place exactly '+need+' cards');
 for(const [id,row]of entries){assert(['top','mid','bot'].includes(row),'Invalid row');const c=p.pending.find(c=>c.id===id);assert(c,'Card is not in your hand');assert(p[row].length<(row==='top'?3:5),'Row is full');p[row].push(c);}
 p.disc.push(...p.pending.filter(c=>!(c.id in stage)));p.pending=[];ofcAdvance(t,now);
}
function autoMove(t,now){
 const uid=t.turnUid,p=t.players[uid];if(!p)return;
 if(t.type==='ofc'){
  const stage=require('./cardGameBots').ofcMove(botView(t,uid));
  ofcAction(t,uid,stage,now);return;
 }
 if(p.isBot){const move=require('./cardGameBots').durakMove(botView(t,uid));durakAction(t,uid,move.op,move,now);return;}
 const sorted=[...p.cards].sort((a,b)=>(a.suit===t.trumpSuit?100:0)+a.v-((b.suit===t.trumpSuit?100:0)+b.v));
 if(uid===t.defenderUid){const open=t.pairs.filter(x=>!x.d);if(open.some(x=>x.blind)){durakAction(t,uid,'accept',{},now);return;}const c=p.isBot&&sorted.find(c=>open.some(x=>beats(c,x.a,t.trumpSuit)));durakAction(t,uid,c?'play':'take',c?{cardId:c.id}:{},now);}
 else{const c=!t.pairs.length?sorted[0]:t.pairs.length<t.roundCap&&p.isBot&&sorted.find(c=>ranks(t.pairs).has(c.v));durakAction(t,uid,c?'play':'pass',c?{cardId:c.id}:{},now);}
}
// This is the sole bot input boundary: GOD data and other players' private
// cards/deck order never reach a decision policy, including simulated futures.
function botView(t,uid){const view=publish(t);Object.assign(view.players[uid],personal(t,uid));return view;}
function leave(t,uid,now){
 const p=t.players[uid];if(!p)return;
 if(t.status!=='playing'||!p.inHand){delete t.players[uid];return;}
 p.left=true;
 if(t.type==='ofc'){if(!ordered(t).some(p=>p.inHand))ofcSettle(t,now);else if(t.turnUid===uid)ofcAdvance(t,now);}
 else{
  if(active(t).length<=1){endDurak(t,uid,now);return;}
  // Return current attacks to their players, then restart the next round.
  for(const pair of t.pairs){if(t.players[pair.by]&&!t.players[pair.by].left)t.players[pair.by].cards.push(pair.a);if(pair.d&&t.players[t.defenderUid]&&!t.players[t.defenderUid].left)t.players[t.defenderUid].cards.push(pair.d);}
  t.pairs=[];const a=active(t)[0];t.attackerUid=a.uid;t.defenderUid=next(t,a.uid);t.turnUid=a.uid;t.roundCap=Math.min(6,t.players[t.defenderUid].cards.length);t.turnStartedAt=now;
 }
}
function publish(t){
 const pub=clone(t);delete pub.settlement;pub.deck=[];pub.deckCount=t.deck.length;
 const mask=(n,prefix)=>Array.from({length:n},(_,i)=>({id:prefix+i,hidden:true}));
 for(const p of Object.values(pub.players)){
  if(t.type==='durak'){p.cardCount=p.cards.length;p.cards=mask(p.cards.length,'hidden-');}
  else{p.pending=mask(p.pending.length,'pending-');p.disc=[];if(p.flC&&t.status==='playing')for(const row of ['top','mid','bot'])p[row]=mask(p[row].length,row+'-');}
 }
 pub.pairs=(pub.pairs||[]).map((p,i)=>p.blind?{...p,a:{id:'blind-'+i,hidden:true}}:p);
 return pub;
}
function personal(t,uid){const p=t.players[uid];return{seq:t.seq,...(!p?{}:t.type==='durak'?{cards:p.cards}:{pending:p.pending,disc:p.disc,top:p.top,mid:p.mid,bot:p.bot})};}
module.exports={newTable,begin,durakAction,ofcAction,autoMove,leave,publish,personal,clone,placed,split,ofcBoard,ofcSettle,endDurak,botView,ofcEval3,ofcEval5,ofcCmp,ofcRoyalTop,ofcRoyalMid,ofcRoyalBot};
