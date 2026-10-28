# Release 336 — reference login screen

The old centered login card is replaced by the supplied portrait composition: metallic POKERTEN wordmark, dark glass background, large P10 sphere, and illuminated Google/player-code buttons. The player-code form uses the existing component in a compact, scrollable view. Google busy/error state, account retry, Back, registration, installation help, sound check and manual update remain available.

Only AuthView presentation and release metadata change. No authentication provider, user data, permissions, game engine, accounting or audio behavior is changed. The discussion about personal winner applause versus a neutral cue for other players is a recommendation, not part of this release.

Release marker, updater fallback and service worker advance to 336. Sound pack remains the current 335 pack. New images and stylesheet have versioned names. Styles use a separate login scope, avoiding accumulated auth-card theme overrides.

Validation: existing authentication suite, all 20 predeploy checks, and three updater tests passed. Cloud browser verified 393 × 852 and 320 × 568 layouts, both entry options, Back, registration toggle and simulated Google error recovery. `design-qa.md` records source/implementation comparison and remaining minor visual differences. Production verification follows deployment.

Assets: generated reference-derived background, wordmark and two empty glass button textures; reused existing glass sphere/P10 logo. Official Google G downloaded unchanged from https://developers.google.com/static/identity/images/g-logo.png. Inputs and action labels are real DOM elements.
