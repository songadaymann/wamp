# F225 centered buffers and muted music review

Tested candidate on F221 `f587f8db` / draft #95. Master remains unticked; production and primary unchanged.

Centered pattern/playback sequences retain one channel and one mixdown array. Panned mixes remain stereo. The centered waveform retains the previous left-channel amplitude; real Web Audio stereo upmix matches the previous stereo output within 0.000001. F220's shared 16-clip/4-loop/50 MiB retention cache remains in effect. This is a per-buffer saving, not a measured whole-app RAM or CPU benchmark.

Music volume zero stops active/retiring loops and previews, invalidates pending playback/preview ownership, and skips new pattern/phrase/stem loads and renders. A cloned latest requested target is retained for unmute. Explicit Stop, a silent target and mode exit clear that intent. Unmute starts the latest song from its downbeat. Already-dispatched render/decode work can finish into the bounded cache but cannot install a stale source; it is not CPU cancellation.

## Evidence

- Full quality gates: 403 files / 3,198 tests, lint, types, bindings and build. DOM 992/242, Worker safety and diff pass.
- Thirteen added tests cover exact mono waveform/panned stereo, all three muted kinds without context/fetch/render/library work, latest cloned target, explicit Stop/silence, active and pending ownership, muted notes/clips and pending clip/drum mute-unmute races.
- Four accepted native cases: actual mono/reference and stereo OfflineAudioContext output; real Settings mute plus room crossing/unmute to the latest 60 BPM song; muted note edit, exact Undo/Redo/save without cache or one-shot growth and edited-world resumption; phone portrait preview/Stop after explicit Settings unmute.
- The real 48 kHz/192,000-frame centered loop retains 768,000 bytes versus the previous 1,536,000 bytes. First-channel maximum difference is zero; offline two-channel playback stays within 0.000001.
- All desktop, phone and gameplay screenshots inspected. Native page errors are zero. Constructor-preview 404s are retained. Existing portrait overlay covers the grid; no portrait touch-grid or performance claim.
- Unchanged installed-client capture inspected: collision ready, no error artifact; existing performance-pressure prompt is visible, so no clean performance benchmark is claimed.
- Published 213/214 fixtures remain exactly their v1 snapshots. The actual 213 draft edit is saved. Primary hashes match before/after; remote main remains `d534619c`.

Evidence: `/tmp/wamp-music-mono-mute-2026-10-09/`. `accepted-native.json` combines three completed desktop cases in native-b with the completed phone case in native-c. Initial harness diagnostics are retained: returning from a draft test preserves the player in the adjacent room, so the check was corrected with a native leftward return; the phone correctly inherited account music volume zero, so its playback check now explicitly unmutes through Settings. Two test-only type errors were repaired before the passing quality gate.

No migration, room/replay format, catalog, renderer service or PartyKit change. Frontend-only individually; inherited coordinated API/Pages delivery, migrations 0060–0062 and matching catalog/renderer still apply. No release performed. Hidden-tab audio lifecycle and unused Phaser audio remain F229; label/playhead overhead remains F226.
