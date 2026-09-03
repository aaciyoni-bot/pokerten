/* PokerTen — bot brain v2 (SHARED MODULE)
 *
 * This exact text lives in TWO places and must stay byte-identical:
 *   • functions/botBrain.js               — required by the server engine (pokerEngine.js)
 *   • index.html  <script id="bot-brain"> — used by the client engine (botPokerMove)
 * predeploy-check.js fails the build if the two copies drift.
 *
 * The bot plays from PUBLIC information only: its own hole cards, the board,
 * every visible action this hand (gameState.acts) and the table's hand history
 * (showdowns are public). It never reads another player's live cards or the deck.
 *
 * What it does that the old policy didn't:
 *   1. Range-aware equity — opponents' sampled hands are filtered by what they
 *      DID: a pot-sized bet on the flop means a hand that connected with THAT
 *      flop; a preflop raise means a top-X% starting hand. The old bot measured
 *      equity vs. random cards, so a human who only bet strong hands got paid off
 *      every time (calling station).
 *   2. Opponent model from the table history: VPIP / PFR / aggression /
 *      fold-to-bet / showdown bluff rate, shrunk toward a sensible prior. Stations
 *      get value-bet thinner and bluffed less; nits get bluffed more.
 *   3. Hand-strength percentile on the current board (not raw equity) for sizing,
 *      thin value, semi-bluffs, c-bets, probes, check-raises.
 *   4. Position-aware preflop ranges (Chen score percentile), 3-bet/4-bet logic,
 *      set-mining, push/fold when short (Spin & Cash, tournaments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerBotBrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = 2;

  function create(env) {
    var evaluate5Cards = env.evaluate5Cards;
    var getCombinations = env.getCombinations;
    var bestScoreFull = env.bestScoreFull;
    var HOLE_ORD = env.HOLE_ORD;
    var SUITS = env.SUITS;
    var CARD_VALUES = env.CARD_VALUES;
    var rnd = env.rnd || Math.random;
    var nowMs = env.now || function () { return Date.now(); };
    var BUDGET_MS = env.budgetMs || 320;
    var round2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
    var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
    var isOmaha = function (gt) { return String(gt || '').indexOf('Omaha') === 0; };
    var AGG = { Raise: 1, 'All-in': 1 };

    /* ───────────── cards ───────────── */
    var FULL = [];
    for (var si = 0; si < SUITS.length; si++) for (var vi = 0; vi < CARD_VALUES.length; vi++) FULL.push({ id: CARD_VALUES[vi] + SUITS[si], val: CARD_VALUES[vi], suit: SUITS[si] });
    var without = function (known) {
      var ids = {};
      for (var i = 0; i < known.length; i++) if (known[i]) ids[known[i].id] = 1;
      var out = [];
      for (var j = 0; j < FULL.length; j++) if (!ids[FULL[j].id]) out.push(FULL[j]);
      return out;
    };
    var rankOf = function (c) { return HOLE_ORD[c.val] || 0; };
    // Best score with the CURRENT board (3-5 cards). 0 before the flop.
    var scoreNow = function (hole, board, gt) {
      if (!board || board.length < 3) return 0;
      var best = 0, i, s;
      if (isOmaha(gt)) {
        var hc = getCombinations(hole, 2), bc = getCombinations(board, 3);
        for (i = 0; i < hc.length; i++) for (var k = 0; k < bc.length; k++) {
          s = evaluate5Cards(hc[i].concat(bc[k]));
          if (s > best) best = s;
        }
        return best;
      }
      var all = hole.concat(board);
      if (all.length === 5) return evaluate5Cards(all);
      var cs = getCombinations(all, 5);
      for (i = 0; i < cs.length; i++) { s = evaluate5Cards(cs[i]); if (s > best) best = s; }
      return best;
    };
    // k distinct random cards from deck (partial Fisher-Yates on a copy of indices)
    var pick = function (deck, k) {
      var n = deck.length, out = [], used = {};
      if (k >= n) return deck.slice();
      while (out.length < k) {
        var i = Math.floor(rnd() * n);
        if (used[i]) continue;
        used[i] = 1;
        out.push(deck[i]);
      }
      return out;
    };

    /* ───────────── preflop hand value ───────────── */
    // Chen formula for two cards → then mapped to a percentile over all 1326 combos.
    var chenScore = function (cards) {
      var a = rankOf(cards[0]), b = rankOf(cards[1]);
      var hi = Math.max(a, b), lo = Math.min(a, b);
      var pts = function (x) { return x === 14 ? 10 : x === 13 ? 8 : x === 12 ? 7 : x === 11 ? 6 : x / 2; };
      var s = pts(hi);
      if (hi === lo) return Math.max(5, s * 2);
      if (cards[0].suit === cards[1].suit) s += 2;
      var gap = hi - lo - 1;
      s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && hi < 12) s += 1;
      return s;
    };
    var CHEN_SORTED = null;
    var chenPct = function (cards) {
      if (!CHEN_SORTED) {
        CHEN_SORTED = [];
        for (var i = 0; i < FULL.length; i++) for (var j = i + 1; j < FULL.length; j++) CHEN_SORTED.push(chenScore([FULL[i], FULL[j]]));
        CHEN_SORTED.sort(function (x, y) { return x - y; });
      }
      var s = chenScore(cards), lo = 0, hi = CHEN_SORTED.length;
      while (lo < hi) { var m = (lo + hi) >> 1; if (CHEN_SORTED[m] < s) lo = m + 1; else hi = m; }
      var lo2 = lo, hi2 = CHEN_SORTED.length;
      while (lo2 < hi2) { var m2 = (lo2 + hi2) >> 1; if (CHEN_SORTED[m2] <= s) lo2 = m2 + 1; else hi2 = m2; }
      return (lo + (lo2 - lo) / 2) / CHEN_SORTED.length; // 0 = worst, 1 = best
    };
    // 3+ hole cards (Pineapple / Omaha): heuristic percentile.
    var multiPct = function (cards) {
      if (cards.length === 3) {
        var best = 0, cs = getCombinations(cards, 2);
        for (var i = 0; i < cs.length; i++) best = Math.max(best, chenPct(cs[i]));
        return clamp(best + 0.03, 0, 1);
      }
      var s = 0, counts = {}, suits = {}, ranks = [];
      cards.forEach(function (c) { var r = rankOf(c); ranks.push(r); counts[r] = (counts[r] || 0) + 1; suits[c.suit] = (suits[c.suit] || 0) + 1; });
      Object.keys(counts).forEach(function (r) { if (counts[r] === 2) s += (r / 14) * 3; if (counts[r] >= 3) s -= 1.5; });
      var suited2 = 0; Object.keys(suits).forEach(function (k) { if (suits[k] >= 2) suited2++; });
      s += suited2 >= 2 ? 2.5 : suited2 === 1 ? 1.2 : 0;
      ranks.sort(function (a, b) { return a - b; });
      var conn = 0;
      for (var x = 0; x < ranks.length; x++) for (var y = x + 1; y < ranks.length; y++) if (ranks[y] - ranks[x] >= 1 && ranks[y] - ranks[x] <= 2) conn++;
      s += Math.min(4, conn) * 0.6;
      s += ranks.filter(function (r) { return r >= 11; }).length * 0.5;
      return clamp(s / 9.5, 0.02, 0.98);
    };
    var preflopPct = function (cards) { return cards.length === 2 ? chenPct(cards) : multiPct(cards); };

    /* ───────────── hand-strength percentile on a board ───────────── */
    var tableCache = {};
    var tableCacheN = 0;
    // Sorted scores of possible opponent holdings on `board` (excluding `dead`).
    var hsTable = function (board, holeN, dead, gt) {
      var key = board.map(function (c) { return c.id; }).join('') + '|' + holeN + '|' + dead.map(function (c) { return c.id; }).join('');
      if (tableCache[key]) return tableCache[key];
      var deck = without(dead.concat(board)), scores = [], i;
      if (holeN === 2 && deck.length <= 47) {
        var target = board.length >= 5 ? 420 : board.length === 4 ? 560 : 1100; // sample the river (21 evals/holding)
        var all = deck.length * (deck.length - 1) / 2;
        if (all <= target) {
          for (i = 0; i < deck.length; i++) for (var j = i + 1; j < deck.length; j++) scores.push(scoreNow([deck[i], deck[j]], board, gt));
        } else {
          for (i = 0; i < target; i++) { var h = pick(deck, 2); scores.push(scoreNow(h, board, gt)); }
        }
      } else {
        for (i = 0; i < 300; i++) scores.push(scoreNow(pick(deck, holeN), board, gt));
      }
      scores.sort(function (a, b) { return a - b; });
      if (++tableCacheN > 40) { tableCache = {}; tableCacheN = 0; }
      tableCache[key] = scores;
      return scores;
    };
    var pctIn = function (score, sorted) {
      var lo = 0, hi = sorted.length;
      while (lo < hi) { var m = (lo + hi) >> 1; if (sorted[m] < score) lo = m + 1; else hi = m; }
      var lo2 = lo, hi2 = sorted.length;
      while (lo2 < hi2) { var m2 = (lo2 + hi2) >> 1; if (sorted[m2] <= score) lo2 = m2 + 1; else hi2 = m2; }
      return sorted.length ? (lo + (lo2 - lo) / 2) / sorted.length : 0.5;
    };

    /* ───────────── draws & texture ───────────── */
    var drawInfo = function (hole, board, gt) {
      var out = { outs: 0, flush: false, straight: 0 };
      if (!board || board.length < 3 || board.length >= 5) return out;
      var omaha = isOmaha(gt);
      var all = hole.concat(board);
      var suitCount = {}, holeSuit = {};
      all.forEach(function (c) { suitCount[c.suit] = (suitCount[c.suit] || 0) + 1; });
      hole.forEach(function (c) { holeSuit[c.suit] = (holeSuit[c.suit] || 0) + 1; });
      Object.keys(suitCount).forEach(function (s) {
        var need = omaha ? 2 : 1;
        if (suitCount[s] === 4 && (holeSuit[s] || 0) >= need && (!omaha || (suitCount[s] - holeSuit[s]) >= 2)) { out.flush = true; out.outs += 9; }
      });
      // straight outs: a rank that completes a straight using ≥1 hole card
      var have = {}; all.forEach(function (c) { have[rankOf(c)] = 1; });
      var holeR = {}; hole.forEach(function (c) { holeR[rankOf(c)] = 1; });
      var cur = scoreNow(hole, board, gt);
      var sOuts = 0;
      for (var r = 2; r <= 14; r++) {
        if (have[r]) continue;
        var test = board.concat([{ id: 'x' + r, val: CARD_VALUES[r - 2], suit: '?' }]);
        var s = scoreNow(hole, test, gt);
        if (s >= 4000000 && s < 5000000 && cur < 4000000) sOuts += 4;
      }
      out.straight = Math.min(8, sOuts);
      out.outs += out.straight;
      if (out.flush && out.straight) out.outs -= 2;
      return out;
    };
    var texture = function (board) {
      var t = { wet: 0.2, flush3: false, paired: false, high: 0 };
      if (!board || board.length < 3) return t;
      var suits = {}, ranks = [];
      board.forEach(function (c) { suits[c.suit] = (suits[c.suit] || 0) + 1; ranks.push(rankOf(c)); });
      var maxS = 0; Object.keys(suits).forEach(function (k) { maxS = Math.max(maxS, suits[k]); });
      t.flush3 = maxS >= 3;
      var uniq = {}; ranks.forEach(function (r) { uniq[r] = (uniq[r] || 0) + 1; });
      t.paired = Object.keys(uniq).some(function (k) { return uniq[k] >= 2; });
      ranks.sort(function (a, b) { return a - b; });
      var conn = 0;
      for (var i = 0; i < ranks.length; i++) for (var j = i + 1; j < ranks.length; j++) if (ranks[j] - ranks[i] > 0 && ranks[j] - ranks[i] <= 4) conn++;
      t.high = ranks.filter(function (r) { return r >= 10; }).length;
      t.wet = clamp(0.1 + (maxS >= 3 ? 0.45 : maxS === 2 ? 0.2 : 0) + conn * 0.08, 0, 1);
      return t;
    };

    /* ───────────── opponent model ───────────── */
    var PRIOR = { vpip: 0.55, pfr: 0.2, agg: 0.45, ftb: 0.45, ftr: 0.55, bluff: 0.2, wtsd: 0.35 };
    var OPP_COUNTS = {}; // uid -> tableKey -> counts (merged across tables the same process has driven)
    var profMemo = {};
    var actsOf = function (h, uid, name) {
      return (h.acts || []).filter(function (a) { return a.u ? a.u === uid : a.n === name; });
    };
    var countsFrom = function (history, uid, name) {
      var c = { n: 0, vpip: 0, pfr: 0, aggN: 0, callN: 0, faced: 0, fold: 0, facedPre: 0, foldPre: 0, sawFlop: 0, wtsd: 0, sdAgg: 0, sdBluff: 0 };
      var hs = history.slice(-100);
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        var me = (h.ps || []).filter(function (p) { return p.u ? p.u === uid : p.n === name; })[0];
        if (!me) continue;
        c.n++;
        var acts = actsOf(h, uid, name);
        var bb = Number(h.bb) || 0;
        var pre = acts.filter(function (a) { return a.ph === 'preflop'; });
        var post = acts.filter(function (a) { return a.ph !== 'preflop'; });
        if (pre.some(function (a) { return AGG[a.a]; })) c.pfr++;
        if (pre.some(function (a) { return AGG[a.a] || (a.a === 'Call' && (a.tc == null || a.tc > 0)); })) c.vpip++;
        pre.forEach(function (a) { if (a.tc != null && bb && a.tc > bb * 1.5) { c.facedPre++; if (a.a === 'Fold') c.foldPre++; } });
        if ((h.board || []).length >= 3 && (post.length || !me.f)) c.sawFlop++;
        post.forEach(function (a) {
          if (AGG[a.a]) c.aggN++; else if (a.a === 'Call') c.callN++;
          if (a.tc > 0) { c.faced++; if (a.a === 'Fold') c.fold++; }
        });
        if (me.c && me.c.length && !me.f && (h.board || []).length === 5) {
          c.wtsd++;
          var riverAgg = post.some(function (a) { return (a.ph === 'river' || a.ph === 'turn') && AGG[a.a]; });
          if (riverAgg) {
            c.sdAgg++;
            var sc = scoreNow(me.c, h.board, h.game);
            var weak = sc < 1000000;
            if (!weak && sc < 2000000) {
              var pairRank = Math.floor((sc - 1000000) / 10000);
              var top = 0; h.board.forEach(function (x) { top = Math.max(top, rankOf(x)); });
              weak = pairRank < top;
            }
            if (weak) c.sdBluff++;
          }
        }
      }
      return c;
    };
    var mergeCounts = function (list) {
      var m = {};
      list.forEach(function (c) { Object.keys(c).forEach(function (k) { m[k] = (m[k] || 0) + c[k]; }); });
      return m;
    };
    var profile = function (ctx, uid, name) {
      var hist = ctx.history || [];
      var tk = ctx.tableId || 'x';
      var key = tk + '|' + uid + '|' + hist.length;
      if (profMemo[key]) return profMemo[key];
      var c = countsFrom(hist, uid, name);
      if (!OPP_COUNTS[uid]) OPP_COUNTS[uid] = {};
      OPP_COUNTS[uid][tk] = c;
      var all = mergeCounts(Object.keys(OPP_COUNTS[uid]).map(function (k) { return OPP_COUNTS[uid][k]; }));
      var sh = function (num, den, prior, n0) { return (num + prior * n0) / (den + n0); };
      var p = {
        n: all.n,
        vpip: sh(all.vpip, all.n, PRIOR.vpip, 8),
        pfr: sh(all.pfr, all.n, PRIOR.pfr, 8),
        agg: sh(all.aggN, all.aggN + all.callN, PRIOR.agg, 6),
        ftb: sh(all.fold, all.faced, PRIOR.ftb, 6),
        ftr: sh(all.foldPre, all.facedPre, PRIOR.ftr, 5),
        wtsd: sh(all.wtsd, all.sawFlop, PRIOR.wtsd, 5),
        bluff: sh(all.sdBluff, all.sdAgg, PRIOR.bluff, 4)
      };
      if (Object.keys(profMemo).length > 200) profMemo = {};
      profMemo[key] = p;
      return p;
    };

    /* ───────────── range constraints from this hand's actions ───────────── */
    var boardAt = function (board, ph) {
      if (ph === 'preflop') return [];
      if (ph === 'flop') return board.slice(0, 3);
      if (ph === 'turn') return board.slice(0, 4);
      return board.slice(0, 5);
    };
    // Returns a weight function hand -> [0,1] for an opponent, from their visible actions.
    var rangeFilter = function (ctx, opp, prof, holeN, tables) {
      var acts = (ctx.g.acts || []).filter(function (a) { return a.u === opp.uid; });
      var board = ctx.g.board || [];
      var bb = ctx.bb;
      var cons = [];
      acts.forEach(function (a) {
        if (a.a === 'Fold') return;
        if (a.ph === 'preflop') {
          if (AGG[a.a]) {
            var open = a.tc == null || a.tc <= bb * 1.01;
            var w = open ? clamp(prof.pfr * 1.2, 0.08, 0.55) : clamp(prof.pfr * 0.4, 0.035, 0.2);
            cons.push({ kind: 'pre', min: 1 - w, soft: open ? 0.1 : 0.12 });
          } else if (a.a === 'Call' && a.tc > bb * 1.01) {
            var big = a.tc > bb * 4;
            cons.push({ kind: 'pre', min: big ? 0.75 : 1 - clamp(prof.vpip, 0.25, 0.85), soft: big ? 0.15 : 0.15, capTop: 0.96, capW: 0.35 });
          } else if (a.a === 'Call' || a.a === 'Check') {
            cons.push({ kind: 'pre', min: 0, soft: 1, capTop: 0.95, capW: 0.4 });
          }
          return;
        }
        var b = boardAt(board, a.ph);
        if (b.length < 3) return;
        var river = a.ph === 'river';
        if (AGG[a.a]) {
          var f = (Number(a.to) || 0) / Math.max(Number(a.pot) || 0, bb * 2);
          var minHS = 0.42 + 0.28 * clamp(f, 0, 1.2) - (prof.agg - 0.45) * 0.45 - prof.bluff * 0.3;
          cons.push({ kind: 'post', board: b, ph: a.ph, min: clamp(minHS, 0.3, 0.85), drawW: river ? 0 : clamp(0.5 + prof.agg * 0.3, 0.3, 0.8), airW: river && prof.agg < 0.35 ? 0.04 : clamp(0.06 + prof.agg * 0.25 + prof.bluff * 0.4, 0.05, 0.35) });
        } else if (a.a === 'Call' && a.tc > 0) {
          cons.push({ kind: 'post', board: b, ph: a.ph, min: 0.25, drawW: river ? 0 : 0.8, airW: clamp(0.15 + (1 - prof.ftb) * 0.5, 0.1, 0.6), capTop: 0.93, capW: 0.6 });
        } else if (a.a === 'Check') {
          cons.push({ kind: 'post', board: b, ph: a.ph, min: 0, drawW: 1, airW: 1, capTop: river ? 0.75 : 0.9, capW: river ? 0.6 : prof.agg > 0.55 ? 0.85 : 0.7 });
        }
      });
      if (!cons.length) return null;
      cons.forEach(function (c) { if (c.kind === 'post') c.table = tables(c.board); });
      return function (hand) {
        var w = 1;
        for (var i = 0; i < cons.length && w > 0.001; i++) {
          var c = cons[i];
          if (c.kind === 'pre') {
            var p = preflopPct(hand);
            if (c.capTop != null && p >= c.capTop) w *= c.capW;
            else if (p < c.min) w *= c.soft;
          } else {
            var hs = pctIn(scoreNow(hand, c.board, ctx.gameType), c.table);
            if (c.capTop != null && hs >= c.capTop) w *= c.capW;
            else if (hs >= c.min) w *= 1;
            else {
              var d = c.drawW > 0 ? drawInfo(hand, c.board, ctx.gameType) : { outs: 0 };
              if (d.outs >= 8) w *= c.drawW;
              else if (d.outs >= 4) w *= Math.max(c.airW, c.drawW * 0.45);
              else w *= c.airW;
            }
          }
        }
        return w;
      };
    };

    /* ───────────── range-aware equity ───────────── */
    var rangeEquity = function (ctx, myCards, board, opps, deadline) {
      var gt = ctx.gameType, holeN = myCards.length;
      var omaha = isOmaha(gt);
      var iters = omaha ? 90 : 240;
      var maxTries = iters * 8;
      var deck = without(myCards.concat(board));
      var need = holeN * opps.length + (5 - board.length);
      var acc = 0, score = 0, tries = 0, t0 = nowMs();
      while (acc < iters && tries < maxTries) {
        tries++;
        if ((tries & 15) === 0 && acc >= 40 && nowMs() - t0 > deadline) break;
        var cards = pick(deck, need);
        var ok = true, hands = [], pos = 0, j;
        for (j = 0; j < opps.length; j++) {
          var h = cards.slice(pos, pos + holeN); pos += holeN;
          var w = opps[j].filter ? opps[j].filter(h) : 1;
          if (w < 1 && rnd() >= w) { ok = false; break; }
          hands.push(h);
        }
        if (!ok) continue;
        var fb = board.concat(cards.slice(pos));
        var my = bestScoreFull(myCards, fb, gt), lose = false, tie = false;
        for (j = 0; j < hands.length; j++) {
          var s = bestScoreFull(hands[j], fb, gt);
          if (s > my) { lose = true; break; }
          if (s === my) tie = true;
        }
        acc++;
        if (!lose) score += tie ? 0.5 : 1;
      }
      if (acc < 25) { // filters too strict for the time we had — fall back to unweighted samples
        var plain = opps.map(function () { return {}; });
        for (var k = 0; k < 60; k++) {
          var c2 = pick(deck, need), p2 = 0, h2 = [], q;
          for (q = 0; q < plain.length; q++) { h2.push(c2.slice(p2, p2 + holeN)); p2 += holeN; }
          var fb2 = board.concat(c2.slice(p2));
          var my2 = bestScoreFull(myCards, fb2, gt), lose2 = false, tie2 = false;
          for (q = 0; q < h2.length; q++) { var s2 = bestScoreFull(h2[q], fb2, gt); if (s2 > my2) { lose2 = true; break; } if (s2 === my2) tie2 = true; }
          acc++; if (!lose2) score += tie2 ? 0.5 : 1;
        }
      }
      return acc ? score / acc : 0.5;
    };

    /* ───────────── table geometry ───────────── */
    var dealtIn = function (p) { return ((p.cards || []).length > 0) || (Number(p.cardCount) || 0) > 0; };
    var positions = function (ctx) {
      var pl = ctx.players, g = ctx.g;
      var dealt = Object.keys(pl).map(function (k) { return pl[k]; }).filter(dealtIn).sort(function (a, b) { return a.seatIndex - b.seatIndex; });
      var n = dealt.length;
      var dIdx = Math.max(0, dealt.findIndex(function (p) { return p.uid === g.dealerUid; }));
      var rel = {};
      dealt.forEach(function (p, i) { rel[p.uid] = (i - dIdx + n) % n; }); // 0=BTN 1=SB 2=BB 3=UTG…
      var late = function (uid) {
        var r = rel[uid];
        if (n === 2) return r === 0 ? 1 : 0.5;
        if (r === 0) return 1;
        if (r === 1) return 0.3;
        if (r === 2) return 0.45;
        var first = 3, last = n - 1;
        return last === first ? 0.6 : 0.35 + 0.5 * ((r - first) / (last - first));
      };
      var postKey = function (uid) { var r = rel[uid]; return r === 0 ? n + 1 : r; };
      return { n: n, rel: rel, late: late, postKey: postKey, dealt: dealt };
    };

    /* ───────────── the decision ───────────── */
    function decide(ctx) {
      var g = ctx.g, pl = ctx.players, me = ctx.me, myCards = ctx.cards || [];
      var bb = Number(ctx.bb) || 1;
      var gt = ctx.gameType || 'NLH';
      var t0 = nowMs();
      var stack = Number(me.stack) || 0, myBet = Number(me.bet) || 0;
      var highest = Number(g.highestBet) || 0;
      var toCall = round2(Math.max(0, highest - myBet));
      var pot = round2((g.pots || []).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0) + Object.keys(pl).reduce(function (s, k) { return s + (Number(pl[k].bet) || 0); }, 0));
      var actives = Object.keys(pl).map(function (k) { return pl[k]; }).filter(function (p) { return p.status === 'active' && p.uid !== me.uid; });
      var nOpp = Math.max(1, actives.length);
      var r = rnd();
      var snap = function (x) { return Math.max(bb, Math.round(x / bb) * bb); };
      var raiseTo = function (x) {
        var min = round2(highest + (Number(g.minRaise) || bb));
        var max = round2(stack + myBet);
        var v = round2(Math.min(Math.max(snap(x), min), max));
        if (v >= max * 0.72) v = max; // near-jam → jam (no silly 0.9-stack raises)
        return v;
      };
      var jam = function () { return { type: 'raise', amt: round2(stack + myBet) }; };
      var CALL = { type: 'call' }, FOLD = { type: 'fold' };
      if (!myCards.length) return toCall > 0 ? FOLD : CALL;
      if (toCall > 0 && stack <= bb * 1.5) return CALL; // crumbs: never fold the last blind
      var posi = positions(ctx);
      var late = posi.late(me.uid);
      var myKey = posi.postKey(me.uid);
      var inPos = actives.every(function (p) { return posi.postKey(p.uid) < myKey; });
      var acts = g.acts || [];
      var street = g.phase;
      var preActs = acts.filter(function (a) { return a.ph === 'preflop'; });
      var lastRaiser = null;
      acts.forEach(function (a) { if (AGG[a.a]) lastRaiser = a; });
      var streetActs = acts.filter(function (a) { return a.ph === street; });
      var aggressorNow = null;
      streetActs.forEach(function (a) { if (AGG[a.a] && a.u !== me.uid) aggressorNow = a.u; });
      var humans = actives.filter(function (p) { return !p.isBot; });
      var mainOppUid = aggressorNow || (humans.length ? humans.sort(function (a, b) { return (b.stack || 0) - (a.stack || 0); })[0].uid : (actives[0] || {}).uid);
      var mainOpp = pl[mainOppUid] || {};
      var prof = profile(ctx, mainOppUid, mainOpp.name);
      var mw = Math.max(0, nOpp - 1) * 0.05;
      var effStack = Math.min(stack, actives.reduce(function (m, p) { return Math.max(m, (Number(p.stack) || 0) + (Number(p.bet) || 0)); }, 0)) || stack;
      var effBB = effStack / bb;
      var spinLike = !!(ctx.spin || ctx.tournament);

      /* ── preflop ── */
      if (street === 'preflop') {
        var pct = preflopPct(myCards);
        var pair2 = myCards.length === 2 && myCards[0].val === myCards[1].val;
        var chen = myCards.length === 2 ? chenScore(myCards) : pct * 20;
        var raises = preActs.filter(function (a) { return AGG[a.a]; });
        var limpers = preActs.filter(function (a) { return a.a === 'Call' && a.u !== me.uid; }).length;
        var callersAfterRaise = 0;
        if (raises.length) {
          var lastIdx = preActs.lastIndexOf(raises[raises.length - 1]);
          callersAfterRaise = preActs.slice(lastIdx + 1).filter(function (a) { return a.a === 'Call'; }).length;
        }
        var iRaised = raises.some(function (a) { return a.u === me.uid; });
        var rp = raises.length ? profile(ctx, raises[raises.length - 1].u, (pl[raises[raises.length - 1].u] || {}).name) : prof;
        var short = effBB <= (spinLike ? 14 : 11);
        var tcBB = toCall / bb;
        var openSize = function () {
          var base = posi.n === 2 ? 2.2 + r * 0.9 : 2.5 + r * 0.5;
          return raiseTo(bb * (base + limpers));
        };
        // ── short stacks: push / fold ──
        if (short) {
          if (toCall <= 0 || (raises.length === 0 && toCall <= bb)) {
            var pushT = 0.84 - late * 0.3 - Math.max(0, 12 - effBB) * 0.02 - (posi.n === 2 ? 0.08 : 0);
            if (limpers) pushT += 0.05;
            return pct >= clamp(pushT, 0.25, 0.9) ? jam() : (toCall > 0 ? (pct >= 0.4 ? CALL : FOLD) : CALL);
          }
          var facingJam = toCall >= effStack * 0.6 || tcBB >= effBB * 0.6;
          if (facingJam) {
            var callW = effBB <= 6 ? 0.4 : effBB <= 9 ? 0.3 : 0.2;
            if (posi.n === 2 || nOpp === 1) callW += 0.08;
            if (callersAfterRaise > 0 || raises.length > 1) callW *= 0.55;
            callW += (rp.pfr - 0.2) * 0.3;
            return pct >= 1 - clamp(callW, 0.06, 0.6) ? CALL : FOLD;
          }
          // facing a normal raise while short: jam or fold
          var jamT = 0.86 - late * 0.12 + (rp.pfr < 0.15 ? 0.06 : 0) - (rp.pfr > 0.3 ? 0.08 : 0);
          if (pct >= clamp(jamT, 0.5, 0.95)) return jam();
          return pair2 && toCall <= bb * 3 && effBB >= 8 ? CALL : FOLD;
        }
        // ── unopened / limped ──
        if (raises.length === 0) {
          var isBB = posi.rel[me.uid] === 2 || (posi.n === 2 && posi.rel[me.uid] === 1);
          if (toCall <= 0 && isBB) { // option in the BB
            var isoT = limpers ? 0.66 : 0.72;
            return pct >= isoT && r < 0.7 ? { type: 'raise', amt: raiseTo(bb * (3.5 + limpers)) } : CALL;
          }
          var openT = posi.n === 2 ? 0.3 : 0.86 - 0.32 * late;
          if (posi.n === 3) openT -= 0.08; else if (posi.n === 4) openT -= 0.05;
          if (posi.rel[me.uid] === 1 && posi.n > 2) openT = 0.62;
          openT -= (prof.ftr - 0.55) * 0.3;
          if (limpers) openT += 0.06 - late * 0.06;
          if (pct >= clamp(openT, 0.2, 0.9)) return { type: 'raise', amt: openSize() };
          // over-limp behind limpers in position with playable hands; SB completes cheap
          if (limpers && late >= 0.8 && pct >= 0.42) return CALL;
          if (toCall > 0 && toCall <= bb * 0.6 && pct >= 0.3) return CALL;
          return toCall > 0 ? FOLD : CALL;
        }
        // ── facing a raise (not short) ──
        if (!iRaised && raises.length === 1) {
          var big = tcBB > 5;
          var v3 = rp.pfr > 0.3 ? 0.93 : 0.955;
          if (pct >= v3) {
            if (toCall >= stack * 0.4) return jam();
            return { type: 'raise', amt: raiseTo(highest * (inPos ? 3 : 3.6) * (0.92 + r * 0.16)) };
          }
          var bluff3 = clamp(0.08 + (rp.ftr - 0.5) * 0.6, 0.04, 0.35) * (inPos ? 1.3 : 0.9);
          if (!big && callersAfterRaise === 0 && pct >= 0.72 && pct < 0.86 && (myCards.length !== 2 || myCards[0].suit === myCards[1].suit || pair2) && r < bluff3) {
            return { type: 'raise', amt: raiseTo(highest * (inPos ? 3 : 3.6)) };
          }
          if (pair2 && toCall <= Math.min(stack * 0.12, bb * 10)) return CALL; // set-mine
          // Defend tighter out of position: the BB discount is real, but a call vs.
          // a tight opener that then folds to every c-bet is the classic leak.
          var inBlind = posi.rel[me.uid] === 2 || (posi.n === 2 && posi.rel[me.uid] === 1);
          var callT = 0.78 - late * 0.15 - (inBlind ? 0.1 : 0) + (tcBB - 2.5) * 0.04 - (rp.pfr - 0.2) * 0.6 - callersAfterRaise * 0.05;
          if (toCall > stack * 0.3) callT = Math.max(callT, 0.9);
          return pct >= clamp(callT, 0.35, 0.88) ? CALL : FOLD;
        }
        // ── facing a 3-bet (or a raise war) ──
        var facingHuge = toCall >= stack * 0.5;
        if (chen >= 16 || (chen >= 12 && rp.pfr > 0.3 && r < 0.6)) return toCall >= stack * 0.35 || facingHuge ? jam() : { type: 'raise', amt: raiseTo(highest * 2.4) };
        if (chen >= 12) return facingHuge ? (r < 0.5 ? CALL : FOLD) : (toCall <= stack * 0.25 ? CALL : FOLD);
        if (chen >= 10) return !facingHuge && (inPos || toCall <= bb * 12) ? CALL : FOLD;
        if (pair2 && chen >= 8 && toCall <= stack * 0.1) return CALL;
        if (rp.pfr > 0.35 && chen >= 9 && toCall <= stack * 0.2 && r < 0.4) return CALL;
        return FOLD;
      }

      /* ── post-flop ── */
      var board = g.board || [];
      var holeN = myCards.length;
      var dead = myCards;
      var tables = function (b) { return hsTable(b, holeN, dead, gt); };
      var tblNow = tables(board);
      var hs = pctIn(scoreNow(myCards, board, gt), tblNow);
      var draws = drawInfo(myCards, board, gt);
      var tex = texture(board);
      var river = street === 'river', flop = street === 'flop', turn = street === 'turn';
      var opps = actives.slice(0, 3).map(function (p) {
        var pr = profile(ctx, p.uid, p.name);
        return { uid: p.uid, filter: rangeFilter(ctx, p, pr, holeN, tables) };
      });
      var eq = rangeEquity(ctx, myCards, board, opps, Math.max(60, BUDGET_MS - (nowMs() - t0)));
      var potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
      var spr = pot > 0 ? stack / pot : 99;
      var prevStreet = flop ? 'preflop' : turn ? 'flop' : 'turn';
      var prevActs = acts.filter(function (a) { return a.ph === prevStreet; });
      var lastPrevAgg = null; prevActs.forEach(function (a) { if (AGG[a.a]) lastPrevAgg = a.u; });
      var iAmAggressor = lastPrevAgg === me.uid;
      var oppCheckedThisStreet = streetActs.some(function (a) { return a.u === mainOppUid && a.a === 'Check'; });
      var oppCheckedPrev = prevActs.some(function (a) { return a.u === mainOppUid && a.a === 'Check'; }) && !prevActs.some(function (a) { return a.u === mainOppUid && AGG[a.a]; });
      var oppWasPreRaiser = lastRaiser && lastRaiser.ph === 'preflop' && lastRaiser.u === mainOppUid;
      var station = prof.ftb < 0.35, nit = prof.ftb > 0.55, maniac = prof.agg > 0.6;
      // Bluff frequency is EARNED from the opponent's measured fold rate: a bluff
      // of size s (× pot) is +EV when they fold more than s/(1+s). Confidence
      // grows with the hands we've seen them play; stations get no bluffs at all.
      var conf = clamp(prof.n / 20, 0.3, 1);
      var bluffP = function (sizeFrac, base) {
        var edge = prof.ftb - sizeFrac / (1 + sizeFrac);
        return clamp(base + edge * 2.5 * conf, 0, 0.85);
      };
      var betSize = function (frac) {
        var amt = myBet + toCall + pot * frac;
        if (toCall > 0) amt = highest + Math.max(pot + toCall, highest) * frac; // raise: relative to the pot after calling
        return { type: 'raise', amt: raiseTo(amt) };
      };

      if (toCall > 0) {
        if (toCall >= stack) return eq >= potOdds + 0.02 ? CALL : FOLD;
        // value raise
        if (eq >= 0.72 + mw && (hs >= 0.8 || eq >= 0.82)) {
          var pv = (river ? 0.8 : 0.62) + (station ? 0.15 : 0) - (nit && !river ? 0.1 : 0);
          if (r < pv) return spr < 2.2 ? jam() : betSize(0.85 + r * 0.35);
          return CALL;
        }
        // semi-bluff raise with a big draw vs. folders
        if (!river && draws.outs >= 8 && prof.ftb >= 0.4 && toCall <= pot * 0.8 && spr >= 1.5 && nOpp === 1) {
          var ps = 0.22 + (prof.ftb - 0.4) * 0.6 + (inPos ? 0.08 : 0);
          if (r < ps) return betSize(0.9);
        }
        // pure bluff-raise (rare, only vs. nits, heads-up)
        if ((turn || river) && hs < 0.3 && nit && toCall <= pot * 0.6 && nOpp === 1 && spr >= 2) {
          if (r < 0.05 + (prof.ftb - 0.5) * 0.45) return betSize(1.0);
        }
        var margin = 0.03 + mw + (prof.agg < 0.35 ? 0.06 : 0) - (maniac ? 0.05 : 0) - (prof.bluff > 0.3 ? 0.04 : 0);
        if (river && toCall >= pot * 0.9) margin += 0.05;
        if (eq >= potOdds + margin) return CALL;
        if (!river && draws.outs >= 8 && toCall <= pot * 0.55 && spr >= 2.5 && eq >= potOdds - 0.07) return CALL; // implied odds
        if (pot > 0 && stack <= pot * 0.5 && eq >= potOdds - 0.04) return CALL; // committed
        return FOLD;
      }

      // checked to us / first to act
      if (hs >= 0.93 || eq >= 0.9) {
        if (!river && !inPos && prof.agg >= 0.5 && r < 0.25) return CALL; // trap vs. an aggressive opp
        if (river && station && r < 0.35) return betSize(1.1 + r * 0.4);
        return betSize(0.75 + r * 0.35);
      }
      if (hs >= 0.75 || eq >= 0.72) {
        var pS = river && maniac ? 0.7 : 0.88;
        if (r < pS) return betSize(0.65 + r * 0.3);
        return CALL;
      }
      if (hs >= 0.52) {
        // Medium hands are check-heavy: betting them folds out worse and gets
        // called by better. Bet mostly in position, after a check, or vs. stations.
        var pM = flop ? (iAmAggressor ? (inPos ? 0.55 : 0.35) : (oppCheckedThisStreet && inPos ? 0.5 : 0.2))
          : turn ? (inPos ? 0.35 : 0.2)
            : (station ? 0.6 : inPos && oppCheckedThisStreet ? 0.3 : 0.12);
        pM *= nOpp > 1 ? 0.7 : 1;
        if (r < pM) return betSize(0.45 + r * 0.2);
        return CALL;
      }
      if (!river && draws.outs >= 8) {
        var pD = 0.55 + (iAmAggressor ? 0.15 : 0) - mw;
        if (r < pD) return betSize(0.55 + r * 0.2);
        return CALL;
      }
      if (iAmAggressor && flop && nOpp <= 2) { // continuation bet
        var dry = tex.wet < 0.4;
        var pC = bluffP(dry ? 0.45 : 0.62, dry ? 0.35 : 0.2);
        if (nOpp === 2) pC *= 0.6;
        if (r < pC) return betSize(dry ? 0.35 + r * 0.15 : 0.55 + r * 0.15);
        return CALL;
      }
      if (iAmAggressor && turn && nOpp === 1) { // second barrel
        var iBetFlop = acts.some(function (a) { return a.ph === 'flop' && a.u === me.uid && AGG[a.a]; });
        var scare = rankOf(board[3]) >= 11 || tex.flush3;
        var pB = iBetFlop ? bluffP(0.62, 0.05) + (scare ? 0.12 : 0) : 0.08;
        if (r < pB) return betSize(0.6 + r * 0.15);
        return CALL;
      }
      if (river && nOpp === 1 && hs < 0.35 && !station && (oppCheckedThisStreet || oppCheckedPrev || !iAmAggressor)) {
        var pR = bluffP(0.7, 0.05) * (oppCheckedPrev ? 1.2 : 1);
        if (r < pR) return betSize(0.6 + r * 0.25);
        return CALL;
      }
      if (!iAmAggressor && oppWasPreRaiser && oppCheckedPrev && hs >= 0.35 && nOpp === 1 && !river) { // probe a missed c-bet
        if (r < 0.5) return betSize(0.5);
        return CALL;
      }
      return CALL;
    }

    return { decide: decide, profile: profile, chenPct: chenPct, chenScore: chenScore, preflopPct: preflopPct, VERSION: VERSION };
  }

  return { create: create, VERSION: VERSION };
});
