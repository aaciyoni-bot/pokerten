/* In-page mock of window.avFB — simulates the aviator Cloud Functions +
   Firestore for browser testing without network. Injected after load. */
(function(){
  const GROWTH_K = 0.132, WAIT_MS = 7000, HOLD = 3200;
  const now = () => Date.now();
  const multAt = ms => Math.exp(GROWTH_K * ms / 1000);
  const timeForMult = m => Math.log(m) / GROWTH_K * 1000;

  const ME = { uid: "u_me", displayName: "Tester", email: "tester@example.com" };
  const players = {
    u_me:  { uid: "u_me",  name: "Tester", photo: "", balance: 50000, net: 0 },
    u_two: { uid: "u_two", name: "Rivka",  photo: "", balance: 8000,  net: 1200 },
  };
  let state = null, engine = null, bets = {}, chat = [], rounds = [];
  const subs = { state: [], bets: [], player: [], chat: [] };

  function newRound(){
    const rid = "r" + now();
    engine = { roundId: rid, crashPoint: window.__mockCrash || (1 + Math.random() * 3), seed: "seed" + rid };
    state = { roundId: rid, phase: "waiting", phaseAt: now(), waitMs: WAIT_MS,
      crashHold: HOLD, growthK: GROWTH_K, hash: "abcdef1234567890", crashPoint: null, seed: null };
    bets = {};
    // a second player joins each round
    setTimeout(() => {
      if (state.phase !== "waiting") return;
      bets[state.roundId + "_u_two"] = { uid: "u_two", roundId: state.roundId, amount: 500,
        autoAt: 1.8, name: "Rivka", photo: "", cashedAt: null, win: 0, lost: false, ts: now() };
      emitBets();
    }, 1200);
    emitState();
  }
  function settle(){
    for (const k of Object.keys(bets)){
      const b = bets[k];
      if (b.cashedAt) continue;
      if (b.autoAt && b.autoAt < engine.crashPoint){
        b.cashedAt = b.autoAt; b.win = Math.floor(b.amount * b.autoAt);
        players[b.uid].balance += b.win; players[b.uid].net += b.win - b.amount;
      } else { b.lost = true; players[b.uid].net -= b.amount; }
    }
    rounds.unshift({ roundId: state.roundId, crashPoint: engine.crashPoint, seed: engine.seed,
      hash: state.hash, endedAt: now(), players: Object.keys(bets).length,
      totalBets: Object.values(bets).reduce((s, b) => s + b.amount, 0),
      totalPaid: Object.values(bets).reduce((s, b) => s + (b.win || 0), 0) });
    state = { ...state, phase: "crashed", phaseAt: now(),
      crashPoint: engine.crashPoint, seed: engine.seed };
    emitState(); emitBets(); emitPlayer();
  }
  function tick(){
    const t = now();
    if (!state) { newRound(); return; }
    if (state.phase === "waiting" && t >= state.phaseAt + WAIT_MS){
      state = { ...state, phase: "flying", phaseAt: t }; emitState();
    } else if (state.phase === "flying" && t >= state.phaseAt + timeForMult(engine.crashPoint)){
      settle();
    } else if (state.phase === "crashed" && t >= state.phaseAt + HOLD){
      newRound();
    }
  }
  const emitState  = () => subs.state.forEach(f => f({ exists: () => true, data: () => state }));
  const emitBets   = () => subs.bets.forEach(f => f({ docs: Object.values(bets)
      .filter(b => b.roundId === state.roundId).map(b => ({ data: () => b })) }));
  const emitPlayer = () => subs.player.forEach(f => f({ exists: () => true, data: () => players.u_me }));
  const emitChat   = () => subs.chat.forEach(f => f({ docs: [...chat].reverse().map(c => ({ data: () => c })) }));

  const fx = {
    avJoin: () => ({ balance: players.u_me.balance, admin: true, serverNow: now() }),
    avTick: () => { tick(); return { serverNow: now(), state }; },
    avBet: ({ amount, autoAt }) => {
      if (state.phase !== "waiting") throw new Error("חלון ההימורים סגור");
      const key = state.roundId + "_u_me";
      const prior = bets[key] ? bets[key].amount : 0;
      if (amount > players.u_me.balance + prior) throw new Error("אין מספיק צ'יפים");
      players.u_me.balance += prior - amount;
      bets[key] = { uid: "u_me", roundId: state.roundId, amount,
        autoAt: autoAt >= 1.01 ? autoAt : null, name: "Tester", photo: "",
        cashedAt: null, win: 0, lost: false, ts: now() };
      emitBets(); emitPlayer();
      return { balance: players.u_me.balance, serverNow: now() };
    },
    avCancelBet: () => {
      const key = state.roundId + "_u_me";
      if (!bets[key]) throw new Error("אין הימור");
      players.u_me.balance += bets[key].amount;
      delete bets[key];
      emitBets(); emitPlayer();
      return { serverNow: now() };
    },
    avCashout: () => {
      const key = state.roundId + "_u_me";
      const b = bets[key];
      if (state.phase !== "flying" || !b || b.cashedAt) throw new Error("אין הימור פעיל");
      const mult = Math.floor(Math.min(multAt(now() - state.phaseAt), engine.crashPoint - 0.01) * 100) / 100;
      if (mult >= engine.crashPoint) throw new Error("התרסק");
      b.cashedAt = mult; b.win = Math.floor(b.amount * mult);
      players.u_me.balance += b.win; players.u_me.net += b.win - b.amount;
      emitBets(); emitPlayer();
      return { mult, win: b.win, serverNow: now() };
    },
    avCredit: ({ uid, amount }) => {
      players[uid].balance = Math.max(0, players[uid].balance + amount);
      emitPlayer();
      return { balance: players[uid].balance, serverNow: now() };
    },
  };

  const Q = (kind, extra) => ({ __q: kind, ...extra });
  window.avFB = {
    auth: {}, db: {},
    signInAnonymously: () => Promise.resolve(),
    onAuthStateChanged: (a, cb) => setTimeout(() => cb(ME), 50),
    signOut: () => {},
    doc: (db, path) => Q(path.startsWith ? path : path, { path }),
    collection: (db, name) => Q(name, { name }),
    query: (base, ...rest) => base,
    where: () => 0, orderBy: () => 0, limit: () => 0,
    addDoc: (col, data) => { chat.push(data); emitChat(); return Promise.resolve(); },
    getDocs: async (base) => {
      if (base.name === "aviatorPlayers") return { forEach: f => Object.values(players)
        .sort((a, b) => b.net - a.net).slice(0, 3).forEach(p => f({ data: () => p })),
        docs: Object.values(players).map(p => ({ data: () => p })) };
      if (base.name === "aviatorRounds") return { docs: rounds.slice(0, 24).map(r => ({ data: () => r })),
        forEach: f => rounds.slice(0, 24).forEach(r => f({ data: () => r })) };
      return { docs: [], forEach: () => {} };
    },
    onSnapshot: (target, cb) => {
      const key = target.path || target.name;
      if (key === "aviator/state"){ subs.state.push(cb); if (state) cb({ exists: () => true, data: () => state }); }
      else if (key === "aviatorBets"){ subs.bets.push(cb); }
      else if (String(key).startsWith("aviatorPlayers/")){ subs.player.push(cb); emitPlayer(); }
      else if (key === "aviatorPlayers"){ /* admin list */ cb({ docs: Object.values(players).map(p => ({ data: () => p })) }); }
      else if (key === "aviatorChat"){ subs.chat.push(cb); emitChat(); }
      return () => {};
    },
    fx: (name, data) => { try { return Promise.resolve(fx[name](data || {})); } catch (e) { return Promise.reject(e); } },
  };
  window.dispatchEvent(new Event("fb-ready"));
})();
