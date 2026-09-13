'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {botName,renameGenericBots,generic}=require('../functions/botNames');
test('bot names include Israeli men, women and nicknames, stay stable and are unique across a full tournament',()=>{
 const used=[];for(let i=0;i<180;i++)used.push(botName('bot-test-'+i,used));
 assert.equal(new Set(used).size,180);assert.ok(used.every(n=>/[א-ת]/.test(n)&&!generic(n)&&n.length<=24));
 assert.ok(used.some(n=>/^(נועה|מאיה|יעל|שירה|תמר|מיכל|דנה|ליאת|אורית|איילת) /.test(n)));
 assert.ok(used.some(n=>/^(יוסי|אבי|איתי|אורן|דניאל|תומר|רועי|עידו|איציק|שלומי) /.test(n)));
 assert.ok(used.some(n=>/קפטן|מלכת|פלאפל|דג מלוח|לילה לבן|טורבו|בזוקה|הקוסמת/.test(n)));
 assert.equal(botName('stable'),botName('stable'));
});
test('migration changes only generic bot display names, preserves money and IDs, and reuses tournament names',()=>{
 const players={a:{isBot:true,name:'BOT 1',stack:100,fundingUid:'owner',cards:[1]},b:{isBot:false,name:'Bot 2',stack:55},c:{isBot:true,name:'איתי לוי',stack:30},d:{isBot:true,username:'Bot 3',stack:12}};
 const before=structuredClone(players);assert.equal(renameGenericBots(players,{a:{name:'נועה כהן'}}),true);assert.equal(players.a.name,'נועה כהן');assert.deepEqual(players.b,before.b);assert.deepEqual(players.c,before.c);assert.equal(players.d.username,players.d.name);
 assert.equal(renameGenericBots(players),false);
 for(const uid of Object.keys(players)){const strip=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['name','username'].includes(k)));assert.deepEqual(strip(players[uid]),strip(before[uid]));}
});
