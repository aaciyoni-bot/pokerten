'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),config=require('../firebase.synga.json');
assert.equal(config.functions.length,1);assert.equal(config.functions[0].codebase,'synga');
assert.equal(config.functions[0].source,'.synga-functions');
assert.deepEqual(config.firestore,[{database:'synga',rules:'firestore.synga.rules'}]);
assert.equal(config.hosting,undefined);assert.equal(config.auth,undefined);
const entries=Object.entries(require('../.synga-functions').synga).filter(([,fn])=>fn.__endpoint);
assert.ok(entries.length>25,'Game, clubs, account and accounting callables are present');
for(const [name,fn] of entries){
  assert.ok(!name.startsWith('av'),'Unrelated game must not be deployed');
  const trigger=fn.__endpoint.eventTrigger;
  if(trigger)assert.equal(trigger.eventFilters.database,'synga','Firestore event must target named database');
}
for(const name of ['pkEnsurePlayer','pkClubCreate','pkJoinClub','pkSeat','pkDeal','pkAct','pkCardGame','pkTournament','godPeek'])assert.ok(entries.some(([n])=>n===name),name);
for(const file of fs.readdirSync(path.join(root,'.synga-functions')).filter(p=>p.endsWith('.js'))){
  const source=fs.readFileSync(path.join(root,'.synga-functions',file),'utf8');
  assert.ok(!/getFirestore\(\)|\.firestore\(|deleteUser\(|updateUser\(|setCustomUserClaims\(/.test(source),file);
}
console.log('SYNGA isolation verified: '+entries.length+' prefixed endpoints; named database only; no default deployment or existing Auth mutations.');
