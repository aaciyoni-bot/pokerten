'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const C=require('../functions/pokerCore');
const values=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const card=(rank,suit)=>({id:values[rank-2]+suit,val:values[rank-2],suit});
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('const evaluate5Cards ='),end=html.indexOf('\n};',start)+3;
const scope={};vm.runInNewContext(html.slice(start,end)+';this.evaluate=evaluate5Cards;',scope);
const worker={self:{}};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/js/poker-equity-worker.js'),'utf8')+';this.evaluate=evaluate5Cards;',worker);

// Independent lexicographic reference: category, then every relevant kicker.
function reference(ranks,flush){
 const rs=[...ranks].sort((a,b)=>b-a),counts=new Map();rs.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
 const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
 const straight=counts.size===5&&(rs[0]-rs[4]===4?rs[0]:rs.join(',')==='14,5,4,3,2'?5:0);
 if(straight&&flush)return[8,straight];
 if(groups[0][1]===4)return[7,...groups.map(g=>g[0])];
 if(groups[0][1]===3&&groups[1][1]===2)return[6,...groups.map(g=>g[0])];
 if(flush)return[5,...rs];
 if(straight)return[4,straight];
 if(groups[0][1]===3)return[3,...groups.map(g=>g[0])];
 if(groups[0][1]===2&&groups[1][1]===2)return[2,...groups.map(g=>g[0])];
 if(groups[0][1]===2)return[1,...groups.map(g=>g[0])];
 return[0,...rs];
}
test('all 7,462 distinct five-card ranks are ordered identically on server, client and worker',()=>{
 const hands=[];
 function visit(rs,min){
  if(rs.length===5){
   if(rs.some(r=>rs.filter(x=>x===r).length>4))return;
   const add=flush=>hands.push({key:reference(rs,flush),cards:rs.map((r,i)=>card(r,flush?'♥':C.SUITS[i%4]))});
   add(false);if(new Set(rs).size===5)add(true);return;
  }
  for(let r=min;r<=14;r++)visit([...rs,r],r);
 }
 visit([],2);assert.equal(hands.length,7462);
 hands.sort((a,b)=>{for(let i=0;i<a.key.length;i++){const d=a.key[i]-b.key[i];if(d)return d;}return 0;});
 let previous=-Infinity;
 for(const h of hands){const score=C.evaluate5Cards(h.cards);assert.ok(score>previous,`rank collision/reversal: ${h.key}, score ${score}, previous ${previous}`);assert.equal(scope.evaluate(h.cards),score);assert.equal(worker.evaluate(h.cards),score);previous=score;}
});
test('a five-card flush kicker wins the actual NLH showdown comparison',()=>{
 const board=[card(14,'♥'),card(13,'♥'),card(12,'♥'),card(7,'♥'),card(2,'♣')];
 assert.ok(C.bestScoreFull([card(6,'♥'),card(9,'♣')],board,'NLH')>C.bestScoreFull([card(3,'♥'),card(10,'♣')],board,'NLH'));
});
