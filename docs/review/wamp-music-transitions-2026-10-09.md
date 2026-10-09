# F224 room music transition review

Tested local candidate on F220 `c2ba1572` / draft #93. Primary and production unchanged; master stays unticked for review/release.

## Behavior

Pattern, phrase and stem playback share one transition plan. Entry after silence starts at offset zero with an 80 ms fade. Compatible BPM, meter, swing and authored key retain the existing bar grid and bar crossfade; stem music is compatible only within the same pack because it has no declared tonal key. Different timing/key uses an independent first beat and a 300 ms blend with a newly anchored transport. Explicit editor immediate transitions keep their phase.

Every positive fade-in now starts at zero. Future sources canceled before their start are stopped immediately at zero gain. Outgoing sources remain tracked until `ended`; subsequent targets/Stop shorten previous tails rather than abandoning scheduled bar-long stops. Fade cancellation holds the true AudioParam envelope when available; the tested fallback derives the known fade-in/fade-out level. Cleanup disconnects sources/gains and removes retiring ownership. Stem lane buffers finish loading before one shared start is scheduled, and stale loads cannot install sources after Stop.

The world selector requires 400 ms of stable residency before changing audio after a room crossing. Initial entry and same-room revision/hydration stay immediate. Returning to the playing target clears the pending change; newer crossings replace it; mode exit/reset cancel ownership. This uses per-frame checks without timers. Gameplay room, collision, camera and goals still change immediately. Stable silence uses an immediate 300 ms fade, avoiding a bar-delayed duplicate on re-entry.

## Evidence

- Full quality check: 402 files / 3,174 tests, lint, types, bindings and build. DOM 992/242, Worker safety and diff pass.
- Twenty-one new tests: compatible/incompatible/queued timing across all music kinds; public controller fade-in and offset-zero re-entry for pattern/phrase/stem, future cancellation, shortened outgoing tails, envelope fallback, cleanup and stale load ownership; stable-room, fast crossing, bounce, silence, reset and mode-exit selection.
- Eight completed native cases with actual Web Audio nodes and native movement: room bounce without an audio restart, compatible phase-lock, cross-tempo/key downbeat, silence, decoded stem playback, real phrase API playback and responsive phone gameplay/Stop; queued-room reversal stops the future source at current time/zero gain, shortens the prior tail to 300 ms and clears retiring ownership.
- Native accepted suites have zero page and console errors. Desktop/phone/queued-reversal screenshots inspected. Read-only local D1 verifies all six published music fixtures 205–210/42 exactly unchanged. Primary hashes match F220.
- Initial harness diagnostics retain the first-play controls intro and reading a destroyed player body after Stop; corrected native input and nullable post-Stop inspection pass. No pose/collision/room teleport was injected.

Evidence: `/tmp/wamp-music-transitions-2026-10-09/`, especially `accepted-report.json`, node/gain schedule snapshots, source fingerprints and primary/fixture proofs. Audio evidence proves scheduling and actual node ownership, not a subjective listening benchmark or production BPM distribution. Existing portrait music-editor obstruction/Desktop Close overlap remain F220 diagnostics; this candidate changes no UI.

Web Audio scheduling was verified against [MDN stop semantics](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/stop) and [AudioParam hold/cancel behavior](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/cancelAndHoldAtTime). The fallback supports implementations lacking hold/cancel.

No migration, saved/replay format, catalog, renderer or PartyKit change. Frontend-only by itself. Inherited coordinated API/Pages, migrations 0060–0062 and matching catalog/renderer requirements remain; the existing catalog mismatch release gate remains unresolved. No release performed.
