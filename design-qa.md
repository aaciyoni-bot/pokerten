# AVIATORIZIS unified timing and flight-deck review

final result: production client d8ba4ea published; live browser cashout and wallet verified; desktop/mobile reviewed

Current release evidence: [2026-09-12 verified production report](aviator-src/RELEASE-2026-09-12.md). Earlier blocked local-preview notes below are historical; the authorized public Vercel preview and production browser checks subsequently succeeded.

## Reference and implementation
Selected reference: other agent's cockpit concept `exec-51b20e6e-0991-4cca-833c-eed4cef620ff.png`, inspected at 1536×1024. Wide central flight display, narrow recent-round rail, player panel, central green cashout, dark aircraft housing and twilight windshield. Implemented in source files with a new 89,848-byte WebP plate. All labels, values and controls remain actual DOM elements; original game IDs are preserved. Responsive breakpoint 760px; 390px iframe fixture available. Latest user steering adds an embedded Natural Earth world map and a realistic generated jet sprite, replacing the comet head. Map geometry is rasterized only on resize; both visual layers use the authoritative graph endpoint. These additions also await browser QA.

## Actual verification
- Live a9fa238 opened in the supported cloud browser; Take off and game DOM were inspected. This is the previous production build, not verification of the new changes.
- 45 automated regressions passed: core integer pricing, quote authentication/expiry, exact cashout, delayed settlement including automatic/manual ordering, retries, round rollover, disconnect freeze, 1.00x, exact crash boundary, rounding, legacy rollout, solo/live GOD, chat and audio mute.
- On 2026-09-10 a generated-client graph regression reproduced an endpoint mismatch after joining an advanced flight: the eased horizontal scale truncated the curve before the plane/readout value. The source builder now keeps the authoritative endpoint within the scale. The failing regression passes after the fix.
- Four additional client/server integration tests use actual generated frame/cashout functions and actual server handlers with in-memory dependencies. They cover displayed/sent/paid equality with delayed settlement and acknowledgement, rejection of late arrival, lost-response retry without duplicate credit, and explicit automatic-target outcome. This is not real browser, network or Firestore load testing.
- Generated client rebuilt byte-for-byte from source and script syntax checked.
- No POKERTEN engine, odds, house edge, owner credential, Firestore rules or public diagnostic access changed.

## Blocking browser evidence
On 2026-09-08 the supported browser rejected navigation to `http://terminal.local:4173/`:
“A saved user permission setting blocks this action. Cloud browser cannot access http://terminal.local:4173 because the user has a saved preference that blocks it.”
The tool explicitly forbids indirect execution, alternate browser surfaces and workarounds. No alternative browser or alternate-host preview was used to bypass this. A fresh user screenshot showing Always allow and a subsequent user-confirmed permission reset both still resulted in the same supported-browser rejection on 2026-09-09. The preview was stopped. This local preview remained blocked. Subsequent explicitly authorized production verification is recorded below.

## Remaining release gates
- Capture the new desktop screen and mobile iframe, compare with the selected reference, fix any clipping/contrast/spacing defects.
- In the isolated UI, observe displayed multiplier, sent `seenCents`, pending feedback, returned multiplier and credited balance. Repeat delayed response, rollover, offline, automatic exit and 1.00x scenarios.
- Measure actual production response time after authorized deployment; no production latency claim has been made.
- Mirror server code safely in all deployment branches, execute scoped Firebase deployment, publish the pinned Vercel client, verify the production SHA.

At the time of the original local preview block, these changes had not been deployed. See the dated production results below for the current status.

## Subsequent release instruction — 2026-09-10
After the blocked browser check and the lack of live verification were disclosed, the user explicitly requested: "תאמת ותפרסם" (verify and publish). The release now includes an owner-triggered authenticated Firebase API probe after scoped function deployment, checking actual manual and automatic play-chip settlement and retry accounting. This report still records browser QA as blocked; neither the instruction nor an API result is recorded as a passed browser/design comparison. Production results must be recorded after the workflow and Vercel deployment actually complete.


## Production release evidence — 2026-09-10
- Firebase release `113c24f` passed all 45 automated checks and real authenticated API settlement verification in GitHub Actions run 34455448025. Vercel deployment `dpl_25r7L7aQ6dkhWmDZrgNRJHbxNNWt` reached READY with the production aliases. `www.aviatorizis.com/version.json` returned `113c24f`; the HTML contains the exact-price protocol and bounded graph endpoint. Both cockpit WebP assets returned 200. `/api/timing` remains 404.
- The supported browser opened the actual public production site, entered the play-chip game, and inspected the cockpit with map and jet at 1363×936. This was independently requested live verification, not an alternate-host workaround for the blocked local preview. No mobile viewport test was performed.
- A live keyboard cashout immediately showed pending 1.00x and then confirmed 1.00x / 101 chips with 2427ms client RTT. A later pointer cashout sent 1.02x; a 101-chip bet changed the wallet from 9798 to 9800, matching a 103-chip return.
- Those checks exposed serialized Firestore reads. Backend `3d55e3b17aa713814afced0e301ce9395474e65b` batches round/engine reads and cashout transaction reads without moving any accounting decision outside the transaction. Production run 34456884165 passed 45 regressions and three new exact manual settlements: 1.06x→107 chips (1606ms), 1.51x→152 chips (781ms), 1.03x→104 chips (770ms), each for 101 chips and with duplicate requests verified harmless. The stored 1.20x auto target returned 121 chips without a manual request. Tick median was 159ms over 216 requests (p95 700ms). These are GitHub runner measurements, not player-device or load-test guarantees.
- Server changes are mirrored alongside current and legacy poker. Their workflows exclude AVIATOR files and deploy only poker exports, without broad `--force` function deployment.
- The browser also exposed the previous round's readout during the short interval between takeoff and the next animation frame. A regression failed with previous 7.19x versus expected 1.00x. This source revision writes the current price before revealing the new flight, supplies the cashout amount without waiting for a frame, and updates phase labels on action changes. All 46 checks and generated-script syntax pass. Its final deployed client SHA and post-deployment browser receipt are recorded in PR #14 after release.
- Remaining scope: full mobile visual comparison and user-device/load measurements. Do not treat these as completed or promise zero network latency.
