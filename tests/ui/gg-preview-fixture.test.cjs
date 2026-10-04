'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'../..'),preview=fs.readFileSync(path.join(__dirname,'gg-preview.html'),'utf8'),index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const outer=preview.slice(preview.indexOf('<script>')+8,preview.lastIndexOf('</script>'));
async function fixture(query){
 const dom=new JSDOM('<nav></nav><iframe></iframe>',{url:'http://localhost/tests/ui/gg-preview.html?'+query,runScripts:'outside-only'}),w=dom.window;
 try{
  w.fetch=async()=>({ok:true,text:async()=>index});
  await w.eval(outer);
  const source=w.document.querySelector('iframe').srcdoc;
  const match=source.match(/const previewState=(.*),privateCards=(.*),previewHands=(.*),previewDirectory=(.*),previewScenario=(.*);/);
  assert.ok(match,'fixture reaches the isolated, local application document');
  const [state,privateCards,hands,directory,scenario]=match.slice(1).map(JSON.parse);
  assert.ok(source.includes("connect-src 'none'"),'preview cannot call the live data service');
  return{state,privateCards,hands,directory,scenario,source};
 }finally{w.close();}
}
const key=c=>c.val+c.suit;
(async()=>{
 for(const [mode,count,seats] of [['nlh',2,9],['pineapple',3,9],['omaha4',4,9],['omaha5',5,9],['omaha',6,6]]){
  const f=await fixture(`mode=${mode}&seats=${seats}&full&opponents`);
  assert.equal(f.privateCards.length,count,`${mode}: the local private hand is present`);
  assert.equal(f.scenario.heroExpected,count);
  assert.equal(f.scenario.geometryOnly,false);
  for(const p of Object.values(f.state.players)){
   assert.equal(p.cardCount,count);
   assert.equal(p.cards.length,0,'an unrevealed opponent never has public faces');
   assert.equal(f.hands[p.uid].length,count);
  }
  const dealt=Object.values(f.hands).flat().map(key);
  assert.equal(new Set(dealt).size,dealt.length,'realistic fixture uses a unique deck');
 }
 const shown=await fixture('mode=omaha&seats=6&full&opponents=revealed&phase=showdown&bets');
 assert.equal(shown.state.gameState.lastWinners,undefined,'layout fixture does not invent a winner inconsistent with the dealt hands');
 assert.ok(Object.values(shown.state.players).every(p=>p.actionText!=='WINNER'),'no fabricated winner badge');
 for(const p of Object.values(shown.state.players)){
  assert.equal(p.bet,0,'showdown has no stale live bets');
  if(p.uid!=='me')assert.deepEqual(p.cards,shown.hands[p.uid],'public/GOD cards stay consistent');
 }
 const allin=await fixture('mode=omaha4&seats=9&full&allin&phase=turn&rit');
 assert.equal(allin.state.gameState.board.length,4);
 assert.equal(allin.state.gameState.allInReveal,true);
 assert.equal(allin.state.gameState.activeTurnUid,null);
 assert.equal(allin.scenario.geometryOnly,false);
 assert.equal(allin.privateCards.length,4);
 const exposed=Object.values(allin.hands).flat().map(key);
 assert.equal(new Set(exposed).size,exposed.length);
 for(const card of allin.state.gameState.board2)assert.ok(!exposed.includes(key(card)),'second runout is reserved from hole cards');
 const stress=await fixture('mode=omaha&seats=9&full&opponents=revealed&god');
 assert.equal(stress.scenario.geometryOnly,true,'physically impossible 54-hole-card scenario is labelled');
 assert.equal(stress.privateCards.length,6,'dense geometry stress cannot silently omit hero');
 for(const hand of Object.values(stress.hands))assert.equal(hand.length,6);
 const seated=await fixture('mode=omaha&seats=6&full&opponents&bets&phase=river');
 assert.equal(seated.state.gameState.board.length,5);
 assert.ok(Object.values(seated.state.players).some(p=>p.bet>0),'ordinary betting fixture retains live bets');
 // The browser report must catch a previous player's result badge covering
 // the next player's cards, not only a nameplate/card collision.
 const diagnosticDom=new JSDOM('<div class="poker-table" data-seat-count="9"><div class="poker-community" data-board-clear="true"></div><div data-player-uid="upper"><div class="poker-player-info"></div><div class="poker-result-meta"></div></div><div data-player-uid="lower"><div class="poker-hole-cards"><span></span></div></div></div>',{runScripts:'outside-only'});
 try{
  const w=diagnosticDom.window,rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
  w.document.querySelector('.poker-player-info').getBoundingClientRect=()=>rect(20,90,68,20);
  w.document.querySelector('.poker-result-meta').getBoundingClientRect=()=>rect(20,115,68,30);
  w.document.querySelector('.poker-hole-cards>span').getBoundingClientRect=()=>rect(15,130,40,55);
  const start=shown.source.indexOf('window.__previewLayoutReport=()=>{');
  const end=shown.source.indexOf('setTimeout(()=>{const report=window.__previewLayoutReport()',start);
  assert.ok(start>=0&&end>start);
  w.eval('const previewScenario={heroExpected:0};'+shown.source.slice(start,end));
  const result=w.__previewLayoutReport();
  assert.equal(result.cardPanelOverlaps.length,1,'result badge overlap is detected even when nameplate is clear');
  assert.equal(result.cardPanelOverlaps[0].cardUid,'lower');
  assert.equal(result.cardPanelOverlaps[0].panelUid,'upper');
  assert.equal(result.cardPanelOverlaps[0].panelType,'result');
  w.document.querySelector('.poker-result-meta').getBoundingClientRect=()=>rect(20,0,68,0);
  assert.equal(w.__previewLayoutReport().cardPanelOverlaps.length,0,'hidden or empty result metadata does not report a collision');
 }finally{diagnosticDom.window.close();}
 console.log('GG preview fixture: 2–6 local cards, unique realistic deals, consistent public/GOD hands, RIT reservation, explicit geometry stress and cross-seat result overlap diagnostics passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
