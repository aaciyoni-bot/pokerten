# PokerTen 380 — synchronized hand results

The previous client announced the winner and displayed the credited stack as soon as the settlement snapshot arrived. Its chip flights began after 400/800 ms even though the last seat's reveal could take 1,760 ms. These independently timed effects made the result appear out of order.

The client now uses one presentation timeline for the revealed hands, winner badges/highlights, result sound, each split payout and the displayed seat stack. Reveal order follows physical seat order for all viewers. Already revealed all-in cards do not flip again. Each flight still lasts two seconds, followed by a 2.5-second readable hold. The complete sequence fits within the existing 6.5/8-second server interval; no next-hand delay was added.

Only the displayed seat stack is staged. The authoritative server settlement, balances, pot calculations, refunds, rake, receipts, private-card rules and table artwork are unchanged. Unknown stacks remain unknown. A new authoritative hand immediately replaces any unfinished presentation. Initial entry into a completed hand, background return and table changes display settled values without replaying payouts. Reduced-motion users see settled stacks without chip flights.

Also fixed a table-render exception when an active turn temporarily lacks both a timestamp and manual-control data. The service-worker activation message now matches the release version, with a predeploy guard against future drift.

Validation:

- 146 core tests, the complete UI suite, and all 22 predeploy checks passed locally; generated worker/settlement sources match.
- Deterministic timing tests cover nine revealed seats, fold wins, all-in, split/side pots, duplicate payout entries, refunds, missing stacks, late/repeated snapshots, backgrounding and missed hands.
- The actual React table test verifies delayed winner sound, per-recipient stack arrival, stable animation elements, immediate next-turn takeover and silent re-entry. No financial/action commands are issued by the presentation.
- Chrome review at 390 × 844 exercised a simulated split result through the actual table component. The isolated fixture disables production writes and retains the existing table geometry.
- CI must validate the exact PR and package the pinned Android runtime before publication. Physical-device, live multiplayer latency and sustained load tests remain open. This release advances backlog item 6; it does not complete all 42 items.

Reproduce the isolated visual check at `tests/ui/gg-preview.html?mode=nlh&width=390&height=844&bare&result`, then use **Replay split result · simulated chips**. The fixture's payouts are test data, not real account balances.
