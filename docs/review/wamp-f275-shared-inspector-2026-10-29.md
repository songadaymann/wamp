# F275: shared object inspector — 2026-10-29

Delivered in [PR #337](https://github.com/songadaymann/wamp/pull/337), squash
merge `395ac4235eea443901960374da982cfa12c74cef`.

## Implementation

Both Room and Expanded Room inspectors use `EditorInspectorCore` for connection
clicks, local moving-platform paths, clear/prune dispatch, container clicks, and
world-space link, video, path and container overlays. Data-source ports retain
single-room runtime writes and Expanded Room document objectLinks with the legacy
pressurePlateLinks mirror. Actor-specific settings and inspector presentation stay
in their hosts.

Shared link copy includes barricades, accurate target names, video-only targets
and source-cell-only video guidance. Expanded Rooms offer only the source cell's
video anchor. Connecting to that video clears stale cross-cell document links and
their mirror. Existing local paths and target-removal pruning remain covered by
baseline controller characterization.

The initial checklist assumption about custom container contents was incorrect:
editor writes, save normalization, server commands and gameplay accept built-in
contents only. This change preserves that contract, resolves custom selections
accurately, and explains the limitation in both inspectors. Broader custom-content
support was asked as an optional scope question; no answer is recorded here.

## Verification

- Full check: 720 test files, 6,121 passing tests, 10 expected failures and two
  skips. Types, lint, DOM, bindings, build and asset checks passed. Dead-code
  baseline is 783; boot JavaScript is 665.8 KB Brotli against the 670 KB budget.
- Three baseline contracts preserve local link writes/clear, cross-cell document
  links and mirror policy, and pruning after target removal.
- Shared-core tests cover stale cross-cell replacement by video, local platform
  paths, registered custom-container guidance and world-space overlays.
- Native browser checks passed in portrait, landscape and narrow phone layouts,
  both Room and Expanded Room: six workflows, 63 named scenario groups, zero
  browser errors. Cases include link/clear/cancel, container configuration,
  custom-content guidance, video-only anchors, stale cross-cell replacement,
  NPC/Police/Sword Hunter settings, desktop handoff and Expanded Undo/Redo.
- Browser fixtures blocked synthetic API writes. No production rooms or player
  data were changed. No schema migration is required.

## Delivery

All 18 GitHub jobs passed in [CI run 40895538931](https://github.com/songadaymann/wamp/actions/runs/40895538931).
The clean merged release tree matched tested candidate `4ae4847b` exactly.
Guarded frontend/API deployment and production smoke passed. Worker
`f0292cdb-b7f8-453a-896b-4594ed81b4d2` is confirmed at 100% traffic; previous
Worker `dba6144a-3a88-4e6f-8cb8-26b7d307d171` remains available for rollback.
Pages deployment: [72a03385](https://72a03385.wampland.pages.dev).

Live HTML uses `main-BSeYuoUp.js`. That entry, both editor scene bundles and the
shared inspector bundle (`keyboardShortcuts-DrgZYeu5.js`) match release bytes.
Migration 0076 remains current; database, map and email health checks passed.
No production room writes or emails were used for verification.

The first deploy stopped before publishing on a transient D1 authorization 7403
response. Account listing and migration recheck succeeded; the guarded retry
exited 0. Evidence: `/tmp/wamp-f275-deploy-retry.log`,
`/tmp/wamp-f275-deployments.json`, `/tmp/wamp-f275-live-assets.json`, and ignored
`output/web-game/f275-inspector-combined-report.json`. Goal is 4/28 delivered;
Round 2 is 76/248.
