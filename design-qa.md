# SYNGA POKER — automatic landscape, intros, clubs and sound QA

Date: 2026-10-25. Scope: the requested automatic rotation, ORIZIS → SYNGA entrance, clubs in the existing visual theme, and playable sound demonstration. The previous proportions assessment is preserved in design-qa-landscape.md. Broader exact-artwork differences remain in design-qa-full-redesign.md.

## Findings and resolutions

- Resolved P1: portrait no longer blocks the user with a rotate notice. One landscape iframe rotates the entire experience 90° when needed, including both intros, controls and dialogs. Resizing preserves the running game's state.
- Resolved P1: clubs were absent from the default preview. The preview now opens MY CLUBS, with membership cards, actual club selection, six-digit code lookup, creation and archived-club entry where authorized. Existing ClubsView supplies permissions and all server callbacks.
- Added a short animated SYNGA entrance following the unchanged ORIZIS block. ENTER and Escape skip it. Replay keeps the game mounted and remains open until the user enters.
- Added a 15-second MP3 demonstration and ten individual event buttons, using the existing audio integration. The browser loaded and played the MP3 (readyState 4, paused false, currentTime advancing). This is playback verification, not an auditory fidelity comparison.
- Resolved P2 during review: inherited blue club-dialog CSS overrode the new palette. The creation/join dialogs now use the same burgundy and gold styling; the complete creation form fits the tested phone viewport.

## Visual evidence and comparison

Reference: ../upload/04-1000519072.jpg, 1536 × 709. Combined full and focused comparisons: qa/clubs-theme-comparison.jpg and qa/clubs-theme-detail.jpg. Both reference and implementation are present in each comparison. The source has game/promotion cards; the new screen contains club cards, so content and card count intentionally differ. Shared treatment: burgundy bars, gold borders/ribbons, green entry buttons, condensed white headings and landscape imagery. No reference club screen was supplied.

Browser screenshots: qa/new-clubs-landscape.jpg; qa/automatic-portrait-clubs.jpg; qa/synga-intro-landscape.jpg; qa/synga-intro-automatic-portrait.jpg; qa/sound-demo-panel.jpg; qa/create-club-mobile.jpg. Outer dark space and device controls belong to the test harness, not the game.

Typography, text hierarchy and controls remain readable at 1280 × 592 and 844 × 390. Portrait 390 × 844 displays an 844 × 390 game rotated into the complete available viewport. Existing raster assets remain uniformly scaled; intro logo is 290 × 290 at the larger tested viewport. Club titles, code, balances and action buttons are contained in their cards. The preview label identifies sample data.

## Verification

Browser: portrait clubs → second club → chooser → table; landscape resize preserves both hero cards and open table; return to clubs; intro replay; root index reaches isolated Welcome screen; automatic ORIZIS geometry is within the rotated surface; create dialog opens/closes; audio player plays. Console review found extension metadata errors only.

Automated: npm run check (20 invariants plus isolation, branding and identical ORIZIS); all 38 existing UI suites; the added synga-presentation suite covers original create/join callbacks, membership protection, single iframe, sequential intros, replay without reload and sound controls. JavaScript syntax and git diff --check pass.

## Scope limits

This is the published design preview. Server writes remain blocked. Real accounts, clubs, balances and multiplayer require the separate backend. No original production backend or rules were changed. Exact reconstruction of every source illustration/secondary screen remains separately documented.

final result: passed
