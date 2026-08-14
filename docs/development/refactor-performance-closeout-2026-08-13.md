# Refactor performance and dead-code closeout

This report closes T17 without changing grid caching, presence cadence, controller mode gating,
or the browser-composed room fallback.

## Runtime changes

- `OverworldPlayScene` reuses one `lastMovementInput` object across frames, reset, and player
  destruction instead of creating a new object every update.
- The existing mobile profiler can collect 20 controller-level segments with
  `mobilePerfControllers=1`. Detailed controller sampling is round-robin and explicitly opt-in so
  the performance probe does not become its own bottleneck. Coarse `update.world`,
  `update.noPlayer`, and `update.player` segments remain unchanged.

The 20-second opt-in diagnostic recorded 17 controller labels during the exercised Play path.
The largest sampled owners were live objects (1.61 ms average), room comments (1.24 ms), world
streaming (0.69 ms), movement (0.36 ms), room transition (0.29 ms), and player presentation
(0.26 ms). Browse-only and inactive-mode owners remain available when their paths execute.

## Comparable runtime probes

All probes used Canvas, 4x CPU throttling, the safety API/PartyKit, and the same scripts and routes.
The runtime timing and transition-correctness gates are authoritative; browser wall-clock frame
gaps are recorded but are sensitive to host load.

| Probe | Before T17 | After T17 | Result |
| --- | ---: | ---: | --- |
| 60-second dense-room traversal profiler p95 | 6.2 ms | 7.4 ms | Pass (`<20 ms`) |
| Five-transition profiler median p95 | 18.8 ms | 19.5 ms | Pass (`<20 ms`) |
| Transition correctness | 5/5 | 5/5 | Pass |
| Cold / warm seam hold | 0 / 0 ms | 0 / 0 ms | Pass |
| Scheduler long / failed jobs | 0 / 0 | 0 / 0 | Pass |
| Browser or transition errors | 0 | 0 | Pass |

The first post-change transition sample was above threshold. A simultaneous frozen-T16 control
also moved from its earlier 18.8 ms baseline to 21.4 ms, establishing host variance. A second T17
sample passed at 19.5 ms. Room-snapshot clone counters remain nonzero in both before and after
artifacts (traversal and transition deltas vary with hydration); T17 neither caused nor claims to
fix that pre-existing red counter.

Artifacts:

- Before traversal: `/private/tmp/everybodys-platformer-refactor-build/T17-before-traversal/result.json`
- Before transitions: `/private/tmp/everybodys-platformer-refactor-build/T17-before-transitions/result.json`
- After traversal: `/private/tmp/everybodys-platformer-refactor-build/T17-final-traversal/result.json`
- After transitions: `/private/tmp/everybodys-platformer-refactor-build/T17-authoritative-transitions-v2/result.json`
- Controller diagnostic: `/private/tmp/everybodys-platformer-refactor-build/T17-controller-diagnostic/result.json`
- Concurrent frozen-T16 control: `/private/tmp/everybodys-platformer-refactor-build/T17-concurrent-baseline-transitions/result.json`

## Entry-bundle audit

A Vite manifest audit found that three canvas-only render entries preloaded all of Phaser because
pure custom-tile and starfield drawing helpers lived in Phaser-aware modules. The helpers moved to
Phaser-free modules while their original modules retain compatibility re-exports.

| Entry | Initial JS before | Initial JS after | Change |
| --- | ---: | ---: | ---: |
| Minted room | 1,973,900 bytes | 487,128 bytes | -75.3% |
| Room preview renderer | 1,655,213 bytes | 168,441 bytes | -89.8% |
| World-tile renderer | 1,657,038 bytes | 170,266 bytes | -89.7% |

No other non-game HTML entry loaded Phaser. The game and its canvas renderers still load the
modules they intentionally need; no speculative splitting was performed.

## Knip triage

Knip remains a report-only command and is not added to `npm run check`. The current pinned report
still has unexplained or compatibility-sensitive findings:

- 2 unused-file candidates (`worldTiles/index.ts` and `leaderboardRoomVersions.ts`), which require
  separate dynamic/runtime confirmation before deletion.
- 1 unlisted dependency (`ethers` in a manual rollout script).
- 2 unlisted binaries (`knip` in the shared-install environment and external ImageMagick).
- 133 unused exports, 83 unused exported types, and 2 duplicate-export names. Many are public
  model, test, compatibility, Worker, or manual-script surfaces, so bulk deletion is unsafe.

The early world-tile bootstrap remains an explicit Vite-read entry in `knip.json`. The executable
entry contract still models every Vite HTML/module entry, Worker, PartyKit server, build-time
bootstrap, package script, and manual script. A dead-code CI gate may be reconsidered only after
the remaining findings are individually explained or removed.
