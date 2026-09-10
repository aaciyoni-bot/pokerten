'use strict';
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {getFirestore} = require('firebase-admin/firestore');
const {getAuth} = require('firebase-admin/auth');

const WINDOW = 15 * 60 * 1000;
const options = {maxInstances: 5, concurrency: 4, memory: '512MiB', timeoutSeconds: 30};
const badLogin = () => new HttpsError('unauthenticated', 'מספר הכניסה או הקוד שגויים.');
const validatePin = pin => {
  if (typeof pin !== 'string' || !/^\d{8,12}$/.test(pin)) throw new HttpsError('invalid-argument', 'הקוד צריך להכיל 8–12 ספרות.');
  return pin;
};
async function hashPin(pin, salt) {
  return (await scrypt(pin, salt, 32, {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024})).toString('hex');
}
async function matches(pin, credential) {
  const hash = await hashPin(pin, credential.salt);
  const stored = Buffer.from(credential.hash, 'hex');
  return stored.length === 32 && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), stored);
}
// The failure counter is committed BEFORE authentication fails. Throwing from
// inside a Firestore transaction would roll it back and disable the limit.
async function consume(db, key, maximum, now = Date.now()) {
  const ref = db.doc('_pkPinLimits/' + crypto.createHash('sha256').update(key).digest('hex'));
  const allowed = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const old = snap.exists ? snap.data() : {};
    const fresh = !old.until || old.until <= now;
    const count = fresh ? 0 : Number(old.count) || 0;
    if (count >= maximum) return false;
    tx.set(ref, {count: count + 1, until: fresh ? now + WINDOW : old.until});
    return true;
  });
  if (!allowed) throw new HttpsError('resource-exhausted', 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות.');
}
function currentUid(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'צריך להתחבר לחשבון קודם.');
  return request.auth.uid;
}
// Report a bounded operational reason without exposing provider messages,
// service-account details or credentials through the public health endpoint.
function signingFailureReason(error) {
  const message = String(error?.message || '');
  if (/SERVICE_DISABLED|has not been used|API.{0,100}(disabled|not enabled)/i.test(message)) return 'signing-api-disabled';
  if (/signBlob|iam\.serviceAccounts|PERMISSION_DENIED|permission.*denied/i.test(message) || error?.code === 'auth/insufficient-permission') return 'signing-permission';
  if (/determine service account|invalid credential|metadata/i.test(message)) return 'signing-configuration';
  return 'signing-unavailable';
}
// Provider-independent identity. The reverse claim and the UID mapping are
// written atomically; neither a phone number nor a client-supplied ID is used.
async function ensurePlayerId(db, uid, profile = null, randomId = () => 'P' + crypto.randomInt(100000000, 1000000000)) {
  const ref = db.doc('_pkPlayerAccounts/' + uid);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = randomId();
    const result = await db.runTransaction(async tx => {
      const mapped = await tx.get(ref);
      const playerId = mapped.exists ? mapped.data().playerId : candidate;
      const claimRef = db.doc('_pkPlayerIds/' + playerId);
      const claim = await tx.get(claimRef);
      const userRef = db.doc('users/' + uid);
      const user = await tx.get(userRef);
      if (claim.exists && claim.data().uid !== uid) {
        if (mapped.exists) throw new HttpsError('failed-precondition', 'לא ניתן לאמת את קוד השחקן.');
        return null;
      }
      tx.set(ref, {playerId});
      tx.set(claimRef, {uid});
      if (user.exists) tx.update(userRef, {
        playerId,
        ...(user.data().playerId && user.data().playerId !== playerId && !user.data().legacyPlayerId ? {legacyPlayerId: user.data().playerId} : {})
      });
      else if (profile) tx.create(userRef, {...profile, playerId});
      return playerId;
    });
    if (result) return result;
  }
  throw new HttpsError('unavailable', 'לא ניתן ליצור קוד שחקן כרגע. נסה שוב.');
}
async function enroll(db, uid, pin, requireEmpty = false, profile = null) {
  const playerId = await ensurePlayerId(db, uid, profile);
  const accountRef = db.doc('_pkPinAccounts/' + uid);
  const salt = crypto.randomBytes(24).toString('hex');
  const hash = await hashPin(pin, salt);
  for (let tries = 0; tries < 5; tries++) {
    const candidate = playerId;
    const result = await db.runTransaction(async tx => {
      const account = await tx.get(accountRef);
      if (requireEmpty && account.exists) throw new HttpsError('already-exists', 'כבר הוגדר קוד לחשבון.');
      const loginId = account.exists ? account.data().loginId : candidate;
      const credentialRef = db.doc('_pkPinCredentials/' + loginId);
      const credential = await tx.get(credentialRef);
      if (!account.exists && credential.exists) return null;
      if (account.exists && (!credential.exists || credential.data().uid !== uid)) throw new HttpsError('failed-precondition', 'לא ניתן לעדכן את הקוד. יש לפנות לתמיכה.');
      tx.set(accountRef, {loginId});
      tx.set(credentialRef, {uid, salt, hash, changedAt: Date.now()});
      return loginId;
    });
    if (result) return result;
  }
  throw new HttpsError('unavailable', 'נסה שוב.');
}

exports.pkPinStatus = onCall(options, async request => {
  try {
    // A health check verifies the actual signing permission. The probe token
    // is discarded and never returned; it creates no Firebase user.
    await getAuth().createCustomToken('pk-readiness-probe');
  } catch (error) {
    const reason = signingFailureReason(error);
    console.warn('Personal-code signing unavailable', {reason});
    return {available: false, reason};
  }
  if (!request.auth?.uid) return {available: true};
  const db = getFirestore();
  const playerId = await ensurePlayerId(db, request.auth.uid);
  const snapshot = await db.doc('_pkPinAccounts/' + request.auth.uid).get();
  return {available: true, playerId, loginId: snapshot.exists ? snapshot.data().loginId : null};
});

exports.pkEnsurePlayer = onCall(options, async request => {
  const uid = currentUid(request);
  const user = await getAuth().getUser(uid);
  const email = (user.email || '').toLowerCase();
  const superAdmin = email === 'aaci.yoni@gmail.com' && user.emailVerified;
  const db = getFirestore();
  const playerId = await ensurePlayerId(db, uid, {
    username: user.displayName || 'Player', email,
    googleName: user.displayName || '', photo: user.photoURL || '',
    role: superAdmin ? 'super_admin' : 'player', status: superAdmin ? 'approved' : 'pending',
    balance: 0, clubProfits: 0, isBot: false, isGuest: false,
    phone: user.phoneNumber || '', phoneVerified: !!user.phoneNumber, createdAt: Date.now()
  });
  // Memberships are keyed by UID; only their displayed player code is updated.
  const memberships = await db.collection('memberships').where('uid', '==', uid).get();
  const changes = memberships.docs.filter(d => d.data().playerId !== playerId);
  for (let i = 0; i < changes.length; i += 400) {
    const batch = db.batch();
    changes.slice(i, i + 400).forEach(d => batch.update(d.ref, {playerId}));
    await batch.commit();
  }
  return {playerId};
});

exports.pkPinEnroll = onCall(options, async request => {
  const uid = currentUid(request);
  const pin = validatePin(request.data?.pin);
  if (request.auth.token?.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('failed-precondition', 'יש להיכנס קודם עם Google או עם אמצעי הכניסה הקיים.');
  const age = Date.now() / 1000 - Number(request.auth.token?.auth_time || 0);
  if (age > 600 || age < 0) throw new HttpsError('failed-precondition', 'כדי להגדיר קוד, צא והיכנס שוב לחשבון ואז חזור לכאן.');
  const db = getFirestore();
  await consume(db, 'enroll:' + uid, 5);
  // Check signing availability before storing a new login method.
  await getAuth().createCustomToken(uid);
  return {loginId: await enroll(db, uid, pin)};
});

exports.pkPinRegister = onCall(options, async request => {
  if (request.auth) throw new HttpsError('failed-precondition', 'יש להגדיר קוד בפרופיל של החשבון הקיים.');
  const pin = validatePin(request.data?.pin);
  const name = String(request.data?.name || '').trim();
  if (name.length < 2 || name.length > 20) throw new HttpsError('invalid-argument', 'השם צריך להכיל 2–20 תווים.');
  const db = getFirestore(), auth = getAuth();
  await consume(db, 'register-ip:' + (request.rawRequest?.ip || 'unknown'), 3);
  const uid = 'pk_' + crypto.randomBytes(16).toString('hex');
  // Fail before creating an account if the deployment cannot sign tokens.
  const token = await auth.createCustomToken(uid);
  await auth.createUser({uid, displayName: name});
  // A new ID never claims a phone number or an existing player's balances.
  const loginId = await enroll(db, uid, pin, true, {
    username: name, email: '', role: 'player', status: 'pending',
    balance: 0, clubProfits: 0, isBot: false, isGuest: false,
    phone: '', phoneVerified: false, createdAt: Date.now()
  });
  return {token, loginId};
});

exports.pkPinLogin = onCall(options, async request => {
  const pin = validatePin(request.data?.pin);
  const loginId = String(request.data?.loginId || '').trim().toUpperCase();
  if (!/^P\d{9}$/.test(loginId)) throw badLogin();
  const db = getFirestore();
  await consume(db, 'login-ip:' + (request.rawRequest?.ip || 'unknown'), 30);
  await consume(db, 'login-account:' + loginId, 6);
  const ref = db.doc('_pkPinCredentials/' + loginId);
  const snap = await ref.get();
  // Keep the hash cost on both missing and existing IDs.
  const credential = snap.exists ? snap.data() : {salt: 'missing-account-salt', hash: '0'.repeat(64)};
  if (!await matches(pin, credential) || !snap.exists) throw badLogin();
  const latest = await ref.get();
  if (!latest.exists || latest.data().hash !== credential.hash) throw badLogin();
  const user = await getAuth().getUser(credential.uid);
  if (user.disabled) throw badLogin();
  return {token: await getAuth().createCustomToken(credential.uid), loginId};
});

// Only helpers are exported through a non-enumerable property for isolated tests.
Object.defineProperty(exports, '_test', {value: {consume, hashPin, matches, validatePin, enroll, ensurePlayerId}});
