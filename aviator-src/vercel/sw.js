/* Service worker: navigation-only, network-first. Always tries the network
 * so a fresh deploy lands immediately; falls back to cache when offline.
 * Never intercepts /__/ (Firebase auth handler is reverse-proxied there).
 * Bump CACHE on any change that must invalidate installed clients. */
const CACHE = "aviatorizis-v4";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;
  if (new URL(e.request.url).pathname.startsWith("/__/")) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
