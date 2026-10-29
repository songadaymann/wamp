# F275: shared object inspector — 2026-10-29

Implementation and local verification complete; CI and production delivery pending.
This item remains unchecked until delivery is verified.

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

Pending PR, CI and guarded frontend/API rollout. Goal stays 3/28 delivered.
