'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{allocateRake}=require('../functions/pokerRake');
test('rake allocates every cent once across humans and bots with deterministic remainders',()=>{
 const players=[{uid:'alice'},{uid:'bot_one',isBot:true},{uid:'zed'}];
 for(let cents=1;cents<200;cents++){const a=allocateRake(cents/100,players);assert.equal(a.reduce((n,p)=>n+Math.round(p.amount*100),0),cents);assert.deepEqual(a,allocateRake(cents/100,[...players].reverse()));assert.equal(a.find(p=>p.uid==='bot_one').isBot,true);}
});
test('tournament entry and rebuy fee weights preserve the bot share',()=>{
 const a=allocateRake(20,[{uid:'human',weight:1},{uid:'bot_a',isBot:true,weight:3,fundingUid:'owner'}]);assert.equal(a.find(p=>p.uid==='human').amount,5);assert.equal(a.find(p=>p.isBot).amount,15);
});
test('the chip guard recognizes rake after the 100-hand history cap without suppressing unexplained loss',()=>{
 const {newlyBookedRake}=require('../functions/pokerRake'),before=Array.from({length:100},(_,at)=>({at,rake:.15})),after=[...before.slice(1),{at:100,rake:.36}];
 assert.equal(newlyBookedRake(before,after),.36);assert.equal(newlyBookedRake(after,after),0);assert.equal(newlyBookedRake([],[{at:1,rake:.12}]),.12);assert.equal(newlyBookedRake(before,[{at:999,rake:100}]),0);
});
