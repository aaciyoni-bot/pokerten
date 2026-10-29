import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { nativeHtml, replaceOnce, buildWeb } from './build-web.mjs';

test('native changes do not silently succeed when web structure changes', () => {
  assert.throws(() => replaceOnce('missing', 'marker', 'x'));
  assert.throws(() => replaceOnce('marker marker', 'marker', 'x'));
});
test('packaged app has local executable dependencies and excludes server files', async () => {
  // Correct source is repository root, two levels above mobile/scripts.
  const source = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const transformed = nativeHtml(source);
  assert.match(transformed, /pwaInstalledThisRuntime = true/);
  assert.match(transformed, /assets\/js\/native-update\.js/);
  assert.equal(transformed.includes('src="assets/js/app-update.js'), false);
  await buildWeb();
  const html = await readFile(new URL('../www/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.match(html, /src="vendor\/firebase.js"/);
  assert.match(html, /<meta name="app-version" content="343">/);
  const updater = await readFile(new URL('../www/assets/js/native-update.js', import.meta.url), 'utf8');
  assert.doesNotMatch(updater, /serviceWorker|fetch\(|location\.replace/);
  assert.match(updater, /play\.google\.com\/store\/apps\/details\?id=com\.orizis\.pokerten/);
  const files = await readdir(new URL('../www/', import.meta.url));
  assert.deepEqual(files.sort(), ['account-deletion.html', 'assets', 'index.html', 'manifest.json', 'privacy.html', 'vendor']);
  assert.match(html, /href:"account-deletion.html"/);
  const deletion = await readFile(new URL('../www/account-deletion.html', import.meta.url), 'utf8');
  assert.match(deletion, /mailto:office@orizisgroup.com/);
  assert.match(deletion, /Nothing is submitted until you send the email/);
  assert.equal(await readFile(new URL('../../index.html', import.meta.url), 'utf8'), source);
});
