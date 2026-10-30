# SYNGA Midnight Arena design QA — 2026-10-30

Source visual truth: selected third ideation image, `../generated_images/exec-52051200-1b47-450e-8364-ebab3e3c3c3e.png` (1672×941). Original stored in ChatGPT Library as Midnight Poker Arena Interface.png.
Implementation: `qa/midnight/desktop.jpg`; combined comparison `qa/midnight/comparison.jpg`.
Viewport: 1280×720 CSS game frame, density 1; source normalized to 1280×720. Browser outer viewport 1363×936; game frame cropped at x42,y0. Same five-seat NLH flop, hero AK, board 774, pot115.5. Countdown/equity vary with runtime and are not hard-coded to the image.
Mobile: 844×390 CSS frame; game preserves 16:9 inside frame. Evidence `qa/midnight/omaha-mobile.jpg` and `qa/midnight/nine-mobile.jpg` retain surrounding browser canvas.

## Comparison history / fixes
- P1: percentage-sized grid table initially collapsed. Explicit shared 1600×900 scaling restored table, seats and cards.
- P1: legacy translate plus new transform applied board avoidance twice. Disabled legacy translate; one measured displacement remains.
- P2: dense showdown card lanes collided with lower seats. Distributed nine-seat rail rows and used inward side-card lanes with separate result labels.
- P2: mobile Omaha side card backs touched hero/actions. All middle/lower side fans now use inward lanes. Final mobile capture shows six readable hero cards and unobstructed actions.
- P2: new details shortcut could leave the table menu open behind it. Shortcut now closes menu before opening details. Existing focus-return behavior remains; poker table test passes.

## Required fidelity surfaces
- Typography: retained Barlow Condensed for compact game actions and existing card typography, explicit scalable labels and tabular stack values. Names are readable and truncated for long names. Slightly narrower action font than concept is accepted to preserve family consistency.
- Layout: selected lower-left hero and lower-right actions, centered pot/flop, wide blue table, slender context header. Empty board slots no longer offset the flop. Dense seat variants have their own inward card lanes.
- Colors: navy backgrounds, ice-blue seat borders, coral raise button, pale blue call, graphite fold. Club hub/navigation/modals adopt same palette while existing red/gold club crests retain brand continuity.
- Images: generated empty blue table and original SYNGA wordmark; existing real avatar assets and live card/chip components retained. No screenshot flattened over game controls. Table optimized to 169KB WebP.
- Copy: real club/variant/stack/pot/time data. No fictional static chip counts. English controls. Preview-only labels remain in the safe fixture.

Full-view evidence: combined source/implementation comparison opened and reviewed. Focused hero/board/action regions are readable in the full 1280px captures and were inspected in the browser at actual size; additional cropped comparison not needed.

## Interactions and checks
Browser: club entry → lobby → Texas selection → Play Now; raise panel open/close; sound dialog; NLH; Omaha6; six-seat showdown; nine-seat NLH showdown. Final mobile controls clear of cards. No app-origin console errors observed; browser extension metadata errors are unrelated.
Automated: 20 predeploy checks, isolation tests, poker-table behavior including authoritative CALL confirmation, SYNGA presentation/membership controls, board lane logic, fullscreen suite passed. Updated only old material/centered-hero expectations to match approved design.
Known existing test gap: table-menu-roles.test.cjs expects POKERTEN's old privileged accounts; it fails identically against unmodified HEAD. Auth permissions were intentionally not modified to satisfy that obsolete fixture.
Live funded hand / cashouts / server payout smoke not performed. Browser gameplay used write-blocked sample fixture; backend was not changed.

## Follow-up polish
P3: wordmark retains a faint navy rectangular matte, and chip/seat treatments are slightly flatter than concept. Existing chat opens a functional panel instead of adding a decorative full-width composer/reaction strip. No new reaction system was introduced.

Implementation checklist: generated assets installed; layout collisions fixed; controls verified; no Firebase/rules/functions modifications; cache bumped to synga-shell-v333.

final result: passed
