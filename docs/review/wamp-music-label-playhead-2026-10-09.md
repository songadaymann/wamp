# F226 music label and playhead review

Tested candidate on F225 `315c5bc2` / draft #96. Master remains unticked. Primary and production unchanged.

All 24 sequencer labels compare their displayed text, color and alpha before invoking Phaser setters. Tab/theme/readout changes still update; actual label state avoids a duplicate cache or retained destroyed labels. The playhead now reads only audio/transport/source timing and arrangement kind through a typed lightweight snapshot in standalone and Expanded editors. Full diagnostic snapshots remain available on demand. Static Graphics command caching is deferred; no FPS/battery benchmark is claimed.

## Evidence

- Full quality gates: 404 files / 3,204 tests, lint, types, bindings and build; DOM 992/242, Worker safety and diff pass.
- Six added tests verify unchanged-frame and theme/external-state label mutations, idle playhead without context creation, precise playing clock without traversing song fields/full diagnostics, and stopped timing.
- Three complete native cases: standalone tab/note/Undo/Redo; phone tab/preview/Stop; Expanded preview/tab. Each settled 650 ms sample has **zero text/color/alpha setter calls and zero full diagnostic snapshots**, while the cheap playhead is read 39 times. Tab changes update 23 colors and 23–24 texts once, then return to zero stable mutations.
- All desktop/phone/Expanded screenshots inspected. Preview volume was set to 1 as a test precondition; this suite does not claim a native Settings flow (covered by F225). Existing portrait overlay still covers the grid; no touch-grid claim.
- Native page errors zero. Construction-preview 404s and the existing synthetic legacy-course expanded run-start FK500 are retained; the fallback editor opens and runs the tested selected-slice preview. No expanded run-clear/submission claim.
- Unchanged installed-client capture inspected: collision ready/no error artifact, existing performance-pressure prompt. No clean gameplay/performance benchmark claim.
- New 215/216 publications remain exact seed snapshots; existing 202/203 remain their exact stored v1 snapshots with silent published music. Primary hashes match F225.

Evidence: `/tmp/wamp-music-label-playhead-2026-10-09/`. No room/replay format, migration, catalog, renderer service or PartyKit change. Individually frontend-only; inherited coordinated stack delivery requirements remain. No release. Continue F229 hidden-tab audio and unused Phaser context.
