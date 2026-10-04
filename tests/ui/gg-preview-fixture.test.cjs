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
  return{state,privateCards,hands,directory,scenario};
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
 console.log('GG preview fixture: 2–6 local cards, unique realistic deals, consistent public/GOD hands, RIT reservation and explicit geometry stress passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
