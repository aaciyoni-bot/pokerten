export function canUpdate(context, view, hasResume) {
  const c = context || {};
  if (view !== 'lobby' || !c.uid || !c.clubId || hasResume || !c.ready) return false;
  if ((c.tables || []).some(t => t.players?.[c.uid])) return false;
  return !(c.tournaments || []).some(t => t.players?.[c.uid] && !['done', 'cancelled'].includes(t.status));
}
export function validRelease(r, current) {
  if (!r || r.runtime !== current.runtime || !/^\d+\.\d+\.\d+$/.test(r.version || '') ||
      !/^[a-f0-9]{64}$/.test(r.checksum || '') || !Number.isSafeInteger(r.size) || r.size <= 0 || r.size > 50000000) return false;
  const compare = (a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); return x[0]-y[0] || x[1]-y[1] || x[2]-y[2]; };
  if (compare(r.version,current.version) <= 0) return false;
  const url = new URL(r.url);
  return url.origin === 'https://pokerten.com' && url.pathname.startsWith('/mobile-updates/') &&
    url.pathname.endsWith('.zip') && !url.username && !url.password && !url.search && !url.hash;
}
// One automatic attempt per cold start. A slow/failed download never interrupts a later hand.
export function createAutoUpdater({ ota, store, fetchRelease, current, render, hasResume = () => false,
  delay = (fn, ms) => setTimeout(fn, ms), cancel = clearTimeout }) {
  let context, view = 'auth', attempted = false, cancelled = false, running = false, generation = 0;
  const safe = () => canUpdate(context, view, hasResume());
  function sync() {
    store.setSafeContext({safe:safe()}).catch(() => {});
    if (running && !safe()) { cancelled = true; render(null); }
    if (safe() && !attempted) void run();
  }
  async function run(manual = false) {
    if (!safe() || running || (attempted && !manual)) return;
    attempted = true; running = true; cancelled = false;
    const runId = ++generation;
    let timer;
    const live = () => runId === generation && !cancelled && safe();
    try {
      // Release metadata is bounded too; continue the game on poor connectivity.
      render({text:'Checking for updates…'});
      const timeout = new Promise(resolve => { timer = delay(() => { cancelled = true; render(null); resolve(null); }, 15000); });
      const update = (async () => {
        const release = await fetchRelease();
        if (!live() || !validRelease(release, current) || release.version === current.version) return false;
        const saved = await ota.list();
        if (!live()) return false;
        if (saved.bundles.some(b => b.version === release.version && b.status === 'error')) return false;
        render({text:'Updating POKERTEN…', size:release.size});
        let bundle = saved.bundles.find(b => b.version === release.version && b.checksum === release.checksum && ['pending','success'].includes(b.status));
        if (!bundle) bundle = await ota.download({url:release.url, version:release.version, checksum:release.checksum});
        if (!live()) return false;
        // Never use next(): that can apply when the app backgrounds during a hand.
        render({text:'Starting POKERTEN…'});
        await ota.set({id:bundle.id});
        return true;
      })();
      const applied = await Promise.race([update.catch(() => false), timeout]);
      if (applied || !live()) return;
      // Native-shell upgrades use Google's own consent screen, with no extra app buttons.
      const info = await Promise.race([store.check().catch(() => null), timeout]);
      if (live() && info?.status === 'available') {
        render(null);
        await store.setSafeContext({safe:true});
        if (live()) await store.startUpdate();
      }
    } catch (_) {
      // Offline / unavailable store: keep the known-good bundled game usable.
    } finally { cancel(timer); running = false; render(null); }
  }
  return {
    setView(next) { view = next; sync(); },
    setGameContext(next) { context = next; sync(); },
    check(manual = false) { return run(manual); },
    progress(percent) { if (running && !cancelled && safe()) render({text:'Updating POKERTEN…', percent}); }
  };
}
