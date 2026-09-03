// Firestore rules, proved against the emulator: a training table (bots see the
// cards) can be created, or switched on, by the site owner's account only.
//
//   firebase emulators:start --only firestore --project demo-pokerten
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node rules.test.js
'use strict';
const fs = require('fs');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, setDoc, updateDoc, getDoc} = require('firebase/firestore');

let pass = 0, fail = 0;
const check = async (name, p, wantOk) => {
  try {
    await (wantOk ? assertSucceeds(p) : assertFails(p));
    console.log('PASS  ' + name); pass++;
  } catch (e) {
    console.log('FAIL  ' + name + '  ' + String(e.message || e).slice(0, 140)); fail++;
  }
};

(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-pokerten',
    firestore: {rules: fs.readFileSync(__dirname + '/firestore.rules', 'utf8'), host, port: Number(port)},
  });
  await env.clearFirestore();
  const owner = env.authenticatedContext('owner1', {email: 'aaci.yoni@gmail.com'}).firestore();
  const clubOwner = env.authenticatedContext('club1', {email: 'clubowner@example.com'}).firestore();
  const nobody = env.unauthenticatedContext().firestore();

  const base = (extra) => ({type: 'poker', clubId: 'main', createdAt: 1, status: '',
    settings: {baseGameType: 'NLH', blinds: 0.5, maxPlayers: 6, ...extra},
    players: {}, gameState: {phase: 'waiting'}, chat: [], history: []});

  // creating
  await check('owner creates a TRAINING table', setDoc(doc(owner, 'tables/t_owner'), base({botMode: 'oracle'})), true);
  await check('club owner creates a normal table', setDoc(doc(clubOwner, 'tables/t_club'), base({botMode: 'strong'})), true);
  await check('club owner creates a table with no botMode at all', setDoc(doc(clubOwner, 'tables/t_club2'), base({})), true);
  await check('club owner CANNOT create a training table', setDoc(doc(clubOwner, 'tables/t_club_oracle'), base({botMode: 'oracle'})), false);
  await check('signed-out CANNOT create anything', setDoc(doc(nobody, 'tables/t_nobody'), base({})), false);

  // switching an existing table
  await check('club owner CANNOT switch his own table to training (dotted update)',
    updateDoc(doc(clubOwner, 'tables/t_club'), {'settings.botMode': 'oracle'}), false);
  await check('club owner CANNOT switch it by rewriting the whole settings map',
    updateDoc(doc(clubOwner, 'tables/t_club'), {settings: {baseGameType: 'NLH', blinds: 0.5, maxPlayers: 6, botMode: 'oracle'}}), false);
  await check('club owner CANNOT switch it by replacing the document',
    setDoc(doc(clubOwner, 'tables/t_club'), base({botMode: 'oracle'})), false);
  await check('owner CAN switch a table to training',
    updateDoc(doc(owner, 'tables/t_club'), {'settings.botMode': 'oracle'}), true);

  // the game must keep moving on a training table for the people playing it
  await check('club owner CAN advance the game state on an existing training table',
    updateDoc(doc(clubOwner, 'tables/t_owner'), {'gameState.phase': 'preflop', 'players.club1': {uid: 'club1', stack: 100}}), true);
  await check('club owner CAN turn a training table back to normal',
    updateDoc(doc(clubOwner, 'tables/t_owner'), {'settings.botMode': 'strong'}), true);
  await check('...and then CANNOT turn it back on',
    updateDoc(doc(clubOwner, 'tables/t_owner'), {'settings.botMode': 'oracle'}), false);

  // reading
  await check('a signed-in player reads tables', getDoc(doc(clubOwner, 'tables/t_club')), true);
  await check('signed-out CANNOT read tables', getDoc(doc(nobody, 'tables/t_club')), false);

  // the rest of the rules still stand (spot checks that the file is not broken)
  await check('gameLog: player can append', setDoc(doc(clubOwner, 'gameLog/g1'), {clubId: 'main', uid: 'club1', delta: 1}), true);
  await check('gameLog: player cannot edit', updateDoc(doc(clubOwner, 'gameLog/g1'), {delta: 999}), false);
  await check('tables/{id}/priv: nobody writes hole cards from a client', setDoc(doc(owner, 'tables/t_owner/priv/owner1'), {cards: []}), false);

  console.log(`\n${pass} passed, ${fail} failed`);
  await env.cleanup();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
