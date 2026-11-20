(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // These fields cannot change the outcome of a hand. Preserve fresh presence
  // and profile updates while rejecting concurrent money, seat or game edits.
  const metadata = new Set(['lastSeen', 'name', 'photo', 'avatarSeed']);
  function createPlayerCopies() {
    const bases = new WeakMap();
    return {
      clone(players) {
        const out = copy(players || {});
        Object.values(out).forEach(p => { p.cards = [...(p.cards || [])]; });
        bases.set(out, copy(bases.get(players) || players || {}));
        return out;
      },
      merge(current, proposed) {
        const base = bases.get(proposed);
        if (!base) throw new Error('stale-players');
        const keys = Object.keys(current || {}).sort();
        if (!equal(keys, Object.keys(base).sort())) throw new Error('stale-players');
        const out = copy(proposed);
        for (const uid of keys) {
          const before = base[uid], latest = current[uid];
          for (const field of new Set([...Object.keys(before), ...Object.keys(latest)])) {
            if (!metadata.has(field) && !equal(before[field], latest[field])) throw new Error('stale-players');
          }
          if (out[uid]) for (const field of metadata) {
            if (Object.prototype.hasOwnProperty.call(latest, field)) out[uid][field] = latest[field];
            else delete out[uid][field];
          }
        }
        return out;
      },
      committed(proposed, saved) {
        for (const uid of Object.keys(proposed)) delete proposed[uid];
        Object.assign(proposed, copy(saved));
        bases.set(proposed, copy(saved));
      }
    };
  }
  // Return original indices: sorting is a local preference and must never
  // change deal state or the index submitted for a Pineapple discard.
  function handDisplayOrder(cards, mode = 'rank') {
    const ranks = { A:14, K:13, Q:12, J:11, T:10 };
    const suits = { '♥':0, '♦':1, '♣':2, '♠':3 };
    const rank = c => ranks[c.val] || Number(c.val) || 0;
    const suit = c => suits[c.suit] ?? 4;
    const order = (cards || []).map((_, i) => i);
    if (mode === 'dealt') return order;
    return order.sort((a, b) =>
      (mode === 'suit' ? suit(cards[a]) - suit(cards[b]) : 0) ||
      rank(cards[b]) - rank(cards[a]) || suit(cards[a]) - suit(cards[b]) || a - b);
  }
  // Keep in sync with functions/godPeek.js. Never use betting/presence sequence
  // numbers here: only a change to the cards/board invalidates a private peek.
  function godCardContext(table) {
    const g = table?.gameState || {}, players = table?.players || {};
    return JSON.stringify([Number(table?.handCount) || 0, Number(g.handN) || 0, g.phase || '', g.currentGameType || '',
      (g.board || []).map(c => [c.val, c.suit]),
      Object.keys(players).filter(uid => (players[uid]?.cardCount || 0) > 0).sort()
        .map(uid => [uid, players[uid].cardCount])]);
  }
  function deckFour(storage) {
    try { return storage.getItem('pkDeck4') === '1'; } catch (_) { return false; }
  }
  function visibleStack(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }
  // Presentation only: the server has already settled these amounts atomically.
  // Every viewer uses physical seat order, rather than their rotated hero layout.
  function resultTimeline(g, players) {
    const reveals = g.earlyWin || g.allInReveal ? [] : Object.entries(players || {})
      .filter(([, p]) => p.cards?.length && ['active', 'busted'].includes(p.status))
      .sort(([a, p], [b, q]) => (p.seatIndex || 0) - (q.seatIndex || 0) || a.localeCompare(b));
    const revealDelays = Object.fromEntries(reveals.map(([uid], i) => [uid, Math.min(i, 8) * 180]));
    const winnerAt = Math.max(400, reveals.length ? Math.min(reveals.length - 1, 8) * 180 + 320 + 200 : 0);
    const amounts = new Map();
    for (const a of g.lastAwards || []) {
      if (a.uid && Number.isFinite(Number(a.amount)) && Number(a.amount) > 0)
        amounts.set(a.uid, Math.round(((amounts.get(a.uid) || 0) + Number(a.amount)) * 100) / 100);
    }
    const flightAt = winnerAt + 300, flightMs = 2000;
    const awards = [...amounts].map(([uid, amount], i) => ({uid, amount, delay: flightAt + Math.min(i, 3) * 80}));
    return {revealDelays, winnerAt, flightAt, flightMs, awards};
  }
  function createResultPresentation(now = () => root.performance?.now?.() ?? Date.now()) {
    let scope, previous, result;
    return {
      read(tableId, g = {}, players = {}, passive = false) {
        if (scope !== tableId) { scope = tableId; previous = null; result = null; }
        if (g.phase !== 'showdown') {
          if (g.phase) previous = {phase: g.phase, hand: g.handN, passive};
          result = null;
          return {key: null, animated: false, winnerReady: true, nextIn: null, stack: visibleStack};
        }
        const key = `${tableId}:${g.handN || 0}:${g.showdownAt || 0}`;
        if (result?.key !== key) {
          const timeline = resultTimeline(g, players);
          result = {...timeline, key, started: now(), animated: !!(g.showdownAt > 0 && timeline.awards.length &&
            previous && previous.phase !== 'showdown' && previous.hand === g.handN && !previous.passive && !passive)};
          previous = {phase: g.phase, hand: g.handN, passive};
        }
        // Do not replay a result after returning from the lobby/background.
        if (passive) result.animated = false;
        const elapsed = Math.max(0, now() - result.started);
        const arrivals = result.awards.map(a => a.delay + result.flightMs);
        const next = result.animated ? [result.winnerAt, ...arrivals].filter(t => t > elapsed).sort((a, b) => a - b)[0] : undefined;
        const snapshot = result;
        return {...result, elapsed, nextIn: next === undefined ? null : next - elapsed,
          winnerReady: !result.animated || elapsed >= result.winnerAt,
          stack(value, uid) {
            const actual = visibleStack(value), award = snapshot.awards.find(a => a.uid === uid);
            if (actual === null || !snapshot.animated || !award || elapsed >= award.delay + snapshot.flightMs) return actual;
            return Math.max(0, Math.round((actual - award.amount) * 100) / 100);
          }};
      }
    };
  }
  // Callable confirmations and realtime snapshots may arrive in either order.
  // Apply chips and turn as one server-owned update; never replay an old one.
  function acceptTableUpdate(current, incoming, partial = false) {
    if (!incoming || !incoming.id || (current && current.id !== incoming.id)) return current;
    const nextSeq = incoming.gameState?.__seq, currentSeq = current?.gameState?.__seq;
    if (partial && (!current || !incoming.players || !incoming.gameState || !Number.isSafeInteger(nextSeq))) return current;
    if (Number.isFinite(currentSeq) && Number.isFinite(nextSeq) &&
        (nextSeq < currentSeq || (partial && nextSeq === currentSeq))) return current;
    return partial ? {...current, ...incoming} : incoming;
  }
  function createWorkerClient(WorkerType) {
    let worker = null, sequence = 0;
    const pending = new Map();
    const close = () => {
      if (worker) worker.terminate();
      worker = null;
      for (const job of pending.values()) { clearTimeout(job.timer); job.resolve(null); }
      pending.clear();
    };
    return {
      close,
      request(kind, args) {
        if (!WorkerType) return Promise.resolve(null);
        return new Promise(resolve => {
          try {
            if (!worker) {
              worker = new WorkerType('assets/js/poker-equity-worker.js?v=356');
              worker.onerror = close;
              worker.onmessage = ({data}) => {
                const job = pending.get(data.id);
                if (!job) return;
                clearTimeout(job.timer);
                pending.delete(data.id);
                job.resolve(data.value);
              };
            }
            const id = ++sequence;
            pending.set(id, { resolve, timer: setTimeout(close, 8000) });
            worker.postMessage({ id, kind, args });
          } catch (_) { close(); resolve(null); }
        });
      }
    };
  }
  function spinTickTimes(rotation, segments, duration) {
    const bezier = (u, a, b) => 3 * (1-u) * (1-u) * u * a + 3 * (1-u) * u * u * b + u * u * u;
    const step = 360 / segments, times = [];
    for (let peg = 1; peg * step < rotation; peg++) {
      const distance = peg * step / rotation;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const mid = (lo+hi)/2; if (bezier(mid,.82,1) < distance) lo=mid; else hi=mid; }
      times.push(duration * bezier((lo+hi)/2,.13,.16));
    }
    return times;
  }
  // One request at a time, including runouts. Slow connections cannot build
  // a queue of overlapping ticks; stopping also cancels an in-flight follow-up.
  function startTickLoop(request, options = {}) {
    const schedule=options.setTimeout||setTimeout, cancel=options.clearTimeout||clearTimeout;
    const now=options.now||Date.now;
    let stopped=false,timer=null;
    const tick=async()=>{
      if(stopped)return;
      const started=now();
      try{await request();if(!stopped&&options.onSuccess)options.onSuccess();}
      catch(error){if(!stopped&&options.onError)options.onError(error);}
      finally{if(!stopped)timer=schedule(tick,Math.max(100,1000-(now()-started)));}
    };
    tick();
    return()=>{stopped=true;if(timer!==null)cancel(timer);};
  }
  // The direct regional endpoint avoids the US -> Europe proxy hop. Only
  // receipt-backed actions may fall back, using the exact same request ID.
  function actionTransport(primary, fallback, now = Date.now) {
    let retryPrimaryAt = 0;
    return async data => {
      if (!data?.requestId || now() < retryPrimaryAt) return fallback(data);
      try { return await primary(data); }
      catch (error) {
        if (!['functions/unavailable','functions/deadline-exceeded','functions/internal'].includes(error?.code)) throw error;
        retryPrimaryAt = now() + 30000;
        return fallback(data);
      }
    };
  }
  // Diagnostic samples contain durations only, never identities, cards,
  // amounts, tokens or command payloads. Keep a bounded buffer in memory.
  function createTimings(now = () => root.performance?.now?.() ?? Date.now()) {
    const samples = [];
    const add = (stage, ms) => {
      if (!Number.isFinite(ms) || ms < 0) return;
      samples.push({stage, ms:Math.round(ms)});
      if (samples.length > 300) samples.shift();
    };
    return {
      now, add,
      async measure(name, run) {
        const start = now();
        try {
          const value = await run();
          const elapsed = now() - start;
          add(name + ':round-trip', elapsed);
          if (Number.isFinite(value?.timing?.serverMs)) {
            add(name + ':server', value.timing.serverMs);
            add(name + ':transport-and-platform', Math.max(0, elapsed - value.timing.serverMs));
          }
          return value;
        } catch (error) { add(name + ':failed', now() - start); throw error; }
      },
      summary() {
        const groups = {};
        samples.forEach(({stage,ms}) => (groups[stage] ||= []).push(ms));
        return Object.entries(groups).map(([stage, values]) => {
          values.sort((a,b) => a-b);
          return {stage,count:values.length,medianMs:values[Math.floor((values.length-1)*.5)],p95Ms:values[Math.ceil(values.length*.95)-1]};
        });
      },
      reset() { samples.length = 0; }
    };
  }
  // Firestore error callbacks terminate that listener. Re-open transient
  // failures, and renew read subscriptions after a sleeping tab comes back.
  // This deliberately never retries a game action or financial command.
  function watchSnapshot(subscribe, next, onError, options = {}) {
    const schedule = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const page = options.document || root.document, events = options.events || root;
    let stopped = false, generation = 0, unsubscribe = null, timer = null, failures = 0, terminal = false;
    const clear = () => { if (timer !== null) cancel(timer); timer = null; };
    const connect = () => {
      if (stopped) return;
      clear();
      const current = ++generation;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      const fail = error => {
        if (stopped || current !== generation) return;
        terminal = /(?:^|\/)(permission-denied|unauthenticated|invalid-argument)$/.test(error?.code || '');
        onError?.(error);
        if (!terminal) { clear(); timer = schedule(connect, Math.min(15000, 1000 * 2 ** Math.min(failures++, 4))); }
      };
      try {
        unsubscribe = subscribe(value => {
          if (stopped || current !== generation) return;
          if (!value.metadata?.fromCache) failures = 0;
          next(value);
        }, fail);
      } catch (error) { fail(error); }
    };
    const resume = () => {
      if (stopped || terminal || page?.visibilityState === 'hidden') return;
      // Coalesce online + visibility events from the same wake-up.
      clear(); timer = schedule(connect, 100);
    };
    page?.addEventListener?.('visibilitychange', resume);
    events?.addEventListener?.('online', resume);
    connect();
    return () => {
      stopped = true; generation++; clear(); unsubscribe?.();
      page?.removeEventListener?.('visibilitychange', resume);
      events?.removeEventListener?.('online', resume);
    };
  }
  // Firestore listeners normally provide live state. This read-only fallback is
  // for verified observers whose club membership cannot authorize a listener.
  function watchGodTables({clubId,tableId,allowed,call,onTables,onError}) {
    let stopped=false,timer,busy=false;
    const visible=()=>root.document?.visibilityState!=='hidden';
    async function refresh(){
      if(stopped || busy || !allowed() || !visible()) return;
      busy=true;
      try{
        let cursor=null;
        const rows=[];
        do {
          const page=await call('godLobbyCounts',{mode:'watch',clubId,...(tableId?{tableId}:{}),...(cursor?{cursor}:{})});
          if(stopped || !allowed()) return;
          rows.push(...page.rows);
          cursor=page.cursor;
        } while(cursor);
        onTables(rows);
      }catch(error){
        if(!stopped) onError(error);
        if(/permission-denied|unauthenticated/.test(error?.code||'')) stopped=true;
      }finally{
        busy=false;
        if(!stopped && allowed()) timer=setTimeout(refresh,tableId?1800:6000);
      }
    }
    const wake=()=>{clearTimeout(timer);refresh();};
    root.document?.addEventListener('visibilitychange',wake);
    refresh();
    return ()=>{stopped=true;clearTimeout(timer);root.document?.removeEventListener('visibilitychange',wake);};
  }
  const api = { resultTimeline, createResultPresentation, actionTransport, createTimings, timings:createTimings(), watchGodTables, godCardContext, handDisplayOrder, createPlayerCopies, deckFour, visibleStack, acceptTableUpdate, createWorkerClient, spinTickTimes, startTickLoop, watchSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis);
