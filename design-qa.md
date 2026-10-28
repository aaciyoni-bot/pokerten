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
