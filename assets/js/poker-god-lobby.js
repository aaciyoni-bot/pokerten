(function (global) {
  'use strict';
  const seatKey = table => JSON.stringify(Object.entries(table.players || {})
    .filter(([, p]) => p && typeof p === 'object' && p.status !== 'left' && p.left !== true).map(([uid]) => uid).sort());
  const tableId = table => table.docId || table.id;
  const validCounts = row => row && typeof row.tableId === 'string' && typeof row.occupancyKey === 'string' &&
    ['humans', 'bots', 'unknown', 'seated'].every(key => Number.isInteger(row[key]) && row[key] >= 0) &&
    row.humans + row.bots + row.unknown === row.seated;

  function useCounts({user, tables, clubId, isGodUser}) {
    const React = global.React;
    const allowed = isGodUser(user);
    const rows = allowed ? tables.filter(t => ['poker', 'durak', 'ofc'].includes(t.type) && (t.clubId || 'main') === clubId) : [];
    // Bet, pot and animation updates do not refetch these counts. Only the
    // seated roster changes this key; a slow poll catches metadata updates.
    const rosterKey = JSON.stringify(rows.map(t => [tableId(t), seatKey(t)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const scope = JSON.stringify([allowed ? user.uid : '', clubId, rosterKey]);
    const [state, setState] = React.useState({scope: '', status: 'loading', byTable: {}});
    React.useEffect(() => {
      if (!allowed || !isGodUser(user)) return;
      const ids = JSON.parse(rosterKey).map(row => row[0]).filter(Boolean);
      if (!ids.length) { setState({scope, status: 'ready', byTable: {}}); return; }
      let disposed = false, busy = false, timer;
      const refresh = async () => {
        if (disposed || busy || global.document.hidden || !isGodUser(user)) return;
        clearTimeout(timer);
        busy = true;
        try {
          const byTable = {};
          for (let i = 0; i < ids.length; i += 60) {
            if (disposed || !isGodUser(user)) return;
            const result = await global.fb.fx('godLobbyCounts', {clubId, tableIds: ids.slice(i, i + 60)});
            for (const row of result?.tables || []) if (validCounts(row)) byTable[row.tableId] = row;
          }
          if (!disposed && isGodUser(user)) setState({scope, status: 'ready', byTable});
        } catch (error) {
          if (!disposed && isGodUser(user)) setState({scope, status: 'error', byTable: {}});
        } finally {
          busy = false;
          if (!disposed) timer = setTimeout(refresh, 30000);
        }
      };
      const visibility = () => { if (!global.document.hidden) refresh(); };
      timer = setTimeout(refresh, 250);
      global.document.addEventListener('visibilitychange', visibility);
      return () => { disposed = true; clearTimeout(timer); global.document.removeEventListener('visibilitychange', visibility); };
    }, [allowed, user.uid, clubId, scope]);
    if (!allowed) return {status: 'hidden', byTable: {}};
    return state.scope === scope ? state : {status: 'loading', byTable: {}};
  }

  function Badge({user, table, counts, isGodUser}) {
    if (!isGodUser(user)) return null;
    const h = global.React.createElement;
    const row = counts.byTable[tableId(table)];
    const fresh = row && row.occupancyKey === seatKey(table);
    const label = fresh ? `GOD MODE · ${row.humans} human players · ${row.bots} bots${row.unknown ? ` · ${row.unknown} unclassified` : ''}` :
      counts.status === 'error' ? 'GOD MODE · Player counts unavailable' : 'GOD MODE · Updating player counts';
    return h('span', {className: 'tbl-god-occupancy', title: label, 'aria-label': label, dir: 'ltr', 'data-state': fresh ? 'ready' : counts.status},
      h('i', {className: 'fa-solid fa-eye', 'aria-hidden': true}),
      fresh ? h(global.React.Fragment, null,
        h('span', {className: 'tbl-god-human'}, h('i', {className: 'fa-solid fa-user', 'aria-hidden': true}), ' ', row.humans),
        h('span', {className: 'tbl-god-bot'}, h('i', {className: 'fa-solid fa-robot', 'aria-hidden': true}), ' ', row.bots),
        row.unknown > 0 && h('span', {className: 'tbl-god-unknown'}, '? ', row.unknown)) :
        h('span', null, counts.status === 'error' ? 'Unavailable' : '…'));
  }
  global.PokerGodLobby = {useCounts, Badge};
})(window);
