'use strict';
// Fixed public-information scenarios. Run on the original and revised policy
// with the same seeds; never supply an opponent's actual hole cards.
const fs=require('node:fs'),crypto=require('node:crypto');
const Engine=require('../functions/pokerEngine').__engineInternals;
const cards=a=>a.map(id=>({id,val:id.slice(0,-1),suit:id.slice(-1)}));
const action=(street,board,amount,potBefore,kind='bet',extra={})=>({uid:'villain',street,board:cards(board),action:kind,amount,potBefore,position:'late',...extra});
const paired=['A♠','9♥','9♣'],river=[...paired,'6♦','3♠'];
const scenarios=[
 {name:'AK on A99 facing bet-bet-shove',hero:['A♦','K♣'],board:river,bet:150,pot:150,stack:150,history:[action('flop',paired,15,20),action('turn',river.slice(0,4),45,50),action('river',river,150,150,'bet',{allIn:true})],expected:{foldMin:.85,raiseMax:0}},
 {name:'Overpair without flush blocker on four-flush river',hero:['A♦','A♣'],board:['K♠','9♠','6♠','2♠','3♥'],bet:75,pot:100,stack:200,history:[action('river',['K♠','9♠','6♠','2♠','3♥'],75,100)],expected:{foldMin:.85,raiseMax:0}},
 {name:'Top pair facing river check-raise',hero:['A♦','K♣'],board:['A♠','10♥','7♣','4♦','2♠'],bet:180,heroBet:35,pot:100,stack:165,history:[action('river',['A♠','10♥','7♣','4♦','2♠'],0,100,'check'),{uid:'hero',street:'river',board:cards(['A♠','10♥','7♣','4♦','2♠']),action:'bet',amount:35,potBefore:100},action('river',['A♠','10♥','7♣','4♦','2♠'],180,135,'raise',{callBefore:35})],expected:{foldMin:.8,raiseMax:0}},
 {name:'Second pair facing one small flop bet',hero:['K♦','Q♣'],board:['A♠','K♥','7♣'],bet:10,pot:100,stack:200,history:[action('flop',['A♠','K♥','7♣'],10,100)],expected:{callMin:.75,raiseMax:.1}},
 {name:'Private river nuts get value',hero:['A♠','K♠'],board:['Q♠','J♠','10♠','2♦','3♣'],bet:0,pot:100,stack:200,history:[],expected:{raiseMin:.9,foldMax:0}},
 {name:'AK versus demonstrated frequent bluffer',hero:['A♦','K♣'],board:river,bet:75,pot:150,stack:200,history:[action('flop',paired,15,20),action('turn',river.slice(0,4),45,50),action('river',river,75,150)],models:{villain:{hands:200,vpip:150,pfr:90,bigShowdowns:40,bluffsShown:28,street:{river:{aggressive:90,opportunities:130}}}},expected:{callMin:.2}},
];
function run(samples=100){const results=[];for(const s of scenarios){const counts={fold:0,call:0,raise:0},equities=[],required=[],classes={},trace=[];const began=Date.now();for(let i=0;i<samples;i++){
 const original=crypto.randomInt,originalMath=Math.random;let seed=4041+i*7919,deckSeed=19001+i*3571;
 Math.random=()=>((deckSeed=(Math.imul(deckSeed,1664525)+1013904223)>>>0)/4294967296);
 crypto.randomInt=(min,max)=>{if(max==null){max=min;min=0;}seed=(Math.imul(seed,1664525)+1013904223)>>>0;return min+Math.floor(seed/4294967296*(max-min));};
 try{const hero={uid:'hero',isBot:true,botStyle:'balanced',status:'active',stack:s.stack,bet:s.heroBet||0,seatIndex:0,cards:cards(s.hero)};const villain={uid:'villain',isBot:false,status:'active',stack:s.history.at(-1)?.allIn?0:200,bet:s.bet,seatIndex:1};Object.defineProperty(villain,'cards',{get(){throw Error('Hidden opponent read');}});const priv={hero:hero.cards};Object.defineProperty(priv,'villain',{get(){throw Error('Hidden opponent read');}});
 const state={id:'scenario',now:1,settings:{blinds:.5},players:{hero,villain},priv,publicModels:s.models||{},gameState:{phase:s.board.length===5?'river':s.board.length===4?'turn':'flop',board:cards(s.board),currentGameType:'NLH',highestBet:s.bet,minRaise:1,handBB:1,pots:[{amount:s.pot}],dealerUid:'villain',publicActions:s.history}};
 const move=Engine.botAction(state,'hero');counts[move.action]++;const d=state.botDecisionDebug;if(d){if(d.equity!=null)equities.push(d.equity);required.push(d.requiredEquity);classes[d.handClass]=(classes[d.handClass]||0)+1;if(i===0)trace.push(d);}
 }finally{crypto.randomInt=original;Math.random=originalMath;}}
 const frequencies=Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v/samples]));const pass=Object.entries(s.expected).every(([key,v])=>{const op=key.endsWith('Min')?'min':'max',a=key.slice(0,-3);return op==='min'?frequencies[a]>=v:frequencies[a]<=v;});results.push({name:s.name,samples,counts,frequencies,expected:s.expected,pass,meanEquity:equities.length?equities.reduce((a,b)=>a+b)/equities.length:null,handClasses:classes,trace:trace[0]||null,elapsedMs:Date.now()-began});}
 return results;}
if(require.main===module){const samples=Number(process.env.BOT_SCENARIO_SAMPLES)||100,results=run(samples),output=process.argv.find(a=>a.startsWith('--output='));if(output)fs.writeFileSync(output.slice(9),JSON.stringify({policy:process.env.BOT_POLICY_LABEL||'current',results},null,2)+'\n');for(const r of results)console.log(JSON.stringify({name:r.name,...r.frequencies,pass:r.pass,meanEquity:r.meanEquity,elapsedMs:r.elapsedMs}));if(process.argv.includes('--assert')&&results.some(r=>!r.pass))process.exitCode=1;}
module.exports={scenarios,run};
