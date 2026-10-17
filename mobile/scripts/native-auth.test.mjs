import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeAuth, nativeAuthError } from '../src/native-auth.mjs';

function setup(overrides = {}) {
  const events = [];
  const auth = { currentUser: null };
  const options = {
    platform: 'android', auth, persistence: Promise.resolve(),
    google: { signIn: async () => ({ idToken: 'test-token' }), clearSession: async () => events.push('clear') },
    credential: token => ({ token }),
    signInWithCredential: async (receivedAuth, credential) => {
      assert.equal(receivedAuth, auth);
      assert.deepEqual(credential, { token: 'test-token' });
      events.push('firebase');
      return { user: { uid: 'existing-user' } };
    },
    signOut: async receivedAuth => { assert.equal(receivedAuth, auth); events.push('logout'); },
    ...overrides
  };
  return { client: createNativeAuth(options), events };
}

test('Google sign-in waits for persistence and exchanges token with existing Firebase auth', async () => {
  let ready;
  const { client, events } = setup({ persistence: new Promise(resolve => { ready = resolve; }) });
  const result = client.signIn();
  await Promise.resolve();
  assert.deepEqual(events, []);
  await assert.rejects(client.signIn(), { code: 'native/busy' });
  ready();
  assert.equal((await result).user.uid, 'existing-user');
  assert.deepEqual(events, ['firebase']);
});

test('cancelled login does not authenticate and allows retry', async () => {
  let attempts = 0;
  const { client, events } = setup({ google: { signIn: async () => {
    if (++attempts === 1) throw Object.assign(new Error(), { code: 'native/cancelled' });
    return { idToken: 'test-token' };
  } } });
  await assert.rejects(client.signIn(), { code: 'native/cancelled' });
  assert.deepEqual(events, []);
  assert.equal((await client.signIn()).user.uid, 'existing-user');
});

test('missing credential cannot create a Firebase session', async () => {
  const { client, events } = setup({ google: { signIn: async () => ({}) } });
  await assert.rejects(client.signIn(), /Missing Google credential/);
  assert.deepEqual(events, []);
});

test('Firebase rejection propagates and unlocks retry', async () => {
  const { client } = setup({ signInWithCredential: async () => { throw new Error('Invalid credential'); } });
  await assert.rejects(client.signIn(), /Invalid credential/);
  await assert.rejects(client.signIn(), /Invalid credential/);
});

test('unsupported platforms never invoke Google or Firebase login', async () => {
  const { client, events } = setup({ platform: 'ios', google: { signIn: () => assert.fail('Must not run') } });
  await assert.rejects(client.signIn(), { code: 'native/unsupported' });
  assert.deepEqual(events, []);
});

test('logout clears provider session after Firebase logout', async () => {
  const { client, events } = setup();
  await client.signOut();
  assert.deepEqual(events, ['logout', 'clear']);
});

test('provider cleanup failure does not report a successful Firebase logout as failed', async () => {
  const { client, events } = setup({ google: { clearSession: async () => { throw new Error('Provider offline'); } } });
  await client.signOut();
  assert.deepEqual(events, ['logout']);
});

test('native error messages do not expose provider payloads', () => {
  assert.match(nativeAuthError({ code: 'native/not-configured', message: 'private' }, () => 'fallback'), /personal code/);
  assert.equal(nativeAuthError({ message: 'private' }, () => 'fallback'), 'fallback');
});
