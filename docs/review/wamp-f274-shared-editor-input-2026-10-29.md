# F274: shared workspace drawing and camera controls — 2026-10-29

Delivered in [PR #336](https://github.com/songadaymann/wamp/pull/336), squash
merge `6bbe0ed7a61c5f0f50eac07695147feb14094704`.

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
  errors. The final workspace refactor passed all 244 expanded scenarios:
  tablet 80, phone portrait 82 and phone landscape 82, with zero page errors.
  These include actual mouse fast-Smart, stationary Spray/release/one-Undo, and
  middle-pan scenarios. Synthetic API writes are blocked.

Local logs: `/tmp/wamp-f274-workspace-check.log`,
`/tmp/wamp-f274-browser-workspace-tablet.log`,
`/tmp/wamp-f274-browser-workspace-phones.log`. Browser artifacts are in
`output/web-game/editor-touch/` and the isolated phone smoke workspace.

## Production delivery

All 18 jobs passed in [CI run 40889672537](https://github.com/songadaymann/wamp/actions/runs/40889672537).
The clean merged tree matched tested candidate `2eb42362` exactly. Guarded full
frontend/API deployment and final production smoke passed. API Worker
`dba6144a-3a88-4e6f-8cb8-26b7d307d171` is confirmed at 100% traffic; previous
version `29b0b3e2-41b8-425d-97e6-78f64c875473` is available for rollback.
Pages deployment: [aa01fc17](https://aa01fc17.wampland.pages.dev).

Production HTML now references `main-DplNrPGF.js`; live lazy editor bundles
`CourseEditorScene-C_0xBRa4.js` (100,713 bytes) and `EditorScene-DPRQ0P51.js`
(175,710 bytes) match the release build byte for byte. The initial deployment
smoke saw the prior HTML during alias propagation; the explicit asset checks and
final smoke confirmed the new entry and editor bundles. Database/migration 0076,
map assets and email configuration are healthy; test reset/debug links disabled.
No real-player room writes or emails were used for release verification.

Evidence: `/tmp/wamp-f274-deploy.log`, `/tmp/wamp-f274-deployments.json`,
`/tmp/wamp-f274-live-assets.json`, `/tmp/wamp-f274-prod-final.log`, and ignored
`output/web-game/f274-workspace-combined-report.json`. No schema migration.
