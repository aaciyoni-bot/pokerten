# Poker chip-write incident — containment

The user reported a player adding 10,000 chips through browser developer tools.
Repository review confirmed that every signed-in account could write memberships,
tables, tournaments, profiles and clubs. The alert trigger trusted client-editable
receipt fields and therefore was not an authorization boundary.

## Containment implemented

- Player writes to wallet balances, stacks, tables, tournaments and financial logs
  are rejected by Firestore rules. Forged receipt/stat fields do not grant access.
- Players cannot promote roles, change club ownership, or disable the guard.
- Only the existing designated super administrator, authenticated with a verified
  Firebase email, can reconcile membership balances. No new administrator is added.
- Legacy shared table/hand documents are unreadable to players: they expose decks
  and hidden hands. A player may still read their own existing private hand.
- Every poker mutation callable rejects before reading or writing game state.
  Both scheduled poker drivers pause. This prevents forged legacy stacks being
  paid out through the Admin SDK, which bypasses Firestore rules.
- The website shows a maintenance notice. Cached or modified UIs cannot bypass
  the database rules or callable gate. No balances, tables or records are deleted.
- AVIATOR, ammo, fleet and d1 collection policies are not replaced by poker rules.

## Verification

`npm test --prefix tests/security` exercises the actual rules in an isolated
Firestore emulator, including +10,000 writes, forged receipts, wallet deletion,
role/owner escalation, fake cash-outs, tournament prize fabrication, anonymous
access and unverified administrator email. It also verifies allowed profile edits,
verified administrator reconciliation, and backend writes.

`node --test tests/poker-containment.test.cjs` calls all eight actual exported
poker mutation handlers and verifies rejection before opening a DB transaction.
The rules deployment requires the emulator checks to pass.

## Required before reopening

1. Reconcile the reported player, table and club against trusted deposits,
   cash-outs and available incident logs. A UI-only fake number and a persisted
   credit are different incidents; do not zero an account without evidence.
2. Audit existing owner/role grants and balances, since the previous rules let
   attackers modify them. Locking future writes does not validate old data.
3. Make seating, top-ups, exits, transfers, tournament entry/rebuy/add-on, bounty,
   prizes and fees server-authoritative, with idempotent ledger receipts.
4. Keep authoritative deck/hole cards private and validate all game actions on
   the server. A client-computed action or payout must never be accepted as fact.
5. Run authenticated multi-player games, reconnects, consolidations and payout
   reconciliation before removing the server pause. Never restore signed-in-wide
   writes or merely hide F12 to reopen the game.

Tournament lifecycle repairs are checkpointed separately in local commit
`386221e`; they are not part of this containment release. The personal-code
signing readiness issue (`signing-permission`) is also separate and remains open.

## Publication status

The user explicitly approved publishing the security source, rules, deployment
workflows, tests and incident document to the public repository
`aaciyoni-bot/pokerten`, and enabling the temporary pause, on 2026-09-12.
Publication and production verification are in progress. Do not treat the
production vulnerability as contained until all enforcement layers are deployed.
