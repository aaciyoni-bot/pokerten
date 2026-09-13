"use strict";
// Incident containment is server-owned. Never read this gate from a browser,
// player profile, table settings, or any document players previously controlled.
const POKER_SECURITY_PAUSED = false;
function requirePokerAvailable() {
  if (POKER_SECURITY_PAUSED) {
    const {HttpsError} = require("firebase-functions/v2/https");
    throw new HttpsError("unavailable", "Poker is temporarily paused for a security review. No cash-out was performed.");
  }
}
module.exports = {POKER_SECURITY_PAUSED, requirePokerAvailable};
