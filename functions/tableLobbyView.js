'use strict';
const {isDeepStrictEqual} = require('node:util');
const {fields,records} = require('./pokerPlayerView');

const settingsKeys='name tableName baseGameType pokerType isDealerChoice blinds minBuyIn maxBuyIn minBuyInBB maxBuyInBB maxPlayers autoStart actionTime ante straddle bombEvery bombAnte aofEvery omahaPotLimit runTwice maxRuns leaveNoticeMins leaveNoticeBB rakePercent rakeCap serverEngine spinMode spinBuyIn spinStack spinLevelSec buyIn deckSize variant stake bluff bluffEnabled';
function project(t) {
  if(t?.authorityVersion!==2 || !['poker','ofc','durak'].includes(t.type))return null;
  const row={...fields(t,'authorityVersion type clubId createdAt createdBy archived cardGameVersion status tournamentId spinDone'), settings:fields(t.settings,settingsKeys),
    players:Object.fromEntries(Object.entries(t.players||{}).map(([id,p])=>[id,fields(p,'uid name username photo avatarSeed seatIndex status left stack sitOut')])),
    gameState:fields(t.gameState,'phase'), history:records(t.history,h=>fields(h,'at')),
    waitlist:records(t.waitlist,p=>fields(p,'uid at seenAt isBot')),
    closeRequested:!!t.closeRequested};
  if(t.pendingSettings)row.pendingSettings={settings:fields(t.pendingSettings.settings,settingsKeys)};
  if(t.tournament)row.tournament=fields(t.tournament,'name finished cancelled final');
  if(t.spin)row.spin=fields(t.spin,'fundingPending');
  return row;
}

// Re-read the authoritative document in the transaction. A delayed event must
// never reopen a deleted table or republish seats from before a move.
async function refresh(db,id){
  const source=db.doc('tables/'+id),dest=db.doc('tableLobbyViews/'+id);
  return db.runTransaction(async tx=>{
    const [snap,prior]=await tx.getAll(source,dest);
    const next=snap.exists?project(snap.data()):null;
    if(next===null){if(prior.exists)tx.delete(dest);return prior.exists;}
    if(prior.exists&&isDeepStrictEqual(prior.data(),next))return false;
    tx.set(dest,next);return true;
  });
}
async function backfill(db){
  let cursor,scanned=0,written=0;
  do{
    let q=db.collection('tables').where('authorityVersion','==',2).orderBy('__name__').limit(100);
    if(cursor)q=q.startAfter(cursor);
    const docs=(await q.get()).docs;
    for(const snap of docs){scanned++;if(await refresh(db,snap.id))written++;}
    cursor=docs.length===100?docs.at(-1).id:null;
  }while(cursor);
  return {scanned,written};
}
module.exports={project,refresh,backfill,isDeepStrictEqual};
