# Supplied screen redesign — v334

final result: passed

Scope: completes the remaining supplied screen types after the v330 Counter/Club Members release: club selector, lobby, table buy-in, ORIZIS intro, navy NLH and teal Omaha tables. The existing live game engine, settlement calculations and transfer authorization are retained.

## Evidence

Source images: `../upload/02-1000515887.jpg`, `03-1000515884.jpg`, `05-1000515878.jpg`, `06-1000515875.jpg`, `07-1000509952.jpg`, `08-1000519746.jpg`.

Each reference and browser rendering was normalized to a 369 × 800 viewport and inspected side by side. Internal evidence: `docs/review/remaining-screens-comparison-v333.jpg` and the six individual `*-comparison-v333.jpg` images. Browser canvas outside the iframe was cropped; screenshot scale was normalized when the browser capture used a smaller backing resolution. These internal screenshots are excluded from deployment.

The local `/tests/ui/gg-preview.html` loads the production components and styles, with simulated accounts and denied writes. Intro mode extracts the actual intro markup and holds it for inspection. Normal production intro still dismisses automatically or on tap. Narrow 320 × 640 lobby was reviewed in addition to the reference viewport.

## Fixes and verification

- Replaced the unrelated spiral orb and green felt artwork with transparent smoked-glass club artwork and a blue portrait table material. Personal felt color selection remains available and uses hues relative to the new blue material.
- Restored source-like vertical rhythm in the club picker, rounded code entry, large selected balance and circular carousel. Existing swipe, keyboard, archive, create and join behavior remains tested.
- Added a compact club identity/balance/notice header with role-appropriate account navigation. Removed the duplicate legacy wallet. Table creation controls share the masthead, keeping the table list high on the screen.
- Reworked poker rows into title, players, buy-in and VPIP columns, with variant-colored edge accents. Existing table actions, waitlists, tournaments and return-to-seat actions remain available.
- Added composable Running Tables/Hide Full Tables filters and buy-in/player sorting. Automated tests cover phase changes, full tables, combining/resetting filters, sorting, and no game writes.
- Matched the buy-in dialog proportions, amount slider, action hierarchy and chair icon. Browser keyboard adjustment changed 40.00 to 41.00; Spectate displayed the table; selecting the sixth seat displayed “Seat 6 — buy-in” while preserving the amount. No live seat or monetary operation was submitted.
- Spectators see all unoccupied physical seats instead of a single generic vacancy. Tests verify occupied-seat exclusion, unique visual positions and choosing a seat without submitting a buy-in. Seated players retain the tested compact presentation and server-owned seat indices.
- Retained the board collision rules, 2–6 hole-card fans, RIT, showdown, GOD permissions and existing table menus. No engine or backend changes.
- ORIZIS uses the supplied dark shell, white wordmark, cyan divider and loader. Reduced-motion settings are respected.
- Fixed high-priority spacing, duplicate navigation and narrow-header wrapping issues. No open P0/P1/P2 findings remain in this scope.

## Validation

39 UI suites passed across the initial run and focused continuation after the duplicate settlement entry was fixed. The spectator-exit assertion now excludes the independent `pkTick` heartbeat while still forbidding all other commands. All 73 repository unit tests and all 20 predeploy checks passed. The CI workflow repeats the full suite before merge. The concurrent audio recovery from PR #74 is retained, and the shell cache advances to v334. The modified spectator test uses a synthetic allowlisted email instead of publishing a personal address.

## Deliberate adaptations and limits

- Production club logos, balances, player names, avatar art, card values, capacities and table counts are live data; reference screenshot values are not hardcoded.
- The source Union button maps to the existing Results destination; no federation service is invented. Missing public VPIP statistics are shown as an em dash with an explanation, never a fabricated percentage.
- Other supported games, LIVE filtering, tournaments and authorized management tools remain accessible even though not all appear in the source screenshot. Active-hand state and card count can alter table occupancy and reveal layouts.
- Illustrated coin/chip artwork and minor typeface differences remain P3 visual differences. The new table material follows the navy reference; Omaha uses a teal treatment while preserving the common renderer.

---

# Counter and Club Members design QA — v330

final result: passed

Scope: the existing POKERTEN Counter and Club Members screens, plus the transfer review flow. This is not a claim that every supplied game screen was rebuilt. The existing club selector, lobby, buy-in and table styling is preserved.

## Evidence and normalization

- Source visual truth: `../upload/01-1000515890.jpg` (Counter) and `../upload/04-1000515881.jpg` (Club Members), each 709 × 1536 pixels.
- Browser-rendered implementation: `docs/review/counter-v330.png` and `docs/review/members-v330.png`, each 369 × 800 pixels. These are local QA evidence, excluded from the source commit.
- Cloud browser preview: `/tests/ui/gg-preview.html?mode=cashier&width=369&height=800&bare`, served by the existing application source with fake Firebase reads and denied production writes.
- CSS viewport: 369 × 800; screenshots are one pixel per CSS pixel. Source captures were downsampled to 369 × 800 for comparison. Surrounding desktop canvas was cropped from the browser screenshot; app content was not rescaled.
- State: dark theme, Trade / All / descending chip balance; Members / Member List / All. Fixture identities and amounts differ intentionally from the source. No members are selected in the comparison capture; disabled transfer buttons therefore differ from the reference's active buttons.
- Full-view combined inputs opened and inspected: `/tmp/counter-comparison-approved.jpg`, `/tmp/members-comparison-approved.jpg`.
- Focused comparison: `/tmp/counter-focused-qa.jpg` covers balance summary, role selector, search/sort and first card. Text and icon alignment are readable at this scale.
- Narrow viewport: 320 × 640, captured in `/workspace/scratch/counter-compact-final-v330.jpg`; the claim dialog scrolls and confirmation/cancel remain reachable. No horizontal overflow at either tested size.

## Findings and iteration history

1. **Resolved P2 — initial density and title override.** The inherited management heading style and oversized summary pushed the fourth card below the footer. Reduced the summary to the reference proportion, scoped the 20px title, tightened card spacing and moved select-all into the heading. Evidence: `/workspace/scratch/counter-first-pass.jpg` versus the final combined Counter comparison. Four sample cards and the pinned action bar now fit at the matched viewport.
2. **Resolved P2 — Members content order and vertical offset.** Initial implementation retained the Counter tabs and excess top spacing. Members now has its own title, Member List / Applicants List, search, role filters, count/sort row and cards in the reference order. Reduced the header offset; final combined Members comparison shows the corrected density.
3. **Resolved P2 — sort label clipping.** Explicit scoped type size and flexible search/sort columns keep Chip balance readable. Rechecked in the focused comparison and narrow view.
4. **No remaining actionable P0/P1/P2 findings** within this scope. The transfer review is additional functionality not pictured in the reference and was assessed for usability separately.

## Required fidelity surfaces

- **Typography:** existing sans-serif stack retained, matching the reference's neutral UI type. Explicit heading weight/size, smaller muted IDs/aliases and tabular balances preserve hierarchy. Labels do not collide; long names truncate rather than push balances offscreen.
- **Spacing/layout:** dark rounded panels, thin dividers, two-column treasury totals, compact member cards and bottom actions follow the source structure. The list scrolls independently so controls remain available. The latest normalized comparison was captured after the final spacing fixes.
- **Colors/tokens:** charcoal surfaces, pale blue selected role and active underline, muted blue-grey secondary copy, red Claim Back and green Send Out. Disabled buttons are deliberately dimmer until a selection exists.
- **Image quality/assets:** existing actual profile assets are reused, circularly masked and loaded without distortion. Avatars and national flags from unrelated screenshot identities are not fabricated. Font Awesome library icons are used; no custom CSS or SVG artwork replaces source images.
- **Copy/content:** app-owned labels match the requested Counter, Club Members, Send Out and Claim Back terminology. Functional Members and Results navigation replaces unsupported Send Ticket / Chip Request tabs. Chip balance replaces Fee because the existing data shown is wallet chips, not an invented fee metric. Bonuses, chips at tables and cycle results remain explicitly separate in expanded accounts.

## Interaction and accessibility checks

- Browser: selected all visible members, opened Send Out, entered 100 for each of four members, verified total 400 and club balance preview 5,108.97 → 4,708.97; canceled without a mutation.
- Browser: opened Members and returned to Counter; checked the matching secondary layout.
- Browser at 320px: opened Claim Back and used available balances; verified individual values and total 1,551.59. Confirmation was not submitted to a live service.
- Semantic labeled checkboxes, search and amount fields; role selection has pressed state; native dialog supplies modal focus containment; previous focus restored on close. Errors use alerts and operation status is announced.
- Automated UI: selection resets on search/filter changes, aggregate funding limit, protected bonus balance, precision checks, duplicate-click protection, partial completion, receipt-preserving retry/reload, definitive rejection, pagination through empty filtered history pages, applicants and role restrictions.
- Browser console inspected: no application errors observed. Browser extension metadata errors originated from `chrome-extension://` and were unrelated to app code.

## Follow-up polish and limits

- P3: the existing library chip glyph is less detailed than the illustrated poker-chip artwork in the source. It is consistent across totals, cards and history; exact artwork can be supplied later.
- Dynamic production avatars, member counts and balances will naturally differ from the reference. The preview uses fixture data only.
- Counter v330 was published through PR #73; authenticated live financial actions were not executed. Multi-member operations are individually atomic, not a single all-or-nothing batch; completion status is exposed per member.

## Implementation checklist

- [x] Compare source and rendered implementation together at equal dimensions.
- [x] Fix and recapture all actionable P2 differences.
- [x] Verify normal and narrow mobile screens and primary review interactions.
- [x] Check UI, backend authorization and existing transfer regression tests.
- [x] Keep local preview running and open for review.
- [x] Publish approved source and deploy backend before the dependent frontend.
