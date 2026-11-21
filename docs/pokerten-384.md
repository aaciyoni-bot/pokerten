# PokerTen 384 — separate tournament display from engine records

Players subscribe to `tournamentViews` instead of the engine's `tournaments`
documents. The server explicitly selects public event terms, registration,
table assignments, prizes, results and blind levels. Sponsor identities,
bot strategy/classification fields, paid-entry bookkeeping, internal bounty
events, removed-player audit records and future unknown fields are excluded.

Every engine mutation that affects public tournament data writes the source
and its view in the same transaction, including avatar repair, table balancing,
elimination, re-entry, cancellation and final payout. Game and ledger authority
remain on the existing records. A bounded, rerunnable backfill reads each source
again inside its transaction and writes only the display projection.

Tournament human/bot totals come from a verified GOD-only callable. A client
role such as manager or super_admin cannot grant this access. Shared roster
labels do not contain classifications. Counts clear on background/account
changes and reject stale responses. Classic styles and table rendering are
preserved; tournament data subscriptions inside the table use the new view.

## Deployment sequence

1. Deploy atomic projection writers, the view read rule and backfill. Existing
   raw reads remain temporarily compatible during this preparation stage.
2. Publish and verify web 384 and the corresponding Android update.
3. Deploy the separately reviewed rule change that denies ordinary clients all
   raw tournament reads. Do not close that path before step 2 succeeds.

The isolation is **not complete until step 3**. Older cached clients must update
to read tournaments after that cutover. There is no fallback to raw records.

## Validation

- Tournament lifecycle tests assert matching projections after each committed
  mutation, in addition to existing chip/fee/prize/idempotency checks.
- Unknown-field and nested-data exclusion, projection-only backfill under a
  concurrent change, pagination and reruns are covered.
- Rules cover approved/revoked membership, cross-club requests, guessed paths,
  collection scans, forged claims and write denial.
- GOD endpoint/UI checks cover unverified identities, local role spoofing,
  wrong clubs, background, account changes and late responses.
- Full UI, cash/tournament/settlement emulator and core checks run before merge.

## Still open

This is one part of items 26–27, not a complete privacy/security sign-off.
Shared table records (poker, Durak/OFC), historical records and recognizable
participant identifiers still require a separate audit and projection strategy.
Raw bot metadata in tables can still identify automated players. The GitHub
repository is still public. Physical-device, live-human-game, load and soak
verification and the unfinished items in the 42-item report remain open.
