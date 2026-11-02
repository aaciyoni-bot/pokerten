# Android startup updates

Native 1.0.8 (13) introduces the `android-13` web runtime. Web content is delivered only from HTTPS `pokerten.com/mobile-updates/`, with SHA-256 bundle verification and exact runtime matching. No Capgo cloud account, API key, telemetry or remote native code is used.

The app checks automatically once after cold start, after server-confirmed club rosters load. Unknown/cache-only state, a remembered table, any current seat or any enrolled unfinished tournament defers installation. The full-screen Updating view blocks input; a 15-second deadline releases the game and prohibits a late reload. Failed bundles remain recorded so rollback does not cause a repeated install loop. The native updater rolls back if React never reports app readiness.

Native shell changes still require Google Play. When eligible, Google's immediate-update consent is launched directly, without a separate POKERTEN confirmation button. Existing installations must install native build 13 once before any of these facilities exist.

The web deployment pipeline must package native-compatible web assets, not the hosted HTML containing CDN imports or the website service worker. `ota-release.json` selects the runtime and semver. Never change native plugins/API use under an unchanged runtime. Publish only compatible web fixes; new permissions/native capabilities require a store build and runtime bump.

Release checks: `npm run verify --prefix mobile`, predeploy engine checks, Android bundle compilation. Store consent/install and native rollback need a Play-installed device for end-to-end validation; mocked controller tests alone do not establish that verification.
