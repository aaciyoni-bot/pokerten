'use strict';

// The engine keeps tournaments/{id} as its authoritative record. Players read
// this explicit projection, written in the SAME transaction as every change.
// Never spread an engine record or nested entrant into a client response.
const fields = `authorityVersion clubId name game pokerType status createdAt
 startAt startedAt finishedAt cancelledAt archived archivedAt round seededRound
 mttMode serverEngine demoOnly entryCount minPlayers maxPlayers tableSize actionTime
 buyIn reentryBuyIn fee bounty bountyFree bountyMode mysteryBounty
 progressiveCashPct mysteryStartLevel addedPrize prizePool finalPrizePool
 prizePoolMode prizeAsBonus paidPct startStack earlyRegistrationBonusPct
 earlyRegistrationBonusUntilStart levelMins lateRegUntilLevel lateRegClosesAt
 reentry reentryToPrizePool maxReentries rebuys maxRebuys rebuyUntilLevel
 addon addonLevel anteType anteFromLevel breakEvery breakMins
 finishAtPaidPlaces initialChips tableRevision`.split(/\s+/);
const playerFields = `uid name photo avatarSeed playerId out outAt rank removed
 removalRequested tableId bounties bountyWon bountyValue rebuys reentries addon
 registeredAt earlyRegistrationBonusChips entryStartStack`.split(/\s+/);
const resultFields = ['uid','name','rank','prize','bounties','finalChips'];
const pick = (record, keys) => Object.fromEntries(keys.filter(k => record?.[k] !== undefined).map(k => [k, record[k]]));
function project(t) {
  if (t?.authorityVersion !== 2 || t.game !== 'poker') throw Error('Only authoritative poker tournaments can be projected');
  return {...pick(t, fields), privacyVersion: 1,
    players: Object.fromEntries(Object.entries(t.players || {}).map(([uid,p]) => [uid, pick(p, playerFields)])),
    results: (t.results || []).map(r => pick(r, resultFields)),
    structure: (t.structure || []).map(r => pick(r, ['sb','bb','ante','mins'])),
    payouts: [...(t.payouts || [])], winnerUids: [...(t.winnerUids || [])],
    prizeConfigRevision: (t.prizeConfigChanges || []).length};
}
function write(tx, db, id, tournament) {
  const {id: ignored, ...record} = tournament;
  const view = project(record); // Validate before queuing either write.
  tx.set(db.doc('tournaments/' + id), record);
  tx.set(db.doc('tournamentViews/' + id), view);
}
module.exports = {project, write};
