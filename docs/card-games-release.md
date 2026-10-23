# Durak and Chinese poker release

The lobby previously created these tables with browser Firestore writes, but the
deployed rules allow only server-authored tables. Creation therefore failed;
legacy gameplay also attempted to write private cards and balances directly.

The new `pkCardTableCreate`, `pkCardGame` and `pkCardPeek` callables share poker's
membership, manager, idempotency and funded ledger boundaries. Public tables and
each player's private cards carry the same sequence. The canonical engine and
stock stay private. No rules are loosened and no balance migration is run.

Creating an empty table costs nothing. OFC reserves a stack when sitting down;
Durak reserves the entry when a game starts. Bot stacks use the existing sponsor
wallet. Cash-out, rake, results and close-table handling use the existing ledger.
OFC departures mark the departing hand foul while survivors finish their boards.

Both games use the approved midnight, silver and ice-blue shell, table surfaces,
cards, seats, controls and result dialogs. The service-worker version advances
to v324. The existing verified GOD allowlist can reveal an atomic snapshot;
Durak adds a next-draw strip, while OFC retains pending/discarded cards and its
own upcoming-draw preview. An ordinary account receives neither the controls
nor the private payload. The bot policy receives only the public projection
plus its own cards, never GOD information or the true deck order.

Durak bots plan coverage of all attacks, conserve trumps, weigh taking, transfer
matching ranks and attack with repeated ranks. OFC bots compare legal placements
using bounded searches of sampled unknown futures, foul penalties, royalties
and Fantasyland; Fantasyland searches complete 3/5/5 boards. This is a heuristic
policy, not a claim of optimal play. Across 12 fixed two-player deals, the new
policy produced 19 legal boards out of 24 versus 9 for the former policy, with
114 versus 1 total royalties. These are regression fixtures, not a general
win-rate estimate.

## Verification

- Actual callable handlers tested with Firestore SDK transaction serialization
  and an in-memory RPC transport: create, join, funded bots, start, turns,
  settlement, cash-out, close, duplicates and denied actions.
- Pure engine tests cover 2–6 player Durak, both decks and variants, OFC normal
  and fantasy hands, card/cent conservation, private projections and departures.
- Bot scenarios cover defense, transfers, foul avoidance, fantasy royalties and
  independence from hidden data. GOD tests cover authorization and stale views.
- JSDOM runs the actual lobby/table components for creation, retry, private
  snapshots, GOD toggles, results and next hand without client Firestore writes.
- Existing poker, accounting, permission, generated-asset and predeploy gates
  run alongside these tests in CI.

Local browser preview was blocked by the browser environment. The production
browser showed the login screen, so visual QA and authenticated production
smoke checks remain necessary after deployment. Firebase Hosting already waits
for the matching Functions release before publishing the new controls.
