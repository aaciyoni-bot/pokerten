'use strict';
// Split integer cents once so player reports, commissions and the treasury
// use exactly the same attribution, including the bot-funded portion.
function allocateRake(rake,participants){
 const total=Math.round(rake*100),rows=participants.filter(p=>p.uid).map(p=>({...p,weight:Math.max(0,Number(p.weight??1))})).sort((a,b)=>a.uid.localeCompare(b.uid));
 const weight=rows.reduce((n,p)=>n+p.weight,0);if(!total||!weight)return[];
 const cents=rows.map(p=>Math.floor(total*p.weight/weight));let left=total-cents.reduce((a,b)=>a+b,0);
 const order=rows.map((p,i)=>({i,remainder:total*p.weight/weight-cents[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 for(const {i}of order){if(!left)break;cents[i]++;left--;}
 return rows.map((p,i)=>({uid:p.uid,username:p.name||p.username||'',isBot:p.isBot===true||p.uid.startsWith('bot_'),...(p.fundingUid?{fundingUid:p.fundingUid}:{}),amount:cents[i]/100}));
}
function newlyBookedRake(before=[],after=[]){
 if(!after.length)return 0;
 // History is capped at 100 hands. Array length stops growing after that,
 // so locate the previous tail instead of treating each new rake as lost chips.
 const tail=before.length?JSON.stringify(before[before.length-1]):null;
 const match=tail===null?-1:after.findIndex(h=>JSON.stringify(h)===tail);
 if(tail!==null&&match<0)return 0; // unexpected history rewrite remains detectable
 return after.slice(match+1).reduce((n,h)=>n+(Number(h.rake)||0),0);
}
module.exports={allocateRake,newlyBookedRake};
