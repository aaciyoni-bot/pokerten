'use strict';

// Keep this public-state fingerprint in sync with PokerRuntime.godCardContext.
// Bets/presence do not change cards and deliberately do not invalidate a peek.
function godCardContext(table) {
  const g = table?.gameState || {}, players = table?.players || {};
  return JSON.stringify([Number(table?.handCount) || 0, Number(g.handN) || 0, g.phase || '', g.currentGameType || '',
    (g.board || []).map(c => [c.val, c.suit]),
    Object.keys(players).filter(uid => (players[uid]?.cardCount || 0) > 0).sort()
      .map(uid => [uid, players[uid].cardCount])]);
}

function createCallable({onCall, HttpsError, db, isGodAuth, CALL_OPTS}) {
  return onCall(CALL_OPTS, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in first');
    if (!isGodAuth(request.auth)) throw new HttpsError('permission-denied', 'Not allowed');
    const id = request.data?.tableId;
    if (typeof id !== 'string' || !id || id.length > 1500 || id.includes('/')) {
      throw new HttpsError('invalid-argument', 'Invalid tableId');
    }
    const expected = request.data?.contextKey;
    if (expected !== undefined && (typeof expected !== 'string' || expected.length > 10000)) {
      throw new HttpsError('invalid-argument', 'Invalid card context');
    }
    const tableRef = db().collection('tables').doc(id);
    // Public board, private hands and deck must come from ONE committed state.
    // Independent reads can straddle a deal or a Pineapple discard.
    return db().runTransaction(async tx => {
      const tableSnap = await tx.get(tableRef);
      if (!tableSnap.exists) throw new HttpsError('not-found', 'Table not found');
      const table = tableSnap.data(), contextKey = godCardContext(table);
      if (expected !== undefined && expected !== contextKey) {
        throw new HttpsError('failed-precondition', 'The hand changed; refresh the table');
      }
      const players = table.players || {};
      const uids = Object.keys(players).filter(uid => (players[uid].cardCount || 0) > 0);
      const [engine, ...cards] = await tx.getAll(tableRef.collection('priv').doc('_engine'),
        ...uids.map(uid => tableRef.collection('priv').doc(uid)));
      const hands = {};
      cards.forEach((snap, index) => {
        const hand = snap.exists ? snap.data().cards || [] : [];
        if (hand.length !== players[uids[index]].cardCount) {
          throw new HttpsError('failed-precondition', 'Private cards are not ready for this hand');
        }
        hands[uids[index]] = hand;
      });
      const board = table.gameState?.board || [];
      const deck = engine.exists ? [...(engine.data().deck || [])] : [];
      const finalBoard = [...board];
      if (board.length === 0 && deck.length >= 4) {
        deck.pop(); finalBoard.push(deck.pop(), deck.pop(), deck.pop());
      }
      while (finalBoard.length < 5 && deck.length >= 2) {
        deck.pop(); finalBoard.push(deck.pop());
      }
      return {tableId: id, contextKey, handN: Number(table.gameState?.handN) || 0,
        hands, finalBoard: finalBoard.length === 5 ? finalBoard : []};
    });
  });
}
module.exports = {createCallable, godCardContext};
