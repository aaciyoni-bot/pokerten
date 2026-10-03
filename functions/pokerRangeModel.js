/* Public-information Bayesian opponent ranges. Shared by server and browser.
 * Hold'em enumerates every available combo. Larger variants define the same
 * likelihood over every combo and use importance particles rather than trying
 * to materialize millions of PLO6 hands. No deck order or opponent cards enter.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PokerRangeModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rank=c=>({J:11,Q:12,K:13,A:14}[c.val]||Number(c.val));
const cardKey=c=>c.id||c.val+c.suit;
const streets=['preflop','flop','turn','river'];
const rangeCaches=new WeakMap();
function texture(board){
 const ranks={},suits={};for(const c of board){ranks[rank(c)]=(ranks[rank(c)]||0)+1;suits[c.suit]=(suits[c.suit]||0)+1;}
 let straight=0;for(let high=5;high<=14;high++){const run=high===5?[14,2,3,4,5]:[high-4,high-3,high-2,high-1,high];straight=Math.max(straight,run.filter(v=>ranks[v]).length);}
 return{ranks,suits,paired:Object.values(ranks).some(n=>n>=2),trips:Object.values(ranks).some(n=>n>=3),maxSuit:Math.max(0,...Object.values(suits)),fourStraight:straight>=4,top:Math.max(0,...Object.keys(ranks).map(Number))};
}
function features(hand,board,gameType,core){
 const omaha=gameType.startsWith('Omaha'),t=texture(board),score=board.length>=3?core.score(hand,board,gameType):0,tier=Math.floor(score/1e6);
 const mine={};for(const c of hand)mine[rank(c)]=(mine[rank(c)]||0)+1;
 const boardOnly=!omaha&&board.length===5?core.score([],board,gameType):null;
 const improvesBoard=boardOnly==null||score>boardOnly;
 const ownPairs=Object.keys(mine).filter(v=>mine[v]>=2||t.ranks[v]===1),ownTrips=Object.keys(mine).some(v=>(mine[v]>=2&&t.ranks[v]>=1)||(mine[v]>=1&&t.ranks[v]>=2));
 let pair=ownPairs.length>0||Object.keys(mine).some(v=>t.ranks[v]===1),topPair=pair&&ownPairs.some(v=>Number(v)>=t.top);
 if(t.trips&&!ownTrips&&tier===3)pair=false;
 let flushDraw=false,nutDraw=false,straightDraw=false,drawOuts=0;
 if(board.length===3||board.length===4){
  for(const [s,n]of Object.entries(t.suits)){const hole=hand.filter(c=>c.suit===s),draw=omaha?n===2&&hole.length>=2:n+hole.length===4&&hole.length>0;if(draw){flushDraw=true;nutDraw=hole.some(c=>rank(c)===14);}}
  const ranks=new Set([...hand,...board].map(rank)),straightOutRanks=new Set();
  for(let high=5;high<=14;high++){const run=high===5?[14,2,3,4,5]:[high-4,high-3,high-2,high-1,high];if(run.filter(v=>ranks.has(v)).length===4&&hand.some(c=>run.includes(rank(c))&&!t.ranks[rank(c)])){straightDraw=true;straightOutRanks.add(run.find(v=>!ranks.has(v)));}}
  drawOuts=(flushDraw?9:0)+Math.min(8,straightOutRanks.size*4);if(flushDraw&&straightDraw)drawOuts=12;
 }
 const vulnerable=t.paired||t.maxSuit>=3||t.fourStraight;
 const boardAssistedTwoPair=!omaha&&tier===2&&t.paired&&!ownTrips;
 const genuineStrong=improvesBoard&&(tier>=4||tier===3&&ownTrips||tier===2&&!boardAssistedTwoPair);
 let category=genuineStrong?'strong value':pair?(vulnerable||!topPair?'bluff-catcher':'thin value'):drawOuts>=4?'draw':'air';
 if(!improvesBoard)category='air';
 return{score,tier,pair,topPair,ownTrips,flushDraw,nutDraw,straightDraw,drawOuts,category,vulnerable,texture:t,improvesBoard};
}
function modelRead(model={}){
 const n=Number(model.bigShowdowns)||0;
 // Shrink observed big-bet showdowns towards a population prior. A handful
 // of exposed cards is not enough to label someone an automatic bluffer.
 const reliable=n>=8,bluffShare=reliable?clamp((3+(model.bluffsShown||0))/(18+n),.035,.62):.16;
 const river=model.street?.river||{},aggression=river.opportunities>=20?clamp((river.aggressive+5)/(river.opportunities+20),.1,.8):.3;
 const hands=model.hands||0,foldRate=(model.foldOpportunities||0)>=20?clamp(((model.foldToBet||0)+8)/(model.foldOpportunities+20),.1,.8):.4,cbetRate=(model.cbetOpportunities||0)>=15?clamp(((model.cbet||0)+6)/(model.cbetOpportunities+10),.15,.9):.6,vpip=hands>=25?clamp(((model.vpip||0)+12)/(hands+40),.08,.8):.3,pfr=hands>=25?clamp(((model.pfr||0)+8)/(hands+40),.04,.65):.2;
 return{bluffShare,foldRate,cbetRate,bluffScale:clamp(bluffShare/.16*(river.opportunities>=20?clamp(aggression/.3,.75,1.35):1),.25,3.7),reliable,provenBluffer:reliable&&bluffShare>=.32,aggression,vpip,pfr,sample:n};
}
function likelihood(f,event,priorEvents,read,preflopTier){
 const action=event.action,street=event.street,size=Math.max(0,event.amount||0)/Math.max(1,event.potBefore||1),aggressive=action==='bet'||action==='raise';
 if(street==='preflop'){
  const tier=preflopTier;
  if(aggressive){const base=[.035,.20,.6,.94][tier]||.02;return clamp(base*(event.position==='late'?1.25:.85)*(read.pfr/.2),.004,.97);}
  if(action==='call')return [.16,.6,.75,.38][tier]||.1;
  if(action==='check')return [.8,.72,.45,.15][tier]||.6;
  return .3;
 }
 const cat=f.category,priorAgg=priorEvents.filter(e=>e.action==='bet'||e.action==='raise').length;
 const checked=priorEvents.some(e=>e.street===street&&e.action==='check'),checkRaise=checked&&action==='raise';
 const priorDraw=priorEvents.some(e=>e._draw);
 const large=size>=.65||event.allIn,small=size<=.3;
 if(aggressive){
  let probability;
  if(cat==='strong value')probability=large?.82:small?.42:.67;
  else if(cat==='thin value')probability=large?.07:small?.64:.35;
  else if(cat==='bluff-catcher')probability=large?.009:small?.36:.09;
  else if(cat==='draw')probability=large?.19:small?.34:.29;
  else probability=priorAgg?(priorDraw?.32:.30):large?.025:small?.25:.075;
  if(cat==='air'||cat==='draw')probability*=read.bluffScale;
  if(event.cbet)probability*=read.cbetRate/.6;
  if(cat==='air'||cat==='draw')probability*=event.position==='late'?1.15:event.position==='early'?.82:1;
  if(event.multiway&&(cat==='air'||cat==='draw'))probability*=.6;
  if(priorAgg>0&&(cat==='thin value'||cat==='bluff-catcher'))probability*=.28;
  if(checkRaise)probability*=cat==='strong value'?1.16:cat==='draw'?.48:cat==='air'?.18:.07;
  if(action==='raise'&&!checkRaise)probability*=cat==='strong value'?1.08:cat==='draw'?.7:cat==='air'?.4:.3;
  return clamp(probability,.0002,.97);
 }
 if(action==='call'){
  if(cat==='strong value')return .65;
  if(cat==='thin value')return large?.36:.82;
  if(cat==='bluff-catcher')return large?.075:small?.82:.42;
  if(cat==='draw')return large?.3:.7;
  return small?.10:.008;
 }
 if(action==='check')return cat==='strong value'?.32:cat==='thin value'?.56:cat==='draw'?.66:.86;
 if(action==='fold')return cat==='strong value'?.002:cat==='air'?.85:.4;
 return 1;
}
function sampleCards(pool,n,random){const result=pool.slice();for(let i=0;i<n;i++){const j=i+Math.floor(random()*(result.length-i));[result[i],result[j]]=[result[j],result[i]];}return result.slice(0,n);}
function combos(pool,n,limit,random){if(n===2){const out=[];for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++)out.push([pool[i],pool[j]]);return out;}const seen=new Set(),out=[];while(out.length<limit){const h=sampleCards(pool,n,random),key=h.map(cardKey).sort().join('|');if(!seen.has(key)){seen.add(key);out.push(h);}}return out;}
function buildRange({uid,hero,board,gameType,history,model={},holeCount},core){
 if(!Number.isInteger(holeCount)||holeCount<2||holeCount>6)throw Error('Invalid hole-card count');
 let cache=rangeCaches.get(core.score);if(!cache){cache=new Map();rangeCaches.set(core.score,cache);}
 const cacheKey=holeCount===2?JSON.stringify([uid,hero.map(cardKey).sort(),board.map(cardKey),gameType,history.filter(e=>e.uid===uid),model]):null;
 if(cacheKey&&cache.has(cacheKey))return cache.get(cacheKey);
 const boardIds=new Set(board.map(cardKey)),heroIds=new Set(hero.map(cardKey)),pool=core.deck.filter(c=>!boardIds.has(cardKey(c)));
 const read=modelRead(model),events=history.filter(e=>e.uid===uid&&streets.includes(e.street));
 const candidates=combos(pool,holeCount,gameType.startsWith('Omaha')?480:600,core.random),out=[],blocked={value:0,bluff:0,valueAll:0,bluffAll:0},categoryMass={};
 for(const hand of candidates){
  const tier=core.preflop(hand);let weight=.05+read.vpip+tier*.2;const prior=[];
  for(const event of events){const streetBoard=event.board||board.slice(0,event.street==='flop'?3:event.street==='turn'?4:event.street==='river'?5:0);const f=features(hand,streetBoard,gameType,core);weight*=likelihood(f,event,prior,read,tier);prior.push({...event,_draw:f.drawOuts>=4});}
  const f=features(hand,board,gameType,core);if(board.length<3)f.category=['air','playable','strong','premium'][tier];const value=f.category==='strong value',bluff=f.category==='air'||f.category==='draw',isBlocked=hand.some(c=>heroIds.has(cardKey(c)));
  if(value){blocked.valueAll+=weight;if(isBlocked)blocked.value+=weight;}
  if(bluff){blocked.bluffAll+=weight;if(isBlocked)blocked.bluff+=weight;}
  if(isBlocked)continue;
  out.push({hand,weight,features:f});categoryMass[f.category]=(categoryMass[f.category]||0)+weight;
 }
 const total=out.reduce((n,c)=>n+c.weight,0);if(!total||!out.length)throw Error('No compatible weighted opponent range');
 let cumulative=0;for(const c of out){c.weight/=total;cumulative+=c.weight;c.cdf=cumulative;}out[out.length-1].cdf=1;
 const categories=Object.entries(categoryMass).map(([category,mass])=>({category,percent:Math.round(mass/total*1000)/10})).sort((a,b)=>b.percent-a.percent);
 const nutBlocker=hero.some(c=>rank(c)===14&&board.filter(b=>b.suit===c.suit).length===3)? .12:0;
 const result={uid,combos:out,categories,read,exact:holeCount===2,blockerScore:nutBlocker+(blocked.valueAll?blocked.value/blocked.valueAll:0)-(blocked.bluffAll?blocked.bluff/blocked.bluffAll:0)};
 if(cacheKey){if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(cacheKey,result);}return result;
}
function pick(range,random,used){
 for(let tries=0;tries<50;tries++){const r=random();let lo=0,hi=range.combos.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(range.combos[mid].cdf<r)lo=mid+1;else hi=mid;}const c=range.combos[lo];if(!c.hand.some(x=>used.has(cardKey(x))))return c;}
 const compatible=range.combos.filter(c=>!c.hand.some(x=>used.has(cardKey(x)))),sum=compatible.reduce((n,c)=>n+c.weight,0);if(!sum)return null;let target=random()*sum;for(const c of compatible){target-=c.weight;if(target<=0)return c;}return compatible.at(-1);
}
function equity(input,ranges,core){
 const {hero,board,gameType,pots=[]}=input,known=new Set([...hero,...board].map(cardKey)),missing=5-board.length,potTotal=pots.reduce((n,p)=>n+p.amount,0);
 const kept=(h,b)=>gameType==='Pineapple'&&h.length===3?h.filter((_,i)=>i!==core.discard(h,b.slice(0,3))):h;
 const score=(h,b)=>core.score(kept(h,b),b,gameType);
 const own=missing===0?score(hero,board):null;
 if(missing===0&&ranges.length===1){let eq=0;for(const c of ranges[0].combos){const other=gameType==='Pineapple'?score(c.hand,board):c.features.score;eq+=c.weight*(own>other?1:own===other?.5:0);}return{equity:eq,callEquity:potTotal?pots.reduce((n,p)=>n+p.amount*(p.opponents.includes(0)?eq:1),0)/potTotal:eq,samples:ranges[0].combos.length,method:ranges[0].exact?'exact-weighted-river':'weighted-particle-river'};}
 const iterations=gameType.startsWith('Omaha')?160:500;let total=0,callTotal=0,done=0;
 for(let i=0;i<iterations;i++){
  const used=new Set(known),selected=new Array(ranges.length),order=ranges.map((_,i)=>i);
  for(let j=order.length-1;j>0;j--){const k=Math.floor(core.random()*(j+1));[order[j],order[k]]=[order[k],order[j]];}
  let valid=true;for(const o of order){const c=pick(ranges[o],core.random,used);if(!c){valid=false;break;}selected[o]=c.hand;c.hand.forEach(c=>used.add(cardKey(c)));}if(!valid)continue;
  const future=[...board,...sampleCards(core.deck.filter(c=>!used.has(cardKey(c))),missing,core.random)],my=own??score(hero,future),scores=selected.map(h=>score(h,future));
  const share=ids=>{let ties=1;for(const o of ids){if(scores[o]>my)return 0;if(scores[o]===my)ties++;}return 1/ties;};
  const all=share(ranges.map((_,i)=>i));total+=all;callTotal+=potTotal?pots.reduce((n,p)=>n+p.amount*share(p.opponents),0)/potTotal:all;done++;
 }
 if(!done)throw Error('Weighted simulation has no compatible deals');return{equity:total/done,callEquity:callTotal/done,samples:done,method:'weighted-monte-carlo'};
}
function relativeClass(f,eq,ranges){
 const maximum=Math.max(...ranges.flatMap(r=>r.combos.map(c=>c.features.score)));
 if(f.improvesBoard&&f.score>maximum)return'nuts';
 if(f.category==='strong value')return eq>.66?'strong value':eq>.44?'thin value':'bluff-catcher';
 if(f.drawOuts>=8&&f.category==='air')return'draw';
 if(f.pair)return f.vulnerable||!f.topPair||eq<.58?'bluff-catcher':'thin value';
 return f.category;
}
function decide(input,core){
 const {hero,board,gameType,opponents,uid,history:rawHistory=[],price,stack,bet=0,highestBet=0,minRaise=1,bb=1,pot=0,maxRaise=stack+bet}=input;
 if(hero.length<2||hero.length>6||board.length<3||board.length>5||!opponents.length)throw Error('Invalid public decision state');
 const street=board.length===5?'river':board.length===4?'turn':'flop',history=rawHistory.map(e=>({...e}));
 // Old live hands and standalone callers may predate action journaling. The
 // outstanding visible bet is still evidence; it never becomes a random range.
 for(const o of opponents){if(o.bet>bet&&!history.some(e=>e.uid===o.uid&&e.street===street&&(e.action==='bet'||e.action==='raise')&&(e.raiseTo==null||Math.abs(e.raiseTo-o.bet)<.011))){history.push({uid:o.uid,street,board,action:'bet',amount:o.bet-bet,potBefore:Math.max(bb,pot-(o.bet-bet)),allIn:o.stack===0,position:o.position||'unknown'});}}
 const ranges=opponents.map(o=>buildRange({uid:o.uid,hero,board,gameType,history,model:input.models?.[o.uid]||{},holeCount:hero.length},core));
 const ev=equity({...input,pots:input.pots},ranges,core),f=features(hero,board,gameType,core),handClass=relativeClass(f,ev.equity,ranges),toCall=price.cost;
 const aggressor=[...history].reverse().find(e=>e.uid!==uid&&(e.action==='bet'||e.action==='raise')&&e.street===street),target=ranges.find(r=>r.uid===aggressor?.uid)||ranges[0];
 const blockerScore=target.blockerScore,preBetPot=Math.max(bb,price.pot-toCall),mdf=toCall>0?preBetPot/(preBetPot+toCall):1;
 const effective=Math.max(0,...opponents.map(o=>Math.min(stack,o.stack+Math.max(0,o.bet-bet)))),spr=effective/Math.max(bb,preBetPot),bluffCatcher=handClass==='bluff-catcher'||handClass==='thin value'&&f.pair;
 const commitment=toCall>=stack*.35||opponents.some(o=>o.stack===0&&o.bet>bet),future=board.length<5;
 let penalty=future&&bluffCatcher?clamp(.025+(f.vulnerable?.035:0)+Math.log2(1+spr)*.012,.025,.115):0;
 if(commitment&&bluffCatcher&&spr>=3&&!target.read.provenBluffer)penalty+=.06;
 if(opponents.length>1&&bluffCatcher)penalty+=.02;
 const requiredEquity=clamp(price.odds+penalty+(ev.method==='weighted-monte-carlo'?.008:0),0,1),margin=ev.callEquity-requiredEquity;
 const priorCalls=history.some(e=>e.uid!==uid&&e.action==='call');
 const calling=(fraction)=>{
  let mass=0,worse=0;for(const r of ranges)for(const c of r.combos){const l=clamp(likelihood(c.features,{street,action:'call',amount:fraction,potBefore:1},[],r.read,0)*(1-r.read.foldRate)/.6,0,1);mass+=c.weight*l;if(c.features.score<f.score)worse+=c.weight*l;}
  return{mass:mass/ranges.length,worse:mass?worse/mass:0};
 };
 const sizeFraction=handClass==='nuts'?.75:handClass==='strong value'?.65:.4,continued=calling(sizeFraction),funded=opponents.some(o=>o.stack>0);
 const value=handClass==='nuts'||handClass==='strong value'&&ev.equity>.65&&continued.worse>.52||handClass==='thin value'&&!f.vulnerable&&ev.equity>.68&&continued.worse>.57;
 const raiseTarget=()=>{const targetAmount=toCall>0?highestBet+Math.max(bb*2,(pot+toCall)*sizeFraction):bet+Math.max(bb,pot*sizeFraction);return Math.round(Math.min(maxRaise,Math.max(highestBet+minRaise,Math.round(targetAmount/bb)*bb))*100)/100;};
 let frequencies={fold:0,call:1,raise:0},reason='check';
 if(toCall>0){
  if(margin<0){frequencies={fold:1,call:0,raise:0};reason='below-required-equity';}
  else{
   // MDF is a baseline for the close, profitable part of the defending range,
   // not permission to call a clearly negative-EV hand. Value blockers improve
   // the close calls; blocking missed draws makes them worse.
   let callFrequency=margin>=.045?1:clamp(.25+margin/.045*.65+(mdf-.5)*.25+blockerScore*1.5,.15,1);
   if(price.odds<=.025)callFrequency=1;
   if(commitment&&spr>=3&&bluffCatcher&&!target.read.provenBluffer&&handClass!=='nuts')callFrequency*=.15;
   let raiseFrequency=0;if(value&&funded&&margin>.15&&continued.worse>.56)raiseFrequency=handClass==='nuts'?1:handClass==='strong value'?.55:.13;
   frequencies={fold:1-callFrequency,call:callFrequency*(1-raiseFrequency),raise:callFrequency*raiseFrequency};reason=raiseFrequency?'value-against-continuing-range':'profitable-range-defense';
  }
 }else if(funded&&f.improvesBoard){
  let raiseFrequency=0;
  if(value)raiseFrequency=handClass==='nuts'?1:handClass==='strong value'?.82:.48;
  else if((opponents.length===1&&handClass==='air'||opponents.length<=3&&f.drawOuts>=8&&future)&&!priorCalls){
   const heroRange=buildRange({uid,hero:[],board,gameType,history,model:{},holeCount:hero.length},core),credible=heroRange.combos.filter(c=>c.features.category==='strong value').reduce((n,c)=>n+c.weight,0),foldEstimate=1-continued.mass;
   const pressureValue=f.drawOuts>=8?Math.pow(foldEstimate,opponents.length)+(1-Math.pow(foldEstimate,opponents.length))*ev.equity:foldEstimate;
   if(credible>(f.drawOuts>=8?.015:.045)&&pressureValue>sizeFraction/(1+sizeFraction)&&((blockerScore>.025&&handClass==='air')||f.drawOuts>=8&&ev.equity>.22))raiseFrequency=f.drawOuts>=8?.14:.07;
  }
  frequencies={fold:0,call:1-raiseFrequency,raise:raiseFrequency};reason=raiseFrequency?(value?'value-against-continuing-range':'credible-blocker-bluff'):'showdown-control';
 }
 const targetAmount=raiseTarget();if(targetAmount<=highestBet||targetAmount-bet>=stack-.01&&bluffCatcher&&!target.read.provenBluffer){frequencies.call+=frequencies.raise;frequencies.raise=0;}
 const random=core.decisionRandom??core.random(),action=random<frequencies.raise?'raise':random<frequencies.raise+frequencies.fold?'fold':'call';
 // Existing personalities transform the decision random value. Report the
 // resulting probabilities, including the tight style's capped tail mass.
 const scale=core.decisionScale||1,cdf=t=>t>.999?1:clamp(t*scale,0,1),actualRaise=cdf(frequencies.raise),actualFold=cdf(frequencies.raise+frequencies.fold)-actualRaise;
 frequencies={raise:actualRaise,fold:actualFold,call:1-actualRaise-actualFold};
 const debug={version:1,street,handClass,equity:ev.equity,callEquity:ev.callEquity,requiredEquity,potOdds:price.odds,reverseImpliedPenalty:penalty,mdf,spr,blockerScore,frequencies,action,reason,method:ev.method,samples:ev.samples,ranges:ranges.map(r=>({uid:r.uid,categories:r.categories,combos:r.combos.length,exact:r.exact,shownBigBetSample:r.read.sample,assumedBluffShare:r.read.bluffShare})),continuingWorseShare:continued.worse};
 return{action,...(action==='raise'?{amount:targetAmount}:{}),debug};
}
return{texture,features,modelRead,likelihood,buildRange,equity,decide};
});
