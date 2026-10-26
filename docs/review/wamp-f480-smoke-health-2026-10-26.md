# F480: smoke-test repairs and nightly coverage — 2026-10-26

Implementation pending CI and delivery. The parked F480 commits through
`e00e7f04` and the two subsequent Dropbox working-file edits were recovered onto
main after the F333 release (`81997368`).

## Changes

- A manifest assigns every smoke/probe to pull-request CI, a nightly group,
  deployment verification, manual use with a reason, or a developer tool.
  Tests keep that inventory complete, keep Playwright imports muted, and keep
  the six workflow groups synchronized with the manifest.
- The DOM contract also checks selectors in smoke scripts. The wallet/email
  smoke uses the current inline email-code UI. Editor suites use the current
  dock, inspector and palette; the game object is exposed to test-hook builds
  only behind the existing build-time and preview query gates.
- Play/guest smokes use recorded API fixtures with explicit stand-ins for
  unrecorded published cells, instead of depending on production data.
- The rollout tool uses installed viem signing and targets local D1 cleanup
  when its backend is local.
- Six groups run daily at 09:43 UTC, on manual dispatch, and on PRs that change
  the nightly runner, manifest, replay helper or workflow. Every group builds
  its test frontend and starts a fresh local Worker/D1 stack. The generated
  config omits production email, queue and service bindings. Servers and the
  temporary database directory are cleaned up after the run.
- The combined report fails on missing/corrupt/incomplete artifacts, unexpected
  failures and timeouts. An explicitly selected manual group requires only
  that group's artifacts. A known-issue allowance matches only the terminal
  error, not a phrase elsewhere in diagnostic output. Passing a previously
  known issue is flagged for removal of the allowance.

## Current checks

- Full `npm run check`: 707 files, 6,039 passing tests, 9 expected failures,
  2 skipped tests and 1 todo; styles, lint, dead code, types, DOM, generated
  bindings, build, bundle budget and asset checks passed.
- Manifest/report integrity tests: 11 passed. They include missing and partial
  runs, corrupt artifacts, timeouts, and unrelated errors mentioning a known
  regression.
- The current inline email-link browser smoke passed on the isolated stack.
- The police-enemy browser smoke passed on the isolated stack. Its initial
  failure identified a missing COMPACT_WORLD_READS test-stack flag; the config
  now enables compact reads without using production resources.
- The email-code screenshot was inspected. Artifacts and server logs are in
  ignored `output/nightly-smokes/` and `output/web-game/`.

The complete six-group run and normal PR checks still need to pass. Three
acknowledged regressions remain explicitly listed in the manifest: WampOS
single-shape tool selection, tablet Undo/Redo overlap, and the rating batch's
saved-state update. These are not silently converted into passing assertions.
