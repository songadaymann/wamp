# F274: shared workspace drawing and camera controls — 2026-10-29

Implementation and local checks complete. Browser matrix, PR CI and production
delivery are pending; this item is not checked off yet.

## Shared implementation

`EditorWorkspaceDrawingController` owns tile/object strokes, selection snapping,
Smart gap fill, held Spray, shape/copy previews and commits, curve bending, and
batch lifetime. Its workspace port supplies `sliceAt`, `originOf`, `runtimeOf`
and `clampToSlice`, plus inspector/clipboard presentation callbacks. The room
editor supplies one origin-zero slice; Expanded Rooms supply their real cells.
Their wrappers retain marker, inspector, clipboard and cell-selection routing.
The former single-room tool-down switch and both separate drawing states are gone.

Mouse strokes commit a cell when leaving it. Touch holds every visited cell open
until release; pinch, tool change, focus loss and native cancellation roll back
the entire gesture without consuming Undo/Redo. Shapes, copy selections and curve
bends stay in their starting cell. Shutdown forgets pending state without touching
Phaser's already-destroyed presentation layers.

Both editors also use one touch arbitration controller, Spray timer, cursor
renderer, shape renderer/path-bend controller, music camera fit, and pan/anchored
zoom helpers. Composer and overworld inspect input share pan/threshold math too.
Room-specific zoom bounds, background updates and Expanded Room bounds updates
remain in their hosts. Existing right-button policies are preserved: room
right-drag erases; Expanded Room right-click erases and right-drag pans after its
threshold. Middle-button input pans in both editors.

Expanded Room Spray now continues while held still, displays the circular brush
footprint, and does not gain extra bursts from pointer-event frequency. Fast
Smart strokes fill skipped cells through the same Bresenham sampling path as
single rooms. Cursor masks, object footprints and shape preview colors agree.

Relative to main `43dd7d1b`, changed runtime TypeScript shrinks from 8,819 to
8,149 nonblank lines (670 removed overall, including the new shared modules).

## Verification

- Baseline Expanded Room pointer characterization was committed before the
  controller refactor: short right-click erase, threshold pan, outside release,
  touch-before-Move arbitration and object-move precedence. Middle pan is covered.
- Shared workspace tests cover mouse cell commits, whole-touch rollback, revisit
  deduplication, object batches, nonzero origins, fast Smart strokes, shape/copy
  boundaries, curve acceptance/cancellation, held Spray and safe teardown.
- The stored Bresenham segment characterization keeps its exact expected sample
  order while exercising the new public workspace controller.
- Final full check: 717 files, 6,106 passing tests, 10 expected failures, two
  skips; lint, types, DOM, generated bindings, build and asset checks pass.
  Dead-code baseline stays 785; boot JavaScript is 665.3 KB Brotli / 670 KB.
- The intermediate touch-controller refactor passed all 226 existing browser
  scenarios on tablet, phone and phone landscape, in both editors, with no page
  errors. The final workspace refactor is undergoing the expanded matrix, which
  adds actual mouse fast-Smart, stationary Spray/release/one-Undo, and middle-pan
  scenarios. Synthetic API writes are blocked.

Local logs: `/tmp/wamp-f274-workspace-check.log`,
`/tmp/wamp-f274-browser-workspace-tablet.log`,
`/tmp/wamp-f274-browser-workspace-phones.log`. Browser artifacts are in
`output/web-game/editor-touch/` and the isolated phone smoke workspace.

No schema migration. Delivery still requires completed browser/CI evidence,
merged-source frontend/API deployment and production verification.
