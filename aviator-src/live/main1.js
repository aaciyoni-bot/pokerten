"use strict";
/* =====================================================================
   AVIATORIZIS LIVE — one shared server round for every player.
   The server (Cloud Functions) owns the money and the crash point;
   this client renders, bets and cashes out. Play-money chips only.
   ===================================================================== */

const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
const fmt = n => Math.round(n).toLocaleString("en-US");
const rand = (a,b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- Tunables (server is authoritative; growthK/waitMs
   arrive with the round state) ---------------- */
let GROWTH_K   = 0.132;
const MIN_BET  = 25;

/* ---------------- Local prefs ---------------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
let muted = store.get("pt_av_muted", false);
let history = [];

/* Server clock is for the countdown only. Flight values require a signed quote. */
const AV_BUILD = "dev";
let clockOffset = 0, coBestRtt = Infinity, coAt = 0;
function noteServerNow(sn, rtt, receivedAt){
  if (!Number.isFinite(sn) || !Number.isFinite(receivedAt)) return;
  const now = Date.now();
  const networkRtt = Math.max(0, rtt - Math.max(0, sn - receivedAt));
  if (now - coAt > 90000) coBestRtt = Infinity;
  if (coAt && networkRtt > coBestRtt * 1.4) return;
  coBestRtt = Math.min(coBestRtt, networkRtt);
  clockOffset = sn - now + networkRtt / 2;
  coAt = now;
}
const eNow = () => Date.now() + clockOffset;

/* live play: nobody — not even the admin — sees the crash in advance */
const godMode = false, adminUser = false;

/* avatar fallbacks come from the repo's asset pack */
const AV_BASE = "assets/avatars/";

/* ---------------- Shared round state (mirrors aviator/state) ---------- */
const S = {
  phase: "boot",             // boot | waiting | flying | crashed
  phaseAt: Date.now(),
  waitMs: 7000, crashHold: 3200,
  roundId: null,
  crashPoint: null,          // revealed only after the crash
  hash: "",
  mult: 1, cents: 100, protocol: 0,
  quote: null, quoteAt: 0, confirmedCents: 100,
  queued: 0,
  lastTickSec: -1, lastWholeMult: 1,
};
function multAt(ms){ return Math.exp(GROWTH_K * ms / 1000); }
function timeForMult(m){ return Math.log(m) / GROWTH_K * 1000; }
const toCents = m => Math.floor(Number(m) * 100 + 1e-8);
const chipPayout = (amount, cents) => Number(BigInt(amount) * BigInt(cents) / 100n);
const newRequestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
function quoteFresh(){
  return navigator.onLine !== false && document.visibilityState === "visible" &&
    S.quote && performance.now() - S.quoteAt < 1500;
}
function acceptQuote(q, ageMs = 0){
  if (!q || ageMs >= 1500 || S.phase !== "flying" || q.roundId !== S.roundId ||
      !Number.isSafeInteger(q.maxCents) || q.maxCents < S.confirmedCents ||
      !Number.isSafeInteger(q.issuedAt) || (S.quote && q.issuedAt <= S.quote.issuedAt)) return;
  const wasFresh = quoteFresh();
  S.quote = q; S.quoteAt = performance.now() - Math.max(0, ageMs); S.confirmedCents = q.maxCents;
  if (!wasFresh) updateAction();
}
function renderFlightValue(){
  // A confirmed price is already in the past. Easing it over animation frames
  // adds seconds of lag on a busy/throttled device and changes the click price.
  if (!quoteFresh()) return;
  S.cents = S.confirmedCents;
  S.mult = S.cents / 100;
}
