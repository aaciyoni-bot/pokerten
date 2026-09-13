'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {grantSelfSigning, repair} = require('../scripts/repair-pin-signing.cjs');
test('self signing preserves conditional grants and concurrency etag, and is idempotent', () => {
  const email = 'runtime@pokerten.iam.gserviceaccount.com';
  const policy = {version:3, etag:'original', bindings:[{role:'roles/iam.serviceAccountTokenCreator',members:['user:other@example.com'],condition:{expression:'true',title:'existing'}},{role:'roles/viewer',members:['group:staff@example.com']}]};
  const next = grantSelfSigning(policy, email);
  assert.deepEqual(next.bindings.slice(0, 2), policy.bindings);
  assert.equal(next.etag, 'original');
  assert.equal(next.version, 3);
  assert.equal(next.bindings[2].members[0], 'serviceAccount:' + email);
  assert.equal(policy.bindings.length, 2);
  assert.equal(grantSelfSigning(next, email), null);
});
test('refuses an account belonging to another project before any policy write', async () => {
  let writes = 0;
  await assert.rejects(repair(async (url) => {
    if (url.includes('cloudfunctions.googleapis.com')) return {serviceConfig:{serviceAccountEmail:'runtime@other.iam.gserviceaccount.com'}};
    if (url.includes(':setIamPolicy')) writes++;
    return {projectId:'other',email:'runtime@other.iam.gserviceaccount.com'};
  }), /project validation/);
  assert.equal(writes, 0);
});
