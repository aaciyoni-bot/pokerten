# Release 382 — restore POKERTEN Classic

Restores the previous non-table presentation from the 20 November Classic archive (`35ad6b7add33443b272b95ad94f847ad0af3665c`, release 378). Removes the Silver theme, its event banner and bottom bar; restores the original masthead, balance chip, compact game tabs, club spheres, sign-in artwork and existing page styles.

This is a presentation-only rollback on top of release 381. All 21 original stylesheet references and files match the archive. No game engine, rules, private-card access, authentication/session lifecycle, result timeline, balance calculations or mobile updater implementation was reverted. Game-table and card-game implementations are byte-identical to 381.

The Wallet remains available in the original header/menu navigation and uses Classic glass panels. Direct spectating, buy-in ranges, truthful loading/retry states, LIVE filters and the persistent return-to-table control remain. The unsupported VPIP placeholder stays removed. The management icon fix stays applied. The 42-item backlog retains its completed and open statuses; this release does not claim that all 42 items are complete.

Validation: full existing UI suite, 151 core checks, 19 native update checks, 22 predeploy invariants and generated worker/settlement checks passed. Read-only browser fixtures compared archived and restored club selection and sign-in screens, and checked mobile lobby scrolling, Wallet navigation and desktop management. Physical-device and live-game acceptance remain open.
