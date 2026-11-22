// Firebase remains the sole account/session authority. Never persist the ID token.
export function createNativeAuth({ platform, google, auth, persistence, credential, signInWithCredential, signOut }) {
  let busy = false;
  return {
    async signIn() {
      if (platform !== 'android') throw Object.assign(new Error('Use your player ID and personal code on this device.'), { code: 'native/unsupported' });
      if (busy) throw Object.assign(new Error('Sign-in is already open.'), { code: 'native/busy' });
      busy = true;
      try {
        await persistence;
        const result = await google.signIn();
        if (typeof result?.idToken !== 'string' || !result.idToken) throw new Error('Missing Google credential');
        // Firebase validates the Google credential and restores the existing UID.
        return await signInWithCredential(auth, credential(result.idToken));
      } finally {
        busy = false;
      }
    },
    async signOut() {
      await signOut(auth);
      if (platform === 'android') {
        // A provider cleanup failure must not undo a successful Firebase logout.
        try { await google.clearSession(); } catch { /* next sign-in uses explicit account selection */ }
      }
    }
  };
}

export function nativeAuthError(error, fallback) {
  const messages = {
    'native/unsupported': 'Use your player ID and personal code on this device.',
    'native/not-configured': 'Google sign-in is not configured in this build. Use your player ID and personal code.',
    'native/cancelled': 'Google sign-in was cancelled. You can try again.',
    'native/busy': 'Google sign-in is already open.',
    'native/unavailable': 'Google sign-in is unavailable. Try again or use your player ID and personal code.'
  };
  return messages[error?.code] || fallback(error);
}
