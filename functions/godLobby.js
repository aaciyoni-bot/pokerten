"use strict";

// An occupancy-only endpoint. It never loads private hands, the deck, user
// profiles or waitlist entries. Authorization is the engine's existing GOD
// identity predicate, not club ownership, management or a client preference.
const seatEntries = table => Object.entries(table.players || {}).filter(([, p]) => p && typeof p === "object" && p.status !== "left" && p.left !== true);
function summarize(tableId, table) {
  const seats = seatEntries(table);
  let humans = 0, bots = 0, unknown = 0;
  for (const [, player] of seats) {
    if (player.isBot === true) bots++;
    else if (player.isBot === false) humans++;
    else unknown++;
  }
  return {tableId, humans, bots, unknown, seated: seats.length,
    occupancyKey: JSON.stringify(seats.map(([uid]) => uid).sort())};
}

// Only the shared state of server-engine poker tables is returned here. All private
// hand/deck reads remain in godPeek, where the hand context is validated atomically.
async function readPublicTables(db,data,HttpsError) {
  const valid = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  if (!valid(data.clubId) || (data.tableId !== undefined && !valid(data.tableId)) ||
      (data.cursor !== undefined && !valid(data.cursor))) throw new HttpsError('invalid-argument','Invalid table scope');
  const tables=db.collection('tables');
  let docs;
  if (data.tableId) {
    docs=[await tables.doc(data.tableId).get()];
  } else {
    let query=tables.where('authorityVersion','==',2).where('clubId','==',data.clubId)
      .orderBy(require('firebase-admin/firestore').FieldPath.documentId()).limit(40);
    if (data.cursor) query=query.startAfter(data.cursor);
    docs=(await query.get()).docs;
  }
  const rows=[];
  for (const doc of docs) {
    if (!doc.exists) continue;
    const t=doc.data();
    if(t.clubId===data.clubId && t.type==='poker' && t.authorityVersion===2 && t.settings?.serverEngine===true)
      rows.push({...t,docId:doc.id});
  }
  return {rows,cursor:!data.tableId && docs.length===40 ? docs[docs.length-1].id : null};
}

function createCallable({onCall, HttpsError, db, isGodAuth, CALL_OPTS}) {
  return onCall(CALL_OPTS, async request => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first");
    if (request.data?.mode === 'access') {
      return {uid:request.auth.uid,god:isGodAuth(request.auth),oversight:require('./pokerAuthority').root(request)};
    }
    if (!isGodAuth(request.auth)) throw new HttpsError("permission-denied", "GOD access required");
    if (request.data?.mode === 'watch') return readPublicTables(db(),request.data,HttpsError);
    const {clubId, tableIds} = request.data || {};
    const validId = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("/");
    if (!validId(clubId) || !Array.isArray(tableIds) || tableIds.length > 60 || tableIds.some(id => !validId(id))) {
      throw new HttpsError("invalid-argument", "Provide a club and up to 60 table IDs");
    }
    const ids = [...new Set(tableIds)];
    if (!ids.length) return {tables: []};
    const snaps = await db().getAll(...ids.map(id => db().collection("tables").doc(id)));
    const tables = [];
    snaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const table = snap.data();
      if ((table.clubId || "main") !== clubId || !["poker", "durak", "ofc"].includes(table.type)) return;
      tables.push(summarize(ids[index], table));
    });
    return {tables};
  });
}

module.exports = {createCallable, summarize};
