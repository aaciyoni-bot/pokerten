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

/* ---------------- Server clock ----------------
   Every callable answers with serverNow. NTP-style: serverNow was stamped
   about half a round-trip before we read it, so offset = sn - now + rtt/2,
   and we keep the measurement with the lowest rtt (least network noise)
   rather than smoothing good samples together with bad ones. */
/* stamped with the deploy commit by the build step */
const AV_BUILD = "dev";

let clockOffset = 0, coBestRtt = Infinity, coAt = 0;
function noteServerNow(sn, rtt){
  if (!sn) return;
  const now = Date.now();
  if (now - coAt > 90000) coBestRtt = Infinity;   // stale — let a fresh sample win
  if (rtt == null) rtt = 800;
  if (coAt && rtt > coBestRtt * 1.4) return;      // noisier than what we have
  coBestRtt = Math.min(coBestRtt, rtt);
  /* sn is stamped when the reply leaves the server; add back half the
     round-trip so the display sits on the server's clock in real time,
     not a full downlink-leg behind it. Payment is exact-WYSIWYG on the
     server now, so a small lead is harmless — you're paid the number you
     saw regardless. Cap the correction so a cold-start outlier can't
     fling the clock far ahead. */
  clockOffset = sn - now + Math.min(rtt / 2, 300);
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
  mult: 1,
  queued: 0,
  lastTickSec: -1, lastWholeMult: 1,
};
function multAt(ms){ return Math.exp(GROWTH_K * ms / 1000); }
function timeForMult(m){ return Math.log(m) / GROWTH_K * 1000; }
