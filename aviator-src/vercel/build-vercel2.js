/* Build the Vercel payload: index.html (LIVE multiplayer), solo.html
   (bots version), manifest.json, sw.js — assets pinned to a commit sha. */
const fs = require('fs');
const SRC = '/home/user/pokerten';
const SHA = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(SHA || '')) { console.error('usage: node build-vercel2.js <sha>'); process.exit(1); }
const RAW = `https://raw.githubusercontent.com/aaciyoni-bot/pokerten/${SHA}/`;

function transform(file){
  let out = fs.readFileSync(SRC + '/' + file, 'utf8');
  out = out.replace('href="aviator-manifest.json"', 'href="manifest.json"');
  out = out.replaceAll('href="aviator-icon-192.png"', 'href="/icon-192.png"');
  out = out.replace('"aviator-sw.js"', '"sw.js"');
  out = out.replace('[hidden]{display:none!important}', '[hidden]{display:none!important}\n#backBtn{display:none}');
  out = out.replaceAll('"assets/sounds/', `"${RAW}assets/sounds/`);
  out = out.replaceAll('"assets/avatars/"', `"${RAW}assets/avatars/"`);
  out = out.replace('fetch("assets/world-110m.json")', `fetch("${RAW}assets/world-110m.json")`);
  return out;
}

const OUT = __dirname + '/vdeploy';
fs.mkdirSync(OUT, { recursive: true });
const live = transform('aviator-live.html')
  .replace('<title>AVIATORIZIS</title>',
  '<title>AVIATORIZIS</title>\n<meta name="description" content="AVIATORIZIS LIVE — one shared round, real players, play-money chips.">');
const solo = transform('aviator.html');
fs.writeFileSync(OUT + '/index.html', live);
fs.writeFileSync(OUT + '/solo.html', solo);
fs.writeFileSync(OUT + '/manifest.json', JSON.stringify({
  name: 'AVIATORIZIS', short_name: 'AVIATORIZIS',
  description: 'Fly high, cash out in time. Play-money crash game by ORIZIS.',
  start_url: '/', display: 'standalone',
  background_color: '#07090F', theme_color: '#07090F',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
fs.writeFileSync(OUT + '/vercel.json', JSON.stringify({
  rewrites: [
    { source: '/__/auth/:path*', destination: 'https://pokerten.firebaseapp.com/__/auth/:path*' },
    { source: '/__/firebase/:path*', destination: 'https://pokerten.firebaseapp.com/__/firebase/:path*' },
    { source: '/solo', destination: '/solo.html' },
    { source: '/icon-192.png', destination: `${RAW}aviator-icon-192.png` },
    { source: '/icon-512.png', destination: `${RAW}aviator-icon-512.png` },
    { source: '/maskable-512.png', destination: `${RAW}aviator-maskable-512.png` },
  ],
}, null, 2));
fs.writeFileSync(OUT + '/sw.js', `const CACHE = "aviatorizis-v2";
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
`);
console.log('live bytes:', live.length, '| solo bytes:', solo.length,
  '| leftover local refs:', ((live + solo).match(/"assets\//g) || []).length);
