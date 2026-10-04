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
