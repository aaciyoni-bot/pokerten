# PokerTen v381

Privileged UI sessions now expire and revalidate while foregrounded. Backgrounding, account changes, denied calls and failed refreshes discard cached access; delayed responses cannot restore a previous viewer. Account changes clear club context before loading the next profile. Current membership is required for private-card reads.

Internal documentation is excluded from public hosting. Table visuals, game rules, balances and the configured administrator list are unchanged.

Validation: predeploy, access-lifecycle, private-card authorization, Firestore emulator, game/accounting and UI regression suites. This release is session hardening, not certification of the entire application's security or data minimization. Follow-up status is tracked in the owner's private work list.
