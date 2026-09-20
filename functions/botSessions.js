'use strict';
const crypto=require('node:crypto');
function session(uid,now){
 const h=crypto.createHash('sha256').update(String(uid)).digest();
 return{botJoinedAt:now,botLeavesAt:now+(25+h.readUInt16BE(0)%11)*60000};
}
function rotationGap(uid){return(1+crypto.createHash('sha256').update(String(uid)).digest()[2]%2)*60000;}
module.exports={session,rotationGap};
