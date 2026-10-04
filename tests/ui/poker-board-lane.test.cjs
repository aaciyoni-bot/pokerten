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
// A narrow pot label is a separate rectangle from the five-card board.
// Treating their union as solid used to move a clear board because a rail
// card shared the pot's vertical band, despite being well outside the label.
const union=rows=>{
 const left=Math.min(...rows.map(x=>x.left)),top=Math.min(...rows.map(x=>x.top));
 return r(left,top,Math.max(...rows.map(x=>x.right))-left,Math.max(...rows.map(x=>x.bottom))-top);
};
const translated=(rows,delta)=>rows.map(x=>r(x.left,x.top+delta,x.width,x.height));
{
 const rows=[r(145,190,80,28),r(74,230,221,60)],board=union(rows);
 const obstacles=[r(78,185,42,35),r(252,187,40,30)];
 const result=choose({board,rows,obstacles,top:150,bottom:400,gap:7});
 assert.equal(result.overlap,0,'rail objects beside the narrow pot are clear');
 assert.equal(result.top,board.top,'a clear arrangement is not moved');
 assert.ok(choose({board,obstacles,top:150,bottom:400,gap:7}).top!==board.top,'the old union rectangle would move unnecessarily');
 // Changing the obstacle to intersect the actual pot must still be detected.
 const blocked=[r(165,198,30,15)];
 const moved=choose({board,rows,obstacles:blocked,top:150,bottom:400,gap:7});
 assert.notEqual(moved.top,board.top,'an obstructed pot moves with the board');
 assert.equal(moved.overlap,0);
 assert.ok(translated(rows,moved.top-board.top).every(x=>blocked.every(h=>!intersects(x,h))));
}
// Compact text/bet panels need a physical 1px gap; hole-card ranks retain the
// larger 7px safety margin. Filtering, candidate edges and scoring agree.
{
 const board=r(74,220,221,60),hole=r(60,140,40,73),panel={...r(10,222,63,40),gap:1};
 const result=choose({board,obstacles:[hole,panel],top:210,bottom:285,gap:7});
 assert.equal(result.top,220,'a rail panel 1px beside the board does not displace it');
 assert.equal(result.overlap,0);
 assert.equal(board.top-hole.bottom,7,'the independent hole-card margin is retained');
 assert.ok(choose({board,obstacles:[hole,{...panel,gap:7}],top:210,bottom:285,gap:7}).overlap>0,'uniform 7px panel padding would wrongly reject this clear lane');
 const above={...r(80,180,40,30),gap:1},below=r(90,278,40,30),moving=r(74,200,221,60);
 const placed=choose({board:moving,obstacles:[above,below],top:190,bottom:300,gap:7});
 assert.equal(placed.top,211,'candidate fits exactly between panel +1px and hole card +7px');
 assert.equal(placed.overlap,0);
 const actual=r(moving.left,placed.top,moving.width,moving.height);
 assert.equal(actual.top-above.bottom,1);
 assert.equal(below.top-actual.bottom,7);
 assert.ok(!intersects(actual,above)&&!intersects(actual,below));
 const blocked=choose({board,obstacles:[{...r(90,225,50,25),gap:1}],top:220,bottom:280,gap:7});
 assert.ok(blocked.overlap>0,'a panel that physically covers cards remains an obstruction');
 const zero=choose({board,obstacles:[{...r(90,190,50,30),gap:0}],top:220,bottom:280,gap:7});
 assert.equal(zero.overlap,0,'explicit zero uses nullish fallback, not truthy fallback');
}
// Full-size 60%-width rows, including two runouts, keep each card's size and
// spacing while choosing a lane. These are helper geometry cases; browser
// diagnostics separately validate the actual 8/9-seat CSS and card fans.
for(const [width,height] of [[369,650],[390,844]])for(const two of [false,true]){
 const cardHeight=(width*.6-12)/5*1.4,boardTop=height*.43;
 const rows=[r(width/2-40,boardTop-39,80,28),r(width*.2,boardTop,width*.6,cardHeight)];
 if(two)rows.push(r(width*.2,boardTop+cardHeight+10,width*.6,cardHeight));
 const board=union(rows);
 const obstacles=[
  r(8,height*.18,100,60),r(width-108,height*.18,100,60),
  r(8,height*.68,100,60),r(width-108,height*.68,100,60),
  r(18,height*.8,125,65)
 ];
 const result=choose({board,rows,obstacles,top:height*.23,bottom:height*.76,gap:7});
 assert.equal(result.overlap,0,`${width}x${height} full-size ${two?'two':'one'} board rows find a clear lane`);
 const placed=translated(rows,result.top-board.top);
 assert.ok(placed.every(x=>obstacles.every(h=>!intersects(x,h))));
 assert.ok(placed.every((x,i)=>x.width===rows[i].width&&x.height===rows[i].height),'no card resizing');
 assert.equal(placed.at(-1).bottom-placed[0].top,board.height,'pot and runouts move as one group');
 const again=choose({board:union(placed),rows:placed,obstacles,top:height*.23,bottom:height*.76,gap:7});
 assert.deepEqual(again,result,'repeated placement does not accumulate movement');
}
// If cards, names or bets fill the available lane, report the real collision.
// Two runouts cannot be declared clear merely because the first row fits.
{
 const rows=[r(144,220,80,28),r(74,258,221,59),r(74,327,221,59)],board=union(rows);
 const obstacles=[r(0,0,369,245),r(0,350,369,300)];
 const result=choose({board,rows,obstacles,top:150,bottom:494,gap:7});
 assert.ok(result.overlap>0,'insufficient vertical room is reported');
 assert.ok(translated(rows,result.top-board.top).some(x=>obstacles.some(h=>intersects(x,h))),'reported obstruction is an actual row collision');
}
// Short viewports / an action dock can leave less height than the board group.
// Bounds are real obstructions even when no player card intersects the rows.
{
 const rows=[r(144,170,80,28),r(74,208,221,59),r(74,277,221,59)],board=union(rows);
 const result=choose({board,rows,obstacles:[],top:150,bottom:275,gap:7});
 assert.equal(result.top,150,'an oversized group stays at the upper permitted edge');
 assert.equal(result.overlap,board.height-(275-150),'overflow beyond the control boundary is counted');
 assert.ok(result.overlap>0,'impossible short viewport cannot report a clear board');
 const fits=choose({board,rows,obstacles:[],top:150,bottom:370,gap:7});
 assert.equal(fits.overlap,0,'a sufficiently tall viewport is unaffected');
 assert.equal(fits.top,board.top,'already-clear placement remains stable');
}
assert.ok(choose({board:r(50,100,200,100),obstacles:[r(0,0,300,400)],top:50,bottom:300}).overlap>0);
console.log('Poker board lane: full-size rows, separate narrow pot, blocked runouts, unchanged card sizes and stable repeat placement passed');
