# PokerTen 383 — profile privacy and complete tournament details

Ordinary authenticated clients could read other users' raw profile documents and tournaments outside their clubs. Firestore now permits profile gets only for the authenticated document owner or existing verified oversight accounts; listing profiles requires existing verified oversight. An own missing-profile lookup remains permitted for registration. Current tournament reads require approved membership in the event's club and authority version 2; the existing verified oversight exception is preserved. Legacy events are blocked for ordinary clients.

The current lobby already queries by club and authority version, personal profile flows read their own UID, and staff directories use the existing server-authorized callables. No data migration or balance change is involved. Existing approved members retain live tournament reads; revoked, pending and banned members cannot read them.

Tournament details now display every configured prize place, a collapsible cost/rules summary, and every saved blind level, ante, level duration and scheduled break. Multi-day row timers and expanded countdowns use days plus hours; hours roll over at 24. The prize layout adapts to narrow screens without splitting ordinary amounts across lines. The Classic stylesheets and poker-table components are unchanged.

## Verification

- Firestore emulator: 20 rule tests passed, including cross-user reads, email/bot directory queries, guessed missing profiles, forged claims, club-scoped queries, legacy events and membership revocation.
- Server/settlement emulator: 53 lifecycle tests passed.
- Full UI suite passed; targeted tournament tests also cover ten prize places, fees/re-entry totals, complete blind schedules and the 24-hour boundary.
- Core tests: 151 passed. Native updater tests: 19 passed. Predeploy invariants: 22 passed. Generated worker/settlement checks passed.
- Browser fixture: ordinary-player tournament details, vertical scrolling and contained horizontal blind-table scrolling at 320px; no live transactions.

## Remaining scope

This is partial progress on items 26/27, not a certificate of full security. Approved members still receive raw bot metadata within current table and tournament documents. Server-only operational data/public projections across cash, tournaments, Durak/OFC and histories remain necessary. Privileged implementation remains present in downloaded JavaScript. The GitHub repository remains public; hosting/DNS and repository visibility are unchanged. Physical-device, active human game, load and soak verification remain open.

Items 22/23 are implemented for tournament details and timers. Production publication and Android OTA availability are verified separately by the release workflows; tests above do not claim a physical-device check.
