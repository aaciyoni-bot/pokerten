'use strict';
const crypto=require('node:crypto');
function session(uid,now){
 const h=crypto.createHash('sha256').update(String(uid)).digest();
 return{botJoinedAt:now,botLeavesAt:now+(25+h.readUInt16BE(0)%11)*60000};
}
function rotationGap(uid){return(1+crypto.createHash('sha256').update(String(uid)).digest()[2]%2)*60000;}
// A saved default follows the table's current entry limits if a manager changes them.
function cashBotBuyIn(settings, bigBlind=(settings.blinds??0.5)*2){
 const min=settings.minBuyIn??40*bigBlind, max=settings.maxBuyIn??200*bigBlind;
 return Math.round(Math.min(max,Math.max(min,settings.botBuyIn??100*bigBlind))*100)/100;
}
module.exports={session,rotationGap,cashBotBuyIn};
