# Derech Eretz 1894 — preview work, 2026-10-11

Source: retained Fleet application from the September handoff, compared with `codex/greeneyes-fleet-uiux` at `1917216a83a872287b829dbb9615b83d0044d1b8`. Dark branding is retained. No poker or Greeneyes application code is changed.

The imported roster is staged privately in Firestore at `fleet1894/preview/bootstrap/initial-fleet`. It has 31 unique vehicles (24 fit, 7 unfit), including Tiger 219-129 once, fit, company A. The bootstrap runs idempotently after owner login. No roster or driver records are embedded in public code. Identifier types are inferred from six versus eight digits and remain editable. Five garage vehicles with unknown original units are held in the central pool with their original notes. The relative puncture repair estimate is preserved as unverified text rather than converted to an invented date.

The application uses the existing `pokerten` Firebase project used by GREENEYES95. New data and rules are isolated under `fleet1894/preview`. Existing Firestore rules were preserved byte-for-byte; an additive preview block was compiled and published in Firebase Console. No production application deployment or domain alias has been changed.

Implemented: Google authentication, server-side membership/scope enforcement, realtime Firestore subscriptions, transactional revision checks, normalized unique number reservations, vehicle editing, transfers with history, central pool intake, service history, handover/return, faults, fuel entries/cards, driver management, vehicle QR, internal commander summary, copy/print, private bootstrap import, backup export, and Storage upload UI. No localStorage fleet database, anonymous login, role-switch demo or URL-based login remains.

Validation: JavaScript syntax, 4 retained regression cases and 6 transaction/import regression cases pass. Vehicle counts and unique identities validated. Public runtime code scanned for the supplied plates and embedded roster.

## Explicit blockers / incomplete verification
- Automatic approval review rejected saving owner membership for `aaci.yoni@gmail.com` at `fleet1894/preview/access/aaci.yoni@gmail.com`. The dialog was cancelled. No membership was saved. It requires explicit user approval for this exact grant. The requested role is `officer`, `active: true`, `owner: true`, solely in this Fleet preview.
- Consequently, live authenticated save/reload, cross-session sync, bootstrap materialization into vehicle documents and permission tests have not run.
- Storage rules are prepared but not published; uploads and CORS need validation after access approval.
- The Vercel preview hostname must be added to Firebase Authentication authorized domains before Google login.
- Git-to-Vercel automatic deployment remains intentionally disabled pending connection and production-branch verification. Preview can be deployed from the exact Git commit via Vercel's API.
- Production promotion is prohibited until the user explicitly approves the tested preview.
