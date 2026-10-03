'use strict';
// Only actions and cards already exposed on the public table feed this model.
// Never access S.priv or the undealt deck here.
const R=require('./pokerRangeModel'),C=require('./pokerCore');
function member(S,uid){S.publicModels||={};const m=S.publicModels[uid]||{hands:0,vpip:0,pfr:0,street:{},cbet:0,cbetOpportunities:0,foldToBet:0,foldOpportunities:0,bigShowdowns:0,bluffsShown:0,strongShown:0};S.publicModels[uid]=m;S.modelsDirty||=new Set();S.modelsDirty.add(uid);return m;}
function start(S){const g=S.gameState;g.publicActions=[];g.modelFlags={};for(const p of Object.values(S.players)){if(p.cardCount>0)member(S,p.uid).hands++;}}
function action(S,uid,before){
 const g=S.gameState,p=S.players[uid],m=member(S,uid),paid=Math.max(0,(p.bet||0)-before.bet),kind=p.status==='folded'?'fold':(p.bet||0)>before.highestBet?(before.call>0?'raise':'bet'):paid>0?'call':'check';
 const events=g.publicActions||[],preAgg=[...events].reverse().find(e=>e.street==='preflop'&&(e.action==='raise'||e.action==='bet'));
 const cbet=before.street==='flop'&&preAgg?.uid===uid&&!events.some(e=>e.street==='flop'&&(e.action==='raise'||e.action==='bet'))&&!events.some(e=>e.street==='flop'&&e.uid===uid);
 const entry={uid,street:before.street,board:before.board,action:kind,amount:paid,potBefore:before.pot,callBefore:before.call,raiseTo:p.bet||0,stackBefore:before.stack,allIn:p.stack===0,position:g.dealerUid===uid?'late':'early',multiway:Object.values(S.players).filter(p=>p.status==='active').length>2,cbet};
 g.publicActions=[...events,entry].slice(-120);
 m.street||={};const st=m.street[before.street]||{opportunities:0,aggressive:0,calls:0};st.opportunities++;if(kind==='raise'||kind==='bet')st.aggressive++;if(kind==='call')st.calls++;m.street[before.street]=st;
 if(before.call>0){m.foldOpportunities=(m.foldOpportunities||0)+1;if(kind==='fold')m.foldToBet=(m.foldToBet||0)+1;}
 if(cbet){m.cbetOpportunities=(m.cbetOpportunities||0)+1;if(kind==='bet'||kind==='raise')m.cbet=(m.cbet||0)+1;}
 g.modelFlags||={};const flags=g.modelFlags[uid]||{};
 if(before.street==='preflop'&&paid>0){if(!flags.vpip){m.vpip=(m.vpip||0)+1;flags.vpip=true;}if((kind==='raise'||kind==='bet')&&!flags.pfr){m.pfr=(m.pfr||0)+1;flags.pfr=true;}}
 g.modelFlags[uid]=flags;
}
function showdown(S){
 if(S.gameState.phase!=='showdown')return;const g=S.gameState;
 for(const p of Object.values(S.players)){if(!p.cards?.length||p.mucked)continue;const flags=g.modelFlags?.[p.uid]||{};if(flags.shown)continue;
  const big=[...(g.publicActions||[])].reverse().find(e=>e.uid===p.uid&&e.street!=='preflop'&&(e.action==='bet'||e.action==='raise')&&e.amount>=Math.max(1,e.potBefore)*.65);if(!big)continue;
  const f=R.features(p.cards,big.board,g.currentGameType||'NLH',{score:C.bestScoreFull}),m=member(S,p.uid);m.bigShowdowns=(m.bigShowdowns||0)+1;
  if(f.category==='air'||f.category==='draw')m.bluffsShown=(m.bluffsShown||0)+1;else if(f.category==='strong value')m.strongShown=(m.strongShown||0)+1;
  g.modelFlags||={};g.modelFlags[p.uid]={...flags,shown:true};
 }
}
module.exports={start,action,showdown};
