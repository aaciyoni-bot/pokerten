'use strict';

const {key, cash: round, uid: authenticatedUid} = require('./pokerAuthority');
const suits = new Set(['♠','♥','♦','♣']);
function cards(list) {
  return (Array.isArray(list) ? list : []).filter(c => c && suits.has(c.suit) && /^(?:[2-9]|10|[JQKA])$/.test(c.val))
    .map(c => ({val:String(c.val),suit:c.suit}));
}

// A single consistent read ties the viewer's hand to the board and betting turn.
// Reply with the fields the second table can display. Identities of other seats
// and privileged account data are outside this protocol.
async function readSeatPreview(db, request, tableId) {
  const uid=authenticatedUid(request), clubId=key(request.data.previewClubId);
  if(uid==='_engine')return null;
  const ref=db.doc('tables/'+key(tableId,'table'));
  return db.runTransaction(async tx=>{
    const [member,table]=await tx.getAll(db.doc('memberships/'+uid+'_'+clubId),ref);
    const t=table.exists && table.data(), me=t?.players?.[uid];
    if(!member.exists || member.data().status!=='approved' || !t || t.clubId!==clubId || t.authorityVersion!==2 ||
      !t.settings?.serverEngine || t.type!=='poker' || !me || me.left || me.isBot || ['left','out'].includes(me.status) ||
      t.archived || t.tournament?.finished || t.tournament?.cancelled)return null;
    const g=t.gameState||{}, count=Number(me.cardCount)||0;
    const inHand=['active','folded','busted'].includes(me.status) && count>0 &&
      ['preflop','discard','flop','turn','river','showdown'].includes(g.phase);
    const hand=inHand ? await tx.get(ref.collection('priv').doc(uid)) : null;
    const pot=(g.pots||[]).reduce((sum,p)=>sum+(Number(p.amount)||0),0)+
      Object.values(t.players).reduce((sum,p)=>sum+(Number(p.bet)||0),0);
    const high=Number(g.highestBet)||0, bet=Number(me.bet)||0, stack=Number(me.stack)||0;
    const omaha=String(g.currentGameType||'').startsWith('Omaha') && (g.currentGameType==='Omaha 7'||t.settings.omahaPotLimit!==false);
    const maxTo=round(Math.min(stack+bet,omaha?high+pot+Math.max(0,high-bet):Infinity));
    const minTo=Math.min(maxTo,round(high+(g.minRaise||g.handBB||2*t.settings.blinds||1)));
    const bettingTurn=me.status==='active' && !g.allInReveal && !me.sitOut && g.activeTurnUid===uid &&
      ['preflop','flop','turn','river'].includes(g.phase);
    const chooseGame=g.phase==='dc_selection' && g.dcUid===uid;
    const discard=g.phase==='discard' && me.status==='active' && count===3;
    const turn=bettingTurn || chooseGame || discard;
    const extended=me.timeBankHand===g.handN && me.timeBankTurn!=null && me.timeBankTurn===g.turnStartedAt;
    const seconds=bettingTurn ? (Number(t.settings.actionTime)||30)+(extended?15:0) : 25;
    const deadline=turn && Number.isFinite(g.turnStartedAt) ? g.turnStartedAt+seconds*1000 : null;
    return {minTo,maxTo,cards:hand?.exists?cards(hand.data().cards).slice(0,Math.min(7,count)):[],
      board:cards(g.board).slice(0,5),board2:cards(g.board2).slice(0,5),board3:cards(g.board3).slice(0,5),
      pot,stack:me.stack||0,bet:me.bet||0,phase:g.phase||'waiting',
      turn,deadline,bettingTurn,
      aof:!!g.aof,highestBet:g.highestBet||0,turnStartedAt:g.turnStartedAt??null,handN:g.handN??0};
  },{readOnly:true});
}
module.exports={readSeatPreview};
