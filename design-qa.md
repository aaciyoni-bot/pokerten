# SYNGA POKER — landscape and proportions QA

Date: 2026-10-25. Scope: the user's correction that the game must be landscape, with the reference's size proportions. This is not approval of the entire earlier one-to-one artwork request; that assessment is retained in design-qa-full-redesign.md.

## Findings and resolutions

- Resolved P1: independent viewport width/height sizing stretched the layout. Every main game surface now uses a single scale unit for a 1536 × 709 landscape stage. Portrait presents an accessible rotate-phone notice and hides game controls until landscape returns; no game state is reset.
- Resolved P2: lobby cards were too tall and the content density differed. At reference scale, main cards are 238 × 324, the promotional column is 238 × 353, the stacked shortcuts occupy 168/139 heights, gaps are 34, the header is 83 and footer 69. Club shortcuts use existing callbacks.
- Resolved P0 during iteration: percentage table width collapsed inside a size-contained grid. Explicit stage-unit dimensions restored the full table.
- Resolved P2 during iteration: four chooser detail rows overflowed their cards. Waiting information now shares the player row, and three rows fill the card. Selecting another table centers it in the carousel.
- Resolved P2 during iteration: six-seat hidden cards intersected the action dock. Dense seats use 0.76 of their vertical anchor to reserve the lower action area without shrinking the entire room. Nine-seat browser geometry reports zero intersections between opponent avatars/labels/cards and the action dock.

## Visual evidence

Source visual truth: ../upload/04-1000519072.jpg (lobby), ../upload/06-1000519074.jpg (chooser), ../upload/08-1000519076.jpg (table). Sources are 1536 × 709.

Browser evidence: qa/proportions-lobby-full.jpg, qa/proportions-stakes-full.jpg, qa/proportions-table-full.jpg (1280 × 592 iframe); qa/proportions-mobile-lobby-full.jpg and qa/proportions-nine-seat-full.jpg (844 × 390 iframe); qa/proportions-portrait-full.jpg (390 × 844 iframe). The outer browser screenshot canvas is 1363 × 936 at density 1. Outer dark margins are test harness space, not game content.

Full comparisons opened and inspected: qa/landscape-lobby-comparison.jpg and qa/landscape-table-comparison.jpg. Sources resized to 1280 × 591 and implementation cropped to the same game area. Focused comparisons: qa/landscape-lobby-detail.jpg and qa/landscape-table-detail.jpg. Both source and implementation appear in each combined comparison input.

Content/state differences: source public-game promotions and balances versus current club features and sample balances; the source table shows another player's action whereas the fixture shows the local player's action controls. Existing room art, avatars and branded typography differ, as documented in the earlier full-redesign report.

## Measured geometry

| Region | Reference basis | Browser at 1280 × 592 | Browser at 844 × 390 |
|---|---:|---:|---:|
| Game stage | 1536 × 709 | 1280 × 590.83 | 844 × 389.58 |
| Main game card | 238 × 324 | 198.33 × 270 | 130.77 × 178.03 |
| Header height | 83 | 69.16 | 45.59 |
| Footer height | 69 | 57.50 | 37.91 |

The selected second table centered at x=639.64 in the 1280-wide viewport (rounding tolerance <1px).

## Fidelity surfaces

- Typography: the existing families remain; hierarchy, card titles and controls now scale together. No truncated labels in tested primary states. Exact source lettering remains outside this orientation correction.
- Spacing/layout: landscape frame, tile grid, bars, chooser and table share proportional dimensions. Portrait no longer becomes a vertical lobby.
- Colors/tokens: existing burgundy, gold and green remain unchanged; this revision changes dimensions and orientation.
- Image quality: existing PNG/WebP assets scale uniformly. Texas art can protrude above its card without clipping. Different seasonal art remains documented in the broader review.
- Copy/content: SYNGA POKER and ORIZIS preserved. New orientation message explains the required landscape view in Hebrew and English. Preview sample-data label remains visible.

## Verification

Browser: lobby → Texas chooser → table → lobby; selection centering; club tables dialog open/close; landscape phone, five/six/nine-seat table rendering; portrait notice. Console checked: extension metadata errors only, no observed application errors.

Automated: npm run check (20 invariants plus isolation/branding/ORIZIS); npm run test:ui (38 suites); JavaScript syntax; git diff --check. These are UI/design-preview checks. Real multiplayer transactions are unavailable while the independent backend is pending.

## Implementation checklist

- [x] Preserve one landscape coordinate system.
- [x] Replace portrait game layout with a rotate-phone notice.
- [x] Match principal lobby/card/bar proportions.
- [x] Keep dense players clear of the action dock.
- [x] Verify existing navigation and mandatory checks.
- [ ] Continue the separately documented full artwork/secondary-screen redesign.

final result: passed
