'use strict';

// The player protocol deliberately accepts primitives only. Never copy an
// engine object, including nested properties added by a future release.
function fields(record, keys) {
  const result = {};
  for (const key of keys.split(' ')) {
    const value = record?.[key];
    if (value === null || ['string','boolean'].includes(typeof value) || Number.isFinite(value)) result[key] = value;
  }
  return result;
}
const records = (list, map) => Array.isArray(list) ? list.filter(v => v && typeof v === 'object').map(map) : [];
const cards = list => records(list, c => fields(c, 'id val suit'));
const ids = list => Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];

function gameState(g) {
  const state = fields(g, '__seq activeTurnUid allInReveal aof bombPot currentGameType dcUid dealerUid earlyWin handBB handSB handN highestBet lastWinAmount lastWinners minRaise phase showdownAt tourLevel turnStartedAt');
  state.board = cards(g.board);
  state.board2 = Array.isArray(g.board2) ? cards(g.board2) : null;
  state.board3 = Array.isArray(g.board3) ? cards(g.board3) : null;
  state.pots = records(g.pots, pot => ({...fields(pot, 'amount'), eligible:ids(pot.eligible)}));
  state.lastAwards = records(g.lastAwards, row => fields(row, 'uid name amount'));
  state.ritOffer = g.ritOffer ? fields(g.ritOffer, 'until runs') : null;
  state.ritAgree = Object.fromEntries(Object.entries(g.ritAgree || {}).filter(([,v]) => typeof v === 'boolean'));
  state.rabbit = g.phase === 'showdown' && g.earlyWin ? cards(g.rabbit) : null;
  return state;
}

function seat(p, g) {
  const visible = g.phase === 'showdown' ? (p.reveal === true || (!g.earlyWin && !p.mucked && p.status !== 'folded')) :
    (g.allInReveal === true && p.status !== 'folded' && !p.mucked);
  return {...fields(p, 'uid name photo avatarSeed seatIndex stack bet status cardCount actionText hasActed reveal mucked lastSeen sitOut sitAuto sitOutAt sitOutNext leavingAt bustedAt timeBankHand timeBankTurn'), cards:visible ? cards(p.cards) : []};
}

function actionUpdate(update) {
  const g = update.gameState;
  return {gameState:gameState(g), players:Object.fromEntries(Object.entries(update.players || {}).filter(([,p]) => p && typeof p === 'object').map(([uid,p]) => [uid,seat(p,g)]))};
}

function confirmation(receipt) {
  return {ok:true, tableId:receipt.tableId, tableUpdate:actionUpdate(receipt.tableUpdate)};
}
module.exports = {actionUpdate, confirmation, fields, cards, records, ids};
