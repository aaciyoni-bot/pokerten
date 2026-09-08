# AVIATORIZIS unified timing and flight-deck review

final result: blocked

## Reference and implementation
Selected reference: other agent's cockpit concept `exec-51b20e6e-0991-4cca-833c-eed4cef620ff.png`, inspected at 1536×1024. Wide central flight display, narrow recent-round rail, player panel, central green cashout, dark aircraft housing and twilight windshield. Implemented in source files with a new 89,848-byte WebP plate. All labels, values and controls remain actual DOM elements; original game IDs are preserved. Responsive breakpoint 760px; 390px iframe fixture available. Latest user steering adds an embedded Natural Earth world map and a realistic generated jet sprite, replacing the comet head. Map geometry is rasterized only on resize; both visual layers use the authoritative graph endpoint. These additions also await browser QA.

## Actual verification
- Live a9fa238 opened in the supported cloud browser; Take off and game DOM were inspected. This is the previous production build, not verification of the new changes.
- 40 automated regressions passed: core integer pricing, quote authentication/expiry, exact cashout, delayed settlement including automatic/manual ordering, retries, round rollover, disconnect freeze, 1.00x, exact crash boundary, rounding, legacy rollout, solo/live GOD, chat and audio mute.
- Generated client rebuilt byte-for-byte from source and script syntax checked.
- No POKERTEN engine, odds, house edge, owner credential, Firestore rules or public diagnostic access changed.

## Blocking browser evidence
On 2026-09-08 the supported browser rejected navigation to `http://terminal.local:4173/`:
“A saved user permission setting blocks this action. Cloud browser cannot access http://terminal.local:4173 because the user has a saved preference that blocks it.”
The tool explicitly forbids indirect execution, alternate browser surfaces and workarounds. No alternative browser or alternate-host preview was used to bypass this. The preview server is running, but this is not browser verification.

## Remaining release gates
- Capture the new desktop screen and mobile iframe, compare with the selected reference, fix any clipping/contrast/spacing defects.
- In the isolated UI, observe displayed multiplier, sent `seenCents`, pending feedback, returned multiplier and credited balance. Repeat delayed response, rollover, offline, automatic exit and 1.00x scenarios.
- Measure actual production response time after authorized deployment; no production latency claim has been made.
- Mirror server code safely in all deployment branches, execute scoped Firebase deployment, publish the pinned Vercel client, verify the production SHA.

New changes have NOT been deployed to production while these gates remain blocked.
