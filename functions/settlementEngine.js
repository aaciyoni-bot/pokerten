'use strict';
/**
 * POKERTEN settlement engine — pure calculation, no Firebase.
 *
 * All amounts are integer hundredths of a chip. Never truncate chip decimals.
 * result > 0  => the player won.
 * Pair balance > 0  => the counterparty (agent or club) pays the player.
 * Agent balance (toClub) > 0  => the agent pays the club.
 */

const CLUB = 'club';
const pct = (amount, p) => Math.sign(amount) * Math.round((Math.abs(amount) * (p || 0)) / 100);
const pairKey = (agentId, playerId) => JSON.stringify([agentId, playerId]);
const cents = n => { if (!Number.isFinite(n) || !Number.isSafeInteger(Math.round(n * 100))) throw Error('Invalid money'); return Math.round(n * 100); };
const dictionary = () => Object.create(null);

/**
 * @param {object}   input
 * @param {object[]} input.sessions  one per player per table sitting. Each carries the terms
 *                                   that were in force when it was recorded:
 *   { playerId, tableId, tableName, gameType, kind, result, rake, hands,
 *     primaryAgentId|null, agentType 'rake'|'result'|null, agentPct,
 *     secondaryAgentId|null, secondaryPct, rakebackPct }
 * @param {object[]} input.payments  confirmed payments of this cycle:
 *   { type 'player'|'agent', agentId, playerId?, fromId, toId, amount }
 * @param {object}   input.openings  closing balances of the previous cycle:
 *   { pairs: [{agentId, playerId, amount}], agents: [{agentId, amount}] }
 * @param {object}   input.names     { uid: displayName }
 * @param {object}   input.options   { clubPaysRakebackForResultAgents: true }
 */
function computeCycle({ sessions = [], payments = [], openings = {}, names = {}, options = {} }) {
  const clubPaysRb = options.clubPaysRakebackForResultAgents !== false;
  const name = (id) => names[id] || id;

  const pairs = dictionary();
  const agents = dictionary();
  const direct = { playersResult: 0, rake: 0, hands: 0, rakeback: 0 };

  const pair = (agentId, playerId) => {
    const key = pairKey(agentId, playerId);
    if (!pairs[key]) {
      pairs[key] = {
        agentId, playerId, playerName: name(playerId), rows: dictionary(),
        totals: { result: 0, rake: 0, hands: 0, games: 0, rakeback: 0 },
        opening: 0, paid: 0,
      };
    }
    return pairs[key];
  };
  const agent = (agentId) => {
    if (!agents[agentId]) {
      agents[agentId] = {
        agentId, agentName: name(agentId), agentType: null, agentPct: null,
        playersResult: 0, rake: 0, hands: 0,
        gross: 0, share: 0, rakeback: 0, rakebackOnClub: 0,
        secondaryOut: 0, leadsIncome: 0, leads: dictionary(),
        opening: 0, paid: 0,
      };
    }
    return agents[agentId];
  };

  for (const s of sessions) {
    for (const field of ['result', 'rake']) if (!Number.isSafeInteger(s[field])) throw Error('Amounts must be integer cents');
    for (const field of ['agentPct', 'secondaryPct', 'rakebackPct']) if (s[field] != null && (!Number.isFinite(s[field]) || s[field] < 0 || s[field] > 100)) throw Error('Invalid percentage');
    if (s.rake < 0 || !Number.isSafeInteger(s.hands || 0) || (s.hands || 0) < 0) throw Error('Invalid session');
    const agentId = s.primaryAgentId || CLUB;
    const hands = s.hands || 0;
    const rb = pct(s.rake, s.rakebackPct);

    const p = pair(agentId, s.playerId);
    const rowKey = s.tableId || s.tableName;
    if (!p.rows[rowKey]) {
      p.rows[rowKey] = {
        tableId: rowKey, tableName: s.tableName, gameType: s.gameType || '', kind: s.kind || 'cash',
        result: 0, rake: 0, hands: 0, games: 0, rakeback: 0,
      };
    }
    for (const t of [p.rows[rowKey], p.totals]) {
      t.result += s.result; t.rake += s.rake; t.hands += hands; t.games += 1; t.rakeback += rb;
    }

    // The lead commission of a secondary agent always comes out of the primary agent's part.
    // A direct player has no primary agent, so there the club carries it.
    const lead = s.secondaryAgentId ? pct(s.rake, s.secondaryPct) : 0;
    if (lead) {
      const b = agent(s.secondaryAgentId);
      b.leadsIncome += lead;
      if (!b.leads[s.playerId]) b.leads[s.playerId] = { playerId: s.playerId, playerName: name(s.playerId), commission: 0 };
      b.leads[s.playerId].commission += lead;
    }

    if (agentId === CLUB) {
      direct.playersResult += s.result; direct.rake += s.rake; direct.hands += hands; direct.rakeback += rb;
      continue;
    }

    const a = agent(agentId);
    const sessionType = s.agentType || 'rake';
    a.agentType = a.agentType && a.agentType !== sessionType ? 'mixed' : sessionType;
    a.agentPct = a.agentPct !== null && a.agentPct !== (s.agentPct || 0) ? null : (s.agentPct || 0);
    a.playersResult += s.result; a.rake += s.rake; a.hands += hands;
    a.secondaryOut += lead;
    if (sessionType === 'result') {
      // percent of the players' result, win or lose; the rake stays with the house
      a.share += pct(-s.result, s.agentPct);
      if (clubPaysRb) a.rakebackOnClub += rb; else a.rakeback += rb;
    } else {
      a.gross += pct(s.rake, s.agentPct);
      a.rakeback += rb; // rakeback is paid out of the agent's commission
    }
  }

  // balances carried over from the previous cycle
  for (const o of openings.pairs || []) if (o.amount) pair(o.agentId, o.playerId).opening += o.amount;
  for (const o of openings.agents || []) if (o.amount) agent(o.agentId).opening += o.amount;

  // confirmed payments
  for (const pay of payments) {
    if (pay.type === 'player') {
      const p = pair(pay.agentId || CLUB, pay.playerId);
      p.paid += pay.toId === pay.playerId ? pay.amount : -pay.amount;
    } else if (pay.type === 'agent') {
      const a = agent(pay.agentId);
      a.paid += pay.fromId === pay.agentId ? pay.amount : -pay.amount;
    }
  }

  // finalize pairs
  const players = dictionary();
  for (const key of Object.keys(pairs)) {
    const p = pairs[key];
    p.rows = Object.values(p.rows);
    p.activity = p.totals.result + p.totals.rakeback;
    p.closing = p.opening + p.activity - p.paid;

    // the player's own view: no rake, no percentages
    if (!players[p.playerId]) {
      players[p.playerId] = {
        playerId: p.playerId, playerName: p.playerName, rows: [],
        totals: { result: 0, hands: 0, games: 0 },
        rakebackTotal: 0, opening: 0, paid: 0, closing: 0, counterparties: [],
      };
    }
    const v = players[p.playerId];
    for (const r of p.rows) {
      v.rows.push({ tableId: r.tableId, tableName: r.tableName, gameType: r.gameType, kind: r.kind, result: r.result, hands: r.hands, games: r.games });
    }
    v.totals.result += p.totals.result; v.totals.hands += p.totals.hands; v.totals.games += p.totals.games;
    v.rakebackTotal += p.totals.rakeback;
    v.opening += p.opening; v.paid += p.paid; v.closing += p.closing;
    v.counterparties.push({ id: p.agentId, name: p.agentId === CLUB ? CLUB : name(p.agentId), closing: p.closing });
  }
  for (const v of Object.values(players)) {
    v.hasRakeback = v.rakebackTotal > 0;
    if (!v.hasRakeback) { delete v.rakebackTotal; delete v.hasRakeback; }
  }

  // finalize agents
  for (const a of Object.values(agents)) {
    a.leads = Object.values(a.leads);
    a.commission = a.share + a.gross - a.secondaryOut;
    a.earnings = a.commission - a.rakeback + a.leadsIncome;
    a.toClub = -a.playersResult - a.commission - a.rakebackOnClub - a.leadsIncome;
    a.closing = a.opening + a.toClub - a.paid;
    a.players = Object.values(pairs)
      .filter((p) => p.agentId === a.agentId)
      .map((p) => ({
        playerId: p.playerId, playerName: p.playerName,
        result: p.totals.result, rake: p.totals.rake, hands: p.totals.hands, games: p.totals.games,
        rakeback: p.totals.rakeback, activity: p.activity, opening: p.opening, paid: p.paid, closing: p.closing,
      }));
  }

  // club summary
  const directToClub = -(direct.playersResult + direct.rakeback);
  const directClosing = Object.values(pairs).filter((p) => p.agentId === CLUB).reduce((n, p) => n + p.closing, 0);
  const rows = Object.values(agents).map((a) => ({
    agentId: a.agentId, agentName: a.agentName, agentType: a.agentType, agentPct: a.agentPct,
    playersResult: a.playersResult, rake: a.rake, hands: a.hands,
    commission: a.commission, leadsIncome: a.leadsIncome, toClub: a.toClub,
    opening: a.opening, paid: a.paid, closing: a.closing,
  }));
  const sum = (f) => rows.reduce((n, r) => n + r[f], 0);
  const club = {
    rows,
    direct: { ...direct, toClub: directToClub, closing: -directClosing },
    totals: {
      playersResult: sum('playersResult') + direct.playersResult,
      rake: sum('rake') + direct.rake,
      hands: sum('hands') + direct.hands,
      commission: sum('commission'),
      leadsIncome: sum('leadsIncome'),
      toClub: sum('toClub') + directToClub,
      closing: sum('closing') - directClosing,
    },
  };

  return { pairs, players, agents, club };
}

module.exports = { computeCycle, CLUB, pct, pairKey, cents };
