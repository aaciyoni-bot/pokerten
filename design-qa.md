# POKERTEN v312 custom menu artwork and English-only interface — 2026-10-05

## Scope and visual targets

The user rejected the v311 emoji-like menu icons and requested a more polished, colorful set, then required all POKERTEN interface copy to be English. The source menu composition remains `01-1000503588.jpg` (709 × 1536); the custom icon atlas was generated specifically for the revised visual request. The prior screen structure, actual game state, access permissions and accounting calculations are retained.

The built-in Image Gen output is a 1402 × 1122 transparent atlas with 20 consistent sculpted, jewel-colored icons. Its WebP delivery asset preserves the original dimensions and alpha, reduces transfer size to 570,314 bytes and uses a documented 5 × 4 grid. The menu uses 48px decorative image slots, accessible text labels and the existing colored borders. Sound/mute, return-to-seat and fullscreen states have corresponding artwork.

## Evidence and findings

- Source: `/workspace/scratch/d59203ac15fb/upload/01-1000503588.jpg`.
- Initial rendered menu: `/workspace/scratch/pokerten-v312-menu-full.jpg`, 1348 × 926 browser raster. The complete iframe crop is 365 × 791px for its 369 × 800 CSS viewport; comparison normalizes both reference and implementation to 369 × 800.
- Initial full-view comparison: `/workspace/scratch/pokerten-v312-design-comparison-before.jpg`.
- Authentication: `/workspace/scratch/pokerten-v312-auth.jpg`; management: `/workspace/scratch/pokerten-v312-admin.jpg`; settlement: `/workspace/scratch/pokerten-v312-settlement-mobile.jpg`.
- P2: the English management tab "Agents & commissions" truncated at 369px (143px content in a 101px label). Shortened the tab to "Agents"; the full section heading retains the meaning.
- P2: the generated atlas had a few edge pixels from an adjacent cell visible beside the single bot icon. Applied a 3% inset to the decorative sprite viewport; this trims only the cell gutter without changing button layout or icon identity.

## Required fidelity surfaces

| Surface | Review |
| --- | --- |
| Typography | Existing app typography and hierarchy retained; English labels and accessibility copy replace Hebrew, with LTR form alignment and appropriate wrapping. |
| Spacing | Four-column menu and two-column volume tile retained. 78 × 84.98px buttons at 369px width; 9px gaps; no menu label overflow. Mobile reports retain contained horizontal table scrolling. |
| Color | Sapphire/cyan, amethyst, gold, emerald and ruby artwork matches the colorful outline palette. Existing table color, shell and brand remain. |
| Image quality | Real generated raster artwork, transparent alpha, consistent lighting and metallic/enamel depth. No emoji or hand-drawn substitutes for menu icons. The sprite gutter correction removes neighbor bleed. |
| Copy | English throughout authentication, lobby, clubs, player records, management, settlements, tournaments, chat controls, loading/error messages and server responses. User-entered names/messages and historical records remain as authored. Future generated bot names/chatter use English/Latin spelling. |

## Verification

- Mandatory predeploy checks: 20/20; cache and updated UI asset queries v312. Generated poker-worker and settlement-bundle synchronization passed.
- Full UI suite: 33 suites passed, including role guards, GOD privacy/revocation, cycle-only results and rakeback visibility. Added rendered-English checks for text, aria-label, title, placeholder and alt on controlled English fixtures. Bot-name tests: 4/4 passed, including historical-name preservation.
- Initial combined preview `160c06b3f89a26156323ec7007e5e3f2ed1aba75`, workflow `37259572277`: validation and deployment passed.
- Browser at 369 × 800: authentication, clubs, lobby, management, tournaments (including expanded blind structure), table creation and custom table menu. All inspected interface strings are English and pages remain LTR with no document horizontal overflow. The blind editor fits within 293px and has no horizontal content overflow.
- Settlement browser at 369px: owner/agent/player, no-rakeback player, current legacy cycle, archive, cycle controls, search and expanded details, rake sorting, agent terms and payment-dialog cancellation. Signed results remain visible; player privacy remains intact.
- Menu open/close and sound toggle verified; the muted state selects the matching custom sprite. All interaction tests use synthetic fixtures with real network writes disabled. No authenticated live hand or financial action was performed.
- Browser console reviews found existing extension metadata errors only; no application exception.

Final preview `e6e2045d366f3b1b062b1fad503e263cb63da402`, workflow `37260251222`: validation and deployment passed. The final complete viewport and focused button-region comparisons were opened and inspected against the source: `/workspace/scratch/pokerten-v312-design-comparison-final.jpg` and `/workspace/scratch/pokerten-v312-buttons-comparison-final.jpg`. Final proof: `/workspace/scratch/pokerten-v312-menu-final.jpg`. All custom icons render clearly without adjacent-cell bleed. The shortened Agents tab has matching client/scroll widths of 101px at 369px; all three management tabs remain legible. No remaining visual blocker.

final result: passed

---

# POKERTEN v311 role-aware neon table menu — 2026-10-04

## Reference and comparison

Source: user attachment `01-1000503588.jpg`, 709 × 1536px. Inspected locally at `/workspace/scratch/d59203ac15fb/upload/01-1000503588.jpg`; the attachment is not shipped as an application asset. Compared the full source and final real browser capture at a normalized 369 × 800 portrait size, then compared the focused button region. Proof `/workspace/scratch/pokerten-menu-v311.jpg` is the complete synthetic table viewport, cropped from the browser screenshot (365 × 791 raster pixels for a 369 × 800 CSS-pixel fixture). Supporting full comparison: `/workspace/scratch/pokerten-menu311-comparison-final.jpg`; focused comparison: `/workspace/scratch/pokerten-menu311-buttons-comparison.jpg`.

## Fidelity and deliberate adaptations

| Surface | Final implementation |
| --- | --- |
| Layout and spacing | Four columns, 9px gaps, 78 × 84px tiles at 369px width, two-column volume control, generous close target. The full privileged menu fits a 369 × 650 screen; shorter viewports retain scrolling and safe-area padding. |
| Typography and content | Readable existing typography, one-line Hand history label, real table title, club, blinds and seat count. Sound and sit-out labels reflect current state. Hardcoded GPS/IP status was removed because no supporting implementation exists. |
| Colour and effects | Dark blue translucent overlay over the blurred current table; cyan, purple, gold, green, orange and pink tile outlines and restrained glow. Existing POKERTEN shell artwork remains. |
| Assets and icons | Consistent 44px 3D PNG icons from official Microsoft Fluent Emoji, with MIT licence and pinned provenance in `assets/menu`. Three bot images form Fill bots. Existing POKERTEN brand is retained. Library icons are close adaptations, not exact copies of the user's artwork. |
| Responsive and interaction states | Active/disabled states, keyboard focus, Escape and close behaviour retained. Decorative branding hides on short screens. Fullscreen is retained as an extra final tile; the accessible volume slider uses the existing native control. |

Reference tiles are approximately 71px high at the normalized width; the implemented 84px height deliberately prioritizes legibility and mobile targets. Different live table data, the existing brand mark, icon-library pictograms and slider styling are intentional adaptations rather than pixel-identical claims.

## Findings resolved

- P1: the first preview fixture resolved new icons against production, where they were not yet published. Its base now resolves against the tested project root; all final menu images load, with a regression assertion for preview-origin asset resolution.
- P2: a Tailwind utility overrode the intended gap and wrapped Hand history. Removed the conflicting utility; labels and controls fit their bounds.
- P2: an empty seated-player waitlist strip interrupted the composition. Zero-waiting strips are hidden for seated players while real queues and spectator waitlist access remain.
- Role guards were strengthened: Manage requires actual management permission as well as a callback; Deal now/Unstick require an approved management identity; Spin excludes unsupported Add chips and Straddle actions. No GOD entitlement or server authorization was broadened.

## Verification

- Mandatory predeploy checks: 20/20. Cache and stylesheet version: v311. `git diff --check` passed.
- Full UI suite and final combined preview CI passed, including new role tests for ordinary/pending/banned identities, approved staff, forged GOD profiles, verified same-UID authorization, demotion/revocation and Spin/tournament/closing-table restrictions.
- Final preview commit `3f0a05280217a6871886e203cd20c8cf0938ef4d`, workflow `37237635403`: validation and preview deployment succeeded.
- Browser role checks at 369 × 650 and 390 × 844 passed for player, manager and GOD-only views. Full GOD plus administrator view passed at 369 × 800 and 369 × 650: all images loaded, no label/control clipping, all 15 tiles and volume control visible on the short viewport.
- Actual menu interactions verified: open/close, Details, Hand history, My look/Done, sound toggle, volume adjustment and Escape. Console review showed browser-extension metadata errors only; no application exception was observed.
- Gameplay, bot decisions, balances, accounting calculations and private-card authorization logic are unchanged.

All browser play states use the isolated synthetic fixture with network writes disabled. No authenticated cash/Spin hand was played; the live behavioural smoke checklist remains a user-session check.

final result: passed

---

# POKERTEN v310 larger player presentation — 2026-10-04

## Scope and measured scale

The follow-up reference is `01-1000503394.jpg`: two opponents occupy a large, mostly empty table but their units still look small. The community card size already matches GG (about 80 × 112px versus 80 × 114px in the 709px-wide reference), so the board remains at 60% width. Opponent pods grow by 22% on 2–6 visual-seat layouts when room is available; faces increase from 34px to about 40.6px at 369px width. The local fan grows approximately 5%. Nameplates grow from 68px to 82px, minimum name text from about 9.54px to 12px, and balance text from about 11.13px to 14px.

Seven-to-nine-seat layouts keep the v309 dimensions. Short two-runout layouts also retain the existing card/pod sizes, while their result rows shed surplus padding. Tall two-runout layouts with 2–6 visual seats receive the larger scale. Existing artwork, clockwise seat order, public/private card visibility, game rules, bots, GOD authorization and cycle balances are unchanged.

## Concrete spacing corrections

- Upper/lower rail positions make room for the larger units. Labels are clamped inside the viewport.
- Readable one-line result labels use available horizontal space instead of wrapping into the board or the local hand.
- On enlarged layouts, live bets clear the measured owner label or local fan by 4px. Corrections reset before each measurement, preserving stable resize/re-render placement and existing chip-flight origins.
- The board continues to avoid actual card, pot, name, result and bet geometry without shrinking its cards.

## Verification

- All 20 mandatory predeploy checks passed; shell cache and stylesheet query are v310.
- The full local UI suite passed after the final changes, including GOD privacy/revocation, Pineapple forecasting, cycle-only reporting and full-size board placement.
- The 369 × 650 Pineapple discard fixture has all three cards, separate 4px selection gaps, and no card/board/panel/viewport collisions.
- Final combined preview `8d48a74c1e1b1af6d972f2dae10b099ec8793c36`, workflow `37227761867`: validation and deployment passed.
- Browser verification passed for the exact two-opponent spectator scene, five/six-player PLO6 showdown at 369 × 650, six-player live flop bets, Pineapple discard, and six-player two runouts at 390 × 844. Cards remain complete, readable and inside the viewport. Inspected card/board/name/result/bet intersections are empty. Local bet-to-fan clearance is 4px; the hand-status label remains below the bet without overlap.
- Nine-player Omaha4 two runouts at 369 × 650 retains the verified v309 geometry and clear board. Short six-player two-runout result collisions were removed without shrinking cards. This exceptionally tight layout has no actual intersections but only about 0.63–0.83px between the upper/lower fans and boards, so its conservative 7px `boardClear` diagnostic remains false. The limit is documented rather than suppressed.
- Proof image is a genuine final-preview capture of the two-opponent synthetic scene, cropped to the complete table viewport.

All browser play states use the isolated synthetic fixture with network writes disabled. No authenticated cash/Spin hand was played; the live behavioural smoke checklist remains a user-session check.

---

# POKERTEN v309 GG fan and spacing verification — 2026-10-04

## Reference and scope

The current request supersedes the old v278 separated-hand layout below: restore large community cards and the curved, overlapping GG fan above each avatar, with balanced visible seats. References inspected: `1000503171.jpg`, `1000503178.jpg`, `1000503181.jpg`, `1000503184.jpg` (GG) and `1000503293.jpg` (POKERTEN regression). The 709 × 1536 reference images were compared with portrait renders at 390 × 844 and 369 × 650. Five-seat hidden/revealed states provide the direct comparison; dense tables and two runouts are responsive adaptations.

Existing POKERTEN table artwork, card assets, avatars, colours and controls are retained. No GG logos or assets were copied. Physical seat indices, turn order, dealing, bot policy, GOD authorization and cycle accounting are unchanged.

## Fidelity checks

| Surface | Verified implementation |
| --- | --- |
| Spacing | Five seats use four opposing side positions plus the lower-left local seat. Occupied seats retain clockwise order after a player leaves. |
| Cards | One curved row for 2–6 cards; Pineapple discard uses three separate targets with 4px gaps. Community width is 60%, close to the approximately 59.5% reference. Faces measure 41.875 × 58.625px at 369px width and about 44.4 × 62.15px at 390px. No dense-table board shrinking. |
| Typography | Existing rank/suit typography retained; 10 remains readable in overlapping fans. Result labels wrap or use available rail width instead of covering another hand. Full GOD potential labels remain readable. |
| Colour/assets | Existing blue, green and gold felt, four-colour card faces, player avatars and POKERTEN branding retained. |
| Copy | Existing names, amounts and hand classes retained. Synthetic preview no longer fabricates a winner inconsistent with its dealt cards. |

## Iterations and corrections

1. Removed two-row dense fans and the 40%/48%/230px board caps. Rebalanced 5/6/8/9-seat presentation and kept the hero's bet and hand status attached to the hero.
2. Measured each board and the narrow pot separately. Hole cards retain 7px clearance; text/bet panels use 1px. Impossible bounds are reported as obstructed. Top bets follow the actual owner label height, keeping tall stacks below the balance.
3. Browser QA found dense short-screen result text touching adjacent hands. Short dense top seats use unused upper space; two-runout upper seats move with their bets. A top GOD badge has its own lane above the fan and clears the menu.
4. Cross-seat diagnostics were strengthened to include result metadata. Long top/lower result labels use the available horizontal rail space; card faces and font sizes remain unchanged.

## Verification and limits

- Mandatory predeploy check: 20/20. Generated poker worker is unchanged and matches its source policy.
- Full UI suite passed, including table order/seat removal, GOD private-card consistency and revocation, Pineapple preflop forecasting, accounting and cycle-only player visibility.
- Board tests cover full-size single/double rows, narrow-pot geometry, per-obstacle clearances, stable repeat placement and insufficient-height reporting.
- Preview fixture tests cover complete 2–6-card local hands, realistic unique deals, public/GOD snapshot consistency, explicit impossible-deck geometry stress and cross-seat result-label detection.
- Browser checks cover five-seat Omaha 6 showdown/hidden hands, six-seat Omaha 6 live bets, eight-seat Omaha 5, nine-seat NLH GOD, nine-seat Omaha 4 two runouts, Pineapple discard and the long GOD potential badge. Menu and raise-panel open/close were verified without submitting a game action.
- Browser console showed the existing Tailwind CDN warning and browser-extension metadata errors; no application exception was observed.
- All browser play states use an isolated synthetic fixture with network writes disabled. No authenticated cash/Spin session was played; the live behavioural smoke checklist in PREDEPLOY.md remains a post-deploy user-session check.

Final result: passed for the inspected mobile render states. Final preview `48d75a4b872a58bb049834646d535adedb6462d1`, workflow `37225829715`, passed validation and preview deployment. The remaining eight-seat Omaha 5 all-in/two-runout and nine-seat Omaha 4 two-runout cases both report `boardClear=true`, complete hero hands and zero card/board/result-label/viewport collisions. The full-size community faces remain 41.875 × 58.625px at 369px width. The five-seat proof is a real browser capture of the synthetic fixture, cropped to the entire table viewport. Production deployment is verified separately in the release handoff.

---

# Archived: POKERTEN v278 layout verification — 2026-09-21

## Reference and scope

User-supplied ClubGG image `477c9910-77ed-400d-8824-37ee59803f77.png`, 738 × 1600. Compare its seven-seat spectator flop against the actual application at 369 × 800. Full reference and full rendered portrait were inspected together, followed by DOM measurements and focused card/seat/bet checks. Reference source is retained in the user's uploaded file; it is not an application background.

The request is table proportions and placement with POKERTEN branding, plus readable six-card hands, GOD view and a return action beside the local seat. The GG reference places opponent backs over an avatar; the user's explicit requirement to keep avatars visible takes priority, so hands occupy separate lanes. Existing POKERTEN artwork, chip denomination rendering and controls are retained. There is no supplied GG screenshot for seated controls, GOD view, two boards, short screens or nine seats; these states are adaptations, not claims of pixel-identical GG screenshots.

## Measured reference comparison

Coordinates are CSS pixels at 369 × 800. Reference raster boundaries are approximate to a pixel.

| Anchor | Reference | Rendered |
| --- | --- | --- |
| Far left avatar centre | 93.5, 144 | 93.5, 144 |
| Far right avatar centre | 276, 144 | 276, 144 |
| Upper left avatar centre | 40, 250 | 39.984, 250 |
| Lower right avatar centre | 329, 473.5 | 329, 473.5 |
| Local avatar centre | 59.5, 615 | 59.5, 615 |
| Far avatar diameter | 53 | 52.984 |
| Local avatar diameter | 72.5 | 72.5 |
| Board top | 370 | 370 |
| First board card left | 74 | 73.805 |
| Game details baseline area starts | 504 | 504 in corresponding spectator state |
| Collected pot top | 461.5 | 461.594 in corresponding spectator state |
| Table far / near rail | about 140 / 744 | about 140 / 744, visual raster inspection |

## Findings and corrections

- P1: far seats were at 14% instead of the reference's 18% height. Seven-seat geometry now uses measured anchors. Dense eight/nine-seat rows keep their compact adaptation.
- P1: local avatar was 64px and its centre was slightly right/low. It is now 72.5px and centred at the reference target. The whole local seat, including its nameplate, is at lower left.
- P1: increasing avatar size exposed an All-in nameplate overlap. The nameplate starts at the avatar's lower edge and grows downward when a badge appears.
- P1: far and upper six-card showdown fans touched after moving the top seats. Dedicated card lanes, outside result badges and a separate upper bet lane remove these collisions.
- P2: interpolated upper/lower avatar diameters differed from the supplied image. Explicit measured row sizes replace the interpolation.
- P2: watermark touched a lower six-card fan. Its font and vertical clearance now leave both the hand and bet labels readable.
- P1 from earlier work: GOD mode reduced table height; its runout now occupies the utility row without moving the stage. The return-from-sit-out button is attached to the local seat. Turn status stays on the felt.

## Fidelity and content

Table and seat anchors were measured, not eyeballed from a mockup. Existing Arial/Heebo typography, POKERTEN avatars/wordmark, personal felt colour and under-rail lighting remain. Card count, pot composition and game detail text come from real table state. No rules such as VPIP restrictions or multiple runouts are advertised when not configured. GG's proprietary logos, avatar images, flag/rank badges and header are not reproduced. These asset/content differences remain; this is not a pixel-identical copy of the entire GG app.

## Verification

Candidate 7cd1c0cc (following dcc59a42): all 20 predeploy invariants, game/worker/bot and 12 UI suites passed in CI. Server and Firestore security workflow passed. Browser checks use isolated synthetic table data with no balance writes.

Browser checks at 369 × 800 found no persistent card/other-seat/control/bet overlap and no offscreen hand for full Omaha 6 with hidden backs, GOD flop, revealed showdown with All-in badges, two boards, sit-out, Omaha 4/5, Pineapple discard, and nine-seat NLH showdown. The local avatar centre is 16.1247% width and 76.875% height. The 320 × 640 compact layout and 1100 × 800 desktop also passed the same collision checks. GOD runout was confirmed rendered, and the return button was confirmed inside the local seat.

A follow-up two-board check found the upper row touching the first board and an older rule hiding the caption. Both were corrected: on tall screens two boards are centred at 47.5% height and the game details stay at y=538. The corrected full Omaha 6/GOD/two-board view passed with branding visible.

Independent local evaluator verification covered all 7,462 five-card rank classes on server/client/worker. Six- and seven-player Omaha 6 all-in runout tests passed, including complete boards and chip conservation. The local runout check initially could not start because function dependencies were absent from the recovered checkout; after npm ci it passed. CI also passed these tests.

Final result: passed for measured table/seat proportions and the verified interaction states. Full pixel identity of GG assets and controls is not claimed. Ready for the user-authorized production deployment; deployment status is verified separately after merge.
