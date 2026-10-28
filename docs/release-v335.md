# Release 335: visible updates and table victory audio

An open app kept its loaded page after deployment, with no foreground release check or visible version. Add a no-cache release check on launch, foregrounding and each visible minute. Offer an explicit update button, preserving the URL and local data. Disable applying an update at all table views; return to the lobby first. Never auto-reload a running table.

Show v335 and Sound check on sign-in, club selection and the lobby menu. Sound check uses the same sound pack and engine as gameplay, without a game or balance action.

Map regular wins to the supplied APK's `sfx_TiN_Applause_Normal` (6.00 seconds) and large pots to `sfx_TiN_Applause_Awesome` (6.83 seconds), following the owner's clarification that the victory cue should be the crowd. Stop choosing generic small/medium/big celebration effects randomly. Suppress the unrelated card-flip cue previously scheduled when awarded chips landed. Original-theme rollback still retains its original sounds and settlement cue. All 379 original clips remain available in the library.

Bump imported-event mapping, loader, release manifest and shell cache to release 335; theme revision is 2. Mapping changes are refreshed when the theme revision changes.

Validation: 83 unit tests, 20 predeploy checks, auth, club carousel, table menu, PWA and actual motion component checks. A browser fixture loads the production audio code, exact event mapping and real MP3 banks. Win selects `apk:sfx_TiN_Applause_Normal` and large pot selects `apk:sfx_TiN_Applause_Awesome`; Check selects `apk:sfx_check_01` (0.64 seconds). The fixture contains no Firebase authentication or game-write path. Production playback is to be verified after deployment via Sound check.
