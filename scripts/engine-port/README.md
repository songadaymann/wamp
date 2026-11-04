# Engine-port measurement harness

These tools produced the numbers in `docs/product/wamp-engine-viability.md` and
`docs/product/wamp-engine-prd.md`. Keep them so the numbers can be reproduced and the PRD's
decision gates can be rerun later, on real phones too.

There are two parts:

- `runtime-profile/` profiles the real WAMP client: boot, a play window and a zoomed-out map
  window. It records CPU time split by Phaser and WAMP code, frame times, WebGL calls, heap and
  textures.
- `engine-bench/` runs one synthetic scene shaped like WAMP on Phaser 3.90 and on a throwaway
  minimal WebGL2 engine. It shows the floor a purpose-built engine could reach. It is not a
  forecast of what a real engine would cost.

Nothing here runs in `npm run check` or CI. You run these tools by hand.

## Before you start

- Run `npm ci` in the repo root.
- Use Node 22.18 or newer. The files are plain JavaScript saved as `.mts`, and Node 22.18+ runs
  `.mts` directly. See "Why .mts" below.
- Install the browser for the repo's pinned Playwright (1.59): `npx playwright install chromium`.
  If you already have another Chromium or headless shell, you can point the tools at it
  instead: `ENGINE_PORT_CHROMIUM=/path/to/chrome-headless-shell`.
- Run every command from the repo root.

Output goes to `output/engine-port/`. `output/` is gitignored. To write somewhere else, pass
`--out-root DIR` or set `ENGINE_PORT_OUT=DIR`.

## Runtime profile (the real app)

The profile needs a special build. `dist/` cannot run the preview-smoke hooks the profile uses to
enter a room, because they only install when `VITE_ENABLE_TEST_RESET=1` at build time. So
`build.mts` makes a separate build, the same way `scripts/mobile_smoke_ci.mjs` does, with hidden
source maps. It writes to `output/engine-port/dist-perf/` and does not touch `dist/`. The build
also writes its usual side outputs to `output/build/`.

Network rule: `/api/*` is answered by the repo's hermetic replay (`scripts/lib/smokeApiReplay.mjs`,
fixture `scripts/fixtures/mobile-smoke-api.json.gz`). The replay also closes WebSockets. Any
request to a host other than 127.0.0.1 or localhost is aborted before it leaves the machine. The
run prints which hosts were blocked. Today that is only the world-tile host, so the zoomed-out map
has no remote tile images.

```sh
# 1. Build (about 35 s)
node scripts/engine-port/runtime-profile/build.mts

# 2. Measure. --start-preview starts vite preview on 127.0.0.1:3000 and stops it at the end.
#    About 35 s per play run, 30 s per map run.
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario play --throttle 1 --out output/engine-port/runs/play-1x
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario play --throttle 4 --out output/engine-port/runs/play-4x
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario play --dpr 1 --play-ms 15000 --out output/engine-port/runs/play-1x-dpr1
node scripts/engine-port/runtime-profile/measure.mts --start-preview --scenario map --play-ms 15000 --out output/engine-port/runs/map-1x

# 3. Read the results (each takes a few seconds)
R=output/engine-port/runs/play-1x
node scripts/engine-port/runtime-profile/summary.mts $R > $R/summary.json   # frames, GL calls, heap, textures
node scripts/engine-port/runtime-profile/analyze.mts $R play                # CPU self time by chunk, source file, function
node scripts/engine-port/runtime-profile/analyze.mts $R boot
node scripts/engine-port/runtime-profile/boot.mts $R                        # boot trace: compile and evaluate per chunk
node scripts/engine-port/runtime-profile/modeval.mts $R                     # top-level module evaluation, boot phases
node scripts/engine-port/runtime-profile/chain.mts $R play '(garbage collector)'   # call chains into one function

# 4. Platform floor: a bare WebGL canvas the size of WAMP's, about 15 s per run
node scripts/engine-port/runtime-profile/floor.mts 2 1 8          # DPR 2, 1x, 8 quads
node scripts/engine-port/runtime-profile/floor.mts 1 1 8
node scripts/engine-port/runtime-profile/floor.mts 2 4 8
node scripts/engine-port/runtime-profile/floor.mts 2 1 8 upload   # also re-upload a canvas texture every 5th frame
```

To serve the build yourself, run `node scripts/engine-port/runtime-profile/preview.mts` and leave
out `--start-preview`. `--boot-only` stops after the boot trace, which is a quick check that the
build, server and replay work (about 10 s).

What `measure.mts` records:

| Window | What it records |
| --- | --- |
| Boot (navigation until the overworld is ready) | CDP trace (timeline, V8 compile and execute, loading), CPU profile at 250 µs sampling, first WebGL draw, the game's boot phases, script timings |
| Play (select room 0,0, play it, then run left and right with jumps for `--play-ms`) | CPU profile, rAF frame deltas, long tasks, WebGL call counts per frame (draws, vertices, texture uploads, buffer uploads, binds), CDP metric deltas, heap before and after, the game's own segment profiler, Phaser texture census, display list and physics bodies per scene, CPU per Chromium process (Linux `/proc`) |
| Map (zoom the browse camera all the way out, then pan with the arrow keys) | The same as Play |

The phone context is 390x844, deviceScaleFactor 2 (change with `--dpr`), touch, mobile. This
matches `createBenchmarkBrowserContext` in `scripts/runtime_performance_trace.mjs`.

## Engine bench (Phaser vs a minimal engine)

The scene is synthetic but shaped like WAMP: a 3x3 block of full rooms, each with a background
rectangle, two starfield TileSprites, baked room and foreground images, a hidden terrain layer for
collision, and 40 placed objects. Around them is a ring of 40 preview images, plus a player and a
HUD redrawn every frame. Object counts per room are ESTIMATED, not taken from production rooms.
`common/common.mts` has the details and the WAMP files it copies from.

Scenarios: `play` (the WAMP-like case), `playTilemap` (visible tile layers instead of baked
images), `worldmap` (240 preview images at zoom 0.1) and `play&dens=4` (4x the objects). The mini
engine culls rooms by default; `cull=0` turns that off for a like-for-like comparison.

```sh
# Build both bundles, record sizes and module line ranges (about 15 s)
node scripts/engine-port/engine-bench/build.mts

# Check every page runs and save screenshots (about 30 s)
node scripts/engine-port/engine-bench/smoke.mts

# The full A/B run used in the docs: 3 reps, 1x and 4x, all scenarios. On SwiftShader all the
# bench runs together took about 60 min (MEASURED); this one is most of that.
node scripts/engine-port/engine-bench/run.mts --reps 3
node scripts/engine-port/engine-bench/aggregate.mts      # medians -> results/summary.json

# CPU profile by category (engine vs bench code vs native) (roughly 10-20 min, ESTIMATED)
node scripts/engine-port/engine-bench/profile.mts

# Phaser's multi-texture batching on SwiftShader: maxTextures -1 vs 1 (a few minutes, ESTIMATED)
node scripts/engine-port/engine-bench/gpucheck.mts

# A short sanity pass (about 15 s)
node scripts/engine-port/engine-bench/run.mts --reps 1 --warm 20 --n 60 --throttles 1 --scenarios play
```

The runners start a static server on 127.0.0.1:5174 when nothing is listening there, and stop
it when they finish. To serve the pages yourself, run
`node scripts/engine-port/engine-bench/serve.mts`. The server sends COOP and COEP headers, so
`performance.now()` is cross-origin isolated and has fine resolution.

Results go to `output/engine-port/engine-bench/results/`: `sizes.json`, `bundle-ranges.json`,
`runs.json`, `summary.json`, `profile.json` and `shot-*.png`.

## How the numbers in the docs were produced

| Item | Value |
| --- | --- |
| Date | 2026-11-04 |
| Code | main @ 24e3626, no tracked files changed |
| Machine | 4-core Linux container, shared by the renderer, the GPU process and the profiler |
| Browser | Headless Chromium (chromium_headless_shell-1243, Chromium 153) driven by Playwright 1.63, because the repo's Playwright 1.59 browser was not installed. WebGL ran on ANGLE over SwiftShader (software GL). |
| Bundler for the bench | esbuild 0.25.12 from the repo |
| Runtime profile runs | play 1x (two runs), play 4x, play 1x at DPR 1 (15 s), map 1x (15 s); 20 s play windows otherwise; plus floor runs at DPR 2 1x, DPR 1 1x, DPR 2 4x and DPR 2 1x with uploads |
| Engine bench runs | `run.mts --reps 3` (90 warm-up frames, 300 measured, fresh browser per run, engines alternated), `profile.mts`, `gpucheck.mts`; the docs report the median of the 3 runs |

The tools were then moved here and made portable: paths now resolve from the repo, output goes to
`output/engine-port/`, the browser comes from the repo's Playwright, and the bench's line ranges
are read from the bundle instead of being typed in. A short pass from this location (build, boot,
a 4 s play window, and a one-rep bench) gave the same kind of results. The bench bundle sizes
came out within 0.1% of the original ones; the small difference comes from the move.

## Caveats

Read these before you quote a number.

- **SwiftShader is not a phone GPU.** Absolute fps, frame-time percentiles and frame intervals
  reflect CPU-emulated fill rate. The GPU process used 2.4-3.2 cores. Trust the CPU and JS shares
  and the call counts; do not trust the fps.
- **4x CPU throttling slows the browser too.** The bare-WebGL floor drops to about 43 fps at 4x.
  Treat 4x as a pessimistic stand-in for a low-end phone.
- **Variance.** Boot varies about 1.6x run to run on this machine, and fps about 10%.
- **Instrumentation is included.** The game's own profiler, the harness's state polling (about
  every 600 ms) and the CPU profiler all add time. Together that is roughly 0.3-1.4 ms per frame in
  the WAMP numbers.
- **Attribution is approximate.** Native time is charged to the nearest JS caller. WAMP code
  calling Phaser counts as Phaser; Phaser's loop calling WAMP scene code counts as WAMP.
- **Texture bytes are CPU-side.** They are width x height x 4 of the sources in Phaser's texture
  manager. They are not GPU memory, and they miss Phaser's private TileSprite canvases.
- **The API is a recording.** Only a few rooms have full data; the rest are stand-ins. There is no
  presence, chat, PvP, ghosts or other players. The world-tile host is blocked.
- **Scripted input, not play.** Only one run crossed a room seam.
- **The scratch build is not dist/.** Its main chunk is about 55 KB larger because of the
  preview-smoke hooks. The Phaser chunk is the same size.
- **The bench is synthetic, and the mini engine is a floor.** It has no scene graph, depth sorting,
  input, text, tweens, camera effects, loader, sound, slopes, one-way platforms or Arcade features.
  An engine at parity would cost more per frame. It also packs room layers into one texture, while
  Phaser (and WAMP) use one texture per room layer.
- **Bench init times** are localhost only and leave out workload generation, which is the same in
  both builds.
- **Heap numbers** leave out canvas backing stores, ImageData and GPU textures.

Expected noise: a run started with `--start-preview` writes a `preview.log` beside its results.
It holds vite's failed attempt to open a desktop browser and a few `/api` proxy errors. Those come
from beacons the page sends as it closes; they reach the local preview server only, which has no
API behind it. Nothing leaves the machine.

## Running the profile on a real Android phone

Not tested here. This is the approach.

1. On the phone, turn on Developer options and USB debugging. Connect it over USB and check that
   `adb devices` lists it.
2. Open Chrome on the phone. Forward its DevTools socket to the computer:
   `adb forward tcp:9222 localabstract:chrome_devtools_remote`.
   `curl http://127.0.0.1:9222/json/version` should answer.
3. Let the phone reach the preview server as its own 127.0.0.1:
   `adb reverse tcp:3000 tcp:3000`.
4. Build and serve on the computer:
   `node scripts/engine-port/runtime-profile/build.mts`, then
   `node scripts/engine-port/runtime-profile/preview.mts`.
5. Run the profile against the phone. Use `--throttle 1`, because the phone is the slow device:
   ```sh
   node scripts/engine-port/runtime-profile/measure.mts --cdp http://127.0.0.1:9222 --throttle 1 --out output/engine-port/runs/phone-play
   ```
   `--cdp` attaches to the running Chrome instead of launching one. The page keeps the phone's
   real screen size and pixel ratio, so `--dpr` has no effect. The replay and the rule that blocks
   non-local hosts work through the DevTools protocol, so they should still apply. Check the
   `blocked` and replay lines in `play-captured.json` to be sure. Per-process CPU from `/proc` is
   skipped, because that would read the computer, not the phone.
6. Analyse the run as above. To compare, run the same build headless on the computer.

Things to watch on a phone:

- Plug it in, close other apps, keep the screen on and let it cool between runs. Thermal
  throttling changes results within minutes.
- Read GPU frame time and power from Chrome's `chrome://tracing` on the phone, Android GPU
  Inspector, or Perfetto. This harness only sees the main thread.
- iPhones are not covered. Safari's Web Inspector does not speak this protocol. Use Safari's
  Timelines by hand, or WebKit through Playwright for relative numbers only.
- The engine bench pages also work on a phone. Run `serve.mts`, then
  `adb reverse tcp:5174 tcp:5174`, and open `http://127.0.0.1:5174/mini.html?scenario=play` and
  `phaser.html?scenario=play` in phone Chrome. Read `window.__benchResult` from remote DevTools.

## Why .mts

`knip.json` puts `scripts/**/*.{js,mjs,ts}` in knip's project. Nothing imports these hand-run
tools, so as `.mjs` files they would fail `npm run dead-code:check` as unused files. This change
was kept to `scripts/engine-port/`, so it does not edit `knip.json`. The `.mts` extension keeps
them outside that glob. It also keeps them outside `tsc` (which only checks `src/`) and outside
the repo's ESLint config. The code is plain JavaScript. Node runs it directly, and esbuild bundles
the browser files with the same ES module rules as `.js`.

To make them ordinary `.mjs` files later, rename them, fix the relative imports, and add the
entry scripts to `entry` in `knip.json`. `src/config/executableEntryContract.test.ts` only lists
top-level `scripts/` files, so it needs no change.

## Files

| Path | What it is |
| --- | --- |
| `lib.mts` | Shared helpers: repo root, output folder, argument parsing, Chromium launch, `/proc` CPU, server wait |
| `runtime-profile/build.mts` | Scratch build with the preview-smoke hooks and hidden source maps |
| `runtime-profile/preview.mts` | `vite preview` of that build on 127.0.0.1:3000 |
| `runtime-profile/measure.mts` | The runner: boot, then a play or map window |
| `runtime-profile/summary.mts` | Frames, GL calls, CDP metrics, heap, textures, display list |
| `runtime-profile/analyze.mts` | CPU self time by chunk, source file (through source maps) and function |
| `runtime-profile/chain.mts` | Call chains into one function |
| `runtime-profile/boot.mts` | Boot trace: compile and evaluate per chunk |
| `runtime-profile/modeval.mts` | Top-level module evaluation per chunk |
| `runtime-profile/floor.mts` | Bare-WebGL platform floor |
| `engine-bench/build.mts` | Builds the Phaser and mini bundles, sizes, line ranges, HTML pages |
| `engine-bench/serve.mts` | Static server with COOP and COEP |
| `engine-bench/run.mts` | A/B runs |
| `engine-bench/aggregate.mts` | Medians across reps |
| `engine-bench/profile.mts` | CPU profile by category |
| `engine-bench/gpucheck.mts` | Phaser `maxTextures` check |
| `engine-bench/smoke.mts` | Every page runs, with screenshots |
| `engine-bench/common/` | Shared workload, input and timing harness (browser code) |
| `engine-bench/mini/` | The throwaway minimal WebGL2 engine and its scene (browser code) |
| `engine-bench/phaser/` | The same scene on Phaser 3.90 (browser code) |
