'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Run only with the Firestore emulator');
const admin=require('../../functions/node_modules/firebase-admin');
const access=require('../../functions/pokerAccess');
const engine=require('../../functions/pokerEngine');
const request=(uid,data)=>({auth:{uid,token:{}},data:{...data,requestId:randomUUID()}});

test('table, action receipt and personal reveal follow one completed hand and current membership',async t=>{
  admin.initializeApp({projectId:'demo-pokerten-security'});
  const db=admin.firestore();
  t.after(async()=>{await db.terminate();await admin.app().delete();});
  const clubId='card-visibility-test',players=['card-visibility-one','card-visibility-two'];
  await db.doc('clubs/'+clubId).set({ownerUid:players[0]});
  for(const uid of players){
    await db.doc('users/'+uid).set({username:uid});
    await db.doc('memberships/'+uid+'_'+clubId).set({uid,clubId,status:'approved',role:uid===players[0]?'club_owner':'player',balance:1000});
  }
  const {tableId}=await access.pkTableCreate.run(request(players[0],{manual:true,clubId,settings:{baseGameType:'NLH',minBuyIn:40,maxBuyIn:200,blinds:0.5}}));
  for(const uid of players)await access.pkSeat.run(request(uid,{tableId,op:'join',amount:100}));
  await engine.pkDeal.run(request(players[0],{tableId}));
  const ref=db.doc('tables/'+tableId);
  const prior=(await ref.get()).data(),g=prior.gameState,actor=g.activeTurnUid;
  assert.ok(players.includes(actor));assert.ok(players.every(uid=>prior.players[uid].cards.length===0));
  const turn={handN:g.handN,phase:g.phase,turnStartedAt:g.turnStartedAt,highestBet:g.highestBet};
  const result=await engine.pkAct.run(request(actor,{tableId,action:'fold',expectedTurn:turn}));
  const ended=(await ref.get()).data();
  assert.equal(ended.gameState.phase,'showdown');
  assert.equal(ended.gameState.rabbit.length,5);
  assert.deepEqual(result.tableUpdate.gameState.rabbit,ended.gameState.rabbit);
  assert.ok(players.every(uid=>ended.players[uid].cards.length===0));
  assert.ok(ended.history.at(-1).ps.every(p=>p.c===null));
  const balances=players.map(uid=>ended.players[uid].stack);
  const membership=db.doc('memberships/'+actor+'_'+clubId);
  await membership.update({status:'suspended'});
  await assert.rejects(engine.pkReveal.run(request(actor,{tableId})),err=>err.code==='permission-denied');
  assert.deepEqual((await ref.get()).data().players[actor].cards,[]);
  await membership.update({status:'approved'});
  await engine.pkReveal.run(request(actor,{tableId}));
  const published=(await ref.get()).data();
  assert.equal(published.players[actor].cards.length,2);
  assert.equal(published.players[players.find(uid=>uid!==actor)].cards.length,0);
  assert.deepEqual(players.map(uid=>published.players[uid].stack),balances);
});
