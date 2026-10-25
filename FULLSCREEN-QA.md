# SYNGA fullscreen verification

Scope: hide browser/system chrome during the existing landscape game. No game engine, account, balance, permission or backend changes.

Implementation: request the outer HTML document with navigationUI: hide during the first trusted click. The same-origin child game forwards its request synchronously to the outer host. This keeps both intros and the game in one fullscreen surface. Ignore editable fields and the explicit toggle during automatic capture. Automatically attempt once per load; respect user exits and provide explicit re-entry controls in clubs, lobby and the existing table menu. Handle unsupported or denied requests without breaking navigation. Keep the existing fullscreen/landscape manifest and link it from the design-preview entrance.

Checks: the added controller suite verifies trusted gestures, no load-time requests, hidden-navigation options, nested host ownership, no automatic re-entry after exit, explicit re-entry, rejection and installed-app fallback. The existing presentation and poker-table tests verify intro/club flows and table fullscreen controls. Predeploy invariants and isolation checks pass.

Browser: local preview renders the added controls and continues club → lobby navigation. Fullscreen requests from both the top-level ORIZIS entrance and nested game are made, but cloud Chrome rejects them with TypeError: not granted. The explicit toggle displays its fallback message; there is no forced retry loop or lost game state. This is an environment verification limit, not proof that Android system bars are hidden. Actual Android device verification remains pending. No native SYNGA Android wrapper is present in this repository.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen (transient activation and navigationUI), https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display (installed-app fullscreen).
