# AVIATORIZIS unified timing and flight-deck review

final result: blocked

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
The tool explicitly forbids indirect execution, alternate browser surfaces and workarounds. No alternative browser or alternate-host preview was used to bypass this. A fresh user screenshot showing Always allow and a subsequent user-confirmed permission reset both still resulted in the same supported-browser rejection on 2026-09-09. The preview was stopped. Browser verification has not occurred, and the user's timing-priority message did not waive this release gate.

## Remaining release gates
- Capture the new desktop screen and mobile iframe, compare with the selected reference, fix any clipping/contrast/spacing defects.
- In the isolated UI, observe displayed multiplier, sent `seenCents`, pending feedback, returned multiplier and credited balance. Repeat delayed response, rollover, offline, automatic exit and 1.00x scenarios.
- Measure actual production response time after authorized deployment; no production latency claim has been made.
- Mirror server code safely in all deployment branches, execute scoped Firebase deployment, publish the pinned Vercel client, verify the production SHA.

New changes have NOT been deployed to production while these gates remain blocked.

## Subsequent release instruction — 2026-09-10
After the blocked browser check and the lack of live verification were disclosed, the user explicitly requested: "תאמת ותפרסם" (verify and publish). The release now includes an owner-triggered authenticated Firebase API probe after scoped function deployment, checking actual manual and automatic play-chip settlement and retry accounting. This report still records browser QA as blocked; neither the instruction nor an API result is recorded as a passed browser/design comparison. Production results must be recorded after the workflow and Vercel deployment actually complete.
