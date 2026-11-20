(function (global) {
  'use strict';
  // A short-lived UI grant is never a substitute for the callable's server
  // authorization. Keep it in memory only and discard it across auth/lifecycle
  // boundaries; delayed replies must not resurrect a previous viewer.
  function create({fb, document, events, onChange = () => {}, now = Date.now,
    schedule = setTimeout, cancel = clearTimeout}) {
    let stopped = false, generation = 0, refreshTimer, expiryTimer, deadlineTimer;
    const notify = () => {
      onChange();
      if (events?.dispatchEvent && events.Event) events.dispatchEvent(new events.Event('pokerten-access-changed'));
    };
    const clear = (pending = false) => {
      generation++;
      cancel(refreshTimer); cancel(expiryTimer); cancel(deadlineTimer);
      fb.viewerGrant = null;
      fb.viewerAccessPending = pending;
      notify();
    };
    const identityKey = user => JSON.stringify([user?.uid, user?.email, user?.emailVerified === true]);
    const refresh = async (reset = true) => {
      if (stopped) return;
      if (reset) clear(true);
      cancel(refreshTimer);
      const identity = fb.auth?.currentUser;
      if (document.hidden) return;
      if (!identity?.uid || !identity.emailVerified) { clear(); return; }
      const uid = identity.uid, email = identity.email, key = identityKey(identity), token = generation, startedAt = now();
      let timedOut = false;
      const current = () => !stopped && !timedOut && generation === token && !document.hidden && identityKey(fb.auth?.currentUser) === key;
      const failed = retry => {
        if (!current()) return;
        clear();
        if (retry) refreshTimer = schedule(() => refresh(), 5000);
      };
      deadlineTimer = schedule(() => { failed(true); timedOut = true; }, 10000);
      try {
        const grant = await fb.fx('godLobbyCounts', {mode: 'access'});
        if (!current()) return;
        cancel(deadlineTimer);
        if (grant?.uid !== uid || grant.god !== true) { clear(); return; }
        // Start the lease when the request began, not when a slow reply arrived.
        fb.viewerGrant = {uid, email, god: true, oversight: grant.oversight === true,
          generation: token, expiresAt: startedAt + 30000};
        fb.viewerAccessPending = false;
        cancel(expiryTimer);
        expiryTimer = schedule(() => { clear(); refresh(); }, Math.max(0, startedAt + 30000 - now()));
        notify();
        refreshTimer = schedule(() => refresh(false), 20000);
      } catch (error) {
        failed(!/unauthenticated|permission-denied/.test(error?.code || ''));
      }
    };
    const visibility = () => { if (document.hidden) clear(true); else refresh(); };
    const pagehide = () => clear(true);
    const revoke = () => clear();
    document.addEventListener('visibilitychange', visibility);
    events.addEventListener('pageshow', visibility);
    events.addEventListener('pagehide', pagehide);
    events.addEventListener('online', visibility);
    events.addEventListener('pokerten-access-denied', revoke);
    return {refresh, clear, stop() {
      stopped = true; clear();
      document.removeEventListener('visibilitychange', visibility);
      events.removeEventListener('pageshow', visibility);
      events.removeEventListener('pagehide', pagehide);
      events.removeEventListener('online', visibility);
      events.removeEventListener('pokerten-access-denied', revoke);
    }};
  }
  if (typeof module === 'object' && module.exports) module.exports = {create};
  else global.PokerViewerAccess = {create};
})(typeof window === 'object' ? window : globalThis);
