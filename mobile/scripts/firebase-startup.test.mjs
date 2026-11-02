import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

// Execute the actual browser SDK with an iPhone/Capacitor environment. External
// login scripts deliberately never load, as can happen in WKWebView. No real
// account or network request is used by this regression test.
export function nativeEnvironment() {
  const timers = new Set(), scripts = [], requests = [], listeners = new Map();
  const storage = () => {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
  };
  const context = {
    console, URL, TextEncoder, TextDecoder, Headers, Response, Request, Event,
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', onLine: true },
    location: new URL('capacitor://localhost/index.html'),
    localStorage: storage(), sessionStorage: storage(),
    webkit: { messageHandlers: { bridge: {} } },
    setTimeout(fn, ms, ...args) { const id = setTimeout(fn, ms, ...args); timers.add(id); return id; },
    clearTimeout(id) { clearTimeout(id); timers.delete(id); },
    setInterval(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval(id) { clearInterval(id); timers.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); },
    document: { readyState: 'complete',
      createElement: tagName => ({ tagName, style: {}, setAttribute() {} }),
      getElementsByTagName: () => [{ appendChild: script => scripts.push(script) }],
      body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    async fetch(url, options) {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ result: { available: true, reason: null } }), { status: 200 });
    }
  };
  context.window = context.self = context;
  return { context: vm.createContext(context), scripts, requests,
    close() { for (const timer of timers) { clearTimeout(timer); clearInterval(timer); } } };
}

test('native Firebase initialization reaches readiness without browser login scripts', async () => {
  const env = nativeEnvironment();
  try {
    const { nativeFirebaseSource } = await import('./build-web.mjs');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const source = nativeFirebaseSource(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
    const result = await build({ stdin: { contents: source, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, format: 'iife', platform: 'browser', target: 'es2020', write: false });
    vm.runInContext(result.outputFiles[0].text, env.context, { timeout: 2000 });
    const state = await Promise.race([
      env.context.fb.fx('pkSecurityStatus', {}),
      new Promise((_, reject) => env.context.setTimeout(() => reject(new Error('Firebase initialization stalled before readiness')), 1000))
    ]);
    assert.equal(state.available, true);
    assert.equal(env.scripts.length, 0, 'Native auth must not load the browser popup/redirect resolver');
    assert.equal(env.requests.length, 1);
    assert.equal(env.requests[0].url, 'https://us-central1-pokerten.cloudfunctions.net/pkSecurityStatus');
    assert.equal(env.context.fb.auth._getPersistence(), 'LOCAL');
    await assert.rejects(env.context.fb.signIn(), error => error.code === 'native/unsupported');
  } finally { env.close(); }
});
