# F260 — retired music helpers and unused footstep warming (in progress)

Remove uncalled stems catalog, note-label, phrase predicate/batch, instrument
palette, pattern constants and editor getter helpers and their model re-exports.
Keep getRoomMusicKeyDeltaSemitones and getRelativeRoomMusicKey for planned neighbor
matching. Keep existing stem-format normalization/playback and the legacy editor
notice/replacement flow. Move the legacy stems constructors into one test fixture,
used by six current tests (the older review listed four). Simplify the pack-bar
helper's identical branches without changing its accepted arguments.

Remove the obsolete stems clip-preview method. Port both mute and pending-preview
cancellation tests to the current sequence-preview API; retain their no-loading/
no-revival assertions. Remove peekMusicBus and point the already-initialized
transition fixture at getMusicBus. SfxController's unused mute methods were already
removed in F257. Remove footstep from the SFX type, cue config, hot list and
background feedback list. Source audio and its reviewed generation manifest stay;
there is no runtime request for the retired cue.

Seven focused files/152tests pass, covering sequence preview mute/cancellation,
legacy room music playback, run-ending, lineage, editor characterization and SFX.
Existing preload test now requires four hot files instead of five, retains serial
background-loading/unique URL assertions and adds no-footstep URL coverage.
Full combined F255/F257/F260 check passes747files/6277tests, one existing expected
failure/two skips, all stages,669.1/670KB on this pre-F259 integration base.

Real browser warms28 sound buffers after a real gesture, all asset responses200,
plays the actual jump cue (debug history played/active voice), makes zero footstep
requests and has zero page errors. Local Vite/recorded API, blocked live multiplayer,
muted browser output. No production writes.

Evidence: /tmp/wamp-f260-check.log, focused-final.log, native.log/native.json,
reference-audit.json and shrink.log. Harness ignored under output/f260-native/.
No new baseline allowances; preserve unrelated fakeDom entries. Requires integration
with latest delivered main, final checks, PR CI and live rollout; not delivered yet.
