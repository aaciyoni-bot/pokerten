# GOD access and showdown privacy

GOD authorization retains the six existing designated email addresses. The UI now requires the currently signed-in Firebase UID to match the viewer and its email to be verified and designated. Writable profile email/role fields cannot grant it. Poker, Durak and OFC reset GOD view on account changes. Stale peek responses are discarded. The server requires a verified signed-in token on every GOD privilege path, including direct `godPeek` calls.

At a normal showdown, losing hands auto-muck unless voluntarily shown or belonging to the called river aggressor. Owners can select SHOW afterward. All-in hands remain visible once betting is complete, through showdown and history. Winners and their winning-card highlighting remain visible. The SHOW control occupies the existing action area and does not resize the table.

## Verified

- Direct callable denial for unauthenticated, unverified and non-designated accounts.
- Profile spoofing and account mismatch denial in the actual UI predicate.
- Non-all-in losing hand omitted from server public cards/history while own private cards remain.
- All-in and called aggressor exceptions; winning hole/board highlights for NLH, Omaha4 and Omaha6.
- Full repository validation and simulated UI flows.

## Remaining architecture limitation

Client-engine tables still store every player's cards and the deck in a shared Firestore document readable by signed-in clients. Their Muck display and hidden GOD control do not make that underlying data confidential. Shared `hands` records from earlier versions also remain unchanged. Server-engine tables already use separate private hand documents; this patch does not silently migrate client tables or change game-engine defaults. Full confidentiality for legacy games requires a separately verified server-engine migration and corresponding Firestore write restrictions.

No authenticated multi-user production play or real-money action was performed by these tests.
