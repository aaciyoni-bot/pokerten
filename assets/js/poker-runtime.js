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
  function deckFour(storage) {
    try { return storage.getItem('pkDeck4') === '1'; } catch (_) { return false; }
  }
  function visibleStack(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
              worker = new WorkerType('assets/js/poker-equity-worker.js?v=258');
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
  const api = { handDisplayOrder, createPlayerCopies, deckFour, visibleStack, createWorkerClient, spinTickTimes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis);
