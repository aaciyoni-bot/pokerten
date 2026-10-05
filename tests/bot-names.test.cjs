'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {botName,renameGenericBots,generic,familyKey,language}=require('../functions/botNames');
test('bot names include Israeli men, women and nicknames, stay stable and are unique across a full tournament',()=>{
 const used=[];for(let i=0;i<180;i++)used.push(botName('bot-test-'+i,used,{tableNames:[]}));
 assert.equal(new Set(used).size,180);assert.ok(used.every(n=>!generic(n)&&n.length<=24));
 assert.ok(used.some(n=>/^(Noa|Maya|Yael|Shira|Tamar|Michal|Dana|Liat|Orit|Ayelet) /.test(n)));
 assert.ok(used.some(n=>/^(Yossi|Avi|Itay|Oren|Daniel|Tomer|Roy|Ido|Itzik|Shlomi) /.test(n)));
 assert.ok(used.some(n=>/Captain|Queen|Falafel|Salty Fish|White Night|Turbo|Bazooka|Magician/.test(n)));
 assert.equal(botName('stable'),botName('stable'));assert.ok(used.every(n=>language(n)==='en'));
 assert.equal(language(botName('legacy-language-option',[],{language:'he'})),'en');
});
test('migration changes only generic bot display names, preserves money and IDs, and reuses tournament names',()=>{
 const players={a:{isBot:true,name:'BOT 1',stack:100,fundingUid:'owner',cards:[1]},b:{isBot:false,name:'Bot 2',stack:55},c:{isBot:true,name:'איתי לוי',stack:30},d:{isBot:true,username:'Bot 3',stack:12}};
 const before=structuredClone(players);assert.equal(renameGenericBots(players,{a:{name:'נועה כהן'}}),true);assert.equal(players.a.name,'נועה כהן');assert.deepEqual(players.b,before.b);assert.deepEqual(players.c,before.c);assert.equal(players.d.username,players.d.name);
 assert.equal(renameGenericBots(players),false);
 for(const uid of Object.keys(players)){const strip=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['name','username'].includes(k)));assert.deepEqual(strip(players[uid]),strip(before[uid]));}
});

test('every new full table uses Latin names without surname duplicates, including historical aliases',()=>{
 assert.equal(familyKey('אבי מזרחי'),familyKey('Oren Mizrahi'));assert.equal(familyKey('Oren Mizrachi'),familyKey('אבי מזרחי'));assert.equal(familyKey('Eli Ben-David'),familyKey('דנה בן דוד'));
 for(let t=0;t<80;t++){
  const used=[];for(let i=0;i<9;i++)used.push(botName('table-'+t+'-seat-'+i,used));
  assert.ok(used.every(n=>language(n)==='en'));
  const keys=used.map(familyKey).filter(Boolean);assert.equal(new Set(keys).size,keys.length);
 }
});
test('existing duplicate surnames are repaired once while unique historical names and tournament roster are preserved',()=>{
 const players={human:{name:'Yoni Mizrahi',stack:20,cards:[1]},a:{name:'אבי מזרחי',isBot:true,stack:50,bet:5,seatIndex:0},b:{name:'דנה מזרחי',isBot:true,stack:40,bet:10,seatIndex:1},c:{name:'יעל לוי',isBot:true,stack:30,seatIndex:2}};
 const roster=structuredClone(players),before=structuredClone(players);assert.equal(renameGenericBots(players,roster),true);
 assert.deepEqual(players.human,before.human);const keys=Object.values(players).map(p=>familyKey(p.name)).filter(Boolean);assert.equal(new Set(keys).size,keys.length);
 assert.equal(language(players.a.name),'en');assert.equal(language(players.b.name),'en');assert.equal(players.c.name,before.c.name,'a unique historical name is preserved');
 for(const id of ['a','b','c']){assert.equal(roster[id].name,players[id].name);assert.equal(players[id].stack,before[id].stack);assert.equal(players[id].bet,before[id].bet);}
 assert.equal(renameGenericBots(players,roster),false);
});
