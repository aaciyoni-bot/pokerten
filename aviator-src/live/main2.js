/* =====================================================================
   LIVE STATE — identity, balance, my bet
   ===================================================================== */
/* `entered` comes from the sound engine section (no sound before TAKE OFF) */
let user = null, joined = false, isAdminUser = false;
let balance = 0, shownBalance = 0;
let myBet = null;           // my aviatorBets doc data for this round
let placing = false, cashing = false;
let autoOn = false;
const FX = (name, data) => {
  const t0 = Date.now();
  return window.avFB.fx(name, data || {}).then(r => {
    if (r && r.serverNow) noteServerNow(r.serverNow, Date.now() - t0);
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
  if (amt === myBet.amount) return;
  clearTimeout(rebetTimer);
  rebetTimer = setTimeout(() => {
    if (S.phase === "waiting" && myBet && amt >= MIN_BET) doPlaceBet(amt, true);
  }, 450);
}

/* =====================================================================
   SERVER ACTIONS
   ===================================================================== */
async function doPlaceBet(amount, silent){
  if (placing || !joined) return;
  placing = true; updateAction();
  try{
    const autoAt = autoOn ? (parseFloat($("#autoInput").value) || 0) : 0;
    const r = await FX("avBet", {amount, autoAt});
    /* clock already noted by FX with rtt */
    setBalance(r.balance);
    if (!silent){ play("bet", 0.55); haptic(12); }
  }catch(e){ toastErr(e); }
  placing = false; updateAction();
}
async function doCancelBet(){
  if (placing || !myBet) return;
  placing = true; updateAction();
  try{
    const r = await FX("avCancelBet", {});
    /* clock already noted by FX with rtt */
    play("ui", 0.3);
  }catch(e){ toastErr(e); }
  placing = false; updateAction();
}
async function doCashout(){
  if (cashing || !joined || !myBet || myBet.cashedAt || myBet.lost) return;
  cashing = true;
  const seen = S.mult;      // the number on screen at the moment of the press
  try{
    const r = await FX("avCashout", {seen});
    /* clock already noted by FX with rtt */
    play(r.mult >= 5 ? "bigwin" : "win", r.mult >= 5 ? 0.8 : 0.65, 0.02);
    haptic([15, 30, 15]);
    celebrate(r.win, r.mult);
    /* unmistakable "I got out in time": green multiplier + a badge that
       stays up for the rest of the flight, through the crash */
    $("#mult").classList.add("safe");
    const st = $("#safeTag");
    st.textContent = `✔ עצרת בזמן · ${r.mult.toFixed(2)}x · +${fmt(r.win)}`;
    st.classList.remove("on"); void st.offsetWidth;
    st.classList.add("on");
  }catch(e){
    /* the press reached the server after the real crash — tick the round
       forward NOW so the crash screen appears immediately, and say so */
    maybeTick(true);
    if (e && /התרסק/.test(String(e.message || ""))){
      toastErr({message: "המטוס התרסק רגע לפני שהלחיצה הגיעה"});
    }
  }
  cashing = false; updateAction();
}

/* round ticks: any client may nudge the server past a phase deadline */
let lastTickAt = 0;
function maybeTick(force){
  const now = Date.now();
  if (!joined || document.visibilityState !== "visible") return;
  /* tick faster mid-flight: the crash only becomes real when someone
     ticks it, and a slow tick is what made the plane fly past its crash */
  if (!force && now - lastTickAt < (S.phase === "flying" ? 450 : 1400)) return;
  lastTickAt = now;
  FX("avTick", {}).then(r => {
    /* clock already noted by FX with rtt */
  }).catch(() => {});
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
    /* an auto cash-out is settled on the server only at crash time, but the
       target is public — show it the moment the plane passes it */
    const eff = r.cashedAt ||
      ((S.phase === "flying" && r.autoAt && S.mult >= r.autoAt) ? r.autoAt : null);
    const cls = eff ? "cashed" : (r.lost ? "bust" : "");
    const st = eff ? eff.toFixed(2) + "x" : (r.lost ? "BUST" : "…");
    return `
    <div class="prow ${me ? "me" : ""} ${cls}">
      <img src="${esc(avatarFor(r.uid, r.photo))}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="nm">${esc(me ? "You" : r.name || "Pilot")}</span>
      <span class="bt">${fmt(r.amount)}</span>
      <span class="st">${st}</span>
    </div>`;
  }).join("");
}

function updateAction(){
  const btn = $("#actionBtn");
  btn.disabled = false;
  if (!joined){
    btn.className = "wait"; btn.innerHTML = "מתחבר…"; btn.disabled = true; return;
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
    if (myBet){ btn.className = "cancel"; btn.innerHTML = `<span>Bet placed: ${fmt(myBet.amount)}<br><span class="sub">tap to cancel</span></span>`; }
    else if (balance < MIN_BET){
      btn.className = "wait";
      btn.innerHTML = `<span>אין צ'יפים<br><span class="sub">בקש הטענה מהמנהל — בינתיים אפשר לצפות</span></span>`;
      btn.disabled = true;
    }
    else {
      btn.className = "bet"; btn.innerHTML = "Place bet";
      if (betValue() > balance) btn.disabled = true;
    }
  } else if (S.phase === "flying"){
    if (myBet && !myBet.cashedAt && !myBet.lost){
      btn.className = "cash";
      btn.innerHTML = `<span>Cash out<br><span class="sub" id="cashAmt"></span></span>`;
    } else if (myBet && myBet.cashedAt){
      btn.className = "wait"; btn.innerHTML = `Cashed @ ${myBet.cashedAt.toFixed(2)}x`;
    } else if (S.queued){
      btn.className = "cancel"; btn.innerHTML = `Queued ${fmt(S.queued)} · cancel`;
    } else if (balance < MIN_BET){
      btn.className = "wait";
      btn.innerHTML = `<span>אין צ'יפים<br><span class="sub">בקש הטענה מהמנהל — בינתיים אפשר לצפות</span></span>`;
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
let supRound = "";                       // roundId currently peeked
async function supPeek(){
  if (!supMode || !joined) return;
  try{
    const r = await FX("avPeek", {code: store.get("avSupCode", "")});
    supRound = r.roundId;
    $("#supVal").textContent = r.crashPoint.toFixed(2) + "x";
    $("#supPill").hidden = false;
    $("#adminBtn").hidden = false;       // the code doubles as the admin key
    updateAction();
  }catch(e){
    $("#supPill").hidden = true;
    const msg = String((e && e.message) || "");
    if (/קוד/.test(msg)){                // wrong code — forget it, switch off
      store.set("avSupCode", "");
      supMode = false; store.set("avSup", false);
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
    supRound = "";
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
  S.lastTickSec = -1; S.lastWholeMult = 1; S.radioDone = false;
  cashing = false;
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
  $("#countdown").hidden = true;
  $("#flightNums").hidden = false;
  toneStart();
  play("slide", 0.35);
  updateAction();
}
function onCrashed(){
  S.mult = S.crashPoint || S.mult;
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
  if (newRound) subscribeBets(s.roundId);
  if (newPhase){
    S.phase = s.phase;
    if (s.phase === "waiting") onWaiting();
    else if (s.phase === "flying") onFlying();
    else if (s.phase === "crashed") onCrashed();
  }
  updateFair();
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
      roundBets = snap.docs.map(d => d.data());
      const uid = user && user.uid;
      myBet = roundBets.find(b => b.uid === uid) || null;
      renderPlayers(); updateAction();
    });
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
function renderChat(msgs){
  const uid = user && user.uid;
  const list = $("#chatList");
  const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 60;
  list.innerHTML = msgs.map(m => `
    <div class="chatMsg ${m.uid === uid ? "me" : ""}"><b>${esc(m.name || "Pilot")}</b> ${esc(m.text)}</div>`).join("");
  if (stick) list.scrollTop = list.scrollHeight;
}
$("#chatBtn").addEventListener("click", () => {
  $("#chatModal").classList.add("on");
  $("#chatBtn").classList.remove("on");
  const list = $("#chatList"); list.scrollTop = list.scrollHeight;
});
$("#chatClose").addEventListener("click", () => $("#chatModal").classList.remove("on"));
$("#chatModal").addEventListener("click", e => { if (e.target.id === "chatModal") $("#chatModal").classList.remove("on"); });
$("#chatForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("#chatInput").value.trim().slice(0, 140);
  if (!text || !user) return;
  $("#chatInput").value = "";
  const F = window.avFB;
  F.addDoc(F.collection(F.db, "aviatorChat"),
    {uid: user.uid, name: myName(), text, ts: Date.now()}).catch(() => {});
  $("#chatModal").classList.remove("on");   // back to the game right away
});

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
    if (el >= S.waitMs + 150) maybeTick();

  } else if (S.phase === "flying"){
    /* real-time on the server's clock; payment is exact-WYSIWYG so the
       number on screen is exactly what a press pays */
    S.mult = clamp(multAt(el), 1, 5000);
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
    // client-side auto fire (the server also enforces autoAt at settle)
    if (autoOn && myBet && !myBet.cashedAt && !myBet.lost && !cashing){
      const target = parseFloat($("#autoInput").value) || 0;
      if (target >= 1.01 && S.mult >= target) doCashout();
    }
    const ca = $("#cashAmt");
    if (ca && myBet && !myBet.cashedAt) ca.textContent = fmt(myBet.amount) + " → " + fmt(myBet.amount * S.mult) + " chips";
    /* bots and auto-cashers visibly bail out as the plane passes their target */
    if (now - lastPlayersRender > 450){ lastPlayersRender = now; renderPlayers(); }
    // nudge the server: only it knows when the crash lands
    if (el > 1200) maybeTick();

  } else if (S.phase === "crashed"){
    if (el >= (S.crashHold || 3200) + 150) maybeTick();
  } else if (S.phase === "boot" && joined){
    maybeTick();
  }

  updateCockpit(now);
  draw(now);
  requestAnimationFrame(frame);
}

/* =====================================================================
   INPUT WIRING
   ===================================================================== */
$("#actionBtn").addEventListener("click", () => {
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
  $("#soundBtn").textContent = muted ? "🔇" : "🔊";
  if (muted) toneStop(0.03);
  else if (S.phase === "flying") toneStart();
});
["pointerdown", "keydown", "touchstart"].forEach(ev =>
  addEventListener(ev, unlockAudio, { once: false, passive: true }));
document.addEventListener("visibilitychange", () => {
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
