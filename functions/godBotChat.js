'use strict';
const A = require('./pokerAuthority');

function createCallable({onCall, HttpsError, isGodAuth, CALL_OPTS}) {
  return onCall(CALL_OPTS, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in first');
    if (!isGodAuth(request.auth)) throw new HttpsError('permission-denied', 'GOD MODE access required');
    require('./pokerSecurity').requirePokerAvailable();
    const tableId = A.key(request.data?.tableId, 'table');
    const targetUid = A.key(request.data?.targetUid, 'player');
    const text = typeof request.data?.text === 'string' ? request.data.text.trim() : '';
    if (!text || text.length > 240) throw new HttpsError('invalid-argument', 'Message must be 1–240 characters');
    return A.command(request, 'god-bot-chat', async (tx, db, uid, now) => {
      const ref = db.doc('tables/' + tableId), snap = await tx.get(ref);
      if (!snap.exists) A.fail('not-found', 'Table is no longer available');
      const table = snap.data(), clubId = A.key(table.clubId || 'main', 'club');
      await A.member(tx, db, clubId, request);
      if (table.type !== 'poker' || table.authorityVersion !== 2 || table.settings?.serverEngine !== true ||
          table.archived || table.tournament?.finished || table.tournament?.cancelled) {
        A.fail('failed-precondition', 'Open an active protected poker table');
      }
      const player = table.players?.[targetUid];
      if (!player || player.uid !== targetUid || player.isBot !== true || player.status === 'out') {
        A.fail('failed-precondition', 'This character is no longer seated at this table');
      }
      if (table.chatMuted) A.fail('failed-precondition', 'Table chat is muted. Unmute it before sending');
      const chat = Array.isArray(table.chat) ? table.chat : [];
      const last = [...chat].reverse().find(m => m.uid === targetUid);
      if (last && now - Number(last.at) < 1500) A.fail('resource-exhausted', 'Please wait a moment before sending again');
      const message = {id: request.data.requestId, uid: targetUid, name: String(player.name || 'Player').slice(0, 80), text, at: now};
      // Attribution is server-only. Do not put operator identity or management
      // fields in the public chat or change any seat, cards, turn, or balance.
      tx.set(db.collection('_pkAudit').doc(), {action: 'god-bot-chat', clubId, tableId, uid, targetUid,
        messageId: message.id, displayName: message.name, text, at: now});
      tx.update(ref, {chat: [...chat.slice(-59), message]});
      return {ok: true, message};
    });
  });
}
module.exports = {createCallable};
