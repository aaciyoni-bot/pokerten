# SYNGA POKER — implementation status

Updated 2026-10-25. Independent visual fork based on commit d6a3bb3b55c1dd4003aa38afdbc7fd3fbcd33fff. Work branch: codex/synga-poker-redesign.

## Implemented

- Preserved the original ORIZIS entrance animation and dismissal behavior. The identical intro appears at index.html and preview.html. Both entrances were verified in the browser.
- SYNGA POKER branding throughout shipped interface text, authentication copy, installed app metadata, icons, account pages, invitations, sharing and exported reports. The previous identifier remains only in an internal guard preventing connection to the original server, and in inherited development history.
- Red/gold landscape lobby, game carousel, real table selection callbacks, club navigation and table presentation. Existing club, management, accounting and game components remain connected to the presentation layer.
- Extracted 378 audio files and 2,250 unique PNG files from the supplied APK. Some Unity objects could not be exported; downloaded seasonal assets may be absent. The separate extraction archive includes inventories and export errors.
- Integrated 19 extracted WAV files mapped to 17 sound events. Mute and volume controls are retained. Audio file structure, event mapping and browser controls were checked; no listening comparison was performed.
- Preview fixtures render the existing Poker, Omaha, Durak and Chinese Poker components with sample data. All server writes are rejected in the preview.

## Landscape correction

The lobby and tables now share a 1536 × 709 coordinate system with uniform scaling. Portrait devices automatically rotate the complete landscape experience, including ORIZIS and the new SYNGA entrance; changing orientation preserves the current game. Chooser cards, header/footer, avatars and board sizes follow the supplied reference proportions. Dense seats leave the action dock clear. See design-qa.md for this revision and design-qa-full-redesign.md for the earlier full-artwork assessment.

## Clubs, entrances and audio demo

The preview now starts with MY CLUBS: membership cards, balances, six-digit lookup, entry, creation and permission-controlled archived clubs. The original ClubsView retains all server callbacks and permissions. New burgundy/gold club dialogs match the presentation. The SYNGA logo entrance follows ORIZIS and can be replayed without resetting the game. A 15-second MP3 demonstration plus ten individual sound controls are available under SOUNDS. Native browser playback was verified.

## Fullscreen (2026-10-25)

The first trusted click in the entrance or game requests fullscreen on the outer document with browser navigation hidden. Club/lobby buttons and the existing table control share that same controller. Leaving fullscreen does not trigger automatic re-entry; explicit re-entry remains available. The installed-app manifest already requests fullscreen/landscape, and preview.html now links it too. Browser support and OS navigation behavior remain platform-controlled. Cloud Chrome rejected fullscreen with TypeError: not granted, so actual Android system-bar hiding is not verified here.

## Isolation and validation

Files under functions/ and firestore.rules are unchanged. The original Firebase configuration and custom-domain mapping have been removed from this fork. Inherited deployment and operational workflows are disabled. The production service has not been changed.

Passed: 20 pre-deployment invariants; isolation, brand and ORIZIS intro checks; 39 UI suites; the existing 68 core tests plus the added audio integration check; generated bundle consistency and JavaScript syntax checks. Browser checks cover the intro, lobby, table selection, sound settings and card game routes. Real authentication and multiplayer remain untested.

Run npm run dev and open preview.html for the preview. It displays sample balances and is not a live multiplayer game.

## Remaining work

- The one-to-one design request is not complete. Seasonal artwork, display typography, icon treatment and several secondary screens still differ. See design-qa-full-redesign.md for evidence and priorities.
- A separate Firebase project and configuration are required before multiplayer activation and real end-to-end gameplay validation.
- The public design preview is published at https://synga-poker.vercel.app/preview.html. syngapoker.com is added to this Vercel project, but registrar DNS still points to parking and must be updated before that custom domain serves this preview. Real multiplayer is not activated.
