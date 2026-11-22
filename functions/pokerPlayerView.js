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
  state.rabbit = rabbitCards(g);
  return state;
}

const liveRevealPhases = new Set(['preflop','flop','discard','turn','river']);

function visibleCards(p, g) {
  if (p.cardCount === 0 || p.left === true) return [];
  const playing = p.status === 'active' || p.status === 'busted';
  if (g.phase === 'showdown') {
    const shown = p.reveal === true && (playing || p.status === 'folded');
    return shown || (playing && !p.mucked && !g.earlyWin) ? cards(p.cards) : [];
  }
  return liveRevealPhases.has(g.phase) && g.allInReveal === true && p.status === 'active' && !p.mucked ? cards(p.cards) : [];
}

function rabbitCards(g) {
  if (g.phase !== 'showdown' || g.earlyWin !== true) return null;
  const count = g.board?.length ?? 0;
  const pending = cards(g.rabbit);
  return [0,3,4].includes(count) && pending.length === 5-count ? pending : null;
}

function seat(p, g) {
  return {...fields(p, 'uid name photo avatarSeed seatIndex stack bet status cardCount actionText hasActed reveal mucked lastSeen sitOut sitAuto sitOutAt sitOutNext leavingAt bustedAt timeBankHand timeBankTurn'), cards:visibleCards(p,g)};
}

function actionUpdate(update) {
  const g = update.gameState;
  return {gameState:gameState(g), players:Object.fromEntries(Object.entries(update.players || {}).filter(([,p]) => p && typeof p === 'object').map(([uid,p]) => [uid,seat(p,g)]))};
}

function confirmation(receipt) {
  return {ok:true, tableId:receipt.tableId, tableUpdate:actionUpdate(receipt.tableUpdate)};
}
module.exports = {actionUpdate, confirmation, fields, cards, records, ids, visibleCards, rabbitCards};
