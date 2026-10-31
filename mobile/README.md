# POKERTEN independent mobile apps

Android release 9 (1.0.4) and the next iPhone build package game release 349. The lobby/account and table menus include a persistent MUSIC ON / MUSIC OFF control that leaves game effects unchanged. This snapshot also includes the current settlement interface and cashier scrolling fix. Store review and device verification are separate from compilation.
The existing POKERTEN client is packaged locally using Capacitor. It connects to
its existing Firebase backend. The website/game source, server rules, game logic,
and GOD permissions are not changed by this mobile packaging.

The iOS startup fix initializes Firebase Auth with persistent native-compatible
storage and no browser popup/redirect resolver. The previous `getAuth()` setup
could wait for an OAuth iframe before the first readiness request, leaving
TestFlight on “Connecting to the game…”. The regression test runs the real
bundled Firebase SDK with an iPhone/Capacitor environment and unavailable browser
login scripts; it must reach the readiness endpoint. Real-device verification
of player-code login, relaunch and gameplay is still required after installing
the updated TestFlight build.

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
developer accounts. Android version 1.0.4 / build 9; subsequent release build numbers must exceed any existing store build numbers.

## Scope and known limitations

- Portrait phone app. iPad-specific layout is not enabled.
- Core JavaScript (React, Firebase and Tone), Tailwind styles, icon fonts, game
  assets and sounds ship inside the app. No remote `server.url` or live website
  loader is used. Fonts, generated avatars and Firebase services require internet.
- Android Google sign-in uses Credential Manager and exchanges its ID token with
  the existing Firebase JS auth instance. Configure OAuth below before device testing.
  Player ID + personal code remains available. iOS Google/Apple login is not implemented.
- Profile includes a bilingual account-deletion request page bundled in the app.
  It opens an email request to support; the user must send it. This is a manual
  request process, not immediate deletion. Support must process and verify requests.
- PWA install prompts and the web service-worker updater are disabled in the native generated copy only. The native version control identifies its bundled game release and opens Google Play on request from the lobby. It does not claim that a local reload installs a website deployment. Each native release must be rebuilt from current main and uploaded to the store. The website remains unchanged.
- Android keyboard resizing and a back/exit confirmation are enabled. Test on a
  real device: Android 16 edge-to-edge behavior can differ from browser rendering.
- System bars start hidden. Android restores immersive mode on resume and after
  native dialogs; an edge swipe temporarily reveals system navigation. Keyboard
  and display-cutout insets remain managed by Capacitor. Check chat input and
  Google sign-in return on a device after installing the immersive build.
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
4. Configure and device-test Android Google login below; verify player-code login.
   Implement Apple/iOS login as applicable before an Apple submission.
5. Test Profile → Request account deletion, opening the email app, the no-email-app
   fallback, and returning to the game. The public Play deletion request URL is
   https://pokerten.web.app/delete-account.html. Keep both pages' policies in sync.
6. Verify report/block/moderation controls for chat and accurate privacy / Data
   Safety / simulated-gambling declarations for the complete submitted build.
7. Test two devices in the same hand: chat keyboard, reconnect, foreground return,
   sound, timers, tournament entry and end-of-hand display. Do not change real games
   or make automated wagers for a smoke test.
8. Capture screenshots from the final signed builds using a demo account, then
   complete review access and submit. Approval remains with Apple and Google.

The packaging build validates expected source markers and fails when the upstream
HTML structure changes, rather than silently generating a broken native copy.

## Android Google OAuth setup (required before submission)

1. In Firebase project `pokerten`, verify Google is enabled under Authentication.
   Register Android app `com.orizis.pokerten` and its **Google Play app signing**
   certificate SHA-1 (not only the upload certificate). For local signed APKs,
   also register that signing certificate. Debug requires a separate Android
   OAuth registration for `com.orizis.pokerten.dev` and the debug certificate.
2. Obtain the **Web** OAuth client ID from the same project (client type 3 in the
   Android app's downloaded `google-services.json`). Do not use an Android client
   ID or a service-account key. No native Firebase SDK or Google Services plugin
   is used, so the raw JSON is not packaged and should not be committed.
3. The owner's supplied Android config has been validated for project `pokerten`,
   package `com.orizis.pokerten`, app ID `1:861274065626:android:b6431a10d904245b8c73e3`.
   Its public Web OAuth client ID is recorded in `android/gradle.properties`.
   `POKERTEN_GOOGLE_WEB_CLIENT_ID` can override it in the build environment;
   GitHub previews read that repository variable and require a configured ID.
   The refreshed config includes the Android OAuth client and Play signing SHA-1.
   The owner confirmed successful Google login from Play internal build 4 on
   2026-10-17; the broader account-switching and persistence checks below remain.
4. For the store bundle, set `REQUIRE_NATIVE_GOOGLE=1` alongside the client ID and
   a fresh `MOBILE_BUILD_NUMBER`, then build/sign using the owner's upload key.
   This gate checks presence, not correctness of cloud registration.
5. Install from a Play test track. Verify existing Google user's UID/profile and
   chips, new Google user, cancel/retry, logout/account switching, restart/session
   persistence, and player-code login. CI compilation cannot validate OAuth.
6. Update Play Data Safety account-creation declarations to include Google/OAuth
   before submitting this build. Capture screenshots from the final native app.
