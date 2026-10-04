# WAMP checkup map recovery: F010 and F003

Jonathan authorized the next recommended pair and its production delivery. Base: `8a469416`, isolated in the existing managed worktree. Preserve the dirty primary checkout.

- [x] F010: replace history-wide request/retry scans with direct address lookups and limit availability refresh to relevant entries. Preserve timed LOD commits, retries, fallback, and context restoration.
- [x] Add regressions proving old manifest history does not increase frame candidate work and timed state transitions still complete.
- [x] F003: deploy the canonical renderer and backfill the current asset contract from an immutable Pages build.
- [x] Verify renderer readiness, published-leaf/ancestor parity, object existence, and browser coverage before activation. Keep the strict contract gate and existing compact fallback.
- [x] Add production availability monitoring and asset-contract CI diagnostics to prevent a silent repeat.
- [x] Complete repository checks, merge, deploy the frontend, activate compatible imagery, and verify the actual custom domain twice.
- [x] Update the master checklist, progress and feature ledger only after delivery.

Initial live diagnosis: active imagery uses `authoring-catalog-v1:4b122cb7accc8026`; the application expects `authoring-catalog-v1:d9d6c8cf7dbb63c3`. Rebuild rather than weakening compatibility checks.

Implementation verification: 273 files / 2,014 tests pass; targeted tile/health checks pass 24 files / 140 tests, including timed LOD/fallback transitions. Lint, TypeScript, generated bindings and production build pass. DOM contract passes. An initial bindings check saw local `.dev.vars` secrets as type inputs; removing that test-only symlink restores the unchanged generated contract.

Delivery order: merge and publish the frontend with the guarded Pages-only command's explicit `--skip-smoke` option while the known incompatible map is still disabled; complete candidate verification, activate matching imagery, then run the strict production smoke. This temporary omission does not waive the final smoke gate.

Delivered through [PR #34](https://github.com/songadaymann/wamp/pull/34), merged as `57b607c7`. Pages `51da2bbd` serves the tested production bundles; custom-domain and immutable Pages entry/runtime/editor/shared-state bundles match byte for byte. The release uses public production API, wallet and presence configuration. No API Worker, PartyKit or schema delivery was needed for this frontend change.

Renderer `production-2026-10-03-checkup-d9d6c8cf` is active at the existing 100% rollout. All 972 generations are ready: 665 matching published leaves and 307 matching ancestors, with no pending, leased, failed, missing or stale work. All 952 nonempty R2 image objects pass existence/metadata checks; render and dead-letter queue backlogs are zero. Candidate and live parity pass, including 87 advertised objects, three sampled leaves, and independently composed parent pixels/gutters. The strict compatibility guard remains unchanged.

The strict production smoke now passes with `available: true` and equal active/expected asset hashes. Two complete desktop/Android public-site runs pass zoom, middle-button/touch pan, and Android pinch gestures with 100% target coverage, zero replacement-gap frames, healthy graphics and no console/page errors. Screenshots were inspected. The original seven-zoom cold/warm probe also completed a functional run with 100% coverage and warm byte-cache hit ratio 1.0.

Performance evidence has limits. A direct live cold-start capture measures coarse imagery at 719.5 ms, sharp imagery at 1,186.4 ms and 819,164 bytes through sharp coverage; these meet the existing startup/size budgets. Another full run misses cold timing and manifest-latency budgets, and subsequent runs intermittently fail the public middle-button pan assertion because the camera does not move. The previous immutable frontend `ef80fd8e` reproduces the pan failure; the candidate API override also produces inconsistent early-bootstrap timing on both frontends. The tracked probes and thresholds were not weakened, and their complete acceptance suite is not claimed to pass. Keep the intermittent long-pan/manifest-timing probe as a follow-up; the independent public desktop/Android gesture checks above pass twice.

The [production map health workflow](https://github.com/songadaymann/wamp/actions/runs/37164394698) was manually exercised after activation and passed. The master checklist is now 23/214. Next recommended pair: F002 (a cadence-aware high-refresh cap, following its fact-check corrections) and F138 (refresh-rate-independent movement/jump behavior). Neither is included in this release.
