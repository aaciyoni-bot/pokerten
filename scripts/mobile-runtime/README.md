# Compatible updater fixes

The hosting workflow copies these web-only files over the pinned Android builder
before verification and packaging. The native plugin APIs, dependencies and
`android-13` runtime stay pinned in `scripts/mobile-update-source.json`.

Manual checks install from the club picker or sign-in screen when no remembered
seat or known active participation blocks them. Automatic checks still wait for
server-confirmed club rosters. A stale poker resume key is cleared only after a
server read confirms that the same signed-in user is no longer seated.
