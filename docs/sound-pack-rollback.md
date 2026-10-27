# Sound pack and rollback

Owner request: all audio from the supplied `zynga-poker-23-29-705.apk` in POKERTEN.
The exact phrase **בטל צלילים** means restore the original POKERTEN sounds, not mute audio.

The original baseline is release 328, commit `a060f8dfac0316723f82f351e651ee46a8c63d7a`.
Existing WAV files, soft all-in/win synthesis, original cue mapping, gains and mute/volume preferences are retained.

## Restore

1. Set `active` to `original` and increment `revision` in `assets/sounds/theme.json`.
2. Increment the service-worker shell version and publish through the normal validation/hosting workflow.
3. Verify the deployed JSON. Open clients check it every 60 seconds and when returning to the foreground.

The theme stops all imported sources and lobby music on rollback. Original check timing,
quiet chat/join behavior and original direct roulette/shuffle samples return automatically.
Do not revert the entire site or change game state, roles, balances or accounting.

## Inventory

379 clips: 378 Unity AudioClips and the Android notification WAV. All bundles and
Unity data files in the supplied APK were scanned. `catalog.json` lists every clip,
its full duration, encoded hash and byte slice. Each slice is a complete MP3;
bank files only batch network requests, with no audio concatenation or timing offsets.
The library in the table sound menu exposes every clip for individual preview.
Events absent from POKERTEN (for example proprietary album/quest/sales animations)
remain available in the library rather than firing unrelated sounds during hands.

`events.json` maps actual app events; optional catalog sounds and lobby music load
on demand. Existing mute/volume controls apply to all playback; backgrounding stops
imported audio. The lobby loop ends upon entering any table.

`scripts/build-imported-sound-bank.py` builds banks from a lossless extracted WAV
inventory and validates every MP3 through ffmpeg. No APK code is executed.
