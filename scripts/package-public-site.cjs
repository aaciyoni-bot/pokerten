'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.public-site');
const runtime = require('./mobile-update-source.json').runtime;
const updateDir = path.join(root, 'mobile-updates', runtime);
const manifest = JSON.parse(fs.readFileSync(path.join(updateDir, 'latest.json')));
const url = new URL(manifest.url);
if (manifest.runtime !== runtime || url.origin !== 'https://pokerten.com' ||
    !url.pathname.startsWith('/mobile-updates/' + runtime + '/') ||
    url.search || url.hash || !url.pathname.endsWith('.zip')) {
  throw new Error('Invalid update manifest destination');
}
const zip = fs.readFileSync(path.join(updateDir, path.basename(url.pathname)));
if (zip.length !== manifest.size || crypto.createHash('sha256').update(zip).digest('hex') !== manifest.checksum) {
  throw new Error('Android update checksum or size mismatch');
}

// Mirror Firebase's public-file exclusions. Never package the native checkout,
// build dependencies, CI configuration, backend, tests, or deployment scripts.
const ignored = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'))).hosting.ignore;
function matches(pattern, file) {
  const escaped = pattern.split('**').map(part => part.split('*').map(s =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp('^' + escaped + '$').test(file);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
let count = 0;
for (const file of files) {
  if (file.split('/').some(part => part.startsWith('.')) || ignored.some(pattern => matches(pattern, file))) continue;
  const source = path.join(root, file);
  if (!fs.lstatSync(source).isFile()) throw new Error('Public file is not a regular file: ' + file);
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  count++;
}
fs.cpSync(path.join(root, 'mobile-updates'), path.join(out, 'mobile-updates'), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
for (const file of ['index.html', 'assets/release.json', 'manifest.json', 'sw.js', 'CNAME']) {
  if (!fs.existsSync(path.join(out, file))) throw new Error('Missing public asset: ' + file);
}
console.log(JSON.stringify({ files: count, runtime, version: manifest.version, checksum: manifest.checksum }));
