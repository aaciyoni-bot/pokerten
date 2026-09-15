'use strict';
const A = require('./pokerAuthority');
const {prepareLedger} = require('./pokerLedger');

async function archiveTable(tx,db,ref,table,by,now) {
  const privateDocs=await tx.get(ref.collection('priv'));
  tx.set(db.doc('_pkClosedTables/'+ref.id),{...table,closedAt:now,closedBy:by});
  tx.set(db.collection('_pkAudit').doc(),{action:'table-archive',tableId:ref.id,clubId:table.clubId,uid:by,at:now});
  for(const doc of privateDocs.docs)tx.delete(doc.ref);
  tx.delete(ref);return{ok:true,deleted:true,queued:false};
}

// Called only after the hand has settled. Cash pots are awarded by the engine,
// never divided or refunded by a client-side delete operation.
async function closeTable(tx, db, ref, table, by, now) {
  if (!A.idle(table)) A.fail('failed-precondition', 'The current hand must finish before this table closes');
  if (table.tournamentId) A.fail('failed-precondition', 'Tournament tables are managed by the tournament');
  const spin = table.settings?.spinMode;
  if (spin && table.spin && !table.spin.fundingPending && !table.spinDone) A.fail('failed-precondition', 'The Spin must finish before its table can be deleted');
  const effects = [];
  for (const player of Object.values(table.players || {})) {
    const amount = spin ? (table.spinDone ? 0 : A.number(player.spinPaid, 0, 0, 10000000)) :
      A.cash(A.number(player.stack, 0, 0, 1000000000) + A.number(player.pendingTopUp, 0, 0, 10000000));
    if (amount > 0) effects.push({type: 'credit', uid: A.payee(player), amount});
    if (!spin && !player.isBot) effects.push({type: 'gameLog', entries: [{
      uid: player.uid, username: player.name, profit: A.cash(amount - (player.buyTotal ?? player.stack ?? 0)), rake: 0
    }]});
  }
  const privateDocs = await tx.get(ref.collection('priv'));
  const write = await prepareLedger(db, tx, table.clubId, effects, ref.id, now);
  write();
  // Preserve the final state for an accounting review; default-deny rules keep
  // this archive private. The live table and its private-card documents go away.
  tx.set(db.doc('_pkClosedTables/' + ref.id), {...table, closedAt: now, closedBy: by});
  tx.set(db.collection('_pkAudit').doc(), {action: 'table-close', tableId: ref.id, clubId: table.clubId, uid: by, at: now});
  for (const doc of privateDocs.docs) tx.delete(doc.ref);
  tx.delete(ref);
  return {ok: true, deleted: true, queued: false};
}
module.exports = {closeTable,archiveTable};
