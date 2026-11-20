# Classic restoration — release 382

The user rejected Silver and requested the complete earlier appearance while keeping the implemented fixes. The visual source is the archived release 378 (`35ad6b7add33443b272b95ad94f847ad0af3665c`). All 21 original stylesheet references and file contents match that archive. Silver overrides, the redesigned game cards, banner and bottom bar are removed; new functional controls use the existing Classic styles.

Archived/current browser comparisons: club carousel at 390 × 844 and sign-in at 320 × 568. The original artwork, sphere shapes, buttons, colors and spacing match. The retained Wallet route was opened from the original balance control; it remains available in the original shell navigation. Lobby checks at 390 × 844 and 320 × 568 verified scrolling and the persistent seat-return control; the narrow lobby has scrollWidth = clientWidth. Desktop management was checked at 1100 px. Large buy-in amounts retain readable wrapping without splitting digits.

The App data/session lifecycle, GOD authorization function, PokerTable and card-game implementations are byte-identical to release 381. Existing UI, core, native-update and predeploy checks passed. Physical-device and live-game acceptance remain open. The following Silver notes are historical, not the current design.

# Historical Silver club shell — release 379

Status: browser and automated checks passed; live multiplayer/native-device acceptance remains open.

Reference: user-provided `01-1795158934667.jpeg`, 20 November 2026. The direction is a dark navy/black shell, silver controls and borders, blue highlights, variant colors, compact table rows and bottom navigation. This is a functional adaptation, not a pixel-identical reproduction. Production events, balances and counts come from existing data; the image's sample values are not copied.

## Browser evidence

`docs/qa/pokerten-379-lobby.jpg`: actual production LobbyView in an isolated preview, 390 × 844, simulated data with all network writes denied. Cloud-browser checks covered lobby, variant filtering, vertical scrolling, wallet navigation and accounting display, profile, club carousel, manager overview and the new sign-in appearance. The 320 × 568 lobby had clientWidth = scrollWidth = 320.

Corrections made after visual review: forced readable active navigation/tab colors over old styles, included the production body stylesheets in the preview, replaced the missing management arrow glyph with an existing icon, and fixed a legacy 14 px View-button width that clipped its label. The final browser capture of the table rows showed the full View label.

No game-table felt, card geometry or game animation CSS was changed. The new shell is scoped to non-table views. Card/table menu and navigation behavior remain covered by existing UI tests.

## Validation and limits

21 predeploy checks; 394 engine/server/runtime tests; complete UI suite; engine smoke; 28 updater/native-update tests passed. New regression coverage exercises sign-in timeouts, stale lobby callbacks, cache-versus-server emptiness, preserving an all-in seat on a temporary lobby visit, and receipt-preserving regional fallback. No application errors were observed in the preview console.

The reference has custom geometric artwork and an event-heavy first screen; the implementation reuses existing brand assets and displays an event banner only for real registration data. Profile information density, full Hebrew coverage, active-game timing and device/soak testing remain backlog items. Financial request approval is not implemented by the new manual-transfer guidance card.

Classic source/design is preserved at `archive/pokerten-classic-2026-11-20`, commit `35ad6b7add33443b272b95ad94f847ad0af3665c`.

---

## Historical QA (release 336, not current proof)

# Login reference — release 336

final result: passed

## Visual truth and evidence

Source: `../upload/01-1793175602285.jpeg` (709 × 1536 pixels).
State: signed out, no error, Google/player-code choices. Actual production AuthView and styles are loaded in the read-only local fixture; writes are denied.
Viewport: 393 × 852 CSS px, device pixel ratio 1. Source normalized to 393 × 852; browser screenshot cropped to the same content rectangle from a 1363 × 936 viewport.
Initial browser capture: `/workspace/scratch/pokerten-login-v336-first.jpg`.
Final browser capture: `/workspace/scratch/pokerten-login-v336-final-full.jpg`; normalized final: `/workspace/scratch/pokerten-login-v336-final.jpg`.
Full-view side-by-side evidence: `docs/review/login-comparison-v336-final.jpg` (source left, implementation right). Compared both in the same image. The wordmark, title, buttons and footer are readable at this size, so a separate magnified comparison was unnecessary.

## Comparison history

First comparison (`docs/review/login-comparison-v336-first.jpg`): P2 button text was too large, Google glass rim too bright, and orb began slightly too low. Reduced action text from 4.4 to 3.9 cqw, reduced primary texture opacity, moved actions up 1 cqw with compensated divider spacing, and enlarged/raised the orb while preserving heading position.
Second comparison: reloaded and recaptured the rendered page after those fixes. No actionable P0/P1/P2 differences remain.

## Required fidelity surfaces

- Typography: Arial bold heading and controls closely match the supplied sans-serif hierarchy. The metallic brand lettering is a raster wordmark derived from the reference. Live editable text preserves the exact source copy. Minor weight differences are P3.
- Spacing: source proportions drive the wordmark, central glass sphere, icon, headline, introduction, full-width pill controls, divider and brand footer. All scale within a capped portrait column; no fixed-position form controls.
- Colors: near-black background, white heading, muted blue supporting copy, cyan glass controls. Dark form/error states retain readable contrast.
- Images: generated background and button textures use the selected reference; the existing glass sphere and P10 logo are reused. The official Google G asset remains in its original aspect ratio. The existing sphere highlights differ slightly from the screenshot (P3). No screenshot is used as a flattened functional page.
- Content: both entry choices and branding match. Version/update and sound-check controls remain below the footer as an intentional operational addition.

## Functional and responsive checks

Cloud browser at 393 × 852 and 320 × 568: default choices, opening code form, Back, registration toggle, and simulated Google failure. Error stays visible and Google becomes available again. Code form uses existing authentication component; submit inputs remain at least 16 px and the page scrolls. At the narrow viewport, scrollWidth equals clientWidth; no horizontal overflow.
Automated existing auth suite: Google existing/new account flows, preserved balance, profile retry, code login/registration, and absence of SMS paths passed. All 20 predeploy invariants passed. Three updater tests passed. No live account or game mutation was performed.
Console: no application errors on the final fresh narrow-page run. Browser-extension metadata warnings are unrelated. Initial in-progress syntax error was corrected before the successful auth suite and final captures.

## Follow-up polish and limits

P3: raster reflections and tiny brand/footer letterforms are close reproductions, not pixel-identical source artwork. An actual device software keyboard was not available; a narrow scrollable viewport and 16 px form fields were verified. Existing production Google identity provider logic is unchanged.
