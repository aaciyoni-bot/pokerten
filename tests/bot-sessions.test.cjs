'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {session,rotationGap}=require('../functions/botSessions');
test('bot sessions target half an hour with varied expiry and staggered table replacements',()=>{
 const now=1700000000000,ends=new Set();
 for(let i=0;i<100;i++){
  const uid='session-bot-'+i,s=session(uid,now),minutes=(s.botLeavesAt-now)/60000;
  assert.equal(s.botJoinedAt,now);assert.ok(minutes>=25&&minutes<=35);ends.add(s.botLeavesAt);
  assert.ok(rotationGap(uid)>=60000&&rotationGap(uid)<=120000);
  assert.deepEqual(session(uid,now),s,'legacy seats get a stable expiry instead of a new session on each tick');
 }
 assert.ok(ends.size>5,'bots should not all leave at the same time');
});
