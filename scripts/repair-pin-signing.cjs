'use strict';
// Run only in the authorized deployment environment. Credentials stay in memory.
// Scope: runtime accounts of the four existing PIN functions, on themselves only.
const PROJECT = 'pokerten';
const REGION = 'us-central1';
const FUNCTIONS = ['pkPinStatus', 'pkPinEnroll', 'pkPinRegister', 'pkPinLogin'];
const ROLE = 'roles/iam.serviceAccountTokenCreator';

function grantSelfSigning(policy, email) {
  const next = structuredClone(policy);
  next.bindings ||= [];
  const member = 'serviceAccount:' + email;
  let binding = next.bindings.find(b => b.role === ROLE && !b.condition);
  if (binding?.members?.includes(member)) return null;
  if (!binding) { binding = {role: ROLE, members: []}; next.bindings.push(binding); }
  binding.members ||= [];
  binding.members.push(member);
  return next;
}

async function repair(api) {
  const accounts = new Set();
  for (const name of FUNCTIONS) {
    const fn = await api('https://cloudfunctions.googleapis.com/v2/projects/' + PROJECT + '/locations/' + REGION + '/functions/' + name);
    const email = fn.serviceConfig?.serviceAccountEmail;
    if (typeof email !== 'string' || !/^[a-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(email)) throw new Error('Missing validated runtime service account');
    accounts.add(email);
  }
  for (const email of accounts) {
    const url = 'https://iam.googleapis.com/v1/projects/' + PROJECT + '/serviceAccounts/' + encodeURIComponent(email);
    const account = await api(url);
    if (account.projectId !== PROJECT || account.email !== email || account.disabled) throw new Error('Runtime account project validation failed');
    let done = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const policy = await api(url + ':getIamPolicy?options.requestedPolicyVersion=3', 'POST');
      const next = grantSelfSigning(policy, email);
      if (!next) { done = true; break; }
      try {
        await api(url + ':setIamPolicy', 'POST', {policy: next});
        done = true;
        break;
      } catch (error) { if (error.status !== 409) throw error; }
    }
    if (!done) throw new Error('IAM policy changed concurrently; no policy was overwritten');
    console.log('Verified scoped runtime self-signing grant for ' + email);
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.FIREBASE_TOKEN) throw new Error('Run this repair through the authorized GitHub deployment workflow');
  const {getAccessToken} = require('firebase-tools/lib/auth');
  const token = await getAccessToken(process.env.FIREBASE_TOKEN, ['https://www.googleapis.com/auth/cloud-platform']);
  if (!token.access_token) throw new Error('Deployment authentication failed');
  const api = async (url, method = 'GET', body) => {
    const response = await fetch(url, {method, headers: {Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000)});
    if (!response.ok) { const error = new Error('Cloud permission repair request failed (HTTP ' + response.status + ')'); error.status = response.status; throw error; }
    return response.json();
  };
  await repair(api);
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch('https://us-central1-pokerten.cloudfunctions.net/pkPinStatus', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data:{}}), signal:AbortSignal.timeout(30000)});
    const body = await response.json();
    if (response.ok && body.result?.available === true) { console.log('Personal-code token signing verified; no user account was created.'); return; }
    if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('PIN signing readiness still unavailable after IAM propagation');
}
module.exports = {grantSelfSigning, repair};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
