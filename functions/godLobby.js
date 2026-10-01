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

function createCallable({onCall, HttpsError, db, isGodAuth, CALL_OPTS}) {
  return onCall(CALL_OPTS, async request => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first");
    if (!isGodAuth(request.auth)) throw new HttpsError("permission-denied", "GOD access required");
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
