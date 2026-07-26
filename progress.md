Original prompt: can we do the final bit since it's now been over 24 hours again

## 2026-07-24 production tiled-overworld promotion

- Working from a fresh clean clone at `/tmp/wamp-rollout-100-t51qdz/repo`; the user's dirty primary checkout is untouched.
- The 25% Worker promotion completed at 2026-07-23T10:23:39Z. Current audit start is 2026-07-24T18:03:28Z, so the required hold has exceeded 31 hours.
- `origin/main` is `e7a33b7`; production config in source remains 25% with compact fallback enabled.
- Live config is healthy at 25%, but the active July 20 renderer had one stale L4 leaf for room `6,-11`.
- Guarded repair retried the leaf and exposed a strict missing-asset error: the newly published room contains `jimothy`, which the immutable July 20 render origin predates.
- Identified current immutable Pages deployment `https://5fc2c354.wampland.pages.dev` at source `e7a33b7`.
- Its `world-tile-render.html` exactly matches the live production asset and has SHA-256 `5900e74b1cad7bf457234dc66ddf6150a08708fd9250834230cb11f9cd23bac5`.
- Created inactive renderer version `production-2026-07-24-box-srgb-e7a33b7` and started a 467-leaf backfill. The existing active renderer and 25% rollout remain unchanged while it builds.
- Full local release verification on current `main` passed: ESLint, 72 Vitest files / 374 tests, typecheck, generated binding checks, and production build.
- Mid-backfill inspection confirmed temporary parent errors are only `waiting for current children`; the new renderer has no missing-asset failures and successfully accepts Jimothy.
- Replacement renderer reached 677/677 ready rows, 467/467 published leaves, complete L0-L3 ancestor parity, zero pending/leased/failed/outbox rows, and 677/677 valid R2 object pointers.
- Activated `production-2026-07-24-box-srgb-e7a33b7` atomically while keeping rollout at 25%.
- Full parity probe passed: 43,865-byte client manifest at p95 48.11 ms, 85/85 advertised viewport objects valid, exact leaf comparisons with zero differing pixels, and pixel-exact parent composition.
- The first browser pass intentionally encountered cold CDN misses for the brand-new immutable URLs; coverage stayed complete, but it warmed the edge and did not count toward the two clean suites.
- Two subsequent independent browser suites passed every gate. Suite 1: cold coarse 347.8 ms, cold sharp 801.8 ms, warm sharp 145.1 ms, 994,048 bytes through sharp. Suite 2: cold coarse 344.2 ms, cold sharp 790.4 ms, warm sharp 149 ms, 994,048 bytes through sharp. Both had 100% warm-cache hits, zero console errors, and fully populated inspected screenshots across all required zooms.
- Production rollout configuration changed from 25% to 100%; compact fallback, generation, and previous renderer objects remain preserved.
- Committed and pushed `d0883e3` (`chore: complete world tile rollout`) to `origin/main`.
- Deployed only the API Worker as version `322b1759-6846-4c52-aa4d-00da71be6c7a`; the guarded deployment's production smoke passed.
- Live public config reports rollout 100% with active renderer `production-2026-07-24-box-srgb-e7a33b7`.
- Post-deploy production integrity remains exact: 677/677 tiles ready, 467/467 published leaves matched, all ancestors current, zero pending/leased/failed/outbox rows, and 677/677 referenced R2 objects valid.
- The official web-game client verified an ordinary non-forced production cohort on the tiled path with 100% target coverage, zero stale tiles, zero replacement-gap frames, no fallback, no console errors, and a fully populated inspected screenshot.
- DONE: the 30-day 100% production soak begins now. Preserve compact fallback and both renderer generations until the soak completes; do not run browser-path cleanup or tile garbage collection before then.

## 2026-07-25 intermittent black overworld

- User report: after leaving the overworld open, the Phaser world occasionally becomes black while the DOM HUD and room hit-testing remain active; a page refresh restores it.
- Reproduced the exact visual and interaction symptom by forcing `WEBGL_lose_context` against production. The existing tile controller successfully rebuilds its textures when a restore event arrives, but there was no recovery if the browser left the context lost indefinitely.
- Branch: `codex/webgl-context-recovery` in the existing clean release clone; the dirty primary checkout remains untouched.
- Added a renderer-level WebGL recovery monitor with loss/restore diagnostics, a four-second native-recovery window, browse-only automatic refresh, a one-minute reload-loop guard, and manual reload UI for play/editor modes.
- Added `graphics` to `render_game_to_text` and `window.get_wamp_graphics_debug()` for loss count, restore count/duration, status, and auto-reload evidence.
- Focused Vitest (5 tests), ESLint, and TypeScript pass.
- The reusable `npm run perf:webgl:recovery -- <url> <output-prefix>` browser probe passes both real GPU paths. Native restoration returned to 14 attached tiles and 100% target coverage; an intentionally stuck context auto-reloaded once and returned to 14 attached tiles and 100% target coverage.
- Visually inspected both recovery screenshots; the overworld is fully populated after native restoration and after guarded reload.
- Official web-game client passes with healthy graphics diagnostics, 100% target tile coverage, zero replacement gaps/fallbacks, a fully populated screenshot, and no console error artifact.
- Full `npm run check` passes: ESLint, 73 Vitest files / 379 tests, TypeScript, generated binding checks, and production build. Wrangler emitted sandbox-only log-file `EPERM` warnings while confirming both binding files are current.
- Committed and pushed `11b7e8a` (`Recover from stalled WebGL contexts`) on `codex/webgl-context-recovery`.
- Client-only safety Pages deployment succeeded at immutable URL `https://07259fbf.wampland.pages.dev`; no Worker, D1, or PartyKit deployment was performed.
- Safety recovery probe passes both paths against the safety tile renderer. Native restore: 14 attached tiles, 100% target coverage, 839 ms recorded loss. Stuck loss: one guarded reload after four seconds, then 14 attached tiles and 100% target coverage.
- Visually inspected both safety recovery screenshots; both show the complete overworld with no missing areas.
- User reproduced the intermittent black overworld on the safety build without the context-loss recovery firing, proving WebGL context loss is not the only trigger.
- Found a separate display-state blind spot: coverage counted mapped/GPU-ready tile images even when an interrupted blend, external destruction, display-list detachment, visibility flag, alpha, or camera filter left those images unable to render. An unchanged display signature then skipped all normalization forever.
- Added stable-frame tile image invariant repair. Desired images are recreated or normalized without interrupting a healthy 75 ms blend; a transition still incomplete after one second is completed deterministically.
- Added tile-layer health counters and repair evidence to `render_game_to_text`, plus Phaser scene/camera/layer diagnostics and renderer/game-loop heartbeat details to distinguish tile-state failure, display-layer failure, render-loop stall, and real context loss.
- Focused 9-test Vitest suite, ESLint, TypeScript, and production build pass.
- Committed and pushed `4045cb6` (`Repair stalled overworld display state`) on `codex/webgl-context-recovery`.
- Deployed the second client-only safety build at immutable URL `https://8de180d9.wampland.pages.dev`; no Worker, D1, PartyKit, D1, or tile-renderer deployment was performed.
- Official safety client smoke shows the complete overworld, 14/14 healthy desired images, 100% target coverage, a live game/render heartbeat, healthy WebGL, healthy cameras/layers, zero fallback, and zero replacement gaps. The only console artifact is Cloudflare Browser Insights rejecting its own immutable-preview origin.
- TODO: user should repeat the natural leave-open scenario on this immutable safety URL. If the symptom still occurs, capture `render_game_to_text()` before refreshing; the new snapshot now identifies the failed rendering tier. Promote to production only after user approval.

## 2026-07-26 rapid-zoom render-loop stall

- User reproduced the black overworld on the instrumented safety build while rapidly zooming and captured the failure before refreshing.
- The capture ruled out WebGL context loss and tile/display-object loss: the renderer context was healthy, the canvas and both Phaser layers were attached and visible, and 101/103 desired tile images were healthy. Both POST_STEP and POST_RENDER heartbeats were about ten seconds stale even though Phaser still reported its loop as running.
- The same capture showed rapid-zoom pressure: coverage epoch 261, 21 fetches, 5 decodes, 62 decoded GPU uploads, and four replacement groups. The desired level was L3 while committed imagery remained L4.
- Root failure shape: Phaser's RAF wrapper schedules the next frame only after the current callback returns. A synchronous callback failure can therefore orphan the RAF chain while `TimeStep.running` and Phaser's RAF `isRunning` flags both remain true.
- Added a POST_RENDER-based recovery monitor. Recent input, runtime errors, and visible-page resume events now verify that rendering continues; a stale browse loop is restarted by replacing the orphaned RAF chain, with two-attempt bounds and new diagnostics for RAF state, restart counts/reasons, and the last runtime error.
- Runtime errors and unhandled rejections are now retained in boot diagnostics after app readiness instead of being silently dropped.
- Cross-LOD target refinement now waits through the existing 80 ms gesture-idle window, so the currently displayed imagery scales immediately without repeatedly decoding levels that cannot yet commit.
- Decoded-but-not-uploaded tile work is bounded to eight images on the normal profile and four on the reduced profile. Tile texture installation and display synchronization failures are contained so they cannot terminate the game frame callback.
- Focused Vitest passed: 5 files / 49 tests. TypeScript and the production build passed.
- Committed and pushed `60931a3` (`Recover tiled overworld render stalls`) on `codex/webgl-context-recovery`.
- Safety deployed at immutable URL `https://1576591e.wampland.pages.dev`. The safety deploy script reapplied no D1 migrations, deployed the unchanged safety API Worker bundle/assets, deployed Pages, and skipped PartyKit/presence.
- Official safety client smoke: healthy live RAF and render heartbeat, 14/14 desired images healthy, target coverage 100%, zero queue depth, zero replacement gaps/fallback, and a complete inspected screenshot. Cloudflare Browser Insights still emits its known immutable-preview CORS artifact.
- Rapid-zoom browser pass issued 120 fast wheel inputs across five zoom-out/zoom-in cycles. Frames advanced from 43 to 399, final POST_RENDER age was 29 ms, target coverage returned to 100%, all queues drained to zero, all 14 desired images remained healthy, and the inspected screenshot remained fully populated.
- TODO: user should repeat the natural rapid-zoom/leave-open scenario on the new immutable safety URL. Production remains on only the earlier WebGL context-loss recovery until explicit promotion approval.
