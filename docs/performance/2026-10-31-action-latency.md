# POKERTEN latency investigation — 2026-10-31

## Verified production configuration
- Default Firestore database: `eur3`.
- Existing `pkAct`, `pkTick`, `pkDeal`: `us-central1`.
- Region mismatch was verified with authenticated Firebase deployment inventory, not inferred only from source.
- User-facing actions send immediately. The UI applies the authoritative response without waiting for another Firestore snapshot; the existing UI test passes.
- These are server request durations, not measurements from players' phones. Samples are the latest retrieved log entries, not a random sample or a complete day.

## Baseline
Read-only diagnostic run: https://github.com/aaciyoni-bot/pokerten/actions/runs/41233220991

| Callable | Successful requests | Median | p95 | Successful requests >= 2 s | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| pkAct | 351 | 1,088 ms | 3,578 ms | 78 | Action processing; sample approximately 18:45–19:14 UTC |
| pkSeat | 355 | 1,135 ms | 3,551 ms | 94 | Mixed seat operations, including heartbeat, chat and joining; cannot attribute this to joining alone |
| pkClubDirectory | 339 | 6,325 ms | 8,491 ms | 274 | Mixed directory, accounting and report requests; needs operation-level separation |
| pkTick | 444 | 253 ms | 1,961 ms | 21 | Table advancement; approximately 90-second sample |
| pkTournament | 414 | 921 ms | 1,428 ms | 5 | Mixed tournament operations; approximately 51-second sample |

Only one successful table-creation request was returned (2,478 ms); this is insufficient for a general latency claim. No successful pkDeal requests were in the returned 24-hour sample. Automatic dealing commonly occurs through table advancement.

## First migration
PR: https://github.com/aaciyoni-bot/pokerten/pull/100

- Add `pkActEurope` in `europe-west1`, using the existing authoritative action handler.
- Keep `pkAct` and its URL so installed apps and active sessions remain compatible.
- Forward the same authenticated request and request ID. Preserve permission and turn-validation errors.
- Fall back to the existing handler on transport/availability failure; shared transaction receipts prevent double application even if Europe committed before the response was lost.
- A 30-second circuit breaker prevents every request repeatedly attempting an unavailable destination.
- Deploy and check the destination before activating the legacy proxy.
- Demand-scaled first stage (`minInstances:0`). Firebase blocked the original minimum-instance proposal before changing production; no fixed minimum was enabled.
- No database migration, balance repair, game-rule change or native app-store release is part of this stage.

## Remaining performance investigations
1. **Seat/presence transactions.** Heartbeats every 12 seconds read the table, membership and user profile and write the shared table document. This can contend with actions; contention is a hypothesis, not demonstrated by an ABORTED log. Consider moving processing closer to Firestore and avoiding unnecessary profile reads while retaining membership checks.
2. **Directory and accounting.** Several read-only transaction paths perform sequential reads and read game history and current-cycle contributions. Separate per-operation timings, move reads closer to Firestore, then optimize query scope without changing accounting totals or permissions.
3. **Tournament polling.** Table view synchronizes every five seconds; the app-level coordinator also synchronizes every eight seconds for eligible users; the server driver runs independently. Review coalescing and ownership without removing recovery guarantees.
4. **Automatic table advancement.** The server driver and table ticks still run in the US in this stage. Moving only manual actions does not complete the regional migration.
5. **Device-level measurements.** Add controlled click-to-confirmation measurements on an authenticated test session; server logs alone exclude network travel to the player's phone and rendering.

## Validation
Full validation and Firestore emulator security jobs passed before merge and again after the demand-scaling adjustment. Tests cover normal action confirmation, rejected actions, cross-endpoint receipt replay, lost responses, unavailable/malformed responses, timeout fallback, and unchanged tournament/chip-conservation behavior. The live browser reached the login page, so no manually played production test hand is claimed.

## Post-rollout result
The first migration is live. Backend deployment succeeded:
https://github.com/aaciyoni-bot/pokerten/actions/runs/41233909227

Hosting publication also succeeded:
https://github.com/aaciyoni-bot/pokerten/actions/runs/41234370290

Fresh read-only sample:
https://github.com/aaciyoni-bot/pokerten/actions/runs/41234469796

| Legacy URL revision | Successful actions | Median | p95 | >= 2 s | >= 3 s | Failed POSTs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before, pkact-00085-viw | 316 | 1,024 ms | 3,632 ms | 78 | 28 | 8 |
| After, pkact-00086-how | 34 | 1,019 ms | 2,248 ms | 2 | 0 | 0 |

The new revision's sample spans approximately 19:26:39–19:29:58 UTC. The proxy logged 34 European routes and zero local fallbacks. The first independent European endpoint sample also contained successful authenticated actions (11), with no successful action over two seconds; the unauthenticated deployment readiness request was correctly rejected with HTTP 401.

**Interpretation:** the slow end improved in this early sample, while median server latency remained about one second. This is not a controlled experiment and the after-sample is small; do not claim that every player's 2–3 second delay is fixed. Existing US seat/presence and automatic-tick transactions can still overlap with the European action transaction.

Post-rollout observations also showed elevated tails on still-US operations: the returned new pkSeat revision sample had median 1,554 ms and p95 5,768 ms (101 successes), and pkTick had median 390 ms and p95 3,176 ms (448 successes). These early post-deployment samples do not establish a causal regression, but must not be described as an overall game-wide speedup. They justify prioritizing presence and automatic-advance processing in the next stage.

Some individual log reads failed during observation, including the second direct pkActEurope read and the latest pkClubDirectory read. These are diagnostic retrieval failures, not evidence of failed player actions. The successful legacy request records and route logs establish that the compatibility path is processing actions in Europe.
