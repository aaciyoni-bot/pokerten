/* PokerTen - Service Worker
   Network first: fetch the latest release from the server.
   The cache is only an offline fallback so deployments appear immediately. */
const CACHE = 'pokerten-shell-v340';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('pokerten-shell-') && k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
        const windows=await self.clients.matchAll({type:'window'});
        for(const client of windows)client.postMessage({type:'POKERTEN_RELEASE',version:340});
    })());
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // Release/theme checks must report a network failure instead of claiming
    // that an offline cached configuration is the newest deployed version.
    if (url.origin === self.location.origin && /\/assets\/(release\.json|sounds\/theme\.json)$/.test(url.pathname)) {
        e.respondWith(fetch(new Request(req, {cache:'no-store'})));
        return;
    }
    // Firebase and Google requests pass through directly.
    if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebaseapp.com') || url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs')) return;
    // Page/document loads must always come fresh from the network (never the HTTP cache),
    // so a new deploy shows up immediately instead of a stale cached shell.
    const isDoc = req.mode === 'navigate' || req.destination === 'document';
    e.respondWith((async () => {
        try {
            const res = await fetch(isDoc ? new Request(req, { cache: 'no-store' }) : req);
            if (res && res.ok && (url.origin === self.location.origin || res.type === 'basic' || res.type === 'cors')) {
                try { const c = await caches.open(CACHE); c.put(req, res.clone()); } catch (err) {}
            }
            return res;
        } catch (err) {
            const cached = await caches.match(req, { ignoreSearch: url.origin === self.location.origin });
            if (cached) return cached;
            throw err;
        }
    })());
});

