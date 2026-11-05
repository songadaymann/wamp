# WAMP engine: owning the game runtime

**Status:** proposal · 2026-11-04 · based on main @ 24e3626 · Evidence and verdict: [wamp-engine-viability.md](wamp-engine-viability.md)

## Summary

- **The hunch is mostly wrong on frame rate** (verdict: mostly no, medium confidence). Phaser's JS plus the GL and canvas work it triggers is 2.1 of 9.6 ms per play frame at 1x and 14.9 of 71.5 ms at 4x CPU throttle (MEASURED, headless SwiftShader, phone viewport). WAMP's own code costs 2-3x that.
- **Most of the big wins need no port.** Phone memory, room-entry hitches, battery and the FX boot cost all have small fixes on Phaser 3 or in WAMP code: two FX flags, the F353 TileSprite subclass, a one-cell brick patch, F356, F312 and F317.
- **The hunch is right on three things, and only a port gets them:** about 110-150 KB brotli of boot JS (16-22% of 672 KB), about 5-11% of play-frame CPU after the fixes, and freed CPU copies of uploaded textures (all ESTIMATED). These are moderate gains, not huge ones.
- **Agents make the code cheap, not the checking.** The oracles that would prove parity don't exist yet, and Jonathan's review and play-testing don't parallelise.
- **The plan is path E: Stages 1-4 on Phaser 3, which pay off either way.** Quick wins, real-phone baselines, the Stage 3 oracles and step clock, and owned render paths inside Phaser. About 25-45 h of Jonathan's time and $2k-9k of agent spend; at least 4 weeks, about 1-2 months at 5-10 h a week (all ESTIMATED).
- **Then a decision gate on a real mid-range Android.** Port only if Phaser is still at least 20% of play-frame CPU, or Phaser eval plus init still costs at least 400 ms and boot is a priority, or field telemetry shows context loss that only owned textures can fix. Otherwise WAMP stays on Phaser 3 for good. The projection says the gate could go either way (see Delivery plan › Decision gate).
- **Only if it passes, port slice by slice:** Stage 5 renderer, Stage 6 physics, Stage 7 retire Phaser, each behind flags and kill criteria. That adds about 80-160 h of Jonathan's time, $6k-27k and two or more quarters (ESTIMATED).
- **The biggest gap:** no real phone has been measured yet.
- **What Jonathan should do first:** approve the check-queue change to the one-item-at-a-time rule (see Running it with agent fleets); say whether boot is a product priority and which Android phone and iPhone to use; then let the fleet open the first Stage 1 PRs: the FX flags, `losewebgl` telemetry (which starts the 4-week clock) and the F353 subclass.

## Background

**WAMP today.** WAMP is a TypeScript and Vite web app. `index.html` starts in `src/main/coarseFirstEntry.ts`. A classic script with no Phaser in it (`src/main/earlyWorldTileBootstrap.classic.ts`) paints the coarse world map first. Then `src/main.ts:88-122` builds one `Phaser.Game`. The backend is Cloudflare Workers, D1, R2 and a presence Durable Object. No server path uses Phaser: `src/cloudflare` has 0 Phaser imports.

**How WAMP uses Phaser.** WAMP runs Phaser 3.90.0 as the prebuilt arcade-physics UMD file (`vite.config.ts:44`). The bundler cannot tree-shake it. It ships as the `phaser-vendor` chunk: 231.9 KB brotli of 672.0 KB boot JS, or 34.5% (CITED: `scripts/check_bundle_budget.mjs` at 24e3626).

| Phaser does this for WAMP | WAMP already does this itself |
| --- | --- |
| Arcade physics on a fixed 60 Hz step. WAMP runs movement and live objects inside Arcade's `worldstep` (`src/scenes/overworld/physicsCadence.ts:56-137`). | Audio: `audio: { noAudio: true }` (`src/main.ts:96`). WAMP has its own audio engine. |
| The display list for live objects, parallax TileSprite backgrounds, lighting, weather and in-canvas text. | Keyboard: DOM listeners (`src/scenes/overworld/keyboardInput.ts:19-20`). |
| The texture manager and loader (about 176 boot art files, F316). Cameras, pointer input, scene lifecycle. | Gameplay time: `src/scenes/overworld/gameplayClock.ts`. |
| Five `Phaser.Scene` classes: Boot, OverworldPlay, Editor, CourseEditor, CourseComposer. The editor chunks load lazily (`src/scenes/editorSceneLoader.ts:10-20`). | Visible play terrain: a baked image from `src/visuals/roomSnapshotTexture.ts`. The `TilemapLayer` stays hidden and exists only for collision (`src/scenes/overworld/fullRoomPresenter.ts:136-178,250-252`). |
| The editors' visible `TilemapLayer`s. | DOM UI, through typed bridges (`src/ui/setup/sceneBridge.ts:188-263`). |

WAMP uses no Matter, shaders, particles, lights or Phaser audio. The imports are wide, but the coupling is narrow (MEASURED by grep unless tagged):

- About 185 non-test files import Phaser, 90,082 LOC in total. 64 of them import it as a type only.
- About 8-15k of those lines actually touch Phaser, in about 120 files (ESTIMATED).
- The deep coupling is Arcade: 213 `Arcade.Body` references and 37 collider and overlap calls (Appendix A explains why the census counts 208).
- 112 of 741 test files use `vi.mock('phaser')`.

**The inspiration.** Jonathan saw an engine-builder on X, @ggsimm (gsimone, a pmndrs contributor). It raised the question of whether WAMP should own its engine, now that agent fleets make code cheap to write. The study could not read the post. Their public 2025-2026 work is shader and graphics tooling, and the study found no public game engine or performance claim from them to compare against (CITED: field research). So this PRD tests the idea itself, not a particular engine. The evidence and the full verdict are in [wamp-engine-viability.md](wamp-engine-viability.md).

## Problem

Phone players pay for memory, heat, room-entry hitches and slow first play. Phaser's core loop is not the main cause. The main causes are WAMP code, WAMP assets and Phaser defaults that WAMP never turned off. A few costs are Phaser's own design.

All frame and boot numbers below come from headless Chromium with SwiftShader software GL. They show CPU shares and call counts, not phone frame rates. Nobody has traced WAMP on a real phone yet. That is the biggest gap in the evidence. The viability report has the full breakdown.

| What players suffer | Number (tag) | Main cause | Fixable on Phaser 3? |
| --- | --- | --- | --- |
| Tab runs out of memory in Forest areas | TileSprite hidden copies: 48-55 MB per Forest room (CITED F353). Player atlas: 21.7 MB of source pixels, 98% empty (MEASURED; F317 cites 26 MB of graphics memory), plus about 21 MB per extra avatar (CITED F317). FX render targets: 43 MB requested vs 18 MB with FX off at 390x844 (MEASURED, requested, residency unknown) | Phaser design and defaults (`TileSprite.js:181,277`; `src/main.ts:88-122`), WAMP assets | Yes: the F353 subclass, the F317 repack, two FX flags |
| Heat and battery drain | Full-rate redraw behind full-screen menus, while paused and while idle. Battery Saver changes almost nothing (CITED F356; `src/performance/performancePolicy.ts:44-53`) | Mixed. Phaser renders PAUSED scenes (`SceneManager.js:592-595`); WAMP's gate policy does the rest | Yes, in `src/main/frameCadence.ts` |
| Pause on entering a room | About 36 phone frames (0.58 s) per uncached room (CITED F312). `frameWorkCoordinator` p95 92 ms at 4x (MEASURED) | WAMP (fixed cost guesses, CPU bake) | Yes |
| Hitch when a brick breaks or a tile crumbles | 58.7 ms whole-room re-bake inside the gameplay frame (MEASURED, headless software raster; `src/scenes/overworld/specialTiles.ts:883-918`) | WAMP | Yes. A one-cell patch takes 0.36 ms (MEASURED) |
| Slow first play on phones | First game frame 2.2-3.7 s at 1x, 9.0 s at 4x (MEASURED, localhost). Asset preload 1.4-2.4 s / 6.0 s; Phaser module eval 127-213 / 671 ms | Mostly WAMP assets | Mostly. Phaser eval and download are the port-only part |
| Leaderboards are not fully trustworthy | 0% of ranked clears are re-simulated. The server checks plausibility only | WAMP. The trace is not a complete step-indexed input log, and mechanics timers advance on render-frame delta (`src/scenes/overworld/gameplayClock.ts:12-17`) | Yes (Stage 3) |

On the low-end proxy a play frame is 71.5 ms at 4x, and Phaser JS plus the native work it triggers is 14.9 ms of it, about 7 of which is TileSprite construction (MEASURED). At 1x, WAMP's own per-frame cost is 6.4 ms against Phaser's 2.1 ms (MEASURED). WAMP's three largest per-frame items are WAMP code:

- `src/scenes/OverworldPlayScene.ts:3184` puts `window.innerWidth`/`innerHeight` into a cache key that it checks every frame. That costs 527 ms per 20 s at 1x.
- `src/ui/modalState.ts:49` runs `querySelectorAll` on every keyboard update.
- `src/analytics/replay/canvasCapture.ts:2`, called from `src/bugReports/recentReplay.ts:28`, runs `createImageBitmap` on every frame to capture replays.

Draw calls are not the problem. A play frame makes 7.3 draw calls (MEASURED).

**What Jonathan suffers as the engineer:**

- **Tests check shapes, not behaviour.** 112 of 741 test files mock Phaser, because Phaser throws in node. About 11 scripts, with 93 references, reach into Phaser internals.
- **WAMP patches Phaser's private fields.** See `src/main.ts:137-150`, `src/main/frameCadence.ts:71-93` and `src/main/renderLoopRecovery.ts:60-65`. A stall monitor guards the result.
- **Input and lifecycle are fragile.**
  - About 8 DOM workarounds exist for Phaser's window-level touch and mouse listeners.
  - There are two resize systems.
  - More than 75 lifecycle subscriptions depend on Phaser's event order.
- **There is no oracle.** WAMP has no live-frame goldens and no step-indexed trace corpus. Context loss is logged only to the console. Without these, nobody can safely make any large renderer or physics change, with or without a port.
- **Phaser 3 is near the end of its line.** 3.90.0 is the last 3.x tag (CITED). Phaser 4 breaks APIs, and its arcade build is 29 KB brotli bigger (MEASURED).

## Goals

Player-facing outcomes come first. Each one maps to a row in Success metrics and budgets.

1. **Faster first play on phones.** Less boot JS and less boot work before the first game frame, measured on a real mid-range Android.
2. **No memory crashes.** Remove the hidden per-room copies and the oversized atlas. Phone texture memory per room stays flat as players move through Forest areas.
3. **Cooler phones and longer battery.** No full-rate frames behind menus, while paused or while idle. Battery Saver actually saves battery. Live multiplayer and Weekly Rush keep full rate.
4. **No room-entry or brick hitches.** A room is ready in fewer phone frames. Breaking a brick or crumbling a tile never stalls a gameplay frame.
5. **Trustworthy leaderboards.** The server re-simulates ranked clears exactly, on top of today's plausibility checks.
6. **Faster safe development.** Agent fleets can change rendering and physics, and an automated oracle catches drift before Jonathan has to.

Engineering goals:

1. **Measure on real devices first.** Get play, map and boot traces on one mid-range Android and, best effort, one iPhone before any port decision. Re-baseline after the Phaser 3 fixes.
2. **Build the oracles before anything big changes:**
   - step-indexed input traces with a `physicsVersion`
   - a golden-trajectory corpus from headless Arcade over every published room
   - a separation fuzzer
   - live-frame goldens
   - a time-model replay gate
   - an engine-neutral debug API for the scripts that reach Phaser internals today
3. **Own the time model.** Timers, combat, portals and objectives run on the step clock, behind a `physicsVersion` bump.
4. **Stop patching Phaser internals.** Render gating, loop recovery and texture lifetimes live behind WAMP-owned seams.
5. **Decide the port with numbers.** Path C opens only if the decision gate passes on the real devices (see Delivery plan › Decision gate).
6. **If the port happens, keep the engine small and removable in slices.** The renderer goes first and physics last. The hidden Arcade layer stays until the physics gate passes. The owned runtime fits in 60 KB brotli with parity features (see Kill criteria).
7. **Bound Jonathan's time.** About 25-45 h up to the decision gate (ESTIMATED). No more than 40 h inside the renderer slice before its gate passes (see Kill criteria).

## Non-goals

- **No change to game feel or room data unless it is explicitly versioned.** Any change that can move a trajectory or a timing bumps `physicsVersion`, goes through Verification and parity, and gets Jonathan's play-test.
- **No visual redesign.** Pixel art, `pixelArt`/`roundPixels` behaviour, depth order and room visuals stay as they are. Live-frame goldens enforce this.
- **No backend rewrite.** Workers, D1, R2 and the presence Durable Object stay. Server re-simulation is a new queue job, not a new backend.
- **No WebGPU-first renderer.** WebGPU reaches about 75% of Android and 86% of iOS, against about 98% for WebGL2. Published 2D results are neutral or negative (CITED). WebGL2 stays primary, with a Canvas fallback lane.
- **No Phaser 4 migration** (path B). It is bigger, flips `roundPixels`, and the live frame has no pixel oracle to check it against.
- **Not a general-purpose engine.** The engine covers 40x22 rooms of 16 px tiles, WAMP's object types, its editors and its map. It has no plugin system and no public API.
- **No change to the DOM UI framework** (`src/ui`) **or to WAMP's audio engine.**
- **No big-bang port** (path D).
- **No change to server-side room rendering.** That path has no Phaser in it today.

## Success metrics and budgets

Targets are given at two points. "At the decision gate" means after Stages 1-4, all still on Phaser 3 (see Delivery plan). "If the port happens" means after Stage 7, measured against the decision-gate build, not against today's build.

Every headless number comes from SwiftShader on a 390x844 phone viewport at DPR 2. Each one must be re-measured on the real devices in Stage 2 and again after Stage 4. The harness is in `scripts/engine-port/` (`runtime-profile/`, `engine-bench/`; see its `README.md`).

| Metric | Today (tag) | Target at the decision gate (on Phaser) | Target if the port happens | How it is measured |
| --- | --- | --- | --- | --- |
| Boot JS, brotli | 672.0 KB; `phaser-vendor` 231.9 KB (CITED) | About 612-622 KB, via a custom Phaser 3 build (ESTIMATED: 672 − 50..60) | About 455-490 KB (ESTIMATED: 672 − 231.9 + a 15-50 KB owned runtime). Kill the boot rationale if the runtime with parity features exceeds 60 KB | `npm run size:check` (`scripts/check_bundle_budget.mjs`) in CI |
| Time to first game frame, 1x | 2.2-3.7 s, localhost (MEASURED) | At least 60 ms lower from the FX flags (MEASURED delta). Preload cuts (F316, F317) set the rest after re-baseline | A further 0.10-0.17 s lower (ESTIMATED) | `runtime-profile/boot.mts` and `modeval.mts`; on the phone, the same tools on a `measure.mts --cdp` trace |
| Time to first game frame, 4x | 9.0 s, localhost (MEASURED) | At least 150 ms lower from the FX flags (MEASURED delta), plus preload cuts | A further 0.35-0.55 s lower (ESTIMATED). Kill the boot rationale if the target phone saves under 250 ms | Same |
| Main-thread ms per play frame, 4x | 71.5 ms; Phaser JS + triggered native 14.9 ms = 21% (MEASURED) | About 55-62 ms (ESTIMATED: 71.5 − about 7 TileSprite − 2.5..9.6 ms of WAMP hot spots; the low end assumes all of their 2,378 ms per 248 frames leaves the frame) | About 50-59 ms (ESTIMATED: 55-62 − 3..4.5, the port-only cut) | `runtime-profile/analyze.mts` CPU split; `window.wampMobilePerf` |
| Phaser share of play-frame CPU on the real mid-range Android | TBD (no real-device trace) | Measured, with Phaser's absolute ms per frame next to it. 20% or more opens path C. Under 20% means stay on Phaser 3, unless the boot or context-loss condition holds. Under 15% with p95 in budget also triggers kill criterion 1 | 0% Phaser | `runtime-profile/measure.mts --cdp` on the device (Android over adb), then `analyze.mts` |
| p95 frame time, real mid-range Android, steady play | TBD | Proposed budget: 16.7 ms (60 Hz), confirmed against the Stage 2 baseline. Streaming frames are tracked separately | Same budget or better | `runtime-profile/measure.mts --cdp` on the device (the path is untested today), plus Safari Web Inspector by hand on iOS |
| Hidden background copies per Forest room | 48-55 MB (CITED F353); 2.86 MB GPU + 0.86 MB heap per sprite (MEASURED) | Under 1 MB per room after the first background (CITED F353 fix estimate) | About 0 MB (ESTIMATED) | The harness's WebGL allocation wrappers (the texture census misses TileSprite's private canvases); device memory trace |
| FX render targets requested, 390x844 | 43 MB (MEASURED requested, residency unknown) | 18 MB (MEASURED with FX off) | Never allocated | WebGL allocation wrappers in the harness |
| Player atlas | 21.7 MB of source pixels, 98% empty (MEASURED; CITED F317) | 85-90% smaller (CITED F317); the Stage 1 gate asks for at least 80% | Unchanged from the gate build (an engine does not repack art) | Texture census: the debug API `textures()` call once Stage 3 ships (test builds); until then the harness's census |
| Retained CPU texture copies | Up to 40 MB of world tiles, reduced profile (ESTIMATED) | World-tile bitmaps closed after upload (about 30 LOC) | CPU copies freed after upload; tens of MB on phones (ESTIMATED, low confidence) | Device memory trace; `losewebgl` telemetry |
| Frames rendered behind full-screen menus / while idle | Full rate (CITED F356) | About 92% fewer behind menus; about 50% fewer idle or in Battery Saver (CITED F356); the Stage 1 gate asks for at least 80% fewer behind menus. Live multiplayer and Weekly Rush unchanged | Render only when something changed (ESTIMATED, by design) | rAF and draw counters in the harness |
| Room-ready frames on phones, uncached room | About 36 frames, 0.58 s (CITED F312) | About 18 frames (ESTIMATED: F312 EWMA, per-room chunk frames, index-texture tilemap) | About 18 (no extra gain from the port) | `window.wampMobilePerf` `stream.frameWorkCoordinator`, in `npm run perf:runtime:mobile` and on the device trace |
| Brick or crumble hitch | 58.7 ms in the gameplay frame (MEASURED, software raster) | About 0.36 ms, one-cell patch plus sub-upload (MEASURED prototype) | Same | Harness micro-bench; `scripts/mobile_smoke_ci.mjs` |
| Ranked clears re-simulated on the server | 0%. Plausibility checks only | Selected ranked clears re-simulated in shadow from a queue (Stage 3b), at a coverage set by the CPU budget (about 0.2-0.7 s CPU per 60 s run, ESTIMATED) | Same, enforced once shadow agreement is proven | Queue counters on the run verifier (new in Stage 3b) |
| Tests running real engine code | 112 of 741 test files mock Phaser; about 11 scripts / 93 refs reach Phaser internals (MEASURED) | Physics and movement tests run on real headless Arcade. 0 scripts reach Phaser internals (engine-neutral debug API) | 0 files mock the engine. The DOM-free core runs in vitest | `grep vi.mock('phaser')`; CI test inventory |
| Context-loss rate in production | Unknown (console only) | Reported to the server for at least 4 weeks | The new restore path passes the injected `WEBGL_lose_context` screenshot-diff gate | New telemetry; Verification and parity gate |

**What "no change in feel" means.** Parity is a set of numeric gates, not an impression. Ghost alignment and verifier pass rates never count as parity evidence. Ghosts and plausibility checks are tolerant by design, so they cannot detect changes in feel. The gates (details in Verification and parity):

- **Fixed-step physics.** `scripts/smoke_physics_cadence.mjs` holds the player and actors within 0.01 px of the 60 Hz run at 30-240 Hz. This applies to every change.
- **Separation.** The fuzzer requires the candidate's SeparateX and SeparateY to match Arcade's bit for bit.
- **Golden trajectories.** 100% of steps within 0.01 px is the target. Under 99.9% after the fixed iteration budget stops the physics swap.
- **Replayed top ranked traces.** No changed outcome (clear, death or finish). Median finish-time shift no larger than 1 frame (16.7 ms). No tight room becomes unsolvable.
- **Time model.** Recorded rAF delta sequences (jank, 120 Hz gating, blur and refocus) give identical steps per frame and identical `elapsedMs`.
- **Pixels.** Live-frame goldens of reference rooms, editor states and map levels of detail allow 0 tolerance for tiles. `src/rendering/roomRenderers.equivalence.test.ts` stays green.
- **Lifecycle.** Scripted flows (play to edit, edit to course, pause and menus) emit the same sequence of lifecycle events.
- **Jonathan's blind A/B on the tight-rooms list.** Jonathan must not tell new from old above chance: 6 or fewer correct out of 10 per release candidate. Seven or more on 2 consecutive release candidates stops the physics swap.

Any change that cannot meet these gates is not a parity change. It ships only as a versioned `physicsVersion` change with its own leaderboard handling.

## Options considered

Five paths were costed. Under ultracode economics, writing code is cheap. What costs is verification, behaviour parity and Jonathan's hours, because those run one after another and agents cannot do them in parallel. So each path below is costed in fleet time plus Jonathan's hours. Every hour figure is ESTIMATED, from about 300-500 LOC/h of careful review and about 20 h of play-testing per release candidate (7 modes × 3 device classes).

| Path | What it is | Gains | Cost in agent terms | Jonathan's hours | Risk | Verdict |
|---|---|---|---|---|---|---|
| **A. Stay on Phaser 3, fix hot spots** | FX flags, TileSprite shared-pattern subclass (F353), one-cell brick/crumble patch, per-room chunk-preview frames, WAMP per-frame fixes (`OverworldPlayScene.ts:3184`, `modalState.ts:49`, replay `createImageBitmap`), F356 render gate, F312 EWMA, F317 atlas repack, ImageBitmap close plus remove on `losewebgl`, `losewebgl` telemetry, `useTree`/`maxTextures` experiments, custom Phaser 3 build | Most of the large items: tens to hundreds of MB of phone memory, about 92% fewer frames behind menus (CITED F356), no room hitches, -60/-150 ms to first frame at 1x/4x (MEASURED), about 7 ms/frame of 4x bursts gone (MEASURED), -50-60 KB br boot JS (ESTIMATED) | About 15-25 small PRs, 2-4k LOC. About 1 fleet-day to write and 2-4 fleet-days to verify, all on gates that already exist (`npm run smoke:physics-cadence`, the 61-test roomRenderers equivalence suite, `npm run size:check`, the F274 touch scenarios, `npm run perf:runtime:mobile`) | 8-15 h | Low. `useTree:false` and `maxTextures` must pass the cadence smoke and a real-device check | **Do now.** Stage 1 of path E |
| **B. Upgrade to Phaser 4** | Move to 4.2.x: shader TileSprite, TilemapGPULayer, managed WebGL state | Some memory (TileSprite), maybe faster static GPU tilemaps. No boot win: +29 KB br (MEASURED). No independent v3-vs-v4 benchmark exists (CITED, vendor claims only) | The mechanical migration takes days. Verification is the main cost, because the live Phaser frame has no golden images today | 25-45 h | Medium. The whole renderer changes with no pixel oracle, `roundPixels` defaults to false (pixel-art risk), the bundle gets bigger, and WAMP reads the private `camera.matrix` (`CourseEditorScene.ts:1621-1624`) | **Not now.** Reconsider only if the A fixes prove hard on 3.x or 3.x stops getting fixes |
| **C. Strangler port** | Phase 0 sim core and oracles, then an owned renderer behind a seam (keeping the hidden Arcade layer), then physics behind a facade shaped like the Phaser API, then remove Phaser from the editor, input and lifecycle | All of A, plus the port-only gains: about 110-150 KB br boot JS, about 5-11% of play-frame CPU, freed CPU texture copies, owned time/physics model, DOM-free tests (all ESTIMATED) | Phase 0: 1-2 fleet-weeks. Renderer slice: 2-4 fleet-weeks, 2-4k LOC plus a Canvas lane. Physics: a 3-5k LOC engine plus about 33k LOC of Arcade-shaped code behind a facade; the time to reach 0.01 px parity is unknown. Editor and input removal: 1.5-3k plus 1.1k LOC of adapters. Months of running both engines | 90-180 h (Phase 0 10-20, renderer 20-40, physics plus removal 60-120) | Medium-high, held in check by gates. Hard parts: physics feel, leaderboard comparability, iOS gestures, context loss | **Only if the decision gate passes** (see Delivery plan) |
| **D. Big-bang custom engine** | Write an 8-15k LOC engine and rewrite about 8-15k Phaser-touching lines in about 120 files at once | Same end state as C | The code takes days. With no oracle, failures cannot be traced to a cause | 120-250 h, plus leaderboard triage and a likely rollback | High. Feel drift is invisible to ghosts and the verifier, and nothing can ship separately | **Reject** |
| **E. Fix first, build the oracle first, decide later** | A, then real-device traces, then the Phase 0 oracles, then owned render paths inside Phaser (an index-texture tilemap drawn by a Phaser Extern game object), then the gate for C | About 80-90% of what a port could deliver (ESTIMATED), plus exact server re-simulation of ranked runs and the oracles any later port needs | About 2-3 fleet-weeks. Every gate either exists or is built in Stage 3 | 25-45 h to the gate, including 4-6 h play-testing the step-clock change on tight rooms | Low-medium. The step-clock change can shift timings by up to 1 frame on janky or high-refresh devices | **Recommended** |

This PRD names path E's steps as Stages 1-4 and the decision gate, and path C's slices as Stages 5-7. Stage 3 is what the ruling calls Phase 0.

**The boot saving that only a port gives.** Phaser-vendor is 231.9 KB br. A custom Phaser 3 build is ESTIMATED to save 50-60 KB br. An owned runtime is ESTIMATED at 15-50 KB br. By straight subtraction a port beats the custom build by (231.9 − 50..60) − 15..50 ≈ 122-167 KB br. The ruling uses a more conservative 110-150 KB br (16-22% of the 672 KB boot), and this PRD uses that range. The 15-50 KB runtime range is a guess. The engine-floor bench put a WAMP-capable engine at 30-80 KB br (ESTIMATED), and at 80 KB the saving would fall to about 92-102 KB br. That is why one kill criterion drops the boot rationale above 60 KB br (see Kill criteria).

### Build vs adopt

| Candidate | What it would buy WAMP | What it would not buy | Evidence |
|---|---|---|---|
| **Phaser 4.2.x** | A TileSprite with no POT canvas, TilemapGPULayer for static layers, built-in context restore | Boot size: the arcade build is 250.0 vs 220.9 KB br, +29 KB (MEASURED from npm tarballs). Tile edits need `generateLayerDataTexture`. The Canvas renderer is deprecated, and WAMP has a `?renderer=canvas` fallback. Performance claims come from the vendor only (CITED) | github.com/phaserjs/phaser/releases; the v4 MIGRATION-GUIDE.md |
| **PixiJS v8** | A fast batcher: big v7-to-v8 bunnymark gains (CITED). A tree-shaken minimal app is 139.4 KB br (MEASURED) | It saves only about 40-90 KB br against Phaser (ESTIMATED) and drops physics, tilemaps, input, cameras and tweens, so WAMP would still build those. At 10k sprites Pixi beat Phaser 47 to 43 FPS (CITED, thin method), and WAMP draws far fewer than 10k sprites. Batches break on every sprite/Graphics switch | pixijs.com/blog/pixi-v8-launches (snippet); github.com/Shirajuki/js-game-rendering-benchmark |
| **twgl.js 7** | A thin WebGL2 helper, 9.3 KB br (MEASURED). A good base for an owned renderer | No scene graph, physics, input or text. It only saves boilerplate | npm tarball, measured |
| **Kontra 10** | A small game loop and sprite micro-engine, 12.0 KB br (MEASURED). Shows the size floor | Canvas2D, no WebGL batcher, no Arcade semantics. A reference point, not a base | npm tarball, measured |
| **LittleJS 1.29** | A complete small engine | It is not small: 128 KB br plus a separate box2d wasm (MEASURED) | npm tarball, measured |
| **WebGPU backend** | Helps with many batch breaks (filters, masks, blends) | Reach: about 75% of Android and 86% of iOS, against about 98% for WebGL2 (CITED web3dsurvey). Samsung Xclipse and Firefox Android lack it. 2D results were neutral or negative at Pixi, Figma, Construct and three.js (CITED). It would be a second backend to verify. WebGL2 stays the baseline | github.com/gpuweb/gpuweb/wiki/Implementation-Status; figma.com/blog/figma-rendering-powered-by-webgpu; discourse.threejs.org (WebGPURenderer 2x CPU thread) |

The published engine-swap cases do not show that owning the engine is the win. The gains came from batching fixes inside the existing engine (Phaser CE #356: several hundred draw calls cut to 5-6) or from moving to native (Vampire Survivors). Both CITED. WAMP's draw calls are already low: 7.3 per play frame (MEASURED, headless SwiftShader). If WAMP builds its own engine, the realistic shape is an owned runtime on raw WebGL2 or twgl, sized like the floor bench. Adopting another general engine would mean paying Phaser's migration cost again for a smaller gain.

## Strategy

**Fix first, build the oracles first, then port by slices behind measured gates.** Each part of that order answers a specific fact about WAMP.

**Why not a big-bang rewrite.** Fleets make the writing nearly free, but they do not make verification free. Every successful agent migration in the field research had a cheap, objective oracle, and the one without a hard gate shipped broken CI (see Running it with agent fleets). WAMP has no oracle that can judge a new engine today:

- Ranked traces log only moveX/moveY/jump, with no step index (`src/runs/verificationTrace.ts:9`).
- The 9 cadence fixtures compare Arcade with itself at different refresh rates, never against another engine.
- The live Phaser frame has no golden images.
- Ghosts and the server verifier are coarse by design, so they cannot see small changes in feel.

A big-bang port would land about 16-30k changed lines (ESTIMATED: an 8-15k LOC engine plus 8-15k rewritten Phaser-touching lines) with nothing to say which one broke a corner jump. It also cannot ship in pieces: editor test-play wakes `OverworldPlayScene` (`src/scenes/EditorScene.ts:609-617`). And each failed release candidate costs Jonathan about 20 h of play-testing, which no fleet can do for them.

**Why fix first.** Most of the large wins are not port-only. The TileSprite copies, FX render targets, room re-bakes, render-while-paused and WAMP's own per-frame hot spots are all fixable in tens to hundreds of LOC on Phaser 3 (see Options considered, path A). WAMP's own per-frame cost is 2-3x Phaser's (6.4 vs 2.1 ms at 1x, 32.3 vs 14.9 ms at 4x; MEASURED, CDP profile of the real app). Once path A lands, a port's frame gain shrinks to about 5-11% (ESTIMATED). A port must be judged against that fixed build, not against today's.

**Why oracles first.** Stage 3 pays off even if no port ever happens:

- Timers, combat and portals move onto the step clock. Today they run on render delta: `gameplayClock.ts:14`, `framePipeline.ts:142-170`.
- Inputs are logged with a step index, and traces get a `physicsVersion`.
- Agents and scripts get an engine-neutral debug API.
- New gates: live-frame goldens, a golden-trajectory corpus over every published room, a separation fuzzer, a time-model replay.

These upgrade server-side verification from plausibility checks to exact re-simulation, run from a queue. They also become the gates any later slice must pass (see Verification and parity).

**Why the renderer slice goes before physics.**

- **The gains are there.** The port-only gains are mostly renderer gains: boot JS, owned texture lifetimes, and Phaser's render-side frame cost. Physics is not a bottleneck: Arcade's core is 0.17 ms/step for 334 bodies and 999 colliders (MEASURED, node).
- **The renderer has objective oracles.** The 61-test roomRenderers equivalence suite and the server-rendered L4 world-tile leaves exist today, and Stage 3 adds live-frame goldens at tolerance 0 for tiles.
- **Physics is the most feel-sensitive surface.** It spans 213 `Arcade.Body` references, 87 `blocked.` and 54 `touching.` reads, and hidden Arcade rules such as tile-axis choice and Y-first body separation (MEASURED, play-sim map).
- **The order follows the value.** The slice with the largest gain and the cheapest checks goes first. The slice with the smallest gain and the riskiest checks goes last, and may never happen.

**Why the hidden Arcade layer stays until the physics gate.** Terrain collision today reads an invisible Phaser `TilemapLayer` with `setCollisionByExclusion` and runtime `putTileAt`/`removeTileAt` (`src/scenes/overworld/fullRoomPresenter.ts:250-290`). Keeping it means the new renderer can draw rooms from index textures while collision stays bit-identical. Ranked runs, ghosts and leaderboards are then untouched by construction during the renderer slice. The hidden layer goes only when the Stage 6 gate passes:

- at least 99.9% of golden steps within 0.01 px;
- no outcome change on replayed top traces;
- Jonathan at chance in blind A/B tests on tight rooms.

If the gate fails, headless Arcade stays as the sim for good (see Kill criteria).

**Why Stage 1-4 work is not throwaway.** Everything built in Stages 1-4 is written against interfaces WAMP owns, with Phaser behind them as one adapter. No new code reaches into Phaser internals. Each piece is the first version of a final engine module (see The engine):

| Built in Stages 1-4 (on Phaser) | Becomes in the WAMP engine |
|---|---|
| Step clock for timers, combat and portals; time-model replay | Time model and loop |
| Step-indexed input log plus `physicsVersion`; golden corpus; separation fuzzer | Determinism contract and server re-simulation; physics parity gate |
| Engine-neutral debug API replacing the 11 scripts that reach Phaser internals | Debug and test surface |
| F356 paused/modal/idle gate in `src/main/frameCadence.ts:71-93` | Render-on-dirty loop |
| TileSprite shared-pattern subclass; index-texture tilemap drawn by a Phaser Extern game object on a thin GL interface | Repeat-background and tile-layer renderers |
| Refcounted texture keys, ImageBitmap close, `losewebgl` telemetry | Owned texture lifetimes and context-loss restore |
| Live-frame goldens | Renderer parity gate |

If the gate never opens, every row still stays in WAMP and keeps earning its keep: phone memory, battery, exact re-simulation and real tests.

**The decision gate.** Path C opens only if a measured gate passes on a real mid-range Android after Stage 4. The conditions, the projection of how it may go, and how it relates to kill criterion 1 are in Delivery plan › Decision gate. If it fails, WAMP stays on Phaser 3 for good and spends the effort on its own hot spots.

## The engine

This section designs the engine that path C would build, and only if the decision gate passes. Several parts are needed either way, because Stages 1-4 build first versions of them inside Phaser. All code citations are main @ 24e3626.

| Subsection | First needed in |
|---|---|
| Design principles; Module map and size budget | Stage 3 (the `src/engine/` seam), then Stage 5 |
| Time model and loop | Stage 3 (step clock), Stage 5 (owned loop) |
| Simulation and physics | Stage 3 (canonical order), Stage 6 (owned solver) |
| Determinism contract and server re-simulation | Stage 3 |
| Rendering | Stage 4 (owned paths inside Phaser), Stage 5 |
| Textures, assets and memory | Stage 1 (partial fixes), Stage 5 |
| Input, resize and lifecycle | Stage 1 (interim config), Stage 7 |
| Debug and test surface | Stage 3 |
| Living with Phaser during the transition | Stage 3 onward |

### Design principles

1. **WAMP owns the time model.** Today gameplay time is Phaser's smoothed render delta, summed in `gameplayClock.ts:12-17`. Frame pacing works by patching `game.loop.raf.start` (`frameCadence.ts:71-93`). The engine has one documented clock, and it belongs to WAMP.
2. **Deterministic fixed step.** All gameplay state moves forward in 1/60 s steps and only in steps. Frame rate, render delta, device speed and room-streaming order never change an outcome.
3. **DOM-free headless core.** The clock, simulation and input-log modules import nothing from `window`, `document` or WebGL. They run unchanged in the browser, in vitest (node environment, `vitest.config.ts:5`) and in a Cloudflare Worker. Phaser cannot load in node at all (`require('phaser')` throws "window is not defined", MEASURED).
4. **Explicit resource lifetimes.** Every texture, buffer and body has one owner, one creation call and one release call. The engine never keeps a hidden copy. The opposite cases today are TileSprite's per-instance canvases (F353), CanvasTexture's read-back (F304) and retained texture sources (F307).
5. **Render on dirty.** If nothing visible changed, no frame is drawn. Paused, covered and idle are first-class loop states, not workarounds (F356).
6. **Small and WAMP-specific.** The engine knows about 16 px tiles, 40x22 rooms, pixel art, one world camera per view and a screen-space backdrop layer. It has no plugin system, no ECS framework, no physics engines it won't use, no audio (WAMP has its own audio engine; `main.ts:96` sets `noAudio`) and no WebGPU backend. WebGL2 reaches about 98% of phones against about 75-86% for WebGPU (CITED, field research).
7. **Engine-neutral debug API.** Smokes and probes talk to a stable `window` debug surface, never to engine internals. Today about 11 scripts and 93 references reach into Phaser (`world._elapsed`, `body.prev`, `game.step`; MEASURED). See Debug and test surface.
8. **Parity before improvement.** The first version of every module copies today's behaviour exactly, quirks included. Each improvement ships later as its own change, behind a `physicsVersion` bump if it touches simulation. Only parity is a valid reason to change anything during the port.

### Module map and size budget

The proposed layout is `src/engine/`, with two entry points. `index.ts` is the browser build. `headless.ts` exports only `core/` and `sim/`, for vitest and Workers.

| Module | Job | Replaces in Phaser | DOM-free | LOC (ESTIMATED) | Boot brotli budget (ESTIMATED) |
|---|---|---|---|---|---|
| `core/` (loop, clock, lifecycle, events, faults) | rAF loop, step clock, loop states, scene/mode lifecycle with documented order, per-frame error isolation | `Phaser.Game`, `Core.TimeStep`, `RequestAnimationFrame`, `SceneManager`, `EventEmitter`; WAMP's `frameCadence.ts` patch and `renderLoopRecovery.ts` | clock and events yes; rAF shell no | 0.6-1.0k | 3-4 KB |
| `sim/` (world, body, grid, separate, arcadeCompat, order, hash, inputLog) | Grid-native collision, body integration, pair rules, canonical order, state hash, step-indexed input log | Arcade `World`, `Body`, `StaticBody`, `Collider`, `Group`, `StaticGroup`, `SeparateTile`, TilemapLayer collision | yes | 2-4k | 10-14 KB |
| `render/` (gl2, canvas2d, displayList, camera, tileLayer, repeatLayer, lighting, graphics) | WebGL2 quad batcher with a Canvas2D fallback lane, depth-sorted display list, index-texture tile layer, shared repeat layers, single-pass lighting, batched rect/line/triangle API | `WebGLRenderer`, `CanvasRenderer`, GameObjects (Sprite, Image, Rectangle, Container, Layer, TileSprite), `Graphics`, `Cameras.Scene2D` | no | 2.2-4.2k | 14-18 KB |
| `assets/` (textures, loader, ledger, restore) | Texture registry that takes ImageBitmap or canvas with explicit upload and dirty calls, fetch plus createImageBitmap loading, GPU/CPU byte ledger, rebuild on context restore | `TextureManager`, `CanvasTexture`, `TextureSource`, `LoaderPlugin` | ledger yes | 1.0-1.5k | 4-6 KB |
| `input/` (pointer) | Pointer Events scoped to the canvas, with capture and coalesced samples | Phaser Input pointer plugin | no | 0.2-0.4k | 1-2 KB |
| `text/` (bitmapFont) | Pixel-font glyph quads with no per-string texture (F310) | `GameObjects.Text` | layout yes | 0.5-1.0k | 2-3 KB |
| `anim/` (frames, tween, timers, math) | Spritesheet frame index, small tween helper, timers on the step clock, Clamp/Linear/rect helpers | `Animations`, `Tweens`, `Time.Clock`, `Math`, `Geom` | yes | about 0.5k | 2-3 KB |
| `debug/` (api, probes) | Engine-neutral debug API, state dumps, frame capture | `window` hooks into Phaser internals | yes | 0.3-0.6k | 0 at boot (lazy) |
| **Total** | | | | **about 7.3-13.2k** (census range 8-15k) | **36-50 KB** |

The LOC figures come from the Phaser census (ESTIMATED). For the brotli budgets, the reference points are Arcade at 18.8 KB br for roughly 3-5k LOC, twgl at 9.3 KB br and Kontra at 12.0 KB br (all MEASURED).

**Budget and kill line.** The target is 50 KB br or less for the boot engine. Any number above that needs written justification. Above 60 KB br, the boot rationale is dropped (kill criterion 2). The same criterion drops it if the engine saves under 250 ms of time to first game frame on the target phone. The arithmetic: a custom Phaser 3 build is about 231.9 − (50 to 60) = 172-182 KB br. Against that, a 36-50 KB br engine saves 122-146 KB br. At the 60 KB cap it saves only 112-122 KB br, the bottom of the ruling's 110-150 KB br range. The headless entry (`core/` clock plus `sim/`) should stay at or under about 20 KB br (ESTIMATED), close to Arcade's 18.8 KB br. `scripts/check_bundle_budget.mjs` enforces both numbers.

**What stays WAMP code.** Movement rules (`movementController.ts`, 1,736 LOC, 0 scene references). Live-object behaviour (`src/scenes/overworld/liveObjects/`). Enemy AI (`src/enemies`). World streaming, LOD, LRUs and the frame-work coordinator. The Canvas2D and software painters (`roomSnapshotTexture.ts`, `roomImage/`). Keyboard and gamepad input (`keyboardInput.ts` and `gamepadInput.ts` already bypass Phaser). Audio and music. The DOM UI (30k LOC). Context-loss policy and UI (`webglRecovery.ts`). Runs, ghosts and the server verifier. The engine supplies mechanisms: clock, bodies, quads, textures. WAMP keeps the rules. About 75-80k of the 90k LOC in files that import Phaser is engine-agnostic logic of this kind (ESTIMATED, census).

### Time model and loop

**One clock.** Gameplay time is `step × 1000/60` ms, counted from run or scene start. Nothing in gameplay reads render delta. Today several systems do:

| System | Clock today | Citation |
|---|---|---|
| Movement, live objects, special tiles | Arcade fixed step, via the `worldstep` listener | `physicsCadence.ts:59,109-134`; `OverworldPlayScene.ts:1418-1424` |
| Mechanics timers (`gameplayNow`, 45 call sites): spring windows, knockback, stomp impact, cooldowns | Sum of smoothed render delta × assist speed | `gameplayClock.ts:12-17` |
| Portals | Per render frame | `framePipeline.ts:140` |
| Sword swing, projectiles, PvP hits, void respawn | Per render frame, `gameplayDelta` | `framePipeline.ts:142-156` |
| Room transition, ranked trace frame | Per render frame | `framePipeline.ts:157-163` |
| Objectives, Room Rush | Per render frame (`gameplayDelta`, `delta`) | `framePipeline.ts:182-185` |
| Enemy death cleanup, respawn delay | `scene.time.delayedCall` | `src/scenes/overworld/liveObjects/enemyLifecycle.ts:357,412` |

All of these move onto the step clock in Stage 3, inside Phaser, behind a `physicsVersion` bump. Each runs from the step callback in a fixed order: environment, then movement, then combat, portals, transitions, objectives, then the trace. After that the engine only has to copy stepped behaviour. Moving them changes timing by up to one frame on janky or 120 Hz devices. Jonathan's play-test of the tight rooms and the cadence smoke at 30-240 Hz must confirm it. If they don't, kill criterion 8 applies.

**Accumulator.** In compatibility mode the loop copies Phaser's `TimeStep` smoothing: the 10-frame delta history and panic handling (`TimeStep.js:379-435`). It also copies Arcade's accumulator and catch-up loop (`World.js:936-1010`), so steps per frame match today exactly. The time-model replay gate checks this (see Verification and parity). Assist mode keeps today's rule from `assistRuntime.ts:49-52`. It changes how many steps run per wall-clock second, never the step length, so a slowed run simulates exactly like a normal one.

**Input sampling and press edges.** The rules from `physicsCadence.ts` stay as they are:

- Input is sampled once per rendered frame. Held directions always use the latest sample.
- Press edges (up, down, left, right, jump) are ORed into the pending input. They survive frames that run no step (`physicsCadence.ts:102-106`).
- The first step that runs consumes the edges. They are cleared before simulation, so a death or teardown in that step cannot replay them (`:119-125`).
- The environment is simulated before input is read, because hazards may respawn or replace the player (`:115-118`).
- Pending input resets on pause, sleep, resume and wake, and when the player identity changes (`:51,60,87-93`).

Two changes complete the model. Sword and gun presses join the same edge set; today they are buffered per frame in `framePipeline.ts:129-131`. And the trace recorder reads the step input, not the frame. Then the ORed `jumpPressed` fix for render-owned traces (`physicsCadence.ts:129-132`) is no longer needed.

**120/240 Hz gating.** `FrameCadenceGate` (`frameCadence.ts:8-61`) moves into `core/` unchanged. Its jobs: auto-detect a stable 120 or 240 Hz display and cap rendering, enforce frame deadlines in 60 mode while keeping the leftover time, and reset on hidden pages, visibility changes and big gaps. What changes is the wiring. The loop asks the gate before each frame; it no longer wraps Phaser's scheduler. Because simulation is fixed-step, the gate only cuts render and presentation work. It never changes outcomes.

**Loop states and render on dirty (F356).**

| State | Simulation | Render | Entered when |
|---|---|---|---|
| `running` | steps | every frame the gate allows | play, test-play |
| `idle` | steps (state may not change) | only when dirty | no step changed the state hash, camera still, no animation frame due |
| `paused` | frozen, accumulator held | only when dirty | pause menu, `gameplayPause` |
| `covered` | frozen or running, by mode | none | a full-screen DOM menu covers the canvas |
| `background` | none, no rAF | none | `document.hidden` |

These sources mark the frame dirty: a step that changed state, camera movement, an animation frame advance, a texture upload, a display-list change, a resize and editor edits. When the loop leaves `background` or `paused`, it resets the accumulator, so no burst of catch-up steps follows. Today that reset happens on `visibilitychange` and in the cadence reset handlers. F356 estimates about 92% fewer frames behind menus and about 50% fewer when idle (CITED). Most of that ships on Phaser first, in Stage 1, through the existing gate.

**Per-frame error isolation.** Today a Phaser rAF callback that throws never schedules the next frame. The running flags stay true, so WAMP watches a render heartbeat and restarts the chain (`renderLoopRecovery.ts:59-63`, plus the private-field casts in `main.ts:137-150`). The new loop schedules the next frame before doing any work, and it runs each phase (sample, step, present, render) in its own try/catch. A presentation or render fault is reported once and the loop goes on. A fault inside a step freezes simulation and shows the same recoverable card `webglRecovery.ts` uses. The broken step is never half-replayed. An active ranked run that hits a step fault is marked unrankable. The stall monitor and its restart logic are deleted.

```ts
export type LoopState = 'running' | 'idle' | 'paused' | 'covered' | 'background';

export interface StepClock {
  readonly stepHz: 60;
  readonly stepMs: number;          // 1000 / 60
  readonly step: number;            // only gameplay time; replaces gameplayNow()
  nowMs(): number;                  // step * stepMs
}

export interface StepInput {        // one per step; logged by sim/inputLog
  held: number;                     // bitmask: left, right, up, down, jump, touch variants
  pressed: number;                  // edges consumed by this step, incl. sword, gun
}

export interface LoopSystems {
  sampleInput(): StepInput;                          // once per rendered frame
  step(clock: StepClock, input: StepInput): void;    // 0..n times per frame, fixed order inside
  present(stepsThisFrame: number): void;             // camera follow, animation, HUD
  stateChanged(): boolean;                           // for idle detection
}

export interface Loop {
  readonly clock: StepClock;
  readonly state: LoopState;
  setState(next: LoopState, reason: string): void;
  markDirty(reason: string): void;
  stepOnce(input?: StepInput): void;                 // tests and smokes; replaces game.step()
  onFault(handler: (f: { phase: 'sample' | 'step' | 'present' | 'render'; error: unknown }) => void): () => void;
}
```

### Simulation and physics

**Grid-native collision.** Each room's terrain is a 40x22 `Uint16Array` of cells plus a `Uint8Array` of face flags, held at a fixed 16 px tile size. Cell flags cover solid, one-way, ladder, slope piece, inset top and special (crumble, brick). Today the same job takes a hidden TilemapLayer per room (`fullRoomPresenter.ts:185-252`), StaticGroup zones for inset tiles (`:440-470`) and about 40 Collider objects per room. Special tiles become a cell write plus a face recompute for that cell and its neighbours; today they call `Tile.setCollision` (`specialTiles.ts:434,871`).

**Features the solver must carry.** All live-object files below are under `src/scenes/overworld/liveObjects/` unless a path is given.

| Feature | Today | Engine home |
|---|---|---|
| Slopes / triangle pieces | Post-separation position patches that read `body.prev` (`utilityObjects.ts:499-540`; shapes in `src/config/trianglePiece.ts`) | Compat: the same patch as a post-step hook in the same order. Later: first-class slope cells under a new `physicsVersion` |
| One-way platforms, drop-through | Collider process callback (`specialTiles.ts:345-370`); `beginOneWayDropThrough` (`OverworldPlayScene.ts:2403`) | One-way cell flag plus a per-body drop-through window |
| Ladders | Movement-controller rules over touching state | Unchanged WAMP rule; the engine supplies cell queries |
| Springs | `hazardController.ts` with mechanics timers | Unchanged rule on the step clock |
| Crates / pushables | Linear drag and max velocity (`src/scenes/overworld/liveObjects.ts:774-778`); pushable/immovable semantics | `dynamic` body with Arcade-compatible drag |
| Moving platforms | `kinematic`-like bodies, friction(0,0) against catch-up double carry (`src/scenes/overworld/liveObjects.ts:768-772`); carry rebuilt from sprite plus `prevFrame` (`movingPlatforms.ts:79-90`) | `kinematic` body with explicit carry. One canonical position, so no sprite/body sync |
| Rolling balls | Own integrator (`rollingBallPhysics.ts`, 864 LOC, 0 Phaser imports) | Engine body (see below) |
| Player | Three objects: invisible body rectangle, avatar sprite, pickup sensor (`src/scenes/overworld/playerLifecycle.ts:63-95`) | One body plus an attached sensor |
| Environment zones: ice, conveyor, water, wind, side gravity | WAMP rules over Arcade bodies; the cadence smoke's 9 fixtures cover them | Unchanged WAMP rules over engine cell and zone queries |
| Enemies and projectiles: police, the Sword Hunter body, sword and gun shots | Arcade bodies and overlaps; projectiles step per render frame today (`framePipeline.ts:142-156`) | Engine bodies and sensors on the step clock |
| Overlap sensors: pickups, portals, co-op pressure plates (`src/placedObjects/coopPressurePlates.ts`) | `physics.add.overlap` (12 calls) | `sensor` bodies with `overlap` pair rules |
| Jungle vines and butt stomp | Movement-controller and live-object rules over touching state | Unchanged WAMP rules on the step clock |

**Arcade-compatible semantics mode (`arcade-3.90`).** This is the only mode the port ships. It must reproduce these behaviours bit for bit against headless Arcade:

- **Step order.** The first step of a frame runs `preUpdate`: it resets `blocked` and `touching` and syncs from the game object. Then integration: gravity, acceleration and drag, the max-velocity clamp, then position. Then colliders in registration order. Then the step callback, where WAMP sets velocities for the next step and runs slope and carry fix-ups (`World.js:936-1010`). Catch-up steps call `update`, not `preUpdate` (`World.js:1020-1060`). The compat mode keeps that difference.
- **Flag lifetimes.** `blocked` and `touching` are reset only when a step runs. Movement reads them after collision in the same step: grounded is `blocked.down || touching.down || …` (`movementController.ts:597-600`). Coyote time and jump frames depend on this.
- **Tile separation.** `SeparateTile` chooses the axis from |dx| against |dy| and the face flags, uses `TILE_BIAS` 16 and culls uninteresting faces the way `setCollisionByExclusion` does (`SeparateTile.js:55-110`). Each room is its own layer today, so face culling stops at room edges. The compat grid keeps per-room faces. The corpus must confirm this at room seams.
- **Body against body.** `SeparateX`/`SeparateY` with `OVERLAP_BIAS` 4. The axis order comes from world gravity, not the body's own gravity. World gravity.y is always set (`OverworldPlayScene.ts:1373`), so separation is always Y-first, even in side-gravity zones. Drag uses Arcade's FuzzyEqual thresholds (`World.js:1246-1330`).
- **Pair order.** Pairs are processed in whatever order the shipping build produces, with or without the dynamic tree. `useTree` is a Stage 1 experiment, and the setting that ships becomes the oracle.

A separation fuzzer and the golden-trajectory corpus prove the mode (see Verification and parity). The later `wamp` semantics mode can make slopes first-class and simplify corner rules, but only under a `physicsVersion` bump.

**Canonical ordering.** Bodies and pair rules are kept in arrays sorted by (room, instance id, role), never in Set insertion order. Today Arcade walks `world.bodies` and the collider ProcessQueue in creation order (`World.js:957-966,986-997`), and creation follows room-streaming order (`fullRoomPresenter.ts:1044-1060`, `interactionCoordinator.ts:175-339`). Canonical order changes behaviour, so it lands in Stage 3 inside Phaser: sorted registration plus a `physicsVersion` bump. The engine then copies that canonical order.

**One physics model.** Three integrations must agree today: Arcade, `rollingBallPhysics.ts`, and the Sword Hunter planner's forward simulation. The planner steps at `SIMULATION_STEP_MS` (`src/enemies/swordsmanRobustPlanner.ts:101`) and resolves X then Y in `stepSimBody` (`:585-625`), unlike Arcade's min-axis rule. The engine replaces all three with one stepper. The planner calls `world.fork()` on a snapshot of the bodies near the Sword Hunter, so its predicted jumps are the real ones. Unifying removes about 1.4k LOC of duplicate code (864 + the planner simulation at `:393-625`). It changes rolling-ball paths and enemy routes, so it ships in two steps. First, rolling balls run in the engine with their current math, checked against their own goldens. Then everything is unified under a new `physicsVersion`, using F302's golden set of 100+ plans as the before-picture. Performance is not the reason: Arcade's core costs about 0.17 ms per step for 334 bodies and 999 colliders (MEASURED, node). In a busy area, most of the step is WAMP's own step code (CITED, `docs/review/wamp-split-colliders-phone-ci-2026-10-11.md:23-24`).

**Numeric rules for the sim.** Only `+ - * /`, `Math.sqrt`, `floor`, `round`, `min`, `max` and `abs` are allowed. No `Math.hypot`, no trig, no `Math.random`, no `performance.now` or `Date`. A lint rule enforces this on `src/engine/sim/` and on every WAMP rule called from a step. Today `rollingBallPhysics.ts` uses `Math.hypot` 7 times (MEASURED, grep at 24e3626), and its rounding is not guaranteed to match between V8 and JavaScriptCore. Replacing it is a `physicsVersion` change. The Sword Hunter warm-up may keep its wall-clock budget (`src/scenes/overworld/liveObjects/swordsmanEdgeWarmup.ts:99`) only while warm and cold plans give the same result, which is what F302's golden test checks.

```ts
export const PHYSICS_VERSION = 2;                 // 1 = today, implicit; 2 = Stage 3 step clock + canonical order

export type BodyKind = 'dynamic' | 'kinematic' | 'static' | 'sensor';
export interface Faces { up: boolean; down: boolean; left: boolean; right: boolean; none: boolean }

export interface Body {
  readonly id: string;                            // canonical: `${roomX},${roomY}:${instanceId}:${role}`
  kind: BodyKind;
  x: number; y: number; prevX: number; prevY: number;   // one canonical position, no sprite copy
  vx: number; vy: number; ax: number; ay: number;
  dragX: number; dragY: number; maxVx: number; maxVy: number;
  w: number; h: number;
  gravityScale: 0 | 1;                            // allowGravity
  immovable: boolean; pushable: boolean; frictionX: number; frictionY: number;
  category: number; mask: number;
  readonly blocked: Faces; readonly touching: Faces;    // reset when a step runs
}

export interface GridLayer {
  roomX: number; roomY: number;                   // 40 x 22 cells of 16 px
  cells: Uint16Array; faces: Uint8Array;
}

export interface PairRule {
  a: number; b: number;                           // category masks
  mode: 'collide' | 'overlap';
  process?(a: Body, b: Body): boolean;            // e.g. one-way
  onContact?(a: Body, b: Body): void;
}

export interface World {
  readonly physicsVersion: number;
  readonly semantics: 'arcade-3.90' | 'wamp';
  gravityX: number; gravityY: number;
  addBody(init: Partial<Body> & Pick<Body, 'id' | 'kind'>): Body;
  removeBody(id: string): void;
  setGrid(layer: GridLayer): void;
  setCell(roomX: number, roomY: number, col: number, row: number, cell: number): void;
  addRule(rule: PairRule): number;
  step(isCatchUp: boolean): void;                 // fixed 1/60 s; hooks run after colliders
  onStep(hook: (world: World) => void): () => void;
  fork(ids?: readonly string[]): World;           // planner prediction on a snapshot
  hash(): number;                                 // per-step state hash for replay diffing
}
```

### Determinism contract and server re-simulation

**The contract.** For a fixed `physicsVersion`, the state at step n+1 is a pure function of the state at step n, the step input and fixed run data:

| Inputs (logged or addressable) | Not inputs (must not affect outcomes) |
|---|---|
| Room or course content at a published version | Render delta, frame rate, refresh rate |
| Spawn or checkpoint start state | Device, browser, CPU speed |
| Step-indexed input log | Room-streaming and network load order |
| Seed for any in-sim randomness | Wall clock, `performance.now` |
| `physicsVersion`, assist settings | DOM state, focus, menus |

Co-op and PvP depend on remote peers and stay outside the contract. Co-op rooms are already excluded from solo boards (`src/placedObjects/coopPressurePlates.ts:3`).

**Step-indexed input log.** Today the ranked trace logs only `moveX`, `moveY` and `jump`, at render-frame milliseconds (`src/runs/verificationTrace.ts:3,9`; `src/scenes/overworld/rankedRunTraceRecorder.ts:105-121`). Schema version 2 logs `(step, held, pressed)` changes for every control in `StepInput`: all directions, jump, sword, gun, down and the touch variants. Each entry is run-length encoded and only written when something changes. A state hash is added every N steps, so a mismatch can be pinned to a step range. Breadcrumbs stay because ghosts use them. Size, ESTIMATED: 5 input changes per second × 60 s × about 4 bytes ≈ 1.2 KB per minute of play before compression. Stage 3 ships this first, in Phaser, and starts collecting a corpus before any physics change.

**`physicsVersion` and leaderboards.** `physicsVersion` is an integer constant in `sim/`. Every trace, ghost and leaderboard row records it. Version 1 means today's build (traces without the field). Stage 3's step-clock move is version 2. The engine swap itself must not need a bump: if it does, it failed parity. When a version changes:

- Any change the golden corpus can detect gets a bump.
- When a bump ships, the top ranked traces of every leaderboard room are re-simulated under the new version first. If the median finish-time shift is 1 frame (16.7 ms) or less, no outcome changes and no tight room becomes unsolvable, records carry over and boards stay unified. Otherwise the release is blocked and no board is migrated (kill criterion 5).
- Only a feel change Jonathan chooses on purpose ships anyway. Then old boards are frozen as their own version, and new runs rank only against runs on the same `physicsVersion`. Jonathan picks the policy (see Open questions).
- The server keeps a frozen sim build for each `physicsVersion` it still has to re-simulate.

**Headless core in tests.** `src/engine/headless.ts` runs in vitest with no mocks. Until the engine exists, the oracle is real headless Arcade. It already runs in node (`movementController.stateOwnership.test.ts:630-651`) and bundles to 18.8 KB br with no DOM (MEASURED). This gradually replaces the 112 of 741 test files that `vi.mock('phaser')` with hand-written fakes. Those fakes check Phaser's API shape, not behaviour (see Verification and parity).

**Server re-simulation.** The direction is plausibility checks today and exact re-simulation later. It comes in two steps (see Delivery plan, Stage 3):

- **Offline first (Stage 3a).** A replayer runs the real build in headless Chromium, frozen loop, over exported v2 traces and the room at its recorded version. It reports whether the replay agrees with the client's outcome. No Worker is needed, because the step-time game logic still lives in Phaser scenes (25 of 37 `liveObjects/` files import Phaser).
- **On the server (Stage 3b).** A Cloudflare Queue consumer Worker takes finished ranked runs, runs the matching sim build over the input log, and writes a verdict into the existing run audit rows (`src/cloudflare/worker/runs/routes.ts:446-453`). This needs the step-time logic extracted into a DOM-free core first. A queue re-simulates selected ranked clears; which runs are selected is an operational setting, not documented here. The request path is not suitable: re-simulation is ESTIMATED at 0.05-0.2 ms CPU per step, so a 60 s run (3,600 steps) costs about 0.2-0.7 s of Worker CPU.

Rollout has three stages:

1. **Shadow.** Verdicts are logged only. Nothing about boards changes. The goal is to measure how often clients agree with the server, especially iOS JavaScriptCore against V8.
2. **Flag.** A mismatch marks the record for review.
3. **Enforce,** after shadow agreement is proven on real traffic.

Today's plausibility checks (`src/cloudflare/worker/runs/verification.ts`) stay as the first line for every run throughout. This document gives no tolerances or limits for either kind of check.

### Rendering

The renderer is a small WebGL2 sprite batcher plus three purpose-built shaders: tilemap, repeat background and lighting. It will not cut frame time much. A play frame is already 7.3 draw calls and about 1,150 quads (MEASURED, headless SwiftShader), and Phaser's JS is 1.3 of 9.6 ms per frame at 1x (MEASURED). The renderer's real jobs are to remove the CPU bakes, the hidden texture copies and the per-room uploads, and to match today's pixels exactly.

**Backends.**

| Lane | Decision | Why |
|---|---|---|
| WebGL2 | Baseline for the WAMP engine | 98.1% reach; Android 98.8%, iOS 97.9% (CITED, web3dsurvey). Gives integer textures, texelFetch and NPOT REPEAT. |
| WebGL1 | No separate lane | WebGL reach is 98.25% and WebGL2 is 98.1% (CITED). The gap is about 0.15 points (98.25 − 98.1). |
| WebGPU | Not planned | 75% Android and 86% iOS reach (CITED). Published 2D results are neutral or negative. |
| Canvas2D | Keep a narrow compat lane. Decide whether to retire it from data. | See below. |

Today players reach the Canvas lane in two ways: through `?renderer=canvas` (`src/main/query.ts:23-31`) or through Phaser.AUTO's fallback when WebGL fails. Lighting already turns off there (`'canvas-disabled'`, `src/lighting/controller.ts:46,166`). The cadence smoke also runs on it (`scripts/smoke_physics_cadence.mjs:12-15`). Nobody knows how many players use it, because the chosen renderer is not reported. The decision:

1. Stage 1 adds the chosen renderer type to boot telemetry, next to the `losewebgl` counters.
2. While Phaser is in the build, Phaser's Canvas renderer stays the fallback, and every owned WebGL path keeps today's CPU bake for Canvas.
3. After that, the engine ships a Canvas2D compat lane. It draws baked rooms from the existing painter (`src/visuals/roomSnapshotTexture.ts`), sprites and bitmap text with drawImage, and no lighting, as today. It runs the room-render equivalence tests and the smokes as a separate CI lane.
4. Proposed default, which Jonathan decides: if under 0.5% of sessions use Canvas for 4 weeks, retire the lane when Phaser is removed and show a "graphics not supported" card instead.

One constraint applies during the transition. Phaser 3.90 creates a WebGL1 context unless it is handed one (`node_modules/phaser/src/renderer/webgl/WebGLRenderer.js:764-770`). So owned paths that run inside Phaser use GLSL ES 1.00 and byte textures. Giving Phaser a WebGL2 context is a separate experiment behind a flag.

**Sprite batching.** One dynamic vertex buffer, one static index buffer and one program per material. The vertex format carries position, UV, packed tint and alpha, and a tint mode. The tint modes are multiply and fill (Phaser's `setTintFill`, used by the PvP flashes). Flips (`setFlip`, 43 calls in 14 files, MEASURED) are done by swapping UVs, and rotation (14 refs in 8 files, MEASURED) by rotating the quad's corners. The batch flushes when the page, the blend mode (NORMAL, ADD for glow, ERASE for the room-video hole) or the render target changes. Static content goes into retained buffers: room-layer quads, the editor grid and cached overlays. In the floor bench this cut tilemap vertex upload from 139.5 KB to 15.9 KB per frame (MEASURED, synthetic).

**Graphics.** Graphics today has 98 type refs and 301 draw calls in 44 files (MEASURED). It becomes a batched rect, line and triangle API that draws through the same batch with a white texel. It can be cached by revision, which is the fix shape for F309. The biggest single user is the music pattern editor overlay: 5 Graphics layers (backdrop, grid, cells, playhead, mix controls) plus stroked Text labels (`src/scenes/editor/musicPatternEditor.ts:171-195`). It already redraws a layer only when its key changes (`:724-736`), and that pattern carries over unchanged. No smoke covers the overlay today, so Stage 7 adds one.

| Per frame | Today (MEASURED, headless) | Owned budget (proposed) |
|---|---|---|
| Draw calls, play | 7.3 | ≤ 12 (floor engine made 4-12, MEASURED) |
| Draw calls, zoomed-out map | 16 | ≤ 16 |
| Vertex upload, play | 194 KB | ≤ 194 KB |
| Texture uploads, play | bursty: 82 uploads, 121 MB per 20 s at 1x | room streaming only; brick and crumble are sub-uploads |

**Single-texture atlas pages, not multi-texture.** WAMP never sets maxTextures, so Phaser binds up to the device maximum (`WebGLRenderer.js:837`) and picks the texture per vertex inside the fragment shader. On SwiftShader that shader doubled frame time: 68.5 ms, against 29.5-32.3 ms with maxTextures=1 (MEASURED, synthetic). The same change raised draw calls from 3 to 38. One texture per draw only pays off if textures are packed, so the engine:

- packs sprites, object sheets, FX and glyphs into a few pages at load, sized from MAX_TEXTURE_SIZE queried at boot, with 1 px extrusion against bleeding;
- draws one page per draw call with a plain shader;
- uses one shared tileset atlas for every room layer;
- groups by page only inside a depth band, never across depths.

The reasons are a smaller shader, no per-pixel branch and predictable cost on weak GPUs. The 2x figure is SwiftShader-only evidence. The Stage 1 maxTextures experiment on a real mid-range Android and an iPhone decides whether the gain is real. If it is not, the batcher can allow 2-4 texture units without changing anything else.

**GPU tilemap.** Today each full room is painted on the CPU into 640x352 canvases, with up to 880 drawImage calls per layer and a 0.9 MB upload per layer (`roomTexturePreparation.ts:64-133`; `roomSnapshotTexture.ts:440-497`). The Phaser TilemapLayer is invisible and exists only for Arcade (`fullRoomPresenter.ts:185-252`). The engine replaces the bake:

- **Index textures.** One 40x22 index texture per room layer (background, terrain, foreground), uint16 per cell: tile id plus flip bits. Three layers take 5,280 bytes (40×22×3×2). WebGL2 uses R16UI and texelFetch. Inside Phaser it is two bytes per cell decoded in the shader.
- **Lookup tables.** One shared tileset atlas plus a small lookup texture from tile id to page UV. Both are built once at boot from the tileset configs (about 26, with firstGid offsets) and the 256x128 custom-tile atlas (`src/customTiles/runtime.ts`).
- **Drawing.** One quad per layer. The shader finds the cell, fetches its index and samples the atlas with nearest filtering. It works out in-tile coordinates on integer texels, so no seams appear at fractional zoom. The foreground stays its own quad at depth 27.25.
- **Mutable tiles.** Brick break and crumble fall or restore (`specialTiles.ts:213-220,444,784`) become a 1-texel texSubImage2D. Today each event re-bakes the whole room inside the gameplay frame: 58.7 ms, against 0.36 ms for patching one cell (MEASURED, headless software raster).
- **Collision.** Untouched. The hidden Arcade layer stays until the physics slice (see Simulation and physics).

Gains:

- Upload per room drops from 1.6 to 0.2 ms (MEASURED, headless micro-bench).
- About 33 of about 50 preparation jobs go away. The phone room-ready floor drops from about 36 to about 18 frames (ESTIMATED from F312's job list).
- Room-layer memory drops from about 1.8-3.6 MB to about 5 KB plus shared atlases (ESTIMATED).

The bake also does blocked-art masking, construction overlays and custom-tile drawing. Each of these gets a shader path or an overlay quad. Rooms are diffed against roomSnapshotTexture output and against the L4 world-tile leaves at zoom 1, 2 and 3, with tolerance 0 (diffRasters and pixelHash in `roomRenderers.testHarness.ts`). The editor's visible layers (3 per cell, up to 16 cells; `CourseEditorScene.ts:1735-1760`) use the same shader. That removes an ESTIMATED 2-6 ms/frame of per-tile batching at Fit zoom on phones (not measured).

**Repeat-pattern backgrounds.** TileSprite (`src/visuals/starfield.ts:69`; `src/backgrounds/runtime.ts:140,173`) is replaced by one refcounted REPEAT texture per source image. Each layer is a quad with a UV-offset uniform, using today's tilePosition and tileScale maths (`fullRoomPresenter.ts:676-720`). Background images stay standalone textures, because hardware REPEAT needs a whole texture. NEAREST filtering lives on the texture, so the setFilter calls that do nothing today (F353) go away. Today each sprite costs 2.86 MB GPU plus 0.86 MB heap (MEASURED) and a Forest room 48-55 MB (CITED F353). After the change, each room after the first costs about 0 (ESTIMATED). F357's shared downscaled copy (done, PR #297) becomes part of the same registry entry. Gate: a screenshot strip over scroll offsets for every group in `config/backgrounds.ts`, plus a tiled custom photo.

**Backdrop pass.** Play draws the starfield through a second, unzoomed camera behind the main one. `src/scenes/overworld/backdropController.ts:184-215` adds the camera, moves it to the front of `cameras.cameras` and patches `cameras.getVisibleChildren` so it draws only the backdrop layer. The main camera then ignores that layer (`:111-116`). The engine makes this a screen-space layer drawn before the world camera, with no per-object ignore lists. Gate: a backdrop strip golden at several zooms.

**Chunk previews and world-map tiles.**

- **World tiles** keep today's data path: the server's 642x354 PNG pyramid, ImageBitmap decode and the 96/40 MB budget (`worldTiles/scheduler.ts:95-112`). Each tile is a quad. The 75 ms crossfade and the 4-child swap become engine alpha tweens with the same timing (`worldTiles/phaserLayer.ts:180-203`). Repair logic that reads `tweens.isTweening` gets an explicit fading flag instead.
- **Chunk previews** stop keying a whole 8x8-room canvas on which rooms are loaded (`chunkPreviewRenderer.ts:443-444,832-836`). Today that re-bake costs up to 2.8 s in the headless worst case (MEASURED) and up to 3.6 MB per chunk texture. Neighbour rooms become per-room quads instead, drawn from the room's L4 leaf when it is cached, or from its index texture at preview scale. A loaded room's quad is hidden, not re-baked. Shrinking 16 px tiles to preview scale is a parity risk, so previews are diffed against today's 4 and 2 px/tile bakes.

**Room video.** A room video is a DOM iframe behind the game canvas, which is created transparent (`transparent: true`, `src/main.ts:100`). An ERASE-blended Graphics object cuts the hole (`src/roomVideo/frameController.ts:240-247`), and a loop makes every non-main camera ignore it (`:228-234`). On every POST_RENDER while a video plays (`:105`), WAMP draws the game canvas into a 2D canvas and reads its pixels back (`:399-450`). When the mask changes it calls `toDataURL` and sets it as a CSS mask on the iframe (`:467-503`). `src/roomVideo/sceneHooks.ts:54-70` also patches the editor scenes' `update` on the prototype. An owned renderer must keep:

- an alpha, premultiplied context, so the iframe shows through;
- a `postRender` hook that runs while the drawing buffer is still readable;
- the ERASE blend mode.

The readback is a per-frame GPU-to-CPU copy whose cost nobody has measured; Stage 2 measures it on the phone. A possible later replacement computes the mask from tile data instead of reading pixels. The lifecycle rule is that a hidden or covered video pauses, which is also open item F461. Gate: a room-video golden (hole and mask) in the live-frame corpus.

**Weather and FX.**

- **Weather** redraws one Graphics object for rain and snow and keeps fog in a Container (`src/weather/controller.ts:182-184`). Fog lobes use a CanvasTexture (`:235`). Weather particles become batched quads from a fixed pool, or the batched rect API, with no per-frame Graphics replay. The fog lobe becomes a refcounted registry texture.
- **FX** spawns Sprites, "+10" Text popups and three kinds of tween (`src/fx/controller.ts:237-306`). FX sprites and tweens run on the step clock or in the present phase, as their behaviour requires. Popups use glyph quads (see Text). Battery Saver today only thins weather and skips popups (the popup check is at `src/fx/controller.ts:261`); F360 (animated backgrounds) is handled in Stage 1.
- **Camera shake, flash and fade** (7 call sites, MEASURED grep) keep Phaser 3.90's timing curves.

Gate: a weather and fog golden at a fixed seed and step, plus a popup layout snapshot.

**Players, ghosts and presence.** These were not profiled (see the viability report), so they need explicit goldens:

- Remote ghosts are a Sprite plus a stroked Text label plus 3 Rectangles (`src/scenes/overworld/presence.ts:1147-1183`).
- Remote multiplayer players are a Sprite plus an invulnerability Graphics (`src/scenes/overworld/multiplayerRemotePlayerRenderer.ts:301-311`).
- The ghost race is a tinted, translucent Sprite (`src/scenes/overworld/ghostRace.ts:69`).
- PvP flashes use `setTintFill` (`src/scenes/overworld/pvpInvulnerabilityFx.ts:57-58`; `pvpLocalPresentationController.ts:89`).
- Room presence badges use a Container of a Rectangle and Arcs (`src/scenes/overworld/presenceOverlays.ts:242-254`).

Gate: goldens for a remote ghost with its label, the PvP invulnerability pulse frames and a presence badge, plus `npm run smoke:room-emotes` and `npm run stress:presence` (`scripts/presence_load_test.mjs`) in the Stage 5 gate.

**Text.** A play frame has 63 Text objects (MEASURED). Each Phaser Text owns a canvas and a GL texture. Every coin popup creates one and then deletes it (F310). NPC labels quantize their pixels and re-upload through a private renderer call (`npcNameLabel.ts:104-119`). The engine instead uses a glyph atlas for the pixel font ('Early GameBoy', for example `src/social/roomRushShare.ts:129`), generated at build time and drawn as glyph quads in the normal batch. Layout (advance, line height, alignment, wrap) lives in the engine core.

Styles in use go beyond plain glyphs. Labels use stroke (19 uses in 11 files, MEASURED; for example `presence.ts:927`, `src/scenes/editor/documentPresentationController.ts:184-185`, `musicPatternEditor.ts:187-188`), drop shadows (`src/scenes/overworld/roomComments.ts:1169,1178`) and wordWrap (5 uses in 3 files). The atlas bakes a stroke and shadow variant per style, or the engine draws an outline pass. Player names, chat, room titles and room comments can contain glyphs outside the atlas. Those strings fall back to one cached, refcounted canvas texture per string. Gate: pixel goldens per label style, not only layout snapshots, because a missing outline would pass a layout check. Interim on Phaser: BitmapText with the same font (F310's fix plan).

**Lighting.** In dark rooms, two room-size RenderTextures are redrawn every frame (`src/lighting/controller.ts:199-270,320-344`). Each new rounded light diameter creates a new CanvasTexture that is never freed (`:471-506`). The engine replaces this with one pass over the room quad. A fragment shader with a fixed-size uniform light array computes darkness and additive glow together. The falloff comes from a 1D lookup texture baked from today's light gradient, so the shape matches by construction. Gains (ESTIMATED, low confidence): under 0.5 ms GPU per frame on phones, 2-4 fewer framebuffer switches, and no pile-up of light textures. The editor preview uses the same shader. The Canvas lane keeps lighting off.

**Camera and transforms.** The camera is a plain struct: scroll (the unzoomed origin), zoom around the viewport centre, viewport, bounds, follow with deadzone, shake and flash. It ports Phaser 3.90's camera matrix maths exactly, including `roundPixels: true` (`src/main.ts:97`). getWorldPoint (29 call sites, 27 of them in the editor; MEASURED) and its inverse become pure functions in the core, and the matrix becomes public. Today `CourseEditorScene.ts:1621-1624` reads the private `camera.matrix`. worldView is computed when read, which removes the "stale after setZoom" case (`worldStreaming.ts:3316`). The play backdrop is a screen-space layer, not a second camera (see Backdrop pass).

Gates:

- a property test over random zoom, scroll, viewport and screen points against Phaser's Camera.getWorldPoint run in Playwright, exact to the float;
- replays of recorded pinch sequences that compare the final zoom and scroll.

Half a pixel of error here changes which tile a tap hits. The canvas stays sized in CSS pixels (`src/main.ts:88-117`), which keeps fill 4-9x lower on phones (ESTIMATED from DPR²).

**Draw order.** The engine keeps today's numeric depths and Phaser's tie-break: a stable sort by (depth, insertion sequence), redone only when something is added or changes depth.

| Context | Depths today |
|---|---|
| Play and browse | chunk previews 0, background 8, room layer 10, ghost 24, break animation 26, foreground 27.25, remote players 29, lighting overlayDepth+1/+2, world-tile images and stale masks |
| Editor | background 1, terrain 10, foreground 50, overlays 90-103, music pattern overlay 108-112 |

There are 125 setDepth calls in 49 files (MEASURED). Equal-depth ties follow creation order, and streaming timing changes creation order, so parity keeps the sequence rule exactly. New code uses a named layer enum that maps onto these numbers. Gate: a (depth, type, key) display-list snapshot of scripted scenes, diffed against main.

### Textures, assets and memory

In play, most texture memory is WAMP's own art and canvases: 93-123 MB of source pixels (MEASURED). The engine has three jobs here:

- stop hidden copies;
- count every byte;
- free CPU copies after upload. This is the one memory win only an owned renderer delivers cleanly.

**Registry.** Every texture goes through one WAMP registry. It wraps Phaser's TextureManager first and replaces it later.

| Field | Purpose |
|---|---|
| key, owner tag (room, chunk, world tile, avatar, background, UI, FX) | per-category budgets, debug view |
| refcount, pinned, lastUsedFrame | free at 0 refs after an LRU grace; boot art pinned |
| gpuBytes | w×h×4 per page, plus render targets with their depth-stencil buffers |
| cpuBytes | the retained source: canvas backing store, ImageBitmap or ImageData |
| kind: static or dynamic | dynamic means a redrawn canvas (custom tile atlas, custom sprites, animated backgrounds), which keeps its source |
| rebuild recipe | how to recreate the texture after context loss |

Today's budgets count guesses. The room-artifact budget counts 1.8 MB per room against about 3.6 MB real (CITED F307; budgets 24/8 MB at `worldStreaming.ts:132-133`). `resourceDebug.ts` reports only the JS heap (`:88-90`). The registry's totals replace those estimates and appear in the debug API.

**Freeing CPU copies after upload.** Phaser keeps every source alive so it can restore textures in place (`TextureSource.js:51`; `WebGLTextureWrapper.js:211-238`). The engine uploads a static texture and then drops its source: it closes ImageBitmaps and returns canvases to the pool at 1x1. On restore it rebuilds from the recipe:

| Family | Rebuild recipe |
|---|---|
| Boot art, tilesets, avatars | re-fetch by URL (HTTP cache) and decode |
| World tiles | re-fetch, as today (`worldTiles/controller.ts:261-274`) |
| Room index textures | re-upload from room data (the 5 KB grid stays in memory) |
| Baked canvases (Canvas lane) | re-run the painter from room data |
| Dynamic canvases | re-upload the retained source (small, for example the 256x128 tile atlas) |
| Glyph atlas, lookup tables | regenerate |

Restore order: the current room and the HUD first, then what is visible, then everything else on first use. The saving is ESTIMATED, low confidence and browser-dependent:

- up to 40 MB (reduced profile) or 96 MB (normal) of world-tile ImageBitmaps;
- about 0.9 MB per room layer;
- up to about 128 MB of chunk-preview canvases at the 32M px ceiling (`chunkPreviewRenderer.ts:129`).

A partial version ships on Phaser first, in Stage 1: close world-tile bitmaps after addImage, and textures.remove() those keys on `losewebgl` (about 30 LOC). A debug mode poisons released sources, to catch code that still reads getSourceImage() on a freed texture. roomSnapshotTexture and the chunk previews do that today.

**Context loss and telemetry.** Today `losewebgl` and `restorewebgl` are only logged to the console (`src/main/webglRecovery.ts:1-2,205-213`). Browse reloads the page, and play and the editor show a "Graphics paused" card. Nobody knows how often context loss happens. Stage 1 sends counters through the client error reporter: loss count, restore outcome (restored, reloaded or gave up), time to restore, renderer type, performance profile and registry totals at the moment of loss. No user content is sent. Four weeks of this data is a gate before sources are freed (see Delivery plan). The engine's restore path must also pass an injected WEBGL_lose_context screenshot-diff test in play, browse and the editor (see Kill criteria).

**ImageBitmap.** The loader decodes with fetch plus createImageBitmap, off the main thread where the browser allows. The premultiplied-alpha, colour-space and flipY settings must match Phaser's upload exactly. The frame and pixel checks below catch any drift, and the device matrix covers iOS Safari. Whether browsers keep ImageBitmaps in CPU memory varies, which is why the saving above is low confidence.

**Loader.** It replaces Phaser's Loader. Today that loader is used in 4 files (7 spritesheet, 4 image and 1 atlas call; MEASURED) and loads about 176 boot files (CITED F316).

- **It keeps:** the `?v=` URL rewriting (`src/assets/sceneAssetVersions.ts:7-21`), JSON-hash atlases with trimmed frames, spritesheet slicing, progress and error events for the boot splash and stall watch, and 32 parallel downloads.
- **It adds priorities:** critical (the player, the current room's tilesets, the HUD font), near (neighbour rooms, UI art) and idle (FX, other avatars, editor art).
- **It serves runtime loads.** Remote avatar atlases load mid-play through `scene.load.atlas` with COMPLETE and FILE_LOAD_ERROR listeners, then register game-wide animations with `anims.create` (`src/player/avatar/dynamic.ts:183-230`). The engine loader serves these on demand at idle priority. The registry evicts unused avatar pages and their animations, as F317 asks.
- **Gates:** every frame rect from both loaders must be equal; an avatar-swap golden; and a texture-count check after 5 distinct avatars enter and leave.

Priorities help time to interaction. They do not shrink the 1.4-2.4 s (1x) or 6.0 s (4x) asset preload (MEASURED); only asset fixes do.

**Budgets per device profile.** Budgets hang off the existing profiles. Touch devices are 'reduced' in Auto (CITED F356).

| Category | Today, normal / reduced | Engine |
|---|---|---|
| World tiles | 96 / 40 MB GPU (`scheduler.ts:95-112`) | keep, now measured by the registry |
| Room artifacts | 24 / 8 MB, about 2x under-counted (CITED F307) | real bytes; mostly gone with index textures |
| Chunk previews | 32M px cache | per-room quads; budget set from traces |
| Backgrounds, avatars, render targets, total GPU, total CPU | none | set from real-device traces in Stage 2 |

When a category goes over budget, the registry evicts in LRU order before the browser can drop the context.

**What stays an asset problem.** These belong to Stage 1, and no engine fixes them:

- **F317:** the player atlas is 1344x4032, 98% empty and 21.7 MB of source pixels (MEASURED). Each remote avatar adds about 21 MB and is never evicted (CITED). Repacking only the used frames cuts 85-90% (CITED).
- The unused WeaponsSheet is still loaded (`src/player/defaultPlayer.ts:23-44`).
- **F322:** sound effects are downloaded even with effects off.
- **F303:** custom tiles are painted into their atlas one pixel at a time.

### Input, resize and lifecycle

This is robustness work, not speed. Phaser's input costs under 0.05 ms per frame today (ESTIMATED).

**Pointer.** One Pointer Events source scoped to the canvas replaces Phaser's window-level mouse and touch listeners (`TouchManager.js:337-348`; `MouseManager.js:485-495`):

- pointerdown calls setPointerCapture. A captured pointerup or pointercancel replaces `pointerupoutside`.
- pointermove exposes getCoalescedEvents() for editor strokes.
- The canvas gets `touch-action: none` and a canvas wheel listener with preventDefault.
- A WAMP Pointer type carries only the fields code reads today (MEASURED grep): x, y, worldX, worldY, id, left/right/middle buttons, wasTouch (from pointerType), isDown, downTime and event. It supports up to 5 pointers (`BootScene.ts:218`).
- Pinch, pan, tap-versus-drag and Move-tool arbitration stay WAMP code behind EditorTouchHost (`src/scenes/editor/editorTouch.ts:15-31`).

The about 8 DOM workarounds go one at a time, each only after a test shows it is no longer needed: `gamePointerBoundary.ts`, `portraitPlayControls.ts:55-61`, `mobile/controller.ts:214-227` and `keyboardPassthrough.ts:17`. Interim on Phaser: `input.windowEvents: false` (`core/Config.js:290`) plus a replacement for pointerupoutside.

Gates (see Verification and parity):

- the 244 F274 scenarios;
- the F054/F059 release tests;
- `npm run smoke:editor-touch`;
- Jonathan on a real iPhone and a real Android phone.

**Keyboard and gamepad stay WAMP-owned.** Gameplay keys already use a capture-phase listener with remappable bindings (`keyboardInput.ts:19-48`). The gamepad already reads navigator.getGamepads (`gamepadInput.ts:13-91`). The editor and map shortcuts on Phaser's keyboard (SPACE, ESC, ZERO, P, ALT) move into the same module, and syncGameKeyboardFocus (`src/ui/keyboardFocus.ts:102-127`) drops its Phaser plumbing. Gates: the F177 remap scenarios and the F380 dialog-focus scenarios, Safari included. When input is sampled and when it is consumed is part of the time model (see Time model and loop).

**One resize path.** Today two systems run. Phaser's ScaleManager polls every 500 ms (`ScaleManager.js:362`). WAMP runs its own ResizeObserver, MutationObserver and window listener (`main.ts:245-281`), plus visualViewport handling (`src/ui/deviceLayout.ts:186-188`). The engine has one viewport store, fed by a ResizeObserver on the container and by visualViewport resize and scroll events. It sets the drawing buffer in CSS pixels, keeps the 1x1 minimum for hidden embeds (`main.ts:91-94`) and sends one typed resize event to scenes (5 listen today). Per-frame reads go through the store. The window.innerWidth/innerHeight read at `OverworldPlayScene.ts:3183-3186` costs 527 ms per 20 s at 1x (MEASURED); its fix ships in Stage 1. Interim on Phaser: Scale.NONE with WAMP's resize.

**Lifecycle state machine.** Phaser's scene states don't match what WAMP needs. A PAUSED scene still renders (`SceneManager.js:592-595`), and 75+ subscriptions depend on Phaser's event order. The engine has one explicit app state machine:

| State | Updates | Renders |
|---|---|---|
| booting | loader | coarse cover, then the first verified frame (`earlyWorldTileBootstrapHandoff.ts`) |
| browse | map, streaming | on change; capped when idle |
| play | sim, streaming, HUD | every frame; never throttled in live multiplayer or Weekly Rush (F356) |
| paused / modal | nothing | on change only; about 92% fewer frames behind menus (CITED F356) |
| edit, course-edit | editor or composer | on change |
| test-play | play sim with built play data; editor asleep | every frame; returns to edit (`EditorScene.ts:609-617`) |
| hidden | nothing | nothing (loop paused, audio suspended, room video paused, as F461 asks) |
| context-lost | nothing | placeholder, then restore |

Transitions are functions with typed payloads. They run synchronously at a frame boundary and write an ordered event log. Today queued scene starts (`OverworldPlayScene.ts:4779`) and shutdown races (`CourseEditorScene.ts:3122`) are handled implicitly. The state machine is built on Phaser first, driving sleep and wake underneath. Gate: a lifecycle-log diff in Playwright across switches between play, edit, course and composer. Render-on-change lands earlier, in FrameCadenceGate (`src/main/frameCadence.ts:71-93`), as part of Stage 1.

**DOM UI bridge.** It stays. The UI already calls typed capabilities through game.scene.getScene (`src/ui/setup/sceneCapabilityRegistry.ts:14-176`). Two changes, both on Phaser first:

- The 52 `Phaser.Game` refs in `src/ui` become an EngineHost interface: getScene, isActive, events and canvas.
- The window CustomEvents (39 files) get one typed event map with typed dispatch and listen helpers. The events underneath stay the same.

### Debug and test surface

A port needs oracles, and they don't exist yet. This surface is Stage 3 work, and it pays off even if no port happens.

**Engine-neutral debug API.** It builds on the hooks the smokes already use: `render_game_to_text` (`src/main.ts:399`, 41 files), `run_preview_smoke_action` (`src/main/previewSmoke.ts:91`, 21 files) and `get_wamp_graphics_debug` (`src/main.ts:397`). The new calls install only in test builds, behind the same flag as previewSmoke (`VITE_ENABLE_TEST_RESET`). The proposed module is `src/engine/debug/api.ts`.

| Call | Replaces |
|---|---|
| freeze(), step(n), advanceTime(ms) | game.loop.sleep, game.step. Today `advanceTime` (`main.ts:456-458`) only waits wall-clock time; the new one runs whole steps |
| physicsTrace(): per-step x, y, vx, vy, blocked and touching for the player and named bodies | world._elapsed, body.prev (`smoke_physics_cadence.mjs:41-110`) |
| camera(): scroll, zoom, worldPoint(screen) | cameras.main |
| displayList(): ordered (depth, type, key, visible) | scene.children |
| textures(): registry totals by category | game.textures.list scans |
| lifecycleLog(), frameStats() (draws, quads, uploads) | ad-hoc listeners; the GL wrappers in `scripts/engine-port/runtime-profile/` |
| editor(): tile document, selection, tool | getScene('EditorScene') |

The schema is versioned. Two groups of scripts move onto this API while the game is still on Phaser:

- the 11 scripts with 93 refs that reach into Phaser internals;
- the 17 script files that use `window.__EVERYBODYS_PLATFORMER_GAME__`. That global is installed only in dev builds (`main.ts:223-224`), so those scripts cannot run against preview-smoke builds today (MEASURED grep).

After that, the same scripts run against both engines. A CI check (proposed `scripts/check_engine_internals.mjs`) then blocks new reaches into engine objects from `scripts/`.

**Headless golden images.** The equivalence suite checks the painters (61 tests in 9 s, MEASURED) but never the live frame. Stage 3 adds live-frame goldens (proposed `scripts/smoke_live_frame_goldens.mjs`, npm `smoke:live-frame-goldens`).

- **Two lanes.** `--lane canvas` uses Phaser's canvas renderer and runs on every PR. `--lane webgl` uses SwiftShader WebGL on a pinned Playwright Chromium. The WebGL lane is the one that judges owned WebGL paths, because the canvas lane never runs them; it is required on every PR that touches a flagged render path and runs nightly otherwise.
- **Setup:** `preserveDrawingBuffer` (`src/main.ts:98`, set from the `?preserveDrawingBuffer=` query at `:73`), a frozen loop, objects at frame 0, and a fixed viewport and seed.
- **Corpus:**
  - the 6 reference rooms, the feature room and the physics fixtures;
  - editor states (tilesets, flips, objects, lighting presets, weather, the music pattern overlay) at several zooms;
  - the map LOD thresholds (0.092-0.864);
  - a parallax strip per background group and a backdrop strip;
  - every label style;
  - weather and fog at a fixed seed, a room video hole and mask, a remote ghost, PvP pulse frames and a presence badge;
  - frames after an injected context loss.
- **Method:** Phaser is captured first, as the oracle. The owned renderer is then diffed per pixel: tolerance 0 for tile layers at integer zooms, and a small per-golden tolerance for text, lighting and fractional map zooms, fixed when the golden is captured. A human reviews any change to a tolerance.
- **Pins:** the renderer version pins (WORLD_TILE_RENDER_CONTRACT and the others) stay, and any pin change must come with a version bump.

About a dozen existing smokes force the canvas renderer: 11 through `?renderer=canvas` (for example `scripts/smoke_first_visit.mjs:51`) and `smoke_physics_cadence.mjs` by default (MEASURED grep). They will not exercise any owned WebGL path. Stage 3 lists them and gives the renderer-sensitive ones a WebGL variant. SwiftShader output is a pixel oracle only, never performance evidence. `scripts/engine-port/README.md` has the steps to reproduce the measurements.

**vitest without `vi.mock('phaser')`.** 112 of 741 test files mock Phaser, because it throws "window is not defined" in node (MEASURED; `vitest.config.ts:5`). The engine is split in two:

- **core:** no DOM and no GL. It holds the maths, camera, display-list ordering, tweens and timers, the state machine, registry bookkeeping, the loader queue, the tile document and render-command recording. It runs for real in node.
- **platform:** WebGL2, Canvas2D, Pointer Events, ResizeObserver and rAF. It is thin and covered by Playwright.

A RecordingRenderer captures draw commands, so tests can assert "terrain quad at depth 10 on page P" against the real core instead of a hand-written fake. Each mocked file drops its mock when its module moves behind the seam, and the count from 112 down to 0 is a tracked metric. Until then, physics tests use headless Arcade, which already runs in vitest (`movementController.stateOwnership.test.ts:630-651`). The editor's 3-method FakeLayer (`editRuntime.characterization.test.ts:1153-1169`) gives way to the real tile document.

### Living with Phaser during the transition

The WAMP engine grows inside the running Phaser game, on one canvas and one GL context. It never ships as a second runtime. The port-only boot gain (about 110-150 KB br, ESTIMATED) arrives only on the day Phaser is deleted. Until then the build carries both.

**Owned render paths ship inside Phaser first.** Phaser 3 already supports this in three ways:

- **Extern game objects.** Phaser flushes and clears its pipeline, calls the object's `render(renderer, camera, matrix)`, then rebinds (`gameobjects/extern/ExternWebGLRenderer.js`; `PipelineManager.js:1321-1405`). The object keeps its depth in the display list. This is the route for the Stage 4 index-texture tilemap and for the lighting pass.
- **Custom pipelines**, only if Extern proves unworkable for a path.
- **Subclasses:** a shared-pattern TileSprite (F353) and BitmapText popups (F310).

Constraints:

- In-Phaser paths use WebGL1 shaders.
- Each Extern costs one flush, which is fine at 3 layers per room.
- Owned code must leave the GL state Phaser caches as it found it. Rebind resets program, blend, viewport and VAO, and a GL-state test covers texture units.
- The Canvas lane keeps the bake, and the hidden Arcade layer stays.

**The seam.** A new `src/engine/` package holds the interfaces game code imports instead of `'phaser'`:

- EngineHost;
- SceneHost and the state machine;
- RenderLayer (image, sprite, text, graphics, tilemap layer and background, each with a depth);
- CameraView;
- TextureRegistry;
- PointerSource;
- Clock and PhysicsWorld (see Time model and loop, and Simulation and physics).

Two adapters implement them: `src/engine/phaser/` now, and `src/engine/wamp/` as it grows. Today about 182-185 non-test files import phaser (about 90k LOC, MEASURED), but only about 8-15k lines actually touch it (ESTIMATED). A restricted-import ESLint rule in `eslint.config` limits `'phaser'` imports to `src/engine/phaser/`, with an allowlist that can only shrink. Codemods go first and remove the cheap uses: Math.Clamp (97 uses), Geom.Rectangle (101), and the tween and timer helpers.

**Feature flags.** There is one flag per slice: tilemap, backgrounds, lighting, text, textures (free after upload), input, lifecycle, and last, renderer (the owned renderer draws the whole frame). Each flag:

- can be set by query parameter for testing and by remote config for rollout;
- defaults to off and has a kill switch;
- is recorded in bug-report context (`src/bugReports/gameContext.ts`) and in boot telemetry.

Rollout runs CI, then Jonathan, then a share of sessions, then everyone (see Rollout and compatibility). Renderer flags never change the simulation. Physics changes go through `physicsVersion` instead (see Determinism contract and server re-simulation).

**No doubled memory.** Test-play wakes OverworldPlayScene on the editor's own canvas (`EditorScene.ts:609-617`). Two canvases would therefore mean duplicate textures and a handoff, so there is only one. The registry owns every texture, and none is ever uploaded twice. Owned shaders sample tilesets that Phaser uploaded, through their GL handles. Phaser draws owned textures through addImage-style wrappers. On the bundle side, the engine adds an ESTIMATED 15-50 KB br until Phaser is removed. A custom Phaser 3 build (ESTIMATED -50-60 KB br) offsets it, and `npm run size:check` guards the total.

**When each Phaser subsystem is retired.**

| Phaser part | Replaced by | When (gate) |
|---|---|---|
| preFX/postFX pipelines | two config flags | Stage 1 |
| TileSprite; Text | subclass and BitmapText, then owned quads and glyphs | Stage 1; Stage 5 |
| Tilemap rendering (CPU bake) | Extern index-texture tilemap | Stage 4 (WebGL-lane goldens at tolerance 0 for tiles) |
| TextureManager | registry over it, then owned | Stage 3; Stage 5 plus the context-loss gate |
| Loader, including runtime avatar loads | engine loader | Stage 5 (frame-rect equality, avatar-swap golden) |
| AnimationManager (`anims.create`, 12 calls) | `anim/` module | Stage 5 |
| Math, Geom, Tweens, Time, EventEmitter | WAMP helpers | any time, by codemod |
| ScaleManager | Scale.NONE plus the viewport store | Stage 1 |
| Input and Keyboard plugins | windowEvents:false, then Pointer Events | Stage 1; Stage 7 (F274 scenarios on real devices) |
| Scene manager | state machine over scenes, then owned | Stage 3; Stage 7 |
| Display list, Sprite, Image, Graphics, Container, Camera, WebGL and Canvas renderers | owned renderer | end of Stage 5 (live-frame goldens, device matrix) |
| Backdrop camera and its `getVisibleChildren` patch | screen-space backdrop layer | Stage 5 (backdrop strip golden) |
| Weather and fog Graphics, fog CanvasTexture | batched quads plus a registry texture | Stage 5 (weather golden) |
| FX sprites, Text popups and tweens | owned quads, glyphs and step tweens | Stage 5 (popup snapshot) |
| Room video hole, readback and scene `update` patch | owned post-render hook | Stage 5 (room-video golden); the editor hook in Stage 7 |
| Presence, PvP and ghost renderers | owned sprites, glyphs and rects | Stage 5 (ghost, PvP and badge goldens) |
| TimeStep and game loop | owned loop | Stage 5, built on the Stage 3 step clock |
| Arcade and the hidden TilemapLayer | owned solver | Stage 6 (see Kill criteria) |
| phaser-vendor chunk | nothing | Stage 7, when no file outside `src/engine/phaser/` imports phaser |

If the decision gate fails, the paths already shipped inside Phaser keep their flags on and everything else stays on Phaser. The seam remains as cheap insurance.

## Delivery plan

The plan follows path E: fix first, build the oracles, decide later. Stages 1-4 pay off whether or not WAMP ever leaves Phaser. Stages 5-7 are path C, the strangler port, and they start only if the decision gate passes on real devices. Each stage ships behind its own gate. A stage that misses its gate stops the plan there. It does not get waived.

| Stage | Goal | Fleet time | Jonathan's hours | Calendar floor | Exit gate (short) | Needs a port? |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Quick wins | Remove the large Phaser-default and WAMP costs | About 1 fleet-day to write, 2-4 to verify | 8-15 | None | Cadence smoke 0.01 px, roomRenderers equivalence, `size:check`, touch scenarios, plus proof the gains landed | No |
| 2. Real-device baselines | Swap SwiftShader numbers for phone numbers | Device time, not fleet time | 4-6 | Device access | Gate table filled in on the Android, before and after Stage 1 | No |
| 3. Phase 0 oracles (3a, 3b) | Build the tests any port needs; make runs replayable | 3a: 1-2 fleet-weeks; 3b: sized by its planning wave | 10-20 | Corpus collection | Time-model replay identical; corpus, fuzzer and goldens running; offline replay agreement reported | No |
| 4. Owned paths inside Phaser | Index-texture tilemap as an Extern object; custom Phaser build | Fits in the rest of path E | 3-4 | None | WebGL-lane goldens 0 diff on tiles; room-ready frames; `size:check` budget lowered | No |
| Decision gate | Open path C or stay on Phaser 3 for good | A study-sized re-run, plus 1-2 fleet-days for the size prototype if boot is the reason | Under 1 | 4 weeks of telemetry since Stage 1 | The three conditions (below) | None |
| 5. Renderer slice | Owned renderer; owned texture lifetimes | 2-4 fleet-weeks | 20-40 | About 4 rollout weeks | Goldens on both lanes, injected context-loss diff, device matrix | Yes |
| 6. Physics slice | Arcade-shaped facade over an owned solver | Unknown; parity loop capped | 40-80 | 2-week loop plus about 4 rollout weeks | Fuzzer bit-identical, corpus ≥99.9% within 0.01 px, blind A/B | Yes |
| 7. Retire Phaser | Editor, input and lifecycle, then delete Phaser | Not estimated | 20-40 | About 4 rollout weeks plus 1 release cycle | 244 F274 scenarios on real iOS and Android; zero `phaser` imports | Yes |

All fleet times, hours and calendar figures are ESTIMATED. A fleet-week is defined in the glossary.

- **Jonathan's hours.** Stages 1-4 add up to path E's 25-45 h: 8-15 + 4-6 + 10-20 + 3-4 = 25-45. Stages 5-7 use path C's split: 20-40 h for the renderer and 60-120 h for physics plus removal, split here as 40-80 and 20-40 (physics carries the blind A/B tests). If every stage runs, Jonathan's total is 25-45 + 80-160 = 105-205 h.
- **Calendar for path E.** At least 4 weeks, because the decision gate needs 4 weeks of context-loss telemetry that starts in Stage 1. At 5-10 h a week of Jonathan's time, 25-45 h takes about 3-9 weeks (25 ÷ 10 = 2.5; 45 ÷ 5 = 9), so about 1-2 months.
- **Calendar for path C after the gate.** At least 14 weeks of fixed floors: 3 slices × about 4 rollout weeks, plus the 2-week physics loop. Stage 7 then waits one release cycle before Phaser is deleted. At 5-10 h a week, 80-160 h takes 8-32 weeks. Realistically that is two or more quarters.
- **The weekly-hours assumption** is a guess. Jonathan should confirm it (see Open questions).

### Stages and gates

All proposed scripts, tests and receipts named below are marked "proposed": they do not exist at 24e3626.

#### Stage 1: Quick wins on Phaser 3

**Goal.** Ship the fixes from path A that take the large costs out of today's build: phone memory, battery, room hitches and FX boot time.

**Scope.** Each item is its own small PR, about 15-25 PRs and 2-4k LOC in all (ESTIMATED).

- **FX off.** Set `disablePreFX: true` and `disablePostFX: true` in the game config at `src/main.ts:88-122`. Neither flag is there today.
- **F353:** a TileSprite subclass that shares one refcounted fill pattern per texture key, in place of a private canvas plus a POT fill canvas for each sprite.
- **Brick and crumble:** patch the one changed cell and call `source.update()`, in place of re-baking the whole room (`src/scenes/overworld/specialTiles.ts:883-918`).
- **Chunk previews:** bake one frame per room, and hide the frames of loaded rooms, in place of re-baking on every full-room load or unload (`src/scenes/overworld/chunkPreviewRenderer.ts`).
- **WAMP per-frame hot spots:**
  - the `window.innerWidth/innerHeight` read in the size cache key (`src/scenes/OverworldPlayScene.ts:3184`);
  - `querySelectorAll` on every keyboard update (`src/ui/modalState.ts:49`, called from `src/scenes/overworld/keyboardInput.ts:58`);
  - the per-frame `createImageBitmap` replay capture (`src/analytics/replay/canvasCapture.ts`, called from `src/bugReports/recentReplay.ts:28`);
  - DOM-HUD style recalc.
- **F356:** add paused, modal and idle inputs to `FrameCadenceGate` (`src/main/frameCadence.ts:71-93`), or use `scene.sleep` in place of pause. Never throttle during live multiplayer or Weekly Rush. Make Battery Saver actually lower the rate (`src/performance/performancePolicy.ts:44-53`).
- **F360:** Battery Saver pauses or simplifies animated backgrounds, next to F356.
- **F312:** an EWMA of measured cost in `src/scenes/overworld/frameWorkCoordinator.ts`, in place of fixed cost guesses.
- **F317:** repack the player atlas to its used frames, reusing the trimming in `scripts/build_tree_atlases.mjs`, and evict remote avatars that are no longer shown.
- **ImageBitmap close.** Close world-tile ImageBitmaps after `addImage`, and call `textures.remove()` on those keys on `losewebgl`. That is about 30 LOC. World tiles already re-fetch on restore (`src/scenes/overworld/worldTiles/controller.ts:261-274`).
- **Context-loss telemetry.** Send `losewebgl`/`restorewebgl` counts and the chosen renderer type to the server. Today they are only logged to the console. The hooks are at `src/scenes/OverworldPlayScene.ts:1771` and `src/bugReports/runtime.ts:56`. Send them as counters through the client error reporter, so the numbers survive log and trace sampling and can be charted per day. This starts the 4-week clock the decision gate needs.
- **Experiments** behind query flags, off by default: Arcade `useTree: false`, and `render.maxTextures: 1`.

The same lane has optional neighbours that are not required here: F303, F311, F313, F325 for boot JS, and F461 (room video ignores volume and keeps playing when hidden).

**Deliverables.** The merged PRs; a re-baseline run of `scripts/engine-port/runtime-profile/` at 1x and 4x with the same flags as the baseline; the telemetry counters live.

**Entry criteria.** None. Start now. Stage 2's "before" traces should be captured from today's build while this stage is being written.

**Exit gate.** No regressions:

- `npm run smoke:physics-cadence` within 0.01 px at 30-240 Hz on the 9 fixtures. It runs nightly today; also run it on every PR that touches physics, the loop or `useTree`.
- `src/rendering/roomRenderers.equivalence.test.ts` green (61 tests).
- `npm run size:check` under its budget (673 KB today).
- `npm run smoke:editor-touch` (the F274 scenarios), `npm run smoke:pause` and, for F353, `npm run smoke:backgrounds`.
- `npm run perf:webgl:recovery` passes after the ImageBitmap change, and confirms the bitmaps are closed. It is a manual probe today.
- `npm run perf:runtime:mobile` shows no p95 regression against the pre-Stage-1 trace.

And proof that the gains landed, measured with `scripts/engine-port/runtime-profile/` (headless, same flags as the baseline):

- The 4x play run shows no TileSprite construction among the top Phaser-triggered native callers.
- Requested render-target bytes at 390x844 are 18 MB or less, and there are 20 fewer shader programs than the baseline.
- The 20 s play window shows no samples from the `OverworldPlayScene.ts:3184` cache-key read, from `modalState.ts:49` or from the per-frame replay `createImageBitmap`.
- Frames rendered behind a full-screen menu fall by at least 80% (F356; proposed threshold), measured with the harness rAF and draw counters.
- The texture census shows the player sheet's decoded bytes down by at least 80% (F317; proposed threshold).

**Expected gain.**

| Item | Gain | Tag |
| --- | --- | --- |
| FX flags | First frame 144→85 ms (1x), 358→206 ms (4x); 20 fewer shader programs; requested GPU memory 43→18 MB at 390x844 | MEASURED, headless SwiftShader; requested, residency unknown |
| F353 TileSprite | 2.86 MB GPU + 0.86 MB heap per sprite removed; 48-55 MB per Forest room; about 7 ms/frame bursts at 4x gone | MEASURED / CITED F353 |
| Brick patch | 58.7→0.36 ms per break | MEASURED, headless software raster |
| Chunk frames | Removes re-bakes of up to 2.8 s | MEASURED, headless worst case |
| WAMP hot spots | Today 527 + 305 + 248 = 1,080 ms of main thread per 20 s at 1x, about 2.2 ms/frame (1,080 / 496 frames). The fixes are expected to remove most of it | Cost MEASURED; removal ESTIMATED |
| F356 | About 92% fewer frames behind menus; about 50% fewer when idle or in Battery Saver | CITED F356 |
| F317 | 85-90% of the 21.7 MB atlas | CITED F317 |
| `useTree: false` | 35-250 µs per step | MEASURED, if the cadence smoke passes |

**Rollback.** Revert the PR. The FX flags, `useTree` and `maxTextures` are config-only. The F356 gate and the EWMA ship behind settings that fall back to today's behaviour.

**Jonathan's hours.** 8-15: about 8-11 h reviewing small PRs and 4-6 h of play-testing on two phones (ESTIMATED).

#### Stage 2: Real-device baselines

**Goal.** Close the biggest gap in the evidence. Every frame number so far comes from SwiftShader or CDP throttling.

**Scope.**

- **Step 0: prove the phone path.** `measure.mts --cdp` is untested so far (see `scripts/engine-port/README.md`, "Running the profile on a real Android phone"). An agent validates it against the real Android once, checks the `blocked` and replay lines in `play-captured.json` before trusting any number, and fixes what breaks. Optionally, add a `--cdp` option to `scripts/runtime_performance_trace.mjs`, which today only launches headless Chromium (`:1107`).
- **The mid-range Android.** Chrome over adb with the harness: `measure.mts --cdp http://127.0.0.1:9222 --throttle 1` for the boot, play and map scenarios. Then `analyze.mts`, `boot.mts` and `modeval.mts` on each run.
- **GPU on Android.** GPU frame time through Perfetto or Android GPU Inspector. A/B `maxTextures` -1 vs 1, and FX on vs off, for resident (not requested) memory. Measure the room-video mask readback with a video playing.
- **rAF fixtures.** Record rAF timestamp sequences on both phones (steady, jank, 120 Hz, blur and refocus, background, sleep and wake) and commit them as replay fixtures under `scripts/engine-port/fixtures/raf/` (proposed).
- **The iPhone, best effort.** Safari Web Inspector Timelines by hand, which needs a Mac. The harness does not cover iOS, and Safari timelines do not split self time by bundle chunk the way `analyze.mts` does. iOS numbers inform the gate but do not decide it; the gate reads the Android.
- **Both builds.** Capture today's main ("before") and the Stage 1 build ("after"). Use 3 runs per scenario on a cool, plugged-in phone (proposed protocol).

**Deliverables.** A receipt at `docs/review/wamp-engine-stage-2-devices-<date>.md` (proposed) with one table holding what the decision gate reads:

1. Phaser JS plus Phaser-triggered native time, both as a share of main-thread play-frame time and in absolute ms per frame.
2. p95 play frame time against budget.
3. Phaser eval plus init time inside time to interaction.
4. Resident memory in a Forest room.

**Entry criteria.** The "before" capture has none. The "after" capture needs Stage 1 merged.

**Exit gate.** On the Android: all three scenarios and both builds are captured, and the gate table is filled in. On the iPhone: whatever could be captured; any number it cannot produce is marked as missing, not estimated.

**Expected gain.** None directly. It decides Stage 4's `useTree`/`maxTextures` defaults and feeds the decision gate.

**Rollback.** Not applicable.

**Jonathan's hours.** 4-6 (ESTIMATED): phone setup, the Android runs an agent drives, and the iOS runs by hand.

#### Stage 3: Phase 0 oracles

**Goal.** Build the oracles any engine change needs, and make ranked runs replayable. The work is worth doing without a port (see Verification and parity; see The engine › Determinism contract and server re-simulation). It has two parts. 3a is on the path to the decision gate. 3b runs alongside Stage 4 and the gate and does not block it.

**Prerequisite that Jonathan owns.** A read-only export of published rooms (and, once v2 traces ship, of v2 ranked traces), refreshed weekly and stored in `output/` (gitignored) or a private bucket. Published room data is public; the export holds no user accounts or unpublished drafts. Agents never touch production D1, R2 or Workers, so they cannot make it themselves.

**Order inside 3a.** First the corpus and the tight-rooms list. Then the step-clock PR. Then Jonathan's tight-room play-test.

**Scope, 3a.**

- **Golden-trajectory corpus** (proposed `scripts/engine-port/golden-corpus/{generate,check}.mts`, npm `test:golden-corpus`). Real headless Arcade over the room export. Every published room loads and runs a fixed number of seeded scripted steps. Clearing routes exist only for rooms with recorded v2 clears plus Jonathan's picks; agents do not build general route-solving bots. Per step it records x, y, vx, vy, blocked and touching at 0.01 px. Grow the 9 cadence fixtures to hundreds: slopes, crates, one-ways, ladders, springs and butt stomps.
- **Tight-rooms list,** built from the rooms that have clearing routes (see Verification and parity › Jonathan's play-test protocol).
- **Step clock.** Move mechanics timers, combat, portals and objectives onto the physics step. Today they advance on render-frame delta (`src/scenes/overworld/gameplayClock.ts:12-17`) and run once per render frame (`src/scenes/overworld/framePipeline.ts:142-170`). Sort bodies and colliders in a fixed order. Ship behind a `physicsVersion` bump. The old path stays behind a test-only flag until the blind A/B passes.
- **Full input logs.** Record every control with a step index. Add `physicsVersion` to run traces; today they have only `schemaVersion` (`src/runs/verificationTrace.ts`). Start collecting the corpus in production.
- **Engine-neutral debug API** (proposed `src/engine/debug/api.ts`). Move the about 11 scripts and 93 references that reach into Phaser internals onto it. It extends the `render_game_to_text` (41 files) and `run_preview_smoke_action` (21 files) hooks.
- **Live-frame goldens** (proposed `scripts/smoke_live_frame_goldens.mjs`, npm `smoke:live-frame-goldens`), on both the canvas and WebGL lanes (see The engine › Debug and test surface). Tolerance 0 for tiles. List the smokes that force `?renderer=canvas` and give the renderer-sensitive ones a WebGL variant.
- **Separation fuzzer** (proposed `src/engine/sim/separate.fuzz.test.ts`: a seed set on PRs, plus nightly `npm run fuzz:separation`). It requires `SeparateX`/`SeparateY` and a candidate to be bit-identical. In this stage it runs Arcade against a vendored copy of itself, to prove the harness works.
- **Time-model replay** (proposed `src/engine/core/timeModel.replay.test.ts`, fed by the Stage 2 fixtures). Recorded rAF delta sequences must give the same steps per frame and the same `elapsedMs`.
- **Offline replayer.** Re-simulate exported v2 traces in headless Chromium with the real build and a frozen loop, and report agreement with the client's outcome. No Worker is needed.
- **Arcade fallback size.** Bundle Arcade plus the tilemap collision path (`SeparateTile`, Tilemap and TilemapLayer data, no rendering) headless. Record its brotli size and whether it needs a Scene. This prices the "keep headless Arcade" fallback in Stage 6.

**Scope, 3b.** Extract the step-time game logic (movement, live objects, hazards, specials) into a DOM-free core, then run server re-simulation in shadow mode on a Cloudflare Queue consumer Worker. It never rejects a run in this stage. Plausibility checks stay the only enforcement. Jonathan creates the Queue binding, approves the wrangler change and deploys; agents do none of these.

**Deliverables.** The `physicsVersion` field in production traces; the corpus, fuzzer, replay test and goldens; the debug API; a weekly offline agreement report; and, for 3b, the shadow queue and its agreement report.

**Entry criteria.** Stage 1 merged, and the room export available. The step clock needs the Stage 2 "after" baseline, so that a feel change can be told apart from a perf change.

**Exit gate, 3a.**

- `npm run smoke:physics-cadence` passes at 30-240 Hz with timers on the step clock.
- The time-model replay test passes on the Stage 2 fixtures.
- Jonathan's blind A/B on the tight rooms passes (6 or fewer correct of 10).
- `scripts/check_engine_internals.mjs` (proposed) finds no script outside the debug API reading Phaser objects.
- `npm run test:golden-corpus` covers every room in the export.
- The offline agreement rate is reported weekly.

**Exit gate, 3b.** Shadow re-simulation covers its target set for 2 consecutive weeks, and its agreement rate is reported weekly.

**Expected gain.** Exact server re-simulation becomes possible at about 0.2-0.7 s CPU per 60 s run (ESTIMATED). Every later stage gets an oracle.

**Rollback.** Turn the step clock's test-only flag back to the old path, or revert the PR and issue a new `physicsVersion`. Never reuse a version number. The oracles are tests and carry no runtime risk. If the step clock cannot pass the cadence smoke without changing feel on Jonathan's list, keep render-delta timers, drop exact re-simulation from scope, and keep the other oracles (kill criterion 8).

**Jonathan's hours.** 10-20 (ESTIMATED): 3a 8-15, including 4-6 h of tight-room play and about 1-2 h for the room export; 3b 2-5 for review and the deploy.

#### Stage 4: Owned render paths inside Phaser and a custom Phaser build

**Goal.** Take the render and boot wins that do not need a port, and prove an owned render path against the new goldens.

**Scope.**

- An index-texture tilemap for room layers, drawn by a Phaser Extern game object (a custom pipeline only if Extern proves unworkable). It replaces the CPU canvas bake. The hidden Arcade TilemapLayer stays for collision (`src/scenes/overworld/fullRoomPresenter.ts:185-252`).
- A custom Phaser 3 entry built from `phaser/src` without sound, particles, FX and light pipelines, mesh, rope, nineslice, DOM, video or unused loaders. It replaces the prebuilt UMD alias at `vite.config.ts:44`.
- Set the `useTree` and `maxTextures` defaults from the Stage 2 device results.
- Optional: bake the Expanded Room editor cells that are not being edited, as `roomSnapshotTexture` already does for play.

**Deliverables.** The tilemap behind a flag; the custom build; the Stage 2 protocol rerun on the Android, with the iPhone best effort. That rerun is the "A-fixed" baseline the gate requires, in a receipt at `docs/review/wamp-engine-stage-4-devices-<date>.md` (proposed) with the same table as Stage 2.

**Entry criteria.** Stage 3's live-frame goldens exist. This stage has no pixel oracle without them.

**Exit gate.**

- WebGL-lane live-frame goldens show 0 diff on tiles at integer zooms 1-3, on every PR that touches the flagged path. At fractional map zooms, 0 diff against the server L4 leaf at the nearest integer scale, or a reviewed diff within the per-golden tolerance fixed at capture. The canvas lane passes as a second check.
- The roomRenderers equivalence suite and the cadence smoke are green.
- `npm run size:check` passes with `WAMP_BOOT_JS_BUDGET_KB` lowered to the new total, following the ratchet rule in `scripts/check_bundle_budget.mjs`.
- Room-ready frames on the uncached-room transition, measured with `window.wampMobilePerf` in `npm run perf:runtime:mobile` and on the device trace, are reported against the about-18-frame target (ESTIMATED), and are no worse than after Stage 1.
- `npm run perf:webgl:recovery` passes.

**Expected gain.** Tile upload 1.6→0.2 ms per room (MEASURED, headless micro-bench). About 36→18 phone frames per uncached room (ESTIMATED from F312). Boot JS down by about 50-60 KB br (ESTIMATED from an esbuild metafile).

**Rollback.** The tilemap flag falls back to the baked canvas path. The custom build reverts to the UMD alias.

**Jonathan's hours.** 3-4 (ESTIMATED): visual review of the goldens and a short play-test on each phone.

#### Decision gate

**When.** After Stage 4, re-baselined against the build with Stages 1-4 in, not against today's build. `losewebgl` telemetry must have run for at least 4 weeks.

**The rule.** Open path C (Stage 5 first, physics last) only if, on the real mid-range Android after Stages 1-4, at least one of these holds:

1. Phaser JS plus the native work it triggers is still **at least 20%** of main-thread play-frame time; OR
2. Phaser eval plus init still costs **at least 400 ms** of time to interaction **and** boot is a product priority; OR
3. `losewebgl` telemetry shows **context loss that only owned texture lifetimes can fix**.

If none of these holds, stay on Phaser 3 for good and spend the effort on WAMP's own hot spots. A share between 15% and 20% fails condition 1, so the answer there is to stay unless condition 2 or 3 holds. Kill criterion 1 is not a second gate. It sets a lower line for the same frame-CPU reason: under 15% with p95 in budget, frame CPU can never justify a renderer port, even later.

**Which way it may go (ESTIMATED, headless proxies).** The share metric moves the wrong way as WAMP gets faster. Today Phaser's share is already 21-22% at both throttles. Stage 1 removes more WAMP time than Phaser time, so Phaser's share of a smaller frame can rise.

- **4x proxy:** (14.9 − 7 TileSprite) / (71.5 − 7 − 9.6 WAMP hot spots) = 7.9 / 54.9, about 14%. The 9.6 ms is 1,406 + 309 + 663 = 2,378 ms over 248 frames.
- **1x proxy:** between 1.3 / (9.6 − 2.2 − 0.8) = 1.3 / 6.6, about 20%, if all of Phaser's 0.8 ms of native work is TileSprite, and 2.1 / (9.6 − 2.2) = 2.1 / 7.4, about 28%, if none of it is. The 2.2 ms is 1,080 ms over 496 frames. TileSprite's share at 1x was not measured.

So condition 1 could pass on a fast phone and fail on a slow one. In the fast case the frame is about 7 ms, well inside the 16.7 ms budget, and the port would save about 0.7-1.0 ms that players are unlikely to notice. Kill criterion 1 pairs the share with p95; condition 1 does not. That is why the Stage 2 and Stage 4 receipts report Phaser's absolute ms per frame and p95 next to the share, and why Open question 4 asks whether condition 1 should also require p95 over budget. This PRD does not change the ruling's rule.

**The boot check comes before the port, not after.** If condition 2 is the reason the gate would open, a 1-2 fleet-day size prototype (ESTIMATED) runs first. It bundles the planned `src/engine/` modules at their parity feature list, with stubs allowed, and measures brotli bytes and eval time on the Android. Kill criterion 2 is judged on that prototype before path C opens.

**Deliverable.** Jonathan decides from a one-page report at `docs/review/wamp-engine-decision-gate-<date>.md` (proposed), built from the Stage 2 and Stage 4 receipts, the telemetry and, if needed, the size prototype.

#### Stage 5: Renderer slice

**Goal.** Put an owned renderer behind a seam while Phaser keeps physics, input, scene lifecycle and the editor (see The engine › Living with Phaser during the transition).

**Scope.**

- Move the Stage 4 tilemap into the owned renderer.
- Shared repeat backgrounds, the backdrop layer and the lighting shader.
- Weather and FX, room video, text, the anim module, and the presence, PvP and ghost renderers (see The engine › Rendering).
- Owned texture lifetimes: free CPU sources after upload, and rebuild from compact data or by re-fetching after context loss. The loader takes over runtime avatar loads.
- A Canvas2D fallback lane.

This is about 2-4k LOC rewritten in rendering (ESTIMATED). The hidden Arcade layer stays, so leaderboards are untouched.

**Deliverables.** The renderer behind the `engine.renderer` flag. An owned-runtime size and boot measurement on the target phone.

**Entry criteria.** The decision gate passed.

**Exit gate.**

- `npm run smoke:live-frame-goldens` shows 0 diff on tiles on the WebGL lane and the canvas lane, including the backdrop, weather, room-video, ghost, PvP and presence goldens.
- An injected `WEBGL_lose_context` screenshot-diff gate passes. Extend `scripts/webgl_recovery_probe.mjs` (`npm run perf:webgl:recovery`) and move it from manual to nightly.
- These smokes pass: `smoke:backgrounds`, `smoke:room-camera`, `smoke:community-sprites`, `smoke:live-construction-play`, `smoke:room-emotes`, `stress:presence`, `perf:overworld:tiles`, and `perf:overworld:tiles:parity` (the world-tile parity probe, made hermetic).
- A stale-tab case passes: deploy a new build with a tab open, then trigger a lazy engine chunk load (see Rollout and compatibility).
- The device matrix passes, with a receipt at `docs/review/wamp-engine-stage-5-devices-<date>.md` (proposed).
- `physicsVersion` is unchanged.

Kill criteria: an owned runtime with parity features over 60 KB br, or one that saves under 250 ms to first game frame on the target phone, drops the boot rationale (kill criterion 2). More than 40 h of Jonathan's time on this stage before its gate passes means stop and reassess (kill criterion 6).

**Expected gain.** Freed CPU texture copies, tens of MB on phones (ESTIMATED, low confidence). Part of the 5-11% frame-CPU gain (ESTIMATED). No boot gain yet: boot JS grows by the owned renderer's size (15-50 KB br, ESTIMATED) until Stage 7. Raise the budget on purpose, with a note, as the budget script requires.

**Rollback.** Set the flag's percentage to 0. The Phaser render path stays in the bundle.

**Jonathan's hours.** 20-40 (ESTIMATED).

#### Stage 6: Physics slice

**Goal.** Replace Arcade with an owned solver without changing feel or leaderboards.

**Scope.** A 3-5k LOC solver behind a facade shaped like the Arcade API. About 33k LOC of Arcade-shaped code sits behind that facade: 213 `Arcade.Body` references, 87 `blocked.` and 54 `touching.` reads, and 37 collider/overlap calls (MEASURED). It must carry every feature in The engine › Simulation and physics, including environment zones, enemies, projectiles, sensors, vines and stomp. The engine swap must not need a `physicsVersion` bump; if it does, it failed parity. Folding in `rollingBallPhysics.ts` (864 LOC) and the Sword Hunter planner sim (`src/enemies/swordsmanRobustPlanner.ts:393-625`) comes only after parity, under its own bump.

**Deliverables.** The solver behind the `engine.physics` flag. Corpus, fuzzer and replay reports.

**Entry criteria.** Stage 5 at 100% and stable. The corpus has been collecting step-indexed traces since Stage 3.

**Exit gate.**

- `npm run fuzz:separation` is bit-identical.
- `npm run test:golden-corpus`: at least 99.9% of steps within 0.01 px.
- Replayed top traces from published rooms change no outcome (clear, death or finish).
- The median finish-time shift is at most 1 frame (16.7 ms), and no tight room becomes unsolvable.
- Jonathan's blind A/B on tight rooms: 6 or fewer correct of 10 on the release candidate. Kill criterion 4 stops the swap at 7 or more on 2 consecutive release candidates.
- `smoke:physics-cadence`, `smoke:police-enemies`, `smoke:jungle-vines` and `smoke:assist` pass, and so does F302's planner golden set.
- Offline replay and shadow re-simulation agree with the new solver.

**Expected gain.** The rest of the 5-11% frame-CPU gain. Ownership of the time and physics model.

**Rollback.** The flag drops back to Arcade. If parity misses after a fixed iteration budget (for example 2 fleet-weeks), keep headless Arcade as the sim for good. Arcade alone bundles to 18.8 KB br (MEASURED); whether the tilemap collision path adds to that is measured in Stage 3.

**Jonathan's hours.** 40-80 (ESTIMATED).

#### Stage 7: Retire Phaser

**Goal.** Retire Phaser from the editor, input and lifecycle, then delete it.

**Scope.**

- **Editor.**
  - Split the tile document out of TilemapLayer. `FakeLayer` shows the seam is 3 methods (`src/scenes/editor/editRuntime.characterization.test.ts:1153-1169`).
  - Finish **F279** first.
  - Cover the 27 editor `getWorldPoint` sites, the camera semantics, and the right-button and pan policies with characterization tests.
  - Move the music pattern editor overlay to the batched rect API, and the room-video editor hook off the prototype patch.
  - About 1.5-3k LOC change across 31 files (ESTIMATED).
- **Input.** Canvas-scoped Pointer Events with capture and coalesced events. They retire about 8 DOM workarounds, including `src/ui/mobile/gamePointerBoundary.ts`.
- **Lifecycle.**
  - An explicit scene lifecycle in place of 75+ Phaser-ordered subscriptions.
  - Remove the private-field patches (`src/main.ts:137-150`, `src/main/frameCadence.ts:71-93`, `src/main/renderLoopRecovery.ts:60-65`) and the 750 ms stall monitor.
  - One resize path.
  - About 1.1k LOC of adapters (ESTIMATED).
- **Tests and build.** Retire the 112 `vi.mock('phaser')` files as their modules move. Then delete the `phaser-vendor` chunk (`vite.config.ts:93-94`) and the dependency.

**Entry criteria.** Stage 6 at 100%, or a decision to keep headless Arcade.

**Exit gate.**

- The 244 F274 scenarios pass on real iOS and Android.
- These smokes pass: `smoke:editor-touch`, `smoke:editor-phone`, `smoke:editor-phone-inspector`, `smoke:editor-dock`, `smoke:editor-history`, `smoke:smart-autotiling`, `smoke:first-publish`, `smoke:expanded-leaderboards`, and a new music-overlay smoke (proposed `scripts/smoke_music_pattern_editor.mjs`; none exists today).
- The restricted-import ESLint rule finds zero `from 'phaser'` imports outside `src/engine/phaser/`, and that folder is gone. If Stage 6 kept headless Arcade, the only allowed import is a vendored Arcade-plus-tilemap-collision module.
- `size:check` passes with the budget lowered by the realised saving.
- The full test matrix (7 modes × 3 device classes) passes on the final release candidate.

**Expected gain.**

| Item | Gain | Tag |
| --- | --- | --- |
| Boot JS | About 110-150 KB br below the Stage 4 build (16-22% of 672 KB), less if Arcade stays | ESTIMATED |
| Time to first game frame | 0.1-0.17 s at 1x, 0.35-0.55 s at 4x | ESTIMATED |
| Input | Fewer ghost-tap and stuck-input bugs (F054/F059) | ESTIMATED |
| Tests | Real engine code in vitest in place of hand-written mocks | ESTIMATED |

**Rollback.** The editor and input flags fall back to the Phaser editor until Phaser is deleted. Delete Phaser only one full release cycle after every flag has reached 100%.

**Jonathan's hours.** 20-40 (ESTIMATED).

### Rollout and compatibility

- **Flags.** Reuse the world-tile rollout pattern. A stable cohort id is hashed to a 0-100 bucket and compared with a server-side `rolloutPercentage` (`src/scenes/overworld/worldTiles/rollout.ts:25-66`). A query override (`force`, `shadow`, `off`) works like `?worldTiles=`. There is one flag per slice: `engine.renderer`, `engine.physics` and `engine.editor`. The cohort is decided at page load and never flips during a run.
- **Exemptions from the flag rule.** Asset changes (the F317 repack), build-config changes (the FX flags, the custom Phaser build) and forward-only schema changes (trace v2, a `physicsVersion` bump) cannot sit behind a runtime flag. They need a revert plan instead and, for schema changes, Jonathan's approval (the F330 precedent).
- **Release candidates.** A release candidate is the build that enters rollout for a slice. Jonathan play-tests it once, before 1%. Later percentage steps are gated on telemetry against the control cohort (p95 frame time, context-loss counts, client errors, finished-ranked-run rate), not on new play-tests. A new release candidate is cut only when code changes. Expect 3-5 release candidates for a full port (ESTIMATED).
- **Staged percentages (proposed).** Forced for Jonathan and agents, then 1%, 10%, 50% and 100%. Each step holds for at least a week, and until the flagged cohort is no worse than control on those telemetry measures. Only one slice is in rollout at a time.
- **Kill switch.** Setting `rolloutPercentage` to 0 takes effect on the next page load, with no deploy. `off` in the query lets support move a single player back. The Phaser path stays shipped until Stage 7 deletes it.
- **Stale tabs.** The port changes the chunk graph: new engine chunks, a custom Phaser build, eventually no phaser-vendor. A long-lived tab keeps its engine until it reloads.
  - Any lazy engine chunk that fails to load goes through `src/main/staleBuildRecovery.ts`, the F374 "WAMP was updated" card.
  - A kill-switch change prompts open tabs on that cohort to reload at the next safe point, never mid-run.
  - The server accepts and re-simulates runs under every `physicsVersion` still in its frozen-sim list, and refuses ranking only for versions it has retired.
  - The Stage 5 gate includes the stale-tab case.
- **Room data compatibility.** No stage changes room JSON, tile gids, flip bits, `firstGid` offsets or editor serialization order. The clear-check fingerprint hashes that order. Server renderers have no Phaser, so their version constants do not change.
- **Ghosts and leaderboards under `physicsVersion`.** Every run carries `physicsVersion` from Stage 3. Players in the physics cohort record the version they ran. Server re-simulation uses the version a run was recorded under, so the old sim stays available on the server while those runs are ranked. Whether the Stage 3 step-clock bump needs a split board is an open question. For Stage 6, a failed replay gate blocks the release; it does not split or migrate boards. Ghosts from older versions still play, because they are position breadcrumbs.
- **Expanded Rooms and the editor go last.** Editor test-play wakes `OverworldPlayScene` (`src/scenes/EditorScene.ts:609-617`). So the editor moves only after play runs on the new engine at 100%. `CourseEditorScene` and `CourseComposerScene` move last within Stage 7.
- **Canvas fallback lane.** `?renderer=canvas` forces Phaser's canvas renderer today (`src/main/query.ts:3-32`). It stays on Phaser through Stages 5-6. The owned renderer's Canvas2D lane must pass the same goldens before Stage 7 removes Phaser.
- **Release cadence.** main auto-deploys behind required checks (F483). Engine work lands dark, behind flags, in small PRs. Do not change `physicsVersion` or physics percentages during a Weekly Rush or a game jam.

## Verification and parity

This section matters most in the plan. Under ultracode, agents write code quickly and cheaply. Proving that the new code behaves the same is the slow, costly part. The rules here apply to every stage. No stage merges until its oracles exist and pass. Phaser 3.90.0 stays runnable as the reference oracle until each slice is signed off: the "current build as oracle" pattern from the agent-driven migrations in the field research (CITED). Stage names follow the Delivery plan.

### What exists today and can be reused

WAMP already has more oracles than most projects of its size. None of them were built to compare two engines, so each one needs to be extended.

- **Physics cadence smoke.** `scripts/smoke_physics_cadence.mjs` (`npm run smoke:physics-cadence`) drives `game.step()` at 30, 60, 90, 120, 144, 165 and 240 Hz over 9 fixtures: normal, ice, conveyor, water, wind, three gravity directions and a moving platform. It fails if any rate differs from the 60 Hz run by 0.01 px or more (`scripts/smoke_physics_cadence.mjs:10-11,141`). It runs nightly (`scripts/lib/smokeManifest.mjs:77`). Its limit is that it compares Arcade with itself and never with another engine. It also reaches into Arcade internals such as `world._elapsed` (`smoke_physics_cadence.mjs:86-88`).
- **Renderer equivalence suite.** `src/rendering/roomRenderers.equivalence.test.ts` and `src/visuals/roomSnapshotTexture.equivalence.test.ts` (F484) draw reference rooms through the API card, Pages card, world-tile leaf and client snapshot painters. They compare the results in a SoftwareCanvas model. 61 tests pass in 9 s (MEASURED). Client texture against world tile gives 0 differing pixels (MEASURED). Pins are sha256 values of decoded pixels (`roomRenderers.equivalence.test.ts:330-347`), and the suite runs in CI through `npm run test`. Its limit is that it models draw calls, not Chrome's rasterisation (`roomRenderers.testHarness.ts:22-27`). It also leaves out lighting, weather and video on purpose (`roomRenderers.equivalence.test.ts:309-327`). The live Phaser frame has no golden at all.
- **World-tile parity probe.** `npm run perf:overworld:tiles:parity` (`scripts/world_tile_parity_probe.mjs`) compares rendered world tiles with the live map pixel by pixel. It is a developer tool and has never been scheduled (`:1-2`).
- **WebGL recovery probe.** `npm run perf:webgl:recovery` (`scripts/webgl_recovery_probe.mjs`) loses and restores the context and checks that the world-tile map comes back. It is manual and needs live tile data (F480; `smokeManifest.mjs:126`).
- **Bundle budget.** `scripts/check_bundle_budget.mjs` fails CI when boot JS goes over 673 KB brotli (`:18`; `npm run size:check` in `.github/workflows/quality.yml`).
- **Runtime performance trace.** `scripts/runtime_performance_trace.mjs` (`npm run perf:runtime:mobile`) records phone-viewport traces (390x844, DPR 2; `:293-302`) in headless Chromium only (`:1107`). The engine-port profile and bench in `scripts/engine-port/` reuse the same context, and `measure.mts --cdp` is the route to a real Android.
- **Editor touch scenarios.** F274 left 244 browser scenarios (tablet 80, phone portrait 82, phone landscape 82) and F275 left 63 scenario groups (CITED). They sit alongside `smoke_editor_touch.mjs`, `smoke_editor_phone_dock.mjs` and `smoke_editor_phone_inspector.mjs`. CI already installs Chromium and WebKit for `smoke:mobile:ci` (`quality.yml:52-53`).
- **Feature smokes** that cover port-touched features: `smoke:backgrounds`, `smoke:room-camera`, `smoke:smart-autotiling`, `smoke:community-sprites`, `smoke:live-construction-play`, `smoke:room-emotes`, `smoke:police-enemies`, `smoke:jungle-vines`, `smoke:assist`, `stress:presence` and `perf:overworld:tiles` (map LOD). The stage gates name each one where it applies.
- **Engine-neutral hooks.** `window.render_game_to_text` (`src/main.ts:399`) is used by 41 script files, and `run_preview_smoke_action` by 21 (MEASURED). These smokes can run against either engine without changes. About 11 scripts with 93 references reach into Phaser internals instead (MEASURED). They must move onto the engine-neutral debug API in Stage 3 (see The engine › Debug and test surface).
- **Unit tests.** There are 741 vitest files. 112 of them `vi.mock('phaser')` (MEASURED), because Phaser throws `window is not defined` in node. Those 112 check that WAMP calls Phaser's API in the expected shape, not that the behaviour is right. Two harnesses already load real code: `movementController.stateOwnership.test.ts:630-651` loads real Arcade `World` and `Body` from `phaser/src` in node, and `physicsCadence.test.ts` tests the step accumulator as a plain class. These two are the seeds of the new physics and time oracles.

### Why ghosts and the ranked verifier cannot vouch for feel

Nobody may cite ghost playback or verifier pass rates as parity evidence, at any stage.

- Ghosts store sampled positions, not inputs (`src/runs/verificationTrace.ts`), interpolated on playback (`src/runs/ghostRace.ts`). They never re-run physics, so they cannot fail.
- The server runs plausibility checks today. They are tolerant by design, so they cannot detect small changes in feel.
- Ranked traces log only `moveX`, `moveY` and `jump` at render-frame times (`verificationTrace.ts:9`). They have no step index and no `physicsVersion`, and the schema is version 1 (`:3`). Mechanics timers advance on render delta (`gameplayClock.ts:12-17`). Combat, portals and objectives run once per render frame (`framePipeline.ts:142-170`). So today's stored traces cannot be replayed exactly by any engine, Phaser included.

The upgrade path for verification is "plausibility checks today; exact re-simulation later". Exact re-simulation needs the Stage 3 work: step-indexed full inputs, a step clock for every mechanic, and a `physicsVersion`.

### What must be built

All paths below are proposed.

1. **Golden-trajectory corpus** (`scripts/engine-port/golden-corpus/{generate,check}.mts`, npm `test:golden-corpus`). Run real headless Arcade, extended from the `stateOwnership` harness, over the room export (see Stage 3). Use three kinds of input. (a) Seeded scripted inputs over every published room: random walks, plus hold, tap and edge-jump patterns, for a fixed number of steps. (b) Recorded step-indexed clears from production, once Stage 3 logging ships, plus Jonathan's picks. Only these rooms get clearing routes; agents do not build bots that solve arbitrary rooms. (c) The expanded cadence fixtures: slope, triangle ramp, rolling ball, crate push, one-way drop-through, ladder, spring and butt stomp, on top of today's 9. Slopes and rolling balls landed in #355, which is 24e3626 itself, so they have the least coverage. For the player and each live object, record x, y, vx, vy, blocked and touching per step, plus the outcome of each run (clear, death, finish step). Store the corpus by content hash with the `physicsVersion` that produced it. Corpus size depends on how many rooms are tight (open question). The plan assumes hundreds of fixtures and thousands of traces (ESTIMATED).
2. **Separation fuzzer** (`src/engine/sim/separate.fuzz.test.ts`; nightly `npm run fuzz:separation`). Generate random body pairs and body-tile cases: overlaps, velocities, immovable and pushable flags, tile-bias edge cases, and side-gravity zones. Run Arcade `SeparateX`/`SeparateY` and tile separation against the candidate implementation. The skeptic's brief lists the hidden rules the fuzzer must hit: the axis choice in tile separation, Y-first body separation even in side gravity, and friction carried twice in catch-up steps (`src/scenes/overworld/liveObjects.ts:768-772`).
3. **Time-model replay** (`src/engine/core/timeModel.replay.test.ts`, fed by `scripts/engine-port/fixtures/raf/`). Use the rAF timestamp sequences recorded in Stage 2: jank, 120 Hz gating, a blur and refocus, a background tab, and a sleep and wake. Feed each sequence to the current loop and the candidate loop, both headless, and compare steps per frame and gameplay `elapsedMs`.
4. **Live-frame golden screenshots** (`scripts/smoke_live_frame_goldens.mjs`, npm `smoke:live-frame-goldens`, with `--lane canvas|webgl`). Use `preserveDrawingBuffer` (`src/main.ts:98`) and a frozen loop (`game.loop.sleep` plus fixed `game.step()` calls). The canvas lane forces `?renderer=canvas`, as `smoke_physics_cadence.mjs:12-15` does. The WebGL lane runs SwiftShader WebGL on a pinned Chromium, and it is the only lane that exercises owned WebGL paths. The corpus is listed in The engine › Debug and test surface. Goldens come from Phaser and are never regenerated from the candidate engine.
5. **Lifecycle and event-order logs** (`scripts/smoke_lifecycle_order.mjs`, npm `smoke:lifecycle-order`). WAMP has 75+ lifecycle subscriptions tuned to Phaser's event order (CITED). For a fixed set of scripted scenarios, record the ordered sequence of callbacks WAMP sees. The scenarios are boot, room enter and leave, menu open and close, pause, background tab, rotate, resize, editor test-play enter and exit (`EditorScene.ts:609-617`), and context loss. The callbacks are scene create, wake, sleep, pause, resume and shutdown; visibility and focus; resize; worldstep, postupdate and postrender; and losewebgl and restorewebgl.
6. **Injected context loss.** Extend `webgl_recovery_probe.mjs` into a hermetic, nightly gate. Call `WEBGL_lose_context.loseContext()` and `restoreContext()` mid-play, in the editor and in Browse. Then diff a frozen frame against the frame from before the loss, and compare room state. Pair it with field `losewebgl`/`restorewebgl` counters sent to the server for at least 4 weeks (Stage 1). Today these events only reach the console.
7. **Perf budgets in CI.** Gate on counts that do not change from run to run: boot JS brotli bytes, engine-runtime bytes, draw calls and quads per play frame, texture count and bytes, and shader programs. Track timings (Phaser or engine JS ms per frame at 4x throttle, boot phases) as medians of at least 5 runs, and report them as warnings rather than failures. Run-to-run variance is about 1.6x on boot and about 10% on fps in headless (MEASURED). Headless fps is limited by SwiftShader and says nothing about the engine. Only real devices decide timing questions.
8. **Blind A/B tool** (`scripts/engine-port/blind-ab/`): the sealed per-session switch and the trial log for Jonathan's play-test protocol below.

### Oracle table

Names of oracles that do not exist yet are the proposed ones from the list above.

| Oracle | What it proves | Exists today? | Tolerance and pass criterion | CI or manual | Needed by |
|---|---|---|---|---|---|
| `smoke:physics-cadence` | Same trajectory at 30-240 Hz as at 60 Hz | Yes, 9 fixtures | Under 0.01 px, player and actors | Nightly; per PR on physics changes | Stage 1 (`useTree:false`), Stage 3 |
| Expanded cadence fixtures | Slopes, ramps, balls, crates, one-way, ladder, spring, stomp keep the 60 Hz contract | No | Under 0.01 px | Nightly | Stage 3 |
| `test:golden-corpus` | Candidate sim reproduces Arcade step by step on real rooms | No (harness seed only) | Per step under 0.01 px; blocked and touching exact; outcomes exact. Ship: at least 99.9% of steps in tolerance and zero outcome changes | PR: sampled subset. Nightly: full | Stage 3 (built), Stage 6 (passed) |
| `fuzz:separation` | Collision response is identical | No | Bit-identical (`Object.is` per float) | PR: about 10k cases (ESTIMATED). Nightly: millions | Stage 3 (built), Stage 6 (passed) |
| Time-model replay test | Same steps per frame and same game time on real rAF sequences | No (cadence unit tests only) | Identical integer steps per frame; identical `elapsedMs` | PR (vitest) | Stage 3 (step clock), Stage 5 (owned loop) |
| Renderer equivalence suite | Server and client painters draw the same room | Yes, 61 tests | sha256 pins; 0 px client against tile | PR (vitest) | Stages 1, 4, 5 |
| `perf:overworld:tiles:parity` | Real Chrome raster matches the model | Yes, never scheduled | 0 differing px on fixtures | Make hermetic; nightly | Stages 4, 5 |
| `smoke:live-frame-goldens` | Live frame (sprites, depth, parallax, lighting, text, weather, video, presence) is unchanged | No | Tiles at integer zoom: 0 px. Text, lighting and fractional zooms: a per-golden tolerance fixed at capture, never loosened without Jonathan's review | Canvas lane every PR; WebGL lane on every PR touching a flagged render path, nightly otherwise | Stage 3 (built), Stages 4 and 5 (passed) |
| `smoke:lifecycle-order` | Callbacks fire in the same order | No | Exact sequence match, or a reviewed diff with a written reason | PR | Stages 5, 7 |
| Injected context loss (`perf:webgl:recovery`, extended) | Restore gives the same frame and the same state | Partial (manual probe) | Same tolerance as the live-frame goldens; state equal | Nightly | Stage 1 (ImageBitmap close), Stage 5 |
| Context-loss telemetry | How often loss happens in the field and whether restore works | No | At least 4 weeks of data before the decision gate; any field restore failure blocks | Production | Stage 1, decision gate |
| F274/F275 touch scenarios | Editor input semantics | Yes, 244 scenarios + 63 groups | All pass, emulated and on real iOS and Android | CI (emulated); manual (devices) | Stage 7 |
| `render_game_to_text` smokes | Game state through the engine-neutral hooks | Yes, 41 + 21 files | Existing assertions | CI and nightly | All stages |
| Engine-neutral debug API plus `check_engine_internals.mjs` | The 11 internals-reaching scripts run on both engines | No | Same results on Phaser before and after the switch; no new reaches | CI | Stage 3 |
| `size:check` | Boot JS does not grow | Yes, 673 KB br | Ratchet down after each win; engine runtime at most 60 KB br (kill criterion 2) | PR | Stages 1, 4, 5, 7 |
| Runtime perf budgets | Draw calls, quads, textures, shader programs, per-frame JS | Partial (trace is a devtool) | Counts: no increase over the decision-gate baseline (7.3 draws per play frame, 16 in the map today, MEASURED). Timings: warnings only | PR (counts); nightly (timings) | Stage 1, decision gate, Stage 5 |
| Real-device traces | Real CPU and GPU shares, boot, memory | No | Gate thresholds (see Delivery plan › Decision gate) | Manual | Stage 2, Stage 4, decision gate, every release candidate |
| Blind A/B play-test | Jonathan cannot tell new from old | No | 6 or fewer correct of 10 per release candidate | Manual | Required: Stage 3 (step clock), Stage 6. Optional: Stage 5 |

### Device matrix

Every frame number in the study so far comes from SwiftShader or CDP throttling. The matrix below is the minimum. Agents run the scripted parts on it, and Jonathan plays only what the scripts cannot judge.

| Class | Device | Browser | Why |
|---|---|---|---|
| Mid-range Android | One Adreno or Mali phone | Chrome | Gate thresholds are measured here; multi-texture shader cost; memory |
| iPhone | One recent iPhone, ideally 120 Hz ProMotion | Safari (WebKit) | JavaScriptCore cost, canvas memory limits, iOS gestures, high-refresh time model |
| Tablet | One iPad or Android tablet | Safari or Chrome | The 80 F274 tablet scenarios, editor layout |
| Desktop | A laptop | Chrome, plus Safari or Firefox | Keyboard and gamepad, 1080p FX memory, regression baseline |

Each release candidate covers 7 modes: play, ranked, Room Rush, editor, Expanded Room editor, browse, and PvP or co-op. Doing all of it by hand would take about 20 h per release candidate (ESTIMATED: 7 modes × 3 device classes × about 1 h). The protocol below cuts that by letting the automated oracles screen first.

### Jonathan's play-test protocol

1. **Agents screen first.** Jonathan never plays a build that fails any CI or nightly oracle above. Each session comes with a one-page brief: what changed, which oracles passed, and which rooms to play.
2. **The tight-rooms list.** Agents build it from the corpus rooms that have clearing routes (recorded v2 clears plus Jonathan's picks). A room is tight when moving the initial x by 1 px, or a jump input by 1 step, flips the outcome of a recorded route. Jonathan adds rooms they know are fussy. The list is versioned in the repo, and every release candidate is tested against the same list. How many rooms qualify is an open question.
3. **Blind A/B.** Feel-affecting changes keep the old path behind a test-only flag until their A/B passes, so both builds can run in one session. A hidden per-session switch in `scripts/engine-port/blind-ab/` loads build A or B. A script picks the order at random and seals the key until the session ends. For each trial, Jonathan plays the same tight room on the same device twice in a row. Jonathan records which one felt like today's game, or "can't tell", plus a free-text note. "Can't tell" counts as incorrect. Each release candidate gets 10 trials. Pass is 6 or fewer correct. If Jonathan gets 7 or more right on 2 consecutive release candidates, the physics swap is abandoned (kill criterion 4). Ten trials can only catch a clear difference: guessing alone gives 7 or more correct about 17% of the time ((120+45+10+1)/1024 = 176/1024). So one failing release candidate is not a verdict. It sends agents to diff the corpus on the rooms where Jonathan was right. Jonathan's notes count as much as the score.
4. **Time boxes.** Sessions last at most 60 minutes on one device, at most 2 per day. Each session uses a fixed room list and a log template. Planned budgets (ESTIMATED): 4-6 h for the Stage 3 step-clock change, and 25-45 h in total up to the decision gate. If Jonathan's time on Stage 5 passes 40 h before its gate passes, the plan stops and is reassessed (kill criterion 6).

### Leaderboard policy under physicsVersion

- Stage 3 adds `physicsVersion` to ranked traces and ghosts, alongside the full step-indexed input log. This ships first and collects a corpus under the current physics before any physics change lands. Unstamped records count as version 1.
- Any change that alters per-step trajectories or mechanic timing bumps `physicsVersion`. Renderer-only work (Stages 4 and 5) keeps the hidden Arcade layer, so it leaves the version and the boards alone.
- When the version is bumped, replay the corpus of step-indexed top traces under the new version before release. If the median finish-time shift is 1 frame (16.7 ms) or less, no outcome changes and no tight room becomes unsolvable, records carry over and the boards stay unified. Otherwise the release is blocked and no board is migrated (kill criterion 5). If Jonathan still wants the change on purpose, existing boards are frozen and shown as their own version, and new runs rank only against runs on the same `physicsVersion`.
- Old ghosts stay playable as visual opponents in every version, because they are positions. Ranked comparisons never mix versions.
- Exact server re-simulation uses a sim build pinned to each supported `physicsVersion`. The plausibility checks stay in place for every run.
- The first expected bump is the Stage 3 step-clock move for timers, combat and portals. It can shift timings by up to 1 frame on janky or 120 Hz devices (ESTIMATED), so it goes through the full replay and A/B steps above. If it cannot pass the cadence smoke without changing feel on Jonathan's list, timers stay on render delta and exact re-simulation goes out of scope (kill criterion 8).

## Running it with agent fleets

Agents write the code. The real costs are the oracles that prove the code right, behaviour parity, and Jonathan's review and play-testing time. This section covers how to run each stage with fleets ("ultracode") without letting volume get ahead of verification.

### The oracle-first rule

No agent task ships without an objective check that it must pass. The check is named before the work starts, and it runs on a machine, not on an agent's word.

- **The oracle comes before the code it judges.** It lands in its own PR, written and reviewed by different agents from the ones who will write the code it judges. A PR that changes a golden, a tolerance or a fixture in the same diff as the code under test is rejected. The fix ships first and the golden is regenerated in a separate, labelled PR.
- **Use the gates that already exist where they cover the work.** These are `npm run smoke:physics-cadence` (0.01 px across refresh rates), `src/rendering/roomRenderers.equivalence.test.ts` (61 tests, about 9 s, MEASURED), `npm run size:check`, `npm run perf:runtime:mobile`, `npm run perf:webgl:recovery`, the F274 touch scenarios, the feature smokes, and the profile and bench in `scripts/engine-port/`.
- **Stage 3 builds the gates that do not exist yet:** step-indexed input traces with `physicsVersion`, the golden-trajectory corpus, the separation fuzzer, live-frame goldens, the time-model replay and the engine-neutral debug API (see Verification and parity). Stages 5-7 cannot open until those gates are green on the Phaser build.
- **Ghost and verifier pass rates never count as parity evidence.** Both are coarse by design.

The research backs this up. Every successful agent-driven migration had a cheap, objective oracle. They include Google's JUnit migration, Airbnb's Enzyme-to-RTL migration gated on Jest, lint and tsc, and Carlini's C compiler, where GCC was the oracle (all CITED). Cursor's FastRender had volume but no hard gate, and it shipped a red main (CITED). In the C-compiler project, 16 parallel agents all got stuck on the same bug until an oracle let them localise different failures (CITED). Here the oracle is the current Phaser build.

### Cutting work into agent-sized tasks

| Rule | What it means in WAMP |
|---|---|
| One module or one call-site family per task | Examples: the 11 TileSprite references (F353; census count); one family from the 11 scripts and 93 refs that reach Phaser internals; `body.blocked` reads (87), `touching` reads (54), collider/overlap registrations (37); about 10 of the 112 `vi.mock('phaser')` test files per batch. MEASURED counts from the census. |
| A declared file allow-list | The task card lists the files the agent may touch. A reviewer rejects a diff that goes outside the list. |
| Worktree isolation | One git worktree and one branch per agent. Agents never share a working tree or an `output/` directory. |
| Small PRs | Target under about 400 changed lines, so one human review sitting covers one PR (300-500 LOC/h careful review, ESTIMATED). |
| Every PR names its gate | The PR body states the exact commands and the pass condition. CI and the reviewer re-run them. |
| Runtime changes behind a flag | New runtime paths are off by default and selected by a debug query flag, following the existing `?renderer=` option at `src/main.ts:72`. With the flag off, the build must pass every existing gate unchanged. Asset, build-config and forward-only schema changes are exempt: they need a revert plan and, for schema changes, Jonathan's approval (the F330 precedent). |
| A receipt per item | Follow the repo's existing pattern: one receipt doc per F-number or engine task, recording what changed, gate output, spend and rollback. |

Task card template (the planning wave fills one in for every task):

```
Task: ENG-S1-07 (F353 TileSprite shared-pattern subclass)
Stage: 1 (Quick wins)
Module/family: src/visuals/starfield.ts, src/backgrounds/runtime.ts (allow-list)
Risk tier: amber
Flag: ?tilesprite=shared (default off)
Gate: roomRenderers equivalence green; smoke:physics-cadence green;
      smoke:backgrounds green; size:check passes; runtime profile shows
      no TileSprite construction bursts in the 4x play run
Rollback: flag off; revert PR
Receipt: docs/review/wamp-eng-s1-07-tilesprite.md
```

### Waves per stage

Agent counts are concurrent agents in one wave (ESTIMATED). Each implementer is paired with one or two independent review agents.

| Stage | Waves | Concurrent agents |
|---|---|---|
| 1. Quick wins | (a) Planning: re-check every item's file:line at the current main, write task cards and gates. (b) Implementation of 15-25 small PRs. (c) Re-baseline: re-run `scripts/engine-port/` and `size:check`, write the receipt. | (a) 3-4 read-only. (b) 4-8 implementers plus reviewers. (c) 2-3. |
| 2. Real-device baselines | Validate `measure.mts --cdp` on the phone, prepare device runs, and analyse the traces Jonathan captures. | 1-2 |
| 3. Phase 0 oracles | (a) Independent oracle builders in parallel: debug API families, live-frame goldens, corpus generator, separation fuzzer, time-model replay, offline replayer. (b) Step clock plus step-indexed input log and `physicsVersion`: **serial**, one implementer. (c) Corpus generation runs (CPU time, not tokens). (d) 3b: sim-core extraction, then the shadow queue. | (a) 6-10. (b) 1. (c) As many cores as are available. (d) Sized by its planning wave. |
| 4. Owned paths inside Phaser | Index-texture tilemap as an Extern object, a custom Phaser 3 build, `useTree`/`maxTextures` defaults. | 3-5 |
| Decision gate | Re-run this study on the Stage 4 build with the real-device traces: mappers, measurers, advocate, skeptic, judge. Plus the size prototype if condition 2 is in play. | About 13, as in this study (orchestrator's run summary) |
| 5. Renderer slice | Tile layer, quad batcher, Graphics replacement, bitmap text, weather and FX, room video, presence renderers, texture lifetimes, Canvas fallback lane, context loss. | 6-12 |
| 6. Physics slice | (a) A facade shaped like the Phaser API, one call-site family per task. (b) **Serial** parity loop against the corpus. | (a) 4-8. (b) 1-3. |
| 7. Retire Phaser | Scene manager, Pointer Events input, loader, editor tile-document split, music overlay, then the 112 mocked test files in batches (Airbnb-style per-file pipeline gated on vitest, lint and tsc). | 4-10 |

### Adversarial review agents

Self-review is unreliable: in one published test, the same model endorsed its own bug 31.7% of the time (CITED). Reviewers are therefore separate agents with different prompts. They see the diff, the task card and the raw gate output, but not the implementer's reasoning. They re-run the gate themselves. Green and amber PRs get one reviewer. Red PRs get two: one for correctness and one for gate gaming.

They look for:

- **Gate gaming:** loosened tolerances, regenerated goldens, skipped or deleted tests, new `vi.mock('phaser')` fakes that make a test pass, raised bundle budgets, and widened smoke timeouts.
- **Sim drift:** a changed order of separation and the `blocked`/`touching` reads in `movementController.ts:276-698`. Render delta leaking into mechanics (`gameplayClock.ts:12-17`). Any sim change without a `physicsVersion` bump.
- **Flag hygiene:** the new path must be unreachable with the flag off, and flag-off output must be identical. Turning the flag off must need no data migration.
- **Lifecycle leaks:** textures, listeners and timers not released on scene sleep or shutdown. Hidden scenes that still render (`SceneManager.js:593`).
- **Mobile input:** listeners moved between window and canvas, passive or capture changes, and `touch-action` changes. Any hit here sends the PR to the iOS check.
- **Loop patching:** changes near `main.ts:137-150`, `frameCadence.ts:71-93` or `renderLoopRecovery.ts:60-65`. One owner at a time.
- **Scope and hygiene:** files outside the allow-list, and receipts that put security-sensitive detail into this public repo. Any change to server-side run verification is escalated to Jonathan and described in receipts at a high level only.

### What never gets parallelised

- **The physics parity loop.** Diff the corpus, find the first diverging step, fix it, re-run. Parallel agents chasing the same first divergence would collide, which is the C-compiler failure mode. Fan out only once failures are localised to independent fixture families (slopes, crates, one-way, ladders, springs), and keep one integrator.
- **Step-clock and `physicsVersion` changes.** One at a time, each followed by Jonathan's play-test of the tight rooms.
- **Jonathan's feel testing** and the blind A/B tests (see Kill criteria).
- **iOS and Android gesture checks** on real devices: the F274 scenarios and the editor's pinch, pan and right-button policies. Headless runs do not reproduce them.
- **Context-loss behaviour on real drivers**, and any decision to migrate leaderboards.
- **Profiling runs.** A measurement run gets the machine to itself. Headless SwiftShader used 3.2 cores for a bare 8-quad page (MEASURED), so a profile that shares cores with agents produces noise.

### Jonathan's time, and how to keep it bounded

All figures ESTIMATED, from the study's path costs.

| Stage | Jonathan's hours | What the time is spent on |
|---|---|---|
| 1. Quick wins | 8-15 | About 8-11 h reviewing small PRs, 4-6 h of phone play on 2 devices |
| 2. Real-device baselines | 4-6 | Phone setup, Android runs, iOS runs by hand |
| 3. Phase 0 oracles | 10-20 | 4-6 h of tight-room play after the step clock lands; about 1-2 h for the room export; 3b review and deploy |
| 4. Owned paths inside Phaser, and the decision gate | 3-4 | Golden review, a short play-test per phone, reading the gate report |
| **To the decision gate (path E)** | **25-45** | |
| 5. Renderer slice | 20-40 | Golden review, the release candidate's play-test, device matrix, Canvas fallback |
| 6 and 7. Physics and retirement | 60-120 | Blind A/B, about 20 h per release candidate, leaderboard triage |

Kill rule: if Jonathan spends more than 40 h on Stage 5 (counted from the decision gate) before its gate passes, stop and reassess (kill criterion 6). Stage 5's estimate is 20-40 h, so the cap allows about one failed release candidate. That is intended.

The repo's rule is "work one item at a time, and let Jonathan check it before starting the next" (`docs/review/wamp-checkup-round-2.md:17`). Practice has already bent it. PR #356 shipped F254, F255, F258, F260 and F266 together, each with its own receipt. The proposed adaptation keeps the rule's intent, which is that nothing piles up unchecked, while letting agents write in parallel:

1. **The rule applies to Jonathan's check queue, not to agent writing.** Agents may prepare PRs in parallel. Merges happen one *check unit* at a time, in order, and the next check unit merges only after Jonathan has checked the last one.
2. **A check unit depends on risk tier:**
   - **Green:** mechanical, behaviour-neutral, exact-equality gate. Examples: debug-API repointing, mock conversions, build config. Up to 5 PRs per batch. Jonathan reads the batch summary and receipts and samples about 1 diff in 5. Any sampled defect sends the whole batch back.
   - **Amber:** a perf or memory change with an equivalence gate but possible visual or device effects. Examples: FX flags, F353, F356, the brick patch, F312. One PR per unit, with a 15-30 minute phone check.
   - **Red:** feel, leaderboard, input or context-loss sensitive. Examples: the step clock, `useTree:false`, `maxTextures`, any physics-slice or iOS input change. One PR per unit, a full play-test, and blind A/B where the kill criteria call for it.
3. **Cap the queue at 3 check units awaiting Jonathan.** Agents stop opening PRs at the cap rather than piling up stale branches that need rebasing.
4. **Low-risk Stage 1 items are batched into about 3-5 green units.** Amber items go one by one.

Jonathan should approve this change to the checklist rule before Stage 1 starts.

### Cost and time calibration from this study

This study is the calibration point. The orchestrator's run summary reports 13 agents and about 92 minutes of wall-clock time, with 2 agents running at once in a 4-core container. Those usage figures are not in the evidence files, so treat them and everything derived from them as ESTIMATED. Prices are CITED: Anthropic list prices for Claude Opus 5.5 ($4 input, $20 output and $0.20 cache read per million tokens; cache writes at 1.25x the input price for a 5-minute lifetime and 2x for 1 hour).

| Item | Tokens | Cost |
|---|---|---|
| Cache reads | about 72M | 72 × $0.20 = $14.4 |
| Output | about 0.52M | 0.52 × $20 = $10.4 |
| Cache writes | about 1.8M | 1.8 × $5-8 = $9.0-14.4 |
| **Total** | | **about $34-39** (14.4 + 10.4 + 9.0 = 33.8; 14.4 + 10.4 + 14.4 = 39.2) |

Derived rates (ESTIMATED):

- **Per agent:** $34-39 / 13 = about $2.6-3.0 for a read-only research or measurement agent.
- **Per agent-hour:** at most 92 min × 2 concurrent = 184 agent-minutes, about 3.1 agent-hours. $34-39 / 3.1 = about $11-13 per agent-hour, at least.
- **Where the money goes:** cache reads were about 97% of tokens (72 / 74.3). Spend tracks how much context each agent re-reads, so small, scoped tasks are cheaper as well as easier to review.

Assumptions for the stage estimates (all ESTIMATED):

- Implementation and verification agents cost **$15-30 per agent-hour**, 1.2-2.5x this study's rate, because they write more output and re-run tests.
- A small PR costs **2-3 agent-hours** (implementation, reviews, one rework loop). An oracle, renderer or facade PR costs **3-6**.
- 30-50% of tasks need a second pass.
- Wall-clock is agent-hours divided by concurrency. Calendar time is set by Jonathan's check queue and the rollout floors, not by the fleet.

| Stage | Merged PRs | Agent-hours | Spend | Agent wall-clock at 2 / 8 concurrent |
|---|---|---|---|---|
| 1. Quick wins | 15-25 | 30-75 | $450-2,250 | 15-38 h / 4-10 h |
| 2. Real-device baselines | 0-3 | 3-6 | $50-180 | under a day; bound by device access |
| 3a. Phase 0 oracles | 25-40 | 75-160 | $1,100-4,800 | 38-80 h / 9-20 h, plus corpus CPU time |
| 3b. Server re-simulation | Sized by its planning wave | — | — | Not on the path to the gate |
| 4. Owned paths inside Phaser | 8-15 | 24-60 | $360-1,800 | 12-30 h / 3-8 h |
| Decision gate re-study | 0 | 3-6 | $35-80 | about 1.5-3 h at 2 concurrent |
| **Path E total (excluding 3b)** | **48-83** | **about 135-307** | **about $2k-9k** | |
| 5. Renderer slice | 20-40 | 80-240 | $1,200-7,200 | 40-120 h / 10-30 h |
| 6. Physics slice | 20-40, plus the parity loop | 240-480 (facade 80-240; loop capped at 2 fleet-weeks: 2-3 agents × about 8 h × 10 days = 160-240) | $3,600-14,400 | The loop is serial: at least 2 calendar weeks at any fleet size |
| 7. Retire Phaser | 30-47 (20-35 plus about 11 test batches) | 60-175 | $900-5,300 | 30-88 h / 8-22 h |
| **Stages 5-7 total** (path C after Phase 0) | | **about 380-895** | **about $6k-27k** | |

The fleet-week figures in the Delivery plan come from the ruling; this table is a bottom-up estimate. They overlap but are not identical. Use this table for spend and the fleet-weeks for calendar.

Even at the top of the range, token spend is small next to 25-45 h of Jonathan's time for path E and 80-160 h more for path C. Agents make writing cheap; they do not make checking cheap.

**Concurrency.** The container ran 2 agents at once on 4 cores. Agents that only run unit tests fit about 2 per 4 cores. Agents that run a browser (goldens, mobile smoke, the profile) need about 4 cores each. Running 8 at once needs about 16-32 cores, or 4-8 separate sessions coordinated through the shared task cards. Profiling runs always get a box to themselves.

### Guardrails

**Spend:**

- **A fixed budget per workflow:** maximum agents, maximum concurrency, and maximum dollars per agent and per wave, written into the workflow script. Stage 1 example: at most 80 agent runs and the top of its range above.
- **Stop rules:**
  - A task that fails its gate after 3 attempts goes back to planning; it is not handed to a bigger fleet.
  - A wave pauses if more than 30% of its tasks fail their gates, because that points to a missing oracle.
  - A stage pauses if it has spent 80% of its budget with under half its PRs merged.
  - The physics loop stops at its 2-fleet-week cap (kill criterion 3).
- **Check the account's usage limits before any large run.** Stages 5-7 can exceed a week's allowance, so split them across days or sessions.
- **Log spend per workflow** (agents, tokens, dollars, wall-clock) in the stage receipt, so this calibration improves with real data.

**Safety:**

- **No pushes to main.** Agents work on branches and open PRs. The "Protect main" ruleset (F483) requires the `quality` and `mobile-smoke` checks and blocks force-pushes. Jonathan, not an agent, approves merges for amber and red units.
- **Agents never deploy** (`scripts/deploy_prod.mjs`). They never touch production D1, R2 or Workers, and never read secrets. Jonathan provides the room export and makes the Stage 3b Queue binding and deploy.
- **Runtime changes sit behind a default-off flag**, with a flag-off path that is identical to today's build. Asset, build-config and forward-only schema changes are exempt, as above.
- **Rollback is ready before merge:** each receipt states its rollback (flag off, revert PR). Forward-only changes, such as a new trace field or a `physicsVersion` bump, are labelled as forward-only in the PR title. Jonathan approves each one, following the F330 precedent.

## Risks

Likelihood and impact are ESTIMATED judgements, built on the evidence noted in each row. "Owner stage" is the stage that owns the mitigation (see Delivery plan). All line references are to main @ 24e3626.

| Risk | Likelihood | Impact | Mitigation | Owner stage |
|---|---|---|---|---|
| **Physics feel drift.** Feel rests on hidden Arcade rules. SeparateTile picks the first axis by delta size. Body-vs-body separation always runs Y first, because world gravity.y is set even in side-gravity zones. Collider order follows creation order. The surface is 213 `Arcade.Body` refs, 87 `blocked.` reads, 54 `touching.` reads and 37 collider/overlap calls (MEASURED). The only real-physics oracle is 9 cadence fixtures, and they compare Arcade with itself. | High, if the physics slice runs | High | Keep headless Arcade as the sim until the golden-trajectory corpus passes. Require the separation fuzzer to be bit-identical. Run blind A/B tests on Jonathan's tight-rooms list. Kill criteria 3 and 4 apply. | Stage 3 (oracles), Stage 6 |
| **Leaderboard comparability.** Traces have `schemaVersion` 1 and no `physicsVersion` (`src/runs/verificationTrace.ts:3`). Mechanics timers run on render delta (`src/scenes/overworld/gameplayClock.ts:12-17`). Ghosts and the server verifier are too coarse to catch small feel changes. | Medium | High | Bump `physicsVersion` in Stage 3. Log step-indexed inputs for all controls. Replay the top ranked traces through both sims. A failed replay blocks the release; boards are never migrated silently. Never count ghost or verifier pass rates as parity evidence. Kill criterion 5 applies. | Stage 3, Stage 6 |
| **iOS gesture parity.** WAMP's touch workarounds are tuned to Phaser's window-level mouse and touch listeners (`src/ui/mobile/gamePointerBoundary.ts:1-7`, `src/ui/mobile/portraitPlayControls.ts:55`, `src/ui/setup/keyboardPassthrough.ts:17`). The camera has 32 non-test `getWorldPoint` call sites (MEASURED). Pinch rollback and tap-vs-drag arbitration depend on Phaser's event order. | High | Medium-high | Re-run the 244 F274 scenarios and the 63 F275 scenario groups on a real iPhone and a real Android phone. Property-test the new screen-to-world maths against Phaser's `getWorldPoint` running headless. Remove each workaround only after a test shows it is no longer needed. | Stage 7 |
| **Context-loss recovery once WAMP owns it.** Today Phaser rebuilds every texture from retained sources, and WAMP has about 0 lines for this (ESTIMATED). Freeing those sources is the main memory win only a port delivers, and phones lose context exactly under memory pressure. Frequency is unknown: loss is logged to the console only (`src/main/webglRecovery.ts:1-2,205-213`). | Medium (unknown) | High | Report `losewebgl`/`restorewebgl` to the server for at least 4 weeks, starting in Stage 1. Make every texture re-derivable. Add a debug mode that poisons released sources. Add a Playwright gate that injects `WEBGL_lose_context` mid-play and in Browse, then diffs screenshots. Kill criterion 7 applies. | Stage 1 (telemetry), Stage 5 |
| **Canvas fallback lane.** `?renderer=canvas` and the AUTO fallback exist (`src/main/query.ts:23-31`), and lighting has its own canvas-disabled path. A shader tilemap needs a separate Canvas2D path, so two renderers must stay in parity. About a dozen smokes force the canvas lane and never exercise WebGL paths. Phaser 4 deprecates Canvas (CITED). | Medium | Medium | Keep today's baked Canvas2D room path as the fallback. Run the goldens on both lanes. Give renderer-sensitive smokes a WebGL variant (Stage 3). Measure how many sessions use the fallback before spending on it. | Stage 3, Stage 5 |
| **Room video and the transparent canvas.** Room video depends on a transparent canvas, an ERASE hole and a per-frame pixel readback at POST_RENDER (`src/roomVideo/frameController.ts:105,240-247,399-450`). An owned renderer that changes context attributes or buffer lifetime breaks it silently. The readback cost is unmeasured. | Medium | Medium | Keep the alpha, premultiplied context and a post-render hook with a readable buffer. Add a room-video golden. Measure the readback in Stage 2. | Stage 2, Stage 5 |
| **Editor coupling.** Test-play wakes OverworldPlayScene (`src/scenes/EditorScene.ts:609-617`), so the editor cannot ship alone. The clear-check fingerprint hashes the serialized room. Two host scenes still duplicate the goal and publish flows (open F279). | High | High | Port the editor last. Finish F279 first. Split the tile document out of TilemapLayer. Add characterization tests for the right-button and pan policies. Round-trip the room export and require byte-identical fingerprints. | Stage 3 (prep), Stage 7 |
| **Debug and smoke harness breaks mid-port.** About 11 scripts with 93 refs reach Phaser internals (MEASURED). The cadence smoke resets the private `world._elapsed` (`scripts/smoke_physics_cadence.mjs:88`). | High if not done first | High: the port loses its own safety net | Move the scripts onto the engine-neutral debug API while still on Phaser (see The engine › Debug and test surface). | Stage 3 |
| **Step-clock move changes feel.** Moving timers, combat and portals off render delta shifts them by up to 1 frame on janky or 120 Hz devices (ESTIMATED). | Medium | Medium | Ship behind a `physicsVersion` bump with the old path behind a test-only flag. Run the cadence smoke at 30-240 Hz and the time-model replay gate. Jonathan's blind A/B on the tight rooms. Kill criterion 8 applies. | Stage 3 |
| **Cross-runtime non-determinism.** Body order follows room-load order. Sword Hunter warm-up has a wall-clock budget (`src/scenes/overworld/liveObjects/swordsmanEdgeWarmup.ts:99`). `Math.hypot` is used 7 times in `rollingBallPhysics.ts` and may round differently in V8 and JavaScriptCore. | Medium | Medium | Run the same trace twice on each runtime as a determinism test. Replace engine-dependent math in sim paths. Keep co-op and PvP out of exact re-simulation. They are already excluded from solo boards (`src/placedObjects/coopPressurePlates.ts:3`). | Stage 3 |
| **Stage 3 data and extraction.** The corpus needs published rooms and recorded clears, which live in production, and agents may not touch production. Server re-simulation needs the step-time logic out of Phaser scenes (25 of 37 `liveObjects/` files import Phaser). | High | Medium | Jonathan provides a weekly read-only room export. Clearing routes only for rooms with recorded clears or Jonathan's picks. 3a replays offline in headless Chromium; the Worker queue waits for the 3b extraction and does not block the gate. | Stage 3 |
| **The "keep Arcade" fallback is bigger than measured.** The 18.8 KB br figure is Arcade World plus dependencies. Arcade's tile collision runs against Phaser Tilemap, TilemapLayer and Tile objects, which may not be in that number. | Medium | Medium | Measure Arcade plus the tilemap collision path headless in Stage 3. Allow a vendored Arcade-plus-tilemap module in Stage 7's exit if physics is killed. | Stage 3, Stage 7 |
| **Scope creep into a general engine.** Fleets write code cheaply, so features creep in. | Medium | Medium | The engine covers only the census surface (Appendix B). No Matter, particles, shaders, Phaser audio or plugin system. Hold the 60 KB brotli ceiling in kill criterion 2 (see Module map and size budget). | All slices |
| **Phaser 3 end of life.** 3.90.0 (May 2025) is the last 3.x tag, and no maintenance or EOL statement was found (CITED). | Medium | Medium | Pin and vendor a custom 3.90 build. The Stage 3 oracles make either a Phaser 4 migration (path B) or the port testable. If 3.x fixes stop, reassess path B at the decision gate. | Decision gate |
| **Human-review bottleneck.** A full port needs about 40-100 h of review, plus about 20 h of play-testing per release candidate across 3-5 candidates (ESTIMATED). Neither number goes down with more agents. | High | High | Build machine oracles before any port code. Keep PRs small. Jonathan reviews gate results and feel-affecting diffs, not every line. Kill criterion 6 caps Jonathan's renderer-slice time at 40 h (see Running it with agent fleets). | All |
| **Measurement gaps.** Every frame number comes from headless SwiftShader or CDP throttling. Memory figures are requested, with residency unknown. There is no JavaScriptCore profile, and the harness's phone path is untested. | Certain today | High: the decision itself could be wrong | Run Stage 2 on one mid-range Android and, best effort, one iPhone, before and after Stage 1. Prove `--cdp` first. Make no port decision without it. | Stage 2 |
| **The gate metric moves the wrong way.** Fixing WAMP's hot spots shrinks the frame, which raises Phaser's share. The gate could open on a fast phone whose frame already fits its budget. | Medium | Medium | Report absolute Phaser ms and p95 next to the share. Jonathan decides whether condition 1 also needs p95 over budget (Open question 4). | Stage 2, decision gate |
| **Agent-generated code quality and review fatigue.** Published agent migrations fail when output volume has no gate. One refactor benchmark reports 5.4% completion, and a model endorsed its own bug 31.7% of the time (CITED). The 112 Phaser mocks encode API shape, so agents can "pass" tests by rewriting mocks. | High | Medium-high | Every PR must pass an oracle that the PR cannot edit. Reject PRs that weaken tests or fixtures. Cap PR size. Use agent review only as a pre-filter. Jonathan spot-checks random merged PRs. | All |
| **Spend overruns.** Stage 3a is 1-2 fleet-weeks and the renderer slice 2-4 (ESTIMATED). How long physics parity takes is unknown. | Medium | Medium | Give each stage a fleet-week budget, reviewed at its gate. Physics parity gets a fixed iteration budget (kill criterion 3). Stop at the decision gate if it does not pass. | Decision gate, Stage 6 |

## Kill criteria

Any one of these stops the named work. Thresholds are set in advance. The real-device conditions use traces from Stage 2, re-baselined after Stages 1-4 (the Stage 4 receipt).

1. **Renderer.** After the Stage 1 fixes, if Phaser JS plus the native work it triggers is under 15% of main-thread play-frame time on the real mid-range Android, and p95 frame time meets budget: do not port the renderer. This is not a second gate; it is the frame-CPU reason ruled out for good (see Delivery plan › Decision gate).
2. **Boot.** If an owned-runtime prototype with parity features is over 60 KB brotli, or saves under 250 ms of time to first game frame on the target phone: drop the boot rationale. When boot is the reason the gate would open, this is judged on the decision gate's size prototype, before Stage 5 starts.
3. **Physics parity.** Stop the physics swap and keep headless Arcade as the sim if either holds:
   - after a fixed iteration budget (for example 2 fleet-weeks), golden-trajectory parity stays under 99.9% of steps within 0.01 px;
   - any replayed top trace from a published room changes outcome (clear, death or finish).
4. **Blind feel test.** If Jonathan tells new from old above chance in a blind A/B test on 2 consecutive release candidates (for example 7 or more correct out of 10 on tight rooms): abandon the physics swap.
5. **Leaderboards.** If replayed top ranked traces show a median finish-time shift over 1 frame (16.7 ms), or any tight room becomes unsolvable: block the release and do not migrate leaderboards.
6. **Jonathan's time.** If Jonathan spends over 40 h on the renderer slice (Stage 5, counted from the decision gate) before its gate passes: stop and reassess. Stage 5's estimate is 20-40 h, so the cap allows about one failed release candidate; that is intended. The ruling's wording ("before the renderer gate passes") is ambiguous, because path E alone budgets 25-45 h before the gate. This reading matches the Stage 5 budget, and Jonathan should confirm it.
7. **Context loss.** If the new engine fails the injected `WEBGL_lose_context` screenshot-diff gate, or field telemetry shows its restore path failing: block the release.
8. **Step clock.** If the Stage 3 step-clock change cannot pass the cadence smoke without changing feel on Jonathan's list: keep render-delta timers and treat exact re-simulation as out of scope.

## Open questions

**For Jonathan**

1. **What inspired the port?** The @ggsimm post could not be read from this session. Their public work found is shader and graphics tooling, not a game engine or benchmark (CITED). Jonathan should share the post or say what specifically inspired them: a technique, a number, a library or a way of working. The answer may change which gains matter.
2. **Is boot a product priority?** Decision-gate condition 2 depends on the answer.
3. **Which devices, and is there a Mac?** Which mid-range Android (Adreno or Mali) and which iPhone will Stage 2 use, and is there a Mac for Safari Web Inspector?
4. **Should gate condition 1 also require p95 over budget?** A share can reach 20% on a frame that already fits its budget (see Delivery plan › Decision gate). Also confirm that below 15%, the boot or context-loss condition can still open a renderer slice scoped to that reason.
5. **How many hours a week can Jonathan give this?** The calendar estimates assume 5-10 h.
6. **Kill criterion 6.** Confirm that the 40 h cap counts only Stage 5 time from the decision gate.
7. **How many published rooms are "tight"?** That is, how many rooms would a 1 px or 1-step change break? The answer sizes the golden corpus and Jonathan's play-test list.
8. **Will players notice timers moving onto the step clock?** The shift is up to 1 frame on janky or 120 Hz devices. Does it need a leaderboard version split?
9. **Leaderboard policy for a deliberate feel change.** If Jonathan ever wants a feel change on purpose, are old boards frozen as their own version?

**Measurement gaps (Stage 2)**

10. **Does the multi-texture shader matter on real phone GPUs?** It costs 2x on SwiftShader. Does it matter on Adreno, Mali or Apple GPUs, and does `maxTextures=1` fix it?
11. **How much FX and bitmap memory is really resident?** The FX render targets request 25 MB extra at phone portrait and 357 MB at 1080p (MEASURED, requested, residency unknown). Retained ImageBitmaps add more. How much of this is resident on iOS Safari and Android drivers?
12. **How often does WebGL context loss happen in production?** There is no telemetry. The answer decides whether freeing texture sources is safe and worth doing.
13. **Is Phaser's per-frame JS cost higher on JavaScriptCore than in V8?** Every CPU profile so far is Chromium.
14. **What does the room-video readback cost on a phone?**
15. **What does `useTree:false` do?** It removes 35-250 µs per step (MEASURED). Does it change Arcade results anywhere outside the 9 cadence fixtures?
16. **How many sessions use the Canvas renderer, by choice or through the AUTO fallback?** This decides how much the fallback lane should cost.
17. **How big is a custom Phaser 3 build?** The 50-60 KB brotli saving is an esbuild-metafile estimate, not a built bundle. It sets the baseline for the port-only boot gain.
18. **How big is headless Arcade with its tilemap collision path?** Stage 3 measures it. It prices the "keep Arcade" fallback.

**Outside the measurements**

19. **How long will Phaser 3 get fixes?** v4 is now the main line, and no EOL statement was found.
20. **Is there an independent Phaser 3 vs 4 benchmark?** None was found. Phaser 4's performance claims are vendor-only and came from search snippets.
21. **Should a port merge the editor and Play paint paths?** The editor draws visible TilemapLayers. Play draws a baked room canvas. Merging them could change what builders see.
22. **How far can exact re-simulation go?** It depends on cross-runtime math (V8 on the server, JavaScriptCore on iPhones) and on the wall-clock Sword Hunter warm-up. Is device-dependent planner readiness acceptable, or must it move onto the step clock?

**Resolved, for the record.** The brief said 208 files import `phaser`. Recounts found 182-185 non-test files, about 90k LOC. Use about 185. The conclusions do not change.

## Appendix A: Port surface by subsystem

All counts are at main @ 24e3626. They come from `git ls-files`, `grep` and `wc -l` over non-test `.ts` files (MEASURED unless tagged). Each map used its own regex for "lines that touch Phaser", shown in the table. Scopes overlap: for example, `chunkPreviewRenderer.ts` and `fullRoomPresenter.ts` appear under both world rendering and assets. So the rows do not add up to the totals.

The `Arcade.Body` count differs by regex: 208 with the census regex (`Arcade.Body`) and 213 with the play-sim regex (`Physics.Arcade.Body`, including qualified type references). This PRD uses 213.

| Subsystem | Non-test LOC | Files importing `phaser` | Lines touching Phaser (method) | Port difficulty | What changes | What stays |
|---|---|---|---|---|---|---|
| World rendering and streaming (full rooms, chunk previews, world-tile pyramid, backgrounds, lighting, weather) | 25,515 in 79 files | 19 (15,893 LOC) | 526 in 20 files, plus 61 in OverworldPlayScene.ts. Grep for `Phaser.*`, `scene.add/make/textures/tweens/cameras/physics` and common GameObject setters. | Medium. The hidden collision tilemap is hard, but it belongs to physics. | About 2-4k LOC (ESTIMATED): display parts of fullRoomPresenter, worldTiles/phaserLayer.ts, chunk image management, backgrounds/runtime.ts, starfield, the backdrop camera, lighting, weather, specialTiles texture refresh, staticCanvasTexture.ts. | About 20k LOC: scheduling, LOD, manifests, LRUs, frame coordinator and Canvas2D painters. |
| Play simulation (Arcade, movement, live objects, slopes, cadence, ghosts, traces) | About 33,170 in the 54 files that mention Arcade APIs (criterion: `Physics.Arcade`, `physics.add`, `playerBody`, `.body as`, `.blocked.`, `.touching.`) | Not counted per file for the whole slice. liveObjects/: 25 of 37 files (9,263 LOC). | Arcade surface: 213 `Arcade.Body`, 87 `blocked.`, 54 `touching.`, 37 collider/overlap calls, 19 `updateFromGameObject`, 12 prev/prevFrame | Very hard | Either a drop-in solver that matches Arcade quirks exactly (3-5k LOC engine, ESTIMATED), or an engine-agnostic core that rewrites most of the 33k LOC. Plus the frame pipeline and tests. | Already engine-free: src/runs, src/goals, src/enemies planner, rollingBallPhysics.ts, server verification. |
| Presence, PvP and ghost rendering | presence.ts 1,256; multiplayerRemotePlayerRenderer.ts 464; ghostRace.ts 156 (all in `src/scenes/overworld/`) | Not counted separately | Sprites, stroked Text labels, Rectangles, Graphics, Containers, `setTintFill` | Medium | Owned sprites, glyph labels with stroke, rects and tint-fill in the batcher | Presence networking, PvP rules, ghost data |
| Editor (room editor, Expanded Room editor and composer, autotiling, courses, music pattern overlay) | About 46.4k (33,958 of scene code) | 31 (20,176 LOC) | 1,072 lines. Regex for Phaser tokens, tile ops, Graphics, camera, scene and pointer calls. About 1.5-3k actually change (ESTIMATED). | Medium for code. Hard to ship alone, because test-play needs the gameplay port. | Tile layer adapter, Graphics overlays (including the music pattern editor), camera, pointer seam (workspaceDrawing.ts, editorTouch.ts, touchGesture.ts, inspectorCore.ts), two host scenes, the room-video editor hook | Autotiling (7,882), courses, expandedRooms, agentBuilder, DOM editor UI in src/ui |
| Boot, assets, textures, memory, context loss | About 33.3k in about 135 files | 31 (about 13.6k LOC, 9 type-only) | About 411. Grep for `Phaser.`, `textures.`, `load.`, `add.`, `cameras.`, `renderer`, `setDepth`, `setTexture`, `game.`. | Medium. Context restore is hard. | About 60 texture create and remove sites, BootScene loader (450 LOC), runtime avatar loads, TileSprite and background code (about 600), world-tile layer (about 500), plus a new context-restore contract (0 lines of WAMP code today) | roomImage, performance, settings, avatars, most of worldTiles, earlyWorldTileBootstrap.classic.ts, recovery policy logic |
| Platform I/O (input, audio, DOM bridge, resize, lifecycle) | 53,161 in 212 files | src/ui: 31 (10 type-only). audio, music, presence, chat, settings and performance: 0. | 294 in 45 files. Regex for `Phaser.`, `game.(scene\|events\|loop\|input\|scale\|canvas\|renderer)`, `scene.(input\|events\|scale\|time\|game)` and similar. | Medium-hard. The code is small but the time model and lifecycle are deep. | About 1,100 LOC (ESTIMATED): frameCadence.ts, renderLoopRecovery.ts, webglRecovery, the loop and resize parts of main.ts, keyboardFocus, physicsCadence, and the pointer handlers in inspectInput, editorTouch and editor/interaction | Shared audio engine, music, presence, chat, uiBridge.ts, hud.ts |
| Server and offline rendering, plus the test harness | About 8.6k of rendering code | 0 | Client painters: about 6 call sites in roomSnapshotTexture.ts and 29 refs in chunkPreviewRenderer.ts. About 11 scripts with 93 refs reach Phaser internals. | Easy for rendering. Medium for re-pointing the harness. | Smoke scripts move onto the engine-neutral debug API. Mocks are rewritten only where a module's engine API changes. | roomImage, worldTileRenderer, mapScreenshot, the equivalence harness (61 tests, 9 s), the sha256 renderer pins |
| Whole-repo census | 279,381 in 1,167 files | 185 (90,082 LOC; 64 type-only, 15,051 LOC). src/cloudflare: 0 of 242. | 4,190 direct (5.3% of 79,284 code lines). About 7,400 counting Phaser-typed variables (9.3%). | n/a | n/a | About 75-80k of the 90k LOC in importing files is engine-agnostic (ESTIMATED) |

**Totals**

- **Files and LOC.** About 182-185 non-test files import `phaser`, about 90k LOC (MEASURED; counts differ by regex: 182, 183 and 185).
- **Lines that touch Phaser.** About 8-15k, inside about 120 files (ESTIMATED). Grep finds 4,190-7,400 directly. Objects reached through getters and host interfaces escape the regex, which raises the estimate.
- **Tests.** 112 of 741 test files use `vi.mock('phaser')` with hand-written fakes, and 121 import or mock it (27,440 LOC) (MEASURED). None load real Phaser, because Phaser cannot load in vitest's node environment.
- **New engine code.** About 8-15k LOC (ESTIMATED): grid physics with slopes 2-4k; WebGL batcher plus Canvas fallback 2-4k; scene, lifecycle and loop 0.5-1k; camera, input, loader and textures 1-1.5k; bitmap text 0.5-1k; tween, timer, animation and math 0.5k.

## Appendix B: Phaser API census

Counts are non-test references or calls (MEASURED, census grep at main @ 24e3626). "Keep" means keep the semantics in a new implementation. "Helper" means replace with a small WAMP-owned module. Helper sizes are ESTIMATED.

| API family | Usage | WAMP engine | Notes |
|---|---|---|---|
| Arcade physics | `Arcade.Body` 208-213 (census and play-sim regexes differ); StaticBody 8; Collider 8; StaticGroup 4; Group 3. `physics.add.collider` 25, `overlap` 12. Body members: `velocity` 59, `blocked` 56, `touching` 49, `onFloor` 12. | Keep the semantics | Purpose-built AABB-vs-16 px-grid solver with slopes. It must copy blocked/touching/onFloor meaning, separation order and the fixed 60 Hz step. This is where most of the parity cost sits. |
| Tilemaps | Tilemap 7, TilemapLayer 20, Tile 9, Tileset 5. 68 put/remove/getTileAt and createLayer calls in 7 files. | Helper: a Uint16 grid per 40x22 layer | Hard only because collision and special tiles are tied to Tile objects. Play keeps the layer invisible (`src/scenes/overworld/fullRoomPresenter.ts:252`). |
| Scenes and lifecycle | 5 scenes. `Phaser.Scene` 146 refs. About 90 sleep/wake/run/stop calls. About 60-75 lifecycle listeners. | Helper: a scene/state manager, 300-600 LOC | Lifecycle order must be explicit and documented. Scenes are god-objects today. |
| Display list | Sprite 56, Rectangle 42, Text 34, Container 26, Image 25, TileSprite 11. `setDepth` 125 calls in 49 files. `setOrigin` 72. `setTintFill` 2. | Helper: a retained quad list with a stable depth sort | Ties fall back to insertion order, as in Phaser. TileSprite becomes a repeat-UV quad. Text becomes a bitmap pixel font with stroke and shadow variants. |
| Graphics | 98 type refs, 47 `add.graphics`, 301 draw calls in 44 files | Helper: a batched rect/line/triangle API that can bake to a texture | Mostly editor overlays (F309) and the music pattern editor |
| Textures and loader | `textures.exists` 90, `get` 9, `remove` 9, `addCanvas`/`createCanvas` 23 sites. Loader in 4 files, plus runtime avatar loads. | Helper: a texture registry that takes ImageBitmap or canvas, with explicit upload and dirty calls. Loading via `fetch` plus `createImageBitmap`. | Keeps the `?v=` asset-hash rewrite (`src/assets/sceneAssetVersions.ts:7-21`) |
| Input | Pointer 101 type refs, 21 `input.on` subscriptions, `activePointer` 15, keyboard 10 | Helper: canvas-scoped Pointer Events, about 200 LOC | Gameplay keys and gamepad already bypass Phaser (`src/scenes/overworld/keyboardInput.ts:19-20`, `gamepadInput.ts:13-91`) |
| Cameras | `cameras.main` 149, `cameras.add` 1 (the backdrop camera), `getWorldPoint` 32, `zoom` 23, scroll 24, shake/flash/fade 7 | Helper: a camera struct (scroll, zoom, roundPixels, shake), about 150 LOC, plus a screen-space backdrop layer | Must match Phaser's zoom-about-centre transform exactly |
| Game, TimeStep, renderer, scale | `Phaser.Game` 75, `game.canvas` 40+, `scale.width/height` 33 | Helper: own rAF loop, ResizeObserver, WebGL2 renderer plus 2D fallback | The time model must replay identically (see Time model and loop). The canvas stays transparent for room video. |
| Animations | `anims.create` 12, `exists` 14, `play` about 25 | Helper: a frame-index helper, about 100 LOC | Remote avatars register animations at runtime |
| Tweens and time | `tweens.add` 9, `delayedCall` 10, `time.now` 19 | Helper: tween and timer, about 150 LOC | Mechanics already avoid Phaser's Clock (`gameplayClock.ts:11`) |
| Math, Geom, Color | `Math.Clamp` 97, `Geom.Rectangle` 101, `Vector2` 22 | Helper: a math module, about 100 LOC | Can be codemodded before any port |
| EventEmitter | 1 direct; events on/once/off 41/31/49 | Helper: about 50 LOC | |
| Sound, Gamepad plugin | 0 | Drop | `audio: { noAudio: true }` (`src/main.ts:96`) |
| Matter, particles, lights, masks, registry, FX pipelines | 0 used | Drop | FX pipelines are on by default but unused. Turning them off is a Stage 1 fix (`src/main.ts:88-122`). |

**Known workarounds and private-API accesses**

| Where | What it does |
|---|---|
| `src/main.ts:137-150` | Casts `game.loop` to reach `running`, `wake` and the `raf` internals |
| `src/main/frameCadence.ts:71-93` | Replaces `game.loop.raf.start` to skip frames on 120/240 Hz screens |
| `src/main/renderLoopRecovery.ts:60-65` | Restarts a dead rAF chain after a callback throws |
| `scripts/smoke_physics_cadence.mjs:88` | Resets the private `world._elapsed` (test only) |
| `src/scenes/CourseEditorScene.ts:1621-1624` | Reads the private `camera.matrix` |
| `src/scenes/overworld/backdropController.ts:184-215` | Adds an unzoomed backdrop camera, reorders `cameras.cameras` and replaces `cameras.getVisibleChildren` |
| `src/roomVideo/frameController.ts:228-234` | Makes every non-main camera ignore the video hole and handles |
| `src/scenes/overworld/liveObjects/npcNameLabel.ts:104-119` | Quantizes Text pixels, then re-uploads through `renderer.canvasToTexture` |
| `src/visuals/staticCanvasTexture.ts:10-15` | Uses `addImage(canvas)` to dodge CanvasTexture's readback copy (F304) |
| `src/roomVideo/sceneHooks.ts:54-70` | Patches scene `update` on the prototype |
| `src/scenes/overworld/liveObjects/animationReadiness.ts:45-88` | Guards against animation keys that have no frames |
| `src/scenes/overworld/cameraController.ts:220` | Works around `startFollow`/`setDeadzone` recentring |
| `src/scenes/overworld/worldStreaming.ts:3316` | Works around `worldView` being stale after `setZoom` |
| `src/scenes/OverworldPlayScene.ts:4779` | Waits for scene starts that Phaser queues during a frame |
| `src/scenes/CourseEditorScene.ts:3122` | Guards against layers already destroyed at SHUTDOWN |
| `src/assets/sceneArt.ts:74` | Relies on Phaser's loader state values |
| `src/scenes/editor/musicLabelStyle.ts:10` | Avoids Text redrawing on an unchanged `setColor` |
| `src/ui/mobile/gamePointerBoundary.ts:1-7`, `portraitPlayControls.ts:55`, `src/ui/setup/keyboardPassthrough.ts:17` | DOM workarounds for Phaser's window-level listeners and `preventDefault` |
| F353 | The app's `setFilter` calls on TileSprites only touch the dead texture. NEAREST actually comes from `pixelArt`. |

## Appendix C: Glossary

| Term | Meaning |
|---|---|
| MEASURED | Measured in this study: by grep or `wc` on the repo, a CDP profile, a benchmark or a node run. Each one keeps its conditions, for example "headless SwiftShader" or "4x CPU throttle". |
| CITED | Taken from a named source: a review item (F-number), a repo doc or a public page. Not re-measured here. |
| ESTIMATED | Derived or judged from measured or cited inputs. The arithmetic or basis is shown next to it. |
| Stage 1-7 | The delivery stages: 1 Quick wins, 2 Real-device baselines, 3 Phase 0 oracles (3a oracles and step clock, 3b server re-simulation), 4 Owned paths inside Phaser, then the decision gate, then 5 Renderer slice, 6 Physics slice, 7 Retire Phaser. |
| Phase 0 | The ruling's name for the oracle and step-clock work. In this PRD it is Stage 3. |
| Decision gate | The measured check after Stage 4 that decides whether path C (Stages 5-7) opens. |
| Oracle | A trusted reference that decides automatically whether new behaviour matches old. Examples: headless Arcade for physics, Phaser frame captures for pixels. |
| Golden corpus | A stored set of reference outputs. Here, per-step x, y, vx, vy, blocked and touching from headless Arcade over every published room, with scripted and recorded inputs. A candidate must reproduce it. |
| Step clock | Game time counted in fixed 1/60 s physics steps instead of summed render-frame deltas. Stage 3 moves timers, combat, portals and objectives onto it. |
| physicsVersion | A field in run traces and ghosts that names the sim rules a run used. Records from different versions are not compared. |
| Extern game object | A Phaser 3 object whose `render` call draws with raw GL inside Phaser's display list. Stage 4's tilemap uses it. |
| Release candidate | The build that enters rollout for a slice. Jonathan play-tests it once, before 1%. |
| Strangler port | Replacing a system piece by piece behind seams while the old one keeps running, until nothing calls it. Here: renderer slice first, physics last (path C). |
| Fleet | A group of AI coding agents working in parallel on scoped tasks, each gated by an oracle. |
| Fleet-week | 5 working days of one fleet, about 2-3 concurrent agents × 8 h a day (80-120 agent-hours). A wall-clock unit, not a spend unit. |
| Parity | New behaviour matches old within a stated tolerance: 0 px for tiles, 0.01 px per physics step, and Jonathan unable to tell them apart in a blind test. |
| SwiftShader | Chromium's CPU-based software GPU, used in headless runs. Its frame rates and memory commits do not predict real phone GPUs. |
| brotli | The compression format used to measure shipped JS size, written "KB br". The 672 KB boot JS figure is brotli. |
