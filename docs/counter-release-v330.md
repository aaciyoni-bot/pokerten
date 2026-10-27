# Counter / Club Members v330

The Counter previously required per-player interactions. This change presents a searchable, role-filtered member list matching the supplied mobile references and lets managers review Send Out or Claim Back amounts for several players together. Club Members and the existing player account and settlement views are reachable from the same flow.

## Accounting behavior

- Transfers use the existing `pkClubMember` `cashier-transfer` operation and its atomic ledger/receipt transaction. No balances, historical results, bonuses or table balances are migrated.
- Send Out validates the total against treasury funds before submission; the server remains authoritative for every member transaction. Claim Back is limited to regular available wallet chips, excluding open bonus chips.
- Each member receives a distinct persisted receipt ID before the request. Retry skips completed members and reuses the same IDs for uncertain outcomes, including after a reload in the same browser session.
- The batch is sequential and can partially complete. The review shows Completed, Not sent, Unconfirmed or Rejected for each member. A definitive rejection stops the rest. Unknown outcomes remain locked for receipt-safe retry.
- The new manager-only `pkClubDirectory` report section `cashierHistory` reads existing `_pkAudit` transfer records. It exposes only ID, target UID, amount and timestamp, remains club scoped, and advances pagination over filtered events. No Firestore index or rule change is required.

## Validation

- `npm test --prefix tests/ui` — passed, including updated cashier behavior coverage.
- `node --test tests/*.test.cjs` — 72 passed.
- `node --test functions/test/clubDirectory.test.js` — 19 passed.
- `node --test functions/test/memberApproval.test.js` — 7 passed, covering existing transfer protections and receipts.
- `node predeploy-check.js` — 20 checks passed.
- Poker worker and settlement generated-artifact checks — passed.
- `git diff --check` — passed.
- Browser inspection and normalized source comparisons — passed; see `design-qa.md`.

The local fixture denies real writes. No production financial action was performed during verification. Authenticated live testing remains a post-deployment check performed without moving real balances.

## Release order and rollback

1. After publication is approved, recheck the destination branch and integrate this change without overwriting newer work.
2. Deploy and verify the updated `pkClubDirectory` backend before releasing the history-dependent frontend. Run the repository's existing deployment workflow gates.
3. Publish frontend assets with cashier version 330 and service-worker cache v332; verify Counter, Members and history with an authorized account. The release includes the existing v330/v331 table, navigation audio and integration-test fixes without reverting them.
4. If frontend rollback is needed, restore the prior frontend revision and invalidate the service-worker cache. The added read-only history section is backward compatible and may remain deployed.

## Publication status

The user explicitly approved uploading the change to `aaciyoni-bot/pokerten` and publishing it on POKERTEN on 2026-10-27. The local change has been integrated with remote main `57614c2d81263dbb0787056b010c84788fe708a3`, retaining the already-published table/audio fixes. Deployment follows the existing backend-before-hosting workflow; the workflow result and live asset verification determine release completion.
