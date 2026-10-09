# F220 music preview and bounded buffer retention review

First local slice on F166 `f24986bf` / draft #92. Primary and production are unchanged. Full F220 and master remain unticked; per-instrument stems/live gain-pan and slot-by-slot Arrange playback remain larger followups.

## Behavior

Authored music edits commit immediately. Preview refresh waits 150 ms after the latest queued change, flushes when the canvas gesture ends, and cancels on explicit immediate sync, Stop, scene reset, shutdown or music-mode exit. Superseded queued edits are not dispatched; already-dispatched asynchronous renders retain the existing playback-request stale guard.

One shared LRU covers decoded clips and lane/pattern/phrase loops in editor and world playback: 16 clip entries, four loop entries across all kinds, and 50 MiB combined retained AudioBuffer bytes. Pending entries count toward entry limits. Oversized individual buffers are returned to callers without retention. Rejection permits retry; an evicted/replaced promise cannot recache itself or remove its newer owner. Existing callers and active audio sources keep their buffers. This bounds cache retention, not temporary render arrays, in-flight work or active-source memory.

## Evidence

- Full quality check: 400 files / 3,153 tests, lint, types, bindings and build. DOM 992/242, Worker safety and diff pass. Final formatting-only cleanup also passes targeted tests, lint and build.
- Ten new tests cover queued edits, final refresh and pointer flush, immediate sync and lifecycle cancellation, global entry/byte limits, LRU reuse, oversized buffers, rejection/retry and late promise ownership.
- Three accepted native cases: desktop continuous notes produce zero refreshes while held and one final refresh on release, exact Undo/Redo, 20 real Web Audio loop variants, Stop before pending tempo refresh, draft saving and actual world handoff; phone portrait Play/tempo/Save/Close with exact keyboard Undo/Redo; Expanded selected-cell edits, exact Undo/Redo, save isolation and Escape exit.
- Real AudioBuffers contain nonzero samples; retained loop count remains four and combined bytes remain below 50 MiB. This is scheduling/buffer evidence, not a subjective listening or iPad performance benchmark.
- Read-only local D1 confirms music drafts in 200/42, 201/42 and selected Expanded cell 202/42; 203/42 remains silent. All four published snapshots remain silent v1.
- Desktop, phone, Expanded and unchanged installed-client captures inspected; accepted native cases have zero page errors. The installed client has loaded collision/gameplay state with no error artifact, but captures the intro and later the existing performance-pressure prompt; no clean installed-client performance benchmark is claimed. Primary preservation hashes match F166.

Evidence: `/tmp/wamp-music-preview-2026-10-09/`, including `accepted-report.json`, real-buffer proof, saved DB proof and source/primary fingerprints. Only the completed desktop case from `native-d` and complete `native-e` suite are counted.

## Diagnostic limits

Existing desktop music Close overlaps account controls; Escape is the native desktop exit used. Existing opaque portrait music panel covers the note grid, so no portrait touch-grid pass is claimed; accessible phone Play/tempo/Save/Close controls pass. Initial harness runs retain module-HMR instance selection, per-note Undo grouping and tempo-cap corrections. The inherited synthetic legacy-course preferred expanded run-start FK500/course fallback remains a fixture limitation. Construction-preview 404s are retained. These layout issues and larger rendering work remain pending.

No migration, saved/replay format, catalog, renderer or PartyKit change. This slice is frontend-only by itself. The inherited stack still requires coordinated API/Pages, migrations 0060–0062 and a matching catalog/renderer; its existing catalog mismatch release gate remains unresolved.
