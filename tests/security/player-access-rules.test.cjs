'use strict';

const { before, after, test } = require('node:test');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } = require('firebase/firestore');

let env;
before(async () => {
  const config = require('../../firebase.json');
  const { composeRules } = require('../../scripts/compile-poker-rules.cjs');
  const rules = fs.readFileSync(require.resolve('../../' + config.firestore.rules), 'utf8');
  assert.equal(rules, composeRules());
  env = await initializeTestEnvironment({ projectId: 'demo-pokerten-security', firestore: { rules } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['one', 'two']) {
      await setDoc(doc(db, 'memberships', uid + '_club'), { uid, clubId: 'club', status: 'approved' });
    }
    const event = { authorityVersion: 2, clubId: 'club', status: 'reg' };
    await setDoc(doc(db, 'tournaments', 'event'), event);
    await setDoc(doc(db, 'tournamentViews', 'event'), event);
  });
});
after(async () => { if (env) await env.cleanup(); });

test('members read the tournament view and cannot fetch or query the raw event', async () => {
  const browse = (db, path) => getDocs(query(collection(db, path), where('clubId', '==', 'club'), where('authorityVersion', '==', 2)));
  const player = env.authenticatedContext('one').firestore();
  await assertSucceeds(getDoc(doc(player, 'tournamentViews/event')));
  await assertSucceeds(browse(player, 'tournamentViews'));
  for (const context of [env.authenticatedContext('one'), env.authenticatedContext('other', {role:'manager',god:true}), env.unauthenticatedContext()]) {
    const db = context.firestore();
    await assertFails(getDoc(doc(db, 'tournaments/event')));
    await assertFails(browse(db, 'tournaments'));
  }
});

test('only approved members can manage their own notes within their club', async () => {
  const path = 'playerNotes/one/clubs/club/players/two';
  const player = env.authenticatedContext('one').firestore(), other = env.authenticatedContext('two').firestore();
  const note = { text: 'My note', color: 'blue' };
  await assertSucceeds(setDoc(doc(player, path), note));
  await assertSucceeds(getDoc(doc(player, path)));
  await assertFails(getDoc(doc(other, path)));
  await assertFails(setDoc(doc(other, path), note));
  await assertFails(setDoc(doc(player, path.replace('/club/', '/elsewhere/')), note));
  for (const value of [{...note, text:'x'.repeat(501)}, {...note, color:'unknown'}, {...note, role:'manager'}]) {
    await assertFails(setDoc(doc(player, path), value));
  }
  await assertSucceeds(deleteDoc(doc(player, path)));
});

test('wallet decisions and personal hand archives accept server writes only', async () => {
  const db = env.authenticatedContext('one').firestore();
  for (const path of ['clubs/club/walletRequests/req','clubs/club/pendingWalletRequests/one','clubs/club/playerArchives/one/hands/hand']) {
    await assertFails(setDoc(doc(db, path), {uid:'one', amount:500, status:'approved'}));
    await assertFails(getDoc(doc(db, path)));
  }
});

test('only current club members can read lobby projections and clients cannot write them',async()=>{
 const name='tableLobbyViews/lobby-view';
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),name),{authorityVersion:2,clubId:'club'}));
 const member=env.authenticatedContext('one').firestore();
 await assertSucceeds(getDoc(doc(member,name)));
 await assertFails(setDoc(doc(member,name),{clubId:'club',authorityVersion:2}));
 await assertFails(getDoc(doc(env.authenticatedContext('outsider').firestore(),name)));
});

test('camera media is inaccessible directly to club members and signed-out visitors',async()=>{
  const path='_pkTableClips/sample';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),{expires:Date.now()+60000}));
  for(const ctx of [env.authenticatedContext('one'),env.unauthenticatedContext()]){
    const db=ctx.firestore();
    await assertFails(getDoc(doc(db,path)));
    await assertFails(getDocs(collection(db,'_pkTableClips')));
    await assertFails(setDoc(doc(db,path),{video:'fixture'}));
  }
});
