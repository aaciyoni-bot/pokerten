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
- Deployment and authenticated live verification are pending approval. Multi-member operations are individually atomic, not a single all-or-nothing batch; completion status is exposed per member.

## Implementation checklist

- [x] Compare source and rendered implementation together at equal dimensions.
- [x] Fix and recapture all actionable P2 differences.
- [x] Verify normal and narrow mobile screens and primary review interactions.
- [x] Check UI, backend authorization and existing transfer regression tests.
- [x] Keep local preview running and open for review.
- [ ] Publish approved source and deploy backend before the dependent frontend.
