import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBeta } from './testflight-release.mjs';

function fixture({ processing = ['VALID'], encryption = false, deniedStage, testerCount = 1, wrongApp = false } = {}) {
  const calls = []; let poll = 0;
  const api = async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (method !== 'GET' && path.includes(deniedStage || '!')) throw Object.assign(new Error('Denied'), { status: 403 });
    if (path === '/v1/apps/6828543924') return { data: { id: '6828543924', attributes: { bundleId: wrongApp ? 'wrong.app' : 'com.pokerten.app' } } };
    if (path.includes('/appStoreVersions')) return { data: [{ attributes: { platform: 'IOS', versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' } }] };
    if (path.startsWith('/v1/builds?')) return { data: [{ id: 'new-build', attributes: { processingState: processing[Math.min(poll++, processing.length - 1)], usesNonExemptEncryption: encryption }, relationships: { preReleaseVersion: { data: { id: 'release' } } } }], included: [{ type: 'preReleaseVersions', id: 'release', attributes: { version: '1.0', platform: 'IOS' } }] };
    if (path.endsWith('/buildBetaDetail')) return { data: { id: 'detail', attributes: { externalBuildState: 'READY_FOR_BETA_SUBMISSION', internalBuildState: 'READY_FOR_BETA_TESTING' } } };
    if (path.endsWith('/betaBuildLocalizations')) return { data: [] };
    if (path.endsWith('/relationships/individualTesters') && method === 'GET') return { data: path.includes('7ad88159') ? Array.from({ length: testerCount }, (_, n) => ({ type: 'betaTesters', id: `existing-${n}` })) : [] };
    if (path.startsWith('/v1/betaAppReviewSubmissions?')) return { data: [] };
    if (path === '/v1/betaAppReviewSubmissions' && method === 'POST') return { data: { attributes: { betaReviewState: 'WAITING_FOR_REVIEW' } } };
    if (method !== 'GET') return {};
    throw new Error('Unexpected request: ' + path);
  };
  return { api, calls, run: () => prepareBeta({ api, buildNumber: '4', wait: async () => {}, log: () => {}, attempts: 2 }) };
}

test('waits for processed, exempt build before assigning only its existing tester and requesting beta review', async () => {
  const f = fixture({ processing: ['PROCESSING', 'VALID'] });
  const report = await f.run();
  assert.equal(report.processingState, 'VALID');
  assert.equal(report.usesNonExemptEncryption, false);
  assert.equal(report.betaReviewState, 'WAITING_FOR_REVIEW');
  assert.equal(report.appStore[0].state, 'PREPARE_FOR_SUBMISSION');
  const writes = f.calls.filter(c => c.method !== 'GET');
  assert.equal(writes.length, 4);
  assert.deepEqual(writes[1].body.data, [{ type: 'betaTesters', id: 'existing-0' }]);
  assert.equal(writes[3].body.data.relationships.build.data.id, 'new-build');
  assert.ok(writes.every(c => !c.path.includes('appStoreVersion') && !c.path.includes('betaGroups')));
});

test('Apple permission failure is reported without retrying or changing access', async () => {
  const f = fixture({ deniedStage: 'betaBuildLocalizations' });
  const report = await f.run();
  assert.match(report.remaining, /test notes blocked by Apple API HTTP 403/);
  assert.equal(f.calls.filter(c => c.method !== 'GET').length, 1);
});

test('unfinished processing never changes test metadata or submits a review', async () => {
  const f = fixture({ processing: ['PROCESSING'] });
  const report = await f.run();
  assert.equal(report.processingState, 'PROCESSING');
  assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0);
});

test('unexpected encryption or app identity prevents release changes', async () => {
  for (const options of [{ encryption: true }, { wrongApp: true }]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0);
  }
});

test('changed source audience does not invite additional testers', async () => {
  const f = fixture({ testerCount: 2 });
  const report = await f.run();
  assert.match(report.remaining, /existing tester assignment requires manual review/);
  assert.equal(f.calls.filter(c => c.method !== 'GET').length, 1);
});
