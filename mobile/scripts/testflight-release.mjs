import { sign } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const APP_ID = '6828543924';
const BUNDLE_ID = 'com.pokerten.app';
const VERSION = '1.0';
const query = (path, params) => path + '?' + new URLSearchParams(params);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function appleClient(env = process.env, fetchImpl = fetch) {
  return async (path, method = 'GET', body) => {
    if (!path.startsWith('/v1/')) throw new Error('Invalid Apple API path');
    const now = Math.floor(Date.now() / 1000);
    const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const input = encode({ alg: 'ES256', kid: env.APP_STORE_CONNECT_KEY_ID, typ: 'JWT' }) + '.' +
      encode({ iss: env.APP_STORE_CONNECT_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
    const signature = sign('sha256', Buffer.from(input), {
      key: env.APP_STORE_CONNECT_API_KEY, dsaEncoding: 'ieee-p1363'
    }).toString('base64url');
    const response = await fetchImpl('https://api.appstoreconnect.apple.com' + path, {
      method, headers: { Authorization: 'Bearer ' + input + '.' + signature, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      // Do not print Apple's response body: it may contain tester or review data.
      throw Object.assign(new Error('Apple API request failed'), { status: response.status });
    }
    return response.status === 204 ? {} : response.json();
  };
}

export async function prepareBeta({ api, buildNumber, wait = sleep, log = console.log, attempts = 31 }) {
  const app = (await api(`/v1/apps/${APP_ID}`)).data;
  if (app?.id !== APP_ID || app.attributes?.bundleId !== BUNDLE_ID) throw new Error('App identity mismatch');
  const report = { app: 'POKERTEN', version: VERSION, buildNumber: String(buildNumber) };
  try {
    const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=20`);
    report.appStore = versions.data.filter(v => v.attributes.platform === 'IOS').map(v => ({
      version: v.attributes.versionString, state: v.attributes.appStoreState
    }));
  } catch (error) {
    // Store metadata access is separate from build access; still verify the upload.
    report.appStoreStatusUnavailable = error.status ? `HTTP ${error.status}` : 'Unable to read store status';
  }
  let build;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const builds = await api(query('/v1/builds', { 'filter[app]': APP_ID, 'filter[version]': String(buildNumber), include: 'preReleaseVersion', limit: '20' }));
    const releaseIds = new Set((builds.included || []).filter(v => v.type === 'preReleaseVersions' && v.attributes.version === VERSION && v.attributes.platform === 'IOS').map(v => v.id));
    const matches = builds.data.filter(b => releaseIds.has(b.relationships.preReleaseVersion.data.id));
    if (matches.length > 1) throw new Error('Ambiguous build identity');
    build = matches[0];
    report.processingState = build?.attributes.processingState || 'NOT_VISIBLE_YET';
    log('Apple processing: ' + report.processingState);
    if (['INVALID', 'FAILED'].includes(report.processingState)) throw new Error('Apple processing failed');
    if (report.processingState === 'VALID') break;
    if (attempt + 1 < attempts) await wait(20000);
  }
  if (report.processingState !== 'VALID') return { ...report, remaining: 'Apple is still processing the upload' };
  report.buildId = build.id;
  report.usesNonExemptEncryption = build.attributes.usesNonExemptEncryption;
  if (report.usesNonExemptEncryption !== false) throw new Error('Approved encryption declaration was not applied');

  const detail = (await api(`/v1/builds/${build.id}/buildBetaDetail`)).data;
  report.externalBuildState = detail.attributes.externalBuildState;
  let stage = 'test notes';
  try {
    const localizations = await api(`/v1/builds/${build.id}/betaBuildLocalizations`);
    const notes = `Background music can now be switched on or off from the lobby/account and table menus without muting game effects. The preference is saved between launches. Tournament lobby cards now show registered players, entry costs and starting stacks, with remaining players and registration status during play. Managers can also see a participant breakdown. This build includes the current settlement screen and cashier scrolling fix.\n\nUpdate to build ${buildNumber}, open the club menu, switch MUSIC OFF, and confirm that game effects still play. Reopen the app and confirm that music stays off. Switch MUSIC ON to restore lobby music. Sign in using your Player ID and personal PIN; native Google sign-in is not available on iPhone.\n\nIf anything fails, report the iPhone model, iOS version and message shown. Do not include passwords or personal PINs.`;
    const existing = localizations.data.find(item => item.attributes.locale === 'en-US');
    if (existing) {
      await api(`/v1/betaBuildLocalizations/${existing.id}`, 'PATCH', { data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew: notes } } });
    } else {
      await api('/v1/betaBuildLocalizations', 'POST', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: notes }, relationships: { build: { data: { type: 'builds', id: build.id } } } } });
    }
    stage = 'existing tester assignment';
    // Reuse the single tester already authorized and installed on build 2.
    // Never create a tester, invite another address, or enable a public link.
    const source = await api('/v1/builds/7ad88159-d9dc-41ee-952b-7f0a992a597e/relationships/individualTesters');
    if (source.data.length !== 1 || source.links?.next) throw new Error('Existing beta audience changed; manual review required');
    const target = await api(`/v1/builds/${build.id}/relationships/individualTesters`);
    if (!target.data.some(t => t.id === source.data[0].id)) {
      await api(`/v1/builds/${build.id}/relationships/individualTesters`, 'POST', { data: source.data.map(({ id, type }) => ({ id, type })) });
    }
    report.assignedExistingTesters = 1;
    stage = 'automatic beta notification';
    await api(`/v1/buildBetaDetails/${detail.id}`, 'PATCH', { data: { type: 'buildBetaDetails', id: detail.id, attributes: { autoNotifyEnabled: true } } });
    stage = 'beta review submission';
    const reviews = await api(query('/v1/betaAppReviewSubmissions', { 'filter[build]': build.id }));
    if (!reviews.data.length && detail.attributes.externalBuildState === 'READY_FOR_BETA_SUBMISSION') {
      const review = await api('/v1/betaAppReviewSubmissions', 'POST', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } });
      report.betaReviewState = review.data.attributes.betaReviewState;
    } else {
      report.betaReviewState = reviews.data[0]?.attributes.betaReviewState || 'NOT_REQUIRED_OR_NOT_READY';
    }
  } catch (error) {
    report.remaining = stage + (error.status ? ` blocked by Apple API HTTP ${error.status}` : ' requires manual review');
    // Permission failures never trigger another credential, role change or retry.
  }
  const final = (await api(`/v1/builds/${build.id}/buildBetaDetail`)).data;
  report.externalBuildState = final.attributes.externalBuildState;
  report.internalBuildState = final.attributes.internalBuildState;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.BUILD_NUMBER) throw new Error('Missing build number');
    const report = await prepareBeta({ api: appleClient(), buildNumber: process.env.BUILD_NUMBER });
    console.log('POKERTEN_APPLE_STATUS ' + JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, '\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n');
  } catch (error) {
    console.error('Apple release verification failed' + (error.status ? ` (HTTP ${error.status})` : ''));
    process.exitCode = 1;
  }
}
