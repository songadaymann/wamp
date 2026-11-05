# Would leaving Phaser make WAMP much faster?

**Status:** 2026-11-04 · main @ 24e3626 · **Verdict: mostly no** (medium confidence) · Plan: [wamp-engine-prd.md](wamp-engine-prd.md)

## Short answer

- **Mostly no** (medium confidence). A port off Phaser 3 would not make WAMP much faster to play. Phaser's JS plus the GL and canvas work it triggers is about 21-22% of main-thread play-frame CPU: 2.1 of 9.6 ms at 1x and 14.9 of 71.5 ms at 4x CPU throttle (MEASURED, headless SwiftShader, phone viewport). WAMP's own code costs 2-3x as much: 6.4 ms at 1x. Draw calls are already low, at 7.3 per frame.
- **Most of the big wins don't need a port.** Phone memory, room-entry hitches, battery and the FX boot cost all have small fixes on Phaser 3 or in WAMP's own code, each tens to hundreds of lines. About 7 ms of Phaser's 14.9 ms at 4x is TileSprite construction, which a subclass removes.
- **The hunch is right on three moderate gains, and only a port gets them:** about 110-150 KB brotli of boot JS (16-22% of 672 KB), about 5-11% of play-frame CPU once the fixes are in, and freeing the CPU copies of textures already uploaded to the GPU (tens of MB on phones). All three are ESTIMATED.
- **Agents make the code cheap, not the checking.** The oracles that would prove a port matches today's game (step-indexed traces, golden trajectories, live-frame goldens) don't exist yet. Jonathan's review and play-testing can't run in parallel. Path E costs Jonathan about 25-45 h up to a decision; path E plus a full port about 105-205 h (ESTIMATED).
- **What to do: path E.** Fix first, build the oracles, then decide at a measured gate on a real mid-range Android. Port the renderer first and physics last, and only if the gate passes.
- **Biggest gap: no real phone was measured.** Every frame number here comes from headless Chromium. The gate could go either way: after the fixes, Phaser's share is projected at about 14% on the 4x proxy and 20-28% on the 1x proxy (ESTIMATED; see What to do).

## What we asked

Jonathan asked for a PRD for moving WAMP off Phaser onto an engine the project owns. The idea came from an engine builder on X (@ggsimm, gsimone, a pmndrs contributor). The post itself couldn't be read from this session. Field research found that their public 2025-2026 work is shader and graphics tooling (for example TypeGPU shader ports), with no public game engine or performance claim (CITED).

Before writing the PRD we tested Jonathan's hunch: is a port huge, but worth it for huge performance gains? We judged it the way "Claude ultracode" work runs, where fleets of agents write the code. Under that model, writing code is cheap. The real costs are verification, behaviour parity, and Jonathan's time for review and play-testing.

## How we checked

1. **Code maps of 7 subsystems.** World rendering and streaming, the play simulation, the editor, assets and memory, platform I/O, server rendering and verification, and a census of Phaser API use. Each map lists Phaser coupling, perf observations tagged by cause (Phaser, WAMP code, browser or platform, mixed), port size and parity risks.
2. **A CDP profile of the real app.** Headless Chromium ran a build of main @ 24e3626 behind the repo's hermetic API replay (`scripts/lib/smokeApiReplay.mjs`; 49 requests served, 0 misses). It used a 390x844 phone viewport at DPR 2 with touch, the same context as `scripts/runtime_performance_trace.mjs:293-302`. Throttle was 1x and 4x CPU. We profiled 20 s of scripted play, 15 s of panning the zoomed-out map, and boot.
3. **A throwaway minimal-engine benchmark.** A WebGL2 floor engine of about 3 KB brotli ran against Phaser 3.90 on a synthetic scene shaped like WAMP: 3x3 full rooms built the way `fullRoomPresenter.ts` builds them, a 7x7 preview ring and a HUD. It measured per-frame JS, draw calls, init, bundle size and heap, plus a `maxTextures` check.
4. **Field research** with sources: Phaser 4, PixiJS 8, WebGPU reach on phones, engine-swap case studies, minimal engine sizes, and agent-driven migrations.
5. **An advocate, a skeptic and a judge.** Each wrote a brief from the same evidence. The judge's ruling is the source for the conclusions here.

**The big caveat.** Headless Chromium draws with SwiftShader, a GPU emulated on the CPU. Its GPU process used 2.4-2.9 cores while WAMP played at 24-34 fps. A bare WebGL page drawing 8 full-canvas quads already used 3.2 cores (MEASURED). So no fps or GPU-side number in this report says anything about phones. Only CPU shares and call counts carry over. CDP's 4x throttle is a pessimistic stand-in for a low-end phone, because it also slows the browser's own work.

## Where the frame time goes today

Main-thread CPU per play frame, from the CDP profile of the real app (MEASURED, phone viewport, headless SwiftShader):

| Bucket | 1x (ms/frame) | 4x (ms/frame) |
|---|---|---|
| Phaser JS (self time) | 1.3 | 6.3 |
| Native work Phaser triggers (GL, canvas) | 0.8 | 8.6 (about 7 is TileSprite construction) |
| WAMP JS (self time) | 3.5 | 18.4 |
| Native work WAMP triggers | 1.4 | 5.3 |
| Style recalc (mostly DOM UI) | 1.5 | 8.6 |
| Other: unattributed browser work, GC, profiler overhead | 1.1 | 24.3 |
| **Total main-thread CPU** | **9.6** | **71.5** |

The "Other" row is derived: 9.6 − 8.5 = 1.1 and 71.5 − 47.2 = 24.3. Native time is charged to the nearest JS caller, so the line between Phaser and WAMP is approximate.

- **Phaser's share.** Phaser JS self time is 9-14% of the frame. Adding the native work Phaser triggers gives 2.1 of 9.6 ms at 1x and 14.9 of 71.5 ms at 4x, about 21-22% (derived).
- **WAMP's share.** WAMP's own cost is about 3x Phaser's at 1x (6.4 vs 2.1 ms) and about 2x at 4x (32.3 vs 14.9 ms) (MEASURED; ratios derived).
- **Upper bound for any engine.** Even a zero-cost engine would remove only 10-20% of frame CPU (ESTIMATED from the shares above).

**Top WAMP hot spots** (self time over the 20 s window, MEASURED):

| Code | What it does each frame | 1x play | 4x play |
|---|---|---|---|
| `src/scenes/OverworldPlayScene.ts:3184` | `getMobilePortraitUnobstructedHeight` builds its cache key from `window.innerWidth/innerHeight`, which forces a style read every frame | 527 ms | 1,406 ms |
| `src/analytics/replay/canvasCapture.ts:2` via `src/bugReports/recentReplay.ts:28` | The bug-report replay calls `createImageBitmap` on POST_RENDER | 305 ms | 309 ms |
| `src/ui/modalState.ts:49` via `keyboardFocus.ts:93` and `keyboardInput.ts:58` | `hasBlockingModalOpen` runs `querySelectorAll` on every keyboard update | 248 ms | 663 ms |
| `OverworldPlayScene.ts:3201` (F262) | `getBoundingClientRect` in the camera-tuning snapshot | small | 84-96 ms |
| `src/scenes/overworld/hud.ts:1277` | `updateGoalPanelDockPosition` (DOM HUD) | 16 ms (149 ms in the map scenario at 1x) | not listed |

In WAMP's own profiler, `stream.frameWorkCoordinator` hits p95 92 ms and max 149 ms at 4x (MEASURED).

**TileSprite bursts.** At 4x, about 7 ms per frame of Phaser-triggered native time comes from building TileSprites while room backgrounds stream in. The chain is `src/backgrounds/runtime.ts:160` ← `fullRoomPresenter.ts:480` ← `worldStreaming.ts:4166`. Phaser 3.90's TileSprite allocates its own canvas per instance plus a power-of-two fill canvas, then uploads both (`TileSprite.js:181,277,470`; F353, F357). Uploads come in bursts: 82 uploads (121 MB) per 20 s at 1x and 139 (208 MB) at 4x, up to 8 in a single frame (MEASURED). This is Phaser behaviour, and a subclass fixes it without a port.

**The synthetic bench agrees on the ratio, not the share.** On the WAMP-shaped scene, Phaser cost 1.24 ms/frame at 1x and 5.34 ms at 4x. The floor engine cost 0.16-0.18 ms and 0.79-0.91 ms (MEASURED, 6-9x cheaper). But the floor engine has no depth sort, text, tweens or Arcade semantics, so a parity engine would sit between the two. The bench's "25-35% of frame JS" estimate divided a synthetic cost by an 11.7 ms span measured on another machine (CITED). The real-app profile supersedes it.

## Boot

Boot JS at main @ 24e3626 (CITED: vite build, `scripts/check_bundle_budget.mjs`):

| Chunk | Brotli | Share |
|---|---|---|
| phaser-vendor (1,077 KB raw) | 231.9 KB | 34.5% |
| app main | 369.2 KB | 54.9% |
| everything else (derived: 672.0 − 231.9 − 369.2) | 70.9 KB | 10.6% |
| **Total boot JS** | **672.0 KB** | |

- **Phaser can't be tree-shaken today.** `vite.config.ts:44` aliases `phaser` to the prebuilt `phaser-arcade-physics.js`. The editor is already lazy-loaded (`editorSceneLoader.ts:10-20`), so it adds nothing to boot.
- **Module evaluation is split evenly.** phaser-vendor takes 127-213 ms at 1x and 671 ms at 4x. App main takes 103-167 ms and 693 ms (MEASURED). Over boot as a whole, CPU self time is about 23% Phaser and 25-29% app chunks.
- **Asset preload dominates.** BootScene preload takes 1.4-2.4 s at 1x and 6.0 s at 4x (MEASURED). That is image fetch, decode, upload, and WAMP's palette and thumbnail work, and any engine would still have to do it. First game frame lands at 2.2-3.7 s at 1x and 9.0 s at 4x on localhost, with about 1.6x variance between runs. Phaser eval overlaps the 750-1400 ms coarse-map gate, and the coarse map has already painted by then (`coarseFirstStartup.ts`; F316). So players notice less than these numbers suggest.
- **The FX pipelines are a free win.** WAMP uses no preFX or postFX (0 hits in src), but `src/main.ts:88-122` never sets `disablePreFX` or `disablePostFX`. Turning both off cut first render from 144 to 85 ms at 1x and from 358 to 206 ms at 4x, and removed 20 shader programs (MEASURED, SwiftShader).
- **A custom Phaser 3 build** that drops sound, particles, FX and light pipelines, mesh, rope, nineslice, DOM, video and unused loaders saves about 50-60 KB brotli and about 25% of Phaser eval (ESTIMATED from an esbuild metafile).
- **What only a port gets.** An owned runtime of 15-50 KB brotli (ESTIMATED; reference points twgl at 9.3 KB and Kontra at 12.0 KB brotli, MEASURED) would save 110-150 KB brotli beyond the custom build. On top of the FX flags and the custom build, it saves a further 0.1-0.17 s at 1x and 0.35-0.55 s at 4x, about 4-6% of time to first game frame (ESTIMATED).
- **Phaser 4 is bigger.** Its arcade build is 250.0 KB brotli against 220.9 KB for the 3.90 npm dist build, 29 KB more (MEASURED from npm tarballs). WAMP's phaser-vendor chunk is 231.9 KB because Vite rebundles the dist file.

## Memory

| Item | Size | Cause | Fix without a port? |
|---|---|---|---|
| Texture source pixels in play | 93-123 MB across 322-336 textures (MEASURED, CPU-side width × height × 4) | WAMP assets | Yes: asset work |
| Player atlas (1344x4032, 98% empty) | 21.7 MB of source pixels (MEASURED), plus about 21 MB per extra avatar (CITED F317, which puts the atlas at 26 MB of graphics memory) | WAMP asset | Yes: repack used frames (F317), evict remote avatars |
| Chunk-preview canvases | 3.6 MB each (MEASURED); cache ceiling about 128 MB (ESTIMATED) | WAMP design | Yes |
| TileSprite hidden copies | 2.86 MB GPU + 0.86 MB heap per sprite (MEASURED); 48-55 MB per Forest room, 50-150 MB on phones in Forest areas (CITED F353) | Phaser 3 | Yes: shared-pattern subclass, 150-300 LOC |
| FX render targets | 43 vs 18 MB at 390x844; 468 vs 111 MB at 1080p (MEASURED as requested; resident share unknown) | Phaser default | Yes: 2 config flags |
| Retained CPU sources for context restore | Up to 40 MB (reduced profile) or 96 MB (desktop) of world-tile ImageBitmaps; about 0.9 MB per room layer (ESTIMATED) | Phaser design (`TextureSource.js:51`, `WebGLTextureWrapper.js:211-238`) | Partly: about 30 LOC for world tiles; a clean, general fix needs owned texture lifetimes |

**The FX numbers are requests, not proof of resident memory.** SwiftShader commits memory lazily: its process memory grew by about 25 MB, not 357 MB, at 1080p. We don't know how much real drivers keep resident. Retained ImageBitmaps behave differently from browser to browser.

**Freeing the CPU copies is the one memory win that clearly favours an owned engine.** Its real size on devices is unmeasured. Context loss is logged to the console only, so nobody knows how often it happens in production. Without that number we can't say whether dropping the restore copies is safe.

## GPU and draw calls

- **Draw calls are already low.** A play frame makes 7.3 draw calls, about 1,150 quads, 2 vertex uploads (194 KB) and 4 program switches. The zoomed-out map makes 16 draws for about 3,700 quads (MEASURED).
- **Phaser batches better than the floor engine.** In the bench, Phaser made 1-3 draws per frame against 4-12 for the floor engine (MEASURED). Draw calls are not where Phaser loses.
- **Multi-texture shader.** Phaser's fragment shader branches on texture id per pixel. On SwiftShader it doubled the bench frame interval: 68.5 ms, against 29.5-32.3 ms with `maxTextures: 1` (draws rose from 3 to 38) (MEASURED, synthetic). The size of this effect is specific to SwiftShader. WAMP doesn't set `render.maxTextures` (0 hits in src). Testing that one line on a real mid-range Android and an iPhone is the cheapest GPU experiment available.
- **Fill is already small.** The canvas is sized in CSS pixels (`src/main.ts:88-117`), which keeps fill at 1/DPR² of a device-pixel canvas.

## Gains by area

"After a port" is measured against a build that already has the cheap fixes. The 5-11% frame-CPU figure is 0.7-1.0 ms of about 9 ms at 1x and 3-4.5 ms of about 62 ms at 4x (ESTIMATED: Phaser's share minus a parity engine at 30-50% of Phaser's cost).

| Area | Today | After a port | Gain | Needs a port? | Cheapest path |
|---|---|---|---|---|---|
| Play frame CPU | 9.6 ms at 1x, 71.5 ms at 4x (MEASURED) | −0.7-1.0 ms at 1x, −3-4.5 ms at 4x after fixes, 5-11% (ESTIMATED) | Small | Yes, for the last 5-11% | TileSprite subclass (F353); innerWidth key, querySelectorAll and replay capture fixes; cut HUD style recalc; `useTree:false` after the cadence smoke passes |
| Phone GPU / fill | Unmeasured on real GPUs | Unknown, probably small | Small | No | `maxTextures` test plus real-device GPU traces |
| Boot JS size | 672 KB br; Phaser 231.9 KB (CITED) | −110-150 KB br beyond a custom build (ESTIMATED) | Moderate | **Yes** | Custom Phaser 3 build first (−50-60 KB br) |
| Boot CPU / first frame | 2.2-3.7 s at 1x, 9.0 s at 4x (MEASURED) | −0.1-0.17 s at 1x, −0.35-0.55 s at 4x after flags and build (ESTIMATED) | Moderate | **Yes**, for the last part | FX flags (−60/−150 ms); preload: F317 repack, drop unused WeaponsSheet, defer non-boot art |
| Memory: hidden copies | TileSprite 48-55 MB per Forest room (CITED); FX RTs requested | About 0 | Large | No | TileSprite subclass plus 2 FX flags |
| Memory: retained CPU sources | Up to 40/96 MB of ImageBitmaps (ESTIMATED) | Roughly half of CPU-side memory for these textures (ESTIMATED) | Moderate | **Yes**, for a clean fix | Close ImageBitmaps after `addImage`, remove on `losewebgl` (about 30 LOC) |
| Memory: assets | 93-123 MB of source pixels | Unchanged | None | No | F317 repack (cuts 85-90%) |
| Room-ready / hitches | About 36 phone frames per uncached room (CITED F312); brick re-bake 58.7 ms (MEASURED headless) | Index-texture tilemap: upload 1.6 → 0.2 ms, brick 0.36 ms (MEASURED) | Large | No | One-cell brick patch; per-room chunk frames; F312 EWMA; optional index-texture tilemap inside Phaser |
| Battery / heat | Full-rate redraw behind menus, when paused and when idle | About 92% fewer frames behind menus, about 50% fewer when idle (CITED F356) | Large | No | Add paused, modal and idle inputs to `src/main/frameCadence.ts:71-93` |
| Determinism / server re-sim | Plausibility checks only | Exact re-simulation possible (ESTIMATED 0.2-0.7 s CPU per 60 s run) | Large | No | Stage 3 (Phase 0) on Phaser: step clock, step-indexed input log, `physicsVersion` |
| Test fidelity | 112 of 741 test files `vi.mock('phaser')` | DOM-free core runs for real in vitest | Moderate | Partly | Headless Arcade in tests; engine-neutral debug API |
| Input / lifecycle | About 8 DOM workarounds, two resize systems | Fewer bugs, no speed gain | Small | No | `input.windowEvents:false`, `Scale.NONE` |
| Editor | Lazy-loaded; findings are WAMP code, DOM or CSS | Near-zero tile cost for live cells | Small | No | Bake idle Expanded Room cells |
| Server rendering | No Phaser on any server path | No change | None | No | Separate work (roomImage raster for world tiles) |

## Where the hunch is right

- **Boot JS is real and only a port fully fixes it.** Phaser is a third of boot JS in a form that can't be tree-shaken. Phaser 4 makes it worse, not better.
- **Phaser 3 does cause some large costs:**
  - TileSprite keeps per-instance canvases and fill copies (`TileSprite.js:181,277`).
  - The FX pipelines are on by default: 357 MB more requested at 1080p (MEASURED).
  - PAUSED scenes still render (`SceneManager.js:592-595`).
  - Every texture source is kept for context restore.
- **On the low-end proxy, Phaser is a fifth of the frame.** At 4x, Phaser JS plus the native work it triggers is about 21% of the frame (14.9 of 71.5 ms). Most of that is TileSprite bursts.
- **Owning the engine means owning time, physics and texture lifetimes.** Freeing CPU copies after upload is the one memory win Phaser 3 can't cleanly give.
- **Writing code really is cheap now.** A purpose-built engine is about 8-15k LOC (ESTIMATED). About 75-80k of the roughly 90k LOC in files that import Phaser is engine-agnostic logic.
- **Tests check shapes, not behaviour.** 112 of 741 test files mock Phaser (verified). A DOM-free core would let them test real behaviour.

## Where the hunch is wrong

- **Frame rate.** Phaser's JS plus the native work it triggers is 2.1 of 9.6 ms at 1x. After the cheap fixes, a port removes about 5-11% of main-thread CPU (ESTIMATED).
- **Draw calls and batching** are not the problem: 7.3 draws per frame, and Phaser beat the floor engine on draw count.
- **Physics is not the bottleneck.** Arcade's core step takes 0.17 ms for 334 bodies and 999 colliders (MEASURED in node). Most of the 1.27-1.35 ms busy step is WAMP's worldstep code (CITED).
- **Most large numbers can be fixed on Phaser 3** in tens to hundreds of LOC: the TileSprite subclass, the FX flags, a one-cell brick patch (58.7 → 0.36 ms), per-room chunk frames, the F312 EWMA and the F356 render gate.
- **Boot time is asset preload,** which any engine keeps.
- **Memory is mostly WAMP's assets.**
- **Determinism is blocked by WAMP code, not Phaser.** Mechanics timers advance on render delta (`src/scenes/overworld/gameplayClock.ts:12-17`). Combat, portals and objectives run per render frame (`framePipeline.ts:142-170`). Run traces don't yet record every input with a step index or a physics version. Arcade already runs headless.
- **The editor and server rendering gain nothing.** The editor is lazy-loaded and its findings are WAMP, DOM or CSS. The server has no Phaser.
- **Ultracode doesn't make the expensive part cheap.** The parity oracles don't exist yet. Review (40-100 h) and Jonathan's play-testing (about 20 h per release candidate × 3-5) can't be run in parallel (ESTIMATED). Ghosts and the server's plausibility checks are coarse by design, so they cannot detect small changes in feel.
- **Neither Phaser 4 nor WebGPU is a shortcut.** Phaser 4 is bigger, flips the `roundPixels` default and has only vendor benchmarks. WebGPU reaches about 75% of Android and 86% of iOS phones, against about 98% for WebGL2. Published 2D results for WebGPU are neutral or negative (CITED).

## What to do

| Path | What it is | Jonathan's time (ESTIMATED) | Risk | Verdict |
|---|---|---|---|---|
| A. Fix hot spots on Phaser 3 | FX flags, TileSprite subclass, brick patch, chunk frames, WAMP per-frame fixes, F356 gate, F312 EWMA, F317 repack, ImageBitmap close, `losewebgl` telemetry, `useTree`/`maxTextures` tests, custom build | 8-15 h | Low | **Do now** (Stage 1 of E) |
| B. Upgrade to Phaser 4 | 4.2.x, with breaking changes in rounding, DynamicTexture, Camera#matrix and the Canvas renderer | 25-45 h | Medium | Not now |
| C. Strangler port | Phase 0 sim core and oracles, then renderer slice, then physics behind a facade shaped like Phaser's API, then retire Phaser | 90-180 h | Medium-high, gated | Only if the gate passes |
| D. Big-bang port | New engine plus rewrite of about 120 files at once | 120-250 h | High | **Reject** |
| E. Fix first, build oracles first, decide later | A + real-device traces + Phase 0 + owned render paths inside Phaser + a decision gate | 25-45 h to the gate | Low-medium | **Recommended** |

**Recommended: path E.** It is expected to deliver about 80-90% of what a port could (ESTIMATED). It also lets the server exactly re-simulate ranked runs, and it builds the oracles any later port would need. The PRD names its steps as stages:

1. **Stage 1 (Quick wins):** ship the A fixes, start `losewebgl` telemetry, then re-baseline.
2. **Stage 2 (Real-device baselines):** capture play, map and boot traces on one mid-range Android and, best effort, one iPhone.
3. **Stage 3 (Phase 0 oracles):** move timers, combat and portals onto the step clock behind a `physicsVersion` bump, and build the oracles.
4. **Stage 4 (Owned paths inside Phaser):** an index-texture tilemap drawn by a Phaser Extern game object, plus a custom Phaser 3 build.
5. **The decision gate.**

**The gate that would open path C.** On the real mid-range Android, after Stages 1-4, at least one of these must hold:

- Phaser JS plus the native work it triggers is still at least 20% of main-thread play-frame time.
- Phaser eval plus init still costs at least 400 ms of time to interaction, and boot is a product priority.
- `losewebgl` telemetry shows context loss that only owned texture lifetimes can fix.

If none holds, WAMP stays on Phaser 3 and spends the effort on its own hot spots.

**Which way the gate may go (ESTIMATED, headless proxies).** The share metric moves the wrong way as WAMP gets faster. Stage 1 removes more WAMP time than Phaser time, so Phaser's share of a smaller frame can rise.

- **4x proxy:** (14.9 − 7 TileSprite) / (71.5 − 7 − 9.6 WAMP hot spots) = 7.9 / 54.9, about 14%. The 9.6 ms is 1,406 + 309 + 663 = 2,378 ms over 248 frames.
- **1x proxy:** between 1.3 / (9.6 − 2.2 − 0.8) = 1.3 / 6.6, about 20%, if all 0.8 ms of Phaser's native work is TileSprite, and 2.1 / (9.6 − 2.2) = 2.1 / 7.4, about 28%, if none of it is. The 2.2 ms is 1,080 ms over 496 frames. TileSprite's share at 1x was not measured.

So condition 1 could pass on a fast phone and fail on a slow one. On the fast side the frame is about 7 ms, well inside a 16.7 ms budget, and the port would save about 0.7-1.0 ms. The PRD keeps the ruling's gate unchanged, but asks every device receipt to report Phaser's absolute ms per frame and p95 next to the share, and asks Jonathan whether condition 1 should also require p95 over budget. The stages, kill criteria and agent-fleet plan are in the PRD (see Delivery plan, Kill criteria and Running it with agent fleets in [wamp-engine-prd.md](wamp-engine-prd.md)).

## What we could not measure

- **Real phone GPUs.** GPU frame time, fill and overdraw on any real device. We used SwiftShader only, so the `maxTextures` effect is unproven on Adreno, Mali or Apple GPUs.
- **iOS.** Safari and JavaScriptCore behaviour. All CPU profiles are Chromium, so Phaser's per-frame cost on iOS is unknown.
- **Resident memory.** How much of the requested FX render targets and retained ImageBitmaps real drivers keep resident.
- **Context loss in the field.** How often it happens in production. There is no telemetry.
- **Heat.** Thermals and long-session GC or memory growth.
- **Modes we didn't exercise.** Presence, chat, PvP, ghost playback, ranked runs, room video, the editor and the course editor. The zoomed-out map ran without world-tile images, because the tile host was blocked.
- **Room video readback.** While a room video plays, `src/roomVideo/frameController.ts:399-450` draws the game canvas into a 2D canvas and reads its pixels back on every POST_RENDER to build the video's CSS mask. Its cost on phones is unmeasured.
- **Lazy compile per chunk.** Only the total is known: 311 ms at 1x, 1,498 ms at 4x.
- **A like-for-like engine.** A minimal engine drawing WAMP's actual scene. The bench used a synthetic scene with estimated object counts and no streaming churn.
- **The cost of parity.** How long physics parity at 0.01 px would take, or how many published rooms are tight enough for a 1 px or 1-step change to matter.

## Reproduce these numbers

The harness lives in `scripts/engine-port/`: `README.md`, `runtime-profile/` and `engine-bench/`. The README has every flag, output folder and caveat, and wins over the summary below. Run everything from the repo root. Results will differ by machine; shares and call counts are the numbers that carry over.

The files are plain JavaScript with an `.mts` extension, and Node 22.18 or later runs them directly. As `.mjs` files they would fail `npm run dead-code:check`, because knip's `scripts/**/*.{js,mjs,ts}` glob would flag these hand-run tools as unused files. The README explains the long-term fix.

**Setup:**

```sh
npm ci && npx playwright install chromium   # or set ENGINE_PORT_CHROMIUM to a Chromium binary
```

**Real-app profile** (`scripts/engine-port/runtime-profile/`). Output goes to `output/engine-port/`, which is gitignored.

```sh
# Preview-smoke build into output/engine-port/dist-perf (dist/ cannot run the preview-smoke hooks)
node scripts/engine-port/runtime-profile/build.mts

# Play at 1x and 4x, play at DPR 1, map at 1x; --start-preview starts and stops vite preview
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario play --throttle 1 --out output/engine-port/runs/play-1x
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario play --throttle 4 --out output/engine-port/runs/play-4x
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario play --dpr 1 --play-ms 15000 --out output/engine-port/runs/play-1x-dpr1
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario map --play-ms 15000 --out output/engine-port/runs/map-1x

# Quick check that the build, server and replay work
node scripts/engine-port/runtime-profile/measure.mts --start-preview --boot-only --out output/engine-port/runs/boot-check

# Summaries, attribution, boot and module eval, call chains
node scripts/engine-port/runtime-profile/summary.mts output/engine-port/runs/play-1x > output/engine-port/runs/play-1x/summary.json
node scripts/engine-port/runtime-profile/analyze.mts output/engine-port/runs/play-1x play
node scripts/engine-port/runtime-profile/analyze.mts output/engine-port/runs/play-1x boot
node scripts/engine-port/runtime-profile/boot.mts output/engine-port/runs/play-1x
node scripts/engine-port/runtime-profile/modeval.mts output/engine-port/runs/play-1x
node scripts/engine-port/runtime-profile/chain.mts output/engine-port/runs/play-1x play '(garbage collector)'

# Platform floor: a bare WebGL canvas the size of WAMP's (DPR 2, 1x, 8 quads)
node scripts/engine-port/runtime-profile/floor.mts 2 1 8
```

**Engine floor bench** (`scripts/engine-port/engine-bench/`). The runners start and stop their own server on 127.0.0.1:5174.

```sh
node scripts/engine-port/engine-bench/build.mts      # esbuild bundles, sizes, module line ranges
node scripts/engine-port/engine-bench/smoke.mts      # every page runs
node scripts/engine-port/engine-bench/run.mts --reps 3   # alternating A/B, 1x and 4x
node scripts/engine-port/engine-bench/aggregate.mts  # medians
node scripts/engine-port/engine-bench/profile.mts    # CDP self-time split
node scripts/engine-port/engine-bench/gpucheck.mts   # maxTextures -1 vs 1
```

**On a real Android phone,** `measure.mts --cdp http://127.0.0.1:9222 --throttle 1` attaches to Chrome over adb. That path is untested so far; the README gives the steps and what to check in the first run's output.

## Evidence index

The study's raw evidence files are not in the repo. The harness above reproduces the measurements; the rest is listed here by what it is.

| Evidence | What it is | How it was produced |
|---|---|---|
| Judge's ruling | Verdict, gains by area, paths A-E, recommended path, gates, kill criteria, open questions, key numbers | A judge agent weighed the maps, the measurements, the research and both debate briefs |
| Real-app runtime profile | Frame CPU split, draw calls, textures, heap, boot phases, top functions | CDP Profiler, tracing and WebGL call wrappers on a preview-smoke build of main @ 24e3626 in headless Chromium (SwiftShader), with hermetic API replay, phone viewport, 1x and 4x throttle, plus a bare-WebGL floor control |
| Engine floor bench | Phaser 3.90 vs a throwaway WebGL2 engine on a scene shaped like WAMP: per-frame JS, draws, init, bundle sizes, heap, `maxTextures` check | esbuild bundles, alternating fresh-browser runs (90 warm-up + 300 measured frames, median of 3), CDP profiles |
| Subsystem maps (7) | World render, play simulation, editor, assets and memory, platform I/O, server render and verification, Phaser API census | Code reading, grep and LOC counts at main @ 24e3626, plus small boot and memory probes; each finding tagged by cause |
| Field research | Phaser 4, PixiJS 8, WebGPU reach on phones, engine-swap cases, minimal engine sizes, agent-driven migrations | Web sources with URLs (some only as search snippets), plus bundle sizes measured from npm tarballs |
| Advocate and skeptic briefs | The strongest case for and against a port | Two agents argued from the same evidence before the judge ruled |
| Repo review docs | Open findings F251-F498 cited here as F-numbers | `docs/review/wamp-checkup-round-2.md` and `wamp-checkup-round-2-details.md` |
