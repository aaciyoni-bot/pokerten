# Captain's Panel artwork

The cockpit scene and unlabelled instrument face in `assets/` were generated
for AVIATORIZIS from the user-approved classic cockpit concept on 2026-09-08.
They contain no live game values. All game numbers and controls remain HTML
and JavaScript tied to the existing server-authoritative client.

`icons.json` contains unmodified SVGs from Bootstrap Icons v1.13.1:
https://github.com/twbs/icons/tree/v1.13.1/icons

Bootstrap Icons are distributed under the MIT license. The license text is
included in `BOOTSTRAP-ICONS-LICENSE.txt`.

The Vercel builder copies both WebP files from the same pinned Git commit as
the client to `/cockpit/`. It fails if an asset cannot be fetched.


The wide flight-deck cockpit.webp was regenerated from the selected other-agent reference on 2026-09-08, with all UI and numbers removed from the raster. Source image: exec-1858f533-ae8a-4a16-8972-99661a130270.png, 1536×1024; WebP quality 84, 89,848 bytes. The previous multiplier-dial.webp remains preserved but the wide cockpit no longer displays it.
