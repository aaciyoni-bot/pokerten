# Captain's Panel artwork

The cockpit scene and unlabelled instrument face in `assets/` were generated
for AVIATORIZIS from the user-approved classic cockpit concept on 2026-09-08.
They contain no live game values. All game numbers and controls remain HTML
and JavaScript tied to the existing server-authoritative client.

`icons.json` contains unmodified SVGs from Bootstrap Icons v1.13.1:
https://github.com/twbs/icons/tree/v1.13.1/icons

Bootstrap Icons are distributed under the MIT license. The license text is
included in `BOOTSTRAP-ICONS-LICENSE.txt`.

The Vercel builder copies the active cockpit and jet WebP files from the same pinned Git commit as
the client to `/cockpit/`. It fails if an asset cannot be fetched.


The wide flight-deck cockpit.webp was regenerated from the selected other-agent reference on 2026-09-08, with all UI and numbers removed from the raster. Source image: exec-1858f533-ae8a-4a16-8972-99661a130270.png, 1536×1024; WebP quality 84, 89,848 bytes. The previous multiplier-dial.webp remains preserved but the wide cockpit no longer displays it.


`world-110m.json` is an unchanged copy of the repository's Natural Earth 110m land geometry (85 polygons). It is embedded into the generated live client and rendered into a cached canvas layer; it no longer depends on a network request or repeats all polygon rendering on every frame.

`flight-jet.webp` is a 384px-wide generated realistic passenger-aircraft sprite with the AVIATORIZIS fuselage wordmark and winged-A tail from `exec-617d3375-d4a0-4c35-aae0-0d5f0207b415.png`. Its pure black background is removed at draw time using screen compositing over the dark flight map. It is loaded once and drawn from the same authoritative graph endpoint; asset decoding never blocks a cashout.
