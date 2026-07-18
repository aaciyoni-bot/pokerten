#!/usr/bin/env node
/*
 * deploy-precompile.js — build step for the live site.
 *
 * The dev source (index.html) keeps its JSX inside a <script type="text/babel">
 * block and loads @babel/standalone so it "just runs" when opened. That is great
 * for editing but slow for players: every page load downloads ~2.7 MB of Babel and
 * compiles ~7k lines of JSX in the browser before anything renders — the single
 * biggest hit to first paint, especially on phones.
 *
 * This script produces a deploy copy where that JSX is already compiled to plain
 * React.createElement calls, the babel block becomes a normal <script>, and the
 * @babel/standalone CDN tag is removed. Same single self-contained file, no
 * runtime compile.
 *
 *   node deploy-precompile.js <src.html> <out.html>
 */
const fs = require('fs');
const babel = require('@babel/standalone');

const [, , srcPath, outPath] = process.argv;
if (!srcPath || !outPath) {
  console.error('usage: node deploy-precompile.js <src.html> <out.html>');
  process.exit(1);
}

let html = fs.readFileSync(srcPath, 'utf8');

// 1) Compile the single text/babel block in place.
const re = /<script type="text\/babel">([\s\S]*?)<\/script>/;
const m = html.match(re);
if (!m) {
  console.error('no <script type="text/babel"> block found — nothing to precompile');
  process.exit(1);
}
const compiled = babel.transform(m[1], {
  // Classic runtime => React.createElement (React UMD is already loaded as a global).
  // The automatic runtime would emit `import ... from "react/jsx-runtime"`, which
  // a plain (non-module) <script> cannot use.
  presets: [['react', { runtime: 'classic' }]],
  compact: false,
  comments: false,
}).code;
html = html.replace(re, () => '<script>\n' + compiled + '\n</script>');

// 2) Drop the now-unused @babel/standalone CDN tag.
html = html.replace(/[ \t]*<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\n?/g, '');

fs.writeFileSync(outPath, html);
console.error('precompiled ' + srcPath + ' -> ' + outPath + ' (compiled JSX ' + m[1].length + ' -> ' + compiled.length + ' chars)');
