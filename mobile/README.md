# POKERTEN independent mobile apps

This is the initial **device-test build**, not a completed store submission.
The existing POKERTEN client is packaged locally using Capacitor. It connects to
its existing Firebase backend. The website/game source, server rules, game logic,
and GOD permissions are not changed by this mobile packaging.

## Build without owning a Mac

GitHub Actions `Build POKERTEN mobile previews` builds:
- Android: an installable debug APK named POKERTEN Test (`com.orizis.pokerten.dev`).
- iOS: a simulator-only app on a macOS 26 runner. This verifies compilation; it
  cannot be installed on an iPhone. TestFlight requires Apple signing below.

Local tooling: Node 22+, `cd mobile && npm ci && npm run sync`.
Android: Java 21 and Android SDK 36; `cd android && ./gradlew assembleDebug`.
iOS: Xcode 26+ on a local or cloud Mac.

The proposed store identifier is `com.orizis.pokerten`. Verify existing app records
in the owner's Apple and Google accounts before registering it. Do not create new
developer accounts. Version 1.0.0; release build numbers must exceed any existing
store build numbers. Preview Android build numbers use the workflow run number.

## Scope and known limitations

- Portrait phone app. iPad-specific layout is not enabled.
- Core JavaScript (React, Firebase and Tone), Tailwind styles, icon fonts, game
  assets and sounds ship inside the app. No remote `server.url` or live website
  loader is used. Fonts, generated avatars and Firebase services require internet.
- This first native test uses player ID + personal code. Existing Google users
  must set their code on the website and use the SAME player ID. Google web popups
  do not work inside a native webview. Native Google/Apple sign-in is not implemented.
- PWA install prompts and service worker registration are disabled in the native
  generated copy only. The website remains unchanged.
- Android keyboard resizing and a back/exit confirmation are enabled. Test on a
  real device: Android 16 edge-to-edge behavior can differ from browser rendering.
- Icons reuse the current site artwork. The iOS 1024 icon is an upscale of the
  512 source; this does not add original detail. Replace with master artwork if available.
- No signing private keys, account passwords or access tokens belong in git.
- Backend calls, persistent login, all gameplay flows and iPhone device behavior
  still need actual device testing. Compilation alone does not verify them.

## Before store submission

1. Reuse the owner's existing developer accounts and any proven Zambia publishing
   setup after verifying its exact identifiers and credentials.
2. Register/verify the store bundle IDs. Use Google Play App Signing and an
   owner-controlled upload key. Store secrets privately, never in this repository.
3. Apple: verify Team ID, App Store Connect app record, distribution signing and
   provisioning. Build/export on the cloud Mac and upload to TestFlight.
4. Verify player-code sign-in against production without creating duplicate
   accounts. Decide and implement native Google login / Apple login as applicable.
5. Implement and test in-app account deletion and Google Play's external deletion
   request URL. The existing privacy page only offers an email request.
6. Verify report/block/moderation controls for chat and accurate privacy / Data
   Safety / simulated-gambling declarations for the complete submitted build.
7. Test two devices in the same hand: chat keyboard, reconnect, foreground return,
   sound, timers, tournament entry and end-of-hand display. Do not change real games
   or make automated wagers for a smoke test.
8. Capture screenshots from the final signed builds using a demo account, then
   complete review access and submit. Approval remains with Apple and Google.

The packaging build validates expected source markers and fails when the upstream
HTML structure changes, rather than silently generating a broken native copy.
