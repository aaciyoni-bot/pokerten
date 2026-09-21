# POKERTEN v278 layout verification — 2026-09-21

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
