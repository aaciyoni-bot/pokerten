# v277 measured ClubGG layout correction

Reference: /workspace/scratch/3ba22328b8b3/upload/d70c6aef-2304-4605-b85d-38134dab423a.png, 738 x 1600.
Review viewport: 369 x 800 (reference divided by 2), seven-seat spectator flop.

Measured reference anchors (source pixels, approximate raster boundaries):

| Element | Source target | Implementation target |
| --- | --- | --- |
| Top left avatar centre | 187, 288 | 25.3% width, 18% height |
| Top right avatar centre | 552, 288 | 74.8%, 18% |
| Mid-left avatar centre | 80, 500 | 10.8%, 31.25% |
| Bottom-left avatar centre | 119, 1230 | 16.1%, 76.9% |
| Top avatar diameter | 106 | 14.36% width |
| Bottom avatar diameter | 145 | 19.64% width |
| Community board top | 740 | 46.25% height |
| First community card left | 148 | 20% width |
| Community card width | 84 | (60% width - four gaps)/5 |
| Collected pot top | 923 | 57.7% height |

The v276 QA accepted general resemblance despite the user's precision requirement. This revision replaces that acceptance: remove additional perspective scaling; anchor fixed-size avatars rather than the combined avatar/name/action block; scale names and balances with avatar diameter; separate pot chips below the community board. Seated controls use a transparent backing to expose the existing personal-colour under-rail light.

Not assessed as exact: original POKERTEN avatars/branding, different header and action controls; GG screenshot supplies no seated or desktop state.

Browser comparison: v277 candidate opened at 369 x 800 with seven-seat spectator flop. Avatar centres and diameters now match the measured targets, and the community board begins at y=370. Compared reference and rendered full portrait. A remaining lower-rail difference (about 17 CSS px) is corrected with a 1.029 vertical scale anchored at the far rail. Brand mark is separated from the lower table-description baseline. Final published screenshot verification remains required.
final result: blocked
