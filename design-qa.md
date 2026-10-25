# SYNGA POKER design QA — 2026-10-25

## Findings

- **P1 — Exact visual fidelity remains incomplete.** The supplied lobby uses Halloween artwork, event promotions and a specific lower navigation bar. The implementation uses reconstructed courtyard artwork and the existing club features. The table room also differs in floor, dealer framing and lighting. Evidence: full-view comparisons below. Replace remaining reconstructed artwork with matching seasonal assets and finish those compositions before claiming a one-to-one result.
- **P2 — Typography and icon treatment differ.** Barlow Condensed follows the display direction, but lettering, compact labels and custom gold icons are not identical. Some controls still use text symbols. Replace those with matching assets and tune type sizes/spacing against focused captures.
- **P2 — Secondary screen fidelity is incomplete.** Management, club rewards and some card game controls reuse existing layouts with the new color theme. These screens need their own visual pass.
- **Resolved — Dense table controls covered a lower player.** At 844 × 390 with six Omaha seats, the action dock overlapped the sixth seat. Dense tables now reserve 86px beneath the room. The final mobile capture shows player labels and action controls separately.
- **Resolved — Hero labels and hidden cards collided.** Hero placement, separate name/balance rows, hidden-card positioning and the redundant felt caption were corrected. The final table comparison shows readable balances and cards.
- **Passed for the latest branding request.** ORIZIS appears at both entrances. Shipped interface text, account pages, manifest, service worker, export labels and brand icons use SYNGA POKER. An automated check guards against previous names returning to product text.

## Visual truth and normalization

Source lobby: `/workspace/scratch/91af4316c513/upload/04-1000519072.jpg`.
Source active table: `/workspace/scratch/91af4316c513/upload/08-1000519076.jpg`.
Both sources are 1536 × 709 pixels, normalized to 1280 × 592 for comparison with the browser fixture at 1280 × 592 CSS pixels, density 1. Captures exclude the surrounding canvas; a one-pixel crop rounding difference is immaterial.

States differ: the reference contains public-game events and large balances; the implementation contains sample club tables, existing game features and sample balances. The implementation shows the local player's controls; the source shows another player's action. These differences do not establish exact fidelity.

Implementation evidence:

- `qa/lobby-full.jpg` / `qa/lobby-1280.jpg`: lobby, 1280 × 592.
- `qa/table-1280.jpg`: earlier table iteration.
- `qa/table-final-full.jpg` / `qa/table-final-1280.jpg`: final five-seat table, 1280 × 592.
- `qa/mobile-landscape-full.jpg` / `qa/mobile-landscape-final-full.jpg`: six-seat Omaha before/after action-area correction, iframe 844 × 390, screenshot canvas 1363 × 936.
- `qa/orizis-intro.jpg` / `qa/preview-orizis-intro.jpg`: both entrances, 1363 × 936.

Full-view combined inputs opened and inspected: `/workspace/scratch/91af4316c513/reference-review/synga-lobby-comparison.jpg`, `synga-table-comparison.jpg` and `synga-table-comparison-final.jpg` in the same directory.

Focused combined inputs opened and inspected: `synga-lobby-detail.jpg`, `synga-table-detail.jpg` and `synga-table-detail-final.jpg` in that directory. These examine display type, tile artwork, hero hand and labels. Different lobby tile positions are noted; the focused lobby view is not a pixel alignment test.

## Required fidelity surfaces

| Surface | Assessment |
|---|---|
| Fonts and typography | Condensed display font and hierarchy implemented; exact lettering and label metrics differ. P2 remains. |
| Spacing and layout | Landscape carousel and stakes chooser implemented. Hero labels and six-seat controls corrected. Secondary screens still need comparison. |
| Colors and tokens | Red/burgundy panels, gold borders, green actions and blue night backdrop follow the reference direction; lighting and textures differ. |
| Image quality | Actual APK Texas/Omaha art is sharp at the captured size. Generated room/courtyard art and symbol icons prevent exact fidelity. |
| Copy and content | SYNGA POKER and ORIZIS are correct. Club/game features preserve the existing product. Preview data is visibly marked. |

## Browser checks and iteration history

Local implementation: `http://terminal.local:4173/`, `preview.html`, and fixtures under `tests/ui/synga-preview.html`.

1. Initial table iteration identified small avatars, mixed action-button colors, hidden-card sizing and hero-label collisions. Updated CSS and recaptured `qa/table-1280.jpg`.
2. Replaced interim Texas/Omaha tile art with APK artwork; compared `qa/lobby-full.jpg` with the source. Seasonal background/icon differences remain above.
3. Centered player information, supplied varied existing avatars and removed the redundant felt caption. Recaptured `qa/table-final-full.jpg`; opened full and focused final comparisons.
4. Reserved an action area to fix six-seat mobile overlap; inspected before/after captures. Portrait poker displays a rotate instruction; it is not claimed as a full portrait playing layout.
5. Navigated through ORIZIS at both entrances. Verified the next page title and visible branding are SYNGA POKER.

Interactions checked: lobby carousel, Texas table selection, Omaha six-card selection, table entry/return, navigation, sound settings/sample buttons, Durak and Chinese Poker entry. Automated UI suites cover management/accounting. Console checks reported no application exceptions; extension metadata/Tailwind CDN notices were non-blocking. No listening comparison was performed. Real authentication/multiplayer writes were not tested because the separate backend is not configured.

## Implementation checklist

- Obtain/recreate remaining matching assets and finish typography/icons.
- Review secondary screens and denser table variants against references.
- Configure the independent backend and validate multiplayer before deployment.

The latest ORIZIS/SYNGA branding change is verified. The broader one-to-one redesign retains the P1/P2 findings above and is not a completed production release.

final result: blocked
