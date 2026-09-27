'use strict';
const HUMAN_WAIT_LEASE_MS=5*60*1000;
// Bots do not own a player's lease. Active people always precede queued bots.
function normalizeWaitlist(table={},now=Date.now()){
 const seen=new Set(),humans=[],bots=[];
 for(const entry of Array.isArray(table.waitlist)?table.waitlist:[]){
  if(!entry||typeof entry.uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(entry.uid)||table.players?.[entry.uid]||seen.has(entry.uid))continue;
  const lastSeen=Number(entry.seenAt??entry.at);
  if(entry.isBot!==true&&(!Number.isFinite(lastSeen)||now-lastSeen>=HUMAN_WAIT_LEASE_MS))continue;
  seen.add(entry.uid);(entry.isBot===true?bots:humans).push(entry);
 }
 return[...humans,...bots];
}
module.exports={HUMAN_WAIT_LEASE_MS,normalizeWaitlist};
