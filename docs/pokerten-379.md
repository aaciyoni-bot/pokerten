# PokerTen 379 — connection, navigation and Silver shell

Classic design: `archive/pokerten-classic-2026-11-20`, commit `35ad6b7add33443b272b95ad94f847ad0af3665c` (378). Reuse request: “Use POKERTEN Classic saved before the redesign.” This preserves source and graphic assets, not live balances or database state.

## Implemented

- First launch intro capped at 1.2 seconds, subsequent launches skip it; existing Firebase session persistence remains in place.
- Bound sign-in and profile loading; canonical existing profiles avoid a redundant identity-creation transaction. Late profile responses cannot replace a newer session.
- Lobby loading is scoped to user and club. An empty offline cache no longer claims there are no tables. Listener recovery and explicit retry reject stale callbacks.
- Back to lobby preserves the poker seat and saved return location. Zero-stack/all-in seats still show Return to table. Background seat heartbeats and authoritative ticks continue without leave, sit-out or turn commands.
- Actual App entry defaults to spectating. Selecting a seat still explicitly opens buy-in.
- Receipt-backed actions call Europe directly. Only transport/platform failures fall back through the existing endpoint with the same request ID; permission or stale-turn errors do not replay.
- Tick scheduling accounts for time already spent awaiting the server, instead of adding a full second after every response. Calls never overlap within a loop.
- Bounded in-memory duration samples separate callable round trip, server handler, transport/platform residual, render delay and award-animation elapsed time. No identities, cards, balances or payloads are recorded. The diagnostic view is available to managers in Table details.
- Shared Silver styling on non-table screens, club cards, login controls, role-specific navigation, compact cash rows with buy-in ranges, variant cards, and real registration-event banners. Bottom navigation separates Lobby, Events, Wallet and Profile. No table felt, card geometry or game animation CSS was changed.
- Wallet reads the existing permission-scoped accounting result, separating account chips from chips at tables. Manager cashier and player results retain their original authorization.
- Web/native updater cache key now matches the release, with a predeployment guard against the mismatch that affected 378 verification.

## Validation

- `node predeploy-check.js`: 21 checks passed.
- `node --test tests/*.test.cjs functions/test/*.test.js`: 394 tests passed.
- `npm test --prefix tests/ui`: complete UI suite passed, including new lobby session/auth timeout regression tests and existing GOD, accounting, chip conservation, PLO7, showdown, cashier and tournament tests.
- Engine smoke and mobile-update/updater tests passed.
- Follow-up native verification: all 35 pinned-runtime tests passed after adapting the builder to retryable roster listeners and removing the hard Firebase-startup dependency on optional timing helpers. Five focused connection tests also passed. Android packaging is bounded to 10 minutes; a superseded client build yields to its corrected replacement.
- Browser preview uses isolated simulated data and rejects writes. Live multi-player timing, mobile native-device behavior, and load/soak testing remain separate acceptance checks.

## Scope still open from the 42-item backlog

This release is not completion of all 42 items. The remaining work includes end-to-end active-game latency measurements and showdown review, load/soak tests, a player deposit/withdrawal request-and-approval workflow with configured fees/limits, full Hebrew coverage, and the advanced-feature comparison. Existing manager transfers, persistent accounting history, Rabbit Hunt and Run It Twice were found in source; they must not be rebuilt on the assumption they are absent. Current manual manager transfers are not equivalent to a player request queue.

The supplied reference sets the visual direction; event amounts, dates and balances are never copied into production data. Tables retain their existing design.
