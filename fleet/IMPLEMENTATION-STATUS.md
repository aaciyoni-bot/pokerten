# Derech Eretz 1894 — preview work, 2026-10-11

Source: retained Fleet application from the September handoff, compared with `codex/greeneyes-fleet-uiux` at `1917216a83a872287b829dbb9615b83d0044d1b8`. Dark branding is retained. No poker or Greeneyes application code is changed.

The imported roster is staged privately in Firestore at `fleet1894/preview/bootstrap/initial-fleet`. It has 31 unique vehicles (24 fit, 7 unfit), including Tiger 219-129 once, fit, company A. The bootstrap runs idempotently after the first authorized editor login. No roster or driver records are embedded in public code. Identifier types are inferred from six versus eight digits and remain editable. Five garage vehicles with unknown original units are held in the central pool with their original notes. The relative puncture repair estimate is preserved as unverified text rather than converted to an invented date.

The application uses the existing `pokerten` Firebase project used by GREENEYES95. New data and rules are isolated under `fleet1894/preview`. Existing Firestore rules were preserved byte-for-byte; an additive preview block was compiled and published in Firebase Console. No production application deployment or domain alias has been changed.

User update: editable vehicle fields and vehicle deletion/restoration are available separately from returning to the pool. Deletion retains history and removes the vehicle from active counts.

Implemented: personal-number/password Firebase authentication, server-side membership/scope enforcement, realtime Firestore subscriptions, transactional revision checks, normalized unique number reservations, vehicle editing, transfers with history, central pool intake, service history, handover/return, faults, fuel entries/cards, driver management, vehicle QR, internal commander summary, copy/print, private bootstrap import, backup export, and Storage upload UI. No localStorage fleet database, anonymous login, role-switch demo or URL-based login remains.

Validation: JavaScript syntax, 4 retained regression cases, 6 transaction/import regression cases and 5 planner/report/deletion regression cases pass. Vehicle counts and unique identities validated. Public runtime code scanned for the supplied plates and embedded roster.

## Personal-number login update
The user replaced the proposed Google owner access with six explicitly named accounts: two editors and four viewers. No legacy Google owner grant was created. Names/numbers were resolved from the provided workbook, except one editor whose number was explicitly provided by the user. The names, identifiers and activation tokens are held privately in Firestore, not committed in source.

Firebase Email/Password was already enabled. Each account activates through a random 256-bit, one-time invitation and enters the password agreed with the administrator. The activation transaction binds the exact pre-authorized role/name/login identity to the Firebase UID and consumes the invitation atomically. Client-created or client-updated privilege assignments are denied. The six invitation records were created and individually verified in Firebase Console. The live isolated rules were replaced and compiled/published on 2026-10-11 at 01:26 Israel time; unrelated rules were preserved byte-for-byte.

The header greets the authenticated user by name. Viewers see read-only vehicle, driver and fuel information. Fleet changes are allowed only for the two editor memberships. There are no embedded passwords, public personal-number lists, service accounts or local role switches. Google export authorization uses a separate in-memory Firebase auth instance, so it cannot replace the active personal-number session.

Validation: 21 regression cases pass, including atomic activation, wrong identity, consumed invitations, bad password, name greeting, viewer controls, concurrent edits, unique numbers, calendar/report handling and deletion/restoration. Inline and external scripts parse.

## Service diary and Google integration
Implemented next-service date and mileage fields, monthly Hebrew service calendar, framework filtering, overdue/mileage alerts, service completion history with next target, recoverable deletion and restoration. Direct Google Sheets export creates a private 11-tab snapshot using typed literal cells. Google Calendar sync explicitly pushes current dated service targets to a dedicated calendar on demand; it is one-way, not background or bidirectional. OAuth tokens are not persisted. Calendar IDs are private per-UID settings.

## Remaining activation and verification
- Users must enter and confirm their credentials through the supplied private activation links. The activation form now accepts eight-character passwords as requested; the private credential convention is not embedded in public code. No password has been chosen or entered on their behalf. Live authenticated login/save/reload, cross-session sync and mobile operation remain unverified until activation.
- The roster is staged privately. The first editor login imports 31 unique vehicles; a viewer cannot execute this write.
- Created the previously absent default Storage bucket `pokerten.firebasestorage.app` in the console-selected no-cost US-EAST1 location with default-deny rules. The Fleet-only Storage rules are prepared, but publication is paused at Firebase’s “Provision cross-service rules” dialog requesting the Storage service account’s additional IAM permission to consult Firestore. No cross-service IAM grant was made; uploads/CORS remain unverified.
- Google Calendar/Sheets API enablement, OAuth consent and the short preview hostname authorization require live configuration/validation before exports can be claimed operational. No Google calendar or spreadsheet has been created yet.
- Git-to-Vercel automatic deployment is disabled pending connection and production-branch verification. Preview is deployed from an exact Git commit.
- Public short preview alias: https://derech1894.vercel.app/ . Production promotion remains prohibited until explicit user approval.

Credential update: the client minimum was changed from ten to eight characters. An activation regression verifies an eight-character credential while preserving the invited viewer role. No existing Firebase credential was created, reset, or modified by this code deployment.
