/* Vercel build step for the orizis-aviator project (aviatorizis.com).
 *
 * Vercel does NOT build from a connected git repo — each production deploy
 * is a manual file upload whose only real logic lives here. This script
 * fetches the two game clients from a PINNED commit of aaciyoni-bot/pokerten
 * and rewrites their asset paths, then writes the deploy output to public/.
 *
 *   index.html  = the LIVE multiplayer client (built from aviator-src/live/)
 *   solo.html   = the bots-only client with GOD MODE (repo root aviator.html)
 *
 * To ship a new version: bump SHA to the commit you want live, then run the
 * deploy (see aviator-src/README.md). SHA is the single source of truth —
 * every asset URL, the icons and the version.json all derive from it.
 */
const fs = require('fs');
const SHA = 'REPLACE_WITH_COMMIT_SHA';
const V = SHA.slice(0, 7);
const RAW = `https://raw.githubusercontent.com/aaciyoni-bot/pokerten/${SHA}/`;

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.text();
}

/* same rewrites the old build-vercel2.js applied: same-origin manifest/sw/
   icons, and absolute raw URLs for the sound/avatar/world assets */
function transform(out) {
  out = out.replace('href="aviator-manifest.json"', 'href="manifest.json"');
  out = out.replaceAll('href="aviator-icon-192.png"', 'href="/icon-192.png"');
  out = out.replace('"aviator-sw.js"', '"sw.js"');
  out = out.replace('[hidden]{display:none!important}',
    '[hidden]{display:none!important}\n#backBtn{display:none}');
  out = out.replaceAll('"assets/sounds/', `"${RAW}assets/sounds/`);
  out = out.replaceAll('"assets/avatars/"', `"${RAW}assets/avatars/"`);
  out = out.replace('fetch("assets/world-110m.json")', `fetch("${RAW}assets/world-110m.json")`);
  out = out.replaceAll('aviator-src/live/assets/', 'cockpit/');
  return out;
}

(async () => {
  let live = transform(await get(RAW + 'aviator-live.html'));
  live = live.replace('<title>AVIATORIZIS</title>',
    '<title>AVIATORIZIS</title>\n<meta name="description" content="AVIATORIZIS LIVE — one shared round, real players, play-money chips.">');
  live = live.replace('const AV_BUILD = "dev"', `const AV_BUILD = "${V}"`);
  // guardrails: fail the build rather than ship a client missing a fix
  if (!live.includes(`const AV_BUILD = "${V}"`)) throw new Error('build tag not stamped');
  if (!live.includes('signInAnonymously')) throw new Error('guest auth missing');
  if (!live.includes('supPill')) throw new Error('supervisor mode missing');
  if (live.includes('"assets/')) throw new Error('untransformed local asset path left behind');

  const solo = transform(await get(RAW + 'aviator.html'));
  if (!solo.includes('GOD_HASH')) throw new Error('god gate missing from solo');

  fs.mkdirSync('public', { recursive: true });
  fs.mkdirSync('public/cockpit', { recursive: true });
  for (const file of ['cockpit.webp', 'flight-jet.webp']) {
    const response = await fetch(RAW + 'aviator-src/live/assets/' + file);
    if (!response.ok) throw new Error('Missing cockpit asset: ' + file + ' -> ' + response.status);
    fs.writeFileSync('public/cockpit/' + file, Buffer.from(await response.arrayBuffer()));
  }
  fs.writeFileSync('public/index.html', live);
  fs.writeFileSync('public/solo.html', solo);
  fs.writeFileSync('public/version.json', JSON.stringify({ v: V }));
  fs.copyFileSync('manifest.json', 'public/manifest.json');
  fs.copyFileSync('sw.js', 'public/sw.js');
  console.log('built live:', live.length, 'solo:', solo.length, 'version:', V);
})().catch(e => { console.error(e); process.exit(1); });
