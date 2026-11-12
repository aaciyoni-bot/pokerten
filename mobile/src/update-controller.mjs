function updateBlocker(context, view, hasResume) {
  const c = context || {};
  if (view.endsWith('-table')) return 'Return to the club lobby after leaving the table to install.';
  if (view !== 'lobby' || !c.uid || !c.clubId) return 'Enter a club and stay in its lobby to install.';
  if (!c.ready) return 'Wait for the club to load, then check again.';
  if (hasResume || (c.tables || []).some(t => t.players?.[c.uid])) return 'Stand up from your table and return to the club lobby to install.';
  if ((c.tournaments || []).some(t => t.players?.[c.uid] && !['done','cancelled'].includes(t.status))) return 'Installation will be available after your registered tournament finishes.';
  return '';
}
export function canUpdate(context, view, hasResume) {
  return !updateBlocker(context, view, hasResume);
}
function releaseState(r, current) {
  if (!r || r.runtime !== current.runtime || !/^\d+\.\d+\.\d+$/.test(r.version || '') ||
      !/^[a-f0-9]{64}$/.test(r.checksum || '') || !Number.isSafeInteger(r.size) || r.size <= 0 || r.size > 50000000) return 'invalid';
  let url;
  try { url = new URL(r.url); } catch (_) { return 'invalid'; }
  if (url.origin !== 'https://pokerten.com' || !url.pathname.startsWith('/mobile-updates/') ||
      !url.pathname.endsWith('.zip') || url.username || url.password || url.search || url.hash) return 'invalid';
  const a = r.version.split('.').map(Number), b = current.version.split('.').map(Number);
  return (a[0]-b[0] || a[1]-b[1] || a[2]-b[2]) > 0 ? 'available' : 'current';
}
export function validRelease(r, current) { return releaseState(r, current) === 'available'; }
// One automatic attempt per cold start. A slow/failed download never interrupts a later hand.
export function createAutoUpdater({ ota, store, fetchRelease, current, render, hasResume = () => false,
  delay = (fn, ms) => setTimeout(fn, ms), cancel = clearTimeout }) {
  let context, view = 'auth', attempted = false, cancelled = false, running, generation = 0;
  const blocked = () => updateBlocker(context, view, hasResume());
  const safe = () => !blocked();
  const offline = 'Could not check for updates. Check your connection and try again.';
  const latest = 'Your game is up to date · v' + current.version.split('.')[1];
  function sync() {
    store.setSafeContext({safe:safe()}).catch(() => {});
    if (running && !safe()) { cancelled = true; render(null); }
    if (safe() && !attempted) void run();
  }
  async function inspect() {
    try {
      const release = await fetchRelease();
      const state = releaseState(release, current);
      if (state === 'invalid') return {message:'Could not verify the update. Try again.'};
      if (state === 'current') return {message:latest};
      return {release, message:'Game update v' + release.version.split('.')[1] + ' is available.'};
    } catch (_) { return {message:offline}; }
  }
  async function install(manual, id) {
    let timer;
    const live = () => id === generation && !cancelled && safe();
    const deferred = () => blocked() || 'Update paused. Check again in the club lobby.';
    try {
      render({text:'Checking for updates…'});
      const timeout = new Promise(resolve => { timer = delay(() => {
        cancelled = true; render(null); resolve('The update took too long. Tap Check update to retry.');
      }, manual ? 60000 : 15000); });
      const checkStore = async message => {
        const info = await store.check().catch(() => null);
        if (!live()) return deferred();
        if (info?.status === 'available') {
          render(null);
          await store.setSafeContext({safe:true});
          if (!live()) return deferred();
          const result = await store.startUpdate();
          return result?.accepted === false ? 'Google Play update cancelled.' : 'Google Play update started.';
        }
        return message;
      };
      const update = async () => {
        const {release, message} = await inspect();
        if (!live()) return deferred();
        if (release) {
          const saved = await ota.list();
          if (!live()) return deferred();
          if (saved.bundles.some(b => b.version === release.version && b.status === 'error')) {
            return checkStore('This game update previously failed. Check Google Play for an app update.');
          }
          render({text:'Updating POKERTEN…', size:release.size});
          let bundle = saved.bundles.find(b => b.version === release.version && b.checksum === release.checksum && ['pending','success'].includes(b.status));
          try {
            if (!bundle) bundle = await ota.download({url:release.url, version:release.version, checksum:release.checksum});
          } catch (_) {
            return live() ? checkStore('The game update could not download. Tap Check update to retry.') : deferred();
          }
          if (!live()) return deferred();
          render({text:'Starting POKERTEN…'});
          await ota.set({id:bundle.id});
          return 'Starting the updated game…';
        }
        return checkStore(message);
      };
      return await Promise.race([update(), timeout]);
    } catch (_) {
      return 'The update could not be installed. Tap Check update in the club lobby to retry.';
    } finally {
      cancel(timer); cancelled = true; render(null);
    }
  }
  function run(manual = false) {
    if (running) return running;
    if (!safe()) {
      if (!manual) return;
      // Checking availability is read-only even at the club picker or during a hand.
      return inspect().then(({release, message}) => release ? [message,blocked()].filter(Boolean).join(' ') : message);
    }
    if (attempted && !manual) return;
    attempted = true; cancelled = false;
    running = install(manual, ++generation).finally(() => {running = null;});
    return running;
  }
  return {
    setView(next) { view = next; sync(); },
    setGameContext(next) { context = next; sync(); },
    check(manual = false) { return run(manual); },
    progress(percent) { if (running && !cancelled && safe()) render({text:'Updating POKERTEN…', percent}); }
  };
}
