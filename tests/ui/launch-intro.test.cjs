'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const block = html.slice(html.indexOf('<div id="orizis-intro"'), html.indexOf('<!-- ═══ /ORIZIS INTRO ═══ -->'));
const script = block.match(/<script>([\s\S]*?)<\/script>/)[1];

async function check(mode) {
  const w = new JSDOM(block, {url:'https://pokerten.com', runScripts:'outside-only'}).window;
  const video = w.document.querySelector('video'), el = w.document.getElementById('orizis-intro');
  const timers = new Map();
  let plays = 0, pauses = 0, sequence = 0;
  w.matchMedia = () => ({matches:mode === 'reduced'});
  w.setTimeout = (fn, ms) => { timers.set(++sequence, {fn, ms}); return sequence; };
  w.clearTimeout = id => timers.delete(id);
  video.play = () => { plays++; return mode === 'blocked' ? Promise.reject(Error('blocked')) : Promise.resolve(); };
  video.pause = () => { pauses++; };
  w.localStorage.setItem('pkIntroSeen', '1');
  w.sessionStorage.setItem('pkIntroSeen', '1');
  if (mode === 'desktop') w.document.documentElement.classList.add('pt-desktop');
  w.eval(script);
  if (mode !== 'reduced') assert.equal(video.getAttribute('src'), mode === 'desktop' ? 'assets/video/pokerten-desktop-394.mp4' : 'assets/video/pokerten-orizis-intro.mp4');
  await Promise.resolve();
  assert.equal(el.classList.contains('oi-out'), false);
  assert.equal(plays, mode === 'reduced' ? 0 : 1);
  const fire = ms => [...timers.values()].find(entry => entry.ms === ms).fn();
  if (mode === 'normal' || mode === 'desktop') {
    assert.equal(video.muted, true);
    el.querySelector('[data-intro-sound]').click();
    assert.equal(video.muted, false);
    video.dispatchEvent(new w.Event('ended'));
  } else if (mode === 'skip') el.querySelector('[data-intro-skip]').click();
  else if (mode === 'escape') w.document.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape'}));
  else if (mode === 'timeout') fire(6500);
  else {
    if (mode === 'error') video.dispatchEvent(new w.Event('error'));
    assert.ok(el.querySelector('[data-intro-sound]').hidden);
    fire(700);
  }
  assert.equal(pauses, 1);
  fire(260);
  assert.equal(w.document.getElementById('orizis-intro'), null);
  w.close();
}
(async () => {
  for (const mode of ['normal','desktop','skip','escape','error','timeout','blocked','reduced']) await check(mode);
  console.log('PASS Classic launch for returning users, sound, skip, motion preference and video failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
