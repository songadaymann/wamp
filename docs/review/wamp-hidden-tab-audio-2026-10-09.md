# F229 hidden audio first slice review

Tested candidate on F226 `0411a905` / draft #97. Master remains unticked. Primary and production unchanged.

Phaser's unused sound engine is disabled. Music and routed SFX retain their existing lazy contexts: hidden visibility suspends them, and visible/focus/gesture resumes only after interaction and while visible. A resume finishing after hide re-suspends immediately. Music keeps its owned source/transport so playback continues from the paused audio clock.

Hidden visibility stops and cleans up active SFX media, clears trim/fade timers, and blocks new hidden cues. Old effects are not replayed on return. A late media-play rejection after cleanup cannot pause a newly reused pooled element. Shared buses, Safari audioSession and automatic visible interruption recovery remain optional separate work.

## Evidence and limits

- Full quality gates: 405 files / 3,212 tests, lint, types, bindings and build; DOM 992/242, Worker safety and diff pass.
- Eight added lifecycle tests cover same-source pause/resume, hidden focus/gesture/lazy context, pending resume/hide races, direct/routed media cleanup, blocked hidden cues and late pooled-player rejection.
- Two browser cases use **a controlled document.hidden/visibilitychange signal with real AudioContexts and HTMLAudio**, plus native desktop/phone preview/Stop. Both freeze the actual music clock across 650 ms, stop SFX, block a hidden cue and resume the same owned source without old effects. Real context counts are one for music and two after routed SFX; Phaser has no context. All resumed screenshots inspected.
- **Ordinary background-tab/window behavior remains a manual pre-release check.** Headed Playwright forces focus/visibility; new-tab and minimized-window attempts stayed visible even after disabling its focus emulation. Native a/b/c diagnostics are retained. Native-d deliberately substitutes only the visibility signal, never the audio context or clock. No actual OS/tab-switch, iOS interruption, battery or unlock benchmark claim.
- Native page errors zero; existing construction-preview 404s retained. Existing portrait overlay still obstructs the grid; no touch-grid claim.
- Unchanged installed-client capture inspected separately; collision-ready/no error artifact but existing performance-pressure prompt, not a clean benchmark.
- Published 215/216 snapshots and primary hashes match F226. No local room edits are made by these checks.
- Initial full run had one unrelated wall-clock frame-budget test failure; its isolated recheck and subsequent full suite pass, with logs retained. No streaming source/test change was made. Test-only async mock return types were repaired before the passing gate.

Evidence: `/tmp/wamp-hidden-tab-audio-2026-10-09/`. Individually frontend-only, no migration/catalog/renderer/PartyKit or saved/replay format change. Inherited coordinated stack delivery requirements remain. No release.
