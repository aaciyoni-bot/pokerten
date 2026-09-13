"use strict";
const {test,before,after}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {doc,setDoc,updateDoc,getDoc,deleteDoc,writeBatch,getDocs,query,collection,where}=require("firebase/firestore");
let env;
before(async()=>{
 env=await initializeTestEnvironment({projectId:"demo-pokerten-security",firestore:{rules:fs.readFileSync(require.resolve("../../firestore.rules"),"utf8")}});
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [path,value] of Object.entries({
   "clubs/club":{ownerUid:"owner",guardRevert:true},
   "users/player":{role:"player",username:"Player",email:"player@example.com",balance:100},
   "memberships/player_club":{uid:"player",clubId:"club",balance:100,role:"player",status:"approved",stats:{totalProfit:0}},
   "memberships/other_club":{uid:"other",clubId:"club",balance:200,role:"player"},
   "tables/table":{clubId:"club",settings:{serverEngine:false},players:{player:{uid:"player",stack:100}},gameState:{deck:["secret"]}},
   "tables/table/priv/player":{cards:["A"]},"tables/table/priv/other":{cards:["K"]},
   "tables/protected":{authorityVersion:2,type:"poker",clubId:"club",settings:{serverEngine:true},players:{player:{stack:100,cards:[],cardCount:2}},gameState:{board:[]}},
   "tables/protected/priv/_engine":{deck:["secret"]},"tables/protected/priv/other":{cards:["secret"]},
   "memberships/player_other_club":{uid:"player_other",clubId:"club",balance:50},
   "tournaments/tour":{clubId:"club",prizePool:100,players:{player:{rank:2}}},
   "gameLog/log":{clubId:"club",uid:"player",profit:0},
   "securityAlerts/incident":{clubId:"club",uid:"player",delta:10000}
  }))await setDoc(doc(db,path),value);
 });
});
after(async()=>{if(env)await env.cleanup();});
const player=()=>env.authenticatedContext("player",{email:"player@example.com",email_verified:true}).firestore();
test("direct +10,000 credit, forged receipts, other-wallet writes and deletion are denied",async()=>{
 const db=player();
 for(const patch of [{balance:10100},{balance:10100,lastRefundAt:Date.now(),stats:{totalProfit:10000}},{balance:10100,bonusOpen:0,clubProfits:10000},{balance:0}])await assertFails(updateDoc(doc(db,"memberships/player_club"),patch));
 await assertFails(updateDoc(doc(db,"memberships/other_club"),{balance:10200}));
 await assertFails(deleteDoc(doc(db,"memberships/player_club")));
 await assertFails(setDoc(doc(db,"memberships/player_new"),{uid:"player",clubId:"new",balance:10000}));
 assert.equal((await getDoc(doc(db,"memberships/player_club"))).data().balance,100);
});
test("profile, club ownership and guard-setting privilege escalation are denied",async()=>{
 const db=player();
 for(const patch of [{role:"super_admin"},{email:"aaci.yoni@gmail.com"},{balance:10000},{managedGames:["poker"]}])await assertFails(updateDoc(doc(db,"users/player"),patch));
 await assertFails(updateDoc(doc(db,"clubs/club"),{ownerUid:"player",guardRevert:false}));
 await assertFails(updateDoc(doc(db,"memberships/player_club"),{role:"club_owner",status:"approved"}));
 await assertSucceeds(updateDoc(doc(db,"users/player"),{username:"New name",lastSeen:Date.now()}));
});
test("stack minting, forged cashout batches and fabricated tournament prizes are denied",async()=>{
 const db=player();
 await assertFails(updateDoc(doc(db,"tables/table"),{"players.player.stack":10000}));
 await assertFails(setDoc(doc(db,"tables/new"),{players:{player:{stack:10000}}}));
 const batch=writeBatch(db);batch.update(doc(db,"tables/table"),{"players.player.stack":0});batch.update(doc(db,"memberships/player_club"),{balance:10100,lastRefundAt:Date.now()});await assertFails(batch.commit());
 await assertFails(updateDoc(doc(db,"tournaments/tour"),{prizePool:10000,"players.player.rank":1}));
 await assertFails(setDoc(doc(db,"gameLog/fake"),{uid:"player",clubId:"club",profit:10000}));
 await assertFails(deleteDoc(doc(db,"gameLog/log")));
});
test("anonymous, forged claims and unverified admin email cannot write balances",async()=>{
 const contexts=[env.unauthenticatedContext(),env.authenticatedContext("anon"),env.authenticatedContext("player",{role:"super_admin",god:true}),env.authenticatedContext("player",{email:"aaci.yoni@gmail.com",email_verified:false}),env.authenticatedContext("owner",{email:"owner@example.com",email_verified:true})];
 for(const ctx of contexts)await assertFails(updateDoc(doc(ctx.firestore(),"memberships/player_club"),{balance:10000}));
});
test("verified designated administrator can reconcile wallets, not restart legacy game writes",async()=>{
 const db=env.authenticatedContext("verified-admin",{email:"aaci.yoni@gmail.com",email_verified:true}).firestore();
 await assertSucceeds(updateDoc(doc(db,"memberships/other_club"),{balance:201}));
 await assertFails(updateDoc(doc(db,"tables/table"),{"players.player.stack":10000}));
});
test("hidden legacy decks and opponent private cards are inaccessible to players",async()=>{
 const db=player();await assertFails(getDoc(doc(db,"tables/table")));await assertFails(getDoc(doc(db,"tables/table/priv/other")));await assertFails(getDoc(doc(db,"tables/table/priv/_engine")));await assertSucceeds(getDoc(doc(db,"tables/table/priv/player")));
});
test("trusted backend remains capable of atomic ledger writes",async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore(),batch=writeBatch(db);batch.update(doc(db,"memberships/player_club"),{balance:100});batch.set(doc(db,"gameLog/server-receipt"),{uid:"player",clubId:"club",profit:0});await batch.commit();});
});

test("incident evidence cannot be erased by a player or a legacy club owner",async()=>{
 for(const uid of ["player","owner"])await assertFails(deleteDoc(doc(env.authenticatedContext(uid).firestore(),"securityAlerts/incident")));
});
test('approved members can query protected tables of their club without gaining any write or private-card access',async()=>{
 const db=player();await assertSucceeds(getDoc(doc(db,'tables/protected')));
 await assertSucceeds(getDocs(query(collection(db,'tables'),where('authorityVersion','==',2),where('clubId','==','club'))));
 await assertFails(getDocs(collection(db,'tables')));
 for(const ctx of [env.unauthenticatedContext(),env.authenticatedContext('stranger')])await assertFails(getDoc(doc(ctx.firestore(),'tables/protected')));
 for(const patch of [{'players.player.stack':10000},{authorityVersion:1},{'settings.serverEngine':false},{'players.player.reveal':true}])await assertFails(updateDoc(doc(db,'tables/protected'),patch));
 await assertFails(getDoc(doc(db,'tables/protected/priv/_engine')));await assertFails(getDoc(doc(db,'tables/protected/priv/other')));
});
test('membership existence check cannot disclose another user with a matching uid prefix',async()=>{
 await assertSucceeds(getDoc(doc(player(),'memberships/player_missing')));
 await assertFails(getDoc(doc(player(),'memberships/player_other_club')));
});
test('other application rule blocks remain byte-for-byte unchanged by poker recovery',()=>{
 const hash=s=>require('node:crypto').createHash('sha256').update(s).digest('hex'),current=fs.readFileSync(require.resolve('../../firestore.rules'),'utf8');
 const aviator=current.slice(current.indexOf('    // ═══ AVIATORIZIS'),current.indexOf('    match /clubs/{id}'));
 const others=current.slice(current.indexOf('    // ═══ Gadud'));
 assert.equal(hash(aviator),'fe9832de8a7a9250f5d8af316d494b8200d9bcf0512b9a2761a2ad0a92f07674');
 assert.equal(hash(others),'ea381621c7e0c4bb6ad951684253172322decd04eedbe0bc23f0c3cc06fe74ac');
});
