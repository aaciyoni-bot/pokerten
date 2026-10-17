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
  assert.match(transformed, /!window\.__POKERTEN_NATIVE__ && 'serviceWorker'/);
  await buildWeb();
  const html = await readFile(new URL('../www/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.match(html, /src="vendor\/firebase.js"/);
  const files = await readdir(new URL('../www/', import.meta.url));
  assert.deepEqual(files.sort(), ['assets', 'index.html', 'manifest.json', 'privacy.html', 'vendor']);
  assert.equal(await readFile(new URL('../../index.html', import.meta.url), 'utf8'), source);
});
