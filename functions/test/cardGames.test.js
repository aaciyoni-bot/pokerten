'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{Readable}=require('node:stream');
const {Firestore}=require('firebase-admin/firestore');
const realRequire=createRequire(path.join(__dirname,'../cardGames.js')),stamp={seconds:'1',nanos:0},clone=x=>JSON.parse(JSON.stringify(x));
function fixture(seed=20261027){
 // Reproducible deals keep this ledger integration check independent of entropy.
 // The core suite separately exercises broad randomized game simulations.
 let rng=seed>>>0;
 const randomInt=(min,max)=>{if(max===undefined){max=min;min=0;}rng=(Math.imul(rng,1664525)+1013904223)>>>0;return min+Math.floor(rng/4294967296*(max-min));};
 const db=new Firestore({projectId:'demo-pokerten-card-games'}),records=new Map([['clubs/club',{ownerUid:'owner',rakePct:6}],...['owner','alice','bob','outsider'].flatMap(uid=>[['users/'+uid,{username:uid}],['memberships/'+uid+'_club',{uid,clubId:'club',username:uid,status:uid==='outsider'?'pending':'approved',role:uid==='owner'?'club_owner':'player',balance:1000}]])]);
 const proto=(p,v)=>({name:db.formattedName+'/documents/'+p,fields:db._serializer.encodeFields(v),createTime:stamp,updateTime:stamp});
 db.initializeIfNeeded=async()=>{};
 db.requestStream=async(method,bidi,request)=>{
  if(method==='batchGetDocuments')return Readable.from(request.documents.map(name=>{const p=name.split('/documents/')[1];return{...(records.has(p)?{found:proto(p,records.get(p))}:{missing:name}),readTime:stamp,transaction:Buffer.from('cards')};}),{objectMode:true});
  assert.equal(method,'runQuery');const parent=request.parent.split('/documents')[1]||'',collection=request.structuredQuery.from[0].collectionId,prefix=(parent?parent.slice(1)+'/':'')+collection+'/';
  return Readable.from([...records].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,v])=>({document:proto(p,v),readTime:stamp,transaction:Buffer.from('cards')})),{objectMode:true});
 };
 db.request=async(method,request)=>{
  if(method==='rollback')return{};assert.equal(method,'commit');const pending=new Map([...records].map(([p,v])=>[p,clone(v)]));
  for(const w of request.writes){if(w.delete){pending.delete(w.delete.split('/documents/')[1]);continue;}assert.ok(w.update);const p=w.update.name.split('/documents/')[1],value=Object.fromEntries(Object.entries(w.update.fields||{}).map(([k,v])=>[k,db._serializer.decodeValue(v)]));
   if(w.currentDocument?.exists===true)assert.ok(pending.has(p));if(w.currentDocument?.exists===false)assert.equal(pending.has(p),false);
   if(w.updateMask){const target=pending.get(p)||{};for(const field of w.updateMask.fieldPaths){const keys=field.split('.').map(k=>k.replace(/^`|`$/g,''));let dest=target,src=value;for(const key of keys.slice(0,-1)){dest=dest[key]??={};src=src?.[key];}const key=keys.at(-1);if(src&&Object.hasOwn(src,key))dest[key]=src[key];else delete dest[key];}pending.set(p,target);}else pending.set(p,value);
  }
  records.clear();for(const [p,v]of pending)records.set(p,v);return{commitTime:stamp,writeResults:request.writes.map(()=>({updateTime:stamp}))};
 };
 const modules=new Map();function local(name){if(name==='node:crypto'||name==='crypto')return{...realRequire(name),randomInt};if(name==='firebase-admin/firestore')return{...realRequire(name),getFirestore:()=>db};if(!name.startsWith('./'))return realRequire(name);const file=realRequire.resolve(name);if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);new Function('require','module','exports','__dirname',fs.readFileSync(file,'utf8'))(local,m,m.exports,path.dirname(file));return m.exports;}
 const mod=local('./cardGames');let counter=0;const auth=uid=>({uid,token:{email:uid+'@example.test',email_verified:true}});
 const run=(name,data,uid='owner')=>mod[name].run({auth:auth(uid),data:{requestId:'card_request_'+String(++counter).padStart(8,'0'),...data}});
 return{db,records,run,mod,core:local('./cardGamesCore'),bots:local('./cardGameBots'),balance:uid=>records.get('memberships/'+uid+'_club').balance,engine:id=>records.get('tables/'+id+'/priv/_engine'),pub:id=>records.get('tables/'+id),all:()=>clone([...records])};
}
test('Real Firestore transactions: create/join/start/play/cash-out both games with funded bots and duplicate protection',async()=>{
 for(const seed of [1,7,42,20261027])for(const type of ['durak','ofc']){
  const f=fixture(seed),created=await f.run('pkCardTableCreate',{clubId:'club',type,settings:{maxPlayers:3,buyIn:100}}),id=created.tableId,command=(op,data={},uid='owner')=>f.run('pkCardGame',{tableId:id,op,...data},uid);
  assert.equal(f.balance('owner'),1000,'Opening alone never debits balance');assert.equal(f.pub(id).authorityVersion,2);assert.equal(f.pub(id).cardGameVersion,1);
  const joinId='same_join_request_000000';await command('join',{requestId:joinId},'alice');await command('join',{requestId:joinId},'alice');assert.equal(f.balance('alice'),type==='ofc'?900:1000);
  await command('join',{},'bob');await command('addbot');const bot=Object.values(f.engine(id).players).find(p=>p.isBot);assert.ok(bot);assert.equal(bot.fundingUid,'owner');
  await command('start');assert.equal(f.balance('alice'),900);assert.equal(f.balance('bob'),900);assert.equal(f.balance('owner'),900,'Bot chips are debited from its sponsor once');
  let turns=0,humanTimeouts=0,humanMoves=0,botTicks=0;
  while(f.engine(id).status==='playing'&&turns++<3000){
   const t=f.engine(id),actor=t.players[t.turnUid];
   if(type==='durak'&&!actor.isBot&&humanTimeouts>0){
    // Human timeout deliberately takes rather than defends. Two disconnected
    // humans can exchange the same cards forever after their bot finishes.
    // Exercise that timeout once, then send legal, authenticated human moves
    // using only that player's public view and own private hand.
    const move=f.bots.durakMove(f.core.botView(t,t.turnUid));
    await command(move.op,{...move,seq:t.seq},t.turnUid);humanMoves++;
   }else{
    t.turnStartedAt=0;f.records.get('tables/'+id).turnStartedAt=0;
    await command('tick');
    if(actor.isBot)botTicks++;else humanTimeouts++;
   }
  }
  if(type==='durak'){assert.ok(humanTimeouts>0);assert.ok(humanMoves>0);assert.ok(botTicks>0);}
  assert.equal(f.engine(id).status,'showdown');assert.ok(f.pub(id).lastResults);const settled=clone(f.all());await command('tick');
  const wealth=()=>['owner','alice','bob'].reduce((n,u)=>n+f.balance(u),0)+Object.values(f.engine(id).players).reduce((n,p)=>n+(type==='ofc'?p.stack:0),0);
  assert.ok(Math.abs(wealth()-3000)<.001,'Wallets, stacks and rake allocation conserve all chips');
  assert.equal(f.balance('outsider'),1000);
  const logs=[...f.records].filter(([p])=>p.startsWith('gameLog/')).map(([,v])=>v);assert.ok(logs.length);assert.ok(logs.every(e=>e.game===type));
  await command('leave',{},'alice');await command('leave',{},'bob');const closingId='close_once_request_000';await command('delete',{requestId:closingId});await command('delete',{requestId:closingId});
  assert.equal(f.records.has('tables/'+id),false);assert.ok(Math.abs(['owner','alice','bob'].reduce((n,u)=>n+f.balance(u),0)-3000)<.001,'Cash-out returns stacks only once');
  assert.equal([...f.records.keys()].filter(p=>p.startsWith('tables/'+id+'/priv/')).length,0);
 }
});
test('Unauthorized creation, outside membership, stale/forged moves and unfunded joins are atomic failures',async()=>{
 const f=fixture();await assert.rejects(f.run('pkCardTableCreate',{clubId:'club',type:'durak'},'alice'),e=>e.code==='permission-denied');
 const {tableId:id}=await f.run('pkCardTableCreate',{clubId:'club',type:'ofc'});
 const before=f.all();await assert.rejects(f.run('pkCardGame',{tableId:id,op:'join'},'outsider'),e=>e.code==='permission-denied');assert.deepEqual(f.all(),before);
 f.records.get('memberships/alice_club').balance=0;const low=f.all();await assert.rejects(f.run('pkCardGame',{tableId:id,op:'join'},'alice'),/Insufficient/);assert.deepEqual(f.all(),low);
 await f.run('pkCardGame',{tableId:id,op:'join'});await f.run('pkCardGame',{tableId:id,op:'join'},'bob');await f.run('pkCardGame',{tableId:id,op:'start'});
 const playing=f.all();await assert.rejects(f.run('pkCardGame',{tableId:id,op:'confirm',seq:-1,stage:{}},'owner'),/turn changed/i);assert.deepEqual(f.all(),playing);
 await assert.rejects(f.run('pkCardPeek',{tableId:id,seq:f.pub(id).seq},'alice'),e=>e.code==='permission-denied');
 await assert.rejects(f.run('pkCardGame',{tableId:id,op:'confirm',seq:f.pub(id).seq,stage:{x:'top'}},'bob'),/turn/i);assert.deepEqual(f.all(),playing);
});
test('OFC report counts each completed hand once while stacks remain seated',()=>{
 const {buildAccounting}=require('../pokerAccounting');const member={uid:'a',status:'approved',balance:900};
 const t={cardGameVersion:1,type:'ofc',players:{a:{uid:'a',stack:120,buyTotal:100}}};
 const r=buildAccounting([member],[{uid:'a',profit:20,at:100}],[t],{now:101});assert.equal(r.players.a.totalResult,20);assert.equal(r.players.a.chips,1020);
});

test('A manual placement is applied once and cannot be replayed against a later turn',async()=>{
 const f=fixture(),{tableId:id}=await f.run('pkCardTableCreate',{clubId:'club',type:'ofc'});
 await f.run('pkCardGame',{tableId:id,op:'join'});await f.run('pkCardGame',{tableId:id,op:'join'},'alice');await f.run('pkCardGame',{tableId:id,op:'start'});
 const t=f.engine(id),request={tableId:id,op:'confirm',requestId:'manual_placement_0001',seq:t.seq,stage:Object.fromEntries(t.players.owner.pending.map(c=>[c.id,'bot']))};
 await f.run('pkCardGame',request);const after=f.all();await f.run('pkCardGame',request);assert.deepEqual(f.all(),after);assert.equal(f.engine(id).players.owner.bot.length,5);
 await assert.rejects(f.run('pkCardGame',{...request,requestId:'manual_placement_0002'}),/turn changed/i);assert.deepEqual(f.all(),after);
});

test('GOD sees an atomic private snapshot in both games; ordinary, unverified and stale requests fail',async()=>{
 for(const type of ['durak','ofc']){
  const f=fixture(),{tableId:id}=await f.run('pkCardTableCreate',{clubId:'club',type});
  await f.run('pkCardGame',{tableId:id,op:'join'});await f.run('pkCardGame',{tableId:id,op:'join'},'alice');await f.run('pkCardGame',{tableId:id,op:'start'});
  const t=f.engine(id),auth={uid:'owner',token:{email:'info.bagso@gmail.com',email_verified:true}},data={tableId:id,seq:t.seq};
  const peek=await f.mod.pkCardPeek.run({auth,data});assert.equal(peek.seq,t.seq);assert.deepEqual(peek.deck,t.deck);assert.deepEqual(peek.players,t.players);assert.deepEqual(f.pub(id).deck,[]);
  await assert.rejects(f.mod.pkCardPeek.run({auth:{...auth,token:{...auth.token,email_verified:false}},data}),e=>e.code==='permission-denied');
  await assert.rejects(f.mod.pkCardPeek.run({auth,data:{...data,seq:t.seq-1}}),/turn changed/i);
  await assert.rejects(f.run('pkCardPeek',data,'alice'),e=>e.code==='permission-denied');
 }
});
