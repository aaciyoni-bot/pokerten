/* =====================================================================
   LIVE STATE — identity, balance, my bet
   ===================================================================== */
/* `entered` comes from the sound engine section (no sound before TAKE OFF) */
let user = null, joined = false, isAdminUser = false;
let balance = 0, shownBalance = 0;
let myBet = null;           // my aviatorBets doc data for this round
let placing = false, cashing = false, pendingCash = null, queuedEdit = null, pendingPlace = null;
let announcedRound = "";
let cashoutRtt = null, tickRtt = null;
let autoOn = false;
const FX = (name, data) => {
  const t0 = Date.now();
  return window.avFB.fx(name, data || {}).then(r => {
    if (r && r.serverNow) noteServerNow(r.serverNow, Date.now() - t0, r.serverReceivedAt);
    return r;
  });
};

function myName(){
  const saved = store.get("avNick", "") ||
    (user && (user.displayName || user.phoneNumber)) || "";
  if (saved) return String(saved).slice(0, 24);
  /* stable per-device guest name so the round list isn't all "Pilot" */
  let h = 0;
  for (const c of String(user && user.uid || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return "Pilot " + (100 + h % 900);
}
/* live-only badge under the multiplier: "cashed out in time" */
$("#flightNums").insertAdjacentHTML("beforeend", '<div id="safeTag" dir="rtl"></div>');

/* =====================================================================
   SELF-UPDATE — the installed app quietly reloads itself between rounds
   when a newer build is live, so nobody plays on a stale client again.
   ===================================================================== */
document.body.insertAdjacentHTML("beforeend", `<div id="buildTag">${AV_BUILD}</div>`);
let newBuildLive = false;
async function checkBuild(){
  if (AV_BUILD === "dev") return;
  try{
    const r = await fetch("/version.json", {cache: "no-store"});
    const j = await r.json();
    newBuildLive = !!j.v && j.v !== AV_BUILD;
  }catch(e){}
}
setInterval(checkBuild, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkBuild();
});
checkBuild();

const FALLBACK_AVS = ["av-astronaut","av-tiger","av-shark","av-owl","av-gamer",
  "av-dragon","av-cat","av-whale","av-monkey","av-rabbit"];
function avatarFor(uid, photo){
  if (photo) return photo;
  let h = 0; for (const c of String(uid)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_BASE + FALLBACK_AVS[h % FALLBACK_AVS.length] + ".webp";
}

/* balance display: count-up + bump (server value only) */
function setBalance(v){
  balance = v;
  const el = $("#balanceNum");
  const from = shownBalance, to = v;
  shownBalance = v;
  if (REDUCED || Math.abs(to - from) < 1){ el.textContent = fmt(to); return; }
  const t0 = performance.now(), D = 550;
  (function tick(t){
    const p = clamp((t - t0) / D, 0, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
  $("#balance").classList.remove("bump"); void $("#balance").offsetWidth;
  $("#balance").classList.add("bump");
}
function celebrate(win, m){
  const toast = $("#winToast");
  toast.className = "";
  toast.textContent = `+${fmt(win)}  ·  ${m.toFixed(2)}x`;
  void toast.offsetWidth;
  toast.classList.add("on");
  confetti();
}
function toastErr(e){
  const msg = (e && e.message) ? String(e.message).replace(/^.*?:\s*/, "") : "שגיאה";
  const toast = $("#winToast");
  toast.className = "err";
  toast.textContent = msg;
  void toast.offsetWidth;
  toast.classList.add("on");
}

/* =====================================================================
   BETTING INPUT — bankroll-relative chips, editable placed bet
   ===================================================================== */
function betCredit(){ return (S.phase === "waiting" && myBet && !myBet.cashedAt && !myBet.lost) ? myBet.amount : 0; }
function betValue(){
  const v = parseInt($("#betInput").value.replace(/[^0-9]/g, ""), 10) || 0;
  return clamp(v, 0, Math.max(0, balance + betCredit()));
}
function niceAmount(v){
  if (v < 100) return Math.round(v);
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}
function betStep(){
  const spend = Math.max(balance + betCredit(), MIN_BET);
  return Math.max(25, 10 ** Math.max(0, Math.floor(Math.log10(spend)) - 2));
}
function setBetValue(v){ $("#betInput").value = fmt(clamp(Math.round(v), MIN_BET, Math.max(MIN_BET, balance + betCredit()))); fitBetFont(); }
function fitBetFont(){
  const el = $("#betInput");
  el.style.fontSize = "";
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth && size > 10){
    size -= 0.5;
    el.style.fontSize = size + "px";
  }
}
addEventListener("resize", fitBetFont);

/* edits to an already-placed bet re-price it on the server (debounced) */
let rebetTimer = 0;
function syncPlacedBet(){
  if (!betCredit()) return;
  const amt = betValue();
  clearTimeout(rebetTimer);
  rebetTimer = setTimeout(() => {
    if (S.phase === "waiting" && myBet && amt >= MIN_BET) doPlaceBet(amt, true);
  }, 120);
}

/* =====================================================================
   SERVER ACTIONS
   ===================================================================== */
async function sendAction(name, payload){
  try { return await FX(name, payload); }
  catch(e){
    if (!/(unavailable|deadline-exceeded|internal|network)/.test(String(e.code || e.message))) throw e;
    // Retry the identical request ID: a lost response must never debit or pay twice.
    return FX(name, payload);
  }
}
async function doPlaceBet(amount, silent, desiredAuto){
  if (!joined || S.phase !== "waiting" || S.protocol !== 2) return;
  const autoAt = desiredAuto ?? (autoOn ? (parseFloat($("#autoInput").value) || 0) : 0);
  if (placing){ queuedEdit = {amount, autoAt, roundId:S.roundId}; return; }
  const roundId = S.roundId;
  const operation = newRequestId(); pendingPlace = operation;
  placing = true; updateAction();
  try{
    const r = await sendAction("avBet", {roundId, requestId:operation, amount, autoAt});
    if (S.roundId === roundId && S.phase === "waiting") myBet = r.bet;
    if (!silent && S.roundId === roundId){ play("bet", 0.55); haptic(12); }
  }catch(e){ if (S.roundId === roundId) toastErr(e); }
  if (pendingPlace !== operation) return;
  pendingPlace = null; placing = false; updateAction();
  const next = queuedEdit; queuedEdit = null;
  if (next && next.roundId === S.roundId && S.phase === "waiting") doPlaceBet(next.amount, true, next.autoAt);
}
async function doCancelBet(){
  if (placing || !myBet || S.phase !== "waiting") return;
  clearTimeout(rebetTimer); queuedEdit = null;
  const roundId = S.roundId;
  const operation = newRequestId(); pendingPlace = operation;
  placing = true; updateAction();
  try{
    await sendAction("avCancelBet", {roundId, requestId:operation});
    if (S.roundId === roundId && S.phase === "waiting") myBet = null;
    if (S.roundId === roundId) play("ui", 0.3);
  }catch(e){ if (S.roundId === roundId) toastErr(e); }
  if (pendingPlace !== operation) return;
  pendingPlace = null; placing = false; updateAction();
}
function confirmCashout(r){
  if (r.roundId !== S.roundId || announcedRound === r.roundId) return;
  announcedRound = r.roundId;
  play(r.mult >= 5 ? "bigwin" : "win", 0.55, 0.02);
  haptic([15, 30, 15]); celebrate(r.win, r.mult);
  if (S.phase === "flying") $("#mult").classList.add("safe");
  const st = $("#safeTag");
  st.textContent = `✔ ${r.auto ? "משיכה אוטומטית אושרה" : "המשיכה אושרה"} · ${r.mult.toFixed(2)}x · +${fmt(r.win)}${cashoutRtt === null ? "" : ` · ${cashoutRtt}ms`}`;
  st.classList.add("on");
}
async function doCashout(){
  if (cashing || !joined || S.phase !== "flying" || !quoteFresh() ||
      !myBet || myBet.cashedAt || myBet.lost) return;
  const payload = {roundId:S.roundId, requestId:newRequestId(), seenCents:S.cents, quote:S.quote};
  const sentAt = performance.now();
  pendingCash = payload; cashing = true;
  // Dispatch before feedback/audio work; the price is captured once at input.
  const response = sendAction("avCashout", payload);
  updateAction(); haptic(8);
  try{
    const r = await response;
    if (r.roundId === payload.roundId && r.requestId === payload.requestId && S.roundId === payload.roundId){
      cashoutRtt = Math.round(performance.now() - sentAt);
      myBet = {...myBet, cashedAt:r.mult, win:r.win, auto:r.auto, lost:false};
      confirmCashout(r);
    }
  }catch(e){
    if (payload.roundId === S.roundId){ maybeTick(true); toastErr(e); }
  }finally{
    if (pendingCash === payload){ pendingCash = null; cashing = false; }
    updateAction();
  }
}

addEventListener("offline", () => { S.quote = null; updateSyncStatus(); });
addEventListener("online", () => { maybeTick(true); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") S.quote = null;
  else maybeTick(true);
});

/* One tick in flight at a time. Responses carry both state and signed price. */
let lastTickAt = 0, tickPending = false, lastSyncLabel = "";
function updateSyncStatus(){
  const offline = navigator.onLine === false;
  const stale = S.phase === "flying" && !quoteFresh();
  const label = S.protocol !== 2 ? "מסנכרן את גרסת המשחק…" :
    offline ? "אין חיבור — המכפיל מושהה" : stale ? "הנתונים מתעכבים — המכפיל מושהה" :
    (streamFresh() ? "עדכון חי רציף" : `מחובר לבקרת הטיסה${tickRtt === null ? "" : ` · ${tickRtt}ms`}`);
  if (label !== lastSyncLabel){
    lastSyncLabel = label; $("#syncStatus").textContent = label;
    $("#syncStatus").classList.toggle("stale", stale); updateAction();
  }
}
function maybeTick(force){
  const now = Date.now();
  if (!joined || tickPending || document.visibilityState !== "visible" || (!force && streamFresh())) return;
  if (!force && now - lastTickAt < (S.phase === "flying" ? 200 : 400)) return;
  lastTickAt = now; tickPending = true;
  const sentAt = performance.now();
  FX("avTick", {}).then(r => {
    if (r.state) applyState(r.state);
    tickRtt = Math.round(performance.now() - sentAt);
    acceptQuote(r.quote, tickRtt);
    paintConfirmedPrice();
  }).catch(() => {}).finally(() => { tickPending = false; updateSyncStatus(); });
}


/* =====================================================================
   RENDER — history, players (real bets), action button
   ===================================================================== */
function renderHistory(){
  $("#history").innerHTML = history.map(m => {
    const cls = m >= 2 ? "hi" : m >= 1.5 ? "mid" : "lo";
    return `<span class="pill ${cls}">${m.toFixed(2)}x</span>`;
  }).join("");
}
function pushHistory(m){
  history.unshift(Math.round(m * 100) / 100);
  history = history.slice(0, 24);
  renderHistory();
}

let roundBets = [];   // live aviatorBets docs for the current round
let lastPlayersRender = 0;   // throttle for mid-flight auto-cash re-renders
function renderPlayers(){
  const uid = user && user.uid;
  const rows = [...roundBets].sort((a, b) =>
    ((b.uid === uid) - (a.uid === uid)) ||
    ((!!b.cashedAt) - (!!a.cashedAt)) ||
    (a.lost - b.lost) || (b.amount - a.amount));
  $("#roundTotals").textContent = "";
  $("#players").innerHTML = rows.map(r => {
    const me = r.uid === uid;
    const eff = r.cashedAt;
    const cls = eff ? "cashed" : (r.lost ? "bust" : "");
    const st = eff ? eff.toFixed(2) + "x" : (r.lost ? "BUST" : "…");
    return `
    <div class="prow ${me ? "me" : ""} ${cls}">
      <img src="${esc(avatarFor(r.uid, r.photo))}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="nm">${esc(me ? "You" : r.name || "Pilot")}${r.bot ? ' <small>BOT</small>' : ""}</span>
      <span class="bt">${fmt(r.amount)}</span>
      <span class="st">${st}</span>
    </div>`;
  }).join("");
}

function updateAction(){
  updateFlightStatus();
  const btn = $("#actionBtn");
  btn.disabled = false;
  if (!joined){
    btn.className = "wait"; btn.innerHTML = "מתחבר…"; btn.disabled = true; return;
  }
  $("#autoSwitch").disabled = S.phase !== "waiting" && !!myBet;
  $("#autoInput").disabled = S.phase !== "waiting" && !!myBet;
  if (S.protocol !== 2){
    btn.className = "wait"; btn.textContent = "מסנכרן את גרסת המשחק…"; btn.disabled = true; return;
  }
  if (cashing && pendingCash && pendingCash.roundId === S.roundId){
    btn.className = "pending";
    btn.innerHTML = `<span>נשלחה משיכה · ${(pendingCash.seenCents / 100).toFixed(2)}x<br><span class="sub">ממתין לאישור</span></span>`;
    btn.disabled = true; return;
  }
  if (placing){
    btn.className = "wait"; btn.innerHTML = "רגע…"; btn.disabled = true; return;
  }
  if (supRound && supRound === S.roundId){
    btn.className = "wait";
    btn.innerHTML = `<span>🔍 מצב בקרה<br><span class="sub">סיבוב זה לצפייה בלבד</span></span>`;
    btn.disabled = true; return;
  }
  if (S.phase === "waiting"){
    if (eNow() >= S.phaseAt + S.waitMs){
      btn.className = "wait"; btn.textContent = "ממריאים…"; btn.disabled = true; return;
    }
    if (myBet){ btn.className = "cancel"; btn.innerHTML = `<span>Bet placed: ${fmt(myBet.amount)}<br><span class="sub">tap to cancel</span></span>`; }
    else if (balance < MIN_BET){
      btn.className = "wait";
      btn.innerHTML = `<span>אין צ'יפים<br><span class="sub">לחץ על ＋ ליד היתרה לטעינה באישור מנהל</span></span>`;
      btn.disabled = true;
    }
    else {
      btn.className = "bet"; btn.innerHTML = "Place bet";
      if (betValue() > balance) btn.disabled = true;
    }
  } else if (S.phase === "flying"){
    if (myBet && !myBet.cashedAt && !myBet.lost){
      if (!quoteFresh()){
        btn.className = "wait"; btn.textContent = "ממתין לנתון עדכני…"; btn.disabled = true; return;
      }
      btn.className = "cash";
      btn.innerHTML = `<span>Cash out<br><span class="sub" id="cashAmt">${(S.cents / 100).toFixed(2)}x · ${fmt(chipPayout(myBet.amount, S.cents))} chips</span></span>`;
    } else if (myBet && myBet.cashedAt){
      btn.className = "confirmed"; btn.disabled = true;
      btn.textContent = `${myBet.auto ? "AUTO CASH OUT" : "CASH OUT"} CONFIRMED · ${myBet.cashedAt.toFixed(2)}x`;
    } else if (S.queued){
      btn.className = "cancel"; btn.innerHTML = `Queued ${fmt(S.queued)} · cancel`;
    } else if (balance < MIN_BET){
      btn.className = "wait";
      btn.innerHTML = `<span>אין צ'יפים<br><span class="sub">לחץ על ＋ ליד היתרה לטעינה באישור מנהל</span></span>`;
      btn.disabled = true;
    } else {
      btn.className = "bet"; btn.innerHTML = `<span>Bet next round</span>`;
      if (betValue() > balance) btn.disabled = true;
    }
  } else {
    if (S.queued){ btn.className = "cancel"; btn.innerHTML = `Queued ${fmt(S.queued)} · cancel`; }
    else { btn.className = "wait"; btn.innerHTML = "Next round…"; }
  }
}

/* =====================================================================
   SUPERVISOR (owner) MODE — 5 quick taps on the logo, then the owner
   code (asked once per device). Shows the drawn crash point live; the
   server locks every peeked round to watch-only for this account, so
   the information can never steer play. The same code unlocks the
   admin dashboard and chip top-ups while Google sign-in is paused.
   ===================================================================== */
$("#fairPill").insertAdjacentHTML("afterend",
  '<div id="supPill" hidden>🔍 <b id="supVal">–</b></div>');
let supMode = store.get("avSup", false);
let supGeneration = 0;
let supRound = "";                       // roundId currently peeked
async function supPeek(){
  const generation = ++supGeneration, roundId = S.roundId;
  $("#supPill").hidden = true;
  if (!supMode || !joined || !roundId) return;
  try{
    const r = await FX("avPeek", {roundId, code:store.get("avSupCode", "")});
    // Ignore a response for an old round or for a mode that has since been closed.
    if (generation !== supGeneration || !supMode || roundId !== S.roundId || r.roundId !== roundId) return;
    supRound = r.roundId;
    $("#supVal").textContent = r.crashPoint.toFixed(2) + "x";
    $("#supPill").hidden = false; $("#adminBtn").hidden = false;
    updateAction();
  }catch(e){
    if (generation !== supGeneration || roundId !== S.roundId || !supMode) return;
    $("#supPill").hidden = true;
    const msg = String((e && e.message) || "");
    if (/קוד/.test(msg)){
      store.set("avSupCode", ""); supMode = false; store.set("avSup", false);
    }
    if (msg) toastErr(e);
  }
}
let supTaps = [];
$("#brand").addEventListener("click", () => {
  const t = performance.now();
  supTaps = supTaps.filter(x => t - x < 1600);
  supTaps.push(t);
  if (supTaps.length < 5) return;
  supTaps = [];
  if (!supMode){
    let code = store.get("avSupCode", "");
    if (!code){
      code = (prompt("קוד מנהל:") || "").trim();
      if (!code) return;
      store.set("avSupCode", code);
    }
    supMode = true; store.set("avSup", true);
    supPeek();
  } else {
    supMode = false; store.set("avSup", false);
    ++supGeneration; // Keep the watch-only lock for the round already seen.
    $("#supPill").hidden = true;
    $("#adminBtn").hidden = !isAdminUser;
    updateAction();
  }
  play("ui", 0.3);
});

/* =====================================================================
   TICKER — real top winners + real chat, stock-style
   ===================================================================== */
let latestChat = [];
async function buildTicker(){
  const F = window.avFB;
  const items = [];
  try{
    const top = await F.getDocs(F.query(F.collection(F.db, "aviatorPlayers"),
      F.orderBy("net", "desc"), F.limit(3)));
    top.forEach(d => {
      const p = d.data();
      if (p.net > 0) items.push(`<span>🏆 <b class="tk-name">${esc(p.name || "Pilot")}</b> <b class="tk-win">+${fmt(p.net)}</b></span>`);
    });
  }catch(e){}
  if (history.length)
    items.push(`<span class="tk-msg">last round <b>${history[0].toFixed(2)}x</b></span>`);
  for (const m of latestChat.slice(0, 4))
    items.push(`<span><b class="tk-name">${esc(m.name)}:</b> <span class="tk-msg">${esc(m.text)}</span></span>`);
  if (!items.length) return;
  const track = $("#tickerTrack");
  track.innerHTML = items.join('<span class="tk-sep">◆</span>');
  track.style.animation = "none"; void track.offsetWidth;
  track.style.animation = "";
  track.style.animationDuration = Math.max(22, items.length * 5) + "s";
}

/* =====================================================================
   STATE SYNC — mirror aviator/state into S and fire phase effects
   ===================================================================== */
function updateFair(){
  const el = $("#fairPill");
  if (!S.hash){ el.hidden = true; return; }
  el.hidden = false;
  if (S.phase === "crashed" && S.seed){
    el.textContent = `seed ${S.seed.slice(0, 12)}…`;
    el.title = `round ${S.roundId}\nseed: ${S.seed}\nhash: ${S.hash}`;
  } else {
    el.textContent = `fair · ${S.hash.slice(0, 12)}…`;
    el.title = `SHA-256 commitment for this round:\n${S.hash}\nהזרע נחשף אחרי הקראש`;
  }
}
function onWaiting(){
  S.mult = 1;
  /* safe moment for a self-update: round is fresh, no bet is down yet */
  if (newBuildLive && !myBet && !S.queued){ location.reload(); return; }
  FX("avCashout", {warmup:true}).catch(()=>{});
  S.lastTickSec = -1; S.lastWholeMult = 1; S.radioDone = false;
  beltChime();
  particles.length = 0;
  view.yMax = 2; view.xMax = 8;
  $("#flightNums").hidden = true;
  $("#countdown").hidden = false;
  $("#crashTag").classList.remove("on");
  $("#safeTag").classList.remove("on");
  $("#mult").className = "";
  if (S.queued > 0){
    const q = S.queued; S.queued = 0;
    if (q <= balance) doPlaceBet(q, true);
  }
  setBetValue(betValue());
  renderPlayers(); updateAction(); buildTicker();
  supPeek();                       // supervisor: reveal the fresh round
}
function onFlying(){
  // A phase event may precede the next animation frame (or resume a hidden tab).
  // Paint this round's price before revealing the readout or accepting an exit.
  const m = $("#mult");
  m.textContent = (S.cents / 100).toFixed(2) + "x";
  m.className = "";
  $("#crashTag").classList.remove("on");
  $("#safeTag").classList.remove("on");
  $("#countdown").hidden = true;
  $("#flightNums").hidden = false;
  toneStart();
  play("slide", 0.35);
  updateAction();
}
function onCrashed(){
  $("#countdown").hidden = true; $("#flightNums").hidden = false;
  S.mult = S.crashPoint || S.mult; S.cents = toCents(S.mult);
  toneStop(0.05);
  play("crash", 0.75, 0.03);
  haptic([30, 40, 60]);
  const m = $("#mult");
  m.textContent = (S.crashPoint || 0).toFixed(2) + "x";
  m.className = "dead";
  $("#crashTag").classList.add("on");
  $("#redFlash").classList.remove("on"); void $("#redFlash").offsetWidth;
  $("#redFlash").classList.add("on");
  if (!REDUCED){
    $("#stage").classList.remove("shake"); void $("#stage").offsetWidth;
    $("#stage").classList.add("shake");
  }
  if (S.crashPoint) { explode(); pushHistory(S.crashPoint); }
  updateAction();
}
function applyState(s){
  if (!s || !/^r[0-9]+$/.test(s.roundId || "")) return;
  const order = {boot:-1, waiting:0, flying:1, crashed:2};
  if (!(s.phase in order) || (S.roundId && Number(s.roundId.slice(1)) < Number(S.roundId.slice(1)))) return;
  if (s.roundId === S.roundId && order[s.phase] < order[S.phase]) return;
  S.protocol = s.protocol || 0;
  GROWTH_K = s.growthK || GROWTH_K;
  S.waitMs = s.waitMs || S.waitMs;
  S.crashHold = s.crashHold || S.crashHold;
  const newRound = s.roundId !== S.roundId;
  const newPhase = newRound || s.phase !== S.phase;
  S.roundId = s.roundId;
  S.hash = s.hash || "";
  S.seed = s.seed || null;
  S.crashPoint = s.crashPoint || null;
  S.phaseAt = s.phaseAt;
  if (newRound){
    S.mult = 1; S.cents = 100; S.confirmedCents = 100; S.quote = null; S.quoteAt = 0;
    announcedRound = ""; cashoutRtt = null; pendingCash = null; cashing = false; pendingPlace = null; placing = false; queuedEdit = null; clearTimeout(rebetTimer);
    ++supGeneration; $("#supPill").hidden = true;
    subscribeBets(s.roundId);
  }
  if (newPhase){
    S.phase = s.phase;
    if (s.phase === "waiting") onWaiting();
    else if (s.phase === "flying") onFlying();
    else if (s.phase === "crashed") onCrashed();
  }
  updateFair(); updateSyncStatus();
  if (newRound && s.phase !== "waiting") supPeek();
}

/* =====================================================================
   SUBSCRIPTIONS
   ===================================================================== */
let unsubState = null, unsubPlayer = null, unsubBets = null, unsubChat = null;
function subscribeBets(roundId){
  const F = window.avFB;
  if (unsubBets) unsubBets();
  roundBets = []; myBet = null;
  unsubBets = F.onSnapshot(
    F.query(F.collection(F.db, "aviatorBets"), F.where("roundId", "==", roundId)),
    snap => {
      if (roundId !== S.roundId) return;
      roundBets = snap.docs.map(d => d.data());
      const uid = user && user.uid;
      myBet = roundBets.find(b => b.uid === uid) || null;
      if (myBet && myBet.cashedAt && !(pendingCash && pendingCash.roundId === roundId)) confirmCashout({roundId, mult:myBet.cashedAt, win:myBet.win, auto:myBet.auto});
      renderPlayers(); updateAction();
    }, e => { toastErr(e); });
}
function subscribeAll(){
  const F = window.avFB;
  if (!unsubState){
    unsubState = F.onSnapshot(F.doc(F.db, "aviator/state"), snap => {
      if (snap.exists()) applyState(snap.data());
    });
  }
  if (!unsubPlayer && user){
    unsubPlayer = F.onSnapshot(F.doc(F.db, "aviatorPlayers/" + user.uid), snap => {
      if (snap.exists()){
        setBalance(snap.data().balance || 0);
        updateAction();
      }
    });
  }
  if (!unsubChat){
    unsubChat = F.onSnapshot(
      F.query(F.collection(F.db, "aviatorChat"), F.orderBy("ts", "desc"), F.limit(40)),
      snap => {
        const msgs = snap.docs.map(d => d.data()).reverse();
        latestChat = msgs.slice(-5).reverse();
        renderChat(msgs);
        if (!$("#chatModal").classList.contains("on") && msgs.length &&
            msgs[msgs.length - 1].uid !== (user && user.uid)) {
          $("#chatBtn").classList.add("on");
        }
      });
  }
  loadHistory();
}
async function loadHistory(){
  const F = window.avFB;
  try{
    const snap = await F.getDocs(F.query(F.collection(F.db, "aviatorRounds"),
      F.orderBy("endedAt", "desc"), F.limit(24)));
    history = snap.docs.map(d => d.data().crashPoint);
    renderHistory();
  }catch(e){}
}

/* =====================================================================
   AUTH — guest entry with a nickname (Google/phone paused until the
   OAuth console setup is done; the server keeps every uid's balance)
   ===================================================================== */
function showLogin(err){
  $("#loginModal").classList.add("on");
  const nick = $("#nickInput");
  if (nick && !nick.value) nick.value = store.get("avNick", "");
  if (err) $("#loginErr").textContent = err;
}
function hideLogin(){ $("#loginModal").classList.remove("on"); }

async function join(){
  try{
    const r = await FX("avJoin", {name: myName()});
    /* clock already noted by FX with rtt */
    isAdminUser = !!r.admin;
    $("#adminBtn").hidden = !isAdminUser;
    setBalance(r.balance);
    setBetValue(Math.max(100, niceAmount(r.balance * 0.01)));
    joined = true;
    FX("avCashout", {warmup:true}).catch(()=>{});
    subscribeAll();
    maybeTick(true);
    updateAction();
  }catch(e){
    showLogin("שגיאה בכניסה למועדון: " +
      ((e && (e.code || e.message)) || "לא ידועה") + " — נסה שוב");
    joined = false;
  }
}

addEventListener("fb-ready", () => {
  const F = window.avFB;
  /* straight into the game: sign in silently as a guest, no login screen.
     The modal only appears if the silent sign-in itself fails. */
  F.onAuthStateChanged(F.auth, u => {
    user = u;
    if (u){ hideLogin(); join(); }
    else {
      joined = false; updateAction();
      F.signInAnonymously(F.auth).catch(e => {
        showLogin("שגיאת כניסה: " + ((e && e.code) || "נסה שוב"));
      });
    }
  });

  const enterAsGuest = () => {
    $("#loginErr").textContent = "";
    const nick = $("#nickInput").value.trim().slice(0, 24);
    if (nick) store.set("avNick", nick);
    F.signInAnonymously(F.auth).catch(e => {
      $("#loginErr").textContent = "שגיאת כניסה: " + ((e && e.code) || "נסה שוב");
    });
  };
  $("#guestBtn").addEventListener("click", enterAsGuest);
  $("#nickInput").addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); enterAsGuest(); }
  });
});

/* =====================================================================
   CHAT
   ===================================================================== */
const chatUI = AviatorUX.createChat({
  document, getUser: () => user, getName: myName,
  send: message => {
    const F = window.avFB;
    return F.addDoc(F.collection(F.db, "aviatorChat"), message);
  }
});
function renderChat(msgs){ chatUI.render(msgs); }

/* =====================================================================
   ADMIN — supervision & settlement (owner account only).
   Balances, per-player credit top-ups, settled rounds. The crash point
   of a LIVE round is never shown to anyone — server holds it secret.
   ===================================================================== */
let unsubAdm = null;
$("#adminBtn").addEventListener("click", () => {
  $("#adminModal").classList.add("on");
  const F = window.avFB;
  if (!unsubAdm){
    unsubAdm = F.onSnapshot(
      F.query(F.collection(F.db, "aviatorPlayers"), F.orderBy("balance", "desc"), F.limit(100)),
      snap => {
        $("#admPlayers").innerHTML = snap.docs.map(d => {
          const p = d.data();
          const net = p.net || 0;
          return `
          <div class="admRow" data-uid="${esc(p.uid)}" data-name="${esc(p.name || "Pilot")}">
            <img src="${esc(avatarFor(p.uid, p.photo))}" alt="" referrerpolicy="no-referrer">
            <span class="nm">${esc(p.name || "Pilot")}</span>
            <span class="net ${net >= 0 ? "up" : "dn"}">${net >= 0 ? "+" : ""}${fmt(net)}</span>
            <span class="bal">${fmt(p.balance || 0)}</span>
            <button class="admCredit">הטענה</button>
          </div>`;
        }).join("");
      });
  }
  refreshAdmRounds();
});
async function refreshAdmRounds(){
  const F = window.avFB;
  try{
    const snap = await F.getDocs(F.query(F.collection(F.db, "aviatorRounds"),
      F.orderBy("endedAt", "desc"), F.limit(15)));
    $("#admRounds").innerHTML = snap.docs.map(d => {
      const r = d.data();
      const t = new Date(r.endedAt).toLocaleTimeString("he-IL", {hour: "2-digit", minute: "2-digit"});
      return `<div class="admRound"><b>${r.crashPoint.toFixed(2)}x</b>
        <span>${r.players} שחקנים</span>
        <span>הימורים ${fmt(r.totalBets)}</span>
        <span>שולם ${fmt(r.totalPaid)}</span>
        <span style="margin-inline-start:auto">${t}</span></div>`;
    }).join("");
  }catch(e){}
}
$("#admPlayers").addEventListener("click", async e => {
  const btn = e.target.closest(".admCredit");
  if (!btn) return;
  const row = btn.closest(".admRow");
  const amount = Number(prompt(`כמה צ'יפים להטעין ל-${row.dataset.name}? (מספר שלילי = הורדה)`));
  if (!amount) return;
  try{
    const r = await FX("avCredit",
      {uid: row.dataset.uid, amount, code: store.get("avSupCode", "")});
    /* clock already noted by FX with rtt */
    play("bigwin", 0.5);
  }catch(err){ toastErr(err); }
});
$("#adminClose").addEventListener("click", () => $("#adminModal").classList.remove("on"));
$("#adminModal").addEventListener("click", e => { if (e.target.id === "adminModal") $("#adminModal").classList.remove("on"); });

/* =====================================================================
   MAIN LOOP — renders on the server's clock
   ===================================================================== */
function frame(){
  const now = eNow();
  const el = now - S.phaseAt;

  if (S.phase === "waiting"){
    const left = Math.max(0, S.waitMs - el);
    const sec = Math.ceil(left / 1000);
    $("#ringNum").textContent = sec;
    const r = 46, c = 2 * Math.PI * r;
    const fg = $("#ringFg");
    fg.style.strokeDasharray = c;
    fg.style.strokeDashoffset = c * (1 - left / S.waitMs);
    if (sec !== S.lastTickSec){
      S.lastTickSec = sec;
      if (sec <= 3 && sec > 0) play("tick", 0.3, 0.02);
      if (sec === 2 && !S.radioDone){ S.radioDone = true; radioCall(); }
    }
    if (el >= S.waitMs){ maybeTick(); if (S.lastTickSec === 0) updateAction(); }

  } else if (S.phase === "flying"){
    renderFlightValue();
    const mEl = $("#mult");
    mEl.textContent = S.mult.toFixed(2) + "x";
    if (!mEl.classList.contains("dead") && !mEl.classList.contains("safe"))
      mEl.className = S.mult >= 5 ? "hot" : S.mult >= 2 ? "gold" : "";
    const whole = Math.floor(S.mult);
    if (whole > S.lastWholeMult && !REDUCED){
      S.lastWholeMult = whole;
      mEl.classList.add("pulse");
      setTimeout(() => mEl.classList.remove("pulse"), 320);
    }
    toneUpdate(S.mult);
    // The stored target is enforced by the server even with the page closed.
    if (myBet && myBet.autoAt && !myBet.cashedAt && !myBet.lost && !cashing && S.mult >= myBet.autoAt) doCashout();
    const ca = $("#cashAmt");
    if (ca && myBet && !myBet.cashedAt) ca.textContent = S.mult.toFixed(2) + "x · " + fmt(chipPayout(myBet.amount, S.cents)) + " chips";
    maybeTick();


  } else if (S.phase === "crashed"){
    if (el >= (S.crashHold || 3200) + 150) maybeTick();
  } else if (S.phase === "boot" && joined){
    maybeTick();
  }

  updateSyncStatus();
  updateFlightStatus();
  updateCockpit(now);
  draw(now);
  lastPaintAt = performance.now();
  requestAnimationFrame(frame);
}

/* =====================================================================
   INPUT WIRING
   ===================================================================== */
let cashPointerHandled = false;
$("#actionBtn").addEventListener("pointerdown", e => {
  if (e.button !== 0 || !e.isPrimary || e.currentTarget.disabled) return;
  if (S.phase === "flying" && myBet && !myBet.cashedAt && !myBet.lost){
    cashPointerHandled = true; doCashout(); unlockAudio();
  }
});
$("#actionBtn").addEventListener("pointercancel", () => { cashPointerHandled = false; });
$("#actionBtn").addEventListener("click", e => {
  if (cashPointerHandled && e.detail !== 0){ cashPointerHandled = false; return; }
  cashPointerHandled = false;
  if (S.phase === "flying" && myBet && !myBet.cashedAt && !myBet.lost){
    doCashout(); unlockAudio(); return;
  }
  unlockAudio();
  if (S.phase === "waiting"){
    myBet ? doCancelBet() : doPlaceBet(betValue());
  } else if (S.phase === "flying"){
    if (myBet && !myBet.cashedAt && !myBet.lost) doCashout();
    else if (S.queued){ S.queued = 0; play("ui", 0.3); updateAction(); }
    else if (!myBet){ const v = betValue(); if (v >= MIN_BET && v <= balance){ S.queued = v; play("bet", 0.5); haptic(10); updateAction(); } }
  } else if (S.phase === "crashed" && S.queued){
    S.queued = 0; play("ui", 0.3); updateAction();
  }
});
$("#minus").addEventListener("click", () => { unlockAudio(); setBetValue(betValue() - betStep()); syncPlacedBet(); play("ui", 0.22); updateAction(); });
$("#plus").addEventListener("click",  () => { unlockAudio(); setBetValue(betValue() + betStep()); syncPlacedBet(); play("ui", 0.22); updateAction(); });
document.querySelectorAll(".chip").forEach(ch => ch.addEventListener("click", () => {
  unlockAudio(); play("chip", 0.4);
  if (ch.dataset.pct) setBetValue(niceAmount((balance + betCredit()) * +ch.dataset.pct));
  else if (ch.dataset.mul) setBetValue(betValue() * +ch.dataset.mul);
  else setBetValue(balance + betCredit());
  syncPlacedBet();
  updateAction();
}));
$("#betInput").addEventListener("input", () => { fitBetFont(); updateAction(); });
$("#betInput").addEventListener("blur", () => { setBetValue(betValue()); syncPlacedBet(); updateAction(); });
$("#autoSwitch").addEventListener("click", e => {
  unlockAudio(); autoOn = !autoOn;
  e.currentTarget.classList.toggle("on", autoOn);
  e.currentTarget.setAttribute("aria-checked", autoOn);
  play("ui", 0.25);
  // the server stores autoAt with the bet — refresh it if one is placed
  if (S.phase === "waiting" && myBet) doPlaceBet(myBet.amount, true);
});
$("#autoInput").addEventListener("blur", e => {
  const v = clamp(parseFloat(e.target.value) || 2, 1.01, 100);
  e.target.value = v.toFixed(2);
  if (S.phase === "waiting" && myBet && autoOn) doPlaceBet(myBet.amount, true);
});
$("#soundBtn").addEventListener("click", () => {
  unlockAudio();
  muted = !muted;
  store.set("pt_av_muted", muted);
  updateSoundOutput();
  if (muted) toneStop(0.03);
  else if (S.phase === "flying") toneStart();
});
["pointerdown", "keydown", "touchstart"].forEach(ev =>
  addEventListener(ev, unlockAudio, { once: false, passive: true }));
document.addEventListener("visibilitychange", () => {
  updateSoundOutput();
  if (document.visibilityState === "visible") maybeTick(true);
});

/* intro splash → club entrance */
$("#spPlay").addEventListener("click", () => {
  entered = true;
  unlockAudio();
  $("#splash").classList.add("off");
  if (!user) showLogin();
  else if (S.phase === "waiting") beltChime();
  else if (S.phase === "flying") toneStart();
  setTimeout(() => { const s = $("#splash"); if (s) s.remove(); }, 750);
});
