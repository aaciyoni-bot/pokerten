import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const mobile = fileURLToPath(new URL('../', import.meta.url));
const repo = path.resolve(mobile, '..');
const out = path.join(mobile, 'www');
const require = createRequire(import.meta.url);
export function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error(`Expected exactly one build marker: ${needle.slice(0, 90)}`);
  return source.replace(needle, replacement);
}
export function nativeHtml(source) {
  let html = replaceOnce(source, '<head>', '<head>\n<script>window.__POKERTEN_NATIVE__ = true;</script>');
  html = replaceOnce(html, "if ('serviceWorker' in navigator)", "if (!window.__POKERTEN_NATIVE__ && 'serviceWorker' in navigator)");
  html = replaceOnce(html, 'let pwaInstalledThisRuntime = false;', 'let pwaInstalledThisRuntime = true;');
  // Preserve player-code access while using Credential Manager for Android Google login.
  html = replaceOnce(html, 'setGErr(window.PokerAuthUI.errorText(e))', 'setGErr(window.nativeAuthError(e, window.PokerAuthUI.errorText))');
  html = replaceOnce(html, '[step, setStep] = useState(\'idle\')', '[step, setStep] = useState(\'code\')');
  // Keep the explanatory message visible while the code form is open.
  html = replaceOnce(html, "step==='idle'&&(gErr||error)", "(gErr||error)");
  html = replaceOnce(html, 'React.createElement(window.PokerAuthUI.CodeSettings, {user})',
    'React.createElement(window.PokerAuthUI.CodeSettings, {user}), React.createElement("a", {href:"account-deletion.html", style:{display:"block",padding:"14px 0",color:"#87d6ff",textDecoration:"underline"}}, "Request account deletion / בקשת מחיקת חשבון")');
  return html;
}
export async function buildWeb() {
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, 'vendor'), { recursive: true });
  // Explicit allowlist: never include Functions, credentials, tests or repo files.
  await cp(path.join(repo, 'assets'), path.join(out, 'assets'), { recursive: true });
  for (const name of ['privacy.html', 'manifest.json']) await cp(path.join(repo, name), path.join(out, name));
  await cp(path.join(mobile, 'account-deletion.html'), path.join(out, 'account-deletion.html'));
  let html = nativeHtml(await readFile(path.join(repo, 'index.html'), 'utf8'));
  const twMatch = html.match(/<script>\s*(tailwind\.config\s*=[\s\S]*?)<\/script>/);
  if (!twMatch) throw new Error('Tailwind configuration not found');
  const context = { tailwind: {} };
  vm.runInNewContext(twMatch[1], context, { timeout: 1000 });
  const config = JSON.parse(JSON.stringify(context.tailwind.config));
  config.content = [path.join(repo, 'index.html'), path.join(repo, 'assets/js/*.js')];
  config.safelist = [{ pattern: /^(bg|text|border|from|via|to|ring)-(slate|gray|gold|emerald|blue|sky|cyan|red|rose|amber|yellow|green|purple|indigo|pink|orange|teal)-(50|100|200|300|400|500|600|700|800|900|950)$/, variants: ['hover'] }];
  const css = await postcss([tailwindcss(config)]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;', { from: undefined });
  await writeFile(path.join(out, 'vendor/tailwind.css'), css.css);
  html = html.replace(twMatch[0], '');
  html = replaceOnce(html, '<script src="https://cdn.tailwindcss.com"></script>', '<link rel="stylesheet" href="vendor/tailwind.css">');
  const vendors = [
    ['https://unpkg.com/react@18/umd/react.production.min.js', 'react/umd/react.production.min.js', 'react.js'],
    ['https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js', 'react-dom.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js', 'tone/build/Tone.js', 'tone.js']
  ];
  for (const [url, source, target] of vendors) {
    await cp(path.join(mobile, 'node_modules', source), path.join(out, 'vendor', target));
    html = replaceOnce(html, url, 'vendor/' + target);
  }
  const fa = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
  for (const dir of ['css', 'webfonts']) await cp(path.join(fa, dir), path.join(out, 'vendor/fontawesome', dir), { recursive: true });
  html = replaceOnce(html, 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css', 'vendor/fontawesome/css/all.min.css');
  const firebaseMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!firebaseMatch?.[1].includes('initializeApp')) throw new Error('Firebase bootstrap not found');
  let firebaseSource = firebaseMatch[1].replace(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-(app|auth|firestore|functions)\.js/g, 'firebase/$1');
  firebaseSource = `import { Capacitor, registerPlugin } from '@capacitor/core';
import { signInWithCredential } from 'firebase/auth';
import { createNativeAuth, nativeAuthError } from './src/native-auth.mjs';\n` + firebaseSource;
  firebaseSource = replaceOnce(firebaseSource, "getRedirectResult(_auth).catch(() => {});", `const nativeAuth = createNativeAuth({
    platform: Capacitor.getPlatform(), google: registerPlugin('PokertenGoogleAuth'),
    auth: _auth, persistence: _persist,
    credential: token => GoogleAuthProvider.credential(token), signInWithCredential, signOut
  });
  window.fb.signIn = nativeAuth.signIn;
  window.fb.signOut = nativeAuth.signOut;
  window.nativeAuthError = nativeAuthError;`);
  if (firebaseSource.includes('https://www.gstatic.com/firebasejs')) throw new Error('Unmapped Firebase SDK version');
  await build({ stdin: { contents: firebaseSource, resolveDir: mobile, loader: 'js' }, bundle: true, format: 'esm', minify: true, target: ['es2020'], outfile: path.join(out, 'vendor/firebase.js') });
  html = html.replace(firebaseMatch[0], '<script type="module" src="vendor/firebase.js"></script>');
  await writeFile(path.join(out, 'index.html'), html);
  console.log('Bundled local POKERTEN client. Firebase services, fonts and generated avatars still require internet.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWeb();
