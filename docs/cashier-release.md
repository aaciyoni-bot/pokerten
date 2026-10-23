# Central club cashier

Managers can open Cashier from the club navigation or the lobby wallet. One searchable list shows available regular chips, the existing wallet bonus, chips at tables and current-cycle game result. Each player has inline Send Out and Claim Back controls with a before/after preview. Agents see only the directory already authorized by the server and cannot transfer.

The new `cashier-transfer` operation uses the existing manager authorization, club treasury and atomic ledger. Claim Back is limited to wallet balance minus the recorded open bonus, with the existing legacy fallback to `bonusTotal`. It cannot take chips from a live table. Send Out requires an approved recipient and sufficient treasury funds. Transfers do not create game-result rows or alter bonus fields. Ambiguous UI retries preserve the same server request receipt.

This release does not migrate balances, convert legacy promo chips, issue bonuses, create agent treasury accounts or change the existing bonus accounting model. The separately discussed full counter model is not yet activated. The cashier exposes existing funds and results through a central workflow.

Validation: server transaction tests cover conservation, exact request replay, role restrictions, legacy bonuses, insufficient funds and unchanged game history. UI checks cover navigation, search, displayed categories, limits, duplicate clicks and ambiguous retry. Production balance transfers are not used as a smoke test.

The card-game creation incident was traced to evidence of an old loaded client: its OFC creation catch shows the literal `Error` and attempts a forbidden direct Firestore write. Current release 324 uses `pkCardTableCreate`; the live page was verified to contain the new path and all three card-game endpoints responded with the expected unauthenticated response. Authenticated live creation remains to be verified after refreshing that client.
