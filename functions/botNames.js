'use strict';
const crypto=require('node:crypto');
const men=['יוסי','אבי','איתי','אורן','דניאל','תומר','רועי','עידו','איציק','שלומי','אלון','ניר','אמיר','גיא','עומר','רונן','ליאור','אייל','גיל','נדב'];
const women=['נועה','מאיה','יעל','שירה','תמר','מיכל','דנה','ליאת','אורית','איילת','הילה','נעמה','רוני','שני','נופר','קרן','עדי','מור','רותם','שחר'];
const last=['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','פרידמן','שפירא','רוזן','כץ','דוד','אוחיון','גבאי','חדד','אסולין','ברק','גולן','לביא','הררי','אלון','שמש','סגל','שחר','ישראלי','שלום','ארבל','רז','רבין','הראל','כרמי'];
const nick=['קפטן אס','מלכת הלבבות','דג מלוח','פלאפל חריף','קלף מנצח','רוח ים','שועל המדבר','פלפל שחור','לילה לבן','תות שדה','צ׳יפס בצד','נס קפה','חומוס ביתי','הפנתר','טורבו','ירח מלא','רביעיית אסים','דובדבן','בזוקה','הקוסמת'];
const generic=name=>!String(name||'').trim()||/^bot(?:[\s_-]*\d+)?$/i.test(String(name).trim());
function botName(uid,used=[]){
 const names=new Set(used);
 for(let salt=0;salt<2000;salt++){
  const h=crypto.createHash('sha256').update(String(uid)+':'+salt).digest();
  const first=h[0]%2?women:men;
  const name=h[1]%4===0?nick[h.readUInt16BE(2)%nick.length]:first[h.readUInt16BE(4)%first.length]+' '+last[h.readUInt16BE(6)%last.length];
  if(!names.has(name))return name;
 }
 throw Error('No unused bot display name available');
}
function renameGenericBots(players,roster){
 let changed=false;const used=Object.values(players||{}).map(p=>p.name||p.username).filter(n=>!generic(n));
 for(const [uid,p]of Object.entries(players||{})){
  if(!p.isBot||!generic(p.name||p.username))continue;
  const known=roster?.[uid]?.name;
  p.name=!generic(known)?known:botName(uid,used);used.push(p.name);
  if(Object.prototype.hasOwnProperty.call(p,'username'))p.username=p.name;
  changed=true;
 }
 return changed;
}
module.exports={botName,renameGenericBots,generic};
