# Poker table and club presentation verification

Checked 12 September 2026 against the supplied ClubGG screenshots, keeping the approved green/gold PokerTen artwork.

## Changes

- Portrait table fits the available height on desktop. A permanent action dock prevents CHECK/CALL from resizing the playfield.
- Both community boards occupy one reserved centre lane. Player seats, their card fans and bet labels have separate positions.
- Opponents have tightly overlapping six-card backs; revealed hands remain compact. The local player's wider fan keeps every rank and suit index visible.
- Hand order is a local preference: high to low, suit groups, or original deal order. Pineapple discard sends the original card index.
- Winning cards stay highlighted and do not fade with the losing hands. Private server hands use the same winning-combination highlight.
- Club entry has readable responsive club cards. Administration and account details use the PokerTen dark palette. Financial calculations and permission scopes retain their existing behavior.

## Verification

- All 20 mandatory pre-deploy checks pass; service worker version is 259 (base was 258).
- Full repository CI commands pass: generated worker check, bot-policy test, engine smoke, 17 Node tests and six UI test scripts.
- Focused UI assertions cover NLH, Omaha4, Omaha6, three winning board cards plus two winning hole cards, hand description, hidden/revealed six-card fans, private server cards, original-index Pineapple discard, concurrent balance protection and snapshot error recovery.
- Browser fixture uses synthetic data and mocks all financial writes. At 1440 × 900 the table is 479 × 719 px; the 143 px action dock and table dimensions are identical before and after CHECK appears.
- Browser inspection covers 390 × 844 and 320 × 640; nine seats and two boards have no board/hand/nameplate intersections or clipped card faces in the narrow fixture. Desktop six-seat bet labels and hands do not intersect the board.
- Club entry and mobile settlement visually inspected. Existing settlement tests verify period filtering, separate current balance and period result, agent visibility scope, and zero writes when opening reports.

## Live follow-up

An authenticated live game was not available during this change. The post-deploy smoke checklist in PREDEPLOY.md still needs a connected test account: NLH action progression, Omaha deal, Spin winner payout, table creation, and leaving a table. Exact GG club/admin/settlement matching awaits screenshots of those screens; the supplied references show poker tables.
