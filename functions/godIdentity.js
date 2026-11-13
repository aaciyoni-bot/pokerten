'use strict';

const accessSecret = 'POKERTEN_GOD_ACCOUNTS';

function isGodAuth(auth) {
  if (!auth?.uid || auth.token?.email_verified !== true || typeof auth.token.email !== 'string') return false;
  const email = auth.token.email.trim().toLowerCase();
  if (!email) return false;
  try {
    const accounts = JSON.parse(process.env[accessSecret] || '[]');
    return Array.isArray(accounts) && accounts.every(value => typeof value === 'string' && value.length > 0) && accounts.includes(email);
  } catch {
    return false;
  }
}

module.exports = {accessSecret, isGodAuth};
