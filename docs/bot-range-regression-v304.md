# Bot range regression — v304

Baseline: v303 production bot policy (unchanged from v302). Updated policy: v304. Each scenario runs 100 decisions using fixed, separate decision and deck seeds. The opponent’s actual cards are inaccessible; the runner throws if the policy reads them.

| Scenario | Before: fold / call / raise | After: fold / call / raise | Result |
|---|---|---|---|
| AK on A99 facing bet-bet-shove | 0% / 100% / 0% | 100% / 0% / 0% | PASS |
| Overpair without flush blocker on four-flush river | 100% / 0% / 0% | 100% / 0% / 0% | PASS |
| Top pair facing river check-raise | 0% / 68% / 32% | 100% / 0% / 0% | PASS |
| Second pair facing one small flop bet | 0% / 48% / 52% | 0% / 100% / 0% | PASS |
| Private river nuts get value | 0% / 0% / 100% | 0% / 0% / 100% | PASS |
| AK versus demonstrated frequent bluffer | 0% / 100% / 0% | 0% / 100% / 0% | PASS |

Acceptance scenarios: 3/6 before; 6/6 after. Expected bounds were specified before implementation. These are controlled scenario results, not a claim of optimal play or guaranteed profit.

Additional verification: 32 existing client/server bot regressions passed; six weighted-range/model tests passed, including normalized legal combos, public-only showdown observations, PLO6 compatible sampling and actual mixed call/fold frequencies. The 41-test server/settlement emulator suite passed, followed by a focused concurrent-tick check that private opponent models and decision traces commit exactly once.

Implementation: Hold’em enumerates all legal weighted combos. Larger hole-card variants use weighted importance particles; Omaha equity always uses the legal two-hole/three-board evaluator. Heads-up river Hold’em equity is exact against the posterior; other streets use weighted Monte Carlo. Likelihoods are heuristic population assumptions updated with observed public behavior, not a trained solver.

Preflop strategy, personality differences, pot-limit caps, eligible side pots, Pineapple discard rules and isolated all-bot demonstration guards are preserved. Normal tables use public actions and exposed showdown cards only. Debug traces are server-private and never grant GOD access.

Limits: preflop decision logs retain the previous strategy and report frequencies as null; postflop traces contain mixed-action frequencies, range categories, equity, required equity, blockers and reverse implied odds. Live authenticated cash/Spin smoke checks were not performed; the emulator covers the engine flows.
