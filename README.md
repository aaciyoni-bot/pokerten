# POKERTEN

Poker-first club app by **ORIZIS TECHNOLOGY** — `pokerten.com`.

Focused split of the shared game engine: **Poker** (primary), **Chinese Poker / OFC** and **Durak** (secondary). English-only, LTR.

## Status
- **Seeded** from the shared base app (same design system). Rebrand + English/LTR conversion + poker-only scoping are in progress.
- **Backend:** to run as a fully separate project, point this at a **new Firebase project** (Firestore + Google Auth) and update the config in `index.html`, `.firebaserc`, and `.github/workflows/`.
- Login/registration: Google sign-in (same as the base app).

## Not included
- No investor modules.
- No GPS / IP tracking. Auditing is gameplay/hand-history based only.

## Deploy
GitHub Pages (single-file `index.html`) + `CNAME` → `pokerten.com`. Cloud Functions deploy via GitHub Actions once the new Firebase project + `FIREBASE_TOKEN` secret are set.
