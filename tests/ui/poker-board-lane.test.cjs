'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const source=html.slice(html.indexOf('const pokerBoardLane ='),html.indexOf('const positionPokerCommunity ='));
const choose=vm.runInNewContext(source+'\npokerBoardLane');
const r=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
// Reported sparse PLO6: the board covers the leftmost indices of the lower
// right player's six-card fan. Include an upper fan so moving upward is bounded.
for(const [width,height] of [[369,650],[390,844]]){
 const board=r(width*.2,height*.4625,width*.6,Math.min(44,width*.6/5)*1.4);
 const holes=[r(width*.53,height*.535,width*.43,58),r(width*.04,height*.24,width*.43,58)];
 assert.ok(holes.some(h=>intersects(board,h)),'old fixed board overlaps a hole-card rank');
 const result=choose({board,obstacles:holes,top:height*.23,bottom:height*.76,gap:9});
 const placed=r(board.left,result.top,board.width,board.height);
 assert.equal(result.overlap,0,'responsive board finds clear lane');
 assert.ok(holes.every(h=>!intersects(placed,h)),'all hole-card ranks stay unobscured');
 assert.equal(placed.width,board.width,'no card shrinking');
 assert.deepEqual(choose({board:placed,obstacles:holes,top:height*.23,bottom:height*.76,gap:9}),result,'stable placement, no accumulating shift');
}
// Full tables / double boards use two rows of large faces on each rail.
// Their center lane must accommodate a full two-board rectangle, not merely
// the first row. A local player's private hand remains an obstacle below it.
for(const [width,height] of [[369,650],[390,844]])for(const count of [8,9])for(const two of [false,true]){
 const face=Math.min(40,Math.max(32,width*.095)),span=2.2*face;
 const holes=[.14,.30,.44,.58,.64].flatMap(y=>[r(16,height*y-1.85*face,span,2.3*face),r(width-16-span,height*y-1.85*face,span,2.3*face)]);
 holes.push(r(18,height-185,170,58));
 const board=r(width*.3,height*.40,width*.4,(width*.4-12)/5*1.4*(two?2:1)+(two?10:0));
 const result=choose({board,obstacles:holes,top:height*.23,bottom:height*.76,gap:9});
 const placed=r(board.left,result.top,board.width,board.height);
 assert.equal(result.overlap,0,`${width}x${height} ${count} seats ${two?'double':'single'} board clear`);
 assert.ok(holes.every(h=>!intersects(placed,h)));
}
// Fails honestly if a viewport is physically impossible; it never reports a
// clear lane merely because the board was clamped beyond the available region.
assert.ok(choose({board:r(50,100,200,100),obstacles:[r(0,0,300,400)],top:50,bottom:300}).overlap>0);
console.log('Poker board lane: reported overlap, narrow/tall phones, 8/9 seats, single/double boards and stable repeat placement passed');
