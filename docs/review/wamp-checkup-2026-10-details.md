# WAMP Checkup (October 2026): item details

Full write-ups for every item in [wamp-checkup-2026-10.md](wamp-checkup-2026-10.md), the checklist that tracks what is done. Original review evidence line numbers are from commit `7371df9a`; later additions identify their own baseline. Re-check the current code before acting.

Each item lists the plain-language summary, the technical detail, the evidence the reviewer cited, and what the independent fact-checkers corrected. Where they disagree, **the fact-check correction overrides the original detail**.

### F003: The pre-rendered world-map tile pyramid is switched off in production (asset hash mismatch since ~Sep 3)

**Delivery update.** Delivered 2026-10-03 (`57b607c7`): compatible renderer `production-2026-10-03-checkup-d9d6c8cf` is active at 100%; 972 generations and 952 nonempty objects pass readiness/parity. Public availability smoke, scheduled six-hour health checks and CI asset-contract diagnostics are in place. See [delivery evidence](../development/checkup-map-recovery-2026-10-03.md). Follow-up adds direct 15-minute outage/recovery emails with durable retries and blocking CLI/Pages production compatibility gates; see [alert and release plan](../development/world-map-alert-release-gate-2026-10-03.md).

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** The fast, pre-rendered world map built over the summer isn't being used. The live server reports it as 'unavailable' because a tileset change altered an asset fingerprint and the map tiles were never re-rendered for it. So every visitor's phone falls back to drawing hundreds of room previews itself in the browse view. Re-render and activate the tiles, and add an alarm so this can't silently happen again.

**Technical detail.**

Live check: GET https://api.wamp.land/api/world/tiles/config (2026-10-03) returns available:false, rolloutPercentage:100, activeRendererVersion 'production-2026-08-31-smart-autotiling-4b122cb7', activeRendererAssetContractHash 'authoring-catalog-v1:4b122cb7accc8026', expectedRendererAssetContractHash 'authoring-catalog-v1:d9d6c8cf7dbb63c3'.

Mechanism: worldTiles/service.ts:74-82 reports available only when the active renderer's hash equals WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH. That hash is computed over JSON.stringify of TILESETS/GAME_OBJECTS/BACKGROUND_GROUPS (assetContract.ts:16-29), so any registry edit turns tiles off until a renderer for the new hash is backfilled and activated. Likely culprits are the 2026-09-03 tileset commits 8276c629 and fee5804d, landed after the 08-31 activation recorded in docs/smart-autotiling-roadmap.md:22-23.

Client effect: rollout.ts decideWorldTileRollout returns enabled:false ('unavailable'), so WorldTileController.isRefinementStopped() is true (controller.ts:813-817). Browse then uses the browser-composed chunk previews: canvas composition plus texture upload on the main thread (chunkPreviewRenderer.ts:583-620, 1022-1261). Browse budgets allow up to 324 preview rooms on reduced (phone) devices and 784 on desktop (previewStreaming.ts:31-34, 370-377). This is exactly what the July tile-pyramid work set out to replace (performance-code-health-roadmap.md 'Multiresolution Overworld Extension').

Fix:
(1) Run the existing scripts for the current contract: world-tiles:renderer:deploy:production, world-tiles:backfill, world-tiles:activate (package.json:52-58).
(2) Add `available === true` to the production smoke, plus a scheduled check that alerts.
(3) Add a CI warning when WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH changes in a PR.
(4) Consider hashing only render-affecting fields (frame geometry, image URLs) so metadata edits don't disable the map.
Note: fix the per-frame world-tile work finding before or with re-enabling.

**Evidence.**

- https://api.wamp.land/api/world/tiles/config (GET 2026-10-03) — available:false; active hash 4b122cb7… vs expected d9d6c8cf…
- src/cloudflare/worker/worldTiles/service.ts:74-82 — available requires asset_contract_hash === WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH
- src/worldTiles/assetContract.ts:16-29 — hash = FNV over JSON of TILESETS, GAME_OBJECTS, BACKGROUND_GROUPS
- src/scenes/overworld/worldTiles/rollout.ts:~55 — config.available false → enabled:false reason 'unavailable'
- src/scenes/overworld/previewStreaming.ts:31-34,370-377 — browse fallback composes up to 324 (reduced) / 784 preview rooms
- src/scenes/overworld/chunkPreviewRenderer.ts:583-620 — fallback builds chunk preview canvases and uploads textures in the browser
- git log: 8276c629 / fee5804d (2026-09-03) changed tilesets after renderer production-2026-08-31 was activated

**Fact-check (confirmed, confirmed, confirmed).**

Minor fixes; the core claim stands.

(a) The hash changed twice on Sep 3. 8276c629 moved it to authoring-catalog-v1:264ba6e94e75b789, then fee5804d moved it to d9d6c8cf7dbb63c3. It has not changed since, so one backfill and activation for d9d6c8cf would restore the tiles.

(b) Fix suggestion (4), hashing only render-affecting fields, would not have prevented this outage. fee5804d changed CYBERCITY_EXTRAS_TILESET_FIRST_GID from 2077 to 2149, and 8276c629 changed the Cybercity decor index lists. The GID change genuinely needs a re-render, so the hash gate did its job correctly. The real defect is that nobody ran the backfill and nothing alerted. Treat (4) as optional hardening, not the fix.

(c) The fallback affects desktop as well as phones (784-room overview budget). The game still works; browse just loses the cheaper path on every device.

(d) The ?worldTiles=force override cannot bypass this, because rollout.ts checks unavailable before it checks forced.

(e) The recovery needs production Cloudflare credentials and the documented parity and readiness gates (docs/overworld-tile-pyramid.md:96-106), not just three npm commands.

Minor refinements, none of which change the verdict:

1. The hash changed twice on Sep 3: 8276c629 made it 264ba6e9…, then fee5804d made it d9d6c8cf…. No later registry commit changed it. A single renderer deploy, backfill and activation for d9d6c8cf7dbb63c3 would turn tiles back on today.
2. The browser fallback is designed behaviour, documented in feature-ledger.md:36. The defect is the missing follow-up and the lack of any alert, not the gate.
3. docs/smart-autotiling-roadmap.md:21-23 is stale: it still names 4b122cb7 as the production contract.
4. Fix suggestion (4), hashing only render-affecting fields, is optional and lower value. Most of the registry content affects rendering, and the strict gate deliberately prevents stale imagery (the "Zone of truth" incident, ledger:36).
5. Re-enabling needs a full backfill run against production, so effort is small in engineering work but includes compute and wait time.

The core is right; four caveats.

(a) Fix suggestion (4) would not have prevented this case. The Sep 3 changes were genuinely render-affecting: 8276c629 added the Cyber extras tileset (+73 lines in tilesets.ts), and fee5804d moved CYBERCITY_EXTRAS_TILESET_FIRST_GID from 2077 to 2149. Shutting off when the hash mismatches is the documented, intended safety behavior (feature-ledger.md:36, docs/overworld-tile-pyramid.md:63-69). It stops the old renderer from showing wrong or missing Cyber tiles. The defect is the operational gap: no re-backfill and no alert, not over-broad hashing. The better guardrail is a check in deploy_prod/smoke_prod: if the build's rendererAssetContractHash differs from the live active renderer's hash, warn or block, and the release checklist should include the backfill and activate steps. Tileset work is ongoing (Cyber correction is the "current focus"), so this will happen again.

(b) This is a slowdown, not breakage. The fallback is the "compact" path that shipped before July and is still the designated rollback. It caches textures per chunk, so the cost lands on panning and zooming in browse, not on every frame. Play mode is mostly unaffected on phones, where the reduced play budget is 9 rooms at every zoom level.

(c) Browse is the default landing mode (OverworldPlayScene.ts:464), so reach is 100% of visitors. That supports the high rating even though the per-device cost is moderate.

(d) Also update the stale contract line in docs/smart-autotiling-roadmap.md:21-23 after reactivating. I did not verify the "fix the per-frame world-tile work finding first" dependency.

### F002: No 60 fps cap: 120 Hz phones run all game logic and rendering twice per physics step

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** improvement · **impact:** high · **effort:** small

**Summary.** Many Android phones refresh their screens 90-120 times a second. WAMP doesn't cap its frame rate, so on those phones it does all of its per-frame work up to twice as often. The physics, which decides where things actually are, still only moves things 60 times a second. That means double the CPU, GPU, heat and battery for no visible gain, and heat is what makes phones throttle and stutter. Cap the game at 60 on high-refresh screens.

**Technical detail.**

main.ts:76-102: the GameConfig has no `fps` key, so Phaser's TimeStep runs scene update + render on every rAF. Chrome on Android delivers 90/120/144 Hz rAF; iOS Safari defaults to 60. Arcade physics defaults to fps 60 with fixedStep (node_modules/phaser/src/physics/arcade/World.js:159-170). At 120 Hz, bodies therefore move only every other frame and the same positions are rendered twice. Everything per-frame runs 2× per second: live objects, special-tile scans, the lighting RenderTexture redraw, weather Graphics rebuild, and the frame-work coordinator's 2-4 ms per-frame budget (frameWorkCoordinator.ts:129-131). The headroom math also assumes 60 Hz (worldStreaming.ts:162 FRAME_TARGET_MS = 1000/60; OverworldPlayScene.ts:306), so an 8.3 ms frame looks like it has ~8 ms spare and discretionary work is never paused.

Fix: probe rAF cadence for ~30-60 frames before `new Phaser.Game` in main.ts, or reuse restartPhaserRenderLoop (main.ts:113-129), since TimeStep reads hasFpsLimit at start (TimeStep.js:546). If the median interval is under ~9.5 ms (≥105 Hz), set `fps: { limit: 60 }`. Phaser's stepLimitFPS accumulates delta (TimeStep.js:660-690), so 120→60 is exact. Do not cap 60 Hz screens (rAF jitter makes a 60 limit drop frames) or 90 Hz screens (a 60 limit gives 45 fps). Add a Settings toggle (Auto / 60 / Uncapped); Battery Saver could cap at 30. Surface loop.actualFps in the mobile profiler (resourceDebug.ts:486 already reads it).

**Evidence.**

- src/main.ts:76-102 — GameConfig sets renderer/scale/physics but no fps.limit
- node_modules/phaser/src/physics/arcade/World.js:159-170 — arcade fps defaults to 60 with fixedStep true
- node_modules/phaser/src/core/TimeStep.js:138,546,660-690 — fps 'limit' support; chosen at loop start; delta-accumulating limiter
- src/scenes/overworld/worldStreaming.ts:162 — FRAME_TARGET_MS = 1000/60 used for critical-headroom math
- src/scenes/overworld/frameWorkCoordinator.ts:129-131 — 2-4 ms discretionary budget is per frame, so per-second cost doubles at 120 Hz

**Fact-check (partially confirmed).**

Core facts confirmed: no fps cap (main.ts:76-102), Arcade fixed at 60 Hz (World.js:159/170/954/1094), and weather and lighting redraw every frame. Corrections to the claim and the fix:
(a) Do not use a literal `fps: { limit: 60 }`. Phaser's stepLimitFPS throws away leftover time (`this.delta = 0`, TimeStep.js:684-688), so 120 Hz becomes an irregular 60/40 fps. Use a limit slightly above 60, for example 65-70 (_limitRate about 14.3-15.4 ms), so two 120 Hz frames always pass, or write a custom limiter with a tolerance.
(b) Apply the cap only when the probe finds about 120 Hz, or about 240 Hz with a matching limit. Leave 90, 144 and 165 Hz uncapped, because they would drop to 45, 48 and about 55 fps.
(c) Remove the claim that the frame-work budget doubles total cost; queued streaming work just finishes sooner.
(d) Add the defect the reviewer missed. Gameplay depends on frame rate: ICE_COAST_FACTOR is applied per frame (movementController.ts:570), and the `Math.max(delta/1000, 1/60)` floors (movementController.ts:573, 676, 712) double ice acceleration, wind push and directional gravity at 120 Hz. The per-frame camera lerp (OverworldPlayScene.ts:312, cameraController.ts:168) moving against 60 Hz body steps makes the player jitter. Capping hides this on about 120 Hz screens. Making those formulas delta-correct (pow(factor, delta/16.67) and plain delta/1000), or running movement on the physics WORLD_STEP, fixes it everywhere, including on uncapped 144 Hz desktops.

### F001: Guest session recorder stalls the game once a second for new players

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** For the first 5 minutes of every signed-out visit, the game screenshots itself once a second and compresses the shot to a JPEG on the main game thread, sometimes twice. Each tick also builds the full debug dump of the game three times. On phones this shows up as a small freeze every second, right during a new player's first impression. The capture should be smaller, asynchronous and less frequent.

**Technical detail.**

Mechanism: a 1 s interval (recorder.ts:190) sets `due`; on the next Phaser POST_RENDER (main.ts:387-395) the onFrame callback (recorder.ts:97-112) runs `context.drawImage(host.canvas, ...)` from the WebGL canvas, which flushes the WebGL context. It then runs `canvas.toDataURL('image/jpeg',0.35)`, a synchronous pixel readback plus JPEG encode inside the render frame. If the result is over REPLAY_IMAGE_LIMIT (16,000 chars, about 12 KB; model.ts:2), it encodes a second time at 0.12 (:109) and may still throw the image away (:110). That is likely on landscape and desktop canvases, which capture at up to 640×480. In the same tick, host.snapshot() is called at :103 and again inside sample() (:76), and host.state() at :78. Each call is getGameDebugState → OverworldPlayScene.describeState() (OverworldPlayScene.ts:6218-6560), which builds about 60 fields per live object across every loaded room, sorts the LOD id sets, and collects presence, streaming and weather debug data. screen() (:70) calls getComputedStyle/getClientRects, which forces a style recalculation. This runs for REPLAY_SECONDS=300.

Fix:
(a) Capture at about 320×180 so one encode at q≈0.4 fits under the limit.
(b) Replace toDataURL with `canvas.toBlob(cb,'image/jpeg',q)`, which encodes off the main thread in Chrome and Safari. Alternatively use `createImageBitmap(host.canvas,{resizeWidth,resizeHeight})` plus OffscreenCanvas.convertToBlob in a worker. Upload as binary, or base64 in the callback.
(c) Sample every 2-3 s.
(d) Add a cheap host `getReplayState()` returning {mode, room, player x/y, activeTool, goalRun summary} and call it once per tick, instead of calling describeState three times.

The same debug-dump misuse appears in main.ts:139: the render-loop recovery `isEligible` calls getGameDebugState(game).mode, so a full describeState runs 750 ms after every input burst (renderLoopRecovery.ts:55, 174-176). Replace it with a direct scene.mode read.

**Evidence.**

- src/analytics/replay/recorder.ts:97-112 — POST_RENDER callback does drawImage(WebGL canvas) then synchronous toDataURL JPEG, with a second encode at :109 when over the limit
- src/analytics/replay/recorder.ts:190 — setInterval(tick, 1000) arms a capture every second
- src/analytics/replay/model.ts:1-2 — REPLAY_SECONDS = 300, REPLAY_IMAGE_LIMIT = 16_000
- src/analytics/replay/recorder.ts:76-78,103 — host.snapshot() twice and host.state() once per sample; both resolve to describeState
- src/main.ts:387-395 — replay hooked to Phaser.Core.Events.POST_RENDER with snapshot/state = getDebugState
- src/scenes/OverworldPlayScene.ts:6240-6337 — describeState maps every live object in every loaded room into a ~60-field object
- src/main.ts:139 — render-loop recovery isEligible calls getGameDebugState(game).mode (full describeState)
- src/main/renderLoopRecovery.ts:55,174-176 — the stall check fires 750 ms after each keydown/pointerdown/touchstart/wheel and calls isEligible

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

The mechanism holds: the synchronous `drawImage` and `toDataURL` JPEG encode in POST_RENDER (with a possible second encode), plus three full `describeState()` calls per 1 s tick, for up to 300 s. The scope needs four corrections:

(1) **Only budgeted sessions are recorded.** Recording runs only for guest sessions the server admits, at most 100 per rolling 24 h globally and 10 per visitor (src/cloudflare/worker/guestReplay/routes.ts:62-67). Above that the start call returns 429 and the recorder shuts off for the visit. It is also skipped under Do Not Track, Global Privacy Control or the stored opt-out (recorder.ts:26-27). So it is not every signed-out visit.

(2) **Screenshots only in play and edit.** The canvas capture and encode run only in play or edit mode (recorder.ts:102); browse-mode ticks only pay for the three `describeState` calls.

(3) **Line reference.** The first `snapshot()` call is at recorder.ts:102, not :103.

(4) **Unmeasured claims.** How often the 0.12 re-encode and the image drop happen, and how long the stall lasts on phones, are inferred, not measured. The progress notes record desktop-only checks for this feature.

The render-loop recovery claim is accurate (main.ts:136-140, renderLoopRecovery.ts:166-183) and affects all users. Its cost is low: one full debug dump per input pause, not per frame.

If the image moves to `toBlob`, it still has to reach the server as a base64 `data:image/jpeg` string, which the server validates (routes.ts:20-21), unless the server is changed too.

The scope is narrower than stated, in four ways:
1. **Not every guest visit.** Recording only starts if the server accepts it. The server caps sessions at 100 per rolling 24 h globally and 10 per visitor (src/cloudflare/worker/guestReplay/routes.ts:62-74). Above the cap, `start` returns 429 and the recorder shuts down (recorder.ts:138, 142). So it affects up to about 100 guest sessions a day, not every signed-out visit.
2. **Screenshots only in play/edit.** The screenshot and JPEG encode run only in play or edit mode (recorder.ts:102). The world starts in browse mode (OverworldPlayScene.ts:464). In browse, the per-second cost is the 3× describeState plus getComputedStyle, with no image.
3. **Missed cost on every click.** The click handler at recorder.ts:150 also runs a full describeState on every document click.
4. **Unmeasured magnitude.** The capture is at most about 640×360, because the canvas is CSS-pixel sized via Scale.RESIZE. The second encode at q 0.12 is possible, but nothing shows it is "likely".

Everything else is accurate:
- 3× describeState per tick.
- Synchronous drawImage + toDataURL in POST_RENDER.
- REPLAY_SECONDS = 300.
- The render-loop isEligible calling describeState about 750 ms after input, for all players.

The recommended fix stands:
- Capture smaller.
- Use toBlob/createImageBitmap.
- Sample every 2-3 s.
- Add a cheap getReplayState.
- Read scene.mode directly in isEligible and in the click handler.

1. Reach: this does not run on every signed-out visit. The server records at most 100 sessions per rolling 24 hours site-wide and 10 per visitor (src/cloudflare/worker/guestReplay/routes.ts:62-74), and a 429 stops the recorder. It also skips opted-out, DNT and GPC visitors (recorder.ts:26-27). Screenshots are only taken in play and edit modes (recorder.ts:102).
2. Citation: the first snapshot call is at recorder.ts:102, not :103.
3. Missed call site: host.snapshot(), and so a full describeState, also runs on every document click during recording (recorder.ts:150).
4. Magnitude, from a synthetic local benchmark (headless Chromium, Apple Silicon):
   - 640-wide captures (desktop and landscape) went over 16k chars at q0.35 every time, so both encodes ran, at about 3.5–4 ms per tick.
   - Portrait phone captures (267x480) did one encode, about 1.9 ms.
   - Expect roughly one dropped frame per second on mid and low-end phones, not a large freeze.
   - There may also be a one-time warm-up hitch of about 200 ms on the first capture.
5. The proposed fix:
   - toBlob is not encoded off the main thread in Safari, and the pixel readback stays synchronous everywhere.
   - The server expects a data-URL string (routes.ts:20), so a Blob needs an async FileReader conversion or a server change to accept binary.
   - Prefer a small capture (about 320x180, one encode) plus a 2–3 s cadence plus a cheap getReplayState() as the core fix. Treat the worker/OffscreenCanvas path as optional; it must snapshot inside POST_RENDER because preserveDrawingBuffer is off.
6. The render-loop recovery isEligible issue (main.ts:139) is real but low impact: it runs once per input burst, not per frame.

### F004: Fog and rain rebuild hundreds of shapes from scratch every frame

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** In a fog room, the game redraws about 270 soft fog blobs (around 600 at max intensity) from scratch every frame. Rain redraws up to 130 drops as separate line 'paths'. Phaser has to re-cut every blob into triangles each frame, creating tens of thousands of throwaway objects per frame, which is enough to make a phone stutter in any foggy or rainy room. The fog should be drawn once and then just slid around.

**Technical detail.**

weather/controller.ts:113 clears the Graphics object every frame. drawFog (:315-375) then issues bands × lobes fillEllipse calls: bands = round(8+22·intensity) (:188), lobes ≈ 6+8i + rand·(5+7i). That is about 270 ellipses at the default intensity of 50 and about 600 at 100. Phaser's Graphics.fillEllipse (node_modules/phaser/src/gameobjects/graphics/Graphics.js:1231-1239) allocates an Ellipse plus about 19 Point objects (GetPoints/CircumferencePoint). At render, GraphicsWebGLRenderer re-creates Path/Point objects for each path command (GraphicsWebGLRenderer.js:240-305), and MultiPipeline.batchFillPath re-runs Earcut on every polygon every frame (MultiPipeline.js:800-814).

Measured on this desktop, the Ellipse.getPoints(18) + Earcut part alone costs 0.40 ms/frame for 270 lobes and 0.77 ms for 600. That excludes Phaser's command replay, its Path/Point re-allocation and vertex batching, so expect several ms plus a GC sawtooth on a mid-range phone; plus a lot of alpha overdraw.

Rain (:251-264): each drop does lineStyle + beginPath + moveTo + lineTo + strokePath, which means one Path and two Points allocated per drop per render. Rain mode also draws 1-4 fog bands (:182-189).

Fix:
- Fog: lobe geometry inside a band depends only on seed/index/lobe; only the band moves (sin drift on x/y). Bake each band once per room entry into a canvas or DynamicTexture, keyed by roomId + intensity, and each frame just set Image x/y. That is about 30 Images instead of 600 tessellations.
- Rain: use fillRect(x, y, 1, len) (the FILL_RECT path allocates nothing), or a Blitter / ParticleEmitter with a 1×N drop texture.
- Cache the per-room hash seeds (`hashString(`${roomId}:rain`)` runs every frame).
- When weather is off, early-out without cloneRoomWeatherSettings and without building a new debugState object (:79-92).

**Evidence.**

- src/weather/controller.ts:113 — graphics.clear() every frame before redrawing all weather
- src/weather/controller.ts:186-189 — fog band count = round(8 + intensity*22)
- src/weather/controller.ts:374 — graphics.fillEllipse(..., 18) per fog lobe per frame
- src/weather/controller.ts:260-264 — per rain drop: lineStyle/beginPath/moveTo/lineTo/strokePath
- node_modules/phaser/src/gameobjects/graphics/Graphics.js:1231-1239 — fillEllipse allocates Ellipse + getPoints array each call
- node_modules/phaser/src/renderer/webgl/pipelines/MultiPipeline.js:800-814 — Earcut triangulation of every fill path at render time
- scratchpad microbench (Phaser Ellipse.getPoints + Earcut only): 0.40 ms @270 lobes, 0.77 ms @600 lobes per frame on desktop

**Fact-check (partially confirmed, confirmed, partially confirmed).**

The fog part is fully accurate. Corrections to the details:
1. **Rain is a minor cost, not a stutter cause on its own.** It draws at most 130 one-pixel strokes, which allocate about 500 small objects per frame, plus only 4-28 extra fog ellipses. Rain's real problem is in the editor: EditorScene.ts:1237-1249 calls editRuntime.exportRoomSnapshot() and buildRoomWeatherSurfaceSegments() every frame while rain is previewed, with no cache. The fix is to cache the surfaces by room version or a tile-edit counter, as the play path already does with getCachedRoomWeatherSurfaceSegments.
2. **getPoints(18) creates 18 Vector2 objects, not 19.** The 19 Point objects are created on the render side.
3. **Allocations are about 16k per frame at the default intensity of 50 and about 36k at 100.** "Tens of thousands" is only true at high intensity.
4. **Fill-rate overdraw is probably the larger phone cost.** Fog ellipses cover about 11 times the room's area at default intensity and about 40 times at max, all alpha-blended. This makes baking the bands into textures (or one low-resolution fog RenderTexture) even more worthwhile.

Additions and precision:

1. The per-frame cost is worse in the editor, and the claim misses it. EditorScene.ts:1018 calls updateWeatherPreview() every frame. In rain mode, EditorScene.ts:1239 calls editRuntime.exportRoomSnapshot() every frame. That serializes the whole room: tileData, mapped placedObjects, customSprites, and copies of custom-tile pixel arrays (editRuntime.ts:615-648). Then buildRoomWeatherSurfaceSegments rescans every tile (surfaces.ts:40-60). The fix is to cache segments keyed on the room's edit revision, like the overworld's getCachedRoomWeatherSurfaceSegments.

2. Allocation count is about 60 short-lived objects per ellipse (Ellipse, getPoints array plus points, renderer Path plus about 19 Points, Earcut linked-list nodes). That is about 16k per frame at intensity 50 and about 36k at 100, so "tens of thousands" is accurate only at higher intensities.

3. A band is not quite a rigid translation. Both baseX/baseY (:343-353) and each lobe x/y (:361-370) are clamped to the room bounds, so lobes near the edges stop at the wall instead of drifting. Baking per band changes edge behaviour slightly; drawing the baked band clipped to the room bounds is fine.

4. On phones the bigger cost is probably fill rate. Up to 600 translucent ellipses, roughly 100-500 px wide, cover the room area many times over. Baking each lobe group into about 30 band images keeps much of that overdraw. Baking the fog into 1-3 layered RenderTextures, with small parallax offsets, cuts both CPU and fill cost.

5. The rain fillRect(x, y, 1, len) suggestion is valid. FILL_RECT goes straight to batchFillRect with no Path or Point allocation (GraphicsWebGLRenderer.js FILL_RECT case). Snow already uses fillRect.

6. Severity is limited because the cost applies only in play mode, in the current room, and only when that room has fog or rain set.

Change the claim in four ways:

1. **Narrow it to fog.** Rain costs about 130 Paths and 260 Points per frame, which won't cause stutter on its own. Drop rain as a stutter cause, or demote rain switching to fillRect to a nice-to-have.
2. **Use the verified fog numbers.**
   - About 159, 270, 428 and 599 ellipses per frame at intensity 25, 50, 75 and 100.
   - Emulated draw-and-render cost on desktop: about 0.45 ms at 270 and 1.0 ms at 600, before WebGL vertex work.
   - About 16k to 36k throwaway objects per frame.
   - Overlap: the fog blobs stack about 11 layers deep over the room at default intensity and about 39 at max, all alpha-blended. On phones this overdraw is likely as costly as the CPU work, or more.
3. **Keep the fix and add a simpler option.** Option 1: bake each band into a texture per room and intensity, then move the images. Option 2: generate one soft-blob texture once and draw the lobes as Blitter bobs or pooled Images at fixed offsets. Either removes the per-frame shape cutting and garbage.
4. **Add the missed editor case.** With rain selected, EditorScene.updateWeatherPreview (EditorScene.ts:1237-1250, called every frame from update() at :1017) runs editRuntime.exportRoomSnapshot(), a full room copy, plus an uncached buildRoomWeatherSurfaceSegments() every frame. Rebuild the surfaces only when the room is edited, for example from markRoomDirty or a version counter.

Weather is off by default and set per room (weather/model.ts:12-15), so only rooms that use fog are affected. Impact: medium.

### F005: Dark rooms redraw the darkness with two GPU passes per light, every frame

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** defect · **impact:** medium · **effort:** small
- **Flagged before:** 2026-07-13 §2.1 (updateRoomLighting allocations) and 2026-07-29 plan 'Lighting emitters: Open — persist structure and mutate positions in place'. The GPU pass-per-emitter problem is new.

**Summary.** In 'dark' rooms, every torch, lava strip and the player's own light is cut into the darkness one at a time. Each one makes the graphics chip switch drawing targets and copy a whole room-sized image. A room with 15 lights does about 60 of these switches every frame, which is very expensive on phone GPUs. All lights can be drawn in one batch with the same look.

**Technical detail.**

lighting/controller.ts:197-262 runs every frame: overlay.clear(); overlay.fill(); then for each emitter overlay.erase(key,x,y) (:229), and for each glowing emitter glowOverlay.drawFrame(...) (:250).

In Phaser 3.90, each DynamicTexture draw/erase/drawFrame wraps its own beginDraw → renderer.beginCapture → endDraw → blitFrame (DynamicTexture.js:630-747, 982-1006, 1212-1243). beginCapture binds and clears the renderer's shared capture RenderTarget, resized to 640×352 (WebGLRenderer.js:1378-1386; RenderTarget.js:306-336), and endDraw blits it into the RT. So each frame costs about 2 + 2·(emitters + glow emitters) framebuffer switches, each with a full 640×352 clear and blit. Tile-based mobile GPUs flush tile memory on every switch. Lava surfaces become one emitter per ≤4-tile strip (emissiveSources.ts:18-19, 217-257), so lava rooms reach 20+ emitters easily.

Fix (identical output, since sequential erases multiply (1-a1)(1-a2), the same as one composited erase):
```
overlay.clear(); overlay.fill(...);
overlay.beginDraw();
for (const e of emitters) overlay.batchDrawFrame(key, undefined, x, y);
overlay.endDraw(true); // erase
glowOverlay.beginDraw();
// batchDrawFrame(key, undefined, x, y, alpha, tint) per glow emitter
glowOverlay.endDraw();
```
Also redraw the glow layer only if something flickers, and update flicker at 20-30 Hz.

Texture churn: flicker changes the rounded diameter each frame, and ensureRoomLightTexture (:463-495) creates a new canvas texture with a radial gradient and a GPU upload for every new diameter key `${prefix}_${d}`. These are never freed, causing first-seconds hitches and memory creep. Pre-create one max-size gradient per profile and stamp a scaled Image via batchDraw instead.

CPU side (previously recommended): OverworldPlayScene.ts:2460-2550 rebuilds emitters every frame with Array.from().filter().map(), three spreads, a bounds object and buildAmbientRoomLightingBounds (8 getCellStateAt string lookups; overworld/lighting.ts:19-50), even when the room's lighting mode is off. Early-out when mode !== 'playerAuraDark' and keep a persistent emitter array.

**Evidence.**

- src/lighting/controller.ts:197-262 — per-frame clear/fill, then erase() per emitter and drawFrame() per glow emitter
- node_modules/phaser/src/textures/DynamicTexture.js:700-747,982-1006,1212-1243 — each draw/erase/drawFrame is its own beginCapture→endCapture→blitFrame
- node_modules/phaser/src/renderer/webgl/WebGLRenderer.js:1378-1386 — beginCapture binds the shared render target (clears and resizes it)
- src/lighting/controller.ts:463-495 — new canvas texture + radial gradient + upload for every distinct flicker diameter
- src/lighting/emissiveSources.ts:18-19 — lava/surface strips split into ≤4-tile emitters
- src/scenes/OverworldPlayScene.ts:2460-2550 — emitter arrays and ambient bounds rebuilt every play frame, even with lighting off

**Fact-check (confirmed, confirmed, partially confirmed).**

Minor points:
1. "Memory creep" overstates it. The texture cache grows only to the number of distinct integer diameters each light profile's flicker can produce. Radius amplitudes are 0.06–0.17 (src/config/tilesets.ts:529-553, src/config/objects.ts:35), so it settles at roughly tens of small textures per profile. They are never freed, but the count does not keep growing. The real cost is canvas gradient creation and GPU uploads during the first seconds in a flickering dark room.
2. The overlay.fill() and the two clear() calls each add a framebuffer bind, so the "+2" is really about 3. This is immaterial.
3. All the GPU cost applies only to rooms with lighting mode playerAuraDark, a builder opt-in. The per-frame CPU allocations happen in every room.
4. The OverworldPlayScene range is 2460-2545, not 2460-2550.

Minor corrections:
(1) The pass count per frame is about 3 + 2·(emitters + glow emitters), not 2 + …: overlay.clear, overlay.fill and glowOverlay.clear each bind a framebuffer. The player and ghost emitters have no glowColor, so they add 2 switches each, not 4.
(2) Light-texture growth is a bounded cache, not open-ended "memory creep". Keys are integer diameters (`${prefix}_${d}`). Flicker amplitudes are 0.06–0.17 (src/config/tilesets.ts:529-553) on glow radii of about 10–65px, and player-aura diameters are clamped to 96–384 (src/lighting/presets.ts:13-16). That makes a few dozen small canvases per profile, created during the first seconds a flickering light is on screen (brief hitches) and kept for the session.
(3) The shared capture target resizes to 640×352 only once, not on every call. Only lighting uses RenderTextures, so it never flips between sizes.
(4) Static emitters are already cached per loaded room (worldStreaming.ts:3496/4493). The per-frame cost is the ghost filter/map, three spreads, the ambient bounds and the settings clone, which also run when lighting is off.
On impact: the GPU cost only applies to rooms set to 'playerAuraDark', and no profile has measured it, so medium is more defensible than high. Lava-heavy dark rooms on phones are the worst case.

The GPU mechanism and the batched-erase fix are correct: each emitter does its own capture (full 640×352 clear) plus a full-size blit, and batching gives the same output. Corrections:
(a) Remove the lava "≤4-tile strip" claim. No tileset uses 'surfaceStrip', and lava_surface is a single object emitter. High emitter counts actually come from per-tile emitters: Cybercity lights, fences and neon platforms, Cyber Text letters (44 glowing tile indices), cave lanterns and gothic candles. Every such tile adds a reveal pass and a glow pass, so dark Cybercity or text-sign rooms can reach 100+ passes per frame. Consider also merging adjacent same-profile per-tile emitters, for example by switching those profiles to surfaceStrip, which already exists but is unused.
(b) Gradient-texture churn is a bounded, one-time warm-up of a few dozen small canvases shared across all rooms, not unbounded memory creep. Keep "use one max-size gradient per profile and scale it" as a minor cleanup, plus dropping the per-frame key strings.
(c) The GPU cost only hits rooms set to 'playerAuraDark'. The CPU emitter rebuild runs in every room, but that was already recommended earlier (2026-07-13 §2.1; 2026-07-29 'Lighting emitters: Open').

### F080: Portrait play draws the whole game behind the opaque controller panel, wasting ~35–40% of rendering

- **Area:** Mobile experience (code review)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** In portrait play, the controller panel covers the bottom ~300px of the screen, but the game still draws the world under it. On a typical phone that's over a third of the rendering work for pixels nobody sees. Shrinking the game area to the part above the controller is a cheap speed-up on the devices that need it most.

**Technical detail.**

In focused-room portrait mode #app is a single 1fr row (phone-portrait-world-hud.css:17-23, #bottom-bar hidden), so #game-container and the Phaser RESIZE canvas (main.ts:93-96) fill 100dvh. #mobile-play-controls is position:fixed with an opaque paper background, height calc(--mobile-portrait-console-height + safe-bottom) (phone-portrait-play-controls.css:57-67), with console height clamp(294px, 36vh, 318px) (phone-portrait-world-hud.css:2). The camera compensates with a 0.34 target-Y offset (camera.ts:73-88) so the player sits in the visible part. Fix: in body[data-mobile-portrait-play='true'], give #game-container height calc(min(100dvh, var(--app-viewport-height)) - var(--mobile-portrait-console-height) - var(--safe-bottom)), or set grid-template-rows to minmax(0,1fr) var(--console). Then retune mobilePortraitCameraTargetY toward 0.5 and re-run the smoke's playerScreen placement check (mobile_smoke.mjs:331-340). Less fill-rate, smaller render targets, and a smaller visible-world rect for streaming and LOD. Also consider making the console height scale down on short screens: on an iPhone SE in Safari, 294px is about 53% of the visible height.

**Evidence.**

- src/styles/sections/responsive/phone-portrait-world-hud.css:2 — console height clamp(294px, 36vh, 318px)
- src/styles/sections/responsive/phone-portrait-play-controls.css:57-67 — fixed, opaque console over the canvas
- src/styles/sections/responsive/phone-portrait-world-hud.css:17-23 — game row still spans the full height in play
- src/scenes/overworld/camera.ts:73-88 — camera offset used to keep the player above the console
- src/main.ts:93-96 — Phaser Scale.RESIZE sizes the canvas to #game-container

**Fact-check (partially confirmed).**

Shrinking the canvas is a correct, small fix, but the performance gain is modest, not "~35–40% of rendering." The canvas has no devicePixelRatio scaling (Phaser 3.90 RESIZE at CSS-pixel size), so GPU fill-rate savings are small. The real saving is CPU-side culling and batching of tiles and sprites in the hidden band, plus `worldView`-based overlay loops. Fixed per-frame costs are unchanged.

The smoke assertions to update are at scripts/mobile_smoke.mjs:~343-352, including a hard `targetY === 0.34` check. They are not at 331-340.

The bigger reason to do this is a likely visible defect the claim missed. Rooms with "Center and hold camera" (cameraController.ts:66-69) center the room on the full canvas height. On a portrait phone, by arithmetic, the bottom third or so of the room would sit behind the opaque console. A shorter `#game-container` in portrait play fixes both problems.

Watch out for one side effect. RESIZE will then refit the canvas on every play start and stop, and whenever 36vh changes as Safari's toolbars move. Check that fit zoom, streaming and the overlays tolerate that.

### F011: 'Battery Saver' and auto-reduced mode don't turn down any visual effects

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Phones automatically get a 'reduced' performance mode, and players can pick Battery Saver, but both only change how many rooms load. Fog, rain, dark-room lighting, parallax backgrounds and effect sprites run at full cost either way. Reduced mode should halve the weather particles, update lighting less often and skip purely cosmetic extras, giving phones a built-in safety valve.

**Technical detail.**

performancePolicy.ts resolves visualDataProfile and activeRuntimeProfile, but the only consumers are worldStreaming.ts:486-487, 1211, 2704, 5693 and roomComments.ts:1315/1401/1513. These ignore it entirely:
- weather particle and band counts (weather/controller.ts:174-191);
- the lighting per-frame redraw (lighting/controller.ts:197-262);
- FX spawns and score Text (fx/controller.ts:28-262);
- the starfield and parallax updates (backdropController.ts:75-91).
deviceLayout.ts:45-60 already marks every coarse-pointer device as 'reduced', so wiring this reaches all phones automatically.

Proposal: inject a getRuntimeProfile() into RoomWeatherController, RoomLightingController and SceneFxController. In 'reduced':
- weather counts ×0.5;
- lighting redraw at 30 Hz, with the glow pass only when something flickers;
- score popups off (or BitmapText);
- parallax layers beyond the first two frozen.
Also have the performance advisor's 'render-gpu-pressure' / 'sustained-frame-pressure' reasons (performanceAdvisor.ts:7-11) suggest Battery Saver to the player. Desktop visuals stay unchanged.

**Evidence.**

- src/performance/performancePolicy.ts:37-90 — profiles resolved (visualData/activeRuntime/memory)
- src/scenes/overworld/worldStreaming.ts:486-487,1211 — the only gameplay-loop consumers of the profile (streaming)
- src/weather/controller.ts:174-191 — particle and fog-band counts independent of device profile
- src/ui/deviceLayout.ts:45-60 — all coarse-pointer devices resolve to 'reduced'
- src/performance/performanceAdvisor.ts:7-11 — advisor already classifies render/GPU pressure reasons

**Fact-check (partially confirmed).**

Remove "only change how many rooms load". The reduced profile already halves the frame-work budget, limits room-background parallax updates to the current room in play (worldStreaming.ts:2076-2084), throttles comment danmaku, and lowers preview LOD.

Remove the parallax and starfield freeze item. It is already partly handled and saves almost nothing (backdropController.ts:75-91 only sets tilePosition).

Remove "have the advisor suggest Battery Saver". It already does, for both reasons (performanceAdvisor.ts:795/809, performanceSuggestionModal.ts:72).

Reframe the finding:
- On phones, Auto already resolves to reduced (performancePolicy.ts:73-77), so Battery Saver is about the same as Auto there. The only difference is retainReleaseGrace (worldStreaming.ts:5693).
- Yet the advisor offers it, and the copy promises "reduces background and visual work".
- Give Battery Saver, and optionally the reduced profile, real visual levers:
  - weather particle and fog counts ×0.5 (weather/controller.ts:174-191);
  - skip the lighting glow RenderTexture pass when no emitter glows or flickers. Otherwise, cache static-emitter erases and redraw only the moving player and ghost reveals.
  - score popups off, or pooled BitmapText instead of add.text per collect (fx/controller.ts:242).
- Avoid 30 Hz lighting. The player's reveal aura would visibly lag the player.
- Gate the stronger cuts on selectedMode==='battery-saver' so Auto on phones does not lose visual quality silently.
- Plumb the same getter into EditorScene.ts:1215/1240.

### F008: Physics collision links grow with every room loaded, and are all rebuilt on room loads, bullet despawns and crate breaks

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** 2026-07-13 §2.5 'Physics scope'; 2026-07-29 plan 'Collider consolidation: Open' (grouped-physics migration deferred). Still undone.

**Summary.** Each enemy, crate and NPC gets its own collision link to the terrain of every loaded room, and to every solid object anywhere in the loaded area. On desktop that adds up to thousands of links. Whenever a room loads, a cannon bullet disappears (every 1.4 s per cannon) or a crate breaks, all of those links are thrown away and rebuilt. That causes hitches when crossing rooms and in cannon rooms. Things should only be linked to nearby things, and links should be updated one object at a time.

**Technical detail.**

interactionCoordinator.ts:283-400 syncWorldColliders: for every dynamic live object it destroys its colliders (:307), then adds:
- one collider against every room's terrainLayer and terrainInsetBodies (:318-338);
- one collider against every runtime solid in all rooms (:340-397).
The total is about D×R×2 + D×S colliders.

It is called (via liveObjects.ts:534-538) on:
- every full-room activation/replacement (worldStreaming.ts:3339, 3553, 4644, 4715, 5493, 5578);
- every removeLiveObject (liveObjects.ts:2303-2318), which hazardController calls whenever a cannon bullet hits a wall, leaves the room or times out (hazardController.ts:188-218; CANNON_FIRE_DELAY_MS = 1400 at OverworldPlayScene.ts:391);
- crate/brick breaks (liveObjects.ts:2293), respawns (enemyLifecycle.ts:375) and trigger spawns (triggerController.ts:711, 790).

Phaser's ProcessQueue remove/update use indexOf + splice over all active colliders (node_modules/phaser/src/structs/ProcessQueue.js:201-296), so a full rebuild is O(C²). Desktop microbenchmark of the queue bookkeeping alone: 0.47 ms at 1,000 colliders, 3.1 ms at 3,000, 10.6 ms at 6,000, before allocating new Collider objects and closures. Every physics step also iterates all C colliders. Phones are partly shielded by the reduced profile's single full room (previewStreaming.ts:49), but desktops/tablets in default or full quality load 9 rooms (previewStreaming.ts:13, 48).

Fix, incrementally:
(1) Create terrain colliders only for the object's own and adjacent rooms.
(2) Create pairs only within the same or adjacent rooms.
(3) On single-object add/remove, touch only that object's colliders plus the reverse-indexed pairs that reference it. Bullets already self-register (hazardController.ts:496-552), so their removal needs no global rebuild.
(4) Finish the 07-29 category-group migration (one collider per category group).

**Evidence.**

- src/scenes/overworld/liveObjects/interactionCoordinator.ts:318 — `for (const collisionRoom of rooms)` creates terrain colliders vs every loaded room
- src/scenes/overworld/liveObjects/interactionCoordinator.ts:340 — pairwise colliders vs every solid obstacle in all rooms
- src/scenes/overworld/liveObjects.ts:2315 — removeLiveObject triggers syncWorldObjectColliders(all rooms)
- src/scenes/overworld/liveObjects/hazardController.ts:188-218 — every bullet despawn goes through removeLiveObject
- src/scenes/overworld/worldStreaming.ts:3553 — full-room activation triggers a full collider rebuild
- node_modules/phaser/src/structs/ProcessQueue.js:201-296 — indexOf/splice per removal → O(C²) rebuilds
- scratchpad microbench: ProcessQueue full rebuild 3.1 ms @3,000 colliders, 10.6 ms @6,000 (desktop)

**Fact-check (partially confirmed).**

Tablets and other coarse-pointer devices automatically use the reduced profile (1 full room). They only get 9 rooms if the user picks full-quality mode. Desktops with 4 or fewer cores or 4 GB or less of memory are also reduced. Local play pressure (playPressure.ts:76-80) already drops to 1 full room when the 3×3 area has a pressure score of 620 or more, so the densest areas, such as spawn next to the 119-crab room, are already capped. The real exposure is mid-density areas: the Learn2WAMP 2 (1,-1) area scores 586, keeps 9 rooms, and builds an estimated 1,950–2,400 colliders, with cannons in 1,-1 and 1,-2. The ×2 terrain factor only applies to rooms that have inset tiles. Distance sleeping removes far objects from the rebuild, which shrinks C. Because colliders are destroyed before the body.enable check, a sleeping enemy also loses its colliders on every rebuild and gets nothing back when it wakes. The incremental per-object fix should handle this too: re-add colliders when an object wakes, or keep colliders through sleep. Most of the queue cost comes from ProcessQueue.add's pending.indexOf scan. Measured: 1.56 ms at 2k colliders, 3.07 ms at 3k, 10.9 ms at 6k on desktop, before allocating new colliders and closures.

### F010: World-map tile code re-scans every tile it has ever seen, every frame, and never forgets any

**Delivery update.** Delivered 2026-10-03 (`57b607c7`): direct address/task lookups, stable coverage/candidate/identity caching, relevant availability refresh and a 2,048-entry metadata soft cap replace history-wide frame scans. Timed LOD/fallback transitions remain active every frame. A 20,000-history regression, protected metadata, retries and transition tests pass. See [delivery evidence](../development/checkup-map-recovery-2026-10-03.md).

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** When the tile map is on, the game walks through every map-tile description it has downloaded this session on every frame, building text keys for each one. It does this even when the camera hasn't moved, and even while you're playing a room. The list only grows the more you browse. The work should be skipped when the camera is still, and far-away tiles should be forgotten. This is dormant today because tiles are off in production, but it switches on the moment they're fixed.

**Technical detail.**

worldTiles/controller.ts:411-505 update() is called every frame in both browse and play (worldStreaming.ts:1143-1157; the only gate is urgent destination work). Each frame it does:
- recomputes coverage (:446);
- queueCoverageImages (:960-1025), which does `[...this.entriesByKey.values()].flatMap(...)` (:992), building a worldTileAddressKey template string (types.ts:89-91) and up to 5 Set lookups per known entry, plus sibling/ancestor closures and rankWorldTileRequests;
- syncCoverage (:1392-1470), which resolves display plans per target;
- phaserLayer.syncDisplay, which joins a signature string over all displayable keys (phaserLayer.ts:137-148).

entriesByKey (:198) and availabilityByKey are only ever .set (:921, :946-955) and never pruned. refreshAvailability (:942-958) allocates a new object per entry after every upload batch (:1381-1382).

Fix:
- Early-out when the camera rect/zoom signature, manifest generation, queue depths and an availability revision are all unchanged; cache the last coverage result.
- In play mode, run refinement only on zoom changes or at ≤4 Hz.
- Iterate the candidate key sets (visible/sibling/ancestor/guard) instead of all entries.
- Cache address keys on the entries.
- LRU-evict entries and availability outside a generous camera radius (lru.ts already exists in this folder).

**Evidence.**

- src/scenes/overworld/worldTiles/controller.ts:411-505 — full coverage pipeline every frame with no camera-unchanged short-circuit
- src/scenes/overworld/worldTiles/controller.ts:992 — [...entriesByKey.values()].flatMap over all known entries each frame
- src/scenes/overworld/worldTiles/controller.ts:198,921 — entriesByKey only grows (no delete/evict)
- src/scenes/overworld/worldTiles/controller.ts:942-958 — refreshAvailability allocates an object per entry
- src/scenes/overworld/worldTiles/phaserLayer.ts:141-143 — per-frame signature string join of all displayable keys
- src/scenes/overworld/worldStreaming.ts:1143-1157 — updateWorldTiles runs in play mode too

**Fact-check (confirmed).**

Corrected and added details:
1. **A blanket "skip when the camera is still" is unsafe.** syncCoverage's level commit (selectWorldTileDisplayLevel uses nowMs and lastGestureAtMs) and fallback.evaluate(nowMs) depend on time. If update() exits early only when the camera, manifest and queues are unchanged, it can stall LOD commits and fallback timers. The early-out key must also cover pending level decisions and fallback state, or those time-based parts must keep running.
2. **The lowest-risk, highest-value fix is narrower.** In queueCoverageImages, loop over the union of visible, sibling, ancestor, guard and selected keys and call entriesByKey.get on each, instead of `[...entriesByKey.values()].flatMap`. Cache each entry's address key.
3. **A second full scan the claim misses:** queueDueRetries (:1581) runs `[...this.entriesByKey.values()].find(...)` once per pending retry.
4. **The phaserLayer signature (phaserLayer.ts:141-143) only covers the visible and guard keys,** so it does not grow over a session. It costs a little every frame but is a minor part of the problem.
5. **Why it's dormant:** the production config returns available:false because the asset contract hash doesn't match (active 4b122cb7, expected d9d6c8cf). Redeploying or re-rendering the tile renderer will switch this code back on for 100% of users.

### F012: Leftover per-frame garbage in the play loop

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** improvement · **impact:** low · **effort:** small
- **Flagged before:** 2026-07-13 §2.1 'Per-frame allocation churn' (Array.from(loadedRooms) in updateLiveObjects was named explicitly); 2026-07-29 plan 'Small frame allocations: Open'.

**Summary.** A handful of small throwaway objects are still created every frame: copies of the room list, enemy speed settings, and run-recording frames even when no ranked run is being recorded. Each one is tiny, but together they keep the garbage collector busy, which shows up on phones as random micro-stutters. These are quick fixes.

**Technical detail.**

Per-frame allocations still in the loop:
- liveObjects.ts:792-794 `Array.from(loadedRooms).filter(r => !r.runtimeSuspended)` every frame. The input generator already filters runtimeSuspended (OverworldPlayScene.ts:2100-2106), so pass a reusable array instead.
- liveObjects.ts:835-842 + 911-934: getFlyingEnemyMotion returns a new {speed, waveAmplitude, waveSpeed} per flying enemy per frame. Settings are static, so cache per behavior.
- liveObjects.ts:902-907: carryMovingPlatformRiders receives a fresh options object with 3 closures each frame. Hoist it to a field.
- OverworldPlayScene.ts:2407 → getCurrentRankedRunTraceFrame (:4535-4561) builds 3 objects per frame before RankedRunTraceRecorder.recordFrame checks `active` (rankedRunTraceRecorder.ts:83-86). Check isActive() first.
- OverworldPlayScene.ts:2295: roomMusicPlaybackController.sync({...}) creates an object literal every frame.
- weather/controller.ts:79-92 and lighting/controller.ts:113-140 normalize/clone settings and allocate a new debugState every frame, even when off.

Validate with `npm run perf:runtime:mobile` GC totals. The 07-29 baseline was 392-671 ms of GC per 60 s trace.

**Evidence.**

- src/scenes/overworld/liveObjects.ts:792 — Array.from(loadedRooms).filter(...) each frame
- src/scenes/overworld/liveObjects.ts:911-934 — getFlyingEnemyMotion allocates a result object per enemy per frame
- src/scenes/overworld/liveObjects.ts:902 — carryMovingPlatformRiders options object with closures each frame
- src/scenes/OverworldPlayScene.ts:4547-4561 — ranked trace frame objects built every frame even when no trace is active
- src/scenes/overworld/rankedRunTraceRecorder.ts:83-86 — recordFrame returns immediately when inactive
- src/weather/controller.ts:79-92 — clone + new debugState object per frame on the 'off' path

**Fact-check (confirmed).**

The lighting item understates the cost, and the biggest allocation source is in the caller, not the controller. OverworldPlayScene.updateRoomLighting (OverworldPlayScene.ts:2460-2546) runs every frame in play (called at :2343 and :2427), even when the room's lighting mode is off. On each call it:
- builds ghost emitters with `Array.from(renderedGhosts.values()).filter().map()`;
- builds a new emitters array that spreads (copies) every static lighting emitter in the current room;
- calls buildAmbientRoomLightingBounds (scenes/overworld/lighting.ts:19-50) with 2 new closures, which does 8 getCellStateAt lookups (each builds a roomId string via roomIdFromCoordinates, selection.ts:139-140) and allocates coordinate and bounds objects;
- allocates bounds and debugCounts objects.
All of this is thrown away when lighting is off, because the mode check only happens inside lightingController.sync. updateRoomWeather (:2552-2591) has the same pattern on a smaller scale. The best fix is to return early in updateRoomLighting/updateRoomWeather when `currentRoom.lighting.mode` (or `weather.mode`) is off and the controller is already in its off state. Rooms that have lighting on should reuse a persistent emitters array and update positions in place, as the 07-29 plan says. Minor correction: the carryMovingPlatformRiders options object holds 2 new closures, not 3.

### F006: Every moving body re-scans the tile map and allocates ~100 small objects per frame for special-tile checks

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** improvement · **impact:** low · **effort:** small
- **Flagged before:** 2026-07-13 §2.1 flagged specialTiles copies. The 07-29 'reusable special-tile environments' fixed only the environment object, not the per-scan match allocations or tile decoding.

**Summary.** To know whether the player, enemies, crates and NPCs are on ice, conveyors, water, wind and so on, the game re-decodes nearby tiles from the room data every frame. For each body it also creates many temporary lists and text keys. Most rooms don't contain any special tiles at all. A tiny 'special tile map' per room, built once when the room loads, would make these checks nearly free.

**Technical detail.**

specialTiles.ts:439-500 scanBodyEnvironment runs every frame for the player (:224) and for each awake dynamic live object via liveObjects.ts:960-1004 (getSpecialTileEnvironmentForBody, wired at OverworldPlayScene.ts:692-693). Conveyor riders get a second contact scan (liveObjects.ts:936-958 → specialTiles.ts:249-266).

Allocations per scan:
- findSpecialTilesOverlappingBody / findSpecialTilesNearBody: a new bounds object (:578-588); iteration over all collision-ready rooms through a generator (OverworldPlayScene.ts:2100-2106); a new origin object per room (selection.ts:128-133).
- Per covered tile cell: findSpecialTilesAtRoomCell allocates an array, and decodeTileDataValue returns a fresh object for each of 3 layers (editorState.ts:162-175); results are merged with spread push (:701).
- findSpecialTilesAtGravityContact: 3 point objects, a Set and a template-string key per match; per point, a room-coordinates object, a roomId string and an origin (:590-670).
- getBodyRoomId builds a string per body per frame (:268-272).

Fix: on full-room activation, build `specialKindMask: Uint16Array(ROOM_WIDTH*ROOM_HEIGHT)` (one bit per SpecialTileKind, OR'd across layers) plus a `hasSpecialTiles` flag; patch them in breakSpecialBrickTile. The scan functions then walk integer tile ranges and set environment flags directly, with no match arrays, Sets or string keys. Skip bodies whose overlapping rooms have hasSpecialTiles=false, which is the common case. Resolve rooms with integer math and a packed-int Map key instead of 'x,y' strings. The existing WeakMap of reusable environments (:204-246) can stay.

**Evidence.**

- src/scenes/overworld/specialTiles.ts:439-500 — scanBodyEnvironment: overlap, near and contact scans for every body every frame
- src/scenes/overworld/specialTiles.ts:672-723 — findSpecialTilesInWorldRect / AtRoomCell allocate arrays, decode 3 layers per cell, spread-push matches
- src/scenes/overworld/specialTiles.ts:590-650 — contact scan allocates points, a Set and template-string keys per call
- src/scenes/overworld/liveObjects.ts:960-1004 — called for each dynamic live object each frame
- src/config/editorState.ts:162-175 — decodeTileDataValue returns a new object every call
- src/scenes/OverworldPlayScene.ts:2100-2106 — getLoadedFullRooms is a generator (new iterator per scan)

**Fact-check (confirmed).**

"~100 objects" is per body per frame, not per frame overall. Total churn scales with the number of awake dynamic bodies, so it only adds up in rooms with lots of enemies, crates and NPCs.

Fix-approach corrections:
1. Patching the mask in breakSpecialBrickTile is unnecessary. Breaking a brick changes only the Phaser terrainLayer, and the scans read room.tileData, which is not modified. Breakable brick also doesn't feed any environment flag.
2. Lifecycle hooks are simpler than "build on room activation". Build the mask lazily and cache it in a WeakMap keyed by the loadedRoom.room snapshot (or its tileData). It then rebuilds automatically when a room snapshot is re-hydrated.
3. Two cheap wins the claim didn't call out:
   - Reuse environment.conveyorX in applyConveyorToLiveObject instead of re-scanning. It is already computed in getEnvironmentForBody, but it isn't stored on liveObject.runtime.
   - Avoid the full scan for idle terrain NPCs that only need onDamage (liveObjects.ts:972-975).
4. Return a shared frozen constant from decodeTileDataValue for value <= 0. Empty cells are the most common case.

"Most rooms don't contain any special tiles" is plausible but not verified from the code. There is no profiler attribution for this path, so the payoff should be measured with perf:runtime:mobile in an object-heavy room.

### F013: Startup downloads all 480 art files in the game before anyone can play

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** high · **effort:** medium
- **Flagged before:** docs/2026-07-13-code-health-and-performance-recommendations.md 'Boot preload' bullet: 'load non-default background packs on first use, same pattern as avatars'. docs/2026-06-10-repo-improvement-plan.md §1.5: fold co-loaded art into texture atlases. Both are still undone, and the 221-file tree pack landed afterward, nearly doubling the boot request count.

**Summary.** Before the first room appears, the game downloads every one of its 480 art files (2.5 MB): every tree, every background theme, every object. A single room uses only a handful. The 221-image tree pack alone is almost half of those files and about 60% of the bytes. Loading art only when a room needs it would cut several seconds of waiting on phones and lower the risk of graphics-memory crashes.

**Technical detail.**

BootScene.preload queues every TILESET (BootScene.ts:136-139), every BACKGROUND_GROUPS layer (141-147: 11 themes, 55 layers, 433 KB) and every GAME_OBJECTS sheet (149-156: 353 sheets, 1.6 MB). I bundled the registries and enumerated them: 483 load calls, 480 unique URLs, 2.54 MB. GAME_OBJECTS includes DEVKIDD_TREE_DECORATION_OBJECTS (objects.ts:203-243, spread at :375): 221 PNGs, 1.51 MB, added in commit 80081eab on 2026-08-13 with no guard.

Memory: the decoded RGBA size of the boot set is about 109 MB (trees 39 MB, backgrounds 35 MB, avatar sheets 28 MB). It is uploaded as about 475 separate WebGL textures before the first frame. The repo already ships a WebGL stall/context-loss recovery monitor (src/main/webglRecovery.ts, 92c29558), and GPU memory pressure is a classic trigger on iOS.

The tree sprites are about 70% transparent padding: trimmed bounding boxes are 29.4% of canvas area, and only 9.9% of pixels are opaque.

Fix:
(1) Boot only a core set: default tilesets, objects whose behavior is not plain decoration, the default background, and player/enemy sheets.
(2) Add ensureSceneObjectTexturesLoaded(scene, objectIds) and ensureBackgroundGroupLoaded(scene, id), modeled on src/player/avatar/dynamic.ts:114 (enqueueSceneLoad + scene.load). Call them when a room snapshot hydrates (liveObjects, chunkPreviewRenderer, editor palette pick, background change). Skip or placeholder until loaded, then redraw.
(3) At build time, pack each tree family and decoration group into a trimmed atlas with frame offsets (sharp/free-tex-packer). That turns 221 requests into 11 and cuts tree GPU memory from about 39 MB to about 12 MB.

Target: boot requests ~480 → ~60, bytes 2.5 MB → ~0.5 MB.

**Evidence.**

- src/scenes/BootScene.ts:136-156 — loops load every tileset, every background layer of all 11 themes, and every GAME_OBJECTS sheet in preload()
- src/config/objects.ts:203-243,375 — 11 Devkidd tree families x ~20 = 221 separate PNG objects spread into GAME_OBJECTS
- Enumeration of the BootScene lists (esbuild-bundled registries): 480 unique URLs, 2,535,560 bytes; 221 tree files = 1,514 KB; 55 background layers = 433 KB
- Sum of PNG IHDR width*height*4 over the boot set = 109.1 MB decoded (trees 39.0 MB, backgrounds 35.3 MB, avatar sheets 28.4 MB; PlayerSheet.png alone is 1344x4032)
- Alpha analysis of the 221 tree PNGs: trimmed bbox = 29.4% of canvas pixels, opaque = 9.9%
- src/player/avatar/dynamic.ts:114 — existing ensureSceneAvatarPackLoaded lazy-load pattern to copy

**Fact-check (confirmed).**

Two details need softening:

1. **"Before the first room appears" overstates the wait.** A pre-rendered world image is painted before Phaser boots (src/main/coarseFirstStartup.ts, earlyWorldTileBootstrap). What waits on BootScene preload is the point where the game becomes playable.
2. **"Several seconds on phones" applies to first visits.** public/_headers serves /assets/* as immutable with a one-year cache. On repeat visits the saving is PNG decode plus about 109 MB of WebGL texture upload per session, not download time.

Minor fixes and scoping notes:
- BACKGROUND_GROUPS has 12 entries. One of them, "none", has 0 layers.
- feature-ledger.md:32 still marks the Devkidd tree pack as "Not deployed", but commit 80081eab is in main.
- BootScene.create() also builds animations from every GAME_OBJECT texture. Lazy-loading should either be limited to static decorations and backgrounds, or move that animation setup into the lazy path.

### F014: Android phones download game art only 6 files at a time

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The game engine's default on Android is to download just 6 files at once; iPhone and desktop get 32. With 480 startup files, Android players sit through about 80 back-to-back network round trips, probably 5–7 extra seconds on 4G. A one-line settings change fixes it.

**Technical detail.**

Phaser sets loaderMaxParallelDownloads = GetValue(config, 'loader.maxParallelDownloads', Device.os.android ? 6 : 32). The game config in src/main.ts:76-101 has no `loader` key, so the 6-file default applies on Android. wamp.land serves over HTTP/2 (alt-svc advertises h3), so this HTTP/1.1-era cap does nothing useful.

Math: 480 requests ÷ 6 slots × ~100–120 ms per request on 4G ≈ 8–10 s. At 24 slots it becomes bandwidth-bound, about 2.5 s for 2.5 MB.

Fix: add `loader: { maxParallelDownloads: 24 }` to the Phaser.Types.Core.GameConfig. This also speeds the later scene.load calls for avatar packs and any lazy art from the previous finding. Verify with Chrome device emulation (Android UA + Slow 4G throttling) and scripts/mobile_smoke.mjs. Worth shipping today on its own, even before cutting the file count.

**Evidence.**

- node_modules/phaser/src/core/Config.js:501 — loaderMaxParallelDownloads = GetValue(config, 'loader.maxParallelDownloads', (Device.os.android) ? 6 : 32)
- src/main.ts:76-101 — GameConfig sets renderer, scale, physics and input but no loader block
- curl -D - https://wamp.land/ → HTTP/2 with alt-svc h3=":443" (multiplexing available)
- BootScene enumeration: 480 unique URLs queued in preload()

**Fact-check (confirmed).**

The penalty only hits first visits or cold caches. /assets/* is cached as immutable for a year (public/_headers:1-2, confirmed live), so returning Android players load from disk cache and barely notice the cap. The exact count is 469 unique image URLs plus avatar atlas texture/JSON pairs, about 2.26 MB in total. Phaser refills its download slots continuously rather than in fixed batches, but the ~8 s versus ~2 s estimate on 4G still holds. When verifying, disable the browser cache, otherwise the improvement won't show up.

### F094: Custom backgrounds always download the full original file (one is an 8.3 MB animated GIF)

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** One player-uploaded room background is an 8.3 MB animated GIF. The game downloads all of it just to show one still 480x270 frame, and it loaded during the very first visit. On phone data that's a long wait, and it costs bandwidth for every visitor near that room.

**Technical detail.**

In-game loads always request the full 'image' variant: src/backgrounds/runtime.ts:86 (layer path), :240 (scene.load.image), :336 (fetchAndDecode). They decode with createImageBitmap/Phaser, which only uses the first GIF frame. The Worker proxies Cloudflare Images with only 'image' or 'thumbnail' variants (src/cloudflare/worker/backgroundImages/routes.ts:471), and the upload cap is 8 MB (routes.ts:33 DEFAULT_MAX_UPLOAD_BYTES). Fix: add a 'game' Cloudflare Images variant (fit=scale-down, width≤1280, format=auto/webp, anim=false, metadata=none) and use it for all in-game loads. Use the existing 'thumbnail' variant for browse/LOD previews. Optionally transcode at finalize and lower BACKGROUND_UPLOAD_MAX_BYTES to about 2 MB. A 480x270 still should come out around 30-60 KB.

**Evidence.**

- Live cold load (desktop, cache disabled): api.wamp.land/api/background-images/59f7f031-fba7-4447-550d-4f8b96bf4000/image = 8,144 KB, fetched at t≈6.0-7.1s while still on the welcome screen
- curl GET of that URL: content-type image/gif, content-length 8337652, 'GIF image data, version 89a, 480 x 270'
- Ten other custom backgrounds loaded in the same session (10-224 KB each)
- src/backgrounds/runtime.ts:86,240,336 — always getBackgroundImageUrl(id) with the default 'image' variant
- src/cloudflare/worker/backgroundImages/routes.ts:33 — 8 MB default upload cap; :471 — only 'image'|'thumbnail' variants

**Fact-check (confirmed, confirmed, partially confirmed).**

Three corrections to the suggested fix, plus one more cause the claim missed:

1. **The 'thumbnail' variant does not help today.** routes.ts:1068-1074 maps both kinds to env-configured variant names, and docs/development/environment.md:71-72 sets both to 'public'. A live Range GET of ?variant=thumbnail returned the same 8,337,652-byte GIF. Fix: create real Cloudflare Images variants:
   - a 'game' variant (scale-down to ≤1280, anim=false, metadata stripped)
   - a small thumbnail variant
   
   Point CLOUDFLARE_IMAGES_BACKGROUND_VARIANT and CLOUDFLARE_IMAGES_THUMB_VARIANT at them. chunkPreviewRenderer.ts:527 should use the thumbnail. Much of this is configuration, not code.

2. **Format negotiation alone is not enough.** With 'Accept: image/avif,image/webp' the same image comes back as a 2,761,006-byte animated WebP. The fix needs anim=false, not just format=auto.

3. **GIFs should never have been accepted.** ALLOWED_MIME_TYPES (routes.ts:32) is jpeg/png/webp only. But normalizeMimeType (routes.ts:275, :1163-1168) checks only the content type the client says it is sending. The bytes go straight to the Cloudflare direct-upload URL (routes.ts:988), and nothing checks the real format afterwards. Finalize should look up the stored image's real format and size from Cloudflare and reject or flag animated or oversized files. Lowering BACKGROUND_UPLOAD_MAX_BYTES only limits the size the client declares.

4. **Minor:** the HEAD request returned 404 in production, so the route does not answer HEAD. Use a Range GET to inspect these files.

The core claim holds. Four corrections to the details and the suggested fix:

1. **The thumbnail variant is not smaller in production.** It returns the same 2,761,006-byte webp as the 'image' variant, because `CLOUDFLARE_IMAGES_THUMB_VARIANT` is 'public', the same as the image variant (`environment.md:72`). So "use the existing thumbnail variant for LOD previews" saves nothing until a real small variant is set up.
2. **Cloudflare already converts to WebP, but the game never asks for it.** Cloudflare serves WebP when the request's Accept header includes image types. The game's `fetch` (`runtime.ts:336`) and Phaser's XHR loader send `*/*`, so they get the raw 8.3 MB GIF. Adding `Accept: image/avif,image/webp,*/*` to the `fetch` at `runtime.ts:336` gets 2.76 MB right away. Phaser's `scene.load.image` path (`runtime.ts:240`) sends no Accept header, so it needs a variant, a URL change or a switch to the `fetch` path.
3. **Fixing it properly still needs a still, size-capped variant.** That means a variant with a width cap and no animation, in a modern format. My understanding (not verified) is that named Cloudflare Images variants only take fit/width/height/metadata. If so, `anim=false` and a format setting need flexible variants (for example `/w=1280,anim=false,f=auto`) or a re-encode when the upload is finalized.
4. **The bigger hole is the upload check.** GIFs should never have been accepted (`routes.ts:32`). The server trusts the browser's declared content type and size (`routes.ts:275-276`), and finalize (`routes.ts:322-345`) never checks the stored file's real format or size. Finalize should reject or re-encode files that are animated, the wrong format or over the size cap.

Narrow the claim to animated or misnamed uploads. Normal still images are already downscaled and recompressed by the 'public' variant (1.4 MB JPEG uploads are served at 125-160 KB). Do not rely on the 'thumbnail' variant: in production it is the same 'public' variant (routes.ts:1071-1074, environment.md:71-72), and ?variant=thumbnail returns the identical 8.3 MB GIF.

The root cause is that a GIF named "IMG_1667 - Copy.png" got past the PNG/JPEG/WebP allowlist:
- The client checks only file.type, which comes from the file extension (uiBridge.ts:1664).
- The worker trusts the contentType and sizeBytes the client declares (routes.ts:274-276).
- Direct upload means the worker never inspects the bytes, and finalize never checks the format.

Corrected fix, in order:
1. Immediate: an admin rejects or replaces background 59f7f031.
2. In Cloudflare Images, create a non-animated game variant (scale-down to about 1024-1280 px wide, anim=false, ideally with format forced to WebP), or turn on flexible variants. Then point CLOUDFLARE_IMAGES_BACKGROUND_VARIANT at it, or add a 'game' kind that runtime.ts:86/240/336 and chunkPreviewRenderer use.
3. At finalize, check the real file type from its first bytes (or the Cloudflare image metadata) and reject GIF/animated files or mismatched types. Also check the real size, not just the declared one.
4. Optionally create a truly small thumbnail variant for LOD chunk previews and the editor picker (uiBridge.ts:1570).

### F017: Game art PNGs are about twice as big as they need to be

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The art files are saved inefficiently. Re-saving the startup art with zero quality change (pixel-identical) shrinks it from 2.4 MB to 1.2 MB, and lossless WebP gets it to 0.8 MB. That's free speed for every new player, and an automatic step would keep new art packs from ever shipping bloated.

**Technical detail.**

I measured with sharp (already a devDependency) on the 475 boot PNGs:
- Original: 2,414,654 B
- PNG compressionLevel 9 + adaptive filtering: 1,214,064 B (−50%)
- Lossless WebP: 808,244 B (−67%)

By group (original → PNG → WebP): trees 1514 → 768 → 498 KB; backgrounds 433 → 231 → 163 KB; avatar sheets 118 → 49 → 30 KB; police sheets 60 → 12 → 8 KB.

This isn't metadata: non-image chunks across the whole tree pack total 2.9 KB. The image data itself is poorly compressed.

Also public/assets/cryptopunks/head-preview-atlas.png (2400×2400, 1.13 MB) is downloaded to crop one 24-px head (avatars/headPreview.ts:6,24-49). It drops to 0.83 MB as PNG or 0.49 MB as lossless WebP; better, split it into per-row strips.

Fix:
- Add scripts/optimize_assets.mjs (sharp, or oxipng -o4 --strip safe), run it over public/assets as part of asset intake (docs/development/asset-intake-rules.md has no optimization rule today), and commit the results.
- Add a CI check that fails when any committed PNG shrinks by more than 10% on re-encode.
- PNG recompression is zero-risk. WebP needs Safari 14+ and the Phaser loader handles it, but adopt it only alongside the atlas work.

**Evidence.**

- sharp re-encode of 475 boot PNGs: 2,414,654 B → 1,214,064 B (png level 9) → 808,244 B (webp lossless)
- public/assets/objects/trees/devkidd/*/*.png — 1,550,379 B total, only 2,873 B in non-IHDR/IDAT/IEND chunks
- public/assets/cryptopunks/head-preview-atlas.png — 2400x2400, 1,127,982 B; png9 832,539 B; webp lossless 491,208 B
- src/avatars/headPreview.ts:6 — whole atlas loaded to draw a single 24x24 cell
- package.json:119 — sharp 0.34.5 already available for a build script

**Fact-check (partially confirmed).**

- **Startup PNGs:** a pixel-identical PNG re-encode saves about 39% (2.41 MB → about 1.47 MB), not 50% (1.21 MB). The setting that works is sharp `png({compressionLevel: 9, adaptiveFiltering: false})`. With adaptiveFiltering:true you only save about 11% (2.15 MB), so the script and CI check must not turn it on (or use oxipng). Lossless WebP really does get 808 KB (−67%).
- **Trees:** 1514 KB → about 909 KB as PNG (not 768 KB), and → 498 KB as WebP.
- **CryptoPunk atlas:** head-preview-atlas.png (1.13 MB) is not loaded at startup. It is fetched lazily, only for players with a CryptoPunk avatar (previews.ts:36-52, profileModal.ts:1185), so treat it as a minor follow-up.
- **Caching:** public/_headers already caches /assets/* immutably for a year. The win is mostly for first-time visitors. Re-encoding PNGs in place under the same filenames is safe for returning players because the pixels are identical. A WebP switch would need new paths in the config manifests.

### F018: World data isn't requested until every sprite has finished downloading

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md §1.3 'Overlap the network waterfall: assets → scene → world chunks is serial', still not implemented.

**Summary.** The game waits until all its art has downloaded before it asks the server which rooms are nearby, and the first screen can't show until that answer comes back. Sending that question at the same moment the art starts downloading would hide about 0.4–1 second of waiting behind the art download.

**Technical detail.**

The first world request is worldStreaming.ts:844 (loadCompactWorldChunkWindow). It is reached only after BootScene finishes all assets: BootScene.create → startInitialScene (BootScene.ts:421-446) → OverworldPlayScene → windowController refresh. markAppReady then waits on that result (windowController.ts:304-337).

Measured: GET /api/world/chunks/summary for a 4×3 chunk window took 346 ms TTFB on a fast desktop link (server-timing d1;dur=93, 273 KB JSON / 21 KB br). The arrival-room snapshot batch follows (previewCache.ts:322, queryRoomSnapshots).

Fix:
- In main.ts, before `new Phaser.Game`, compute the arrival chunk bounds: default -11,-6, or /r/x/y / world link via the existing resolveWorldLinkBeforeBoot.
- Start worldRepository.loadCompactWorldChunkWindow(bounds) plus the arrival room snapshot, and park the promises in a startupWorldPrefetch module.
- Have worldStreaming consume the in-flight promise when bounds match, same pattern as installEarlyWorldTileBootstrapHandoff, and discard it otherwise.

The early-tile manifest is fetched with includeRooms=0 (earlyWorldTileBootstrap.classic.ts:474-484), so nothing currently overlaps this request.

**Evidence.**

- src/scenes/overworld/worldStreaming.ts:844 — first loadCompactWorldChunkWindow call, inside OverworldPlayScene's refresh path
- src/scenes/BootScene.ts:421-446 — OverworldPlayScene starts only after preload completes and create() builds animations
- src/scenes/overworld/windowController.ts:304-337 — markAppReady() only after worldStreamingController.refreshAround resolves
- GET https://api.wamp.land/api/world/chunks/summary?minChunkX=-3&maxChunkX=0&minChunkY=-2&maxChunkY=0 → ttfb 0.346 s, server-timing d1;dur=93, 21,325 B br
- src/main.ts:74 — resolveWorldLinkBeforeBoot() already runs pre-boot; world data does not

**Fact-check (partially confirmed).**

1) The measured window shape is not one the client ever requests. getDesiredChunkBounds (previewStreaming.ts:93-120) always produces an odd square: (2r+1)² chunks with r between 1 and 4, depending on mode, zoom, viewport and performance profile. Realistic cold times to first byte are about 200–520 ms; warm edge-cache hits are about 80 ms. The summary request alone therefore saves about 0.1–0.5 s. Reaching 0.4–1 s needs the snapshot POST overlapped too, or a mobile connection with a slow round trip.
2) In production the snapshot batch is also on the critical path, because world tiles report available:false and awaitBeforeReady=!tiledBrowseCutover is true (dynamicOverlayStartup.ts:41-44). This makes the finding stronger.
3) "Same pattern as installEarlyWorldTileBootstrapHandoff" is the wrong model. That module releases a DOM cover after paint; it does not hand off a promise. The right model is the in-flight dedupe map in previewCache.queryRoomSnapshotBatch (previewCache.ts:304-330), or simply consuming a pre-boot summary promise when containsWorldChunkBounds(prefetched, desired) is true. A superset window should be accepted, not only exact bounds.
4) Prefetching the snapshot is not small. The reference set comes from getNearestPreviewRoomIds(…, 9) and the detail level, both of which depend on scene state. The batch is deduped by buildRoomSnapshotBatchKey, so a pre-boot POST is reused only if the reference set matches exactly. Treat the summary prefetch as small (under a day) and the snapshot prefetch as a medium follow-up.
5) Pre-boot bounds also have to replicate the deep-link fit zoom (OverworldPlayScene.ts:2207-2211) and the device performance profile, or request a deliberately padded superset.

### F015: Game code doesn't start downloading until a map-preview check returns

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** On wamp.land, the browser doesn't even request the 3.6 MB of game code until a separate world-map check to the API server comes back, and it can wait up to 1.4 seconds when map previews are on. Nothing tells the browser to fetch the code early. The only early-fetch hint the site sends is a level-editor toolbar icon. Hinting the game code early would save about 0.3–1.4 seconds on every first visit.

**Technical detail.**

The entry script dist/assets/cache-v2/main-CP07YQqu.js is built from src/main/coarseFirstEntry.ts. It awaits window.__wampEarlyWorldTiles.ready, the config fetch to the separate origin api.wamp.land (earlyWorldTileBootstrap.classic.ts:856-859), which costs DNS + TCP + TLS + a request on a cold phone. It then waits for the sharp refinement, capped at 750/650/1400 ms (coarseFirstStartup.ts:1-3, 46-80). Only after that does it dynamic-import main-*.js (1.88 MB), phaser-vendor (1.48 MB) and roomMetadataRender (195 KB): about 686 KB brotli.

Vite does not emit modulepreload tags for dynamic-import dependencies. As a result, dist/index.html:29-32 preloads only the 1 KB polyfill and preload-helper.

Cloudflare's only HTTP 103 Early Hint is `<./assets/objects/flag-checkered.png>; rel=preload` (index.html:21). It was added in 8c265891 for the editor dock's Goal icon (dock-shell.css:480-481, index.html:1368), so every visitor pays for an editor-only image.

Fix:
- Write a small Vite plugin (generateBundle + transformIndexHtml) that injects `<link rel="modulepreload" fetchpriority="low" href=...>` for the main runtime chunk, phaser-vendor and roomMetadataRender. The bytes then stream while the coarse map cover loads; keep the execution gate if desired. Cloudflare will turn these into Early Hints.
- Drop the flag preload, or move it to editor open.
- Optionally add `<link rel=preconnect href=https://api.wamp.land crossorigin>`.

**Evidence.**

- dist/assets/cache-v2/main-CP07YQqu.js (built from src/main/coarseFirstEntry.ts) — dynamic import of main-*.js runs only after the __wampEarlyWorldTiles handle settles
- src/main/coarseFirstStartup.ts:1-3,46-80 — 750 ms coarse wait + 650 ms refinement, 1,400 ms ceiling before importMain()
- src/main/earlyWorldTileBootstrap.classic.ts:856-859 — first await is a fetch to ${apiBaseUrl}/api/world/tiles/config
- dist/index.html:29-32 — modulepreload only for modulepreload-polyfill and preload-helper; no preload for main-C48qQbVk.js / phaser-vendor
- curl -D - https://wamp.land/ → 'HTTP/2 103 link: <./assets/objects/flag-checkered.png>; as=image; rel=preload' is the only Early Hint
- index.html:21 + src/styles/sections/editor/dock-shell.css:480-481 — the preloaded flag is the editor dock Goal icon
- brotli -q11 of critical chunks: main 365,683 + phaser-vendor 269,520 + roomMetadataRender 42,603 + rewardStings 5,920 bytes

**Fact-check (partially confirmed).**

Correct framing: coarseFirstEntry deliberately holds back the main JS download behind the world-tile bootstrap (commit 2924fd35; comment at coarseFirstStartup.ts:9-13).

- **Today:** tiles are off in production (`/api/world/tiles/config` returns `available:false`). The gate therefore costs only the config round trip to api.wamp.land, capped at 750 ms and edge- and browser-cached for 4 h. It buys nothing in return, because no cover is painted.
- **Expected saving:** a build-time plugin that emits `<link rel="modulepreload">` for main-*.js, phaser-vendor, roomMetadataRender and rewardStings (about 684 KB brotli) would save roughly 0.2-0.7 s on cold first visits. Repeat visits gain almost nothing.
- **Keep the gate and re-check:** the execution gate can stay. Re-measure the coarse-cover timing once tiles are re-enabled, since a preload then competes with tile fetches for bandwidth. A conditional preload is one option, e.g. only when a cached config says tiles are disabled.
- **The flag preload:** it is not editor-only. It is a 1.1 KB sprite that BootScene loads for every visitor (BootScene.ts:213, markerFlags.ts:23), so removing it gains nothing.
- **Early Hints:** Cloudflare does not currently turn the existing `crossorigin` modulepreload tags into 103 hints. JS Early Hints would likely need explicit Link headers, e.g. generated `_headers` or `_worker.js`.
- **Preconnect:** a `<link rel=preconnect href=https://api.wamp.land>` adds little, because the inline bootstrap already opens that connection at the very top of the head.

### F120: A Google Fonts import delays the first paint, and the title font pops in late

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The stylesheet starts by importing IBM Plex Mono from Google Fonts, so the page waits on Google before drawing anything, even though most of the game now uses its own pixel fonts. The pixel fonts used on the loading screen aren't preloaded either, so the 'We All Make A Platformer' title first appears in a plain fallback font and then swaps.

**Technical detail.**

src/styles/sections/base.css:1 has `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono…')`, and the production main-DIzFjDWG.css begins with that @import (confirmed with a GET of wamp.land). This blocks rendering while the browser fetches from fonts.googleapis.com and then fonts.gstatic.com. The body default font is still IBM Plex (base.css:76-83), even though 138 rules re-select HomeVideo; IBM Plex is the first-choice font in only ~10 rules plus the editor's --editor-button-font. index.html:20-28 preloads a flag PNG but no fonts. The boot splash title uses SMB NES (base.css:145-150) with font-display: swap, so it shows unstyled text first. The pixel fonts are small once compressed (HomeVideo ~23KB, SMB ~20KB, Early GameBoy ~4KB over brotli). Fix: self-host IBM Plex Mono 400/600 as woff2, or drop it for HomeVideo with a system monospace fallback. Remove the @import. Preload SMB NES and HomeVideo-Regular (<link rel=preload as=font crossorigin>). Set the body font to var(--font-ui). Follow-up: the CSS ships as one 343KB file (48KB br) that includes all the editor CSS for players who never edit.

**Evidence.**

- src/styles/sections/base.css:1 — render-blocking @import of Google Fonts
- src/styles/sections/base.css:76-83 — body font-family IBM Plex Mono
- index.html:20-28 — no font preloads
- GET https://wamp.land/assets/cache-v2/main-DIzFjDWG.css — first bytes are the googleapis @import; 342,811 B raw / 48,352 B br

**Fact-check (confirmed).**

The core claim stands, but the fix needs adjusting because IBM Plex Mono is used much more than "~10 rules" suggests, and partly on purpose:
- **CSS:** 9 rules name it directly. 41 rules use `var(--editor-ui-font)`, which is IBM Plex first (base.css:64); only the editor-mode retro skin switches it to HomeVideo first (retro-skin.css:14). 8 rules use `--editor-button-font`, which is IBM Plex (retro-skin.css:15).
- **In-game text:** 18 places in the TypeScript draw text on the Phaser canvas in IBM Plex Mono, across roomComments.ts:806-842, roomChat.ts:514, roomCommentsPlayPresentationController.ts:96-108, CourseEditorScene.ts:1671, paletteController.ts:1481, editor/overlays.ts and musicPatternEditor.ts.
- **Deliberate choice:** feature-ledger.md:14 records that Layers and Players Online were intentionally switched to IBM Plex Mono (commit 15ccc3d).

So the right fix is to self-host IBM Plex Mono, not drop it for HomeVideo. Ship latin-subset woff2 files for weights 400, 500 and 600; all three are requested today, so check whether 500 is actually used before dropping it. Then remove the `@import`. Preload SMB NES, HomeVideo-Regular and IBM Plex 400 with `<link rel=preload as=font type=font/… crossorigin>`.

Self-hosting has a side benefit. Phaser canvas text drawn before a font finishes loading stays in the fallback font, and self-hosting plus preloading, or awaiting `document.fonts.load` before creating that text, fixes this. The idea already exists in the repo: src/mapScreenshot/stitch.ts:370-383 waits for fonts this way.

A smaller error: there is no `--font-ui` variable. The existing one is `--hud-ui-font` (base.css:65).

### F024: Add automatic size and load-time limits so regressions get caught

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** docs/performance-code-health-roadmap.md Wave 3 exit gate ('Initial JS/assets reduced by at least 25%') and the 06-10 plan's 'bundle visualizer baseline' were never turned into an automated check.

**Summary.** Nothing in the release checks notices when the game gets heavier. The 221-tree art pack doubled the number of files downloaded at startup and shipped without anyone seeing a number move. A simple check that fails when the main code size, the startup file count, or cold-start time crosses a limit would keep WAMP fast while new content lands daily.

**Technical detail.**

package.json:9 `check` runs lint, test, typecheck, world-tile types and build, with no size gate. Vite prints "Some chunks are larger than 500 kB" (main 1,883 KB, phaser 1,482 KB, wallet index 604 KB) on every build, and nobody acts on it. Commit 80081eab (2026-08-13) added 221 boot-loaded PNGs (+1.5 MB, +221 requests) unnoticed. The existing perf probes (runtime_performance_trace.mjs, mobile_smoke.mjs LOD budgets) measure frame time, not startup.

Fix:
(1) scripts/check_bundle_budget.mjs: enable build.manifest, walk index.html's entry plus the static and dynamic imports that run at boot, brotli-size them, and fail above ~700 KB br. Today's critical path is 686 KB br, so set the limit and ratchet it down.
(2) A vitest that enumerates the BootScene load lists (TILESETS, BACKGROUND_GROUPS, GAME_OBJECTS, …) and fails above N files or N KB.
(3) A Playwright cold-start probe using CDP Network.emulateNetworkConditions (1.6 Mbps / 150 ms), CPU 4× and an Android UA, timing navigation → body[data-app-ready="true"]. Record the baseline in progress.md and run it before deploy:prod.

**Evidence.**

- package.json:9 — "check": lint + test + typecheck + world-tiles:types:check + build (no size/boot budget)
- npm run build output — '(!) Some chunks are larger than 500 kB after minification' with main-C48qQbVk.js 1,883.64 kB
- git show 80081eab --stat — 221 devkidd PNGs added, all loaded by BootScene via GAME_OBJECTS
- docs/performance-code-health-roadmap.md Wave 3 exit gate 'Initial JS/assets reduced by at least 25%' exists only as prose

**Fact-check (confirmed).**

These are small precision fixes; the core claim is unchanged.
- "Doubled the number of files downloaded at startup" is slightly high. BootScene loads about 470 files now, versus about 250 before the pack, which is roughly +90%. "Nearly doubled" is accurate.
- A one-time manual Vite-manifest audit was done (docs/development/refactor-performance-closeout-2026-08-13.md:50), but it covered only the canvas-render entries and was never automated.
- Byte budgets do exist for world-tile network requests (overworld_tile_pyramid_probe_helpers.mjs:598), but none cover startup JS or the boot asset list.
- The real HTML entry is a 1.3 KB stub. The budget script must follow its boot-time dynamic import of the main runtime chunk; counting only index.html's script tags and modulepreload links would miss nearly all of the weight.

### F021: Updated art can stay stale for returning players for up to a year

- **Area:** Load time, bundle size & assets
- **Type:** defect · **impact:** medium · **effort:** small
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md §1.5 said '/assets/*' should be immutable for build output only and that unhashed public/assets art 'should keep a moderate TTL'. The shipped _headers (b37ec4ea) applied immutable to all of it.

**Summary.** Every file under /assets/ tells browsers "never check this again for a year". That includes the hand-named art files that artists overwrite in place. An updated sprite only reaches returning players when someone remembers to add a manual version tag, which has been done for about 10 tilesets but not for objects, enemies, backgrounds, fonts or sounds.

**Technical detail.**

public/_headers:1-2 sets `/assets/*  Cache-Control: public, max-age=31536000, immutable`. That pattern covers both the hashed build output (assets/cache-v2/*) and the unhashed public art. Example: curl -I https://wamp.land/assets/objects/flag-checkered.png → immutable, age 2,995,921.

Cache busting is a hand-typed ?v= query on a few paths only: tilesets.ts:685, 1077, 1102, 1126, 1151, 1187, 1238, 1267 and objects.ts:345-346. Everything else has none: tilesets.ts:993 (backrooms), 1014 (wampos95) and 1035 (MicroMono), which were edited three times in July; all 353 object sheets; the fonts in base.css:5-25; SFX and music.

Fix (build time):
- A Vite plugin hashes each file under public/assets (sha1, 8 chars) into an asset manifest.
- A single assetUrl(path) helper appends ?v=<hash>. Route BootScene, sfx.ts resolveAssetUrl, the music loaders, headPreview and CSS url()s through it (CSS via a small transform).
- Keep `immutable`.

Interim alternative: limit the immutable rule to /assets/cache-v2/* and give other /assets/* `max-age=86400, stale-while-revalidate=604800`.

Bonus: the world-tile asset contract would then track real byte changes automatically.

**Evidence.**

- public/_headers:1-2 — '/assets/*' immutable for 1 year (covers unhashed public/assets art)
- curl -D - https://wamp.land/assets/objects/flag-checkered.png → cache-control: public, max-age=31536000, immutable; age: 2995921
- src/config/tilesets.ts:685,1077,1102,1126,1151,1187,1238,1267 — manual '?v=YYYY-MM-DD-…' cache busters
- src/config/tilesets.ts:1014 — 'assets/tilesets/wampos95.png' with no version; git log shows it modified 2026-07-01 (twice)
- src/styles/sections/base.css:5-25 — fonts referenced by fixed URL with no version

**Fact-check (partially confirmed).**

Change kind from "defect (stale now)" to a latent risk that has already happened once (feature-ledger.md:39; commit 4ee6b787, 2026-08-09, Cyber tileset immutable-cache hotfix). Remove the backrooms, wampos95 and MicroMono examples: their edits (Jun 24 to Jul 8) all predate the immutable header (b37ec4ea, 2026-07-17), and production serves byte-identical current files. Since 2026-07-17, every tileset edited in place has a `?v=` after the one miss. No object, sfx, music, font, background, enemy or player art has been edited in place since then. Corrected counts: 8 tileset busters plus special.png in objects.ts:345-346; 314 object PNGs, not 353. Additional risk to mention: the Cloudflare edge also caches these files (HIT, age about 35 days), so if deploys do not purge it, an unversioned edit could also reach new visitors (unconfirmed). Fix caveat: assetContract.ts:16-29 serializes the registries including paths, so add the hash when files are loaded rather than writing it into registry paths, unless an art edit forcing a world-tile renderer rebuild is acceptable. The interim `_headers` split (immutable only for /assets/cache-v2/*) remains the quickest fix.

### F023: Music and sound files: smaller formats and faster loading

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Rooms using drum-machine music download 16 uncompressed drum samples (2 MB) one after another before the beat starts, and the main music loops are high-bitrate. Each sound effect is fetched the first time it plays, so the very first jump or coin sound can land late. Pre-processing these files and warming the core sounds after the first tap would make music start sooner and effects feel snappy.

**Technical detail.**

(a) Drum kit: patternKit.ts:304-307 awaits loadRolandMt32DrumSample for each row in turn, which is 16 serial fetches of stereo 16-bit WAVs from public/assets/music/roland-mt32 (2.0 MB; hat-open.wav 663 KB, crash.wav 413 KB). rolandMt32DrumKit.ts:171-174 then decodes, mixes to mono, trims silence and normalizes at runtime. Pre-bake mono/trimmed/normalized samples offline, ship OGG + M4A like the SFX already do (sfx.ts:352-365), and load with Promise.all: about 2 MB → ~150 KB, and 16 round trips → 1.

(b) Stems: wamp-v1 is 14 × 8 s stereo MP3s at 184 kbps (2.5 MB; Arp1.mp3 190 KB). loadLaneLoopBuffer (controller.ts:958-965) needs every assigned clip before playback, so a 5-lane room is about 1 MB. Re-encoding at ~96–112 kbps AAC/Vorbis saves roughly 45%.

(c) SFX: each cue's HTMLAudioElement is created on first play (sfx.ts:711-713). After the first user gesture, fetch and decode the hot gameplay cues (jump, land, footstep, coin, hurt: under ~60 KB of OGG) into AudioBuffers and play them via AudioBufferSourceNode; leave the rest (30 OGGs = 474 KB) lazy.

Also, about 5 MB of unused SFX .wav sources ship in dist; add them to .assetsignore.

**Evidence.**

- src/music/patternKit.ts:304-307 — for (const row of ROOM_PATTERN_DRUM_ROWS) { await loadRolandMt32DrumSample(...) } (serial)
- src/music/rolandMt32DrumKit.ts:171-174 — decodeAudioData → mixAudioBufferToMono → trimSilence → normalizePeak at runtime
- public/assets/music/roland-mt32/hat-open.wav — 663,064 B, 2 ch 44.1 kHz Int16 (afinfo)
- public/assets/music/wamp-v1/Arp1.mp3 — 190,325 B, 8.1 s, 183,770 bps stereo (afinfo)
- src/audio/sfx.ts:711-713 — new Audio(assetUrl) created lazily at first play
- find public/assets/sfx -name '*.wav' → 4,990,460 B of WAVs deployed but swapped for .ogg/.m4a at runtime (sfx.ts:352-365)

**Fact-check (confirmed).**

The core claim is right, with these refinements.

(1) The drum load is broader than the claim says. renderRoomPatternLoopBuffer (patternRenderer.ts:296) always calls renderDrumTrack, which awaits getPatternDrumSamples (patternRenderer.ts:176). So every room with 'pattern' or phrase-arrangement music downloads all the drum samples before the loop can render, even when the room has no drum hits.

(2) The 16 rows map to 15 distinct files. snare-01.wav is never used. bassdrum.wav is requested twice (kick-1 and kick-2 use different cache keys), and the second request probably comes from the browser's HTTP cache. So about 1.95 MB is actually transferred.

(3) The SFX latency is worse than "first play only". In retargetAudioPlayer (sfx.ts:695-698 and 738-751), when a cue has no idle player of its own, the code takes an idle player from a different cue, swaps its src and calls load(). It does this before creating a new player (cap 64). The pool therefore stays small, and alternating jump, land and footstep keeps reloading the same element. The cheap fix is to prefer creating per-cue players up to the cap over retargeting, and to pre-create the hot cues after the first gesture. Full AudioBufferSourceNode playback is the better end state, but it is medium effort because of the existing fade, trim, low-pass routing and loop logic.

(4) The unused WAVs in dist are about deploy hygiene, not player load time. Players never request them.

(5) Re-encoding the stems is the lowest-value part, saving about 0.4 MB per room. AAC encoder priming can shift the bar-offset slicing at controller.ts:976-990, and older Safari cannot play OGG, so loop seams must be checked after any re-encode.

Fill previously_recommended with docs/2026-06-10-repo-improvement-plan.md §1.4 (the music review).

### F019: Players download the level-editor UI and about 30 menus before the first frame

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md §1.1 (lazy editor code) is only partly done: the Phaser scenes went lazy in b37ec4ea, but the DOM-side editor tooling and autotiling solver still ship in the play bundle.

**Summary.** The main game file (1.9 MB) still carries the builder's tool panels, the auto-tiling engine and the code for about 30 pop-up windows (profile, leaderboards, history, guestbook and more) that a new player won't open in their first minute. Loading these on first use would trim roughly 20–25% off the biggest file. Every deploy also currently forces returning players to re-download the whole file.

**Technical detail.**

Sourcemap attribution of main-C48qQbVk.js (1,883,517 B):
- scenes/editor/*: 80.7 KB (uiBridge.ts 52.5 KB, panels 8.7, elements 8.4)
- palette, editorDockShell, customSpriteEditor, courseComposerPanel: 82.6 KB
- autotiling/*: 92.1 KB (solver 22.3, cyberEdgeMatcher 16.7, registry 9.6)
- ui/setup in total: 361 KB (profileModal 37.8, leaderboardModal 28.9, runRatingModal 26.1, exploreModal 23.8, historyModal 12.7, ...)

Root causes:
- src/ui/setup/controllers.ts:42 imports configureEditorUiBridgeRuntime from the 2,341-line uiBridge.ts. That function is a 10-line setter (uiBridge.ts:299-309), but the import pulls the whole editor DOM bridge into play mode.
- controllers.ts:97-132 eagerly constructs 30 controllers.

Fix:
- Move runtimeConfig and its setter to a tiny scenes/editor/uiBridgeRuntimeConfig.ts.
- Load the palette, dock shell, sprite editor, course composer and autotiling solver from editorSceneLoader.ts next to the already-lazy editor scenes. terrainCollision.ts only needs autotiling/model + registry, so those stay.
- Wrap rarely-opened modals in a lazyModal(() => import('./profileModal')) helper that constructs on first open (the markup already lives in index.html).

Secondary: every deploy changes this single chunk's hash, so returning players re-download 366 KB br per release. Add manualChunks groups for stable modules (src/config/*, autotiling model/registry, persistence/roomModel) so routine UI tweaks invalidate less.

**Evidence.**

- sourcemap attribution of dist main-C48qQbVk.js: scenes/editor 80.7 KB, editor panels 82.6 KB, autotiling 92.1 KB, ui/setup 361 KB
- src/ui/setup/controllers.ts:42 — import { configureEditorUiBridgeRuntime } from '../../scenes/editor/uiBridge'
- src/scenes/editor/uiBridge.ts:299-309 — the imported function is a 10-line setter in a 2,341-line module
- src/ui/setup/controllers.ts:97-132 — 30 `new …Controller(` constructions at startup
- src/scenes/editorSceneLoader.ts:9-13 — only the Phaser editor scenes are dynamically imported
- vite.config.ts:69-72 — manualChunks only splits phaser

**Fact-check (confirmed).**

These refinements don't change the verdict.

**Fewer pop-ups than claimed.** "About 30 menus/pop-up windows" overstates it. Of the 30 controllers in controllers.ts:97-132, roughly 20 are modals. The rest are core and needed at boot: chatPanel, mobileUi, worlds, roomSequence, rewardStings, xpReceipts and rewardStingCatchup. A few modals open early for new players: welcomeModal, roomGoalIntroModal, and runRatingModal (after a first clear). leaderboardModal and welcomeModal are passed into the RoomSequenceController constructor (controllers.ts:107). Modals also need event-proxy stubs, because their `init()` registers window listeners (for example profileModal's PROFILE_OPEN_REQUEST_EVENT and AUTH_STATE_CHANGED_EVENT, and runRatingModal's POST_RUN_RATING_REQUEST_EVENT). They also need closePanels/setupSceneCommands shims (controllers.ts:168-206).

**Less autotiling can move than claimed.** About 72 of the 92.1 KB can leave the main chunk, not all of it. terrainCollision → registry pulls in registry (9.6 KB), cyberEdgeCatalog (6.3) and wamposWindowProfile (1.9), so those stay.

**Savings, split into two steps:**
- **Editor-side code, the cleanest first step (~230 KB, about 12%):** uiBridge, palette, dock, sprite editor, composer and the solver chain.
- **Rarely-opened modals (another ~180–200 KB):** profile with its renderers, leaderboard, history, guestbook, wampOGram, chatModeration, performanceSuggestion, playlist, pvp, about, roomRushResult, and possibly explore and runRating.

Together that is ~21–23%, so the 20–25% figure is plausible only if both steps are done.

**Startup cost the claim missed.** At boot, `PaletteController.init()` (paletteController.ts:188-205) calls `loadPaletteImages()`. That walks all 26 TILESETS and runs `computeTilesetVisibilityMap` twice per tileset, each time a canvas `getImageData` scan on the main thread. `setupPaletteRefreshListeners` (controllers.ts:209-226) also runs a palette render on the first animation frame. Players who never build pay this, on phones too. Deferring the palette also removes this work, which strengthens the case beyond download size.

**manualChunks caveat.** Splitting app modules (config, autotiling model/registry) into manual chunks needs care: it can create chunk import cycles or change module evaluation order. Check the resulting chunk graph.

### F025: Styles, hidden menus and fonts make the first paint heavier than needed

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** low · **effort:** medium

**Summary.** Before anything is drawn, the browser must download and process 343 KB of styles, more than 40% of them for the level editor and course editor, plus an HTML page with about 770 hidden menu elements. Moving editor styles into the editor's own lazily loaded package and converting the fonts to the modern WOFF2 format would get the first screen up sooner, especially on older phones.

**Technical detail.**

src/styles/main.css:2-3 @imports sections/editor.css and course-editor.css into the single render-blocking main-DIzFjDWG.css (342,811 B raw / 36.7 KB br). Editor CSS sources total 142 KB (dock-shell.css 43 KB, retro-skin.css 32 KB, music.css 14 KB, ...). Modals add 138 KB of source, and phone-editor-* responsive files more.

dist/index.html is 222,753 B (30.5 KB br) with 773 elements that have ids and 217 `.hidden` blocks (151 KB / 711 ids at the June audit). It also includes 24 KB of inline bootstrap script.

Fonts are TTF (base.css:3-27): HomeVideo Regular/Bold are 94/106 KB with 804 glyphs plus an SVG table, and 'Super Mario Bros. NES.ttf' is 163 KB with 1,087 glyphs; about 55 KB br on the wire. WOFF2 plus a Latin subset (fonttools pyftsubset) would cut that to roughly 12–15 KB. Preload only the face used on the boot splash.

Fix for CSS: move the editor, course-editor and phone-editor imports into src/styles/editor-bundle.css, imported from EditorScene or editorSceneLoader, so Vite emits it with the lazy chunk. Check cascade order with smoke:editor-dock. Later, move rarely-opened modal markup into <template> elements cloned on first open.

**Evidence.**

- src/styles/main.css:2-3 — @import './sections/editor.css'; @import './sections/course-editor.css' in the global stylesheet
- dist/assets/cache-v2/main-DIzFjDWG.css — 342,811 B raw, 36,745 B br, linked render-blocking at dist/index.html:32
- src/styles/sections/editor/* — 142,032 B of source CSS (dock-shell.css 43,202 B)
- dist/index.html — 222,753 B, 773 id attributes, 217 elements with class 'hidden'
- src/styles/sections/base.css:3-27 — four @font-face rules pointing at .ttf files (373 KB raw)

**Fact-check (partially confirmed).**

Keep the measurements, but change three things.
1. Replace the Google Fonts @import at base.css:1 first. It sits at the top of the render-blocking main CSS and makes the browser connect to a second site before anything can paint. Self-host a WOFF2 Latin subset of IBM Plex Mono, or use a <link rel=preconnect> plus <link rel=stylesheet> in index.html.
2. Fonts use font-display: swap, so WOFF2 subsetting does not speed up first paint. It cuts about 72 KB on the wire to about 11 KB (measured) and shortens the visible switch to the real font on the boot splash title. Preload 'Super Mario Bros. NES' only after subsetting it.
3. When moving editor CSS into a lazy file, keep the default display:none rule from dock-shell.css:1-11 and the #sidebar defaults in the global sheet. Otherwise the editor top bar and dock show up in world mode. Also expect equal-specificity rules to flip, because lazy CSS loads after world, modals and responsive. The saving is about 16–20 KB br of render-blocking CSS, not a big first-paint win.
4. The live brotli sizes are CSS 48.4 KB, HTML 38.3 KB and fonts about 72 KB, not 36.7 / 30.5 / 55.
5. The <template> markup idea is a June 2026 recommendation (repo-improvement-plan §4.2) that is still undone.

### F020: Use a slimmer Phaser build and turn off Phaser's unused sound system

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** The game bundles the full Phaser engine, including a second physics engine (Matter) it never uses. It also lets Phaser start its own audio system even though WAMP plays all its sound itself. Switching to Phaser's arcade-only build cuts about 400 KB of code to download and parse. Turning off Phaser audio removes an extra audio context that keeps phone audio hardware awake.

**Technical detail.**

Phaser's package.json 'browser' field resolves 'phaser' to dist/phaser.js (7.86 MB unminified; the phaser-vendor sourcemap attributes 100% to it). Vite re-minifies that to 1,482,446 B (269,520 B br).

node_modules/phaser/dist/phaser-arcade-physics.min.js is 1,086,308 B (226,234 B br): −27% raw, −43 KB br, and less parse and compile work on phones.

A grep of src finds no Matter, no this.sound / load.audio, and no DOM elements, video or particles. The config sets physics default 'arcade' (main.ts:86-92).

Fix:
- In vite.config.ts add `resolve: { alias: [{ find: /^phaser$/, replacement: 'phaser/dist/phaser-arcade-physics.js' }] }`. Types still come from phaser's .d.ts.
- Add `audio: { noAudio: true }` to the GameConfig. Otherwise WebAudioSoundManager.js:47 creates an AudioContext and installs unlock listeners: a third context beside sfx.ts:834 and the music controller. iOS limits concurrent contexts, and a running context costs battery.
- Later, consider a Phaser custom build that drops unused GameObjects and FX.

**Evidence.**

- phaser-vendor-CrrRVQuq.js: 1,482,446 B raw / 269,520 B br, sourcemap → node_modules/phaser/dist/phaser.js
- node_modules/phaser/dist/phaser-arcade-physics.min.js: 1,086,308 B raw / 226,234 B br
- src/main.ts:86-92 — physics: { default: 'arcade' }; no audio config
- node_modules/phaser/src/sound/webaudio/WebAudioSoundManager.js:47 — this.context = this.createAudioContext(game) unless noAudio
- grep src for '.sound', 'load.audio', 'Matter' → no usages (game audio is src/audio/sfx.ts + src/music/controller.ts)

**Fact-check (partially confirmed).**

With the alias as proposed (phaser/dist/phaser-arcade-physics.js, which Vite then minifies again), the saving is about 119 KB raw (1,482 KB → 1,364 KB) and about 28 KB brotli (269 KB → 242 KB). It is not the "about 400 KB / 43 KB br" in the claim, which compared against the separate pre-built phaser-arcade-physics.min.js.

Most of the ~400 KB gap (about 274 KB) comes from 1,476 duplicate Phaser @license header comments that esbuild keeps in the phaser-vendor chunk (its default). Recommended fix, all config-only:
1. Alias /^phaser$/ to phaser/dist/phaser-arcade-physics.js to drop Matter.
2. Add `esbuild: { legalComments: 'eof' }` (de-duplicated, still keeps the MIT notice) or `'none'` to vite.config.ts. That removes about 274 KB of raw JavaScript to parse, but only about 15-20 KB brotli because repeated text compresses well.
3. Alternatively, alias to phaser-arcade-physics.min.js, which gets both savings: about 1,086 KB raw / about 236 KB br after Vite minifies it again.
4. Add `audio: { noAudio: true }` to the GameConfig in src/main.ts (around line 75). Phaser's AudioContext stays suspended until the first gesture and suspends again when the tab loses focus, and three contexts is under iOS limits. So this is tidiness and a small battery gain, not a fix for a visible bug.

Combined realistic win: about 30-45 KB brotli on the wire and about 120-400 KB less JavaScript to parse on phones. Impact is low-medium.

### F026: Leaderboards and run submissions load every saved version of a room; the spawn room takes 1.2 s

- **Area:** Backend performance, cost & reliability
- **Type:** defect · **impact:** high · **effort:** medium
- **Flagged before:** docs/performance-code-health-roadmap.md 'Selective Reads' extension (compact room APIs, paginated version metadata). The compact loaders landed, but the leaderboard, run-finish, rating and vote paths still use the full loadRoomRecord.

**Summary.** To show a room's leaderboard or accept a finished run, the server reads every version the builder has ever published and decodes each one. Room 0,0, where new players arrive, has about 177 versions, so its leaderboard took 1.3 s on the server, and 1.2 s of that was this step. A signed-in player who clears that room waits through it three times: once for the leaderboard before the run, once to submit the run, and once for the leaderboard after.

**Technical detail.**

loadRoomRecord batches the room row with prepareLoadRoomVersionsStatement, which selects snapshot_json for every room_versions row with no LIMIT. It then runs JSON.parse and cloneRoomSnapshot on every version. resolveAggregatedRoomLeaderboardSelection then builds buildRoomVersionFingerprint (a JSON.stringify of tiles, objects and sprites) for every version. Run finish also calls buildRoomRatingWindow, which runs computeRoomWeightedChange between each pair of consecutive version snapshots. All of these values are fixed once a version is published. Fix: (1) add columns to room_versions: gameplay_fingerprint (a hash of buildRoomVersionFingerprint), has_goal and rating_window_key. Compute them in publishRoom/revertRoom, and backfill them with a one-off script. (2) Add loadRoomVersionMetadata(env, roomId), which selects only version, created_at, publisher, reverted_from, leaderboard_source and the new columns. Change buildRoomLeaderboardLineage and buildRoomRatingWindow to take the metadata instead of snapshots. (3) In handleRoomLeaderboard, handleRunFinish, handleRoomDifficultyVote, handleRoomRatingSubmit and awardRoomRunProgression, replace loadRoomRecord with summary + metadata + loadExactRoomVersion(selected version), as handleRunStart already does. Apply the same treatment to loadCourseRecord in expandedRooms/runRoutes.ts. Target: room_record under 30 ms for 0,0.

**Evidence.**

- GET https://api.wamp.land/api/leaderboards/rooms/0,0?x=0&y=0 — Server-Timing: room_record;dur=1212 ... total;dur=1293 (TTFB 1.72 s from EWR)
- GET /api/rooms/0,0/versions?limit=50 — nextCursor decodes to 'room-version:127', so about 177 versions exist
- src/cloudflare/worker/rooms/store.ts:115-118 — loadRoomRecord batches the room row with the all-versions statement
- src/cloudflare/worker/rooms/store.ts:826-845 — SELECT ... snapshot_json FROM room_versions WHERE room_id = ? ORDER BY version ASC (no LIMIT)
- src/cloudflare/worker/rooms/store.ts:848-851 + src/persistence/roomModel.ts:795 — every version is parsed and then deep-cloned
- src/persistence/roomVersionLineage.ts:170-171 — fingerprint recomputed for every version on every call
- src/cloudflare/worker/progression/ratings.ts:283-295 — rating window diffs every consecutive pair of version snapshots
- src/cloudflare/worker/runs/routes.ts:198, :505, :538, :586 — run finish, leaderboard GET, difficulty vote and rating all call loadRoomRecord
- src/scenes/overworld/goalRuns.ts:1081-1102 — client fetches a fresh leaderboard before and after finishRun

**Fact-check (confirmed, confirmed, confirmed).**

Small corrections to the details. None of them weakens the core claim.

1. Each version is deep-cloned twice, not once: once in parseStoredSnapshot (store.ts:1435) and again in createRoomVersionRecord (roomModel.ts:795).
2. Server-Timing understates the cost. In Cloudflare Workers the clock does not move during synchronous CPU work. That is why lineage reads dur=0 and why room_record mostly measures the D1 transfer of all snapshot rows. The real CPU cost of parsing, cloning and fingerprinting about 10.5 MB of JSON is not shown, and it also puts the request at risk of hitting the Workers CPU-time limit. A fresh measurement showed room_record at 3.6 s, so latency is worse and varies more than the 1.2 s claimed.
3. The leaderboard fetch before finishing (goalRuns.ts:1082) only runs when the leaderboard loaded on room entry does not match the run. The first of the three waits is usually the room-entry fetch at goalRuns.ts:620.
4. On run finish, buildRoomRatingWindow only runs when the room's creator is not the player (awards.ts:461-462).
5. The proposed metadata needs more than has_goal. getManualRoomLeaderboardSourceValidationError (roomLeaderboardLineage.ts:206-222) compares snapshot id, goal type and leaderboard ranking mode between the source and target versions, so room_versions also needs goal_type and ranking_mode columns.
6. The same root cause affects GET /api/rooms/:id (rooms/routes.ts:140). It returns a 10.5 MB record for room 0,0 because it includes every version snapshot. That route was not in the claim, but the same fix should cover it.

The core claim holds. Minor fixes to the details:
(1) The time is not a steady 1.2 s. Measured room_record for 0,0 ranged from 0.3 to 3.7 s, and the latest version is 176.
(2) The cited goalRuns.ts:1081-1082 "before" fetch only runs when no matching leaderboard is already loaded. The pre-run leaderboard normally comes from the room-entry load at goalRuns.ts:611-620, so "three times" means: room-entry leaderboard, then run finish, then the post-run refresh. The post-run refresh really does reach the server because finishRun clears the client cache (runRepository.ts:89). One unverified possibility: signed-in leaderboard responses carry `private, max-age=20` and the client fetch uses the default cache mode, so the browser's HTTP cache might serve that refresh from a fetch made less than 20 s earlier.
(3) awardRoomRunProgression does not call loadRoomRecord itself. It reuses the run-finish record, and its cost is the buildRoomRatingWindow call at awards.ts:462.
(4) There is an extra quick win the claim missed: every version snapshot is deep-cloned twice (store.ts:1435, then roomModel.ts:795).
(5) Anonymous leaderboard GETs already get a 20 s edge cache. Signed-in reads, run finish, votes and ratings do not.

Version count is 176, not about 177. The "1.2 s" figure is one sample. room_record ranges from 0.18 to 2.3 s, and uncached TTFB is 1.7–3.3 s. Server-Timing leaves out CPU time because the Workers clock is frozen between I/O. The "once before the run" leaderboard is the room-entry fetch (refreshLeaderboardsForRoom, goalRuns.ts:597-636), which is reused. A separate fetch before finishing only happens when currentRoomLeaderboard does not match the run (goalRuns.ts:1078-1083). A rating or difficulty vote adds a fourth full load. The proposed metadata columns are not enough on their own. getManualRoomLeaderboardSourceValidationError (roomLeaderboardLineage.ts:214-224) also reads the goal type and ranking mode from the snapshot, so those must be stored too. A simpler option is to store the computed lineage group or leaderboard family and the rating-window key per version at publish/revert time. A cheaper interim step: memoize the derived lineage and rating window per (roomId, max version) in KV or the Cache API, and load only the exact snapshot. That would remove most of the cost in about a day. The same problem appears in GET /api/rooms/0,0, which returns 10.5 MB with every version included.

### F030: A single network error switches a player to the old 7 MB world feed for the rest of the session

- **Area:** Backend performance, cost & reliability
- **Type:** defect · **impact:** high · **effort:** small
- **Flagged before:** docs/performance-code-health-roadmap.md (Multiresolution extension): browser-side composition and the legacy path are eligible for deletion after a 30-day production soak at 100%. The soak ended around 2026-08-23 and the path is still live, and it is now the failure fallback.

**Summary.** If the fast world-loading request fails even once (a blip, a timeout, a busy server), the game permanently switches that player to the old, much heavier way of loading the map, and re-downloads it every 8–15 seconds. During an outage or traffic spike this multiplies load right when the server is struggling, and on phones it uses a lot of data. The old path should be removed or limited now that the new one has been at 100% for over two months.

**Technical detail.**

Any exception in loadCompactWorldChunkWindow or queryRoomSnapshots sets compactWorldUnavailable = true for the session, including a 500, a network drop or a D1 overload. After that, worldStreaming.refreshLoadedChunksIfChanged calls loadWorldChunkWindow (/api/world/chunks) on every 8 s (play) or 15 s (browse) refresh. That route selects full published_json for every room in the window, has no Cache-Control and no Cache API wrapper, and accepts windows up to 9×9 chunks (72×72 rooms, the whole world) from anonymous callers. The roadmap measured the legacy 3×3 response at 7.19 MB. /api/world?radius=32 has the same full-JSON, uncached shape, and so does the public /api/dashboard/stats (no-store; ~550 ms of full-table GROUP BYs per hit). Fix: (1) trip the breaker only on 404/'disabled' responses; on 5xx or network errors retry the compact route with exponential backoff and jitter. (2) Tiled reads have been at 100% since 2026-07-24 and the 30-day soak is over, so delete or admin-gate /api/world/chunks and /api/world, or at minimum cap them to 3×3 and wrap them in loadAnonymousPublicCache. (3) Wrap dashboard stats in a 60 s Cache API entry.

**Evidence.**

- src/persistence/worldRepository.ts:256 — any compact-window error sets compactWorldUnavailable = true
- src/persistence/worldRepository.ts:314 — any snapshot-batch error also sets the flag
- src/scenes/overworld/worldStreaming.ts:1088-1093 — when compact is inactive, refresh uses the legacy loadWorldChunkWindow
- src/scenes/OverworldPlayScene.ts:301-302 — refresh every 15 s (browse) / 8 s (play)
- src/cloudflare/worker/world/routes.ts:73-110 — handleWorldChunksRequest returns plain jsonResponse: no cache, no Cache-Control
- src/cloudflare/worker/rooms/store.ts:682-694 — loadPublishedRoomsInBounds selects published_json for every room in bounds
- src/cloudflare/worker/core/http.ts:343 — chunk windows up to 9×9 are accepted
- docs/performance-code-health-roadmap.md — 'Compact summary ... 94.2% below the 7.19 MB legacy chunk response'; legacy path 'eligible for deletion' after 30-day soak
- git d0883e31 (2026-07-24) — 'complete world tile rollout' (TILED_OVERWORLD_ROLLOUT_PERCENT 100)
- src/cloudflare/worker/dashboard/routes.ts:31 — public stats endpoint is 'Cache-Control: no-store'; measured 547 ms TTFB

**Fact-check (confirmed, partially confirmed, partially confirmed).**

The core claim and the code citations are accurate. These details need adjusting:

1. The session-wide breaker is deliberate and documented. docs/performance-code-health-roadmap.md:94-96 and :110-112 say an endpoint or batch failure "is remembered for the browser session and restores the legacy chunk route". The fair framing is that the breaker is too broad now that the rollout is finished, not that it is an accident.
2. The 30-day-soak deletion line (roadmap :95-96) is about deleting browser-side published-room composition, not the /api/world/chunks route. Removing the legacy route is a reasonable next step, but that doc never recommended it.
3. The problem is worse than the claim says, not better. The client itself asks for chunk radii up to 4 (previewStreaming.ts:16-23), which is a 9x9-chunk window, so the fallback can download far more than the 7.19 MB 3x3 figure. One legacy chunk at the origin measured 2.58 MB today.
4. The dashboard stats TTFB measured 0.87 s today, not 547 ms. That endpoint is also a separate, lower-impact problem: it is not part of the world-streaming path.
5. The effect lasts until a page reload, not literally the whole session. The overworld scene is slept and woken, not restarted, so in practice the two are the same.

The core defect is confirmed. Fix: only trip the breaker on a 404 or "disabled" response, or after N consecutive failures; retry 5xx and network errors with backoff and jitter. Also add fallback-usage telemetry, which the ledger asked for but was never built.

Changes to the suggested fix:
- **Keep `/api/world`.** It returns summaries, not full snapshots (`worldModel.ts:396-412`), and the welcome modal (radius 24, `welcomeModal.ts:351`) and editor backgrounds (`backgrounds.ts:262`) still use it. If anything, make its D1 query read the summary index instead of `published_json`.
- **Retire `/api/world/chunks`.** It is the only legacy route worth removing, admin-gating, or capping at 3×3 behind `loadAnonymousPublicCache`.
- **Drop the dashboard-stats caching from this finding.** It is valid but separate and low priority.

**Mechanism.** Confirmed. Any single error from the compact summary or the snapshot batch (worldRepository.ts:256, 314) permanently switches that page session to `/api/world/chunks`. It is then re-fetched every 8 s in play and 15 s in browse.

**Real cost** (measured, 3×3 chunks at the origin):
- 733 KB gzipped on the wire, 12.7 MB decoded, 2.6 s time to first byte, no cache.
- The compact route for the same window is 25 KB, 291 KB decoded, 0.3 s.
- Browse can request 5×5 up to 9×9 windows, so it can be larger.
- The main player-visible harm on phones is main-thread work: a 12.7 MB `JSON.parse` plus `cloneWorldChunkWindow`/`cloneRoomSnapshot` deep clones every refresh, which causes stutter. Data use is about 3-5 MB/min, not 7 MB per refresh.

**Fix (1) is sound and small.**
- Trip the breaker only on a 404/disabled response.
- For network errors and 5xx, retry with exponential backoff plus jitter, and reset the flag after a cooldown.
- Do not trip it from `queryRoomSnapshots` at all; that path already has its own retry.
- Add a telemetry ping when the breaker trips, so the trip rate can be measured.

**Fix (2) needs correcting.**
- `/api/world` returns summaries only, not full JSON, and it is still used by anonymous welcome "Build" (welcomeModal.ts:351, radius 24) and editor neighbours (backgrounds.ts:262). Do not delete or admin-gate it. Instead, switch `handleWorldRequest` and `handleClaimableFrontierRoomsRequest` to `loadWorldRoomSummariesInBounds` so they stop reading `published_json` for up to 51×51 rooms.
- For `/api/world/chunks`: cap it at 3×3 for anonymous callers and wrap it in `loadAnonymousPublicCache`, or remove it once the breaker no longer depends on it.
- The roadmap's "eligible for deletion" refers to browser-side composition. The sticky breaker was an intentional rollout design, now outdated.

**Fix (3), dashboard stats caching.** Fine, but it is a separate low-impact item: only the standalone dashboard page calls it.

### F029: Finishing a run makes about 30 database round trips in a row before the player sees a result

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** high · **effort:** medium

**Summary.** After a player finishes a level, the server records the run and then, before replying, recomputes points, XP, ranks and lifetime stats for the player and the builder. Each step waits for the previous one. The 'Submitting run…' message therefore stays up longer than needed, especially for active players and popular rooms, and it gets slower as players build up history.

**Technical detail.**

handleRunFinish runs these in sequence: auth (3 queries), the leaderboard write gate, loadRoomRunByAttemptId, loadRoomRecord (see the all-versions finding), previous best ×2, ranked top-10, viewer rank, trust tier, UPDATE, optional audit insert, reload of the run, awardRunFinalizePoints, awardRoomCreatorCompletionPoints, and upsertUserStats(creator). Then awardRoomRunProgression does loadCompletedRoomRunsForVersion (every completed run of the version, with goal_json, and no LIMIT, to rank in JS), several awardLaneDelta inserts, and loadOrBackfillUserProgress + trust tier for the creator. Finally upsertUserStats(self). upsertUserStats pulls every finished room_run and course_run row of the user into the Worker to sum them in JS, plus a SUM over point_events and the unindexed publisher scan. Fix: (a) respond once the run UPDATE and the rank/verification result are committed, and move points/XP/stats/badges into ctx.waitUntil (handleRunFinish doesn't receive ctx today; pass it as the course routes do) or into a Queue consumer with the existing dedupe keys; the client already re-reads the profile for reward stings. (b) Replace upsertUserStats' JS loop with a single SQL aggregate (SUM/COUNT/MIN with FILTER), or with incremental `UPDATE user_stats SET completed_runs = completed_runs + 1 ...`. (c) In awards, compute currentRank/previousRank with the existing ranked-CTE SQL (loadViewerRankedRoomLeaderboardRow) instead of loading all completed runs.

**Evidence.**

- src/cloudflare/worker/runs/routes.ts:167-487 — handleRunFinish; every step is awaited in sequence, and stats/progression are awaited before noContentResponse
- src/cloudflare/worker/runs/points.ts:358-399 — upsertUserStats selects every non-active run row for the user (UNION of course_runs and room_runs) and aggregates in JS
- src/cloudflare/worker/progression/awards.ts:194-224 + :399 — loadCompletedRoomRunsForVersion has no LIMIT and is used to compute rank in JS
- src/cloudflare/worker/runs/routes.ts:475-486 — upsertUserStats runs for the creator and the player
- src/cloudflare/worker.ts:655-657 — /api/runs/:id/finish is dispatched without the execution context, so waitUntil isn't available today

**Fact-check (confirmed).**

1) The ~30 count is too low. Including syncUserBadges (twice), the lane-event dedupe SELECT plus INSERT pairs, and persistProgressIncrement, it is roughly 60 to 100 sequential D1 round trips when finishing someone else's room. syncUserBadges is the biggest single cost and should be in the fix: defer it, or make it event-driven. 2) "The client already re-reads the profile for reward stings" is wrong. After finishRun, goalRuns.ts:1100 re-reads the ROOM LEADERBOARD. That still makes the deferral safe, because rank depends only on the room_runs UPDATE, which stays synchronous. 3) "Pass ctx as the course routes do" is only half right. Course publish and unpublish receive ctx (worker.ts:640-648), but /api/course-runs/:id/finish (worker.ts:671) and /api/expanded-room-runs/:id/finish (worker.ts:661-666) don't. Those handlers repeat the same sequential upsertUserStats/award pattern (courses/routes.ts:637-649, expandedRooms/runRoutes.ts:578-581), so the fix should cover all three. 4) The missing index is on room_versions(published_by_user_id). It is a cheap migration to add alongside the change.

### F236: Every room save depends on a live Base RPC call, and an RPC hiccup blocks saving in every room

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Each draft save, autosave and publish asks the Base blockchain whether the room is minted before it writes anything. If that call fails or is rate-limited, the save fails for every builder in every room, including the large majority of rooms that will never be minted. The same step also loads a room's full version history twice on every autosave.

**Technical detail.**

loadRoomRecordForMutation (rooms/store.ts:600-622) always calls syncRoomOwnershipFromChain. In production that function catches the RPC error and rethrows it (mint/service.ts:142-152), because shouldSkipLocalRoomMintSync only tolerates localhost (service.ts:233-240). The save path (store.ts:873), publish (store.ts:990), the command path (rooms/commands.ts:61), revert and the mint routes all go through it, so a Base RPC outage or a 429 becomes a 500 on autosave. Autosave fires 600 ms after the last edit (editor/roomSession.ts:87, 394-408). Unminted rooms cost 1 eth_call per save (tokenIdForRoomCoordinates) and minted rooms cost 2. The public endpoint mainnet.base.org returned 'over rate limit' after about 9 sequential reads during this review. The same wrapper calls loadRoomRecord twice, and the second call runs even when the sync wrote nothing. Each loadRoomRecord batch-loads every room_versions.snapshot_json and parses it (store.ts:115-118, 826-846, 848-851). Room 0,0 is at v176 with a published snapshot of about 22 KB, so one autosave reads and parses roughly 7-8 MB (an estimate). Fix: (1) On an RPC error, fall back to the D1 state instead of throwing. If D1 says minted, enforce the D1 owner (fail-closed). If D1 says unminted, allow the save and log a warning. (2) Skip the chain read when minted_owner_synced_at, or a new chain_checked_at column, is under about 60 s old. (3) Return the merged record from syncRoomOwnershipFromChain and drop the unconditional second loadRoomRecord. (4) Longer term, load only the latest version row for mutations, because full history is needed only for revert and leaderboard-source checks.

**Evidence.**

- src/cloudflare/worker/mint/service.ts:142-152 — chain read errors are rethrown unless the RPC host is localhost
- src/cloudflare/worker/mint/service.ts:233-240 — skip-on-error applies only to 127.0.0.1/localhost/::1
- src/cloudflare/worker/rooms/store.ts:600-622 — loadRoomRecord → chain sync → loadRoomRecord again, unconditionally
- src/cloudflare/worker/rooms/store.ts:115-118 and 826-846 — every room load batch-reads all version snapshot_json rows ordered by version
- src/scenes/editor/roomSession.ts:87,394-408 — autosave runs 600 ms after an edit, and each run hits the chain-sync wrapper
- src/cloudflare/worker/rooms/commands.ts:61 — the command-based draft save also goes through loadRoomRecordForMutation
- Live: GET api.wamp.land/api/rooms/0%2C0/summary shows publishedVersion 176; GET .../published is 22,179 bytes
- Live: mainnet.base.org returned 'Details: over rate limit' after about 9 sequential eth_calls from one client

**Fact-check (partially confirmed, confirmed, partially confirmed).**

Every authenticated draft save, publish, revert and mint call does make a live Base read (1 eth_call if unminted, 2 if minted). In production any error that survives viem's default 3 retries (backoff of about 0.3, 0.6 and 1.2 s; 10 s timeout per request) is rethrown and becomes a 500, so a sustained RPC outage or rate limit blocks all saves. Brief blips are absorbed but add latency. A PUT /draft does 3 full loadRoomRecord history loads, not 2: two in loadRoomRecordForMutation plus the final load in saveDraft at store.ts ~962. The agent /draft/commands path does 2 chain syncs and 5 history loads. The roughly 7-8 MB-per-save figure applies only to heavily republished rooms like 0,0 (v176), not typical rooms. Whether the production RPC is the rate-limited public mainnet.base.org endpoint can't be verified, because ROOM_MINT_RPC_URL is a secret. The suggested fixes still apply: fall back to D1 on RPC error, skip the read when the last check is fresh, return the merged record instead of reloading, and load only the latest version for mutations. Also, saveDraft should reuse the record from the commands path instead of re-running the mutation load.

The core claim is accurate. The production RPC URL is a dashboard secret, so the mainnet.base.org rate-limit result shows the risk but does not prove production's provider will hit it. Two aggravating facts should be added to the finding:

1. A failed autosave retries right away and keeps retrying. EditorScene.update calls maybeAutoSave every frame (EditorScene.ts:1013-1014). The room stays dirty and lastDirtyAt does not change, so the 600 ms gate (roomSession.ts:404) is already passed. The editor resends a save as soon as the last one fails, with no backoff, which hammers the RPC during an outage. Fix: add exponential backoff after a failed save.
2. The command-save path (commands.ts:61, then saveDraft at commands.ts:71) calls loadRoomRecordForMutation twice. That is 2 chain syncs and 4 full-history loads per save.

Also: the production client does not fall back to local storage on a 5xx, because roomRepository.ts:985-991 does that only in DEV. Users just see "Draft save failed."

1. **Failure threshold.** viem's default http transport (service.ts:77-80; viem buildRequest.js:10, 131-185) retries 429 and 5xx errors 3 times with backoff and honors Retry-After. Brief hiccups or a single 429 do not fail saves; a sustained RPC outage or sustained rate limiting does. A hanging RPC can stall each save or publish for up to about 4 × 10 s.
2. **Production RPC unverified.** The production RPC URL is a Worker secret. The mainnet.base.org rate-limit test was run from the reviewer's own IP and does not show the Worker is rate-limited.
3. **Missed aggravator: no backoff.** On failure the room stays dirty and maybeAutoSave runs every frame (EditorScene.ts:1013-1014; roomSession.ts:394-408, 516-517). The client therefore resends PUT /draft back-to-back during an outage, which amplifies RPC load. Add exponential backoff to client autosave.
4. **The 7-8 MB figure is for outliers.** It applies to long-history rooms like 0,0 (v176). Typical rooms have few versions. parseStoredSnapshot also deep-clones after JSON.parse (store.ts:1432-1435), which adds to the cost.
5. **Fix step (2) needs a different freshness signal.** minted_owner_synced_at is written only when chain state changes (service.ts:158-163), so it cannot serve as a freshness timestamp. A better gate: an unminted room can only become minted with a Worker-signed authorization from handleRoomMintPrepare (mint/routes.ts:52-60, 30-minute deadline). Skip the chain read for unminted rooms unless a prepare was issued in the last 30 minutes, and use a short TTL cache for ownerOf on minted rooms.
6. **"Fail-closed" is really fail-to-stale.** Enforcing the D1 owner during an outage lets a seller who has just transferred the token keep saving until the next sync. That is acceptable, but it should be described accurately.

### F027: Missing index on room_versions.published_by_user_id makes 15+ queries scan the whole table

- **Area:** Backend performance, cost & reliability
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Many 'rooms published by this builder' queries have no index to use, so the database reads through every saved room version, full level data included. Two of these scans run on every finished run, and others run on every publish limit check and in progression. They get slower as the world grows. A single migration fixes it.

**Technical detail.**

published_by_user_id was added with ALTER TABLE in migration 0002, so it is stored after the large snapshot_json column. A table scan that reads it must walk each row's overflow pages, which means reading every snapshot in the table. The only publisher index on room_versions is for agents (0012). expanded_room_versions and course_versions already have publisher indexes. I built the schema locally from all migrations, and EXPLAIN QUERY PLAN shows 'SCAN room_versions' for the upsertUserStats count and for countDailyRoomPublishes. After `CREATE INDEX idx_room_versions_publisher ON room_versions (published_by_user_id, created_at)` both become 'SEARCH ... USING INDEX idx_room_versions_publisher'. Backfill creator-completion counting changes from a scan of all room_runs to an indexed per-version lookup. Ship it as migration 0049. Because upsertUserStats runs twice per run finish (creator and finisher), this lowers run-submit latency right away.

**Evidence.**

- migrations/0002_room_claims_and_reverts.sql:10 — ALTER TABLE room_versions ADD COLUMN published_by_user_id (stored after snapshot_json)
- migrations/0012_agent_accounts.sql:71-72 — only idx_room_versions_published_by_agent_id exists; migrations/0037_expanded_rooms.sql:44 shows the equivalent publisher index on expanded rooms
- src/cloudflare/worker/runs/points.ts:411-419 — COUNT(DISTINCT room_id) FROM room_versions WHERE published_by_user_id = ?, inside upsertUserStats
- src/cloudflare/worker/runs/routes.ts:475 and :486 — upsertUserStats runs for the creator and the finisher on every run finish
- src/cloudflare/worker/progression/trustCaps.ts:166-180 — countDailyRoomPublishes filters room_versions by publisher (publish/claim limit check)
- src/cloudflare/worker/progression/progressRows.ts:282-292, :333-345 and src/cloudflare/worker/progression/badgesTrophies.ts:170 — more publisher-filtered queries, including json_extract(snapshot_json)
- Local EXPLAIN QUERY PLAN on the migrated schema: 'SCAN room_versions' before the index, 'SEARCH room_versions USING INDEX idx_room_versions_publisher (published_by_user_id=?)' after

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

About 6 queries filter room_versions by published_by_user_id with no index, not 15+: points.ts:415, trustCaps.ts:171, progressRows.ts:287, progressRows.ts:344, auth/store.ts:464, and admin launchStats.ts:769.

- **Wrong citations:** badgesTrophies.ts:170 is not a scan (it uses primary-key lookups driven from content_trophies). The other progressRows and badgesTrophies lines target expanded_room_versions and course_versions, which are already indexed.
- **Run finishes:** The finisher's upsertUserStats runs on every finish. The creator's runs only on completed runs by eligible non-creator finishers.
- **Wider reach than stated:** upsertUserStats also runs on every room publish (rooms/routes.ts:447 and :502) and on course and expanded-room run finishes.
- **Backfill is one-time:** the progressRows backfill queries run once per user, not on hot paths.
- **Fix:** migration 0049 as proposed. Optionally make it (published_by_user_id, created_at, room_id) so the COUNT(DISTINCT room_id) and the daily-publish count are answered from the index alone, without table lookups.

1. **"15+ queries" is too high.** About 6 query sites filter room_versions by publisher:
   - points.ts:415 (on every run finish)
   - trustCaps.ts:171 (publish limit check)
   - progressRows.ts:287 and :344, which run only during backfill through loadBackfillSeedMetrics. That happens when a user has no progress row (progressRows.ts:514-533).
   - auth/store.ts:464, an UPDATE that runs when a user renames.
   - admin/launchStats.ts:769, a NOT EXISTS subquery that runs once per user, so it costs users × versions. This one is worth calling out.
   
   The other progressRows hits (305, 310, 324, 362, 371, 391) query expanded_room_versions and course_versions, which already have publisher indexes.
2. **badgesTrophies.ts:170 does not scan room_versions.** The plan starts from content_trophies and looks up v by primary key. Adding the index does not change that plan.
3. **"Two scans on every finished run" is not quite right.** There is always one scan for the finisher. There is a second, for the creator, only when awardRoomCreatorCompletionPoints returns an event (runs/routes.ts:463-476). The same pattern applies to course and expanded-room run finishes.
4. **The first query plan wording.** EXPLAIN shows "SCAN room_versions USING INDEX sqlite_autoindex_room_versions_1", not a plain "SCAN room_versions". It is still a full scan of every row.

The fix is right as proposed: migration 0049 with `CREATE INDEX IF NOT EXISTS idx_room_versions_publisher ON room_versions (published_by_user_id, created_at DESC)`, to match the existing course and expanded-room indexes. Running ANALYZE after it is optional.

Several details are off:

(1) "15+ queries" is inflated. The room_versions publisher filters with no index are points.ts:415, trustCaps.ts:171, progressRows.ts:287 and :344, the auth/store.ts:464 UPDATE that runs on display-name change, and the admin-only launchStats.ts queries. That makes about 8, not 15+. The other progressRows hits (:305, :310, :324, :362, :371, :391) and badgesTrophies.ts:203/:238 target course_versions or expanded_room_versions, which already have publisher indexes (0010:34, 0037:44). badgesTrophies.ts:170 is not a scan either: it starts from content_trophies and does a PK lookup into room_versions.

(2) "upsertUserStats twice per run finish" is wrong. It runs once on every finish, whatever the result (routes.ts:486). The creator call (routes.ts:475) only happens when awardRoomCreatorCompletionPoints records a new event (points.ts:193-217): a distinct, eligible finisher's first completion of that room version.

(3) In the other direction, the reviewer understated the load on completed runs. Every completed run also calls syncUserBadges for the finisher, and for the creator when that is someone else (awards.ts:496, :502). syncUserBadges calls loadBackfillSeedMetrics every time (badgesTrophies.ts:348). That means countMeaningfulRoomPublishes does a full room_versions scan each time, and countHistoricalCreatorUniqueCompletions scans all completed room_runs each time. A completed run therefore costs roughly 2-4 full room_versions scans plus 1-2 room_runs scans, and publishing adds countDailyRoomPublishes and upsertUserStats (rooms/routes.ts:502).

(4) Impact is real but moderate today. Prod has about 607 rooms (progress.md:140) with skewed version counts: 2,1 has 215, 0,0 has 176, and most rooms have 1-10. That suggests a few thousand rows and roughly 50-150 MB. Each scan should cost tens of ms on D1. D1 runs one query at a time per database, so each scan also delays every other API request, and the cost grows with each publish.

Fix refinements: the proposed index is correct. Also switch countMeaningfulRoomPublishes to the goal_type column, which is written on insert (rooms/store.ts:1647-1664); check whether rows older than migration 0003 need a backfill. Without that change, prolific builders still re-read hundreds of their own snapshots on every completed run. Finally, stop recomputing loadBackfillSeedMetrics on every syncUserBadges call.

### F028: Global chat polls every 3 seconds in every open tab, even with the chat panel closed

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Every visible WAMP tab in world, play or editor mode asks the server for new chat messages every 3 seconds, even when nobody has chat open. For signed-in players each check costs five database lookups. In a traffic spike this would be the largest single load on the database, and it uses mobile data and battery for something the player isn't looking at.

**Technical detail.**

shouldPoll() checks app mode, readiness and visibility but not this.open, so the 3 s interval runs whenever chat mode is active. The request uses apiRequest with credentials:'include', so signed-in users go through these sequential queries: listChatMessages, loadCurrentSession (session+users join, then a second users read), isChatAdminUser, isChatBannedUser. That is about 5 D1 round trips per poll, or about 100 per minute per signed-in player. At 1,000 concurrent players this is about 333 requests/s and up to about 1,600 D1 queries/s against a single-primary D1, with no edge cache. Fix in order of payoff: (1) poll every 3 s only while the panel is open, and every 30–60 s when closed (enough for the unread badge); (2) wrap anonymous GET /api/chat/messages in loadAnonymousPublicCache with a 2–3 s TTL, since URLs repeat for up-to-date clients; (3) skip the viewer-moderation queries on 'after' polls and return viewer only on the first load or when an ETag changes; (4) longer term, push a 'chat:new {latestCreatedAt}' event over the existing PartyKit sockets so clients fetch only when something changed.

**Evidence.**

- src/ui/chat/panel.ts:26 — CHAT_POLL_INTERVAL_MS = 3000
- src/ui/chat/panel.ts:212-214 — setInterval(pollForNewMessages) is created in init(), not when the panel opens
- src/ui/chat/panel.ts:371-372 — shouldPoll() = chat mode && app ready && visible; it does not check this.open
- src/ui/chat/panel.ts:287-290 — chat mode is active in 'world', 'play-world' and 'editor'
- src/cloudflare/worker/chat/routes.ts:130-131 — messages and viewer are awaited one after the other
- src/cloudflare/worker/chat/routes.ts:441-448 + src/cloudflare/worker/chat/moderation.ts:22-25 — session lookup, then admin and ban lookups on every poll
- GET https://api.wamp.land/api/chat/messages?limit=50 — 10.4 KB, no Cache-Control and no X-WAMP-Cache header

**Fact-check (confirmed).**

Minor precision fixes; the core claim is unchanged.
(a) The 10.4 KB figure is the size of the first full load. The 3 s polls send `after=<latestCreatedAt>` and normally return an empty message list plus the viewer object. Per-poll data use is therefore mostly request/TLS overhead, not 10 KB each time.
(b) The 5 queries per poll apply only to normal signed-in users with a session cookie:
  - chat owners (CHAT_OWNER_EMAILS) skip the admin and ban lookups: 3 queries;
  - chat admins skip the ban lookup: 4 queries;
  - guests and anonymous players (no session cookie): 1 query.
So "~1,600 D1 queries/s at 1,000 players" is a worst case that assumes everyone is signed in.
(c) "Largest single load on the database" is plausible because chat is the most frequent poll, but it is not proven. The chunk refreshes at 8–15 s may cost more per call.
(d) The closed panel needs some polling to drive the unread badge (chat-unread-badge), so fix (1) must keep a slower background poll rather than stopping it. The suggestion already says this.

### F031: Each signed-in request makes 3 database lookups to identify the player, and the Worker isn't placed near the database

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md §3.5 'Session auth does D1 reads on every API request'. Still undone, and the lookup grew from 1 to 3 queries.

**Summary.** Before doing any real work, the server makes three separate trips to the database to find out who a signed-in player is. Each trip goes from the data center nearest the player to the single region where the database lives, so players outside North America pay that distance three or more times per request. Merging the lookups into one and turning on Cloudflare's Smart Placement (one config line) would make every signed-in request faster.

**Technical detail.**

loadSessionFromToken selects the session+users join with 'NULL AS username, NULL AS avatar_url ...', then withUserProfileFields re-reads the same users row (a legacy fallback for schemas without those columns; they have existed since migrations 0016/0024/0030). loadOptionalRequestAuth then calls attachSchoolContext, which is a third query. Collapse these into one statement: `SELECT s.*, u.*, ss.id, sc.slug ... FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN school_students ss ON ss.user_id=u.id LEFT JOIN school_classrooms sc ON sc.id=ss.classroom_id WHERE s.token_hash=?`, and remove the missing-column fallbacks. wrangler.jsonc has no `placement`; add `"placement": { "mode": "smart" }` so API invocations that make many sequential D1 calls run next to the D1 primary (static assets are unaffected because run_worker_first only covers /api/*). Validate on the safety env with the existing Server-Timing headers. Optionally also enable D1 read replication and use withSession('first-unconstrained') on the public read paths; it is already done in roomComments/worldTiles.

**Evidence.**

- src/cloudflare/worker/auth/store.ts:821-846 — session query selects NULL AS username/avatar_url/bio/selected_avatar_id
- src/cloudflare/worker/auth/store.ts:857 + :1101-1125 — withUserProfileFields makes a second SELECT on users for the same row
- src/cloudflare/worker/auth/request.ts:93-97 + src/cloudflare/worker/school/store.ts:426-443 — a third query for school context on every authenticated request
- wrangler.jsonc:1-60 — no 'placement' setting; a single D1 binding and no read-replica session usage on hot paths
- src/cloudflare/worker/roomComments/store.ts:66 — withSession('first-unconstrained') is used here and could be reused

**Fact-check (partially confirmed).**

1. **Two databases, not one.** wrangler.jsonc binds DB and JAM_DB.
2. **The lookup did not grow from 1 to 3.** It was already three queries when docs/2026-06-10-repo-improvement-plan.md §3.5 was written (profile re-read added 2026-03-23 in f8c2ba20, school lookup added 2026-05-19 in 71638ea3). That plan proposed a KV / Cache API session cache, not merging the queries.
3. **Smart Placement is not a free one-line win.** The Worker serves anonymous public reads from caches.default via core/publicCache.ts, used by the world, worldTiles, rooms, runs, profiles, share and roomComments routes. That cache is local to each data center, so moving the Worker could slow cache hits for anonymous players far from the database. Smart Placement also needs steady traffic from several locations, and there are unconfirmed community reports that it can stall with more than one D1 binding. Recommend it only as a measured experiment on the safety environment, comparing the Server-Timing 'auth'/'d1' entries with X-WAMP-Cache hit latency, not as a guaranteed improvement.
4. **The claim understates the reach.** /api/world, /api/world/chunks and /api/world/chunks/summary (src/cloudflare/worker.ts:351-376) run the full three-query auth only to check scopes. Signed-in explorers pay those trips on every chunk fetch, and on the summary endpoint they also skip the anonymous edge cache.
5. **Two cheap fixes beyond merging the queries.** For a plain cookie session on these public GETs, auth can be skipped entirely: the scope check only applies to API tokens. The API-token path's awaited UPDATE of last_used_at (store.ts:928-936) can move to ctx.waitUntil.

### F033: Profiles still use the slow all-in-one endpoint (≈0.5–1.3 s, 80 KB, never cached), including on every signed-in page load

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** docs/performance-code-health-roadmap.md Wave 2: 'Split profile summary, room, and playlist subresources' (server side done, client never switched) and 'Limit discovery before enrichment' (not applied to profile rooms).

**Summary.** The faster, cached profile endpoints were built, but the game still calls the old combined one. It took over half a second on the server and 1.3 s end to end for Jonathan's profile. Signed-in players hit it on every visit just to check whether a reward animation is due, and again whenever they open a profile or leaderboard card.

**Technical detail.**

ApiProfileRepository.loadProfile/loadProfileByUsername call /api/profiles/:id, which runs handleProfileGet with no loadAnonymousPublicCache. The split routes (/summary, /rooms, /playlists) exist with Cache API and are unused by the client. rewardStingCatchup.runCheck fetches the full profile on AUTH_SESSION_REFRESHED (every signed-in page load) only to read profile.progression. buildPublishedRooms parses full published_json for every room the builder owns to extract version/goal/publishedAt, and handleProfileRoomsGet enriches all rooms and then slices offset..limit. Fix: point rewardStingCatchup and the profile/leaderboard/run-rating modals at /summary, and lazy-load /rooms?cursor and /playlists when those tabs open. In loadPublishedRoomsByCreator, select published_title, published_goal_type and the version from playable_content_index or rooms metadata instead of published_json, and apply LIMIT/offset in SQL before rating enrichment.

**Evidence.**

- GET https://api.wamp.land/api/profiles/f76e0baf-…/ — Server-Timing profile_rooms;dur=382 ... total;dur=543, TTFB 1.27 s, 80.8 KB, no X-WAMP-Cache
- GET .../profiles/f76e0baf-…/summary — total;dur=68, 5.9 KB, cached (public-20)
- src/profiles/profileRepository.ts:33-35 — loadProfile calls the aggregate /api/profiles/:id
- src/ui/setup/rewardStingCatchup.ts:94-101 — full profile loaded only to read profile.progression
- src/cloudflare/worker/profiles/routes.ts:38-51 — aggregate handler has no edge cache
- src/cloudflare/worker/profiles/store.ts:221-226 — rooms route builds every room, then slices
- src/cloudflare/worker/profiles/store.ts:393-395 — parses full published_json per room for a few metadata fields

**Fact-check (partially confirmed).**

Several details are wrong.

1. "Never cached" is overstated. For anonymous visitors the all-in-one route sends Cache-Control: public, max-age=20, so the browser can cache it (profileCacheInit, routes.ts:96-98). Only the edge cache is missing. The client also holds results in memory (staleWhileRevalidateCache.ts: fresh for 20 s, stale up to 60 s), and requests for the same key share one fetch. On page load, the identity chip and the reward-sting check share a single request.

2. Signed-in callers get no edge cache from /summary either: routes.ts:63 and :76 pass no edge context when auth is present, and responses are 'private, no-store'. For rewardStingCatchup, the gain from switching is skipping the ~430 ms rooms build, not caching.

3. The /rooms route does not "build every room, then slice" in production. wrangler.jsonc:31 and :79 set PLAYABLE_CONTENT_INDEX_READS=1, so loadUserProfileRoomsPage runs one indexed query with SQL LIMIT/OFFSET (store.ts:186-219; 18 ms live). Lines 221-226 are only the legacy fallback. The slow path is loadUserProfile (store.ts:90-96), which ignores the index flag. A cheap server-side fix: build the all-in-one route's publishedRooms from the same index query, the way loadPublishedPlayableCountForBuilder already does at store.ts:309-321.

4. There are more callers that only need progression or displayName than the claim lists: auth/client.ts:518 (identity chip, every signed-in load), OverworldPlayScene.ts:1719 (creator profile summary in the HUD), leaderboardModal.ts:612 and runRatingModal.ts:1043. All of them should use /summary.

5. profileModal opens on the rooms tab for other players (profileModal.ts:1676). It should fetch /summary and /rooms in parallel and lazy-load /playlists. The index rows zero out per-star counts (mapProfilePlayableContentRow), so check that the room cards don't need them.

### F035: Builders' in-progress room previews are sent in full to every player in the area on every room change

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md §2.2 suggested coalescing and 'delta messages'. Coalescing landed; deltas did not, and previews now ride on the same full-map message.

**Summary.** When someone is building, their live preview (the whole room, up to 120 KB) is included in the 'who's where' update. That update goes to everyone in the same map area whenever any player moves to another room or any builder edits. Players near active builders can download hundreds of KB per second they mostly don't need, which hurts mobile data and frame rate. Each of those events also pings a single shared stats server.

**Technical detail.**

flushPopulationBroadcast sends {roomPopulations, roomEditors, roomPreviews: computeRoomPreviews()} to every presence connection in the shard. Each SharedRoomPreview carries a full RoomSnapshot (accepted up to 120 000 chars). broadcastPopulations fires on any room change or mode change by any peer (shouldBroadcastPresencePopulations), on join and leave, and on every preview update (editor publishes every 1.2 s while dirty). It is coalesced to 250 ms, so up to 4 full-map sends per second per shard. Each of those paths also calls maybeSendShardHeartbeat(true), and force bypasses the 15 s throttle. That makes a DO-to-DO POST to the single global metrics room, whose handleHeartbeat does storage.list over all shard heartbeats and then a put, on every room transition anywhere in the world. Fix: (1) split previews out of 'populations' into 'preview:upsert {roomId, hash, snapshot}' / 'preview:remove' deltas sent only when that room's preview changes, and send createOverviewRoomSnapshot-sized data (the overview helper already exists in rooms/store.ts); (2) send populations as deltas or a small map only; (3) cap forced heartbeats to at most one per shard per 2–5 s, and keep heartbeats in memory in the metrics DO instead of listing storage on each POST.

**Evidence.**

- partykit/presenceServer.ts:462-468 — population broadcast includes roomPreviews: this.computeRoomPreviews()
- src/partykit/presenceProtocol.ts:47-50 + :73-78 — previews carry a full RoomSnapshot
- src/partykit/constructionPreviewRuntime.ts:51 — previews up to 120 000 chars are accepted
- partykit/presenceServer.ts:330-333 + src/partykit/presencePopulation.ts:81-93 — any room change triggers broadcastPopulations plus a forced heartbeat
- src/scenes/editor/presence.ts:16 — SHARED_PREVIEW_PUBLISH_INTERVAL_MS = 1_200
- partykit/presenceServer.ts:663-666 — force bypasses the HEARTBEAT_INTERVAL_MS throttle
- partykit/presenceServer.ts:726-734 + :744-760 — each heartbeat POST lists all heartbeat keys in storage, then writes

**Fact-check (partially confirmed).**

- **Heartbeats:** preview update and clear paths (`partykit/presenceServer.ts:519, :584`) do not force a heartbeat. Forced heartbeats come from join, leave, `clearPresence`, and room/mode change. Those are not coalesced: each room change sends its own DO-to-DO POST right away, and that POST does a `storage.list` plus a put on the metrics room.
- **Preview size:** a typical preview is about 9–20 KB (an empty 3-layer 40x22 snapshot is about 8.8 KB). Only rooms with custom sprite or tile pixel data get near the 120 KB cap.
- **Bandwidth:** the "hundreds of KB/s" figure is a worst case that needs several builders in one 8x8 chunk.
- **Fix (1):** do NOT replace the preview with `createOverviewRoomSnapshot`. The shared preview is the playable snapshot for live construction rooms (`src/scenes/overworld/worldStreaming.ts:1299-1302`; commit baf75fcd), so the full snapshot must stay available. Instead:
  - Send `preview:upsert`/`preview:remove` deltas, with a hash or version, only when that room's preview changes. Strip previews out of 'populations', which becomes counts only.
  - On the client, keep the existing snapshot object when the hash or version is unchanged, rather than calling `cloneRoomSnapshot` on every message in `src/presence/worldPresence.ts` `replaceRoomPreviews`. This restores the reference checks in `worldStreaming.ts:2750-2781` and stops the needless `refreshVisibleRoomsFromCache` calls.
  - Optionally send an overview-sized version for rendering at a distance and fetch the full snapshot when a player enters the room.
- **Fix (3):** add a minimum interval (2–5 s) for forced heartbeats, and cache heartbeats in memory in the metrics room. Both still stand.

### F037: Everyone arrives in the same map area, which one multiplayer server handles alone, and each player opens two connections per area

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md §2.3 'Server-side interest management', 'before the launch spike, not after', and roadmap Wave 4 'add interest management'. Still not implemented.

**Summary.** New players all arrive in the same area, and that area's multiplayer server forwards every player's movement to every other player there, about 12 times a second. That's fine with dozens of players but would overwhelm both the server and phones if a post went viral and hundreds arrived at once. Room chat also opens a second, separate connection per area on top of the presence one.

**Technical detail.**

Shards are 8×8-room chunks. flushPresenceUpserts sends every pending peer upsert (80 ms flush, from 200 ms client publishes) to every presence connection in the shard, so cost per recipient grows with shard population, not with what the player can see. With N players in the spawn chunk, egress is about N² × 150 B × 12.5/s; at N=300 that is roughly 170 MB/s from one Durable Object and about 0.5 MB/s into each client. Fix (staged): (1) per-recipient interest filtering in flushPresenceUpserts, sending full-rate upserts only for peers in the recipient's room and its 8 neighbors (the server already knows each connection's presence.roomCoordinates) and a 1 Hz thinned set or counts for the rest; (2) cap visible ghosts per room (e.g. nearest 24) and lower the publish rate when a room is crowded; (3) multiplex room chat onto the presence socket, since the server already distinguishes channel per connection, which halves sockets and token fetches; (4) consider splitting the spawn room into its own shard. Add a 300-peer probe next to the existing 48-peer one before any launch push.

**Evidence.**

- src/presence/worldPresence.ts:29 — 200 ms moving publish interval
- partykit/presenceServer.ts:99 + :1329-1347 — 80 ms flush; upserts go to all presence connections in the shard
- partykit/presenceServer.ts:1361-1383 — sendToConnections fans out to every matching connection (no interest filter)
- src/presence/roomChat.ts:235-246 — a second PartySocket per chunk for room chat
- partykit/presenceServer.ts:833-835 — the server already parses a per-connection 'channel', so multiplexing is possible
- git 9cd7a1eb — 'default arrivals to tutorial room' concentrates new players in one chunk

**Fact-check (partially confirmed).**

Per-peer upsert rate is 5 Hz (200 ms client publish while moving). The 80 ms server flush only batches; it does not raise any peer's rate to 12.5/s. Payloads are about 300-400 B, not 150 B. The revised estimate is about N² × 1.75 KB/s for N moving players in one shard: around 150 MB/s of shard egress and about 0.5 MB/s per client at N=300.

The client already caps rendered ghosts to the 24/18/12 nearest by zoom (src/scenes/overworld/presence.ts:1188-1203), so step (2)'s render cap is done. What remains is bandwidth and JSON parsing.

A 150-peer probe already exists (docs/2026-07-29-gameplay-performance-plan.md:81).

There is a cheaper quick win than multiplexing. RoomChatClient should subscribe only to the player's own chunk rather than the whole loaded chunk window. Its sockets to the other chunks can never receive chat, because the server filters chat to the sender's room (presenceServer.ts:860-867) and presence is published only to the local shard (roomChat.ts:118-140). Separately, room-chat connects should stop triggering broadcastPopulations (presenceServer.ts:224).

The core finding stands: there is no server-side interest filter in flushPresenceUpserts, and all arrivals funnel into chunk (-2,-1). This was recommended before as §2.3 and is still not built.

### F095: Each idle visitor holds 50 PartyKit websockets (25 presence + 25 chat), even in a background tab

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** Just looking at the world map opens 50 live connections to the multiplayer server: one per map chunk, for both presence and chat. They stay open when the tab is in the background. That's battery and data drain on phones, and server cost that grows with every visitor.

**Technical detail.**

OverworldPresenceController.setSubscribedChunkBounds (src/scenes/overworld/presence.ts:355-381) and the room-chat controller (src/scenes/overworld/roomChat.ts:170-187) open one PartySocket per chunk in the 5x5 chunk window (worldPresence.ts:201-221 openShardSocket). Each socket also POSTs /api/presence/identity-token: I counted 16 at boot and 2 more on every chunk-window change while panning. During boot the window moves from 0,0 to the arrival room, so about 50 sockets are opened and immediately closed ('WebSocket is closed before the connection is established' ×50 in the console). Fix: (a) subscribe to presence only for the 3x3 chunks around the selected room (or a single 'lobby' socket that multiplexes shard subscriptions server-side); (b) open chat shards only for the current room's chunk; (c) delay subscriptions until the boot window settles (debounce about 500ms after overworld-refresh:ready); (d) close all shard sockets after document.hidden has been true for about 30s and reconnect on visibilitychange.

**Evidence.**

- Live (built-in pane, real production path): activeScene.presence = {subscribedShardCount:25, connectedShardCount:25}; roomChatDebug.snapshot.connectedShards lists the same 25 chunk ids, all while document.hidden=true
- Pane console during boot: about 50 'WebSocket connection to wss://everybodys-platformer-presence…/parties/main/<x,y> failed: WebSocket is closed before the connection is established'
- Playwright request log: POST api.wamp.land/api/presence/identity-token in pairs at 978, 3251, 4864, 6821, 7301, 8168ms during a zoom/pan session
- src/scenes/overworld/presence.ts:372-381 — loops every chunk in bounds → client.setSubscribedShards(chunks)
- src/scenes/overworld/roomChat.ts:180-187 — the same per-chunk loop for chat

**Fact-check (partially confirmed).**

Correct points: each visitor holds 2 PartyKit sockets per chunk in the loaded window, presence and room-chat on the same server separated by a `channel` query param. That is 50 sockets at the default browse zoom, and up to about 98 when zoomed out in browse (radius cap 3 or 4). Nothing closes them while the tab is hidden.

Wrong points:
(1) The identity-token POST is cached per client for about 4 minutes and shared across sockets (identityTokenClient.ts:20-33). The POST pairs come from refreshIdentity() rebuilding both clients, not from each socket or each pan.
(2) A boot gate already exists (browseRealtimeStartup.ts, f868aa66). The churn likely comes from handleAuthStateChanged and handlePlayerAvatarChanged skipping it (OverworldPlayScene.ts:3032-3062) and from play-mode boots, where the gate is skipped.
(3) Limiting presence to the 3x3 around the selected room would remove room-population and editor badges from browse.

Better fixes, cheapest first:
- Send both channels over one socket per shard (halves the count; needs a server change).
- Close the sockets after document.hidden has been true for about 30s.
- Route the identity refresh through the startup gate.
- Give realtime its own radius cap, smaller than the streaming window, and use a single relay/lobby socket only if needed.

### F036: Signed-in players get no edge caching; every leaderboard, room summary and discovery read goes to the database

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** low · **effort:** medium
- **Flagged before:** docs/performance-code-health-roadmap.md Wave 2: 'Cache public bases for 20 seconds and overlay viewer-specific state afterward'. Only the anonymous half shipped.

**Summary.** The 20-second edge cache only applies to logged-out visitors. As soon as someone signs in, which is most active players since you must sign in to get on leaderboards, every read goes back to the database. Caching the shared part for everyone and adding only the 'your rank' piece per player would make the most engaged players' experience faster and cut database load.

**Technical detail.**

loadAnonymousPublicCache is called with `auth ? undefined : context`, so any authenticated request bypasses it, and the responses are 'private, no-store' or 'private, max-age=20'. The public base (top-N rows, room summary, discovery page, profile summary) is identical for all viewers; only viewerBest/viewerRank/viewer states differ. Restructure: always serve the base from loadAnonymousPublicCache keyed by URL (with credentials stripped), then for authenticated users run only the viewer-overlay query (loadViewerRankedRoomLeaderboardRow / loadDiscoveryViewerRoomStates) and merge. Alternatively expose /viewer sub-endpoints that the client calls in parallel. Invalidate by including the room's current version or published hash in the URL, which the client already knows from chunk summaries.

**Evidence.**

- src/cloudflare/worker/runs/routes.ts:519-522 — room leaderboard is cached only when !authenticated
- src/cloudflare/worker/rooms/routes.ts:166-169 — room summary is cached only for anonymous users
- src/cloudflare/worker/profiles/routes.ts:64 and src/cloudflare/worker/world/routes.ts:152 — same anonymous-only pattern
- src/runs/runRepository.ts (finishRun → loadRoomLeaderboard) — leaderboard requests use credentials:'include', so signed-in players always miss

**Fact-check (partially confirmed).**

Corrections to the claim:

1. **World chunk summaries:** signed-in browser players are not affected. The client sends `credentials: 'omit'` (worldRepository.ts:206-208, 382-383), so they already get edge hits. Drop world/routes.ts:152 as evidence.
2. **"Every read goes to the database":** overstated. A per-player client stale-while-revalidate cache (staleWhileRevalidateCache.ts:10-11: 20 s fresh, 40 s stale) already deduplicates repeat reads. The session D1 lookup in `loadOptionalRequestAuth` runs before any cache check, so an overlay still costs a session read plus a viewer query.
3. **Room summary:** one indexed row read (rooms/store.ts:236), used only by the ownership popup. Low value; drop it.
4. **Quick win the claim missed (small effort):** builder discovery (runs/routes.ts:670-684), profile rooms (profiles/routes.ts:67-78) and profile playlists (profiles/routes.ts:81-92) never use the viewer, yet bypass for signed-in users. Always pass `context` and emit `public, max-age=20` for these.
5. **Overlay invalidation:** the room-version or published-hash key does not change when a new run is posted. A player who just set a record could see a top-N list up to 20 s stale without their new time, even though their own best is fresh. Key on a leaderboard revision (for example a run count or last-run timestamp the finish response returns), or skip the cache for the submitter's next fetch.

The overlay restructure for room and global leaderboards and room discovery remains medium effort.

### F032: No CORS preflight caching, so most game requests make an extra round trip

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** The game (wamp.land) and the API (api.wamp.land) are on different domains, so before most requests the browser first sends a permission check. The API doesn't tell browsers how long they can remember the answer, so they repeat the check about every 5 seconds. Starting a run, submitting it, loading world rooms and the guest heartbeat each pay an extra round trip, and Cloudflare bills each check as a request. A one-line fix.

**Technical detail.**

corsHeaders() returns Allow-Origin/Headers/Methods but no Access-Control-Max-Age, and the OPTIONS branch in worker.ts returns only corsHeaders. Without Max-Age, browsers cache preflights for 5 s. apiRequest sets Content-Type: application/json on every body request, which makes it non-simple, so run start/finish, POST /api/rooms/snapshots/query (world streaming), presence identity tokens, guest replay samples and the guest heartbeat (every 15 s, which outlives the 5 s cache) all preflight. Add 'Access-Control-Max-Age': '7200' to the OPTIONS response; Chromium caps at 2 h, Firefox honors up to 24 h. For keepalive beacons (heartbeat), consider text/plain bodies to avoid preflight entirely.

**Evidence.**

- src/cloudflare/worker/core/http.ts:40-56 — corsHeaders has no Access-Control-Max-Age
- src/cloudflare/worker.ts:299-303 — OPTIONS returns 204 with corsHeaders only
- OPTIONS https://api.wamp.land/api/guest-activity/heartbeat — 204, headers include allow-origin/headers/methods but no access-control-max-age
- src/api/request.ts:13-15 — Content-Type: application/json is added to every request with a body
- src/analytics/guestActivity.ts:17 + :107-115 — JSON POST heartbeat every 15 s
- src/persistence/worldRepository.ts:300-307 — world snapshot batches are JSON POSTs

**Fact-check (partially confirmed).**

Add 'Access-Control-Max-Age': '7200' only to the /api OPTIONS response (src/cloudflare/worker.ts:299-304), or to noContentResponse if that is reused for preflights. Corrections to the claim:
(a) Browsers cache a preflight per exact URL, so only fixed URLs benefit: /api/runs/start, /api/rooms/snapshots/query and /api/guest-activity/heartbeat. /api/runs/{attemptId}/finish has a unique URL each time and will still preflight on every run.
(b) Browser caps differ. Chromium caps at 7200 s and Firefox at 86400 s. WebKit (Safari and every iOS browser) caps at 600 s, which still covers the 15 s heartbeat.
(c) The Cloudflare request cost is negligible. The benefit is about one network round trip saved on repeated requests.
(d) Run start and the heartbeat are not on gameplay's critical path. The only delay a player might notice is on world-streaming snapshot queries after an idle gap.
Optional: send the heartbeat as text/plain (the server must still parse the JSON body) to skip its preflight entirely.

### F039: Every non-GET API request also runs a world-tile queue check

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** After almost every save-type request (including the guest heartbeat, chat messages, replay uploads and even world-loading queries), the server also checks the database for map tiles waiting to be re-rendered. Only room publishes create that work, and a separate worker already sweeps it every minute, so most of these checks are wasted database queries.

**Technical detail.**

The fetch handler's finally block calls scheduleWorldTileOutboxDispatch(env, ctx) for every non-GET/HEAD request. That runs loadPendingWorldTileOutbox, an indexed SELECT on world_render_tile_outbox, in waitUntil. Outbox rows are produced only by triggers on rooms publish/background changes (migration 0041). The world-tile-renderer Worker already runs every minute and claims pending and stale dispatching rows. Fix: call scheduleWorldTileOutboxDispatch only from the handlers that can produce outbox rows (room/expanded-room/course publish, unpublish, revert, background-image status changes) and rely on the renderer cron otherwise. This removes one D1 query from every heartbeat, chat send, replay sample and snapshot-batch POST.

**Evidence.**

- src/cloudflare/worker.ts:803-806 — finally { if (method !== GET/HEAD) scheduleWorldTileOutboxDispatch(env, ctx) }
- src/cloudflare/worker/worldTiles/service.ts:211-217 — every dispatch starts with a D1 SELECT of pending outbox rows
- migrations/0041_world_render_tiles.sql:119, :191, :266, :339 — outbox rows come only from room-publish/background triggers
- wrangler.world-tile-renderer.jsonc:11-12 — renderer cron '* * * * *'
- src/cloudflare/worldTileRenderer/store.ts:366 — renderer sweeps pending and stale 'dispatching' rows itself

**Fact-check (confirmed).**

There are a few things the implementer should know. (a) Sending a dispatch right after a publish is deliberate. docs/overworld-tile-pyramid.md:54-62 describes the queue as a wake-up mechanism and the one-minute renderer cron as a backstop for repairs. Removing the post-publish dispatch would make new rooms take up to about 60 seconds longer to show up as overworld tiles, so the fix has to keep dispatching on paths that can produce outbox rows. The reviewer's fix already does that. (b) Six server modules write rows that the triggers react to: rooms/store.ts, expandedRooms/writeStore.ts, courses/store.ts, backgroundImages/routes.ts, admin/routes.ts and maintenance/routes.ts. Rather than adding calls inside each handler, a simpler and safer version keeps the `finally` hook but adds two gates. First, it only fires for an allowlist of path prefixes: /api/rooms/ except /api/rooms/snapshots/query, plus expanded-rooms, courses, background-images, admin, maintenance and worlds. Second, it skips responses with status ≥ 400. If any path is missed, the cron still picks up its rows within a minute. (c) The `finally` hook also runs on 404 and error responses, such as bot POSTs to unknown routes, so those requests trigger the outbox SELECT too.

### F038: Guest replay screenshots are stored in the main database, and nothing else is ever cleaned up

- **Area:** Backend performance, cost & reliability
- **Type:** improvement · **impact:** low · **effort:** medium

**Summary.** Guest session recordings save a JPEG screenshot every second directly in the main game database, up to about 3 GB of a 10 GB limit at the current daily budget. Each upload also re-scans every earlier screenshot in that session. Other tables (old sessions, sign-in codes, tile render jobs, visit logs, anti-cheat traces) are never pruned. Moving images to R2 storage and adding a daily cleanup keeps the database small, fast and cheap.

**Technical detail.**

Each guest_replay_samples row stores up to a 16 KB base64 JPEG inside payload JSON: 300 samples/session, budget 100 sessions/day, 7-day expiry, so up to ~3.4 GB at steady state. Every /samples POST (every ~3 s per recorded guest) runs an UPDATE whose four subqueries json_extract/json_each over all of the session's payloads, re-parsing every stored image string each time. /start runs the purge DELETE on every guest page load, even after the daily budget is exhausted. On the client, canvas.toDataURL('image/jpeg') runs synchronously on the main thread once per second during play/edit, a likely hitch source on phones. Fix: write frames to R2 (key session/sequence.jpg) and keep only metadata in D1; set played/moved/signup/signed_in incrementally from the incoming batch; purge only from the cron; use canvas.toBlob or OffscreenCanvas in an idle callback. Extend the hourly scheduled() handler to prune expired sessions/magic_link_tokens, world_render_tile_outbox rows in 'dispatched' older than 7 days, guest_visits older than 90 days, and run_verification_audit.trace_json older than 30 days.

**Evidence.**

- src/analytics/replay/model.ts:1-2 — REPLAY_SECONDS = 300, REPLAY_IMAGE_LIMIT = 16_000
- migrations/0046_guest_replays.sql — payload TEXT holds the whole sample including the image
- src/cloudflare/worker/guestReplay/routes.ts:86-92 — every samples POST re-scans all of the session's payloads with json_extract/json_each
- src/cloudflare/worker/guestReplay/routes.ts:57-59 — purgeGuestReplays DELETE runs on every /start
- src/analytics/replay/recorder.ts:108-109 — synchronous toDataURL once per second on the main thread
- src/cloudflare/worker.ts:261 — the only scheduled job is purgeGuestReplays
- src/cloudflare/worker/runs/verification.ts:329-352 — trace_json stored in D1 indefinitely

**Fact-check (partially confirmed).**

Restate the storage figure as a worst-case ceiling of about 3.4 GB. Realistically it is a few hundred MB, because browse-mode samples have no image, sessions are often shorter than 5 minutes and the budget may not fill. It is bounded by a 7-day purge that works (hourly cron, cascade delete) and fits in D1's included storage, so drop "cheap" as a reason. The purge on every /start is an indexed no-op DELETE and minor. Email sign-in codes are rows in magic_link_tokens, not a separate table. Make guest_visits pruning optional, since it is analytics data.

Order the fixes by value-to-effort:
- (a) Set played/moved/signup/signed_in from the incoming batch only, e.g. `played = played OR ?`, removing the four full-session subqueries at routes.ts:90-95. Small.
- (b) Capture frames with createImageBitmap/toBlob outside POST_RENDER, or skip capture on low-performance or mobile profiles. Small.
- (c) Add hourly deletes for expired sessions and magic_link_tokens, plus 'dispatched' outbox rows older than N days. Small.
- (d) Move frames to an R2 bucket with a 7-day lifecycle rule. Medium: needs a new binding, a write path and an admin read path.

### F249: In-game Report a bug with a recent replay and diagnostic context

- **Area:** Backend performance, cost & reliability
- **Type:** idea · **impact:** medium · **effort:** medium
- **Added:** 2026-10-08, at Jonathan's request; not part of the original October 3 review
- **Status:** local candidate ready on 2026-10-08, stacked on F150; review and coordinated delivery pending before F155/F144
- **Reference:** [gsimone's in-game bug-report demonstration](https://x.com/ggsimm/status/2108245377899966491)

**Summary.** Let a player or builder report a problem while it is happening, with a short description and the previous 10–20 seconds of gameplay attached. Automatically include the exact room and version, application build, browser/device details and relevant errors. Jonathan can review the report and replay together in a private admin inbox. This would make intermittent camera, avatar and rendering hiccups easier to investigate.

**First delivery scope and acceptance.**

- A small Report a bug action is reachable on desktop and phones during play and building, for guests and signed-in users. The dialog contains notes and a preview of the evidence being attached.
- Keep a bounded local buffer of recent gameplay and attach its 10–20-second replay when the user submits. Include a current screenshot and a clear indication when recent replay evidence is unavailable; allow the written report to be saved in that case.
- Attach room coordinates/ID, the published version or explicit draft context, the application build, viewport, browser/device details and a bounded set of relevant errors. Copy only supported diagnostic fields; exclude credentials, form values and chat contents.
- Save reports in a private admin inbox with notes, replay playback, room link, timestamp and open/resolved status. Show confirmation only after a report is actually stored; preserve notes and allow retry after an upload failure.
- Keep capture within explicit runtime, memory and storage budgets. Verify desktop and phone gameplay with reporting enabled, including camera smoothness. Reuse F001's recorder improvements and F038's bounded storage design rather than adding another synchronous screenshot encoder to the play loop.
- Respect existing recording preferences. If capture is disabled, explain the available evidence and still permit a text report. Reconstructing or resuming the exact simulation can be considered later; it is not provided by today's screenshot replay system.

**2026-10-08 implementation candidate.** `codex/checkup-bug-reporter-2026-10-08` adds the report dialog, a bounded approximately 15-second visual replay/current screenshot, allowlisted room/draft/course/build/device/error context, written-only fallback, stored-receipt confirmation and stable retries. Capture uses bitmap/toBlob asynchronously, reads context only at the capture cadence and omits canvas frames containing room-chat bubbles. Shared opt-out works with DNT/GPC, blocked storage and changes from another tab. A private admin inbox provides playback/scrubbing, room links, details, open/resolved status, Reopen and Delete. Atomic D1 gates bound reports and evidence; notes last 30 days and images seven.

Full **371 files / 2,967 tests**, quality gates, native desktop/phone/play/build/Expanded Room/touch/persistence and inspected installed-client screenshots pass. Local Chromium movement p95 is **9.9ms** with capture off/on, with no frames over 50ms in either five-second sample. This first delivery uses screenshot replay rather than a full simulation trace. [Local demo](http://127.0.0.1:3040/r/84/40?welcome=0&avatar=gamejew-red). The checklist remains unticked pending local review, migration 0060 and API Worker + Pages publication. See [candidate receipt](../development/checkup-delivery-2026-10-03.md); evidence `/tmp/wamp-bug-reporter-2026-10-08/`. F001/F038 and physical-device performance certification remain separate.

**Original groundwork, checked against `d534619c` on 2026-10-08.**

Guest session recording and private replay viewing already exist, but they do not provide a player-submitted bug report. The recorder stops after sign-in and its samples contain screenshots, coarse position and selected actions rather than a complete simulation/input trace. Extending this needs an explicit report flow and a capture path that also supports signed-in players.

**Evidence.**

- src/analytics/replay/recorder.ts:24-28 — recording preferences and the remote-API development skip
- src/analytics/replay/recorder.ts:75-96 — guest samples include mode, room, position, selected actions and an image
- src/analytics/replay/recorder.ts:116-123 — recording stops when the visitor becomes authenticated
- src/analytics/replay/model.ts — bounded screenshot sample/session models; no report notes or complete simulation trace
- src/admin/replays.ts:68-75 — existing private replay loading and scrubbing to build on
- F001 and F038 — related capture performance and replay storage work; these remain separate open items

### F040: API trusts wamp.pages.dev (a domain WAMP does not own), enabling cross-site account takeover

- **Area:** Security & abuse resistance
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** The server treats wamp.pages.dev and all its subdomains as part of WAMP, but that address actually serves an unrelated lottery-spam site. Whoever controls it can act as any signed-in Chrome/Edge player who visits a page there: silently mint a permanent API key for their account and read their email. It also trusts any localhost page in production. The fix is to delete one hostname from a list.

**Technical detail.**

src/config/appHosts.ts:4-8 lists 'wamp.pages.dev' in PAGES_PROJECT_HOSTS, and isTrustedPagesHostname (appHosts.ts:10-13) also trusts every *.wamp.pages.dev subdomain. The project's real Pages host is wamp-9i6.pages.dev; GET https://wamp.pages.dev returns an Indonesian lottery site. corsHeaders (src/cloudflare/worker/core/http.ts:47-50) echoes these origins with Access-Control-Allow-Credentials:true, and isTrustedRequestOrigin (http.ts:58-61,81-87) passes them plus ANY http://localhost:* origin in production. That origin check is the only CSRF defense (requireTrustedOriginForMutation, auth/request.ts:108-114). The session cookie is SameSite=None;Secure (auth/request.ts:142-155) so Chrome/Edge send it on cross-site fetches. A page on *.wamp.pages.dev can fetch('https://api.wamp.land/api/auth/tokens',{method:'POST',credentials:'include'}); handleCreateApiToken (auth/routes.ts:467-490) returns a raw epat_ token with full rooms/runs scopes. Confirmed live: curl with Origin https://evil.wamp.pages.dev to api.wamp.land/api/auth/session returned access-control-allow-origin: https://evil.wamp.pages.dev with allow-credentials:true. Fix: drop 'wamp.pages.dev' (keep 'wamp-9i6.pages.dev'); scope localhost trust to non-production (gate on request hostname or an env flag).

**Evidence.**

- src/config/appHosts.ts:4 — PAGES_PROJECT_HOSTS includes 'wamp.pages.dev' which resolves to a third-party lottery site
- src/config/appHosts.ts:11 — isTrustedPagesHostname trusts host and every `.${project}` subdomain
- src/cloudflare/worker/core/http.ts:47 — corsHeaders echoes any trusted Origin with Access-Control-Allow-Credentials:true
- src/cloudflare/worker/auth/request.ts:144 — session cookie uses SameSite=None when Secure, so it is sent cross-site
- live: curl -H 'Origin: https://evil.wamp.pages.dev' https://api.wamp.land/api/auth/session returned access-control-allow-origin: https://evil.wamp.pages.dev + access-control-allow-credentials: true

**Fact-check (confirmed, confirmed, confirmed).**

Corrections to minor details. None of them weaken the claim.
- **Real Pages project:** production deploys to the Pages project `wampland` (scripts/deploy_prod.mjs:38-39), so wampland.pages.dev is the main Pages host, not wamp-9i6.pages.dev. wamp-9i6 is a second project added in c896b915. Its random suffix suggests the name "wamp" was already taken. The fix should drop only 'wamp.pages.dev' (and its test fixture at src/cloudflare/worker/core/http.cors.test.ts:28), keeping wampland.pages.dev and wamp-9i6.pages.dev if the team confirms it owns the latter.
- **Who can attack:** only whoever owns the "wamp" Pages project, an unrelated third party, can host on *.wamp.pages.dev. It is not any attacker.
- **Which browsers:** the attack only works where third-party cookies are sent (Chrome/Edge defaults). Safari and Firefox block or partition them by default.
- **Localhost:** trust for localhost (http.ts:82-84) is lower severity. It needs attacker-controlled content on the victim's own loopback. It should still be limited to non-production.
- **Magic-link redirects:** isTrustedAppHostname is also reused for magic-link returnTo validation (src/cloudflare/worker/auth/store.ts:1308-1310), so wamp.pages.dev is an allowed post-login redirect target too.
- **Actual account takeover:** with a cookie-authenticated request, handleRequestMagicLink (routes.ts:181-195) lets a trusted origin request a 'link_email' magic link to an attacker-chosen address for a victim who has no email (e.g. a wallet-only account). The attacker opens that link. handleVerifyMagicLink (routes.ts:269-289) then attaches the attacker's email and creates a session for the victim's user id. That is full takeover for email-less accounts, which goes beyond the API-token risk.

Minor detail fixes (the core claim stands):
1. The canonical production Pages project is 'wampland' (wampland.pages.dev), not wamp-9i6. Both are WAMP-owned and both should stay trusted.
2. wamp.pages.dev is trusted in more places than the CORS check:
   - The client-side early bootstrap at src/main/earlyWorldTileBootstrap.classic.ts:1596-1597.
   - Magic-link redirect bases: isTrustedAuthRedirectHostname at src/cloudflare/worker/auth/store.ts:1309 accepts it through isTrustedAppHostname.
   - The fix should remove it from all three places and update http.cors.test.ts:28, which currently asserts that abc123.wamp.pages.dev is trusted.
3. The localhost trust is duplicated in store.ts:1318 (isLocalDevHostname for redirect bases). It should be gated to non-production in the same way.

One detail in the claim is wrong. The project's real production Pages host is wampland.pages.dev, not wamp-9i6.pages.dev. scripts/deploy_prod.mjs:38-39 deploys with --project-name wampland. wamp-9i6.pages.dev is a second WAMP Pages project that collaborator Alex Florez added in commit c896b915. Both wampland.pages.dev and wamp-9i6.pages.dev serve a page titled "WAMP" and should stay on the list. Only 'wamp.pages.dev' should be removed, at src/config/appHosts.ts:6.

The fix as stated also needs these additions:
- Update the tests that expect the bad host to be trusted: src/cloudflare/worker/core/http.cors.test.ts:28 expects abc123.wamp.pages.dev to be trusted. Change it to assert the host is rejected.
- Removing the host from appHosts also closes the sign-in-link redirect allowlist, because auth/store.ts:1309 uses the same list. The fix should mention this.
- The impact is understated. Through POST /api/auth/wallet/verify, a page on the stray host could permanently link the attacker's wallet to a victim's email-only account (handleWalletVerify, routes.ts:537+). That is a lasting account takeover, not only minting API tokens or reading the email address.
- Extra hardening: in production, also stop trusting localhost origins for credentialed requests. Optionally, set the session cookie to SameSite=Lax when the request comes to api.wamp.land. wamp.land and api.wamp.land count as the same site, so Lax still works for production and closes the whole class of cross-site attacks.

### F186: The live production server has a 'delete the whole database' endpoint behind one shared password

- **Area:** Trust & safety, moderation, ops & observability
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** There's a tool meant only for the test server that wipes every user, room, and session. It is also switched on in the real game, protected by a single shared admin key. A leaked key, or one wrong setting in the refresh script, could erase WAMP. Turning it off in production is a tiny change.

**Technical detail.**

`/api/admin/snapshot/reset` and `/api/admin/snapshot/import/:table` are routed for every environment (admin/routes.ts:104-111). Reset runs `DELETE FROM` over users, rooms, room_versions, sessions, agent_tokens and more (admin/snapshot.ts:10-46, 56-70). Import does `INSERT OR REPLACE` into users/sessions (snapshot.ts:72-110), so a key holder could also forge a login session for any account. Auth is a static `ADMIN_API_KEY` header compared with `===` and not rate-limited (auth/request.ts:186-198). The refresh script's guardrail checks only the target D1 *name* (refresh_safety_from_prod.mjs:191-201). The HTTP calls that actually delete go to `SAFETY_REFRESH_HEALTHCHECK_BASE_URL` (lines 8-10, 420), which can be overridden and isn't validated. The script also falls back to the generic `ADMIN_API_KEY`/.dev.vars (464-481), which suggests the same key is used on safety and prod. Fix: (1) in admin/routes.ts, return 404 for snapshot routes unless `env.ENABLE_SNAPSHOT_ADMIN === '1'`, and set that var only under `env.safety` in wrangler.jsonc. (2) Make the script refuse any base URL that isn't a `*-safety.*` workers.dev host. (3) Use different ADMIN_API_KEY values per environment, compare with `crypto.subtle.timingSafeEqual`, and optionally put Cloudflare Access (free for 50 users) in front of `/api/admin/*` and the admin HTML pages.

**Evidence.**

- src/cloudflare/worker/admin/routes.ts:104-111 — snapshot reset/import routed in production
- src/cloudflare/worker/admin/snapshot.ts:56-70 — reset deletes users, rooms, room_versions, sessions, etc.
- src/cloudflare/worker/admin/snapshot.ts:96-97 — import builds `INSERT OR REPLACE INTO` for any listed table incl. sessions
- src/cloudflare/worker/auth/request.ts:186-198 — single static key, plain string equality
- scripts/refresh_safety_from_prod.mjs:8-10,420 — destructive admin calls go to an env-overridable URL that is not validated
- scripts/refresh_safety_from_prod.mjs:464-481 — falls back to the generic ADMIN_API_KEY

**Fact-check (confirmed, partially confirmed, partially confirmed).**

Some nuances; the core claim stands.
(1) "Same key on safety and prod" is an inference, not something the code proves. The script reads SAFETY_REFRESH_ADMIN_API_KEY first. If the two keys differ, pointing the base URL at prod by mistake would just get a 403. Wiping prod by accident needs both a wrong URL and a shared key. A leaked prod key alone is still enough to wipe everything with one request.
(2) Reset clears the 34 tables in SNAPSHOT_TABLES (plus whatever foreign-key cascades remove), not literally every table. It does cover all users, rooms, room versions and sessions.
(3) This is recoverable to a point: D1 Time Travel allows point-in-time restore within the retention window. "Erase WAMP" really means an outage plus a manual restore, not permanent loss. Still worth fixing.
(4) A leaked ADMIN_API_KEY is already very damaging through other admin routes (room revert, run invalidation, world-tiles). The snapshot routes make it a one-call total wipe and a way to forge sessions. Gating them by environment is the cheap, high-value fix the claim proposes.
(5) "Not rate-limited" is true of the code. Cloudflare WAF or dashboard rules can't be seen from the repo.

Keep the finding, but reframe it.
(1) A full production wipe would probably fail today. On D1, the reset's env.DB.batch (snapshot.ts:65) runs as one transaction, and D1 enforces foreign keys. guestbook_entries (0031:13), room_comments (0033:21-22) and the worlds tables (0045, ON DELETE RESTRICT) point at users, are not in SNAPSHOT_TABLES, and production has signed-in guestbook rows. So DELETE FROM users would fail and the whole reset would be undone. That protection is accidental and disappears if those tables are added to the list. D1 Time Travel can also restore an earlier point in time, so even a successful wipe would be recoverable.
(2) The import endpoint is the live risk. It runs INSERT OR REPLACE into users, rooms and sessions in production, so anyone with the key can forge a session for any user (sessions.token_hash, 0001:30) or overwrite rows.
(3) Evidence that one key is shared across environments is stronger than claimed: backfill_badges.mjs:17 and world_tiles.mjs:198 use one .dev.vars ADMIN_API_KEY for both safety and production. The production admin pages also keep the key in sessionStorage on wamp.land, so any XSS there would expose it.
(4) The refresh script's missing URL check is inconsistent with backfill_badges.mjs:12 and world_tiles.mjs:35, which both refuse non-safety URLs without an explicit production flag.
The fix stays the same and is small: gate the snapshot routes behind an env var that is set only under env.safety (like ENABLE_TEST_RESET at maintenance/routes.ts:10), add a safety-host check to the script, and use separate keys per environment. timingSafeEqual is optional.

Not every table, and not permanent: reset clears the 33 tables in SNAPSHOT_TABLES in the main D1 only. JAM_DB, R2 tile objects and tables outside the list (e.g. room_rush_runs, pvp_matches, worlds and school tables) survive except through FK cascades, and D1 Time Travel can restore the main DB to the minute before the wipe. So the realistic worst case is an outage and recovery work, not "erasing WAMP". The bigger quiet risk is that snapshot/import can write rows into sessions, api_tokens, agent_tokens and chat_admins, which lets anyone with the key impersonate any user. That deserves the emphasis. Nothing in the code shows that safety and prod share one ADMIN_API_KEY. The .dev.vars fallback only shows the local key is used against safety, so the misconfiguration path is possible but unproven. Gate the routes with a new var such as ENABLE_SNAPSHOT_ADMIN, set only in env.safety vars (or as a --var in deploy_safety_branch.mjs), mirroring maintenance/routes.ts:10. Don't reuse ENABLE_TEST_RESET, which is "0" in wrangler.jsonc's safety env. Also rename or validate SAFETY_REFRESH_HEALTHCHECK_BASE_URL: only allow a safety workers.dev host, and never api.wamp.land. timingSafeEqual and rate limiting are optional low-value hardening. Cloudflare Access would need service tokens for script and worker callers, which takes more than a small effort.

### F187: Chat @mentions and sign-in requests can burn the email budget, and then nobody can log in

- **Area:** Trust & safety, moderation, ops & observability
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Each chat message can email up to five people, one message per second is allowed, and nobody can turn these emails off. One harasser could flood someone's inbox with thousands of emails an hour. The same email account sends the sign-in codes, so that harassment could also use up the email quota and stop every player from logging in.

**Technical detail.**

Chat allows 1 msg/sec/user (chat/routes.ts:58, 155-160), and every message schedules mention emails (chat/routes.ts:170) to up to 5 recipients (chat/mentions.ts:8). There's no per-recipient cooldown, no daily cap and no opt-out (mentions.ts recipient loader just requires an email). `POST /api/auth/request-link` limits only per address per minute (auth/routes.ts:174). It has no IP limit and no Turnstile, and it creates a `users` row before the email is verified (auth/routes.ts:197), so a script can mail thousands of strangers and fill `users`. All of this shares one RESEND_API_KEY with magic links and codes (auth/routes.ts:224-228). Resend's rate limit, monthly quota and domain spam reputation are a single point of failure for sign-in. Fix: (1) a `chat_mention_email_log` table, with at most 1 email per (sender, recipient) per hour and at most 10 per recipient per day, plus a 'Email me when mentioned' toggle in user settings (default on). (2) A Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc, keyed on CF-Connecting-IP) on request-link and verify-code, e.g. 5/min. Require Turnstile after 3 requests, reusing the guestbook verifier. (3) Create the user row only in verify/verify-code. (4) Optionally use a separate Resend sending subdomain for notifications so their reputation can't hurt sign-in mail.

**Evidence.**

- src/cloudflare/worker/chat/mentions.ts:8 — MAX_CHAT_MENTION_EMAILS = 5 per message
- src/cloudflare/worker/chat/routes.ts:58 — CHAT_RATE_LIMIT_WINDOW_MS = 1000 (only throttle)
- src/cloudflare/worker/chat/routes.ts:170 — every message schedules mention emails, no per-recipient cooldown
- src/cloudflare/worker/auth/routes.ts:174 — sign-in email throttle is per-address only
- src/cloudflare/worker/auth/routes.ts:197 — user row created for any typed email before verification
- src/cloudflare/worker/auth/routes.ts:224-228 — sign-in emails use the same Resend key

**Fact-check (confirmed, confirmed, partially confirmed).**

Small corrections only:
1. "Nobody can log in" goes too far. Wallet sign-in and existing session cookies would keep working; only email-link and email-code sign-in fail. Whether those actually fail depends on the Resend plan's per-second rate and monthly quota, which are set outside the code. At full speed, one chat sender makes about 5 Resend calls per second.
2. A third sender shares the same key: room comment notification emails (roomComments/email.ts:18,51). A fix that adds per-recipient caps or a separate notification subdomain should cover them too.
3. The anonymous request-link endpoint is the cheaper attack: it needs no account, while chat needs a signed-in account. Fixes (2) and (3) should come first. A per-user chat throttle can also be dodged with throwaway accounts, because accounts are free to create by email or wallet.
4. worlds/store.ts:306 also calls createUserForEmail. That path is an admin or complimentary grant, so it is lower risk, but keep it in mind if user creation is moved to the verify step.

A few small corrections to the claim's framing:
- Harassment through chat needs a signed-in account, and every message is public in World Chat, where moderators can already ban the sender (chat_bans, plus the trust penalty in progression/trustCaps.ts). The flooding stops after a manual ban, not on its own.
- The per-second throttle is weaker than the claim says. It is a read-then-insert check (chat/routes.ts:152-160), so requests sent at the same moment can get past it.
- The claim leaves out one way this gets worse. A pre-verification users row gets the stranger's email and a username built from the part of their address before the @ (auth/store.ts:197 via 162-180 and 1438-1441). There is no email_verified flag, so an attacker can create a row for a stranger through request-link and then @mention that guessable username to email them repeatedly. That is why fix (3), creating the row only at verify time, matters most.
- Login failing for everyone is a plausible worst case, not a demonstrated one.

1. "Nobody can log in" is overstated. Existing sessions last 30 days (store.ts:23) and keep working, and wallet sign-in doesn't use email. What breaks is new or expired email sign-ins, plus every other email the game sends: room comments, worlds and admin review. During an attack this starts with Resend's per-second rate limit, before any monthly quota is reached.
2. The 1 msg/sec chat limit can be beaten by sending requests at the same moment, because it checks the last message and then inserts (chat/routes.ts:152-166).
3. Fix (3) is not small. magic_link_tokens.user_id is NOT NULL with a foreign key to users (migrations/0001_create_auth.sql:15,22), and both verify paths join users (store.ts:667-678). Moving user creation into the verify step needs a table rebuild and risky changes to sign-in. A cheaper alternative: keep the early row, but give out founder numbers and badges only after verification (move ensureFounderIdentityQualification into verify and verify-code), and prune old unverified rows.
4. Two extra reasons to add an IP limit on verify-code:
   - Anyone can request a new code for any address once a minute and get 5 guesses at it. That's about 7,200 guesses a day against 10^6 possible codes, roughly 0.7% per day of taking over that account, and each request also emails the victim.
   - Mention emails should be skipped when the recipient was active in chat recently. That is the everyday annoyance players will actually notice.
5. Suggested split:
   - Small: cap mention emails per sender→recipient and per recipient per day, reusing the room-comment limits pattern; skip recipients who are active in chat; add a Workers rate limit keyed on IP to request-link and verify-code.
   - Medium: an opt-out toggle in settings, Turnstile in the sign-in modal (needs work on mobile), founder and badge changes, and a separate Resend sending subdomain.

### F042: 6-digit email sign-in code: per-request throttle is global, allowing parallel brute force of a known code window

- **Area:** Security & abuse resistance
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** The new email login code is a 6-digit number with only 5 guesses per emailed code, which is fine on its own. But the limit is enforced per issued code, and an attacker who can trigger many codes for a victim's address (one per minute) effectively multiplies their guesses, and the per-attempt counter is not transactional with the compare. Worth tightening before this becomes the primary login.

**Technical detail.**

handleVerifyEmailCode (auth/routes.ts:294-330) loads only the latest code row via loadLatestEmailCode (auth/store.ts:667-678, ORDER BY created_at DESC LIMIT 1) and caps at code_attempts>=5. recordEmailCodeAttempt (store.ts:687-694) increments atomically, good. But there is no per-email/per-IP ceiling on total verify attempts across code rotations: request-link is throttled to 1/min (auth/routes.ts:174-176, hasRecentEmailSignInRequest) yet an attacker who floods the victim with codes still only faces 5 guesses each against a 1e6 space — brute force is impractical here, so the real residual risk is (a) email-bomb amplification (each failed login attempt against the victim's address is cheap and there is no per-IP cap on verify-code) and (b) the code is derived from tokenHash+code (store.ts:201-202) but loadLatestEmailCode always targets the most recent row, so a second concurrently-issued code invalidates attempt accounting on the first. Recommend: add a per-email AND per-IP verify-attempt counter (e.g. 10/hour) independent of code rotation, and consider 8-digit codes. Note the compare uses hashToken equality (store.ts:309) not constant-time, but since it compares SHA-256 hashes of a secret the timing leak is not practically exploitable.

**Evidence.**

- src/cloudflare/worker/auth/routes.ts:303 — row.code_attempts >= 5 is the only per-code cap; no cross-row per-email/per-IP verify ceiling
- src/cloudflare/worker/auth/store.ts:667 — loadLatestEmailCode only ever returns the newest row for an email
- src/cloudflare/worker/auth/routes.ts:174 — request-link throttle is per-email 60s only, not per-IP

**Fact-check (partially confirmed).**

Corrections to the claim:
1. The title is wrong to call the throttle "global". The request-link throttle is per email (routes.ts:174, store.ts:680-685). What is missing is any per-IP limit and any per-email cap on verify attempts across codes.
2. The summary is wrong that the attempt counter is "not transactional with the compare". recordEmailCodeAttempt (store.ts:687-694) is an atomic conditional UPDATE...RETURNING that runs before the compare. Parallel requests cannot exceed 5 guesses per row.
3. Point (a) is wrong: verify-code sends no email. Email volume comes from request-link, which allows 1 email per minute per address with no per-IP cap, so an attacker can spray many addresses.
4. Point (b) is not something an attacker gains. When a new code is issued, the old code becomes unusable through the code path (its magic link still works). That does not reset or weaken attempt counting.
5. Two citations point to the wrong file. Code generation is routes.ts:201-202 (store.ts:201-202 is unrelated user-insert code). The hash compare is routes.ts:309, not store.ts:309.
6. "Brute force is impractical" understates the risk:
   - Per target it is about 7,200 guesses per day, roughly 0.7% per day or 19% per month.
   - With no per-IP limits, attacking many addresses at once makes some account takeovers expected.
   - The code row is inserted before the email is sent (routes.ts:206 vs :228), so a failed or quota-limited Resend send does not stop guessing.
7. Fix, small effort: reuse the guestbook IP-hash hourly limit pattern for verify-code and request-link, and add a per-email cap across codes (for example, 10-20 failed verifies per hour or day, counted from code_attempts). 8-digit codes are optional on top.

### F041: Open redirect + OG spoofing on the public room-share page

- **Area:** Security & abuse resistance
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Anyone can craft a wamp.land share link that instantly redirects visitors to any website they choose, and that shows their own title/description/image in the link preview on social media. This lets scammers send 'api.wamp.land/...' links that look official but bounce people to phishing or scam pages.

**Technical detail.**

resolveRequestedPublicUrl (src/cloudflare/worker/share/routes.ts:262-277) takes the ?url= query param and accepts ANY http/https URL with no host allowlist. buildRoomShareMetadata (share/routes.ts:224) uses it as metadata.url, and buildRoomShareHtml (share/routes.ts:359-394) emits `<script>location.replace(<attacker url>)</script>` plus canonical/og:url/twitter meta using that value. Confirmed live: GET https://api.wamp.land/api/share/rooms/0,0?url=https://example.com/phish returned a page whose canonical, og:url, and location.replace() all point to example.com/phish. Because the response is Cache-Control public and cached at the edge (loadAnonymousPublicCache, share/routes.ts:73), a poisoned variant is also served to others who hit the same URL. Fix: only honor ?url= when its origin passes isTrustedAppHostname / resolveFrontendBaseUrl; otherwise derive the public URL from coordinates as the fallback branch already does.

**Evidence.**

- src/cloudflare/worker/share/routes.ts:263 — candidate = url.searchParams.get('url'); accepts any http/https origin
- src/cloudflare/worker/share/routes.ts:390 — `<script>location.replace(${JSON.stringify(metadata.url)})` redirects to the attacker URL
- src/cloudflare/worker/share/routes.ts:372-378 — title/canonical/og:url/og:description built from attacker-controlled values
- live: GET https://api.wamp.land/api/share/rooms/0,0?url=https://example.com/phish redirected and set canonical/og:url to example.com/phish

**Fact-check (partially confirmed).**

The open redirect is real: GET https://api.wamp.land/api/share/rooms/<published x,y>?url=<any http(s) URL> serves a page that runs location.replace() to that URL, and canonical, og:url and the "Open this WAMP room" link also point there (routes.ts:230, 262-277, 365-391). Three corrections: (1) Attackers control only canonical, og:url, the <a href> and the redirect target. The title, description and image always come from the real room's data, so attackers cannot write their own preview text on this page; a crawler that follows og:url could still show the attacker's page. (2) There is no cache poisoning. The edge cache key is the full URL including the query string (publicCache.ts:18), so only the attacker's own URL variant is cached and normal share links are unaffected. (3) The route is on api.wamp.land, not wamp.land. Fix: either ignore ?url= on the HTML page variant (only /meta needs it; it is called from src/pages/shareMetadata.ts:93-96), or accept it only when its host passes isTrustedAppHostname. If you take the allowlist route, also allow *.wamp.land and localhost so preview and dev deploys (for example preview.wamp.land, used in shareMetadata.test.ts:189) keep the right canonical. Otherwise fall back to the coordinate-derived URL.

### F034: Typing an email into sign-in creates an account and assigns a permanent WAMP founder number before the email is verified

- **Area:** Backend performance, cost & reliability
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Requesting a sign-in email immediately creates a user and gives it the next founder number, even if the address is a typo or a bot and the link is never clicked. Founder numbers are meant to be scarce identity markers, so they get used up. The only limit is one email per address per minute, so a script could create unlimited users and send unlimited emails on WAMP's email account. Two people signing up at the same moment can also collide and get a server error.

**Technical detail.**

handleRequestMagicLink rate-limits per email only (hasRecentEmailSignInRequest), then calls createUserForEmail before sending. createUserForEmail inserts the user and calls ensureFounderIdentityQualification, which does SELECT MAX(founder_number)+1 and then a separate upsert, plus backfill counts and syncUserBadges. founder_number is UNIQUE, so concurrent sign-ups race. The loser gets a 500 'UNIQUE constraint failed' during exactly the kind of spike when sign-ups cluster. The PRD says to assign the number after linking email to avoid burning numbers on throwaway accounts. Fix: (1) store the pending email on magic_link_tokens and create the user plus founder number only in the verify/consume path; (2) assign founder numbers atomically, e.g. `INSERT ... SELECT COALESCE(MAX(founder_number),0)+1` in one statement, or retry on the constraint error; (3) add a per-IP limit with a Workers Rate Limiting binding or a Cloudflare WAF rate rule on /api/auth/* (guestbook already does per-network limiting); (4) exclude unverified users from dashboard user counts.

**Evidence.**

- src/cloudflare/worker/auth/routes.ts:173-175 — the only throttle is one request per email per 60 s
- src/cloudflare/worker/auth/routes.ts:194-195 — findUserByEmail ?? createUserForEmail runs before the email is sent or verified
- src/cloudflare/worker/auth/store.ts:175-177 — insertUserRecord, then ensureFounderIdentityQualification
- src/cloudflare/worker/progression/awards.ts:49-63 — MAX(founder_number)+1, then a separate upsert (non-atomic)
- migrations/0019_progression.sql (user_progress) — founder_number INTEGER UNIQUE, so a lost race raises a constraint error
- docs/product/xp-badges-ratings-prd.md:873-877 — 'award founder number when the account becomes a real WAMP identity ... avoids burning founder numbers on throwaway accounts'
- src/cloudflare/worker/guestbook/routes.ts:224 — a per-network limit pattern already exists in the codebase

**Fact-check (confirmed).**

**Line numbers and wording:**
- The throttle is at routes.ts:174, not 173-175.
- The create-before-verify line is routes.ts:197, not 194-195.
- The PRD literally recommends assigning the number "after linking email or wallet" instead of by Play.fun row order. The code follows that wording; the real gap is that the email link is never verified before the number is assigned.

**Fix (1) is harder than written.** magic_link_tokens.user_id is `NOT NULL` and has a foreign key (migrations/0001_create_auth.sql:15,21). Creating the user only at verify time therefore needs a SQLite table rebuild.

**Cheaper alternative for (1), still a small job:**
- Remove ensureFounderIdentityQualification from createUserForEmail.
- Call it in handleVerifyMagicLink and handleVerifyEmailCode after consumeMagicLinkToken succeeds, every time, not only when attachEmailToUser runs. This also repairs accounts that lost the race.
- Count only users with a consumed token, or with a session, as real users in the dashboard and launch stats.

**For (2):** besides the single-statement insert, the founder-number upsert should be retried when it hits the UNIQUE error.

### F243: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F051: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F050: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F045: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F048: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F052: A failed autosave retries every frame forever and keeps no local copy

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** If a signed-in builder's save fails (phone goes offline, server error, the frontier rule, or the daily room-claim limit), the editor re-sends the whole room on every frame. Offline that is about 60 uploads a second, and nothing is backed up in the browser. Closing the tab loses everything since the last good save, and at the daily claim limit the 'limit reached' popup reopens over and over.

**Technical detail.**

EditorScene.update() calls maybeAutoSave every frame (EditorScene.ts:1013-1014). The only gates in roomSession.maybeAutoSave are dirty, !saveInFlight, !isPlaying and 600 ms since lastDirtyAt (roomSession.ts:394-409). After a failure, saveDraft's catch leaves roomDirty=true and lastDirtyAt unchanged (roomSession.ts:498-517), and the finally clears saveInFlight. So the next frame starts another full-snapshot PUT. Only 401 falls back to a local copy (shouldPersistGuestDraftLocally, roomSession.ts:1087-1089). Every other status (TypeError offline, 5xx, 409 frontier, 403, 413, 429) is logged, the status text is set and two editor UI re-renders run per attempt. For 429 claim-limit, showDailyRoomClaimLimitModal re-shows the modal on each attempt. I confirmed this with a scratch vitest (not in the repo): a fetch that rejects instantly produced 60 save attempts in 60 frames, still dirty, status 'Draft save failed.'. Related gaps: (1) ApiRoomRepository.request has no timeout or AbortSignal (roomRepository.ts:914-925). A hung request leaves saveInFlight=true forever ('Saving draft...'), and manual Save then silently returns null (roomSession.ts:447). (2) Guests: LocalRoomRepository.saveDraft calls localStorage.setItem without try/catch (roomRepository.ts:230). saveGuestDraft has try/finally but no catch (roomSession.ts:1125-1150). A QuotaExceededError therefore skips the durable guest backup, leaves dirty=true, loops, and raises an unhandled rejection from `void this.saveDraft()`. Fix: (a) add failure backoff state to EditorRoomSession (nextAutoSaveAt = now + min(30s, 1s*2^failures), reset on success). Stop auto-retrying on 4xx other than 408/429, and honor Retry-After. (b) On any non-401 failure, write the snapshot through localRoomRepository so getRecoverableLocalDraft (roomSession.ts:1036) restores it on the next open. (c) Pass AbortSignal.timeout(15000) on room mutations. (d) Guard setItem. (e) Add a beforeunload prompt while dirty or after a failed save.

**Evidence.**

- src/scenes/EditorScene.ts:1013 — update() calls maybeAutoSave every frame
- src/scenes/editor/roomSession.ts:394-409 — autosave gated only by dirty/saveInFlight/isPlaying/600ms since lastDirtyAt; no failure backoff
- src/scenes/editor/roomSession.ts:498-517 — non-401 errors leave dirty=true and only set 'Draft save failed.'; no local backup
- src/scenes/editor/roomSession.ts:1087-1089 — local fallback only for status 401
- src/persistence/roomRepository.ts:914-925 — fetch with no timeout/abort signal
- src/persistence/roomRepository.ts:230 — unguarded localStorage.setItem in local saveDraft
- src/scenes/editor/roomSession.ts:1125-1150 — saveGuestDraft has finally but no catch; durable guest backup runs only after the local write
- src/cloudflare/worker/rooms/store.ts:1546-1571 — server throws 409 (frontier) and 429 (daily claim limit) on save; both fall into the retry loop
- scratchpad repro autosave.repro.test.ts — 60 PUT attempts in 60 simulated frames with an offline fetch

**Fact-check (confirmed, confirmed, confirmed).**

Minor precision fixes; the core claim stands.
- **Retry rate:** "every frame" is literally true only when fetch fails fast (offline TypeError, or a localStorage quota error for guests). For server errors (5xx, 409 frontier, 429 claim limit), `saveInFlight` is held for the round trip, so retries run back to back, one per round trip (roughly every 100–300 ms). Each retry is a real full-room PUT, and the claim-limit modal reappears at that rate.
- **Offline wording:** offline attempts don't actually upload anything, because fetch rejects before sending. They do re-serialize the whole room snapshot every frame, which wastes CPU and battery on phones.
- **Line references:**
  - The `update()` call is at EditorScene.ts:1014 and goes through EditorScene.ts:1483 and persistence.ts:66.
  - The `request()` fetch is at roomRepository.ts:913-924.
  - `saveGuestDraft` spans roomSession.ts:1121-1152.
  - The server claim checks are invoked at store.ts:914-915 (draft save).
- **Missing from the claim:** the reason production has no local fallback. The ApiRoomRepository fallback (roomRepository.ts:985-992) is disabled outside DEV.

Mostly accurate. Three refinements:
1. The 429 claim-limit and 409 frontier loops are edge cases. The overworld already blocks opening the editor at the daily limit (src/scenes/overworld/flow.ts:326, src/scenes/OverworldPlayScene.ts:5960) and only allows building on frontier cells. A save hits these only if the limit or frontier changes mid-session.
2. 60 uploads per second applies only to instant rejections (offline). 5xx failures retry back to back, one per round trip. Hidden tabs pause the loop because Phaser's animation-frame loop stops.
3. The local fallback that does exist in ApiRoomRepository.withFallback is disabled in production by `if (!import.meta.env.DEV) return false` (src/persistence/roomRepository.ts:987). That confirms 'nothing is backed up in the browser' in prod.

Line refs are off slightly: getRecoverableLocalDraft is at roomSession.ts:1041 (not 1036), saveGuestDraft starts at 1121, and the early return blocking manual Save while a save is in flight is at 446-447.

Four corrections to the wording and scope, none to the core mechanism.
(1) "60 uploads a second" overstates it. When the device is offline, fetch fails locally, so nothing reaches the server. The per-frame cost is on the client: exportRoomSnapshot, JSON.stringify and two renderEditorUi passes on each attempt. Requests only reach the server when it is reachable but returning errors (5xx/409/429/403), and then the rate is about one per round trip (roughly 3-10/s per editor), not 60/s.
(2) The daily-claim-limit (429) modal loop is rare. The overworld already blocks frontier builds when roomClaimsRemainingToday <= 0 (src/scenes/overworld/hudState.ts:355-361, src/scenes/overworld/flow.ts:326, OverworldPlayScene.ts:5960-5967). The loop only happens with stale auth state, for example a room claimed on another tab or device the same day. When it does happen, it is effectively a soft-lock.
(3) The claim misses a more likely sticky case. Two players building the same unclaimed frontier room at once: the second save gets a permanent 403 ("Only the room claimer can save drafts for this unpublished room", store.ts:890-896). The losing builder loops forever, sees only "Draft save failed.", and has no local copy.
(4) Data loss needs the failure to last until the tab closes or is discarded. A short blip heals itself on the next successful attempt, which saves the whole current room. The guest localStorage quota case is real in the code but unlikely in practice.

### F060: A save that finishes after you switch rooms can point the editor back at the old room

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** The editor reuses one 'room session' object for every room. If a save for the previous room finishes after you've opened another room's editor, it quietly switches the session's room id, position and permissions back to the old room. The next autosave then writes the new room's tiles into the old room's draft. Example: the save fired when you pressed Play, on a slow connection. The window is narrow, but the result is one room overwriting another.

**Technical detail.**

EditorRoomSession is constructed once in the EditorScene constructor (EditorScene.ts:490). reset() is called on shutdown and create (EditorScene.ts:1059; roomSession.ts:232-266), but it does not invalidate pending promises. startPlayMode fires `void this.host.saveDraft(true)` and puts the editor to sleep (editor/flow.ts:73-75). The overworld's openEditor stops the sleeping EditorScene and re-runs it for a new room (overworld/flow.ts:403-421). When the old save resolves, saveDraft calls syncRoomMetadata(record) (roomSession.ts:488). That sets roomId/coordinates/title/permissions from the old record (roomSession.ts:1187-1192). EditorScene.roomId proxies to the session (EditorScene.ts:738-744), and exportRoomSnapshot uses that id and coordinates (editRuntime.ts:615-620). If this lands after the new room's loadPersistedRoom, the next autosave PUTs the new room's content to /api/rooms/{oldId}/draft. publishRoom, revert and loadPersistedRoom have the same pattern. Fix: add a sessionGeneration counter, increment it in reset(), capture it before each await, and after the await skip syncRoomMetadata/applyRoomSnapshot/setRoomDirty if it changed. Alternatively, build a new EditorRoomSession in create(). As a last guard, ignore any record whose draft.id !== this.roomId.

**Evidence.**

- src/scenes/EditorScene.ts:490 — one EditorRoomSession reused across scene stop/run
- src/scenes/editor/roomSession.ts:232-266 — reset() clears fields but cannot cancel in-flight saves
- src/scenes/editor/flow.ts:74 — Play fires an unawaited saveDraft(true) before sleeping the editor
- src/scenes/overworld/flow.ts:416-421 — opening another room stops and re-runs EditorScene
- src/scenes/editor/roomSession.ts:488 — stale save result applied via syncRoomMetadata without a session check
- src/scenes/editor/roomSession.ts:1187-1188 — syncRoomMetadata overwrites roomId from the record
- src/scenes/editor/editRuntime.ts:615-620 — exported snapshot id/coordinates come from the session

**Fact-check (confirmed).**

The core claim is accurate. Three clarifications:
1. The realistic trigger is: Play, then walk into an adjacent room (roomTransition.ts:212 selects it), then press "Edit Room" in the world HUD, while the Play save's PUT is still stalled. There is no fetch timeout (roomRepository.ts:914). This only happens on slow or stalled connections, not ordinary latency.
2. The damage is worse than "the old room's draft." Exiting the editor auto-publishes (roomSession.ts:804), so the wrong content can go live on the old room. The stale save's finally block also clears saveInFlight for the new session.
3. "loadPersistedRoom and revert have the same pattern" is only half true. They apply the old room's metadata and snapshot together, which gives a self-consistent wrong-room editor rather than a cross-room write. The overwrite risk is specific to the save and publish paths, which sync metadata without the snapshot.

### F058: Two open editors (two tabs, or phone and laptop) silently overwrite each other

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** medium · **effort:** medium

**Summary.** If the same room is open in the editor in two places, each autosave uploads that copy's whole room and replaces whatever is on the server. A stale tab or a phone left open can wipe an hour of laptop work the moment you touch it, with no warning.

**Technical detail.**

The client PUTs the full snapshot with no base version, ETag or updatedAt precondition (roomRepository.ts:683-700). Server saveDraft loads the existing record and writes `{...incomingRoom, version: existing.draft.version, updatedAt: now}` unconditionally (store.ts:864-931). It never compares the incoming snapshot's updatedAt with existing.draft.updatedAt. After each save, syncRoomMetadata quietly adopts the server's metadata (roomSession.ts:1187-1210), so neither tab finds out. Fix: send the draft updatedAt the editor last loaded or saved (for example `?baseUpdatedAt=`). The server returns 409 with the current record when existing.draft.updatedAt differs and no force flag is set. The client then keeps a local copy and shows 'Changed in another tab/device: load theirs / keep mine (overwrite)'. Cheap extra for same-browser tabs: a BroadcastChannel('wamp-editor:' + roomId) that warns the older tab.

**Evidence.**

- src/persistence/roomRepository.ts:683-700 — draft PUT sends the whole snapshot with no precondition
- src/cloudflare/worker/rooms/routes.ts:311-327 — PUT /draft passes straight to saveDraft
- src/cloudflare/worker/rooms/store.ts:924-931 — draft rebuilt from the incoming snapshot; existing updatedAt never compared
- src/scenes/editor/roomSession.ts:1187-1210 — client adopts the server record after save without detecting divergence

**Fact-check (confirmed).**

Small fix to the proposed implementation: the client already sends its base timestamp. exportRoomSnapshot fills updatedAt from roomSession.currentRoomUpdatedAt (src/scenes/EditorScene.ts:446-453 and 774-776; roomSession.ts:1252), which is the draft.updatedAt from the last load or save. So the server can compare incomingRoom.updatedAt with existing.draft.updatedAt directly, with no new `?baseUpdatedAt=` parameter.

Two cautions for the fix:
1. Make the check opt-in, for example `?checkConflict=1` sent only by the editor client. Agent and MCP API callers and recovered local or guest drafts may carry arbitrary updatedAt values.
2. Copy the existing custom-sprite 409 pattern (catalogStore.ts:204-205). On the client, catch the 409 in roomSession.saveDraft before the generic "Draft save failed." branch, keep the local copy and show the "load theirs / keep mine" choice.

Also note the destructive case: the newer session has been closed and the stale tab or phone is then edited. While both stay open, they keep overwriting each other back and forth.

### F057: Expanded-room edits stay in memory until Save, and neither editor warns before closing the tab

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** In the expanded-room editor, changes stay only in browser memory until the builder presses Save. There's no autosave, and neither editor warns when you close or refresh the tab with unsaved changes. On phones, where the OS often closes background tabs, a builder can lose a whole session of multi-room work.

**Technical detail.**

CourseEditorScene marks slices dirty (CourseEditorScene.ts:285-286, 836-837) but only persists from the explicit saveDraft (CourseEditorScene.ts:1075-1130). returnToCourseBuilder only copies snapshots into module-level in-memory overrides (CourseEditorScene.ts:810-822 → draftSession.ts:11-14, 96). There is no 'beforeunload' anywhere in src. The single-room editor has the same small window: about 600 ms plus a round trip after each edit, or indefinitely after a failed save (see the autosave finding). Fix: (1) Debounce dirty slices to local storage using the existing saveSlicesLocally (CourseEditorScene.ts:1092). getRecoverableLocalDraft-style recovery can restore them, and a remote debounced save can follow the backoff rules from the autosave finding. (2) Add one window 'beforeunload' handler, registered by whichever editor scene is active and removed on shutdown. It sets event.returnValue when any slice or room is dirty or the last save failed. (3) On visibilitychange→hidden or pagehide (the reliable signal on iOS), flush a local copy synchronously.

**Evidence.**

- src/scenes/CourseEditorScene.ts:1075-1130 — expanded-room rooms are only saved by the explicit Save action
- src/scenes/CourseEditorScene.ts:810-822 — leaving the expanded editor only stashes snapshots in memory
- src/courses/draftSession.ts:11-14 — draft session state is module-level, in-memory only
- src/courses/draftSession.ts:96 — setActiveCourseDraftSessionRoomOverride stores to the in-memory map
- grep 'beforeunload' over src — no matches; no unsaved-changes guard in any editor

**Fact-check (partially confirmed).**

1) Evidence line: draftSession.ts:96 is inside updateActiveCourseDraftSession. setActiveCourseDraftSessionRoomOverride is at src/courses/draftSession.ts:155-160. saveDraft spans CourseEditorScene.ts:1076-1145, and saveSlicesLocally is defined at :1912.

2) Fix step (1) as written would add a bug. saveSlicesLocally (:1912-1929) calls applyStoredRoomRecordToSlice with keepDirty:false (:1856). It also re-applies the snapshot to the runtime (:1855). A debounced autosave through it would mark every slice clean, so the next Save would upload nothing ("No room draft changes to save.", :1081-1084). It would also reset each slice's runtime state on every tick. Instead, add a separate backup writer that serialises slice.runtime.exportRoomSnapshot() to local storage without touching dirty flags or the runtime.

3) Recovery has to be built too. loadRoomSliceState (:1813-1830) loads through createRoomRepository (src/persistence/roomRepository.ts:995-1006). That is the API repository, which uses local storage only as a fallback in 'auto' mode. So a local backup would not be offered back automatically, and the expanded editor needs its own recover-local-draft step, like roomSession.getRecoverableLocalDraft.

4) The beforeunload/pagehide part is still a small, independent win. The handler would check getDirtySlices().length > 0 or isActiveCourseDraftSessionDirty() in the expanded editor, and roomDirty or the last-save-failed state in the single-room editor.

### F056: What leaving the editor does depends on a 600 ms autosave race

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Leaving the editor (Back/Escape) does one of three things depending on timing. Within about 0.6 s of your last edit it publishes your changes to the public world. A moment later it keeps a private draft. During the autosave upload it shows 'Publish failed. Draft save failed.' even though nothing failed. A quick exit after a small tweak can publish a half-finished version, which starts a fresh, empty leaderboard for that room.

**Technical detail.**

buildReturnToWorldWakeData branches on roomDirty (roomSession.ts:767-791). Not dirty returns a private draft preview. Dirty calls publishRoom('Auto-published on exit.') (roomSession.ts:805). Autosave clears roomDirty about 600 ms plus a round trip after the last edit (AUTO_SAVE_DELAY_MS, roomSession.ts:87). If Back lands while that autosave is in flight, roomDirty is still true, publishRoom returns null because saveInFlight (roomSession.ts:527), and the fallback saveDraft(true) also returns null (roomSession.ts:447). That sets 'Publish failed. Draft save failed.' (roomSession.ts:822), and editor flow shows it as an error (editor/flow.ts:176-182). A publish validation error opens the 'Cannot Publish Room' modal, which flow.ts:187-188 hideBusyOverlay() closes immediately after the draft save. Separately, publishRoom clears dirty unconditionally after the request (roomSession.ts:567), unlike saveDraft's lastDirtyAt guard (roomSession.ts:493-495). Edits made during a publish (keyboard shortcuts still work under the overlay) are dropped from dirty tracking. Fix: make exit deterministic. Keep the in-flight save as a promise (this.inFlightSave) and have saveDraft/publishRoom await it instead of returning null. Base the 'unpublished changes' decision on durable state (shouldShowDraftPreviewInWorld, roomSession.ts:1032) rather than the transient dirty flag, and pick the publish-on-exit policy explicitly (ask or setting). Apply the lastDirtyAt guard in publishRoom and mintRoom (roomSession.ts:567, 898).

**Evidence.**

- src/scenes/editor/roomSession.ts:767-791 — exit when not dirty → private draft preview, no publish
- src/scenes/editor/roomSession.ts:805 — exit when dirty → auto-publish
- src/scenes/editor/roomSession.ts:87 — dirty clears via autosave about 600 ms after the last edit
- src/scenes/editor/roomSession.ts:527 — publishRoom returns null while an autosave is in flight
- src/scenes/editor/roomSession.ts:822 — 'Publish failed. Draft save failed.' shown for an in-flight save, not a failure
- src/scenes/editor/flow.ts:176-188 — error modal shown; on success hideBusyOverlay also hides any 'Cannot Publish Room' modal
- src/scenes/editor/roomSession.ts:567 — publish clears dirty unconditionally (compare 493-495)

**Fact-check (confirmed).**

Three small refinements; the core claim stands.

1. **"Fresh, empty leaderboard."** This happens only when the edit changes the gameplay fingerprint: tiles, smart terrain, placed objects, goal, spawn or custom sprites (src/persistence/roomVersionLineage.ts:139-160). Cosmetic-only edits fall into the same equivalence group and keep the leaderboard. New versions are stored with leaderboardSourceVersion null (src/cloudflare/worker/rooms/store.ts:1116), and the owner can re-link them by hand later.

2. **Edits during publish are worse than described.** Manual publish (the button at EditorScene.ts:902-904, or Ctrl/Cmd+Shift+P at 341-344) shows no overlay, so the editor stays fully interactive, pointer drawing included. The window also covers the extra refreshAuthSession() await (roomSession.ts:566). Edits made in that window get their dirty flag cleared at line 567, so autosave never picks them up. On exit, roomUpdatedAt equals roomPublishedAt, so the not-dirty branch returns the published snapshot with clearDraftRoomId (781-790). Those edits are lost without any warning.

3. **Failed autosave also leaves exit publishing.** If an autosave fails (for example, offline), dirty stays true, so the next exit still auto-publishes.

### F055: Quick restarts can wipe or swap the ranked-run verification trace, so record runs get rejected

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Leaderboard runs carry a recording the server uses to verify top times. The game keeps one recording slot and lets any earlier attempt's late server reply clear or replace it. If you restart right after a run starts or finishes and then set a new record, the server rejects the run with 'Client update required for ranked verification' or 'Ranked run could not be verified.' These are exactly the runs competitive players care about.

**Technical detail.**

RankedRunTraceRecorder has a single active slot (rankedRunTraceRecorder.ts:47-75). OverworldGoalRunController calls onRankedRunStarted whenever any startRun resolves, without checking that runState is still currentGoalRun (goalRuns.ts:903-940). finishRemoteGoalRun always calls clearVerificationTrace on success and on error (goalRuns.ts:1094, 1161), even when the finishing run is stale. buildRunFinishPayload sends whatever trace is in the slot (goalRuns.ts:1210). Sequence: run A qualifies and startRun(A) is in flight. The player hits Restart: resetPlaySession abandons and resets (sessionReset.ts:117-131), and run B starts with startRun(B) in flight. A's start resolves: the trace is bound to A and the abandon finish for A is sent. B's start resolves: the trace is bound to B. A's finish lands: clearVerificationTrace() wipes B's trace. B completes with verificationTrace=null. The same happens after completing A and restarting immediately, because A's 'completed' finish awaits loadFreshRoomLeaderboard before and after the request. When verification is triggered (top-1, top-10, record gap, point gain), the server's requireVerificationTrace returns 409 (verification.ts:173-178, routes.ts:355). If a stale start instead rebinds the slot to A's nonce mid-run, the run fails trace_nonce. I reproduced this with a scratch vitest (not in the repo) using the real controller and recorder: B's finish body had verificationTrace null. coursePlayback.ts:206 only compares course.id, so restarting the same expanded room can attach the old attempt's id/nonce to the new run. Fix: key the recorder by nonce. Make clear(nonce) and buildTrace(nonce) no-ops when the binding differs. In startRemoteGoalRun, if `this.currentGoalRun !== runState`, skip onRankedRunStarted and refreshLeaderboards and only send the abandon with a null trace. In coursePlayback, compare run identity (`activeCourseRun === runState`) rather than course id.

**Evidence.**

- src/scenes/overworld/rankedRunTraceRecorder.ts:47-75 — single shared active trace slot
- src/scenes/overworld/goalRuns.ts:930 — onRankedRunStarted fires for any resolved start, stale or not
- src/scenes/overworld/goalRuns.ts:1094 — successful finish of any run clears the shared trace
- src/scenes/overworld/goalRuns.ts:1161 — failed finish also clears it
- src/scenes/overworld/goalRuns.ts:1210 — finish payload takes whatever trace the recorder holds
- src/scenes/overworld/sessionReset.ts:117-131 — restart abandons, then resets, then a new run starts while old requests are in flight
- src/cloudflare/worker/runs/verification.ts:173-178 — missing trace → 409 'Client update required for ranked verification.'
- src/scenes/overworld/coursePlayback.ts:206 — stale-start guard compares course.id, not the run instance
- scratchpad repro trace.repro.test.ts — after a stale finish lands, recorder inactive and B submits verificationTrace=null

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

With a null trace the server returns 409 "Missing verification trace for ranked run.", not "Client update required for ranked verification." The HttpError from requireVerificationTrace is caught at finalizationVerification.ts:40-47 and becomes reason 'missing_trace', which routes.ts:422-430 maps to that message. Before the 409, the row is already written with verification_status='failed' (routes.ts:380-410). A nonce rebound by a stale start gives "Ranked run could not be verified." (trace_nonce, verification.ts:452).

A trace is required only when the verification trigger fires (verification.ts:413) and the player is trust tier T0. T1 and above skip verification (verification.ts:215-235), so the bug hits new and low-trust players.

The most frequent trigger is the survival auto-restart (sessionReset.ts:87-95): finish(A,'failed') and startRun(B) are in flight together, so B's trace is wiped whenever B's start returns first. No manual restart is needed.

The "stale finish wipes the trace" half applies only to room runs. The course finish paths guard on attemptId (coursePlayback.ts:323-326, 400-403). The course.id-only stale-start guard is at coursePlayback.ts:207.

1. **Wrong error message.** A null trace does not reach the player as "Client update required". evaluateRunFinalizationVerification (runs/finalizationVerification.ts) catches the error that requireVerificationTrace throws and turns it into reason='missing_trace'. The room route then saves the run with verification_status='failed' and returns 409 "Missing verification trace for ranked run." (runs/routes.ts:422-430). The player sees "Ranked clear not recorded: Missing verification trace for ranked run." (goalRuns.ts:1335-1336). "Ranked run could not be verified." only applies when a stale start has rebound the slot to the wrong nonce (trace_nonce, verification.ts:452).

2. **Big mitigation: only low-trust accounts are affected.** relaxVerificationTriggerForTrustTier (runs/verification.ts, called from finalizationVerification.ts) turns the verification requirement off for trust tier T1 and above. A hidden trust score of 40 or more makes an account T1 (progression/shared.ts:158-171). For example, an email account with about 20 clears gets there (progressRows.ts:477-484). So established competitive players mostly do not get rejected. The ones who do are new or penalized (T0) accounts, and for them verification triggers easily: entering the top 10, taking top 1, a big record gap, or a run that could earn points (verification.ts:410-413). So it hits newcomers' first big runs, not veteran record-chasers.

3. **The course path is partly protected already.** finalizeActiveCourseRun skips clearing the trace on stale finishes by checking `currentActiveCourseRun.attemptId !== attemptId` (coursePlayback.ts:310-313, 324-327). The remaining course bug is the start guard at coursePlayback.ts:206, which compares only course.id. When you restart the same expanded room, a late start from the old attempt can write A's attemptId and nonce into run B and rebind the recorder.

4. **Minor detail.** A completed finish only awaits loadFreshRoomLeaderboard before the request when the cached leaderboard does not match the run. The load after the request happens after the clear, so it plays no part in the race.

The proposed fix is still right: key the recorder's clear and buildTrace by nonce, skip onRankedRunStarted and the leaderboard refresh when `this.currentGoalRun !== runState`, and compare the run itself (not course.id) in coursePlayback.

Who is affected: only trust tier T0 players are rejected. That means new signed-in players, mostly email-only (score under 40; email +20, wallet +20, +1 per clear). T1 players are audit-only and T2 and above are never verified (verification.ts:215-235, finalizationVerification.ts:23-35). Established "competitive" players are therefore not affected. For T0 players, though, almost every first clear or top-10 entry is verified.

Message: a missing trace gives a 409 "Missing verification trace for ranked run.", shown to the player as "Ranked clear not recorded: Missing verification trace for ranked run." (routes.ts:422-430, goalRuns.ts:1336). "Client update required..." only appears for a schema mismatch. The attempt row is finalized before the throw, so the clear is lost for good.

Frequency is understated. The race does not need a start still in flight. An ordinary mid-run Restart (abandon finish sent in `resetPlaySession`, new start about one frame later via runtimeController.ts:169) and every survival-room death (sessionReset.ts:87-95) wipe the new run's trace whenever the heavier finish request lands after the new start.

The course sub-claim is mostly moot. Course finishes are attemptId-guarded, and the stale-start overwrite keeps attemptId, nonce and trace consistent, so it does not cause trace_nonce rejections by itself.

### F054: Releasing the mouse over a panel or outside the window leaves strokes uncommitted and pans stuck

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** On desktop, if you paint and let go of the mouse over a toolbar, side panel, or outside the browser, the editor never sees the release. The painted tiles appear but the room isn't marked as changed, so they aren't autosaved or in Undo. If that was your last stroke before leaving or refreshing, it vanishes. On the world map, Alt-dragging (the default pan) and releasing over the HUD makes the map keep sliding with the mouse until you click again.

**Technical detail.**

When a press starts on the canvas and ends on another element, Phaser emits 'pointerupoutside' instead of 'pointerup' (node_modules/phaser/src/input/InputPlugin.js:2067-2074). Nothing in src listens for it. Editor: the tile batch is committed, and markRoomDirty runs, only from the 'pointerup' handler (interaction.ts:784-842; editRuntime.ts:742-768). isDrawing stays true. The next stroke's beginTileBatch wipes the pending batch (editRuntime.ts:707-708), so that stroke's undo entry is lost. If an object drag is the one stuck, lastObjectDragCell stays set, and the next tile stroke's pointerup takes the object branch and returns early (interaction.ts:803-808), so that stroke is dropped too. On exit, buildReturnToWorldWakeData sees roomDirty=false and saves nothing (roomSession.ts:767-791), even though the world preview shows the stroke. Overworld: inspectInput only clears isPanning in 'pointerup' (inspectInput.ts:72, 196-206), and handlePointerMove pans whenever isPanning is set without checking the button (inspectInput.ts:173-185). syncBrowseWindowToCamera also never runs, so streaming isn't re-synced. CourseEditorScene has the same single 'pointerup' registration (CourseEditorScene.ts:2247). Fix: register the same up handler for 'pointerupoutside' in EditorInteractionController, OverworldInspectInputController and CourseEditorScene. In move handlers, treat `!pointer.isDown` while drawing or panning as an implicit release. Also finalize drawing and panning on game.events BLUR.

**Evidence.**

- node_modules/phaser/src/input/InputPlugin.js:2067-2074 — release off-canvas emits POINTER_UP_OUTSIDE, not POINTER_UP
- src/scenes/editor/interaction.ts:784 — only 'pointerup' is registered; commitTileBatch happens there
- src/scenes/editor/editRuntime.ts:742-768 — markRoomDirty for strokes only happens in commitTileBatch
- src/scenes/editor/editRuntime.ts:707-708 — next beginTileBatch discards the uncommitted batch
- src/scenes/editor/interaction.ts:803-808 — a stuck lastObjectDragCell makes the next tile stroke's pointerup return without committing
- src/scenes/editor/roomSession.ts:767-791 — not dirty means exit does no save
- src/scenes/overworld/inspectInput.ts:173-185 — map pans on every move while isPanning, no button check
- src/scenes/CourseEditorScene.ts:2247 — expanded-room editor also relies on 'pointerup' only

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

Desktop only. In the room editor (interaction.ts:784) and the course editor (CourseEditorScene.ts:2247), letting go of the mouse over a DOM panel never runs pointerup. The stroke is not committed, so it gets no Undo entry and the room is not marked dirty. The next beginTileBatch (editRuntime.ts:707-708) discards that stroke's Undo record. The tiles stay on the map and are saved when any later edit marks the room dirty, so real loss happens only if it was the last edit before leaving or refreshing. The world preview shows the unsaved stroke only for rooms with an unpublished or newer draft (roomSession.ts:1037). Otherwise it shows the published version.

A stuck object drag makes the next tile stroke's pointerup commit the stale object batch instead of the tile batch (interaction.ts:803-808). That marks the room dirty, so only the tile stroke's Undo entry is lost.

World map: the default Alt-drag pan ends when Alt is released (inspectInput.ts:126-134), so only middle-button pans stay stuck until the next click. That releasing Alt also skips syncBrowseWindowToCamera is a separate issue. The course editor's pan does get stuck: no key-up handler clears isPanning, and right-drag pans as well, so it follows the mouse until the next pointerup on the canvas.

The fix stands as proposed: also register the up handlers for 'pointerupoutside', treat a pointermove with `!pointer.isDown` as a release, and finish strokes and pans on game BLUR.

The editor and course-editor bug is real. Releasing the mouse over an HTML panel, toolbar or dock fires POINTER_UP_OUTSIDE, and the code never handles it. The stroke stays uncommitted: it isn't marked dirty, gets no Undo entry, and the next stroke's beginTileBatch throws it away. A stuck lastObjectDragCell also makes the next tile stroke's pointerup return early.

Corrections:
(a) The overworld "keeps sliding until you click again" only applies to middle-button pans. The default Alt/Option pan, and Space pans, stop on key release (inspectInput.ts:125-139; interaction.ts:861).
(b) Saves serialize the full tile layers. So the orphaned tiles are saved by any later edit that marks the room dirty, or by a forced Save. Losing saved work needs the stuck stroke to be the last edit before exit or refresh. The lost Undo entry is the dependable symptom.
(c) The world preview only shows the stroke when the draft preview is in use (unpublished room, or draft newer than the published version). Otherwise the stroke vanishes from the world view.
(d) Touch and mobile are unaffected. The reliable trigger is releasing over a DOM element. Releasing outside the window is uncertain.

The fix is unchanged and small. Register the same up handler for 'pointerupoutside' in EditorInteractionController, OverworldInspectInputController and CourseEditorScene. Also finalize any active stroke or pan on game BLUR.

Desktop mouse only. On touch, the release always targets the canvas (Pointer.js:824/860), so mobile builders are unaffected. Lost work only happens when the off-canvas stroke is the only change since the last save and the builder leaves right after. Any later committed edit or autosave of an already-dirty room saves those tiles, because the full room snapshot is exported. The usual symptom is that Undo skips that stroke, or that a rect/line/shape isn't stamped and its preview lingers. A stuck object drag is not lost: the next tile stroke's pointerup commits it through commitObjectBatch (interaction.ts:803-808). Only that tile stroke's undo entry is lost. Overworld: with the default Alt+drag (or Space), releasing the key clears isPanning (inspectInput.ts:122-130). A pan only stays stuck when it was started with the middle mouse button, or while the key is still held. The skipped syncBrowseWindowToCamera also happens on normal Alt-drags where Alt is let go first. Fix note: clamp the off-canvas end coordinates to the room before stamping shapes from a pointerupoutside release.

### F059: Holding Space or Alt while switching windows leaves editor and map stuck in pan mode

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** If Space (editor pan) or Alt (world-map pan, the default) is held when focus leaves the game, the game never hears the key go up. That includes Alt-Tab on Windows, Cmd-Tab, or clicking into a text box. From then on every click pans instead of painting or selecting a room until you tap that key again. On Windows, every Alt-Tab triggers this.

**Technical detail.**

The editor tracks spaceDown via keyboard.on('keydown-SPACE'/'keyup-SPACE') (interaction.ts:860-861). The overworld tracks altDown/spaceDown the same way (inspectInput.ts:120-136) and ORs altDown into pointerRequestsPan (inspectInput.ts:419-423), with option-drag as the default panning style (settings/model.ts:33). Phaser resets Key objects on game BLUR/scene PAUSE/SLEEP (node_modules/phaser/src/input/keyboard/KeyboardPlugin.js:224-227, 853-866) but emits no keyup events, so these booleans never clear. syncGameKeyboardFocus disables the scene keyboard while a text input has focus (keyboardFocus.ts:80-86), so a keyup during that time is also missed. Fix: read live state instead of latching booleans, e.g. `(pointer.event as MouseEvent).altKey` only, and a Phaser Key from addKey('SPACE').isDown, which Phaser resets on blur. CourseEditorScene already does this with modifierKeys.SPACE?.isDown (CourseEditorScene.ts:2196). Alternatively, reset spaceDown/altDown/isPanning on game.events BLUR and on document visibilitychange.

**Evidence.**

- src/scenes/editor/interaction.ts:860-861 — spaceDown latched from keydown/keyup events
- src/scenes/overworld/inspectInput.ts:120-136 — altDown/spaceDown latched the same way
- src/scenes/overworld/inspectInput.ts:419-423 — latched altDown forces pan on every click
- src/settings/model.ts:33 — option-drag (Alt) panning is the default
- node_modules/phaser/src/input/keyboard/KeyboardPlugin.js:853-866 — resetKeys resets Key objects without emitting keyup
- src/ui/keyboardFocus.ts:80-86 — keyboard disabled while a text field is focused, so keyup is swallowed
- src/scenes/CourseEditorScene.ts:2196 — expanded editor already uses Phaser Key.isDown (correct pattern)

**Fact-check (partially confirmed).**

The real trigger: on Windows, leaving with Alt-Tab and coming back by mouse click leaves altDown stuck in the overworld controller (inspectInput.ts:121-137, 419-423). Returning with Alt-Tab usually delivers an Alt keyup, and Phaser emits keyup-ALT for that even without a Key object, so the flag clears. Cmd-Tab on Mac does not cause it. The editor Space latch (interaction.ts:860-861) is real but rare, because Space has to be held while focus leaves. Partial resets already exist: mode changes call inspectInput.reset() (flow.ts:149/191/245/270/464, OverworldPlayScene.ts:2629), and editor re-init calls interaction.reset() (EditorScene.ts:1050). Missing from the claim: in play mode with a follow camera, the refocus click switches the camera to 'inspect' (inspectInput.ts:146-149) and detaches it from the player. Fix: in pointerRequestsPan, drop the latched altDown and rely only on (pointer.event as MouseEvent).altKey. Replace the spaceDown booleans with keyboard.addKey('SPACE').isDown, which Phaser resets on BLUR, or reset the flags on game.events BLUR and on document visibilitychange. The CourseEditorScene pattern is at :2197-2198 and :3077-3078.

### F168: Pressing Escape to close a menu also throws you out of the room you're playing (and ends PvP matches)

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** If you open Settings or Controls during a run (both stay on screen in play mode) and press Escape to close it, the game also leaves the room. You lose the attempt, and in a duel the match is cancelled. P does the same while a menu button has focus. Escape is how most keyboard players close menus, so this hits a lot of people.

**Technical detail.**

Each modal's Escape handler is a document-level keydown listener that closes the modal but never calls preventDefault (settingsModal.ts:43-49, modalLifecycle.ts:18-24, and the about 15 hand-rolled copies in src/ui/setup/*Modal.ts). Phaser's KeyboardManager listens on window, which fires after document. Its only bail-out is `event.defaultPrevented` (node_modules/phaser/src/input/keyboard/KeyboardManager.js:188), so the same Escape gets queued and emitted as 'keydown-ESC'. OverworldInspectInputController binds that event to handleReturnToWorldKeydown (inspectInput.ts:62-63), which only checks `mode === 'play'` (inspectInput.ts:113-117) and calls returnToWorld(). returnToWorld then also runs clearActivePvpMatch (OverworldPlayScene.ts:5712-5722). Fix in two places. (1) Call event.preventDefault() in every modal Escape handler, starting with createModalLifecycle and settingsModal, so Phaser skips the event. (2) Belt and braces: make handleReturnToWorldKeydown return early when any `.history-modal:not(.hidden)` is open; roomComments.ts:1542 already has this hasBlockingModalOpen check, so hoist it into a shared util. Add a vitest that dispatches Escape with the settings modal open in play mode and asserts returnToWorld isn't called.

**Evidence.**

- src/scenes/overworld/inspectInput.ts:62-63 — keydown-P and keydown-ESC are both bound to handleReturnToWorldKeydown
- src/scenes/overworld/inspectInput.ts:113-117 — the handler checks only getMode()==='play', with no modal-open guard
- src/ui/setup/settingsModal.ts:43-49 — the Escape handler closes the modal but does not preventDefault
- src/ui/setup/modalLifecycle.ts:18-24 — the shared helper has the same issue
- node_modules/phaser/src/input/keyboard/KeyboardManager.js:188 — Phaser ignores an event only when it is already defaultPrevented
- src/styles/sections/world/bars-buttons.css:226-227 — .world-only-control (Settings/Controls) is visible in play-world mode
- src/scenes/OverworldPlayScene.ts:5712-5722 — returnToWorld() calls clearActivePvpMatch()

**Fact-check (confirmed, confirmed, partially confirmed).**

Minor details only.
(a) The P key: the claim makes it sound like a focus bug, but P is simply the regular play-mode "return to world" shortcut and fires no matter what has focus. The real point is that neither P nor Escape is suppressed while a modal is open.
(b) The count of Escape copies: 15 files in src/ui/setup/*Modal*.ts handle 'Escape'. 12 of them never call preventDefault anywhere; 6 files use createModalLifecycle.
(c) "Match is cancelled": what the code shows is that the local client disconnects from the PvP instance and clears the duel (pvpArenaController.ts:284-299). I did not trace what the server records for the opponent.
(d) The effect is desktop/keyboard only. Phone play-world restyles or hides these footer buttons (phone-chrome.css:85-94), and touch users don't press Escape.

Core claim and every cited line are accurate. Three corrections to the details:
(1) Fix #2 as written would not work. The modal's document listener hides the modal synchronously, and Phaser emits keydown-ESC later, on the next update from its queue. By then `.history-modal:not(.hidden)` is already false. The real fix is preventDefault() in every modal Escape handler: createModalLifecycle, settingsModal and the 15 hand-written copies. Better still, use one shared helper or a capture-phase document listener that calls preventDefault when any .history-modal is open. A guard inside the Phaser handler only works if it reads a flag recorded when the DOM event fired, or checks event.defaultPrevented.
(2) The P part is overstated. P is an intended return-to-world shortcut that fires in play mode whenever no text input has focus. That is by design and has nothing to do with "a menu button has focus". The real issue is narrower: P is not blocked while a modal is open.
(3) Related, not cited: Escape pressed to dismiss a room comment or chat overlay during play (OverworldPlayScene.ts:2685-2692) also reaches inspectInput's ESC listener, because returning early from one Phaser listener does not stop the others. The same fix pattern applies.
On impact: this mostly affects desktop keyboard players who open Settings or Controls in the middle of a run. On phones, Escape is not used and these buttons are only restyled (phone-chrome.css:84-95). So medium impact is more accurate than high.

Keep the mechanism, which is confirmed, but change three things:
(a) Drop the "hasBlockingModalOpen guard in handleReturnToWorldKeydown" fix, or rewrite it. The document-level modal handler hides the modal before Phaser's window listener runs, and Phaser dispatches keydown-ESC synchronously (KeyboardManager.js:196 → KeyboardPlugin.js:220). So the guard always sees no modal open. The real fix is event.preventDefault() in the Escape handlers: createModalLifecycle, settingsModal, guestbookModal, leaderboardModal and the other hand-rolled copies. That follows the existing pattern in chat/panel.ts:137 and sceneCommands.ts. A second layer would have to be a capture-phase document listener, not a check inside the Phaser handler.
(b) Scope: this is desktop only (phone-chrome.css:67 hides those buttons in play-world on phones). It affects modals that do not pause the scene: Settings, Controls, Guestbook and Leaderboard. The goal intro and performance suggestion modals are safe because scene.pause() switches the keyboard plugin off (KeyboardPlugin.js:240, Systems.js:587).
(c) Remove or soften the P claim, since P is the intended return-to-world shortcut. Impact should be medium, not high.

### F063: Players see raw `{"error":"…"}` text: apiRequest never unwraps the server's JSON error

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** When something goes wrong, players can see raw code text like {"error":"Incorrect code. Check the email and try again."} instead of a plain message. This happens in room comments, the guestbook, the email sign-in code box on the Jam and School pages, and School admin. The cause is two helper functions with the same name and different behavior, plus nine copy-pasted error helpers.

**Technical detail.**

The Worker returns every error as JSON `{error: message}` (src/cloudflare/worker.ts:795-800). The shared client helper src/api/request.ts:28/34-37 throws `new Error(text)` using a private readApiErrorMessage that returns the raw response body. Its sibling file src/api/readApiErrorMessage.ts:2-15 has a public function with the same name that correctly unwraps `.error`, but only 7 fetch-based repositories use it.

Callers of apiRequest show error.message directly:
- emailCodeDialog.ts:37 (jam.html and school-admin.html sign-in code)
- roomCommentsComposerController.ts:193/289-290 (e.g. 'You are banned from chat and comments.' arrives as JSON)
- guestbookModal.ts:163/213/411-412
- school-admin.ts:120…/624-626
- school-login.ts:148
Only auth/client.ts:1460-1471, ui/chat/panel.ts:959 and chatModerationModal.ts:383 JSON.parse the message, which is why the main sign-in menu looks fine. In total there are 9 local `getErrorMessage` copies in client code.

Fix:
(1) In request.ts, import and use the shared readApiErrorMessage, and throw an `ApiError extends Error { status }`.
(2) Export one `describeError(error, fallback)` from src/api and delete the per-file copies.
(3) Add a vitest case: apiRequest against a 400 `{error:'x'}` response yields message 'x'.

**Evidence.**

- src/api/request.ts:34-37 — private readApiErrorMessage returns `text || ...` (the raw JSON body)
- src/api/readApiErrorMessage.ts:2-15 — same-named public helper that does unwrap `{error}`; used by only 7 files
- src/cloudflare/worker.ts:795-800 — errors serialized as `{ error: message }`
- src/auth/emailCodeDialog.ts:37 — `status.textContent = error instanceof Error ? error.message : ...` (jam.html / school-admin.html code entry)
- src/scenes/overworld/roomCommentsComposerController.ts:289-290 — getErrorMessage returns error.message verbatim; comments use apiRequest (src/roomComments/client.ts:55)
- src/cloudflare/worker/roomComments/routes.ts:150 — HttpError(403,'You are banned from chat and comments.') → shown as JSON
- src/auth/client.ts:1460-1471 — the inline sign-in UI JSON.parses the message, so the two email-code UIs behave differently

**Fact-check (confirmed).**

Small details that are wrong, plus extra reach the claim missed:
- **Shared helper use:** src/api/readApiErrorMessage.ts is imported by 5 files, not 7: admin/featuredRoomsClient.ts, avatars/repository.ts, profiles/profileRepository.ts, pvp/repository.ts and runs/runRepository.ts.
- **Local copies:** there are 10 `getErrorMessage` copies in client code, not 9. The two missed are background-admin.ts:444 and admin/suspicious/app.ts:979.
- **Line numbers:** the JSON.parse calls are at ui/chat/panel.ts:965 and chatModerationModal.ts:389. The cited lines (959 and 383) are where the functions start.
- **jam.html is only partly affected:** jam.ts has its own `requestJson` (jam.ts:406-424) that unwraps `.error` correctly. Requesting the link shows clean text there; only the code-entry dialog shows raw JSON.
- **More affected screens:** the playlist modal (playlistModal.ts:150 and :329, through playlists/repository.ts → apiRequest) and the Wamp-O-Gram modal (wampOGramModal.ts:216, 235 and 251, through wampOGram/repository.ts → apiRequest).
- **Clearest player-facing example:** a student who mistypes a password on school login sees `{"error":"Username or password is incorrect."}`. The cause is school-login.ts:115/148 together with worker/school/store.ts:367.
- **Fix step (1) alone fixes every surface:** call the shared `readApiErrorMessage(response, fallback)` inside request.ts.

### F101: Boot breaks if the page starts hidden or zero-sized (embeds, background tabs)

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** If WAMP starts inside a hidden or zero-size frame (an embed, a webview that's laid out late), the graphics engine crashes during startup. The game stays on 'Loading assets…' forever, even after the frame becomes visible. A tab opened in the background also stopped loading (stuck at 75% after 50s) until it was brought to the front.

**Technical detail.**

src/main.ts:79-80 passes gameContainer.clientWidth/clientHeight straight into the Phaser config. With 0x0, the WebGL renderer's first framebuffer is incomplete ('Framebuffer status: Incomplete Attachment', thrown from Phaser boot → createFramebuffer), and boot never recovers. Fix: clamp width/height to at least 1, or defer `new Phaser.Game` until a ResizeObserver reports a non-zero container (with a 5s fallback). Also add a watchdog: if boot-scene:assets-complete hasn't fired and window-error contains 'Framebuffer', show 'Tap to reload'. For hidden tabs, the asset stall (startBootStallWatch 'still waiting: asset preload' at 15s) suggests preload progression depends on the game step. Consider kicking off fetches outside Phaser (e.g. the existing early world-tile bootstrap pattern) so the work finishes in the background. This matters for the Reddit Devvit port and mann.cool/Discord-style embeds.

**Evidence.**

- Built-in pane (hidden, 0x0 at first load): '[wamp boot] +33ms phaser-game:create-start {width: 0, height: 0}' then 'Uncaught Error: Framebuffer status: Incomplete Attachment … at initialize.createFramebuffer … at M.onload'
- Playwright repro: WAMP in an <iframe style=width:0;height:0>, resized to 1000x700 after 15s → 8s later the splash still says 'Loading assets...' and the canvas is 720x664 but never progresses; pageErrors=['Error: Framebuffer status: Incomplete Attachment']
- Built-in pane, hidden tab at 375x812: after 51s the splash shows 'Loading assets... 75%', with boot log '15201 still waiting: asset preload'
- src/main.ts:79 — width: gameContainer.clientWidth (no minimum)

**Fact-check (partially confirmed).**

Clamping width/height in the Phaser config is not enough. Phaser.Scale.RESIZE recalculates baseSize from the 0x0 parent in ScaleManager.boot/updateScale (ScaleManager.js:1065-1072) before WebGLRenderer.boot (WebGLRenderer.js:895-906). Use either:
- scale: { mode: RESIZE, min: { width: 1, height: 1 } } (applied at ScaleManager.js:577-580), or
- wait to call new Phaser.Game until the container is non-zero.

The crash happens in renderer.boot, the TextureManager READY listener. Because it throws first, Game.texturesReady/start (Game.js:394, 413-418) never runs, so there is no recovery after a resize.

The background-tab case is a separate, milder issue. The tab has a normal size, so there is no crash. Phaser only sends files beyond maxParallelDownloads (32 on desktop, 6 on Android) from scene UPDATE ticks (LoaderPlugin.js:945, 971-977), and the loop is paused while the tab is hidden (Game.js:590-595). Loading resumes when the tab comes to the front. It is not a 'boot breaks' failure.

The 0x0 case does not happen in the normal wamp.land layout. It only happens in hidden or late-laid-out iframes and webviews.

### F121: Phone 'More +' view: Room Rush and Expand Room labels sit in the top-left corner

- **Area:** Visual design, UI polish & information architecture
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** On phones, after tapping 'More +' on the room card, the Room Rush and Expand Room buttons show their text jammed into the top-left corner, while the buttons around them are centered.

**Technical detail.**

phone-world-chat.css:137-140 sets `display: inline-flex` on #btn-world-course-builder and #btn-world-room-rush without align-items or justify-content. Their labels therefore sit at flex-start inside the 34px-tall grid cells, while sibling buttons keep the default button centering. Reproduced with a 390x844 headless render of the production CSS. Fix: add `align-items: center; justify-content: center; text-align: center;`, or use `display: inline-block`. Also grep for other `display: inline-flex` overrides on .bar-btn that may have the same problem.

**Evidence.**

- src/styles/sections/responsive/phone-world-chat.css:137-140 — display:inline-flex with no centering
- render: scratchpad/shots/phone-world-details.png (ROOM RUSH / EXPAND ROOM text top-left)

**Fact-check (confirmed).**

Minor: the course-builder label is 'Expand Room' only for rooms that aren't expanded yet. When the room is already expanded it reads 'Expanded Room Setup', which wraps and ends up centered left-to-right but still sits at the top of the button. The fix is the same either way.

### F075: Tablets and landscape phones have no way to play: touch controls exist only in phone portrait

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** high · **effort:** medium
- **Flagged before:** docs/product/product-requirements.md:785 has an open item to 'Tune the shipped mobile controls, phone/tablet layout density'. The landscape controls listed as shipped at :839 were later removed.

**Summary.** On an iPad or Android tablet, or a phone turned sideways (the natural way to hold a phone for a platformer), you can press Play Room but no on-screen controls appear. The character just stands there, with no hint to rotate the phone. Tablet players can't play at all unless they have a keyboard.

**Technical detail.**

MobileUiController.render() turns touch controls on only when deviceClass==='phone' && coarsePointer && orientationState==='portrait' && play-world (controller.ts:399-414 → portraitPlayControls.render(isPortraitPlay) at :484). PortraitPlayControlsController.isPortraitMoveZoneActive (portraitPlayControls.ts:261-270) repeats the gate, and every control style is scoped to body[data-device-class='phone'][data-orientation-state='portrait'] (phone-portrait-play-controls.css:57-262). deviceLayout.classifyDeviceClass sends every coarse device with a shortest edge over 540px to 'tablet' (deviceLayout.ts:36-43), so iPads, Android tablets and unfolded foldables never get controls. The April 2026 portrait pass removed the landscape D-pad and rotate gate (commits 55162cbb and 6f3fe3e4), and scripts/mobile_smoke.mjs:77 and :741 now assert that #mobile-play-controls stays hidden in landscape play. product-requirements.md:28/839 still claims landscape-first touch support shipped. Fix in two steps. (1) Quick, ship now: when coarsePointer && play-world && !isPortraitPlay, show an overlay saying 'Rotate to portrait to play' on landscape phones, and on tablets turn on the existing console in portrait (relax isPhone to deviceClass!=='desktop'). (2) Proper: add a landscape/tablet layout that reuses the same pointer logic, with a translucent stick bottom-left and Jump/Sword/Shoot bottom-right over the canvas, scoped to [data-orientation-state='landscape'] or tablet. Update the smoke scenario so it asserts controls are present. While here, stop counting navigator.maxTouchPoints>0 as coarse (deviceLayout.ts:69-70). It labels Windows/Chromebook touch laptops as 'tablet' and gives them the reduced performance profile (deviceLayout.ts:49-50). Use matchMedia('(any-pointer: fine)') or '(hover: hover)' to keep those on the desktop class.

**Evidence.**

- src/ui/mobile/controller.ts:408-414 — isPortraitFocusedRoom requires isPhone && orientationState==='portrait'; isPortraitPlay drives controls
- src/ui/mobile/controller.ts:484 — portraitPlayControls.render(isPortraitPlay) is the only path that shows touch controls
- src/ui/mobile/portraitPlayControls.ts:261-270 — move zone active only for phone + portrait
- src/ui/deviceLayout.ts:36-43 — shortest edge >540px means 'tablet' (all iPads), which never gets controls
- scripts/mobile_smoke.mjs:741 — smoke asserts #mobile-play-controls hidden in phone landscape play
- docs/product/product-requirements.md:28 — PRD still describes 'landscape-first mobile/touch support' (stale)
- src/ui/deviceLayout.ts:69-70 — coarsePointer = (pointer: coarse) || maxTouchPoints>0 misclassifies touch laptops

**Fact-check (confirmed, confirmed, confirmed).**

Two small corrections, neither of which changes the verdict.
1. Not every control style is scoped to phone + portrait. The base .mobile-play-controls and .mobile-action-btn styles in src/styles/sections/world/mobile-controls.css:19-80 have no scope. The layout and positioning rules in phone-portrait-play-controls.css (from line 57 on, plus camera-tuner rules up to about line 359) are scoped. Visibility itself is decided by the JS 'hidden' toggle in portraitPlayControls.ts:65.
2. The quick fix for tablets needs more than changing isPhone to deviceClass!=='desktop'. It must also update isPortraitMoveZoneActive (portraitPlayControls.ts:261-270) and widen the CSS selectors (now body[data-device-class='phone'][data-orientation-state='portrait']). Without the CSS change, the controls would show on a tablet but without their layout.
The removed rotate gate prompted the opposite rotation (a portrait 'Turn Your Phone' install/play gate). So a 'rotate to portrait' overlay would be a new UI element, not a restoration of the old one.

Details to add or correct:

1. The claim misses that public/app.webmanifest:9 sets "orientation": "landscape". On Android, an installed WAMP is locked to landscape, which is exactly where no controls exist, so installed phone users cannot play at all. The quick fix should change this to "any" or "portrait", or remove the key.

2. "No hint" is very nearly true. The only hint is one line in the controls help modal (index.html:2923, "Open and play in portrait"). Nothing appears during play.

3. Quick-fix step (1) needs three changes for tablets to get the console:
   - relax isPhone in controller.ts:408-414;
   - relax the gate in portraitPlayControls.ts:263;
   - broaden every selector in phone-portrait-play-controls.css from [data-device-class='phone'] to cover tablets, for example [data-coarse-pointer='true']:not([data-device-class='desktop']).

4. The smoke test at mobile_smoke.mjs:741-744 must be inverted. Add a tablet play scenario; today the only tablet scenario (:87) covers browse.

5. Phone-landscape impact is moderate rather than a full blocker, because phones default to portrait and controls work there. The full "can't play" blocker applies to tablets, foldables and installed Android apps.

### F079: Phone/tablet editor: starting a pinch-zoom paints a stray tile (or flood-fills); shape tools need a hidden second tap

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** medium
- **Flagged before:** feature-ledger.md:6 — 'pre-existing phone Smart picker and touch-shape issues remain a separate follow-up'

**Summary.** In the editor on a phone or tablet, the first finger paints right away. So every pinch-zoom or two-finger pan leaves a stray tile or object where the first finger landed, and with Fill selected it floods the whole area. Dragging out a rectangle or line shows no preview and places nothing until you tap again somewhere else.

**Technical detail.**

handleTouchPointerDown commits on the first contact. For tiles it calls host.handleToolDown → ToolController.handleToolDown, which places, erases or randomizes immediately and runs floodFill + commitTileBatch at once (tools.ts:179-203). For objects it calls handleObjectPlace (interaction.ts:1152). When the second finger arrives, interaction.ts:1101-1104 calls finishCurrentTouchDraw(), which commits the batch (:1304-1306) rather than reverting it. No cancel or revert batch API exists. Fix like the world browser already does in inspectInput.ts:217-340: keep a 'touch tap candidate' and defer the first edit until the finger moves more than about 6px or ~90ms passes with one finger down. If a second pointer arrives first, drop the candidate and begin the pinch. Run Fill and object placement on pointerup when there was no movement. Shapes: in the touch path rect/ellipse/line return at :1157-1183 without setting isDrawing, so handleTouchPointerMove exits at :1231 before the preview branch (:1248), and lifting the finger stamps nothing. Make the touch shape gesture drag-to-draw (start on down, preview on move, stamp on up) instead of the invisible two-tap flow. This is likely the 'touch-shape issues' the ledger defers.

**Evidence.**

- src/scenes/editor/interaction.ts:1101-1104 — second finger calls finishCurrentTouchDraw(), committing the first finger's edit
- src/scenes/editor/tools.ts:199-203 — Fill flood-fills and commits on pointer down
- src/scenes/editor/interaction.ts:1152 — objects placed immediately on touch down
- src/scenes/editor/interaction.ts:1157-1183 — touch shape tools: first tap only stores rectStart, no isDrawing
- src/scenes/editor/interaction.ts:1231 — touch move returns early when !isDrawing, so the shape preview at :1248 never runs
- src/scenes/overworld/inspectInput.ts:217-340 — browse already implements tap-candidate deferral and pinch cancellation

**Fact-check (partially confirmed).**

The touch shape path is worse than "needs a hidden second tap". The two-tap flow at interaction.ts:1158-1184 is unreachable. Every single-finger release goes handleTouchPointerUp (:1287) → finishCurrentTouchDraw → clearShapePreview() (:1310), which nulls rectStart (:189). The next tap just sets a new anchor, which is wiped again when the finger lifts. So Rectangle, Circle, Line/Curve and Copy place or capture nothing on any touch device. progress.md:342 already documents this root cause (a real 390x844 touch probe).

The fix is therefore not only drag-to-draw. The touch path must set isDrawing and rectStart on down, preview on move, and stamp or capture on up before clearShapePreview runs, mirroring the mouse path at :810-843 (including beginPathBend for Curve).

Missing mitigation: the phone editor has −/+ zoom and Fit buttons (index.html:1214-1218), and every stray tile/object/fill can be undone. The pinch stray-edit bug is real (tools.ts:180-203 and interaction.ts:1145-1152 commit on down; :1101-1104 and :1424-1428 commit rather than revert), but it is an annoyance, not data loss. No cancel/revert batch API exists, so the deferral approach from inspectInput.ts:219-341 (tap candidate cleared when a second pointer arrives) is the right fix.

### F077: Installed Android app is locked to landscape, the one orientation with no controls

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** If someone adds WAMP to their Android home screen, it opens locked sideways because of an old setting from when the game was landscape-first. Since controls only exist in portrait now, the installed app can't be played on a phone. It's a one-line fix.

**Technical detail.**

public/app.webmanifest:9 sets "orientation": "landscape". It was added in c9f8d9a4 during the landscape-first era and never updated when the April 2026 pass went portrait-first. The live https://wamp.land/app.webmanifest still serves it. Chrome/Android enforces manifest orientation in standalone mode, while iOS ignores it. Change it to "any" (or "portrait" until landscape controls exist). While editing the manifest: both icons are purpose 'any' only (app.webmanifest:12-23), so Android adaptive icons get letterboxed on a white plate. Add a 512px icon with "purpose": "maskable" and the art inside the 80% safe zone. Also consider apple-mobile-web-app-status-bar-style 'black-translucent' (index.html:11) so the standalone iOS status bar matches the #050505 theme and the existing --safe-top padding takes effect.

**Evidence.**

- public/app.webmanifest:9 — "orientation": "landscape" (also live in production via GET https://wamp.land/app.webmanifest)
- public/app.webmanifest:12-23 — no maskable icon
- index.html:9-11 — standalone-capable metas with status-bar-style 'default'
- src/ui/mobile/controller.ts:411 — controls require orientationState==='portrait'

**Fact-check (confirmed).**

Three corrections. (1) "Can't be played on a phone" goes too far. In the landscape-locked app you can still browse the world and use the editor sheets (mobile-testing.md:34-37 covers both in landscape). What you can't do is play a room, because there are no touch controls. Since playing is the main loop, it's still a real defect. (2) The fix should be "any", or just deleting the orientation key, not "portrait". Portrait would block the landscape browse and editor layouts that work today. (3) Treat the iOS black-translucent change as a separate task to test, not part of this quick fix. With black-translucent the page draws under the status bar and the notch, so every top-anchored HUD element has to use --safe-top. Only some of them do (base.css:432, course-editor.css:39,325). Changing it without checking could put HUD buttons under the notch in the installed iOS app. The maskable-icon advice is right but cosmetic.

### F161: Phone editor still has the old layout: Spawn in Objects→Utility, Test/Publish behind "← World"

- **Area:** Level building / editor UX
- **Type:** improvement · **impact:** high · **effort:** medium
- **Flagged before:** Owner's editor IA pain points from the 2026-09-03 session (spawn buried in Objects→Utility, enemies under Objects, Wamp-O-Gram in action rail) were fixed by the 'Editor dock redesign' release for desktop/tablet only; the ledger explicitly says 'Phone and expanded-room shells remain unchanged.'

**Summary.** The desktop dock fixed Jonathan's pain points: one-tap Place Spawn, Characters and Hazards separated from Objects, and Wamp-O-Gram moved into Share. Phones still use the old layout. Spawn is under Objects → Utility, enemies are mixed into Objects, Wamp-O-Gram is in the action rail, and Test and Publish are hidden behind a tab labeled "← World". The 8-tab bar likely overflows a portrait phone and hides Undo.

**Technical detail.**

The dock shell is deliberately disabled on phones (editorDockShell.ts:185-188), and deactivating it resets object scope to 'all' (editorDockShell.ts:509). objectMatchesEditorScope('all') shows spawn_point, whose category is 'interactive', under the 'Utility' tab (config/objects.ts:330; index.html:711). The phone nav (index.html:2022-2035) is ← World / Tools / Background / Palette / Objects / Goal / Undo / Hide. Test and Publish live only in #editor-actions, which is data-mobile-panel='actions', i.e. the '← World' sheet (index.html:833-851). That sheet also still has the 'Gram' button. At 10px IBM Plex Mono with 12px side padding (bars-buttons.css:213-216, phone-editor-tools.css:19-27), the 8 labels need roughly 480px against about 378px of nav width on a 390px phone, and overflow-x is a hidden-scrollbar scroller (mobile-controls.css:169-191). The ~33px-tall tap targets are also small. Plan: a phone dock with the same model. Bottom tabs: Terrain · Stuff · Characters · Hazards · Deco · Markers (Spawn/Goal). A slim persistent top strip: ↶ ↷ · ▶ Test · 🚀 Publish · ⋯ (Room/Share/Back). Reuse reduceEditorDockShellState and the object-scope memory, which are DOM-agnostic, and feed them to a phone renderer. Extend smoke:mobile to cover phone portrait editing; today it only covers landscape editor sheets (docs/development/mobile-testing.md).

**Evidence.**

- src/ui/setup/editorDockShell.ts:185-188 — dock shell excluded when deviceClass === 'phone'
- src/ui/setup/paletteController.ts:76-93 — scope 'all' on phone; spawn_point excluded only from 'stuff'
- src/config/objects.ts:330 — spawn_point category 'interactive' (Utility tab, index.html:711)
- index.html:2022-2035 — phone nav tabs; Test/Publish not present
- index.html:833-851 — Test/Publish/Gram live in the '← World' actions sheet
- src/styles/sections/world/bars-buttons.css:213-216 — 10px button text on phone nav

**Fact-check (partially confirmed).**

The tab the overflow hides is "← World", not Undo. #mobile-editor-nav keeps justify-content:center from mobile-controls.css:169-181 inside an overflow-x:auto scroller. On a portrait phone the buttons need about 487px against roughly 376px of nav. The overflow splits evenly to both sides, and the left-side overflow can't be scrolled to. Measured with the real CSS and font loaded:
- 390px phone: "← World" at x=-48..19, about 13px visible.
- 360px phone: about 0-4px visible.

That makes Test, Save, Publish and Back nearly unreachable on portrait phones, which is a defect, not just poor information architecture. Undo (342..391 against a 384px right edge) is mostly visible, and Hide can be reached by scrolling.

Two smaller corrections:
- smoke:editor-dock does load the phone editor at 390x844, but it only asserts that the nav isVisible. smoke:mobile covers landscape only.
- Recommended order: a quick fix first (under an hour: justify-content: safe center or flex-start, or shorter labels, or pin "← World" and Undo outside the scroller), then the medium-effort phone dock redesign.

### F158: On phones, pressure plates, chests, Sword Hunters, police and NPCs can't be configured

- **Area:** Level building / editor UX
- **Type:** defect · **impact:** high · **effort:** medium

**Summary.** On a phone you can place a pressure plate, door, chest or Sword Hunter but can't link or configure it, because the object settings panel is hidden on phones. That means phone builders can never publish a Collect Race room, which needs a Sword Hunter set to "Collect Items". Pressure-plate puzzles and chest loot are desktop-only.

**Technical detail.**

#editor-inspector carries class desktop-editor-only (index.html:1392), and phone-editor-shell.css:74-76 forces `.desktop-editor-only { display:none !important }` on phones. Nothing moves the inspector into a phone sheet: the uiBridge only toggles its hidden state (uiBridge/panels.ts:60), and src/ui/mobile has no inspector handling. The inspector already supports tap-to-pin (inspector.ts:420-431, 1083), so tablets work and only phone rendering is missing. Collect Race publishing is blocked by roomGoals.ts:431-433 unless one Sword Hunter is in collect mode, a setting that only exists in #swordsman-objective-panel. Fix: on phones, when pinInspector() fires, open the inspector as a bottom sheet. Reuse the existing mobile sheet mechanics (data-mobile-editor-sheet) or add an 'inspect' sheet that appears in place of Palette/Objects. Give it a Done button that calls clearPinnedSelection(). Pressure-plate 'Connect' mode then becomes 'tap target'. Add a phone smoke step: place a plate and a door, link them, and assert the link persists.

**Evidence.**

- index.html:1392 — <div id="editor-inspector" class="editor-inspector desktop-editor-only hidden">
- src/styles/sections/responsive/phone-editor-shell.css:74-76 — .desktop-editor-only display:none !important on phones
- src/scenes/editor/inspector.ts:420-431 — tap/click already pins the pressure-plate inspector
- src/goals/roomGoals.ts:431-433 — Collect Race requires a Sword Hunter set to Collect Items (only settable in the hidden panel)

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

Phones (coarse pointer and shortest edge 540px or less) never see #editor-inspector (index.html:1392 plus phone-editor-shell.css:74-76).

Settings that can't be changed at all on a phone:
- Sword Hunter mode and defeat mode. They stay at duel/defeatable, so a Collect Race room can't be published from a phone (roomGoals.ts:431-433).
- Police patrol and shooting.
- NPC mode, name, dialogue, pushable/jump/collision toggles and defeat mode.
- Re-linking an existing plate, clearing a link, and "I Don't Know Yet".

Things that do work on phones:
- Filling a chest: select an item and tap the chest (inspector.ts:1039-1075).
- Linking a newly placed plate to an existing target: auto connect mode, then tap the target (inspector.ts:510-518, 1027-1035).

Additional phone bug: placing a plate before its target leaves connect mode active. Every object-mode tap is then swallowed (handlePressurePlateConnectionClick returns true when nothing is hit), and the only exits are Escape or an eraser tap on empty space.

The fix as proposed still fits: show the inspector as a phone bottom sheet when pinInspector fires, with a Done button that calls clearPinnedSelection(). Also show the connect-mode prompt with a Cancel button on phones.

Fully blocked on phones (the select or panel is inside #editor-inspector.desktop-editor-only, index.html:1392, hidden by phone-editor-shell.css:74-76):
- Sword Hunter objective mode. This makes Collect Race impossible to publish from a phone (roomGoals.ts:431-433).
- Police behavior mode.
- NPC behavior.

Partly usable on phones:
- Chest/container contents: select a collectible or enemy, then tap the chest (inspector.ts:1038-1078). Only the text feedback and the Clear button are missing.
- Pressure-plate linking: placing a plate starts connect mode, and tapping an existing target links it (inspector.ts:510-518, 990-1036).

Missing for pressure plates on phones:
- The Connect, Clear Link and "I Don't Know Yet" buttons.

Additional phone trap the claim missed:
- If a plate is placed before any valid target exists, connect mode stays on and swallows later object-placement taps (inspector.ts:997-1002). The only exits are the Escape key or an eraser tap on empty space.

The suggested fix still applies (show the inspector as a phone bottom sheet with Done and Cancel-link buttons). It should also add a visible cancel button for link mode on phones.

Chests are not desktop-only. On phones, tapping a chest with a collectible or enemy selected fills it (inspector.ts:1052-1078). Only feedback and Clear Contents are missing. Pressure plates, portals and moving platforms enter link mode automatically when placed (inspector.ts:510-517). So linking to a target that already exists works on phones, with no feedback. What phones can't do is re-link or clear a link. The bigger phone bug the claim misses: if a linkable object is placed before any target exists, link mode stays on and swallows every later object tap (inspector.ts:1001-1008 returns true) with no explanation. No Escape key or "I Don't Know Yet" button is available on phones. Only an eraser tap on empty space or starting a playtest gets out of it. Confirmed as stated: Sword Hunter objective (so Collect Race can't be published, roomGoals.ts:431-433, default 'duel' at swordsmanObjectives.ts:10), Sword Hunter defeat mode, police behavior and shooting, and NPC mode, flags, name, dialogue and defeat mode all can't be set on phones.

### F140: Touch: holding the stick slightly down in mid-air triggers a butt stomp (breaks drop-through and puzzle crates)

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** On phones, holding the move stick slightly downward while you're in the air instantly starts a butt stomp: a mid-air freeze followed by a slam. It fires when you drop through a one-way platform, walk off a ledge while crouching, or just let your thumb drift. On keyboard it only happens when you deliberately tap Down. A stray stomp can also smash crates the builder placed for a puzzle, which can make a puzzle room unwinnable on mobile.

**Technical detail.**

Keyboard uses edge-triggered `downPressed = JustDown(cursors.down) || JustDown(wasd.S)` (movementController.ts:414-416). Touch uses a held state, `touchDown = moveY >= 0.42` (399). The stomp starts on `(downPressed || touchDown)` whenever the player is airborne (506-511), so on touch any held down starts a stomp. The portrait stick reaches 0.42 at about a 22px drag (portraitPlayControls.ts:12-13: vertical deadzone 10px, full tilt 38px). Drop-through: OverworldPlayScene.ts:2379-2381 starts beginOneWayDropThrough on down+jump. On the next airborne frame touchDown is still held, so startButtStomp runs: a 190ms freeze with vx=0 and gravity off (BUTT_STOMP_FLIP_MS, 59; 547-548; 979-982), then a 520px/s slam. Crates are documented as breakable by butt stomp (objects.ts:341). Fix: track `prevTouchDown` in controller state and compute `touchDownPressed = touchDown && !prevTouchDown`. Only start a stomp on a fresh press made while already airborne; ignore a down that was held when leaving the ground, ladder or one-way platform. Optionally require a firmer flick (moveY ≥ 0.7). Also block stomps for ONE_WAY_DROP_THROUGH_MS (240ms, specialTiles.ts) after beginOneWayDropThrough. Add unit tests: touch-down held through a ledge walk-off or drop-through must not set isButtStomping.

**Evidence.**

- src/scenes/overworld/movementController.ts:399 — `touchDown = touchInput.active && touchInput.moveY >= 0.42` (held state)
- src/scenes/overworld/movementController.ts:414-416 — keyboard downPressed is JustDown (edge-triggered)
- src/scenes/overworld/movementController.ts:506-511 — `else if (!stomping && !climbing && (downPressed || touchDown)) startButtStomp()`
- src/scenes/OverworldPlayScene.ts:2379-2381 — down+jump begins one-way drop-through, so the stomp fires on the next airborne frame for touch
- src/ui/mobile/portraitPlayControls.ts:12-13 — vertical deadzone 10px / full tilt 38px → ~22px drag reaches the 0.42 threshold
- src/config/objects.ts:341 — crate: 'Stand on it, push it, or break it with a butt stomp.'

**Fact-check (confirmed, confirmed, partially confirmed).**

Small corrections, none of which change the core claim. (1) "Can make a puzzle room unwinnable" is too strong. A broken crate is removed from the room's loaded objects, so the puzzle is stuck until the player restarts or reloads the room, not permanently. (2) The thumb-drift case only happens after the jump: while grounded, holding the stick down makes you crouch, and crouching blocks the jump. (3) Holding down on touch was a deliberate design choice (commit d487f625), since touch has no stomp button. The fix must keep a way to stomp on touch: a fresh push past the threshold made while already in the air (track the previous touchDown value), plus blocking stomps for about 240ms after beginOneWayDropThrough. (4) The touch stick only works on a phone in portrait (portraitPlayControls.ts:261-269), so landscape and tablet players are not affected.

1. "Breaks drop-through" overstates it. The player still falls through, but with an unwanted 190ms mid-air freeze and then a slam. specialTiles.ts:322 turns one-way collision off for 240ms, and the slam usually clears the tile before it turns back on (re-collision needs previousBottom ≤ top+6, at :337-341).
2. It only affects portrait phone play. The touch stick only exists when isPortraitPlay is true (phone + coarse pointer + portrait + world play, mobile/controller.ts:408-414). Other input sends keyboard events, which are press-only.
3. "Unwinnable" is softened: the mobile Restart button (OverworldPlayScene.ts:2322 → restartCurrentRun) gives a way out, though repeated accidental crate breaks are still frustrating.
4. Fix note: tracking prevTouchDown should live in the movement controller state and be reset on respawn and restart. Blocking stomps until the down input has been released at least once after leaving the ground handles ledges, drop-through and ladders in one rule.

The drop-through still completes; it just gains a 190ms mid-air freeze and then a 520px/s slam. Rooms do not become unwinnable: resetRoomChallengeState (OverworldPlayScene.ts:4796-4815) recreates live objects and resets special tiles, so a restart restores broken crates and bricks. The real cost is a lost attempt or worse run time. The claim understates the damage in one way: the stomp breaks entire brick_box stacks (liveObjects.ts:2124-2148) and breakable special-brick tile stacks (specialTiles.ts:765-799), not just crates. Another trigger the claim misses is climbing down off the bottom of a ladder into the air while holding the stick down. Mid-air thumb drift is less likely than claimed, because the same drift on the ground makes the player crouch (and blocks jumping), which they would notice. Directional gravity (movementController.ts:906/915/924) has the same held-instead-of-pressed problem, where a held direction acts as a jump press, and the fix should cover it too.

### F109: Phone chrome uses 6–7px text and 20–30px tap targets

- **Area:** Visual design, UI polish & information architecture
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** On phones, the bottom bar (people online, Settings, Guestbook, Controls), the 'More + / Room −' toggles and the room-state badge shrink to 6–7px pixel text on buttons 20–30px tall. They're hard to read and easy to mis-tap. Raise them to at least 8px (the crisp size for these fonts) and 44px touch height, and show fewer buttons.

**Technical detail.**

phone-chrome.css:34-40 sets the world bottom bar to min-height 30px and font-size 7px. :86-96 sets play mode to min-height 20px at 7px. phone-world-chat.css sets More+/Room− to 28px/7px (:62-68), the state pill to 6px (:84-90), the 'More' grid buttons to 30px/7px (:149-156) and .mini-profile-stat-level-label to 6px (:325-328). Measured in a headless 390x844 render of the real CSS: Settings is 75x30 at 7px Early GameBoy, More+ is 41x28 at 7px HomeVideo, and Explore/Leaderboard/Comments are 95x30 at 7px. Across the CSS there are 14 font-size declarations at 6–7px and 52 at 8px. Early GameBoy is built on an 8px-per-em grid (checked with fontTools), so 7px also renders smeared. Fix: add a phone token --tap-min: 44px. Cut the phone bottom bar to at most 3 items (online pill, Chat, and a 'Menu' sheet holding Settings/Guestbook/Controls/About) at 8px Early GameBoy or 10px HomeVideo, 44px tall. Replace the two HUD toggles with one 44x44 chevron. Raise the state pill to 8px. Check the result with the existing smoke:mobile script.

**Evidence.**

- src/styles/sections/responsive/phone-chrome.css:36-39 — #bottom-bar .bar-btn min-height 30px, font-size 7px
- src/styles/sections/responsive/phone-chrome.css:88-95 — play-world footer buttons min-height 20px, font-size 7px
- src/styles/sections/responsive/phone-world-chat.css:62-68 — More+/Room− 28px tall, 7px
- src/styles/sections/responsive/phone-world-chat.css:84-90 — .world-state-pill font-size 6px
- src/styles/sections/responsive/phone-world-chat.css:149-156 — details grid buttons 30px, 7px
- measured via headless render: btn-world-settings 75x30 @7px; btn-mobile-world-hud-details 41x28 @7px (scratchpad/shots/phone-world-details.png)

**Fact-check (confirmed, confirmed, partially confirmed).**

There are two scope details, and neither changes the core claim.
(1) The 20px/7px play-world footer only shows on phones in landscape. In portrait phone play, isPortraitFocusedRoom is true (src/ui/mobile/controller.ts:407-413), and phone-portrait-world-hud.css:21-23 hides #bottom-bar entirely.
(2) The world HUD creator card on phones hides .mini-profile-stats (phone-world-chat.css:101-105), so the 6px .mini-profile-stat-level-label rule at :326-328 only affects mini-profile cards in other places.

Raising every bottom-bar item to 44px adds about 14px of chrome height, which takes space from the game view in landscape. The suggested merge into a single "Menu" sheet is a design choice the code does not require. The basic fix is small: raise text to 8px Early GameBoy and give buttons at least a 44px (or at least a 24–32px) hit area, matching the existing tablet rule.

Scope corrections:
(1) The 20px play-world footer (phone-chrome.css:84-96) only shows in phone landscape play. In portrait play the whole #bottom-bar is hidden by phone-portrait-world-hud.css:21-23, because controller.ts:408-414 sets mobilePortraitFocusedRoom=true for portrait play.
(2) The 6px .mini-profile-stat-level-label never appears in the world HUD creator card on phones, because .mini-profile-stats is display:none there (phone-world-chat.css:101-105). It only affects other mini-profile cards, such as the auth-panel card built in client.ts:1255.
(3) The compact phone HUD was a deliberate production release (feature-ledger.md:63, commit 019cf3a5, 2026-08-15), and the mobile smoke test enforces hud.height <= 150 (scripts/mobile_smoke.mjs:558). Raising the HUD toggles and grid buttons to 44px has to fit that height limit, or the limit needs a conscious change. The footer has no such limit.
(4) The easiest fix is to reuse the tablet pattern in utility-tablet.css:7-14 (44px min-height on coarse-pointer .bar-btn) for the phone footer.
(5) "Chat" is not in the phone footer today. It sits hidden in the HUD tertiary row (index.html:1882), so adding it to the footer is a new suggestion, not a reorganization of what's there.
(6) The primary Play/Edit/Build row is already 34px at 8px (phone-world-chat.css:124-135), so not all phone chrome is 6-7px.

Impact should be medium, not high. These are secondary chrome controls; the primary phone actions are 34px at 8px and the portrait play controls are large. The 20px play-world footer rule only applies in landscape, because portrait play hides #bottom-bar (phone-portrait-world-hud.css:21-23). In landscape the fix should hide or collapse that footer into a menu instead of enlarging it to 44px, since that would eat over 11% of a roughly 390px-tall game view. "Smeared" should be "unevenly sized pixels plus very small physical size (about 5px cap height)". 7px was a deliberate choice to fit four nowrap items (commit 019cf3a5), so raising the font requires the item cut. Moving items into the existing #menu-body menu keeps the effort small, and any taller HUD toggles must keep the smoke-test HUD height at or under 150px.

### F076: Typing on a phone (chat, Say, sign-in email) zooms the page and flips the layout to 'landscape'

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Most text boxes use fonts smaller than 16px, so iPhones zoom the page when you tap them. The game also measures the area left above the keyboard and treats it as the screen size. With the keyboard open, a portrait phone gets classified as 'landscape': play controls vanish and the room HUD pops open over the game, and it stays open after the keyboard closes.

**Technical detail.**

Two compounding bugs. (A) iOS Safari auto-zooms any focused input with computed font-size <16px, and the viewport meta has no maximum-scale (index.html:5). Affected inputs: .chat-input 12px (chat-and-jump.css:260), .room-chat-input 12px (chat-and-jump.css:52; created and focused in roomChat.ts:364 and :239), #world-jump-input 11px (chat-and-jump.css:13), #auth-email-input and #auth-display-name-input 11px (base.css:953,965), editor .room-title-input 13px (retro-skin.css:66). Only .object-search-input gets 16px on phones (phone-editor-tools.css:90-91). (B) deviceLayout.computeState reads window.visualViewport.width/height (deviceLayout.ts:66-71). Those shrink when the keyboard opens and when iOS zooms. A 393×660 iPhone with a ~330px keyboard measures about 393×330, so orientationState becomes 'landscape'. The same numbers set --app-viewport-width/height (deviceLayout.ts:92-93), which size #app (base.css:1138-1142), so a zoomed visual viewport also narrows the app. In portrait play, MobileUiController.render then hides the controls, and :455-457 sets worldHudCollapsed=false because isPlay && !isPortraitPlay. :440-453 only re-collapses on an app-mode change, so after the keyboard closes the HUD stays expanded and the compact Stop/Restart buttons stay hidden (:485-492). Fix: (1) add `body[data-coarse-pointer='true'] input, textarea, select { font-size: max(16px, 1em) }`, or set 16px on each input above; this keeps pinch-zoom for accessibility. (2) In deviceLayout, compute orientation and deviceClass from the layout viewport (window.innerWidth/innerHeight, or screen.orientation.type). Use visualViewport only for a separate --keyboard-inset = innerHeight - vv.height - vv.offsetTop, and pin bottom-anchored inputs above the keyboard with it (#global-chat.is-open at phone-world-chat.css:383-389 and .room-chat-composer at :373-376 use fixed bottoms that ignore the keyboard). Add a unit test that mocks visualViewport at 393×330 with innerWidth/innerHeight 393×660 and expects 'portrait'.

**Evidence.**

- src/ui/deviceLayout.ts:66-71 — width/height (and orientation) come from visualViewport, which shrinks with the keyboard and with zoom
- src/ui/deviceLayout.ts:129-130 — refreshState also runs on every visualViewport resize/scroll
- src/ui/mobile/controller.ts:455-457 — leaving portrait play force-expands the world HUD; never re-collapsed when portrait returns
- src/styles/sections/world/chat-and-jump.css:52 — .room-chat-input font-size 12px; src/scenes/overworld/roomChat.ts:239 focuses it from the in-play 'Say' button
- src/styles/sections/world/chat-and-jump.css:260 — .chat-input 12px
- src/styles/sections/base.css:953 — #auth-email-input 11px (sign-in on phones)
- src/styles/sections/responsive/phone-editor-tools.css:90-91 — only the object search input was given 16px on phones
- index.html:5 — viewport meta has no maximum-scale/interactive-widget

**Fact-check (partially confirmed, confirmed, partially confirmed).**

Part A (fonts under 16px plus no maximum-scale, so iOS zooms on focus) is accurate as stated. Part B is real code but needs four corrections:
(1) Room chat's 'Say' button can't be reached on phones. #btn-world-room-chat is inside .world-hud-row-tertiary-actions, which is display:none on phones (phone-world-chat.css:45). That row only reappears with world-mode HUD details (controller.ts:511-514, reset at :447). The global chat toggle is covered by the portrait console. The repro therefore needs another keyboard route, such as sign-in.
(2) The orientation flip depends on the device. It only happens when the visual viewport height drops to the width or below. That is likely on small phones and not guaranteed on large ones. iOS zoom alone never flips orientation, because both dimensions scale together. It does narrow #app via --app-viewport-width, and it can reclassify a zoomed tablet as a phone.
(3) After a flip, the HUD stays expanded and Stop/Restart stay hidden only until the player taps the visible 'Room −' minimize button (controller.ts:214-220, 507-510). It is not stuck for good.
(4) Separate, related bug: on phones the 'Say' button is effectively unreachable during play.

Small corrections:
1. The portrait-to-landscape flip happens only when the visual height with the keyboard open falls below the width. That is common on small and mid-size phones and with the iOS top-address-bar layout. It is not every phone: large phones such as a Pro Max can stay portrait.
2. iOS input zoom does not change orientation on its own, because it shrinks width and height equally. It does narrow `#app` through `--app-viewport-width`, and the zoom stays after the input loses focus.
3. The HUD that stays expanded can be collapsed again with the visible minimize button (`controller.ts:214-220`). It is a nuisance, not a dead end.
4. On phones the jump field is `#mobile-world-jump-input` (`.goal-input`, 11px, `palette-goals.css:219`), not `#world-jump-input`.

The suggested fix (compute orientation from innerWidth/innerHeight or `screen.orientation`, a separate keyboard-inset variable, and a 16px minimum for inputs on touch devices) still stands.

1. On phones the jump sheet uses #mobile-world-jump-input, not #world-jump-input (index.html:2052). Its .goal-input class is also 11px (palette-goals.css:219). Fix .goal-input as well, since it is used by several inputs (room title, course title, wamp-o-gram title).
2. Zoom does not flip orientation. It only shrinks --app-viewport-width/height, so #app and the canvas shrink.
3. Whether the keyboard flips the layout to landscape depends on the device. Expect it on SE and mini iPhones, in in-app browsers and with emoji or CJK keyboards. On standard 6.1" iPhones it is borderline. Pro Max models and most Android Chrome phones probably stay portrait.
4. Fix caveat: commit 2684f102 switched to visualViewport on purpose, to fix the gap at the bottom of the mobile editor on notched phones. Do not move --app-viewport-height off visualViewport without re-testing that.
   - Only derive orientation and deviceClass from the layout viewport (window.innerWidth/innerHeight) or from screen.orientation.type.
   - Avoid the CSS orientation media query, because older Android behaviour that resizes the page for the keyboard can also flip it.
   - Optionally, freeze the orientation state while a text input has focus.
5. The stuck HUD can be collapsed with the visible Minimize button. Still, the controller should remember that the HUD was collapsed before the flip and restore it.

### F098: Phone portrait play shrinks rooms that use the 'fixed room camera' to a 17px-tall hero, and the screen shows the neighboring room

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** On a phone held upright, the welcome room is drawn so small that your character is about the size of a fingernail. The top third of the play area shows a different room above it. The game has a 2x zoom for portrait phones, but the per-room 'centered camera' option overrides it.

**Technical detail.**

When room.cameraMode==='room', cameraController.syncRoomCamera (src/scenes/overworld/cameraController.ts:59-80) sets zoom=min(cameraW/ROOM_PX_WIDTH, cameraH/ROOM_PX_HEIGHT), commented 'even narrow portrait screens must fit the whole room'. That is 375/640=0.586 on a 375px phone. This bypasses the portrait multiplier (OverworldPlayScene.ts:315 MOBILE_PORTRAIT_PLAY_CAMERA_ZOOM_MULTIPLIER=2, consumed only via getFitZoomForRoom at :3976-3988). Fix for phone portrait: (a) ignore cameraMode 'room' and use follow-cam at fitZoom×2 with room bounds clamping; or (b) keep the fit but compute it against the area above #mobile-play-controls, center the room vertically in it, and dim or letterbox neighbors so only the active room is visible. Consider letting builders preview how their room looks on a phone in the editor's Test.

**Evidence.**

- Live Playwright iPhone 375x812, both the Welcome→Play and the Play Room paths: mobilePortraitCamera = {cameraZoom:0.586, fitZoom:0.561, zoomMultiplier:2, playerScreen:{x:52,y:473}, controlsTop:518}
- Screenshot m-play-again: the active room fills about 25% of screen height, the room above fills about 37%, and the player sprite is about 17 CSS px tall
- src/scenes/overworld/cameraController.ts:65-66 — 'Do not clamp to the normal zoom floor: even narrow portrait screens must fit the whole room.'
- git log cd5967a1 'Add per-room centered play camera option'

**Fact-check (confirmed).**

The core claim holds. Some clarifications and additions:
1. The affected room is the Welcome→Play destination, (-11,-6) "de ja vu 1 room" (welcomeModal.ts:20). Its published snapshot has cameraMode:'room'. Room 0,0 does not; it uses 'follow'.
2. Pinch, zoom and pan are all disabled while the room camera is fixed (inspectInput.ts:140/165, viewportController.ts:208/261/305), so players cannot work around it.
3. The full-room fit on portrait screens was intentional and is locked in by tests: cameraController.test.ts:75 and smoke_room_camera.mjs:98, which asserts the full 640px width is visible.
4. Fix (a), follow-cam at fitZoom×2, would show only about 335 of the room's 640px width on a 375px phone. That defeats what the builder chose the option for, and it means updating those tests. Fix (b) keeps the full-width fit but centers the room in the band above #mobile-play-controls, using the same offset logic as getMobilePortraitPlayCameraTargetY, and dims or letterboxes everything outside the active room. (b) is the safer default.
5. The hero size of about 17px fits a sprite about 29px tall at 0.586 zoom. The physics hitbox is 14px (OverworldPlayScene.ts:355), which would be about 8px on screen.

### F082: Phone builders can't name their room — the title box is hidden on phones

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** On a phone, the 'Name this room' box is hidden in the editor and nothing replaces it. Phone builders publish rooms with no title, which makes them less findable and less shareable in Explore, leaderboards and share cards.

**Technical detail.**

The only room-title input is #room-title-input inside #room-title-section in #game-container (index.html:1376-1379). On phones, phone-editor-shell.css:78-80 sets it to display:none (added in 1d14907d, 'Improve mobile editor camera controls'). The desktop/tablet dock moves the title into its shell (editorDockShell.ts:527-534), but the dock is disabled on phones (editorDockShell.ts:188), and the phone Goal and Actions sheets have no title field. Fix: on phones, move #room-title-section into the 'goal' or 'actions' mobile sheet (it already has data-mobile-panel="goal"), or show it as a slim bar above the stage. Give it font-size 16px to avoid iOS zoom (see the keyboard finding). Add a phone-editor smoke assertion that #room-title-input is visible in at least one sheet.

**Evidence.**

- src/styles/sections/responsive/phone-editor-shell.css:78-80 — #room-title-section display:none on phones
- index.html:1376-1379 — the only room title input
- src/ui/setup/editorDockShell.ts:188 — dock shell (which relocates the title) disabled for phones
- src/scenes/editor/uiBridge.ts:614-617 — title commits only from this input

**Fact-check (confirmed).**

Small refinement, not a contradiction: the `data-mobile-panel="goal"` attribute on #room-title-section has no effect today, because the phone sheet CSS (phone-editor-shell.css:91-97) only matches `#sidebar .sidebar-section[...]`. The fix has to move the element into a #sidebar .sidebar-section (for example, put it in the goal or actions sheet with JS when deviceClass==='phone', mirroring editorDockShell.moveEditorChromeIntoShell) or add a dedicated phone rule that shows it. Only rooms created and published entirely on a phone are left untitled; titles set on desktop/tablet persist.

### F086: Full-screen phone modals and the menu are sized with 100vh, so iOS Safari's toolbar covers the bottom

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** On iPhones, pop-up screens such as leaderboards, room history and the account menu are sized to the screen height with Safari's toolbar hidden. With the toolbar showing, the bottom of the panel, where buttons often are, sits under it or off-screen. The app already has a correct measurement and just doesn't use it here.

**Technical detail.**

On phones every .history-modal-panel and .mobile-sheet-panel gets min-height:100vh and max-height:100vh (phone-modals-touch.css:28-36) inside a position:fixed; inset:0 flex container that centers and doesn't scroll (room-course.css:3-13). In iOS Safari 100vh is the large viewport, taller than the visible area while toolbars are shown and the page can't scroll (body overflow:hidden, base.css:76-78). So the panel overflows top and bottom, and centered overflow is clipped. #menu-body uses calc(100vh - 72px - …) (phone-world-chat.css:248). Twenty-plus desktop modal rules also use calc(100vh - 32px) (e.g. shared-modal-skin.css:25-40, settings.css:66). Fix: use the pattern #app already uses (base.css:1138-1139): height: 100vh; height: min(100dvh, var(--app-viewport-height)). For the phone overrides, set min-height/max-height to min(100dvh, var(--app-viewport-height)) and add align-items: safe center (or flex-start) on .history-modal so overflow stays reachable.

**Evidence.**

- src/styles/sections/responsive/phone-modals-touch.css:28-36 — phone modal panels min/max-height 100vh
- src/styles/sections/modals/room-course.css:3-13 — fixed inset:0 centered container without overflow
- src/styles/sections/responsive/phone-world-chat.css:248 — #menu-body max-height calc(100vh - 72px …)
- src/styles/sections/base.css:1138-1139 — #app already uses min(100dvh, --app-viewport-height)

**Fact-check (confirmed).**

Small fixes to the details. The core claim stands.
1) Not every panel gets max-height:100vh from the phone rule. ID-scoped rules in shared-modal-skin.css:23-41 (#leaderboard-modal, #explore-modal, #profile-modal, #editor-music-phrase-save-modal) have higher specificity. They override it with max-height calc(100vh - 32px) and a non-full-width width. But min-height:100vh still applies, and min-height beats max-height, so these panels still end up 100vh tall. The fix must reset min-height too, not just max-height.
2) The same ID rules, plus #room-history-modal, #room-rush-modal and #room-rush-result-modal (room-course.css:35-45), also override the phone padding with a fixed `20px 18px 18px`. These modals lose their safe-area insets on phones, which matters in landscape on notched phones. Fix that at the same time.
3) This is not only iOS. Android Chrome also computes 100vh against the largest viewport, with the URL bar hidden, and a page that doesn't scroll keeps the URL bar showing.
4) The fix already exists in the welcome modal (rating-welcome-goals.css:1102-1111). Generalize it: on phones set min-height:0 (or the viewport value) and max-height: min(100dvh, var(--app-viewport-height)) on `.history-modal-panel`/`.mobile-sheet-panel` and on the four ID-scoped panels. Make the panel overflow-y:auto. For alignment, `align-items: flex-start` with `margin: auto` on the panel is safer than `safe center`, because `safe` alignment support in older iOS Safari is not guaranteed.
5) #menu-body is a dropdown, not a full-screen modal. It is only clipped when the menu is long enough to hit its max-height.

### F085: Double-tap-zoom blocker swallows any second tap within 320ms (e.g., rapid Undo)

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** To stop phones zooming on a double-tap, the game cancels any tap that comes within a third of a second of the previous one, anywhere on the page. Tapping Undo twice quickly in the phone editor only undoes once, and quick taps across menus get dropped. The CSS already prevents double-tap zoom, so this code only causes harm.

**Technical detail.**

bindDoubleTapZoomSuppression adds a capture, non-passive touchend listener on document. It calls preventDefault() when two touchends land within 320ms (controller.ts:265-293), exempting only inputs, labels and contenteditable (:295-305). Cancelling touchend also cancels the synthesized click, so the second tap on any HTML button (#btn-mobile-editor-undo, palette and sheet buttons, Stop/Restart, HUD buttons) never fires. Double-tap zoom is already disabled by `body[data-coarse-pointer='true'] { touch-action: manipulation }` (base.css:399-402). touch-action intersects down the ancestor chain, and it's supported in iOS Safari 13+ and Chrome. Fix: delete the handler, and if needed add touch-action: manipulation to button, [role=button] for older WebKit. If some legacy case must stay, scope it to #game-container and the console only, never to buttons.

**Evidence.**

- src/ui/mobile/controller.ts:265-270 — document-level non-passive capture touchend listener
- src/ui/mobile/controller.ts:288-292 — preventDefault on any touchend within 320ms of the previous one
- src/styles/sections/base.css:399-402 — touch-action: manipulation already applied on coarse-pointer body
- src/ui/mobile/controller.ts:176-180 — phone Undo is a click handler (affected)

**Fact-check (partially confirmed).**

(1) The claim that the guard "only causes harm" and should just be deleted is overstated. As I understand it, Safari's engine resets a touch-action rule from an ancestor at the nearest scrollable box. If so, the single body rule at base.css:399-402 does not reach buttons inside the phone editor sheets, which are scrollable (phone-editor-actions.css:83, phone-editor-tools.css:77 and others), and deleting the handler alone may bring double-tap zoom back on iOS. Safer fix: under body[data-coarse-pointer='true'], add touch-action: manipulation to button, [role=button], a, select, summary and the scrollable sheet containers. Then either delete the guard, or add those interactive selectors to shouldAllowNativeDoubleTap (controller.ts:295-305) so it never cancels touchend on them. If any of it stays, scope it to #game-container. (2) The defect is worse than described. lastTouchEndAt is updated even on cancelled taps (controller.ts:287), so steady taps faster than one per 320ms drop every tap after the first, not just the second. A touchend anywhere (a canvas paint tap, lifting off the joystick) also arms the window for the next button tap. In-game action and move controls use pointer events (portraitPlayControls.ts:79-169) and are not affected.

### F078: iPhone/iPad: sound-effect volume slider and mixing do nothing (HTMLAudio volume is read-only on iOS)

- **Area:** Mobile experience (code review)
- **Type:** defect · **impact:** medium · **effort:** medium

**Summary.** On iPhones and iPads, sound effects play at full volume no matter what the settings slider says. Setting SFX to 0 doesn't silence them, and the game's sound balance and fade-outs are skipped, so effects are loud and abrupt next to the music. Sounds may also not start until the second tap.

**Technical detail.**

SfxController plays each cue through a pooled `new Audio(url)` (sfx.ts:712) and controls loudness only with `player.volume = …` (sfx.ts:531; setVolume :445-449; fades :617). On iOS/iPadOS WebKit, HTMLMediaElement.volume is not settable from script and always plays at device volume, so the 0.55 global multiplier (sfx.ts:96), per-cue config.volume, the settings slider, and fade-outs are all ignored. A slider at 0 still plays, because only the separate `muted` flag skips playback (sfx.ts:502-505). Music works because it renders through an AudioContext. Fix: decode SFX into AudioBuffers once and play them via AudioBufferSourceNode → per-cue GainNode → master GainNode on the shared AudioContext. That gives working volume and fades, and much lower trigger latency than HTMLAudio on mobile (noticeable for jump/hit sounds). Skip playback when effective gain is 0. Unlock: both controllers resume only on pointerdown/touchstart/keydown (sfx.ts:406-408, music/controller.ts:145-147). Under HTML user-activation rules a touch grants activation on touchend/pointerup/click, not touchstart. Add those listeners (once:true), create the AudioContext inside that handler instead of lazily from the game loop (sfx.ts:822-846), and play a 1-sample silent buffer. Verify on a real iPhone with window.get_sfx_debug_state() (sfx.ts:424), which already records lastResumeAttempt/lastPlayError.

**Evidence.**

- src/audio/sfx.ts:712 — SFX are HTMLAudioElements (new Audio)
- src/audio/sfx.ts:531 — loudness set only via player.volume (ignored on iOS)
- src/audio/sfx.ts:445-449 — settings slider updates player.volume on active players
- src/audio/sfx.ts:617 — fade-outs implemented by stepping player.volume
- src/audio/sfx.ts:406-408 — unlock listeners are pointerdown/keydown/touchstart only
- src/music/controller.ts:145-147 — same unlock events for music

**Fact-check (confirmed).**

Small corrections and additions.

1. **No shared AudioContext.** SFX and music each create their own context lazily (sfx.ts:834, music/controller.ts:868). The fix should create one shared context and inject it into both controllers. That also avoids iOS limits on how many contexts a page can have.

2. **Second-tap claim is unproven.** "Sounds may not start until the second tap" comes from the spec rule that touchstart doesn't count as user activation, plus the known iOS change that requires touchend. It wasn't shown in code or on a device. Most SFX use the plain HTMLAudio route, which doesn't depend on the SFX AudioContext, so that part should be treated as something to check on an iPhone.

3. **Add the adjoining-room bleed as the most audible symptom.** roomAudio.ts:20-50 relies on volumeMultiplier 0.26/0.1/0.05 for neighbour-room cues and echoes, and iOS plays all three at full volume.

4. **Cheaper interim fix.** Route every player through createMediaElementSource → per-player GainNode → master GainNode, and set gain instead of element.volume. The AudioBuffer rewrite stays the better long-term option because it also cuts trigger latency. Also skip `play()` when the effective volume is 0 on every platform, or wire the unused `setMuted`, since a slider at 0 currently still uses up pool players everywhere.

### F148: No gamepad support and no instant-restart key

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** There's no controller support and no quick-restart key. Platformer fans expect to plug in an Xbox, PlayStation or Switch pad, and leaderboard chasers expect to press R and retry instantly. Gamepad support would also give iPad and tablet players a way to play, since on-screen controls only appear on phones held upright.

**Technical detail.**

The Phaser input config only sets mouse options, so the gamepad plugin is off (main.ts:97-101). setupGameplayKeys binds only arrows, WASD, Q, E, 9 and ESC (OverworldPlayScene.ts:2670-2692). Restart is available only through the HUD and the touch button (OverworldPlayScene.ts:2322-2324; ui/setup/sceneCommands.ts:151-154). Touch controls render only when deviceClass === 'phone' and the phone is in portrait (ui/mobile/controller.ts:408-414), so tablets and landscape phones get none. Implement: enable `input: { gamepad: true }` and add a small input aggregator that updateMovement reads, since it currently ORs cursors/wasd/touch at movementController.ts:400-426. Map: d-pad plus left stick (deadzone 0.35) for move; A/Cross = jump (held state for variable height, edge for press); X/Square = slash; Y/Triangle or RB = shoot; Start = restart; Select = stop. Combat input at OverworldPlayScene.ts:2365-2366 needs the same aggregation. Add keyboard R → restartCurrentRun when mode === 'play' and no chat/comment input has focus. Use edge detection for pad buttons so they behave like JustDown.

**Evidence.**

- src/main.ts:97-101 — input config only sets mouse.preventDefaultWheel; no gamepad
- src/scenes/OverworldPlayScene.ts:2670-2692 — only arrows/WASD/Q/E/9/ESC are bound
- src/scenes/OverworldPlayScene.ts:2322-2324 — restart only via consumeTouchAction('restart') (plus a HUD button)
- src/ui/mobile/controller.ts:408-414 — touch controls require deviceClass === 'phone' && portrait

**Fact-check (confirmed).**

These are small corrections; the core claim stands.
1. **More keys are bound than the claim says.** `createCursorKeys()` (OverworldPlayScene.ts:2673) also binds Space and Shift, and Space is jump (movementController.ts:422-426). Keyboard already has a "stop" key: P/Esc return to the world via inspectInput.ts:62-63,115-118. So Select=stop only matches an existing key; it adds no new ability.
2. **"Instant" restart is only instant for single rooms.** For an expanded room (course run), restartCurrentRun shows a busy overlay and re-runs `startCoursePlayback` (flow.ts:216-231). An R key there won't feel instant unless the course is reset locally. Room Rush and PvP take separate paths (OverworldPlayScene.ts:5699-5709). The R handler should call scene.restartCurrentRun() and skip when a chat or comment input has focus, like the T/C handlers do (sceneCommands.ts:84,114).
3. **The tablet gap is a separate issue.** Tablets (shorter edge >540px, deviceLayout.ts:41-42) and landscape phones have no touch controls at all (controller.ts:408-414). That deserves its own fix, such as extending portraitPlayControls to tablet/landscape layouts. Gamepad support only helps the few tablet users who have a controller.
4. **More inputs need routing than the claim lists.** movementController.ts:410-421 also uses edge-triggered up/down/left/right presses (JustDown) for ladders and crates. The gamepad aggregator has to provide those edges too, plus the camera toggle (key 9).

### F089: Mobile smoke uses Chrome only, isn't in CI, and enshrines the missing landscape controls

- **Area:** Mobile experience (code review)
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** The automated phone test runs in desktop Chrome pretending to be an iPhone, so it can't catch iPhone-specific problems like input zoom, Safari toolbars or sound rules. It only runs by hand, never tests tablet play or the keyboard, and currently checks that landscape has no controls.

**Technical detail.**

scripts/mobile_smoke.mjs:3 imports only `chromium` and fakes an iOS UA (:20-38). It isn't wired into `npm run check` (package.json:8) or .github/workflows/quality.yml, and it needs a live API (docs/development/mobile-testing.md:9-21). Add a Playwright `webkit` run of the same scenarios (Playwright WebKit implements visualViewport and touch). New scenarios: (a) tablet portrait and landscape Play Room expects controls, (b) phone landscape play expects controls or a rotate prompt, (c) 'keyboard' simulated by focusing #chat-input and shrinking the viewport height, asserting data-orientation-state stays 'portrait' and no input is under 16px, (d) a tap-target audit (every visible button ≥40×40). Run a stubbed-API variant in CI using the existing preview-smoke hooks (src/main/previewSmoke.ts) so layout regressions fail before deploy.

**Evidence.**

- scripts/mobile_smoke.mjs:3 — only chromium is launched
- scripts/mobile_smoke.mjs:20-38 — iOS/iPad user agents on a Chromium engine
- scripts/mobile_smoke.mjs:741 — asserts portrait controls hidden in phone landscape play
- package.json:8 — check script excludes smoke:mobile

**Fact-check (partially confirmed).**

(1) A Playwright `webkit` run would not catch the iPhone-specific problems the summary names. Playwright WebKit is desktop WebKit (WPE/GTK on Linux CI, a WebKit build on mac). It does not reproduce iOS Safari's auto-zoom when an input under 16px is focused, Safari's collapsing toolbars and safe-area behavior, or iOS audio-unlock rules. It catches WebKit CSS/JS engine differences. The '<16px input' check in scenario (c) is a computed-style check that works the same in Chromium. Real iOS behavior still needs a real device or a cloud real-device service. (2) The existing preview-smoke hooks do not stub the API. src/main/previewSmoke.ts has synthetic editor actions (openSyntheticEditor etc., :115-137). But the play scenarios use selectEditableRoom/playSelectedRoom (:88-90), which need world rooms loaded from the live API (mobile_smoke.mjs:909-915). A CI variant needs new Playwright `page.route` fixtures for the world/room endpoints. quality.yml also needs a step to install Playwright browsers and start a preview server (it currently runs `npm ci --ignore-scripts`). (3) Minor: the smoke does set isMobile/hasTouch (mobile_smoke.mjs:159-160), so touch is emulated, not missing. Changing the landscape assertion should follow a product decision on landscape and tablet controls. That decision is the real defect, and it belongs in a separate finding.

### F090: Haptic feedback on Android for jump, hit, coin and goal

- **Area:** Mobile experience (code review)
- **Type:** idea · **impact:** low · **effort:** small

**Summary.** Touch buttons give no physical feedback, so jumps feel mushy compared with a real controller. A tiny buzz on landing a hit, taking damage, grabbing a coin or clearing a goal adds a lot of game feel on Android phones. It's cheap, and should have an off switch in Settings.

**Technical detail.**

There are no navigator.vibrate calls anywhere in src. Add a small haptics module (guard `'vibrate' in navigator`; iOS Safari has no Vibration API) with patterns: jump 8ms, stomp/hit 15ms, damage [20,30,20], goal clear [30,40,60]. Fire it from the existing SFX cue points so it stays in sync (the callers of playSfx). Gate it on coarsePointer, a new userSettings.haptics boolean (default on), and document.visibilityState. Optionally pulse on pointerdown of #btn-mobile-jump (portraitPlayControls.ts:156-162) for button-press confirmation.

**Evidence.**

- src/ui/mobile/portraitPlayControls.ts:156-162 — jump pointerdown handler (natural hook)
- src/audio/sfx.ts:486-505 — central play() path where cue events could also trigger haptics

**Fact-check (confirmed).**

Change where it hooks in: don't put haptics in SfxManager.play() (src/audio/sfx.ts:483). That path also plays ui-hover, ui-click, footstep, chat-send and chat-receive, so it would need an allowlist. Also, anything placed after the muted return at line 502 would switch haptics off whenever sound is muted. Call a haptics helper directly from the gameplay effect methods in src/fx/controller.ts (enemy kill/stomp, bounce, goal success and fail) and from the player-hurt and death sites. Leave land and footstep out, and consider leaving out jump or making it very light (about 5ms), because a buzz on every jump gets tiring. Watch where the setting is stored. GameSettings (src/settings/model.ts:5-12) is synced to the server, and the worker runs it through normalizeGameSettings (src/cloudflare/worker/userSettings/store.ts:43 and routes.ts:44), which drops unknown fields. A new `haptics` field therefore only survives a sync if normalizeGameSettings is updated and the worker is redeployed. The alternative is a per-device localStorage flag, which suits a feature that only applies to some devices anyway. One more catch: Chrome blocks navigator.vibrate inside cross-origin iframes, so this does nothing when the game is embedded, for example in mann.cool's console wrapper. Only first-party play on wamp.land gets it.

### F091: mann.cool plays tracking and virtual-controller listener are missing (and the stock snippet wouldn't work with Phaser)

- **Area:** Mobile experience (code review)
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** The standing Game A Day rules ask every game to report a play to mann.cool and to accept the mann.cool on-screen controller. WAMP does neither. mann.cool currently just links out to wamp.land, so nothing is broken today, but play counts aren't tracked.

**Technical detail.**

No fetch to https://mann.cool/api/plays exists and there's no window 'message' listener for {type:'keyEvent'} (grep of src/index.html finds only websocket message listeners in presence/roomChat.ts:274, worldPresence.ts:468, instanceClient.ts:109). Add the plays POST once after boot (slug 'wamp', source 'direct', or 'mann.cool' when document.referrer matches). If WAMP is ever iframed, don't use the AGENTS.md snippet as-is: Phaser 3.90's KeyboardPlugin dispatches on event.keyCode (node_modules/phaser/src/input/keyboard/KeyboardPlugin.js:747), and a synthetic `new KeyboardEvent(type,{key,code})` has keyCode 0, so Phaser ignores it. Route messages straight into an input-source module (setTouchMove/pressTouchAction-style state, or the gamepad source above) and check event.origin === 'https://mann.cool'. public/_headers sets no X-Frame-Options, so framing would work.

**Evidence.**

- src/presence/roomChat.ts:274 — only 'message' listeners are WebSocket handlers; no postMessage keyEvent listener in src
- node_modules/phaser/src/input/keyboard/KeyboardPlugin.js:747 — Phaser keys on event.keyCode
- public/_headers:1-5 — no frame-blocking headers

**Fact-check (partially confirmed).**

WAMP does track plays and visits, through its own system: src/analytics/guestActivity.ts heartbeats and src/analytics/replay, both started from src/main.ts:1-7. What's missing is only the cross-game POST to mann.cool/api/plays that AGENTS.md asks for. mann.cool's WAMP spotlight card links out in a new tab (target=_blank) and WAMP is not in mann.cool's iframe games array. So the keyEvent listener is speculative work that only matters if WAMP is ever iframed; it is not a current mobile gap, because WAMP has native touch controls in src/ui/mobile/. If the listener is ever added, routing messages into touchControls.ts (setTouchMove/pressTouchAction) with an origin check is the right approach. A smaller patch would be to set keyCode in the synthetic KeyboardEvent's init dictionary, which major browsers accept as a legacy field. Better category: project integration/analytics, not mobile.

### F108: Room card: 'Play Room' isn't the main button, and buttons that can't be used crowd it out

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Already in the product backlog.**

**Summary.** When you select a room, 'Play Room' is a small green chip the same size as Room Rush, Edit Room and two grey disabled buttons (Build Here, Expand Room) that rarely apply. On phones the disabled Build Here takes a third of the row, while the room's goal and best time are hidden. Make Play the big obvious button, show only the actions that make sense, and say in plain words why something is locked.

**Technical detail.**

hudViewModel.ts:503-527: Play, Edit, Build and Expand are only ever disabled, never hidden. Build (enabled only when state==='frontier', :527) and Edit (enabled only for published/draft/claimed, :525) can never both be enabled, so one slot is always dead. Expand is enabled only for the owner of a published room (:291-293). Disabled reasons exist only as `title` tooltips (:283-305, applied in hud.ts:645-647). Touch screens never show them, and tapping a disabled button only plays the 'ui-disabled' buzz (buttonFeedback.ts:57). 'Play Expanded Room' is hard-coded hidden (:497). `.world-hud-row-secondary-actions` is an empty row (index.html:1874-1875) that adds a 12px gap. The card shows a 2-decimal zoom readout (index.html:1849, hudViewModel.ts:472) that repeats the footer's zoom label (index.html:2019). On phones the card hides #world-selected-goal, #world-leaderboard and #world-selected-meta (phone-world-chat.css:39-48) but keeps the disabled Build Here in the 3-column grid (:117-133). BEFORE: brand row, title, creator, coords, meta, warp input, zoom, then 5 equal 11.5px chips. AFTER: title / 'by creator' / goal line / best time, then one full-width PLAY ROOM (SMB 16px, 44px tall, green). Second row: one context-dependent build button ('Build Here' on a frontier, 'Edit Room' when editable, hidden otherwise) plus Room Rush. A '⋯' overflow menu holds Expand Room, History, Share and Rate. A locked state shows one line of reason text (e.g. 'Minted: only the owner can edit') instead of a dead button. Move the 'We All Make A Platformer / BETA' brand row and the zoom label out of the card. On phones, keep the goal and best-time lines and drop the disabled buttons. This also covers backlog G-002 (direct-link play affordance).

**Evidence.**

- src/scenes/overworld/hudViewModel.ts:525-527 — editButtonDisabled / buildButtonDisabled are mutually exclusive states but both buttons always render
- src/scenes/overworld/hudViewModel.ts:283-305 — lock reasons only become button title tooltips (hud.ts:645-647)
- src/scenes/overworld/hudViewModel.ts:497 — playCourseButtonHidden: true (permanently dead button)
- index.html:1850-1885 — 8 primary + 8 tertiary buttons all class 'bar-btn bar-btn-small'; empty secondary row at 1874-1875
- src/styles/sections/responsive/phone-world-chat.css:39-48 — phone hides goal, best time and meta but not disabled Build Here
- headless render of production CSS at 1280x800 and 390x844: scratchpad/shots/world-desktop.png, phone-world.png

**Fact-check (partially confirmed).**

Six details in the claim are wrong or overstated:
1. 'Play Expanded Room' is not a dead button crowding the card. playCourseButtonHidden is always true (hudViewModel.ts:497), so it is never shown. It is dead code, not visual clutter.
2. On phones the row is 3 buttons, not 5. Room Rush and Expand Room are hidden by default (phone-world-chat.css:46-47) and only appear behind 'More +' (:137-140). Showing Play, Edit and Build Here on phones was a deliberate, shipped choice (feature-ledger.md:63, 'Compact mobile HUD'). The phone criticism is therefore about the Build Here and Edit slots, plus the hidden goal and best time.
3. Some lock reasons do appear outside tooltips:
   - On desktop, a frontier room blocked by the daily claim limit shows the reason in the meta line (hudViewModel.ts:351-356). That line is hidden on phones.
   - Minted rooms have a lock icon next to the title that you can tap or focus to open an explanation (index.html:1754-1767; hud-goals.css:383-384 :focus-within). That works on touch.
4. On desktop the buttons are not equal-sized. They share the 11.5px font but are sized to their text in a wrapping flex row (hud-goals.css:179-184).
5. The initial HTML label is 'Expanded Room Builder'. The view model changes it to 'Expand Room' at runtime.
6. The proposed '⋯' overflow menu for History, Share and Rate is new UI. It does not reorganise existing card buttons: History and Share are not on this card today, and Rate is in the tertiary row.

### F119: Error and empty messages are dead ends, and a few were written for developers

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** About 170 messages read 'Failed to…' or 'Could not…' with no next step, and empty lists say 'No X yet.' without offering anything to do. Some player-facing lines are leftover developer notes: the Controls window ends with 'Custom control remapping can layer onto this later without changing the basic world HUD.', and phone builders are told to 'right-click'. Friendlier wording plus a button turns these moments into the next action.

**Technical detail.**

There are 172 string literals starting 'Failed'/'Could not'/'Unable'/'Error' in src/ui, src/scenes and src/auth, e.g. 'Failed to save room draft', 'Failed to load leaderboards', 'Failed to send chat message.'. Empty states with no call to action: 'No ranked clears yet.' (×4), 'No claimed published rooms yet.', 'No public playlists yet.', 'No signatures yet.'. Developer copy shown to players: index.html:2933. Desktop-only hints shown on phones: index.html:667 and uiBridge.ts:2219. The Controls modal (index.html:2890-2933) shows keyboard keys first even on phones and mixes a setting into the key table ('Settings | Choose Option-drag…'). Proposal: (1) a copy helper friendlyError(action, {retry}) producing e.g. 'Couldn't save your room. Your draft is safe in this browser. [Try again]'; (2) one empty-state component with icon + one line + call-to-action button: leaderboard 'No one has cleared this yet. Be first! [Play Room]'; profile 'No rooms yet. [Find a spot to build]'; guestbook 'Be the first to sign!'; (3) in the Controls modal, show the section matching data-coarse-pointer first and delete the developer line.

**Evidence.**

- index.html:2933 — 'Custom control remapping can layer onto this later without changing the basic world HUD.'
- index.html:667 — 'Right-click or Erase removes them.' (also src/scenes/editor/uiBridge.ts:2219)
- grep: 172 'Failed…/Could not…/Unable…/Error…' literals across src/ui, src/scenes, src/auth
- src/ui/setup/leaderboardModal.ts — 'No ranked clears yet.' empty state with no CTA

**Fact-check (partially confirmed).**

About 93 player-visible "Failed/Could not" strings, not 172; the rest are console logs and thrown errors. Most of the 93 are fallbacks behind the server's own error message. World-load and editor-open failures already have Retry buttons (appFeedback.ts showBusyError/showBootFailure), and guest draft-save failures already save locally. The remaining problems are real but narrower:
- the leftover developer line at index.html:2933;
- player-facing "Check the console" text at windowController.ts:374/376;
- the Controls modal shows the keyboard sections before Mobile on phones, with a settings row mixed into the key table;
- "Right-click" and "Control+Click" hints (uiBridge.ts:2219, index.html:679) are shown on phones, where the dock shell is off and its beginner-mode hint-hiding rule never runs;
- the profile Levels and Playlists empty states (index.html:2491, 2509) have no "Build a room" or "Create playlist" button.

"No ranked clears yet." lives in runRatingModal.ts and goalRuns.ts, not in leaderboardModal.ts. Do not promise "your draft is safe in this browser" for signed-in save failures, because those drafts are not saved locally.

### F115: Four dialogs still use the old dark theme

- **Area:** Visual design, UI polish & information architecture
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Sign Text (where builders type sign messages), Choose Avatar, Chat Moderation and the phone 'Warp To Room' sheet still use the old rounded, dark, typewriter-font style, while every other popup is cream pixel-art paper. The avatar picker even puts a cream card inside a dark box. Making the pixel style the default for every popup fixes these four and any future ones.

**Technical detail.**

The base .history-modal-panel (room-course.css:22-33) is still dark: rgba(11,11,11,.96) background, 1px --border-strong, 8px radius, soft 18px/48px shadow. The cream skin is opt-in through per-ID allowlists: shared-modal-skin.css:1-21 (#leaderboard/#explore/#profile/#editor-music-phrase-save), room-course.css:15-17 and 35-36 (#room-history/#room-rush/#room-rush-result), plus about 10 more per-panel copies. Modals with no override: #sign-text-modal (profile-sign.css:105-138 even gives its textarea a 10px radius and a dark rgba(10,12,16,.92) fill); #avatar-picker-modal (profile-avatar-picker.css:82-84 sets only width, while its .profile-cryptopunk-card inside is cream); #chat-moderation-modal (controls-about.css:236-252: translucent dark sections, 8px radius); #mobile-jump-sheet (bars-buttons.css:25-27; on phones it fills the screen with 'Close' above the input). All four were checked by rendering the production CSS headless. Fix: move the cream recipe into the base .history-modal-panel, -kicker, -title (SMB NES 16px), -meta, -error and the header .bar-btn rules. Delete the per-ID copies (~300 lines). Restyle the sign textarea as a paper field with a 2px ink border. In the warp sheet, put the input and a primary Warp button first and move Close into the header as a ghost button.

**Evidence.**

- src/styles/sections/modals/room-course.css:22-33 — base modal panel is the dark legacy skin
- src/styles/sections/modals/leaderboard-profile-explore/shared-modal-skin.css:1-21 — retro skin applied by ID allowlist
- src/styles/sections/modals/profile-sign.css:122-131 — sign text input: 10px radius, dark fill, IBM Plex
- src/styles/sections/modals/controls-about.css:244-252 — chat moderation dark translucent sections
- src/styles/sections/modals/leaderboard-profile-explore/profile-avatar-picker.css:82-84 — avatar picker panel has no skin
- renders: scratchpad/shots/modal-sign-text.png, modal-avatar-picker.png, modal-chat-moderation.png, modal-mobile-jump.png

**Fact-check (confirmed).**

Narrow the effort and impact. Adding the four IDs to the existing cream rules and restyling the textarea, the chat moderation sections and the order of the warp sheet is small. The proposed consolidation (moving cream into the base .history-modal-panel and its title, meta, error and button rules, then deleting about 300 lines of per-ID copies) is a medium job. The base rules and many inner elements, such as .leaderboard-difficulty (leaderboard-base.css:22-30, rgba(12,13,18,.64)) and the var(--text) light text colours, assume a dark background, so changing the default needs a visual check of every modal. Impact is mostly cosmetic consistency. Chat Moderation is admin-only, and Sign Text, Choose Avatar and the phone warp sheet are the dialogs players and builders actually see. Do the targeted fix first and the consolidation second.

### F116: Stacked popups: one Esc closes everything, and the screen goes nearly black

- **Area:** Visual design, UI polish & information architecture
- **Type:** defect · **impact:** low · **effort:** small
- **Flagged before:** docs/2026-07-13-code-health-and-performance-recommendations.md §1.4 (modal framework owning backdrop/escape/focus) — helper extracted but only 5 of 24 modals use it and it has no stack awareness; docs/2026-06-10-repo-improvement-plan.md §4.2 (stop growing index.html) — index.html grew 155KB→198KB since

**Summary.** From the Leaderboard or Explore, tapping a player's name opens their Profile on top. Pressing Esc then closes both at once, so you lose your place. The two 80% dark backdrops also stack to about 96% black. A small 'popup stack' would close only the top popup and dim the screen only once.

**Technical detail.**

leaderboardModal.ts:117-123, exploreModal.ts:98-103 and profileModal.ts:162-177 each register a document-level Escape handler that checks only its own hidden state. All attach at init (leaderboardModal.ts:200, exploreModal.ts:171, profileModal.ts:300), so one keydown closes every open modal. The profile opens through a window event and neither closes nor tracks the modal that opened it (profileEvents.ts:20-31, profileModal.ts:404-420). Backdrops are rgba(24,22,28,.8) in .history-modal (room-course.css:3-13) and again per ID (shared-modal-skin.css:1-7). Every modal sits at z-index 40, so stacking depends on DOM order. Fix: give modalLifecycle.ts a module-level stack. show() pushes, hide() pops, and Escape/backdrop handlers act only on the top modal. Non-top modals get a transparent backdrop, and the top one gets z-index 40+depth. Return focus to the element that opened the modal on close. Then move the ~19 hand-rolled modals onto createModalLifecycle; today only 5 use it (performanceSuggestion, roomGoalIntro, playlistIntro, controls, about). Related unfinished item: the 2026-06-10 plan §4.2 rule 'new UI never adds to index.html' still isn't followed. index.html has grown from 155KB to 198KB and from 711 to 786 ids, still with 0 <template> elements.

**Evidence.**

- src/ui/setup/leaderboardModal.ts:117-123 — Escape closes leaderboard if open (document listener, :200)
- src/ui/setup/profileModal.ts:162-177 — Escape closes profile if open (document listener, :300)
- src/ui/setup/profileEvents.ts:20-31 — profile open is a global event; opener stays open
- src/styles/sections/modals/room-course.css:3-13 + shared-modal-skin.css:1-7 — 0.8 backdrop per modal, all z-index 40
- src/ui/setup/modalLifecycle.ts:1-59 — lifecycle helper has no stack; grep shows 5 adopters

**Fact-check (partially confirmed).**

1. **CSS path:** shared-modal-skin.css lives at src/styles/sections/modals/leaderboard-profile-explore/shared-modal-skin.css:1-7, not src/styles/sections/modals/shared-modal-skin.css.
2. **index.html baseline:** the 2026-06-10 plan recorded 151KB and 711 ids (docs/2026-06-10-repo-improvement-plan.md:11,317), not 155KB. It is now 198KB with 786 ids.
3. **Explore stacks only from room cards.** The Builders tab rows close Explore before opening the Profile (exploreModal.ts:505-508). Explore stays open underneath only when you tap the "By <builder>" name on a room card (exploreModal.ts:907-914).
4. **Missed symptom:** from Leaderboard, open a Profile, then tap one of its rooms. The Profile closes and the camera jumps to that room (profileModal.ts:1298-1300), but the Leaderboard stays open over the new room. A modal stack (or closing the opener) fixes this too.
5. **Escape on mobile:** Escape closing everything is a desktop/keyboard issue. A mobile backdrop tap closes only the top modal, because the handler checks event.target === modal.

The proposed fix still holds: a module-level stack in modalLifecycle.ts with top-only Escape and backdrop handling, z-index of 40+depth, a transparent backdrop on modals that are not on top, and focus returned to the opener.

### F118: Show the room name and builder when you run into a new room

- **Area:** Visual design, UI polish & information architecture
- **Type:** idea · **impact:** medium · **effort:** small

**Summary.** WAMP's magic is that every room is someone's creation, but while playing, crossing into a new room shows nothing; the room card has already shrunk to a Stop button. A 1.5-second pixel banner as you enter each room ('LAVA LEAP GAUNTLET, by pixelpal ★4.2') would celebrate builders, help players remember rooms they liked, and make the world feel like a journey.

**Technical detail.**

roomTransition.ts (701 lines) shows nothing when you cross into a room: no status text, SFX or FX. In desktop play the HUD hides everything except the active primary button (hud-goals.css:202-216), and the goal panel shows a title only for goal rooms. Build it as a DOM banner rather than Phaser text so the canvas stays cheap. Reuse the cream .world-sign-panel style, top-center: SMB 16px title, HomeVideo 10px 'by name' line, slide in with steps(6), auto-hide after 1.6s. Trigger it from setCurrentRoomCoordinates when the room id changes in play mode. Throttle it so running back and forth across a border doesn't repeat it, and add a 'first visit' sparkle. Show a compact version or none during Room Rush and ranked timers. Outside a run, tapping the banner opens the creator's profile. Optionally add a 'rooms discovered' counter feeding Curator XP. Not in backlog.md or ideas-inbox.md.

**Evidence.**

- src/scenes/overworld/roomTransition.ts — no presentation/status/sfx calls on room change (grep)
- src/styles/sections/world/hud-goals.css:202-216 — play mode hides all HUD except primary action
- src/styles/sections/world/hud-goals.css:500-540 — existing .world-sign-panel paper style to reuse

**Fact-check (partially confirmed).**

Build it without the star rating; it isn't in WorldRoomSummary and would need payload or API work. Show title (falling back to 'Room x,y') plus 'by creatorDisplayName' and, if set, world.name. Trigger it from roomTransition.ts after setCurrentRoomCoordinates (around line 211), keyed on the expanded-room id or room id rather than raw cell coordinates. Suppress or compact it during course runs, Room Rush and PvP arenas. Note that landscape phones already show the title and creator in the always-open play HUD (phone-world-chat.css:93-115, controller.ts:455-457), so the banner matters most for desktop and portrait phones. Don't feed a 'rooms discovered' counter into Curator XP: the PRD reserves CXP for curation that helps others, and passive visits can be farmed.

### F112: Menus are grouped by history, not by what players need next

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** Global things (Explore, Leaderboard, Worlds) live inside the per-room card. System things (Settings, Guestbook, Controls) take up the bottom bar, even mid-run. The hamburger menu mixes About/Discord, sign-in, Log out, a second display-name editor and moderator tools, but has no link to your Profile or Settings. Regroup into: room card = this room; bottom bar = places to go and people; menu = you and the game.

**Technical detail.**

Hamburger (index.html:161-213): 'About WAMP' is the first, full-width button. Then come Discord, Chat Moderation, email/wallet sign-in, and a red Logout placed above the Display name editor. That editor duplicates the profile modal's own (index.html:2473). Then Reset Test Data, and the explainer 'Use email, wallet, or both.' sits after the buttons (:208). Signed-in users see both 'Signed in.' and 'Signed in as…'. Guests get no reason to sign in. Bottom bar (index.html:1991-2013): Settings/Guestbook/Controls are .world-only-control, which also displays in play-world (bars-buttons.css:226-229), so they and the zoom −/+/Fit buttons stay under the player during runs. The room card's tertiary row (index.html:1876-1885) holds global navigation: Worlds/Explore/Leaderboard. Proposed layout: (1) Room card = room-only actions (see the Play finding). (2) Bottom 'go' strip = Explore · Worlds · Leaderboard · Chat · N online · Warp; during play hide everything except Chat. (3) Hamburger = 'You & WAMP'. Guest header: 'Sign in to save rooms, earn XP and chat', then email field + Sign In as the primary button, with 'Use a wallet instead' as a link. Signed-in header: identity card, then Profile, My Rooms, Settings, Controls, Guestbook, About, Discord, with Log out last as a small danger button. Moderation goes in a separate Admin group. Remove the duplicate display-name row; the profile owns it.

**Evidence.**

- index.html:161-213 — #menu-body order: About, Discord, Chat Moderation, email, wallet, Logout, display name, reset, status
- index.html:199-201 vs index.html:2473 — display name editable in both hamburger and profile modal
- index.html:1991-2013 — Settings/Guestbook/Controls in bottom bar
- src/styles/sections/world/bars-buttons.css:226-229 — world-only-control also visible in play-world
- index.html:1876-1885 — Worlds/Explore/Leaderboard inside the selected-room card
- headless renders: scratchpad/shots/auth-menu-guest.png, auth-menu-signedin.png, play-desktop.png

**Fact-check (partially confirmed).**

1. Profile is already one tap from the hamburger via the #auth-identity mini-profile card (index.html:108; auth/client.ts:231-245). Adding Profile to the menu is a nice-to-have, not a missing link.
2. The hamburger display-name row only appears for signed-in users with no saved name (auth/client.ts:1093). Keep it as a first-run prompt (or move it into the profile flow) rather than calling it a duplicate editor.
3. The "Signed in." status is not real. Only a transient "Signed in with email." (client.ts:631) can briefly show next to "Signed In As…"; the generic statuses are suppressed (client.ts:1291-1297).
4. Leaderboard opens on the selected room's tab by default (index.html:2178), so it can stay on the room card. Only Explore and Worlds are purely global.
5. Reset Test Data is gated by testResetEnabled and never shows in production.
6. The crowded footer during play applies to desktop, tablet and phone landscape. Phones already hide zoom/Fit (phone-chrome.css:76-81), and portrait focused-room play hides the bottom bar entirely (phone-portrait-world-hud.css:21-23).
7. The stronger point: on phones, Explore, Worlds and Leaderboard are hidden behind the room card's More/details toggle (phone-world-chat.css:45, 142). Moving Explore and Worlds into a persistent "go" area matters most there.
8. A footer that shows only Chat (or chat + online count) during desktop play is a small CSS change on its own.
9. The footer layout was deliberately restored or tuned recently (progress.md:26; feature-ledger.md:63), so any change should update the editor-dock and mobile smoke assertions.

### F114: No real primary/secondary/danger buttons: red means Build, Publish, Stop and Delete

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** Buttons get their color from where they sit, not from what they do. The same red is used for Build Here, Publish, Stop, Log out and the 'nuke' eraser, while Play, Room Rush, Edit and Comments are all the same small size. Players can't tell at a glance which button is the main action and which is dangerous. Use one button component with a few clear variants that match WAMP's existing XP colors.

**Technical detail.**

The base .bar-btn (bars-buttons.css:130-146) is still the old dark IBM Plex pill (3px radius, --panel-2 background). Each surface then restyles it by container ID: 198 selectors contain `.bar-btn`, e.g. shared-modal-skin.css:96-118 lists 10 contexts, #explore-modal filters/sorts use 22, #run-rating-modal 15. There are 77 distinct *-btn/*-button classes. Red #ed5f4b is used for Build Here (bars-buttons.css:284-288), Stop (:241-245), Publish (dock-shell.css:241-244), Logout and Reset (base.css:1034-1038), the Erase 'nuke' (dock-shell.css:422-427) and the frontier badge (hud-goals.css:316). Yellow is shared by Edit Room and Comments, and Room Rush uses an off-palette #faaa39. The XP lanes already form a semantic palette: player = green #277b30, builder = yellow #fcea7c, curator = blue #79ccde (base.css:615-625, hud-goals.css:62-72). Proposal: one `.btn` with data-variant play | build | curate | neutral | danger and data-size sm | md | lg. play = green (Play, Test, Restart, and Publish as the builder's large primary). build = yellow (Edit, Build Here, Expand). curate = blue (Explore, Leaderboard, Rate, Comments). neutral = paper (Close, Cancel, Back). danger = red, reserved for Stop, Log out, Delete and Nuke. lg = 44px tall with SMB 16px text, used for the one main action per surface. Map old classes to variants and delete each surface's ID-scoped overrides as it migrates.

**Evidence.**

- src/styles/sections/world/bars-buttons.css:130-146 — base .bar-btn still legacy dark/IBM Plex
- src/styles/sections/world/bars-buttons.css:284-288 — Build Here uses --hud-trial-red
- src/styles/sections/editor/dock-shell.css:241-244 — Publish uses --editor-retro-red
- src/styles/sections/base.css:1034-1038 — Logout / Reset Test Data use the same red
- src/styles/sections/editor/dock-shell.css:422-427 — eraser 'nuke' button same red
- src/styles/sections/modals/leaderboard-profile-explore/shared-modal-skin.css:96-118 — 10-selector ID allowlist restyling .bar-btn

**Fact-check (partially confirmed).**

1) A danger variant already exists as `.bar-btn-danger` (bars-buttons.css:183-190) and is already in the markup for the nuke and clear buttons, Delete, Reset Test Data and chat ban. The real defect is that per-surface overrides give it the same red as primary or creative actions (Build Here, Publish). The migration should start by making `bar-btn-danger` the only red, not by inventing a new danger class. 2) The world HUD already roughly follows the proposed play=green / build=yellow / curate=blue scheme (bars-buttons.css:230-300). The outliers are Build Here (red), Comments (a different yellow, #ffd65a, at room-comments.css:52-56, while Edit uses #fcea7c) and Room Rush. 3) Room Rush's #faaa39 is not off-palette. It is WAMP's established orange, used in share cards and map screenshots (social/roomRushShare.ts:37, mapScreenshot/infoOverlay.ts:64, player/avatar/registry.ts:43), and comes from the super-colorful palette that design-ideas.md:4 references. 4) Per-modal counts depend on how you count: I get 29 lines matching `#explore-modal … .bar-btn` and 18 for run-rating, versus the claimed 22 and 15. This is not material. 5) Link this to open backlog item G-002 (direct-link Play affordance, High priority). The 'lg primary' part of the proposal partly delivers it, so in_backlog should be partially true. Recommended scope: first pass on the world HUD and editor top bar (re-colour Build Here, unify Comments yellow, add an lg size for Play/Publish), then migrate the modals one at a time.

### F117: Pixel fonts are drawn at in-between sizes, so they look blurry

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** The game's pixel fonts are built on fixed grids: the Mario and Game Boy fonts on an 8-pixel grid, HomeVideo on a 20-unit grid. Most text uses sizes like 11, 12, 13, 19 or 21px, which forces the browser to blur the pixels into grey edges. Snapping to a few 'crisp' sizes makes every title and label sharper at no cost.

**Technical detail.**

Checked the font files with fontTools. Early GameBoy and Super Mario Bros. NES are 8px per em (upm 1024, coordinate gcd 128). HomeVideo-Regular is 20px per em (upm 1000, gcd 50). Declared sizes: SMB NES appears in 39 rules and only 5 use on-grid sizes (16/24/96). The other 34 use 10, 11, 13, 14, 15, 18, 19, 20, 21 or 22px, e.g. modal titles at 19px (shared-modal-skin.css:61-62) and .world-room-title at 18px (hud-goals.css:141-146). Early GameBoy: 13 of 47 rules are off-grid (7, 9, 10, 11, 12px). HomeVideo: 53 rules at 11px, 46 at 12px and 17 at 13px; it is only crisp at 10px on 2x screens, or at 20px. A zoomed render confirms SMB at 19px has grey antialiased edges where 16px is solid. The CSS uses 27 distinct font-size values. Proposal, applied with the token codemod: --type-label 8px Early GameBoy; --type-body 10px HomeVideo, or 20px for emphasis; --type-title 16px SMB; --type-hero 24px SMB; phone minimum 8px Early GameBoy / 10px HomeVideo. Also add `-webkit-font-smoothing: none` on pixel-font elements for macOS, and use line-heights that are whole multiples of the grid.

**Evidence.**

- public/assets/fonts/*.ttf — fontTools: EarlyGameBoy & SMB NES 8 px/em, HomeVideo 20 px/em
- src/styles/sections/modals/leaderboard-profile-explore/shared-modal-skin.css:61-62 — SMB title at 19px
- src/styles/sections/world/hud-goals.css:141-146 — room title SMB at 18px
- CSS tally: HomeVideo 53×11px, 46×12px, 17×13px; SMB 34/39 off-grid
- render: scratchpad/shots/fonts-zoom.png (SMB 16px crisp vs 19px fuzzy; EGB 8px vs 7px)

**Fact-check (partially confirmed).**

1. The HomeVideo proposal does not work everywhere. 10px is crisp only on exactly 2x screens. At DPR1 it is half a screen pixel per font pixel (75% grey, which is worse than today). At DPR3 it is still 32-40% grey. Only 20px is crisp on every screen, and that is too large for body text. Leave HomeVideo body text at 11-12px as an accepted compromise. The real gains come from SMB titles (snap 18/19/20/21/22 to 16 or 24) and Early GameBoy labels (snap 7/9/10/11 to 8 or 16).

2. On macOS, the default font smoothing adds a grey fringe even at on-grid sizes (default mode: SMB 16px still 16-20% grey). So snapping sizes alone will not look crisp on Macs; it needs -webkit-font-smoothing: antialiased, or none. In my test, none removed all grey at every size, including off-grid ones. This property only affects macOS browsers. It does nothing on iOS, Android or Windows, so size snapping is the only fix that works on every platform.

3. On typical 3x phones the difference is a single device-pixel fringe and is barely visible. The visible benefit is mostly on 1x desktop monitors and on 2x Macs. That makes this low impact against the owner's mobile-first priorities.

4. Corrected numbers:
   - Early GameBoy has about 27 off-grid rules out of 69, not 13 of 47.
   - The CSS uses 32 distinct font-size values, not 27.
   - The 'token codemod' the claim mentions does not exist in the repo.

5. Two more causes the claim missed:
   - Three SMB rules ask for a bold weight that SMB does not have, so the browser fakes the bold and smears the pixels. One of them is .world-room-title at hud-goals.css:147. Fix with font-synthesis: none or by removing the weight.
   - Letter-spacing set in em units on pixel fonts (e.g. 0.02em at hud-goals.css:146) pushes each letter off the pixel grid by a fraction of a pixel. Use whole-pixel letter-spacing instead.

### F113: One retro palette, defined five times and hard-coded 1,433 times

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** low · **effort:** medium

**Summary.** WAMP's look comes from about eight colors (ink, cream, paper, sky blue, deep blue, green, yellow, red). They are typed out by hand more than 1,400 times and defined as five separate token sets with different names. Every new screen re-creates them, which is why some panels drift (a different red, a different ink, a missing border). One shared token file would keep the look consistent and make a re-skin a matter of minutes.

**Technical detail.**

Across 59 CSS files (~17k lines) there are 1,433 hex literals (127 distinct) and 245 rgba() values (145 distinct). Most common: #18161c×428, #fff3db×186, #79ccde×132, #2c5071×86, #277b30×77, #fffaf0×57, #fcea7c×56, #ed5f4b×44. Parallel alias sets for the same values: --editor-retro-* (retro-skin.css:4-13), --course-editor-* (course-editor.css:2-9), --auth-retro-* (base.css:425-430), --hud-trial-* (hud-goals.css:22-26, duplicated at :429-433), --mobile-portrait-console-* (phone-portrait-world-hud.css:7-9) and --world-online-green (online-popover.css:2). :root (base.css:41-75) still holds the pre-retro dark theme: --accent-cool #5dc16b, and --danger #b22222, which differs from the retro red #ed5f4b. var(--border-muted) is used at leaderboard-base.css:27 but never defined. The 'paper panel' recipe (#fff3db background, 3px #79ccde border, 6px 6px 0 #18161c shadow) is pasted 14 times, and the HomeVideo font stack is typed out 133 times. There are 164 !important declarations and 36 distinct z-index values. dock-shell.css:74-78 forces IBM Plex on every <button> while the editor is open (!important), which leaks into modals opened from the editor. Proposal: add src/styles/tokens.css, imported first, with a raw layer (--wamp-ink/cream/paper/sky/sky-deep/green/yellow/red/pink), a semantic layer (--surface-hud, --surface-paper, --text-on-paper), shadows (--shadow-1/2/3 = 2/3/6px hard), borders, fonts (--font-ui HomeVideo, --font-display SMB NES, --font-label Early GameBoy), a 4px spacing scale, and named z layers (--z-hud/popover/modal/toast/critical). Codemod exact hex values to var() (safe because the values are identical). Keep the old alias names pointing at the new tokens for one release, and point the legacy :root vars at retro values. Add a stylelint 'no hex outside tokens.css' rule so it doesn't regress.

**Evidence.**

- src/styles/sections/editor/retro-skin.css:4-13 — --editor-retro-* palette
- src/styles/sections/course-editor.css:2-9 — --course-editor-* (same hexes)
- src/styles/sections/base.css:425-430 — --auth-retro-* (same hexes)
- src/styles/sections/world/hud-goals.css:22-26 and 429-433 — --hud-trial-* declared twice
- src/styles/sections/base.css:41-75 — legacy dark :root theme (--danger #b22222 vs retro red #ed5f4b)
- src/styles/sections/modals/leaderboard-profile-explore/leaderboard-base.css:27 — var(--border-muted) never defined
- src/styles/sections/editor/dock-shell.css:74-78 — global button font override with !important

**Fact-check (partially confirmed).**

Updated figures from the production snapshot: 64 CSS files (~18,010 lines), 1,483 hex literals (143 distinct), 248 rgba() values (145 distinct), 172 !important, 15 copies of the paper-panel shadow recipe. The 133 HomeVideo font stacks are confirmed; note that base.css:66 already defines --hud-ui-font with that exact stack, but it is used only 11 times. The legacy :root block is base.css:38-75.

Drop "missing border" as an example of visible drift. var(--border-muted) at leaderboard-base.css:27 is undefined but dead: shared-modal-skin.css:295-301 overrides .leaderboard-difficulty inside #leaderboard-modal, its only instance (index.html:2167/2191). Just delete the rule.

The "different red" is negligible: var(--danger) has 2 uses and #b22222 appears once. The bigger legacy leftover is --accent-cool #5dc16b, used 23 times across 13 files.

The dock-shell.css:74-78 button-font override was intentional (progress.md:70, commit 29accf94). Describe it as a brittle global selector with !important that has already caused one cascade bug (progress.md:155), not as an unintended leak.

Present this as a maintainability and agent-efficiency improvement, not a fix for drift players can see. Rewrite "re-skin in minutes" as "the core palette becomes changeable in one place".

### F093: Shared room links stack the Welcome modal over the room-goal modal; the run timer ticks under it

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** defect · **impact:** high · **effort:** small
- **Already in the product backlog.**

**Summary.** When a new visitor opens a shared room link (wamp.land/r/x/y), the 'Room Goal → Start' box appears on top of the big Welcome box. After pressing Start, the Welcome box stays over the level while the clock runs. That's the worst possible first impression from a shared link, on desktop and phone.

**Technical detail.**

WelcomeModalController.shouldAutoOpen (src/ui/setup/welcomeModal.ts:235-252) polls until appMode==='world' and no modal is open, then opens. The deep-link autoplay (OverworldPlayScene maybeAutoPlayDeepLinkedRoomOnBoot → flow.ts:149-161 setMode('play') + requestRoomGoalIntro) runs in the same window, so both modals end up visible. Pressing Start only closes the goal intro. Fix: in shouldAutoOpen, return false when hasFocusedRoomCoordinateLink(location) is true or appMode==='play-world', and mark the welcome as deferred (show it after the player's first Stop or clear). Also close the welcome in flow.playSelectedRoom as a safety net. Add a smoke case for a fresh visitor on /r/x/y that asserts exactly one .history-modal is visible.

**Evidence.**

- Live desktop 1440x900, fresh profile, https://wamp.land/r/-5/3: visible modals = ['welcome-modal','room-goal-intro-modal'] (screenshot d-deeplink)
- After clicking #btn-room-goal-intro-start: visible = ['welcome-modal'], goalRun.result='active', elapsedMs=1667, player moved under the modal (screenshot shows timer 0:01.7 behind the welcome)
- Live phone portrait 375x812 on the same URL: visible = ['welcome-modal','room-goal-intro-modal'], mode=play
- src/ui/setup/welcomeModal.ts:235-252 — auto-open only checks appMode==='world' and blocking modals at poll time, with no deep-link check
- Backlog G-002 (direct-link instant play) is the intended experience this breaks

**Fact-check (confirmed, confirmed, partially confirmed).**

The mechanism needs to be stated more precisely. The welcome modal does not open because the two flows happen to run "in the same window". It opens during the boot world fetch and before markAppReady: polling starts from AUTH_STATE_CHANGED, which setupAuthUi fires (main.ts:201, auth/client.ts:1166), and appMode is already 'world' from create() (OverworldPlayScene.ts:2137). After that, the deep-link autoplay starts the goal intro on top of it.

Corrections to the suggested fix:
- The proposed `appMode==='play-world'` guard is redundant, because shouldAutoOpen already requires 'world'.
- The missing guards are `isAppReady()` and a deep-link check. Use `hasFocusedRoomCoordinateLink(location.search, location.pathname)`, since the signature is (search, pathname) and not (location). Alternatively, use hasFocusedCoordinatesInUrl() from navigation/worldNavigation.ts, which also covers world links.
- Also close or defer the welcome in maybeAutoPlayDeepLinkedRoomOnBoot (or playSelectedRoom).
- Optionally treat an open welcome as a pause source in syncScenePauseState.

The reviewer's root cause and fix are slightly off. Waiting for appMode==='world' is not the problem. The welcome already refuses to open in 'play-world' (welcomeModal.ts:244), so adding that check would change nothing. The real gap is that shouldAutoOpen can fire during boot. Polling starts on AUTH_STATE_CHANGED before the app is ready, appMode is already 'world' from create(), and neither isAppReady() nor the boot splash is checked. So the welcome opens while the world is loading, and the deep-link autoplay then stacks the goal intro on top.

Fix:
(a) In shouldAutoOpen, return false when !isAppReady().
(b) Return false when hasFocusedCoordinatesInUrl() / hasFocusedRoomCoordinateLink(location) is true. Defer the welcome until the player first returns to world mode, or until a clear or Stop.
(c) As a safety net, close the welcome (close(false)) in flow.playSelectedRoom, or have RoomGoalIntroModalController.open skip or close the welcome.

Also note that even with the boot race fixed, polling continues indefinitely during play. Without (b), the welcome would pop up the moment a deep-link player presses Stop.

How it happens: the Welcome box does not open "in the same window" as the autoplay, and the appMode check is not missing. Login-status checks during boot start the polling with no isAppReady() gate (welcomeModal.ts:56-58 and 235-252). appMode is already 'world' from create() (OverworldPlayScene.ts:2137), and the boot splash does not count as blocking. So the Welcome box opens behind the splash while the world is still loading. The deep-link autoplay then opens the goal intro on top.

Fix corrections:
(1) "Return false when appMode==='play-world'" is redundant; line 244 already does that.
(2) Checking hasFocusedRoomCoordinateLink(location) on every poll is fragile. flow.ts:159 rewrites the URL to /r/x/y every time a room is played (setFocusedCoordinatesInUrl), so that check would also catch ordinary visitors. Read the deep link once at boot instead, or rely on the gate in (3).
(3) The simplest sound fix is to add `if (!isAppReady()) return false;` to shouldAutoOpen. The autoplay already runs synchronously after markAppReady, so the 540ms timer will then see 'play-world' and wait. The Welcome box naturally appears after the player's first Stop, which is the deferred behavior the reviewer wanted.
(4) As a safety net, have the room-goal intro (or flow.playSelectedRoom, through an event) close the Welcome box without saving it as dismissed. The proposed smoke test (fresh profile on /r/x/y, exactly one visible .history-modal) is sound.

### F122: Signing up throws away a guest's clears, even though the game says 'Save Progress'

- **Area:** New-player experience, retention & community loop
- **Type:** defect · **impact:** high · **effort:** medium
- **Flagged before:** product-requirements.md:95 says 'automatic local-to-account sync are not shipped yet'; guest-room-recovery-design.md:429 Phase 2 claim flow. Both still undone (G-020 covers only part of this).
- **Already in the product backlog.**

**Summary.** When a guest beats a room, the game says "You earned 20 XP. Sign in to save your XP and leaderboard progress" with a "Save Progress" button. Nothing is actually saved. Guest clears only live in the browser, so a guest who signs up starts at 0 XP with no leaderboard entries. This is the most important conversion moment in the game, and right now it breaks a promise. Guests also get no clear celebration during play, and builders never see guest plays.

**Technical detail.**

Guest runs never reach the server. goalRuns.ts maybePromptGuestClaimForLocalClear sets verificationTrace:null and the message 'Guest clear saved on this browser.', then queues requestPostRunGuestClaim. guestRunProgress.ts writes the clear to localStorage 'wamp_guest_run_progress_v1' (max 50 records). Only runRatingModal.ts reads it, to show the '+20 XP' number. Nothing reads it after sign-in. Guest drafts have the same gap: the claim endpoint from the design doc ('Phase 2: Signup Claim Flow') was never built. guestRoomDrafts/routes.ts only has mine/submitted/submit/get/put. Post-sign-in resume depends on a sessionStorage key (guestRoomRecoveryModal.ts:32,49), which a magic link opened in another tab or browser cannot see. Fix: (1) Let guests start and finish runs with X-Guest-User-Id + X-Guest-Recovery-Token. Hash the token as guestRoomDrafts already does. Rate-limit by IP and guest, and store rows in room_runs (or a guest_runs table) with user_id NULL and guest_user_id/guest_token_hash, excluded from leaderboards. (2) Add POST /api/me/claim-guest, called by the client right after any successful sign-in (email code, magic link, wallet) with the guest headers. It re-attributes the guest's runs from the last 14 days (cap 50) and replays awardRoomRunProgression in time order. The existing dedupe keys prevent double awards. It also moves active guest_room_drafts to signed drafts when the coordinates are still frontier, otherwise offers 'pick a new spot'. It returns a summary for an XP receipt like "Welcome! We saved 6 clears (+120 XP)". (3) Give guests the same in-play clear sting signed-in players get (createPostRunClearReward in goalRuns.ts ~1113), not just a modal that waits until they leave play. Interim same-day fix: change the copy to 'Sign in to start earning XP and leaderboard spots' so the game stops overpromising. Mobile: the new 6-digit code keeps sign-in in the same tab, but the claim call must also run on the focus/visibility session refresh (auth/client.ts:550-559) so a magic link opened elsewhere still claims from the original tab.

**Evidence.**

- index.html:2639-2643 — guest-claim copy 'You earned 20 XP' / 'Sign in to save your XP and leaderboard progress' / 'Save Progress' button
- src/scenes/overworld/goalRuns.ts:999-1001 — guest clear computed with verificationTrace: null and submissionMessage 'Guest clear saved on this browser.'
- src/progression/guestRunProgress.ts:3 — guest clears stored only under localStorage key 'wamp_guest_run_progress_v1'
- src/ui/setup/runRatingModal.ts:916-921 — the only consumer: renders 'You earned N XP'; no code migrates these records on sign-in (grep shows no other importer)
- src/cloudflare/worker/runs/routes.ts:80 — run start requires requireAuthenticatedRequestAuth, so guests can never create server runs
- src/cloudflare/worker/guestRoomDrafts/routes.ts:41-115 — routes are mine/submitted/submit/get/put only; no claim endpoint
- docs/features/guest-room-recovery-design.md:429 — 'Phase 2: Signup Claim Flow' (claim endpoint) still unbuilt
- src/ui/setup/guestRoomRecoveryModal.ts:49,155-175 — post-sign-in resume depends on a per-tab sessionStorage key

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

The core defect is accurate. Two corrections:
1. "Guests get no clear celebration during play" is wrong. Guests do get the in-world success effect (objectiveController.ts:411-467: playGoalFx('success'), setRoomNpcsVictorious and the transient status). What they miss is only the reward-sting overlay (createPostRunClearReward at goalRuns.ts:1116), plus the guest-claim modal being held until app mode is 'world' (runRatingModal.ts:358-360). Part (3) of the fix should be framed as "add the XP sting to the guest path", not "add a celebration".
2. "Nothing is actually saved" needs a caveat. The clear is written to this browser's localStorage, as the code's own message says. The problem is that nothing ever reads it back or sends it to the server after sign-in, so the "Save Progress" promise is broken.
Guest drafts are not a total gap either. There is a same-tab resume after sign-in (guestRoomRecoveryModal.ts:90-94 and 155-175) that reopens the draft snapshot in the editor so the signed-in user can publish it. The missing parts are a server-side claim endpoint and a resume that works across tabs. The line references are accurate.

The main point is correct. The "Save Progress" button promises to save XP and leaderboard progress, but guest clears never leave the browser's localStorage, and nothing moves them to the account at sign-in. `loadGuestRunProgress` is never called. Run start requires sign-in (runs/routes.ts:80-86).

Three corrections:
(a) Guests do get an in-play celebration. objectiveController.ts:411-469 plays `playGoalFx('success')`, sets the room NPCs to victorious and shows the completion status text. They only miss the "Room cleared" reward sting card from `createPostRunClearReward` (goalRuns.ts:1116). Reword that fix as "add the reward sting for guests", not "add a celebration".
(b) Holding the claim modal until Browse is deliberate and applies to signed-in players too (feature-ledger.md:25). It is not a guest defect.
(c) Guest drafts are partly handled. After sign-in, guestRoomRecoveryModal.ts:155-175 reloads the draft and opens it in the editor so it can be published. What is missing is the cross-tab/magic-link case and a server-side claim (the design doc's `POST /api/guest-room-drafts/:draftId/claim` at guest-room-recovery-design.md:321 is unbuilt).

On effort: the copy fix is small. Real server-side guest runs and replaying XP at sign-in is medium to large. Guest runs carry `verificationTrace: null`, so they cannot meet the leaderboard's verification rules (runs/routes.ts `requireVerificationTrace`). Claimed runs should therefore earn clear XP only, with no leaderboard rank, or players would get a way around verification.

Correct the impact and the fix scope:
1. Guests DO get an in-play celebration: success FX, victorious NPCs and a status message (objectiveController.ts:411-466). They miss only the XP reward-sting card, so drop "no clear celebration" and say "no XP sting".
2. Guest drafts do resume after a same-tab sign-in through the recovery modal (guestRoomRecoveryModal.ts:90-94, 155-175). The gap is a sign-in in another tab or browser, or a sign-in by any path other than the modal's button, because the auto-prompt is skipped once authenticated (~line 138). There is no server claim endpoint.
3. Split the work. First, a small copy change today, something like "Sign in to start earning XP and leaderboard spots", also changing the promptForSignIn copy at runRatingModal.ts:147 and the "Save Progress" button label. Second, a guest-run claim that requires server-verified guest runs (large: migration, verification, rate limits, a claim endpoint hooked into every sign-in path). Third, the draft claim, which G-020 Phase 2 already tracks.
4. A cheaper interim option: on sign-in, show the guest clears that were never saved, with "Replay to claim" links (data already sits in wamp_guest_run_progress_v1 via the unused loadGuestRunProgress). That avoids trusting unverified localStorage XP.

### F126: Welcome 'Play' runs one room, 'Explore' just closes the window, and 'Build' drops you into an empty room

- **Area:** New-player experience, retention & community loop
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** backlog.md G-001 (starter templates), still not built.

**Summary.** The first-visit choices don't lead anywhere. "Explore" only closes the welcome box; it doesn't open the Explore room list. "Play" starts a single room with no "Next" button and no sense of progress. "Build" opens a blank random room. The game already has playlists and "Play All" sequences, so Play could start a curated 'First Steps' run of 6-8 great rooms ("Room 2 of 8 · Next") that ends with "You beat 8 rooms, sign in to keep your XP."

**Technical detail.**

welcomeModal.ts:60-62: handleExploreClick only calls close(true), even though the HUD's 'Explore' button opens the curated Explore modal. That's confusing naming, and new players land in a raw map. welcomeModal.ts:269-293: Play jumps to the fixed room -11,-6 and calls playSelectedRoom() once. welcomeModal.ts:311-334: Build picks a random frontier room within radius 24 and opens an empty room. The pieces for a guided first session already exist: requestRoomSequenceStart (exploreQueueEvents.ts:15-36) with its Next/Restart HUD (index.html:1860-1862; roomSequenceController.ts:182-200), and playlist share links that autoplay (playlistModal.ts:120-160). Change Play to load a staff playlist (e.g. slug 'first-steps': De Ja Vu 1-3 plus 5 short, highly rated community rooms) and start it as a sequence with forceGoalIntro on the first room. At the end of the sequence, show a summary card whose sign-in CTA becomes honest once guest clears are saved (see the guest-progress finding). Change Explore to open the Explore modal on Featured/Popular with 'Play All' highlighted. Change Build to open Beginner mode with a starter template (backlog G-001, not built) or a pre-placed floor + spawn + exit, so the first Test Play works in under a minute. Add 'welcome_explore' next to the existing 'welcome_play'/'welcome_build' replay actions (analytics/replay/model.ts) and log the choice as a funnel step. Mobile: the sequence HUD already exists on phone; make sure the 'Next' target is thumb-reachable.

**Evidence.**

- src/ui/setup/welcomeModal.ts:60-62 — Explore lane button only closes the modal
- src/ui/setup/welcomeModal.ts:20, 269-293 — Play jumps to fixed coordinates -11,-6 and plays a single room
- src/ui/setup/welcomeModal.ts:311-334 — Build picks a random frontier room and opens a blank editor
- src/ui/setup/exploreQueueEvents.ts:15-36 — requestRoomSequenceStart already supports multi-room play with Next
- src/ui/setup/playlistModal.ts:120-160 — playlists can autoplay as a sequence from a link
- docs/product/backlog.md:45 — G-001 Starter room templates is 'Codex Ready' and unbuilt

**Fact-check (partially confirmed).**

Play does not dead-end after one room. It drops new players at "de ja vu 1" (-11,-6), the first of six tutorial rooms placed side by side going east: -10,-6 through -6,-6 are de ja vu 2-6, with exits near the right edge. Overworld play lets players walk straight into the next room (roomTransition.ts:107-131), and after a clear the guest card offers "Keep Playing".

What's missing is an explicit progress display ("Room 2 of 6", via the existing room-sequence HUD with forceGoalIntro) and a completion summary. The simplest fix is to start the existing de ja vu 1-6 chain as a sequence. A new "first-steps" playlist isn't needed.

Explore only closing the window is intentional (its copy says "Explore the overworld"). The real problem is that it shares a name with the HUD Explore button, which opens the curated modal.

Build: confirmed. The room opens fully empty (no spawn, goal or tiles) after the Beginner/Advanced choice. This part is already in the backlog as G-001 (Priority High), so in_backlog should be true.

welcome_explore analytics: confirmed missing.

### F125: Explore's default 'Featured' tab has nothing featured, and 88% of rooms have no rating, so discovery is mostly noise

- **Area:** New-player experience, retention & community loop
- **Type:** defect · **impact:** high · **effort:** small
- **Flagged before:** xp-badges-ratings-prd.md:654 'Trophies and Version Honors'. Trophies shipped but are unreachable at current rating volume.

**Summary.** Explore opens on "Featured", but no rooms are featured in production, so it silently falls back to "Top Rated". Top Rated is decided by one or two votes, because only 61 quality ratings exist across 319 challenge rooms. 85% of rooms have no difficulty label, so the Easy filter can't help newcomers. The trophy feature needs 10 votes, but no room has more than 5, so no trophy has ever been awarded. Quick fixes: feature 20 great rooms today, and let the game work out difficulty from how often players actually clear and die.

**Technical detail.**

Live data (GET api.wamp.land/api/leaderboards/rooms/discover, 2026-10-03): 319 published goal rooms; 280 have 0 quality votes; the highest vote count on any room is 5; 271 have no consensus difficulty; 0 featured; 0 trophies. exploreModal.ts:83/267 resets discoverSort to 'featured', and difficulty.ts:567 then orders by featured_at first and adjusted quality after. The Bayesian prior in playable_content_index (store.ts:139-140, (3.5*5 + sum)/(5 + weights)) lets a single 5-star vote outrank everything. Fixes: (1) Ops, same day: use the existing admin feature toggle (admin/routes.ts:400-440) to feature 15-25 rooms, mostly by community builders and mixed in difficulty. (2) Measured difficulty: when difficulty votes < 3, derive it per room version from signed-in run outcomes, e.g. clear rate ≥70% and median deaths ≤1 → Easy, ≤15% → Extreme. Store it in playable_content_index.consensus_difficulty with a difficulty_source='measured' flag so filters and labels fill in for most rooms. (3) Add a 'popular' sort (unique players in the last 14 days, from the per-room aggregates in the stats finding). Default Explore to Featured only when ≥8 rooms are featured, otherwise Popular. (4) Make the trophy minimum relative (e.g. top 5% adjusted rating with ≥3 votes) until rating volume grows. TROPHY_MIN_WEIGHTED_VOTES=10 is unreachable today.

**Evidence.**

- live GET https://api.wamp.land/api/leaderboards/rooms/discover?sort=newest (paged, 2026-10-03) — 319 goal rooms, 280 with voteCount 0, max voteCount 5, 271 with consensusDifficulty null, featured=0, trophy=0, total 61 votes
- live GET ...discover?sort=featured — identical ordering to sort=quality; no entry has featured:true
- src/ui/setup/exploreModal.ts:83 and :267 — default/reset discoverSort = 'featured'; index.html:2427 Featured tab active by default
- src/cloudflare/worker/runs/difficulty.ts:567 — featured sort = featured_at first, then quality_adjusted_average
- src/cloudflare/worker/playableContentIndex/store.ts:139-140 — prior of 3.5 at weight 5, so 1-2 votes decide 'Top Rated'
- src/cloudflare/worker/progression/shared.ts:54-55 — TROPHY_THRESHOLD 4.2 with TROPHY_MIN_WEIGHTED_VOTES 10, which no room can currently reach

**Fact-check (partially confirmed, confirmed, partially confirmed).**

All the data and line references are accurate. Two small corrections:
1. A single 5-star vote does not outrank everything. The 3.5×5 prior caps a 1-vote room at about 3.79 (3.75 at weight 1.0), so the top of Top Rated goes to 2-vote rooms (3.82–3.99). Both "1–2 votes decide Top Rated" and "Featured is identical to Top Rated in production" are verified.
2. The featuring fix needs no ops scripting. exploreModal.ts:705-720 already puts a Feature/Unfeature button on every Explore card for anyone holding the featured-rooms admin key, and it calls the admin/routes.ts:400-440 endpoint.

On effort: step 1 (featuring rooms) takes minutes. Measured difficulty from run outcomes needs a new aggregation over runs, a new column or flag in playable_content_index, and filter and label wiring. A "popular" sort needs new per-room unique-player aggregates. Those two together are medium effort, not small. Making the trophy minimum relative is a small change.

Small overstatement in the detail: one 5-star vote does not "outrank everything". At trust weight 1.0-1.2, a single 5-star vote gives an adjusted score of 3.75-3.79. Rooms with two good votes sit above that (Cybertowers 3.99, two rooms at 3.82). Single-vote rooms fill ranks 4-15, so the core point stands: Top Rated is decided by one or two votes.

Trophy math is stricter than the claim says: trust weight tops out at 1.2 per vote (shared.ts:174-186), so a room needs at least 9 real votes to reach 10 weighted votes.

Fix #1 needs no code, because an admin feature/unfeature button already exists on each room card in Explore (exploreModal.ts:712-716).

Context for picking rooms to feature: 157 of the 319 goal rooms (49%) are by 'jonathan' and 51 are by 'Farès'. A featured set "mostly by community builders" has to be picked deliberately.

Effort is small for the ops step and the trophy-threshold change. Measured difficulty and a Popular sort are medium.

The numbers and code citations are accurate. Corrections:
(a) Featured currently equals Top Rated, which shows the ~39 rated rooms first (mostly 1-2 votes each, all 3.79-3.99 after the prior), then the unrated 88% by newest. It is weak curation, not noise.
(b) One 5-star vote scores about 3.79, which ranks below 2-vote rooms (3.82-3.99) rather than above everything.
(c) The Easy filter yields 14 rooms, not zero.
(d) The Explore modal is a HUD-only surface. The welcome modal does not route new players into it: Explore closes the modal and Play jumps to a fixed room. So the claim overstates how many new players see it.
(e) A per-run difficulty heuristic already exists in src/progression/autoDifficulty.ts and is used to pre-fill the rating modal. The measured-difficulty fix should aggregate that per room version server-side from run_rooms. It must exclude abandoned runs and builder self-runs, and require ≥3-5 distinct players, rather than using new ad-hoc clear-rate thresholds.
(f) Effort is split. Featuring 15-25 rooms through the existing in-Explore admin toggle (exploreModal.ts:705-720) takes minutes. Lowering the trophy minimum is a one-constant change. Measured difficulty and a Popular sort need index columns, a migration and refresh logic, which is medium effort.
(g) Implementer caveat: featured_rooms stores room_version. The discover badge needs a version match (difficulty.ts ~507-510), but the index joins on room_id only (store.ts:155). A featured room that its builder republishes keeps its Featured ordering but loses the badge.

### F096: Clearing a room feels flat: no in-play celebration, no 'Next room', and the XP reward only appears after you press Stop

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** When I reached the flag, the HUD changed to 'Exit reached 0:15.5' and nothing else happened. The 'You did it! +20 XP' box only showed up after I left play mode, and it had no time, no comparison to the best time, and no 'next room' button. The payoff moment is where players get hooked, and right now it's silent.

**Technical detail.**

Guest clears call requestPostRunGuestClaim (src/scenes/overworld/goalRuns.ts:979-1003), but RunRatingModalController.presentQueuedBatch (src/ui/setup/runRatingModal.ts:358-366) refuses to present while body.dataset.appMode !== 'world'. In play it is 'play-world', so the prompt waits until Stop/Esc. Suggested: (1) on 'complete', show a small in-canvas or DOM 'CLEAR!' card for about 2s with time, deaths, the room's best time, and three buttons: Next Room (the nearest unbeaten published neighbor, or the next Explore result), Retry, Leaderboard. (2) Let the XP/sign-in nudge sit inside that card instead of a deferred modal. (3) Add a short confetti/sting (rewardStings already exists) and freeze the timer display with a highlight. The room-sequence HUD (#room-sequence-hud with a Next button in index.html) can provide the Next behavior.

**Evidence.**

- Live desktop, room -11,-6: goalRun.result went active→completed at t=15557ms, and the only visible overlay was '#world-goal-panel: DE JA VU 1 REACH EXIT Exit reached 0:15.5' (screenshot d-play2)
- body.dataset.appMode was 'play-world' and #run-rating-modal stayed hidden. After pressing Escape the modal appeared: 'You did it! / You earned 20 XP / Keep playing / Save progress'
- src/ui/setup/runRatingModal.ts:358-366 — presentQueuedBatch returns early unless appMode==='world'
- The post-run modal shows no run time; the room panel shows 'BEST: FARÈS · 3.53S' separately

**Fact-check (partially confirmed).**

What actually happens on a clear:
- In-play effects already fire on every clear: explosion, shine and gold ring animations, the 'goal-success' sound, room NPCs switch to their victorious state, and the HUD goal panel turns to its complete tone (src/fx/controller.ts:171-182, objectiveController.ts:411-426 and 466-467).
- Signed-in players already get an in-play 'ROOM CLEAR!' card with time, deaths and points on their first clear, and leaderboard rank cards when their rank changes (goalRuns.ts:1104-1127, rewardStings.ts:192-207). That card is not gated on app mode.
- Only guests get nothing beyond the effects. Their clear path (goalRuns.ts:980-1021) only queues the guest-claim modal, and that modal hides the run time and leaderboard (runRatingModal.ts:836-838).

The design history matters:
- Holding post-run prompts until the player returns to Browse is an intentional, recently shipped choice (commit 9dd6e89b, feature-ledger.md:25), made so prompts don't interrupt continuous play.
- The fix should therefore keep the deferred modal and do two things: (a) emit createPostRunClearReward for guest clears so guests see the same in-play card as signed-in players; (b) show elapsed time and the room's best time in guest-claim mode.

The Next button:
- A Next button exists today only inside room sequences (Play All, playlists, Explore queue).
- Adding a 'Next Room' for free-roam clears needs new logic to choose the target. That part is medium effort, not small.

### F104: New players never see the controls before the timer starts

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The 'Room Goal → Start' box says 'Reach the exit as fast as you can!' but never mentions which keys to press. The Controls button can't be clicked while that box is open. A first-time desktop player has to guess, with the clock running, whether jump is Space, Up, W or Z.

**Technical detail.**

The goal intro template (src/ui/setup/roomGoalIntroModal.ts:143-162) has only a kicker, title, meta, body and Start. While it's open, it intercepts pointer events, so #btn-world-controls is unclickable (a Playwright click timed out: '#room-goal-intro-modal intercepts pointer events'). Add a compact controls row to the intro, device-aware: desktop '← → / A D move · Space / ↑ jump · Q slash · E shoot'; touch 'Stick to move · JUMP button'. Show it for the first 3 intros (localStorage counter) or always, collapsed, behind a 'Controls' toggle. Also consider accepting Z/X as jump/action (the mann.cool virtual-controller default A/B) since Controls lists only Space/Up.

**Evidence.**

- Live desktop: page.click('Controls') timed out because '<div id="room-goal-intro-modal">…</div> intercepts pointer events'
- Goal intro text captured live: 'ROOM GOAL / de ja vu 1 / Reach exit / Reach the exit as fast as you can! / START' (no input hints)
- index.html:2911-2919 — controls only live in the separate Controls modal (WASD/Arrows move, Space/Up jump, Q slash, E shoot)

**Fact-check (confirmed).**

Small corrections:
(1) The timer does not run while the intro is open. OverworldPlayScene.ts:3758-3761 clears the goal run and pauses the scene. The run only starts in onStart (3772-3785). The real problem is that once the player presses Start, the timer is running and they still haven't seen any controls.
(2) W also jumps, not just Space/Up. movementController.ts:408-413 and 484 set `jumpPressed: spacePressed || upPressed`, and upPressed includes JustDown(wasd.W). The hint should read "WASD / Arrows move · Space / W / Up jump · Q slash · E shoot". Better still, copy the existing `.playlist-intro-controls` markup and CSS from index.html:2550-2555 instead of writing a new layout.
(3) The intro only appears for published rooms that have a goal, only when entering from the overworld at spawn, and only once per room version (roomGoalIntroModal.ts:76-82 and 135-136; OverworldPlayScene.ts:3789-3808). Many first-time players, for example in rooms without goals, never see it. The hint is more useful as a one-time first-play HUD toast or a row in the welcome modal, as well as in the intro.
(4) Adding Z/X bindings is low value. Gameplay keys are only W/A/S/D, Q, E, cursors and 9 (OverworldPlayScene.ts:2670-2684), and the mann.cool controller mapping is configurable per game, so changing that config would be enough. Treat it as optional.

### F123: Builders never find out that someone played, beat, rated, or took #1 on their room

- **Area:** New-player experience, retention & community loop
- **Type:** improvement · **impact:** high · **effort:** medium
- **Flagged before:** xp-badges-ratings-prd.md:1071 Phase 4 'kingslayer tracking' and :1099 open question on feeds. Neither is built.

**Summary.** The best reason for a builder to come back is "people are playing my thing", and WAMP never tells them. The only emails are for approved comments and chat @mentions. In-game, a returning builder sees a generic XP pop-up labeled "While you were away" with no names or rooms. Add an activity inbox (a bell on your profile card) and a weekly digest email: "7 players beat Lava Gauntlet, 2 rated it 4+ stars, tkinter took your #1."

**Technical detail.**

Most of the data is already logged. Every time another player completes your room, awards.ts:466-478 writes a bxp_events row (event_type 'unique_completion_room', source_id `${roomId}:${version}:${playerUserId}`, created_at). Every first rating writes 'unique_rating_room' (ratings.ts:664-677). bxp_events is indexed by (user_id, created_at) (migrations/0019_progression.sql:17-30). Build: (1) GET /api/me/activity?since=, a read-only query over bxp_events for the user, joined to users (player name) and rooms (title), plus approved room_comments. Add a small insert for dethrones in runs/verification.ts when the trigger reason is 'take_top_1' (verification.ts:412-414) and currentBest.userId differs from the new runner. Store users.last_activity_seen_at. (2) Client: an unread-count badge on the mini-profile card (#auth-identity, index.html:109). Replace the generic catch-up receipt (rewardStingCatchup.ts:105-115, reason 'While you were away') with a concrete list that links to each room. (3) Weekly digest from the existing hourly cron (wrangler.jsonc:6; worker.ts:261 currently only purges replays). Send only to users with activity that week and an email address. Include a List-Unsubscribe header, a signed one-click unsubscribe token, and a settings toggle; neither existing email (roomComments/email.ts, chat/mentions.ts) has any opt-out today. (4) Send an immediate 'You lost #1 on X, take it back' email at most once per day per user; this is the strongest re-engagement trigger. Mobile: the badge must fit the compact phone HUD; the inbox can reuse the history-modal shell.

**Evidence.**

- src/cloudflare/worker/progression/awards.ts:466-478 — creator BXP event 'unique_completion_room' records which player cleared which room version, with timestamp
- src/cloudflare/worker/progression/ratings.ts:664-677 — 'unique_rating_room' BXP event per rater
- migrations/0019_progression.sql:17-30 — bxp_events table with (user_id, created_at) index
- src/cloudflare/worker/roomComments/email.ts:56-60 and src/cloudflare/worker/chat/mentions.ts:85 — the only user-facing notification emails (approved comment, @mention); no unsubscribe link
- src/ui/setup/rewardStingCatchup.ts:105-115 — the return-visit feedback is an XP delta labeled 'While you were away' with no who/what
- wrangler.jsonc:6 and src/cloudflare/worker.ts:261 — an hourly cron exists but only purges guest replays
- src/cloudflare/worker/runs/verification.ts:412-414 — 'take_top_1' is detected here, the natural hook for dethrone notifications

**Fact-check (partially confirmed).**

Factual errors and changes to the plan:

1. "The only emails are for approved comments and @mentions" is wrong. Resend also sends:
   - World grant, invitation and manager-action emails (worlds/notifications.ts:21-74)
   - email sign-in codes (auth)
   - admin review emails (admin/reviewNotifications.ts)
   The accurate statement: the comment email (roomComments/email.ts) is the only email about activity on a builder's room. None of these emails has an opt-out. The digest should reuse the shared Resend send-and-escape pattern already copied across these four modules, ideally pulled into one helper first.

2. The dethrone hook is in the wrong place. verification.ts:395-414 (createGenericVerificationTrigger) runs before replay verification. It only predicts the rank to decide whether a replay is needed, and a run flagged 'take_top_1' there can still fail verification.
   - The right hook is the existing award: awards.ts:436-446 (rooms) and :605-610 (courses) already write a 'top1_take' pxp event when currentRank === 1 && previousRank !== 1.
   - The full runs list for that room version is already loaded at awards.ts:399, so the displaced #1 holder can be found there without extra queries.
   - That event currently does not record who was dethroned. Pass a breakdown such as { dethronedUserId } to awardLaneDelta, which supports a breakdown parameter (laneEvents.ts:118-128).

3. The bxp_events rows cannot be joined to users or rooms directly. source_id is a composite string, roomId:versionKey:playerUserId, so the activity query needs string parsing, or better, a structured breakdown_json written at award time. The rating event stores no star value (no breakdown is passed at ratings.ts:668-677), so "rated it 4+ stars" needs a join to the room ratings table.

4. The weekly digest needs a day-of-week/hour guard inside the hourly scheduled() handler, plus a sent-marker table so it is idempotent.

Impact and effort stand: high and medium. The in-app inbox alone is small to medium. Adding the digest, a signed unsubscribe link and the dethrone email makes it medium.

### F124: Builders can't see how many people played their room, how many beat it, or where they died

- **Area:** New-player experience, retention & community loop
- **Type:** improvement · **impact:** high · **effort:** medium
- **Flagged before:** backlog.md G-012 asked that 'Builders can review that feedback in a useful place'. Ratings shipped; usage stats did not.

**Summary.** On your profile, each room shows only stars and a difficulty label. There are no play counts, clear rate, or average deaths, even though the server records all of them. Only the admin dashboard can see attempt counts. Showing "43 players, 31% beat it, avg 7 deaths" on each room, plus a later 'where players die' map in the editor, would be the best level-design feedback and a strong reason to build again.

**Technical detail.**

ProfilePublishedRoomEntry (profiles/model.ts:10-20) has no engagement fields. profileModalRoomRenderer.ts:117-128 renders only the difficulty badge and stars. room_runs already stores result and deaths per attempt (migrations/0003_runs_and_leaderboards.sql:26-29), and launchStats.ts:840-876 already aggregates COUNT(*) attempts for admins. Add per-room-version aggregates (attempts, unique players, completions, clear rate, median clear ms, avg deaths per attempt, last played). Either add columns to playable_content_index, refreshed from the run-finalize path the way ratings are, or add a small room_stats table updated on finalize. Expose them in the profile/discovery DTOs and render one compact line on profile cards, Explore cards ('Played by 43'), and the editor Room panel. Phase 2, a death heatmap: add the death positions (room-local tile x,y, capped at 50 per run) to the finalize payload and store them aggregated as a coarse grid per room version. Draw them as a translucent overlay toggle in the editor; the breadcrumb/trace infrastructure (rankedRunTraceRecorder.ts:11) shows the pattern. Counts will badly undercount until guest runs are recorded (see the guest-progress finding), so ship the two together if possible.

**Evidence.**

- src/profiles/model.ts:10-20 — ProfilePublishedRoomEntry: title, version, goalType, publishedAt, consensusDifficulty, quality only
- src/ui/setup/profileModalRoomRenderer.ts:117-128 — room card rating row = difficulty badge + stars, nothing else
- migrations/0003_runs_and_leaderboards.sql:26-29 — room_runs has finished_at and deaths per attempt
- src/cloudflare/worker/admin/launchStats.ts:840-876 — attempt_count aggregation exists, but only for the admin dashboard
- grep for attemptCount/clearRate/playCount in src/ (non-admin) — no player-facing usage

**Fact-check (confirmed).**

Two small additions. (1) Builders are not completely blind. They get an aggregate count of unique players who cleared their rooms, across all rooms, used only for XP and builder badges (progressRows.ts:333, badgesTrophies.ts:82-87 and 403-407). The room leaderboard modal also lists ranked clears with deaths per clear and the difficulty vote count (leaderboardModal.ts:721-725). Neither gives per-room attempts, failures, clear rate or average deaths, and neither appears on profile or Explore cards. (2) Effort is small only for Phase 1 (aggregates plus UI). With the Phase 2 death heatmap included, the whole item is medium.

### F130: After-run rating prompts and sign-up prompts disappear unless the player goes back to the map

- **Area:** New-player experience, retention & community loop
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** After a first clear, the "rate this room" popup (and the guest "save your progress" popup) waits until the player returns to the map. Players who keep running into the next room and then close the tab (common on phones) never see it, and the queued prompts are lost. That helps explain why there are only 61 ratings in the whole game, even though top players have hundreds or thousands of clears.

**Technical detail.**

PostRunRatingQueue (ui/setup/postRunRatingQueue.ts) is an in-memory class with no storage. runRatingModal.ts:357-363 presentQueuedBatch returns unless body.dataset.appMode === 'world', and continuous adjacent-room play keeps the mode at 'play-world' (OverworldPlayScene.ts:5972). Nothing flushes the queue on pagehide. The global leaderboard shows players with 412 (tkinter) and 2,116 (Farès) completed runs, against 61 quality votes total, so the rating loop that feeds Curator XP, Top Rated, trophies, and difficulty barely runs. Fix: (1) Persist queued prompts to localStorage (keyed by user id or guest id, max 10, 7-day TTL) and restore them on boot as 'Rate the 3 rooms you beat last time' through the existing batch UI. (2) For signed-in players, add a one-tap 5-star row to the in-play clear reward sting that submits quality with the auto-suggested difficulty (runRatingModal.ts:412 already pre-fills it) without leaving play; the full modal stays available. (3) Count prompts queued/shown/submitted/skipped/dropped and surface them in Launch Admin. Mobile: star targets ≥44px, placed above the touch controls.

**Evidence.**

- src/ui/setup/postRunRatingQueue.ts:22-41 — in-memory queue class, no persistence
- src/ui/setup/runRatingModal.ts:357-363 — prompts only present when appMode === 'world'
- src/scenes/OverworldPlayScene.ts:5972 — play mode sets appMode 'play-world'
- live GET https://api.wamp.land/api/leaderboards/global — completedRuns 2116 (Farès), 412 (tkinter), 1138 (jonathan)
- live discover data — 61 total quality votes across 319 goal rooms

**Fact-check (partially confirmed).**

Prompts are deferred on purpose until Browse (feature-ledger.md:25, commit 9dd6e89b). They are lost only if the session ends while the player is still in Play. For signed-in players the server already knows which rooms they cleared but haven't rated, and Explore's "Unrated" sort with "Rate All" (exploreModal.ts:461-470, 1162-1186; worker difficulty.ts:529) is an existing but hidden way to get them back. A better fix than localStorage persistence: on boot and on returning to Browse, fetch the server-side unrated-by-you count and show a small "Rate the N rooms you beat" nudge that opens the existing Rate All queue. That works across devices and needs no client storage. For guests, actually call the unused loadGuestRunProgress() (guestRunProgress.ts:63) on boot so the "save your progress" nudge comes back. Drop the comparison with leaderboard completedRuns. Those numbers include repeat runs, and prompts fire only on first clears of each room version (goalRuns.ts:1109-1111). The confirmed live figures are 61 quality votes across 39 of 319 goal rooms, plus 79 difficulty votes. The in-play one-tap star row is a design change that cuts against the deliberate no-interrupt choice. Treat it as optional, not as the fix.

### F133: Publishing your first room ends with a line of status text: no celebration, no share prompt, no title prompt

- **Area:** New-player experience, retention & community loop
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Publishing your first room should be the proudest moment in WAMP. Right now it's a small "Published v1." message, and the XP pop-up that follows is wrongly labeled "While you were away". 74 of 319 published challenge rooms have no title, so their shared links just show coordinates. A one-time "Your room is live!" screen with a preview, a name field, and share buttons would turn new builders into promoters.

**Technical detail.**

roomSession.ts:561-575: on success, publishRoom only calls setStatusText(`Published v${n}.`). It then calls refreshAuthSession (roomSession.ts:566), which fires AUTH_SESSION_REFRESHED and makes RewardStingCatchupController show the BXP gain with reason 'While you were away' (rewardStingCatchup.ts:113). Live data: 74 of 319 goal rooms have no title. Fix: on the first publish of a room (publishedVersion === 1), open a modal using the history-modal shell with: a preview image (reuse renderRoomSnapshotToPngDataUrl as in guestRoomRecoveryModal.ts:210); an inline 'Name your room' field when the title is empty (saves the title with the next publish or a metadata patch); the live link; Share (native share/copy/X), Wamp-O-Gram, and 'Play it now' buttons; and the line "We'll tell you when someone beats it" (ties to the activity inbox). Dispatch dispatchProgressionFeedback directly with reason 'Published <title>' and skip the catch-up for that refresh. Later versions keep the status text. Mobile: the modal must fit the phone editor shell.

**Evidence.**

- src/scenes/editor/roomSession.ts:561-575 — publish success = setStatusText only
- src/scenes/editor/roomSession.ts:566 + src/ui/setup/rewardStingCatchup.ts:113 — publish XP surfaces with the reason 'While you were away'
- live discover data — 74 of 319 published goal rooms have roomTitle null
- src/ui/setup/guestRoomRecoveryModal.ts:210 — existing client-side room preview renderer to reuse

**Fact-check (partially confirmed).**

The publish XP is not shown with the label "While you were away" right after publishing. refreshAuthSession (auth/client.ts:300 → refreshSession at :370) never dispatches AUTH_SESSION_REFRESHED_EVENT, which only fires at startup (client.ts:285). Publishing also never sends PROFILE_INVALIDATED. So there is no XP feedback at publish time at all. The publish XP (rooms/routes.ts:437, awardRoomPublishProgression) shows up later instead: on the next page load as "While you were away" (rewardStingCatchup.ts:113), or folded into the next rating/run sting under that action's label (leaderboardModal.ts:541-563).

The fix should therefore not "skip the catch-up for that refresh". It should do one of these:
- Have the publish route pass the XP change back: call roomMutationResponse(request, url, record, { progression, progressionDelta }) at rooms/routes.ts:449, using the return value of awardRoomPublishProgression.
- Or, on the client after publish, reload the profile once.

In either case, call dispatchProgressionFeedback with reason "Published <title>", then saveSeenRewardProgression(userId, progression) so the later catch-up and rating stings don't count the same XP again.

Also note that a "Name this room" title input is always visible in the editor (index.html:1376-1378). What is missing is a prompt for the title at publish time, not a title field. Everything else checks out: status-text-only success (roomSession.ts:561-575), no share option after publishing, coordinate fallback titles (share/routes.ts:292-299), the 74/319 untitled count (re-verified live), and the preview renderer to reuse (guestRoomRecoveryModal.ts:210).

### F099: Returning guests get the sign-in panel popped open on every visit (full-screen on phone landscape)

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Every time a returning visitor (not signed in) loads WAMP, the sign-in menu opens itself. On a phone held sideways it covers the whole game until you find the X. That feels pushy and gets between people and play on every visit.

**Technical detail.**

setupAuthUi awaits refreshSession and then always calls maybeAutoOpenGuestPanel (src/auth/client.ts:283 → :1333-1342), which adds 'menu-open' and focuses/selects the email input. On a first visit the Welcome modal hides it (welcomeModal.ts:180), but once the welcome has been seen nothing does. Fix: remove the auto-open, or limit it to (a) the 3rd+ visit with unsaved guest XP/drafts, at most once per 7 days (store a timestamp), and (b) never on phones or when a deep link/autoplay is active. Don't programmatically focus the email input (it can raise the mobile keyboard and grabs desktop keyboard focus). Prefer the existing contextual nudges (post-run 'Save progress', builder claim) as the sign-up moments.

**Evidence.**

- Live phone landscape 812x375 reload with the welcome already seen: #auth-panel class 'auth-panel-guest menu-open' covering the viewport (screenshot l-first: ABOUT WAMP / email / Sign in with email / Sign in with wallet)
- Live phone portrait 375x812 reload: same panel open over the world (screenshot m-returning)
- Live desktop with the welcome seen: panel open top-right on load (screenshot d-returning)
- src/auth/client.ts:1333-1342 — maybeAutoOpenGuestPanel adds 'menu-open' plus focus()/select() on every guest load

**Fact-check (confirmed).**

Three corrections. (1) "Covers the game until you find the X" overstates it. A document click handler (src/auth/client.ts:225-229) closes the panel on any tap or click outside it. In phone landscape there is little uncovered area to tap, so the effect is close to what was claimed, but the X is not the only way out. (2) "Can raise the mobile keyboard" is unproven. Mobile browsers (iOS Safari in particular) usually don't show the keyboard for a focus() call that no user gesture triggered. The proven harm from the focus call is on desktop: keyboardFocus.ts:68-87 turns off the game's keyboard while the email input has focus, so arrow keys and jump don't work until the player clicks the game. (3) The auto-open is a deliberate design choice (commit aad1546c, "Make guest onboarding auth-first"), not an oversight, so present it as reversing a past product decision. promptForSignIn (client.ts:317-322) already provides the in-context sign-in nudge the fix should rely on.

### F100: Guest builders are interrupted by a sign-in modal after their first brush stroke

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** As a new builder, I drew one line of ground and a big 'Awesome work! +25 Builder XP — Sign in to save' box appeared immediately. Asking for sign-up before someone has even made a jump breaks the creative flow at its most fragile moment.

**Technical detail.**

GUEST_BUILDER_BUILD_PLACEMENT_THRESHOLD = 30 (src/progression/guestBuilderClaimEvents.ts:5) is checked in GuestBuilderActivityTracker.recordPlacedBuildContent (src/scenes/editor/guestBuilderActivityTracker.ts:24-47). A room is 40 tiles wide, so one ground stroke crosses the threshold. The draft is already autosaved locally ('Draft saved locally. Sign in to publish.' banner), so the modal isn't protecting work in the moment. Suggested trigger: after the first successful Test play, after placing spawn+goal, or after 5 minutes of active editing, whichever comes first. Use a non-blocking toast for the first nudge, and keep the blocking modal for Publish/leave.

**Evidence.**

- Live: Welcome → Build → Beginner opened the editor on frontier room 9,14. One mouse drag across the canvas placed 41 tiles and opened 'BUILDER PROGRESS / AWESOME WORK! / You've placed 41 tiles and items in room 9,14 / +25 Builder XP / Keep building · Sign in to save' (screenshot d-editor-draw)
- src/progression/guestBuilderClaimEvents.ts:5 — GUEST_BUILDER_BUILD_PLACEMENT_THRESHOLD = 30
- Related backlog G-020 (durable guest draft recovery) covers the save side, so the early modal isn't needed for safety

**Fact-check (confirmed).**

Small fixes to the reviewer's details, not the core claim:
1. G-020 is more than a "related backlog" item. Most of it is already in the code: guests get a server-side draft (src/guestRooms/client.ts:13 saveGuestRoomDraft, called from roomSession.ts:1135-1141) and a guest-room-recovery-modal (index.html:2383+). That makes the argument stronger: the early modal is not needed to keep work safe.
2. The banner the reviewer saw, "Draft saved locally. Sign in to publish.", appears only when the server-side guest draft save fails (roomSession.ts:1141-1143). The normal guest text is "Draft saved as guest. Sign in to publish." So in that session the durable save probably failed, which may be a separate problem worth checking.
3. The modal shows once per room, not once per user (guestBuilderClaimModal.ts:86-91). A guest who builds in several rooms is interrupted on the first stroke in each one.
4. Easiest place to fix it: guestBuilderActivityTracker.ts:31 (the threshold check). Gate it on a successful Test play, or on spawn + goal being placed, or on time spent. Turn the 'build-threshold' source into a non-blocking toast and keep the full modal for the 'publish-attempt' and 'manual-save' sources.

### F137: The 'You left a room unfinished' popup can interrupt a shared-link run and returns every visit

- **Area:** New-player experience, retention & community loop
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** A returning guest with an unfinished room gets the recovery popup 3.5 seconds after load, no matter what they're doing. If they arrived through a friend's room link, which auto-starts play, the popup lands on top of their run. It also comes back on every visit after "Not now."

**Technical detail.**

guestRoomRecoveryModal.ts:127-129 schedules maybeOpenReturningGuestDraft on a fixed 3,500 ms timer. maybeOpenReturningGuestDraft (:138-153) opens the modal with no appMode or blocking-surface check, and its only guard is the per-page-load flag autoPromptedThisSession. Deep links autoplay the room at boot (OverworldPlayScene.ts:2190-2193, 3147-3163), so the modal can cover gameplay. WelcomeModalController already has the right gating to copy: it waits for appMode 'world' and checks hasBlockingSurface / isBusyOverlayVisible (welcomeModal.ts:235-267). Fix: reuse that gating (poll until browse mode with no other history-modal open), and store a localStorage snooze (e.g. 3 days) when the player chooses 'Go To Room' or closes it.

**Evidence.**

- src/ui/setup/guestRoomRecoveryModal.ts:127-129 — fixed 3.5 s auto-open timer
- src/ui/setup/guestRoomRecoveryModal.ts:138-153 — opens without checking app mode or other modals; per-page-load guard only
- src/ui/setup/welcomeModal.ts:235-267 — existing gating pattern (appMode 'world', no busy overlay, no other modal)
- src/scenes/OverworldPlayScene.ts:2190-2193, 3147-3163 — /r/x/y links auto-start play on boot

**Fact-check (confirmed).**

Three small details need fixing.
- **It is not only a fixed 3.5 s timer.** maybeOpenReturningGuestDraft also runs on AUTH_SESSION_REFRESHED_EVENT (guestRoomRecoveryModal.ts:97-99, :126). auth/client.ts:282-290 fires that event at the end of auth start-up, so the popup can appear in under 3.5 s. Whichever happens first wins, and the per-load flag stops the second.
- **There is no "Not now" button.** The dismiss button is labelled "Close" (index.html:2389). The other choices are Sign In To Publish, Publish To Guest Rooms and Go To Room. The doc's "Not now" escape was never built.
- **The fix should cover both triggers.** Gate both triggers the same way, by polling the welcome-modal checks (shouldAutoOpen/hasBlockingSurface, which also excludes the room-goal intro modal) and staying out of play mode. Also store a snooze (localStorage, try/catch) when the player picks Close or Go To Room.

### F131: Guests and Expanded Room players can't share a clear, and the map has no 'Share this room' button

- **Area:** New-player experience, retention & community loop
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The "Share your clear" card only appears for signed-in players beating a single room. Guests, who are most visitors, never get a share button, and neither does anyone who beats an Expanded Room, the community's showpiece levels. While browsing or playing, there's no button to share the room you're looking at; you have to copy the browser address, which is hard on phones. Every guest clear could be an invite.

**Technical detail.**

runRatingModal.ts:974-976 renderShare sets visible = this.mode === 'rating' && request.contentType === 'room', so guest-claim mode and expanded_room/course clears hide the share card. runRatingModal.ts:602-605 shareRun returns early for anything but 'room'. The browse/play HUD (index.html:1865-1885) has Play/Comment/Explore/Leaderboard but no share; 'Copy Room Link' exists only in the editor dock Share popover (index.html:1343; editorDockShell.ts:791-810). Fix: (1) Show the share card in guest-claim mode too, since sharing doesn't need an account and the link drives new players. (2) Support expanded rooms by building the URL from expandedRoom.anchorCoordinates, with the title 'I beat "Cybertowers" in WAMP in 41.2s'. (3) Add a 'Share' button to the selected-room HUD row: navigator.share({title, text, url}) on mobile, clipboard copy with toast on desktop, and a 'Copy link' next to the X button in the run modal, since Discord is the community hub and X-only is limiting. (4) Append ?from=share to all of these URLs for attribution.

**Evidence.**

- src/ui/setup/runRatingModal.ts:974-976 — share section visible only when mode === 'rating' and contentType === 'room'
- src/ui/setup/runRatingModal.ts:602-605 — shareRun returns early unless contentType === 'room'
- index.html:2646-2663 — run share actions are X (or native sheet with image) + Download only
- index.html:1865-1885 — world HUD buttons include no share action
- index.html:1343 and src/ui/setup/editorDockShell.ts:791-810 — room-link copy exists only inside the editor

**Fact-check (confirmed).**

Small corrections to the fix approach:
1. PostRunRatingRequestDetail has no anchorCoordinates for expanded_room or course (postRunRatingEvents.ts:27-36), so the proposed 'expandedRoom.anchorCoordinates' URL needs extra plumbing. That may not be needed: buildRunShareUrl (social/runShare.ts:17-27) already falls back to window.location.href for non-room content, and the address bar is kept at /r/x/y during play.
2. buildRunShareText already handles expanded_room and course titles (runShare.ts:89-93). Expanded-room sharing is half-built and mostly needs the two gates relaxed.
3. The snapshot image path is room-only (shareImageLoading is set only for 'room' at runRatingModal.ts:420, and the snapshot renderer only takes room coordinates). Expanded/course shares would be text-only, or would need the existing canvas-capture fallback (captureCurrentCanvasDataUrl).
4. Guest expanded-room clears are dispatched as contentType 'course' with expandedRoomId (coursePlayback.ts:262), not 'expanded_room', so a fix must handle both types.
5. The share text format is 'in 41.2 seconds', not '41.2s'.
6. The guest exclusion was introduced by commit b2bc14f2 and left btn-run-share-signin as dead UI. The fix should drop that button or repurpose it.
7. The Room Rush result modal (roomRushResultModal.ts:269-310) already uses the native share sheet with a clipboard fallback. That is the pattern to reuse for the HUD 'Share' and 'Copy link' buttons.

### F132: Link previews for the best levels (Expanded Rooms) say 'WAMP room -4,12' with no title or builder

- **Area:** New-player experience, retention & community loop
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** When someone shares a link to a big multi-room level like "Cybertowers", "The Zone of truth", or "The Mountain", the Discord/X/iMessage preview just says "WAMP room -4,12 - Play this WAMP room at -4,12." The level's name and its builder are missing from exactly the links most worth sharing. No room preview anywhere credits the builder.

**Technical detail.**

shareMetadata.ts:257-275 buildPublishedRoomMetadata only uses snapshot.title, the single cell's title. Expanded-room titles live on the expanded room record, so the code falls back to buildFallbackMetadata (shareMetadata.ts:199-212). Live check: /r/-4/12 (Cybertowers, the top-rated room), /r/-16/-1 (The Zone of truth), and /r/8/0 (The Mountain) all render og:title 'WAMP room x,y', while the discovery API returns expandedRoom.title for those coordinates. A plain room, /r/-5/3 ('into the fire'), gets its title correctly. Fix: when snapshot.title is empty, have the Pages share route resolve expanded-room membership and title. Extend /api/share/rooms/:id/meta to return {title, builderDisplayName, expandedRoom, quality, difficulty}. Use the description '"Cybertowers" by Farès, an Expanded Room in WAMP. Hard · ★4.0. Can you beat it?' For expanded rooms, render the og:image of the full footprint rather than one cell. Add a red/green test next to src/pages/shareMetadata.test.ts.

**Evidence.**

- live GET https://wamp.land/r/-4/12 — og:title 'WAMP room -4,12' (discovery lists it as expanded room 'Cybertowers')
- live GET https://wamp.land/r/-16/-1 and /r/8/0 — og:title 'WAMP room -16,-1' / 'WAMP room 8,0' (The Zone of truth / The Mountain)
- live GET https://wamp.land/r/-5/3 — standalone room correctly shows 'into the fire - WAMP room -5,3'
- src/pages/shareMetadata.ts:257-275 — title derived only from snapshot.title; builder never included
- src/pages/shareMetadata.ts:199-212 — generic fallback title/description

**Fact-check (confirmed).**

The fix needs no new API work for title, expanded-room data or the footprint image. /api/share/rooms/:id/meta already resolves expanded-room membership (src/cloudflare/worker/share/routes.ts:87-118). It already returns the expanded title, a "N-cell" description, an `expandedRoom` object and a full-footprint image URL (routes.ts:220-256 and 186-205). Live, it returns "Cybertowers on WAMP".

The defect is purely in the Pages layer:
- src/pages/shareMetadata.ts:84-87 short-circuits on the per-cell snapshot, whose title is null for expanded cells.
- shareMetadata.ts:~110 forces the single-cell Pages image.

Minimal fix: when snapshot.title is empty, fall through to (or fetch in parallel) the existing meta endpoint and use its title/description. Optionally, also use its imageUrl when `expandedRoom` is non-null, or teach the Pages renderer (src/pages/roomImageRenderer.ts:104) to draw the footprint.

Update the ordering test at src/pages/shareMetadata.test.ts:152 accordingly.

Only the builder credit (and the optional quality/difficulty extras) needs new API fields. Neither the snapshot nor the meta response carries creator data today.

### F129: Add a daily 'Room of the Day' challenge that shows off community builders

- **Area:** New-player experience, retention & community loop
- **Type:** idea · **impact:** high · **effort:** medium
- **Flagged before:** xp-badges-ratings-prd.md:741 'Cadence Bonuses' favors low-pressure return incentives; a daily room fits that model.

**Summary.** WAMP has no daily reason to open the game. A Room of the Day would add one: one community room each day, a banner on load, a leaderboard that resets daily, bonus XP for beating it, an automatic post to X, and an email to the builder saying "your room is Room of the Day." It's very much Song A Day, and most of the parts already exist.

**Technical detail.**

Existing parts: the featured_rooms table and admin feature endpoint (migrations/0023_featured_rooms.sql; admin/routes.ts:400-440), currently unused (0 featured rooms live); a map-screenshot worker that already builds a daily X caption (mapScreenshot/twitter.ts:44 buildDailyCaption); and XP cadence events (awards.ts:377-381 weekly_play, shared.ts:67), which are weekly only. Build: a `daily_rooms(date PRIMARY KEY, room_id, room_version, picked_by)` table filled by the hourly cron at 00:00 UTC. Pick a published goal room with ≥1 clear, not picked in the last 90 days, weighted toward non-staff builders, higher quality, and measured difficulty Easy/Medium on weekdays and Hard on weekends; Jonathan can override from Launch Admin. Add GET /api/daily, a /today route that autoplays the room through the existing deep-link autoplay (OverworldPlayScene.ts:3147-3163), and a dismissible banner/chip on load. The daily leaderboard is room_runs filtered to finished_at in the UTC day. Add a PXP 'daily_clear' event with dedupe key per user per day, and a gentle 'You've beaten 4 of the last 7' rather than a punishing streak (per the PRD's no-harsh-streaks principle). Notify the builder through the activity inbox and email. Mobile: render as a small chip in the compact phone HUD that expands on tap.

**Evidence.**

- migrations/0023_featured_rooms.sql — featured infrastructure exists
- live GET ...discover?sort=featured — zero rooms currently featured
- src/mapScreenshot/twitter.ts:44 — buildDailyCaption: daily X posting pipeline already exists
- src/cloudflare/worker/progression/awards.ts:377-381 and shared.ts:67 — only a weekly_play cadence bonus; no daily loop
- src/scenes/OverworldPlayScene.ts:3147-3163 — deep-link autoplay can power a /today link

**Fact-check (partially confirmed).**

Drop "most parts already exist" for X posting. twitter.ts is a stub, so auto-posting needs paid X API access and credentials and should be a stretch goal. A share link or OG card for /today is a better first step. Replace "activity inbox" with email through the existing Resend path (roomComments/email.ts), plus an optional "Your room is Room of the Day" toast when the builder next loads the game. Featured rooms aren't unused: they drive Explore's default sort but are empty. A zero-code quick win is for Jonathan to start featuring rooms now through the existing admin toggle, and Room of the Day can upsert the daily pick into featured_rooms so it also tops Explore. Note that a per-room daily PB bonus (awards.ts:383-395) already exists. Pick the room lazily on the first GET /api/daily of the UTC day (INSERT OR IGNORE) instead of relying on a midnight cron, since the hourly cron fires at :17. Keep the daily_clear bonus small (around 5 PXP, matching PRD line 316's "featured completion +5"), with no streak UI beyond a soft "beaten N of the last 7".

### F128: Bring back jams as a weekly 'Build Prompt': July's jam produced 10x the community rooms of the months around it

- **Area:** New-player experience, retention & community loop
- **Type:** idea · **impact:** high · **effort:** medium

**Summary.** Rooms from the community (anyone besides Jonathan, Farès, and KamiSawZe) jumped from 2 in June to 20 in July during the Solo Room Jam, then fell to 4 in August and 5 in September. Jams clearly work, but the jam was a one-off hard-coded into the game and needed a separate sign-up form. A weekly themed prompt ("Only one jump", "Upside-down room"), entered with a checkbox when you publish, would keep that energy all the time and fits the Song A Day spirit.

**Technical detail.**

Live discovery data (first-published month for goal rooms not built by the top 3 accounts): Mar 27, Apr 13, May 17, Jun 2, Jul 20, Aug 4, Sep 5. The top 3 accounts built 231 of the 319 goal rooms. The jam system is single-use: jam/model.ts:1-5 hard-codes JAM_SLUG 'solo-room-jam-2026-07' and the claim/submission dates, and registration is a separate username+email+Turnstile form (jam/model.ts:36-42) rather than the WAMP account. Design: a `build_prompts` table (slug, title, constraint text, starts_at, ends_at, cover image) managed from Launch Admin, which already has a Game Jams section (admin/gameJams.ts). In the publish flow, show 'Enter this week's prompt: <title>' as a checkbox and store prompt_slug on the room version. Explore gets a 'This Week's Prompt' shelf with Play All via the existing sequence API, and voting reuses post-run quality ratings among entries. At week end a cron (the existing hourly trigger) auto-features the top 3, awards a 'Prompt Winner' badge (badge catalog: badgesTrophies.ts BADGE_DEFINITIONS), and announces it through the notification inbox. No separate registration. Jonathan posts the prompt every Monday in Discord/X.

**Evidence.**

- live GET https://api.wamp.land/api/leaderboards/rooms/discover?sort=newest (paged) — community goal rooms by month: Jun 2, Jul 20 (jam), Aug 4, Sep 5; jonathan 157 + Farès 51 + KamiSawZe 23 of 319
- src/jam/model.ts:1-5 — jam slug and dates hard-coded to July 2026
- src/jam/model.ts:36-42 — jam registration requires a separate username + email + rules form
- src/cloudflare/worker/admin/gameJams.ts — existing admin jam section to extend
- src/cloudflare/worker/progression/badgesTrophies.ts:24-112 — badge catalog to add a prompt-winner badge to

**Fact-check (partially confirmed).**

Drop "10x the months around it": July was 10x June, 5x August and 4x September. Say the July spike came with $500 cash prizes, an avatar for every participant and live judges (jam.html:14, 140-146), so a weekly prompt needs a real recurring reward: a winner badge, a room ribbon, a guaranteed featured slot, and maybe a monthly cosmetic or avatar. Don't promise a checkbox alone will bring back July's numbers. Replace "notification inbox", which doesn't exist, with email through the existing Resend helpers, chat, or a reward sting. Note that admin/gameJams.ts already groups by jam_slug, so only the client model and jam.html are single-use. Add that auto-featuring winners would fill Explore's default 'featured' sort, which currently returns 0 featured rooms. Add that a prompt-winner badge could also deliver the July jam's promised top-ten badge and ribbon, which were never built.

### F135: The global leaderboard is all-time only and dominated by staff; add a 'This Week' board

- **Area:** New-player experience, retention & community loop
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** xp-badges-ratings-prd.md:620 'Holding Position' daily/weekly competitive rewards, not built.

**Summary.** The only global leaderboard is all-time. The top three are Jonathan, Farès, and KamiSawZe at 195k, 189k, and 78k points, while #4 has 16.7k, so a new player can never place. A weekly board that resets every Monday would give newcomers a reachable goal and a reason to come back each week.

**Technical detail.**

runs/leaderboards.ts:47-49 orders the global board by total_points from user_stats with no time window. pxp_events already records every Player-XP award with created_at and has a (user_id, created_at) index (migrations/0019_progression.sql:1-15). Add GET /api/leaderboards/global?window=week returning SUM(amount) FROM pxp_events WHERE created_at >= Monday 00:00 UTC GROUP BY user_id, with the same legacy/generated-user filters (leaderboards.ts:242-244). Add a 'This Week' tab in the leaderboard modal, defaulting to it for players outside the all-time top 50, with the viewer row 'You: #23 · 40 XP to pass @name'. Award a 'Weekly Top 3' badge via cron and announce it in the activity inbox. Optionally show staff accounts with a 'Staff' tag rather than hiding them.

**Evidence.**

- src/cloudflare/worker/runs/leaderboards.ts:47-49 — global ordering is total_points DESC, all-time only
- live GET https://api.wamp.land/api/leaderboards/global — #1 jonathan 195,436; #2 Farès 188,719; #3 KamiSawZe 78,444; #4 BigBaby123 16,739
- migrations/0019_progression.sql:1-15 — pxp_events with created_at and idx_pxp_events_user_created

**Fact-check (partially confirmed).**

Build the weekly board from `point_events`, not `pxp_events`: `SELECT user_id, SUM(points) FROM point_events WHERE created_at >= <Monday 00:00 UTC> GROUP BY user_id`. Apply the same legacy/generated-user filters (leaderboards.ts:243-244). This keeps the unit as "pts", matching the existing global tab (leaderboardModal.ts:897/964) and user_stats.total_points (points.ts:401-409). Use the existing index `idx_point_events_created_user (created_at DESC, user_id)` from migrations/0015:30-31; the `(user_id, created_at)` index on pxp_events is the wrong shape. Pull display names from users/user_stats. The viewer row should read in pts, not XP. Weekly totals still include publish points (300 per first publish), so stewards like jonathan will likely stay on top. Tag stewards (xp-badges-ratings-prd.md:513-520), or consider a clears/runs-only weekly variant. The prior-recommendation link is weak: PRD:620 "Holding Position" covers per-room-board daily PXP rewards, not a weekly global board. A cron hook already exists (worker.ts:261 `scheduled()`) for the optional weekly badge.

### F138: Jump height, ice and gravity zones change with screen refresh rate (120/144Hz vs 60Hz vs laggy 30fps)

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** How high you jump and how far you slide depends on your screen's refresh rate. On 120/144Hz screens (gaming monitors, MacBook Pros, most recent Android phones) a quick-tap jump is about half as high, ice slides half as far, and jumps inside gravity-flip zones are half as tall. A phone struggling at 30fps gets floatier, higher hops instead. So the same room is harder or easier depending on your device, and leaderboards aren't fair.

**Technical detail.**

Arcade physics uses Phaser's defaults, a fixed 60Hz step (fps 60, fixedStep true; no physics fps setting at main.ts:86-92 and no loop fps limit). Scene.update, which calls movementController.updateMovement, runs on every requestAnimationFrame. Several velocity changes run once per render frame and aren't scaled by delta: (1) the jump cut `velocity.y *= 0.85` (movementController.ts:646-653) and the 0.86 cut in gravity zones (839-846); (2) ICE_COAST_FACTOR 0.985 applied every frame (569-570, 780-781); (3) additive accelerations that use `Math.max(delta/1000, 1/60)`, which floors each frame at 1/60s. That makes directional gravity (712, 723-731), wind (675-679, 862-866) and ice acceleration (573-578) N/60 times stronger at N Hz. A simulation of this exact loop (scratchpad/jumpsim.mjs, dirgrav.mjs) gave: tap-jump apex 27px@30fps, 18px@60, 9.6px@120, 7.2px@144; full jump in a gravity zone 58px@60, 28px@120, 22px@144; ice slide after release 331px@30, 166px@60, 82px@120. The fix keeps today's 60Hz behaviour exactly, so published rooms and records stay valid: use `v *= Math.pow(0.85, deltaMs/16.667)` for multipliers and `dt = Clamp(delta/1000, 0, 1/30)` for additive terms. A more robust option is to apply the velocity changes once per physics step (scale by `this.physics.world.stepsLastFrame`, or move them into a 'worldstep' listener) while still reading JustDown input every frame. Do the same for camera lerp (see the camera finding). Add a vitest that runs the controller at 30/60/120/144Hz and asserts apex height within ±1px.

**Evidence.**

- src/scenes/overworld/movementController.ts:646-653 — `if (!jumpHeld && velocity.y < 0) setVelocityY(velocity.y * 0.85)` runs once per render frame, not scaled by delta
- src/scenes/overworld/movementController.ts:712 — `deltaSeconds = Math.max(delta / 1000, 1 / 60)` floors each frame at 1/60s, so per-frame gravity at 723-731 doubles at 120Hz
- src/scenes/overworld/movementController.ts:569-570 — ice coast multiplies velocity by 0.985 every frame
- src/scenes/overworld/movementController.ts:675-679 — wind push uses Math.max(delta/1000, 1/60)
- src/main.ts:86-92 — arcade physics config sets no fps/fixedStep, so Phaser defaults apply (node_modules/phaser/src/physics/arcade/World.js:159,170 fps=60, fixedStep=true)
- src/scenes/OverworldPlayScene.ts:2226-2228,2377 — comment confirms physics runs on UPDATE before Scene.update; updateMovement(delta) is called once per render frame

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

Keep the jump-cut, ice coast/acceleration and gravity-zone claims; they are confirmed and the line references are exact.

Corrections:
(1) **Tap jumps.** Normal-gravity full jumps are unaffected at any refresh rate. Only the part of the jump after release changes. Simulated apex for an 80ms tap: 36.8px at 30fps, 30.4 at 60Hz, 27.5 at 120Hz, 25.7 at 144Hz. That is about 10-15% lower at high refresh, not "half"; half only applies to a ~1-frame tap.
(2) **Wind.** In normal gravity, wind is a per-frame offset on a velocity that is reset every frame (movementController.ts:579-584). It is identical at 60, 120 and 144Hz and only doubles at 30fps. It builds up only while ice-coasting or when X is the gravity axis in left/right gravity zones.
(3) **The proposed blanket fix would add a bug.** Replacing the 1/60 floor with Clamp(delta/1000, 0, 1/30) for the wind and conveyor terms would halve wind at 120Hz, because those terms are re-added after a per-frame velocity reset. They must stay per-frame constants or move to the step.

The cleanest fix is to run the velocity mutations once per physics step: hook the arcade 'worldstep' event, or repeat them physics.world.stepsLastFrame times, while still reading JustDown input every frame. A pow(k, delta/16.667) rescale is only approximate under fixed-step timing. NPC ice in liveObjects/npcEnvironment.ts:3-4 uses the same 0.985 and 900 constants and probably needs the same review.

1) **Tap-jump: "about half as high" is too strong.** That only happens if jump is released on the very next frame (17.7px at 60Hz, 11.8 at 120Hz, 8.9 at 144Hz in my sim). A realistic tap is held for a while: at 50ms it is 24.4px vs 20.9px (-14%), and at 100ms it is 33.1 vs 32.1. Fully held jumps are the same at every rate (about 53.5px). So in normal gravity the change in jump feel is small for most real inputs.

2) **Wind is wrong as stated for normal gravity.** Horizontal velocity is overwritten every frame (movementController.ts:578-584) before the wind is added (675-679). So wind is a fixed per-frame offset of 980 × max(dt, 1/60) × windX: 16.3px/s at 60, 120 and 144Hz, and 32.7px/s at 30fps. Wind is not stronger on high-refresh screens. It is twice as strong on laggy ~30fps devices. It only builds up with refresh rate when velocity carries over between frames: on ice, or in sideways gravity zones where X is the gravity axis. The same applies to ice acceleration (573-578): its per-frame lerp is floored at 1/60, so it is faster at 120Hz. That part of the claim holds.

3) **Device scope is probably narrower than "most devices".** iOS Safari (and, by default, Safari generally) is believed to cap requestAnimationFrame near 60Hz; I did not verify this in the code. If so, iPhones and iPads are not in the 120Hz case. Chrome and Firefox on ProMotion Macs, 120-144Hz desktop monitors, and 90/120Hz Android phones are.

4) **Severity varies by case.** The worst problems are gravity-flip zones (all jumps and falls about half as tall at 120Hz) and ice. These are special tiles, so the leaderboard unfairness is limited to rooms that use them.

The proposed fix is still right: scale multipliers by `Math.pow(k, deltaMs/16.667)`, use `dt = Clamp(delta/1000, 0, 1/30)` for additive terms, or apply velocity changes once per physics step.

1. **Jump height.** Realistic short hops are about 10–25% lower at 120/144Hz and about 30% higher at 30fps, not "half". Full held jumps in normal gravity don't change. The severe case is gravity-plate rooms: jump height halves at 120Hz (about 58px down to about 28px), which can make published rooms impossible.
2. **Wind.** Wind is the same at 60, 120 and 144Hz in normal play, because x-velocity is reset every frame. It doubles only below 60fps. So the proposed fix `dt = Clamp(delta/1000, 0, 1/30)` must NOT be applied to wind on the normal path: it would halve wind at 120Hz. Treat wind as a fixed velocity offset there (or rework it into a real acceleration on purpose). Only scale it by dt where velocity builds up (ice, sideways gravity).
3. **The fix's "exactly" claim.** The fix keeps 60Hz behaviour approximately, not exactly, because Phaser's smoothed delta wobbles around 16.67ms. Applying the velocity changes once per physics step (scaling by world.stepsLastFrame, or a WORLD_STEP listener) gives an exact match.
4. **NPCs and conveyors.** The NPC helpers in liveObjects/npcEnvironment.ts (lines 76 and 93-98) use the same per-frame ice coast and the same 1/60-floored dt, so they need the same treatment. The conveyor add at movementController.ts:672-673 is unscaled per frame; on ice it builds up, so it needs the same fix too.

### F139: Pits never kill: invisible floor under rooms, and falling into the room below abandons your timed run

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** defect · **impact:** high · **effort:** medium

**Summary.** Falling into a pit doesn't kill you. If there's no room below, you land on an invisible floor at the bottom of the screen. If there is a room below, you drop into someone else's room and your timed run is quietly abandoned. So the most basic platformer challenge, 'don't fall in the hole', can't be built without lining every pit with spikes, and in goal rooms one missed jump costs the whole run instead of a quick retry.

**Technical detail.**

In play mode, runtimeController.syncEdgeWallsForRoomIds creates a solid edge wall for every neighbour that isn't traversal-ready, including the one below (runtimeController.ts:269-277; bottom wall at 390-394, 12px thick, inside the room's bottom row). The void-death check only fires 2 room-heights below the room (RESPAWN_FALL_DISTANCE = ROOM_PX_HEIGHT*2, OverworldPlayScene.ts:311, 4398-4407), and the invisible floor stops you first, so 'You fell.' only happens if collision fails. When the room below is playable, the transition goes ahead: shouldBlockRoomTransition only blocks on a PvP lock or an unreachable neighbour (roomTransition.ts:258-273). goalRuns.syncRunForRoom then calls clearRunForRoomExit, which abandons the active run (goalRuns.ts:174-187, 871-884). Fix in two parts. (1) While a single-room goal run or course run is active, treat leaving downward out of the run's rooms as a death: in maybeAdvancePlayerRoom, if next.y > current.y and the next cell is not part of the active run/expanded room, call sessionResetController.handlePlayerDeath('You fell.') instead of transitioning. (2) Add a per-room setting `pitsAreDeadly`, stored like cameraMode (roomModel.ts:123). When it's on, replace the bottom edge wall with a kill sensor about 8px below the room. Default it on for newly created goal rooms and off for already-published rooms so nothing existing changes. Draw a red dashed kill line in the editor. For readability, let the player drop ~1 tile out of view with the camera stopped (~200ms) before respawning.

**Evidence.**

- src/scenes/overworld/runtimeController.ts:269-277 — every orthogonal neighbour that isn't traversal-ready gets an edge wall, including the one below
- src/scenes/overworld/runtimeController.ts:390-394 — `deltaY === 1` wall placed at the room's bottom edge (invisible floor)
- src/scenes/OverworldPlayScene.ts:311 — RESPAWN_FALL_DISTANCE = ROOM_PX_HEIGHT * 2 (704px below the room before 'You fell.')
- src/scenes/OverworldPlayScene.ts:4398-4407 — maybeRespawnFromVoid only fires past that distance
- src/scenes/overworld/goalRuns.ts:174-187 — entering a different room calls clearRunForRoomExit → abandonActiveRun
- src/scenes/overworld/roomTransition.ts:258-273 — transitions are blocked only for a PvP lock or an unreachable neighbour, not for active goal runs

**Fact-check (confirmed, partially confirmed, partially confirmed).**

1. The run is not abandoned "quietly". abandonActiveRun shows the transient status "Run abandoned." (goalRuns.ts:581-595).
2. The abandon-on-drop only applies to single-room goal runs. During a course run, a room below that is not part of the course is unreachable (runtimeController.ts:302-330), so the player lands on the invisible floor instead. The fix's "or course run" branch only matters for course rooms that connect downward or for the expanded-room exception.
3. "Instead of a quick retry" overstates what death does today. In a qualified (non-practice) goal run, death respawns the player and the same run continues. Only practice runs and survival runs restart (sessionReset.ts:51-108).
4. The 'You fell.' check sits at 3 room-heights below the room origin (2 below the room's bottom edge), not "2 room-heights below the room".

(a) The abandon is not 'quiet'. abandonActiveRun sets transientStatus 'Run abandoned.' (goalRuns.ts:581-595), and objectiveController.applyGoalRunMutation shows transient statuses (objectiveController.ts:406-440+). The player does see a toast. If the room below has its own goal, the new run's start may replace that message.

(b) Course runs are mostly already protected. With an active course, isNeighborReachable returns false for any neighbour outside the course (runtimeController.ts:301-327). The player hits the invisible floor and the run is not abandoned. The one exception is an expanded-room course run, which may leave into any playable outside cell (runtimeController.ts:321-324). So fix part (1) is really needed only for single-room goal runs, plus that expanded-room case.

(c) The title 'Pits never kill' is slightly overstated. Spikes/hazards placed in a pit do kill, and in a qualified run a death respawns you while the timer keeps going (sessionReset.ts:60-110). The real gap is that there is no way to make the room's bottom edge itself deadly.

There are no deadly pits. A gap in the floor above an empty or frontier cell acts as an invisible floor (a 12px static wall in the bottom of the room). Falling into a playable room below moves you into that room. In a single-room goal run, that abandons the run and shows a 'Run abandoned.' toast, so it is not silent. Re-entering by walking back in only gives a practice run, so the ranked attempt is lost until the player re-launches the room. Non-expanded course runs are walled at non-course neighbours, so there you get the invisible floor, not abandonment.

Fix (1) must be narrower than proposed: only qualified runs, or only rooms that opt in. Otherwise every overworld explorer who drops out of a goal room is trapped, because any transition into a goal room starts an active practice run. Make it a per-room opt-in. The cleanest option is the proposed pitsAreDeadly flag: with it on, treat a downward exit as a death that respawns the player at the run start and keeps the qualified attempt (deaths++), instead of transitioning to the room below. Rooms with the flag off keep today's behaviour.

Classify this as an improvement or design gap rather than a defect. Builders can already approximate pits with the Spikes or Lava Pool hazards.

### F141: Add respawn checkpoints: deaths in courses/expanded rooms send you back to the very first screen

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** improvement · **impact:** high · **effort:** medium

**Summary.** Dying anywhere in a multi-room course or expanded room (up to 16 screens) sends you back to the very first room. Even 'Checkpoint Sprint' rooms respawn you at the start instead of your last checkpoint. A checkpoint flag that builders can drop anywhere, plus making Checkpoint Sprint markers count as respawn points, would make long levels fun instead of punishing, which is how Mario Maker and Celeste handle long stages.

**Technical detail.**

respawnPlayerToCurrentRoom (OverworldPlayScene.ts:4410-4423) sends any death during an active course to respawnPlayerToCourseStartRoom (4438-4463). Expanded rooms and courses can have up to 16 cells (courses/model.ts:125-126). sessionReset.handlePlayerDeath always respawns via that path (sessionReset.ts:51-63). playerLifecycle.getPlayerSpawn only knows the course start point or the room spawn (playerLifecycle.ts:146-160). There is no checkpoint/respawn object: 'flag' is the goal marker and 'spawn_point' is limited to one per room. Implementation: (1) add runtime state `respawnOverride: {roomId, x, y} | null` on the scene. (2) New interactive object 'checkpoint_flag' (objects.ts, behavior 'static'), with an overlap wired in interactionCoordinator like other interactives. On first touch it sets the override, plays the existing 'goal-checkpoint' cue and switches to a raised-flag frame. (3) In checkpoint_sprint runs, also set the override when goalRuns records a checkpoint. (4) getPlayerSpawn checks the override first, and respawnPlayerToCurrentRoom skips the course-start branch when an override exists. (5) Clear the override in sessionReset.resetPlaySession and restartCurrentRun. The timer keeps running and deaths still count, so leaderboards stay fair. Make sure ranked trace verification tolerates the respawn teleport (POSITION_SLACK_PX in cloudflare/worker/runs/verification.ts may need a 'respawn' event in the trace).

**Evidence.**

- src/scenes/OverworldPlayScene.ts:4410-4423 — any death during an active course respawns at the course start room
- src/courses/model.ts:125-126 — MAX_EXPANDED_ROOM_CELLS = 16; MAX_COURSE_ROOMS = 16
- src/scenes/overworld/sessionReset.ts:51-63 — handlePlayerDeath → recordDeath → respawnPlayerToCurrentRoom (no checkpoint logic)
- src/scenes/overworld/playerLifecycle.ts:146-160 — spawn is the course startPoint or the room start, nothing else
- src/goals/roomGoals.ts:41-47 — checkpoint_sprint already stores checkpoint marker positions that could double as respawn points

**Fact-check (confirmed).**

1) The evidence for courses cites the wrong type. src/goals/roomGoals.ts:41-47 is the single-room CheckpointSprintGoal; in a single room, dying returns you to that same room's spawn, which is much less punishing. The type that matters for courses and expanded rooms is CourseCheckpointSprintGoal (src/courses/model.ts:59-62). Its checkpoints are CourseMarkerPoints that carry a roomId, and goalMarkers.ts:117-125 (toWorldCoursePoint) already turns them into world positions. That makes step (3) a small change on its own: when checkpointsReached > 0, respawn at goal.checkpoints[checkpointsReached-1]. 2) The "very first screen" behaviour applies only during an active course or expanded-room run. In free-roam overworld play you respawn at the current room's spawn. 3) The ranked-verification caveat understates the problem. verifyPath (src/cloudflare/worker/runs/verification.ts:566-575) fails any breadcrumb step that jumps more than one room (trace_transition), on top of the POSITION_SLACK_PX=80 speed check. It runs for courses (courses/routes.ts:518) and expanded rooms (expandedRooms/runRoutes.ts:428). Today's start-room teleport in a large course can probably already trip that check whenever verification runs, so the implementation needs an explicit respawn event in the trace (src/scenes/overworld/rankedRunTraceRecorder.ts) that verifyPath skips. It is not a "may need". 4) The current behaviour was introduced on purpose (commits b75196f0 and a0815c67), so frame this as an upgrade that respawns only at checkpoints the player has touched, not as reverting to current-room respawn.

### F147: Add hitstop, a short death beat, the unused death sound, and hold-to-bounce higher on stomps

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Hits and deaths lack punch. Killing an enemy doesn't freeze the action for a split second. Dying teleports you back to the start in the same frame, with no moment to see what got you. The game has a dedicated death sound that's never played (it reuses the 'goal failed' jingle). And stomping an enemy gives the same small hop whether or not you hold jump. These are cheap fixes that make every interaction feel better.

**Technical detail.**

Kill feedback today is only shakeCamera(50, 0.002) for the sword (combatController.ts:258) and 40ms for the gun; the codebase has no hitstop. Death: sessionReset.ts:62-63 plays the fail FX and respawns in the same frame. playPlayerFailFx calls playGoalFx('fail') (OverworldPlayScene.ts:1630-1634), which plays the 'goal-fail' cue (fx/controller.ts:184 branch), while the 'player-death' cue (audio/sfx.ts:170-175) is never referenced. The stomp bounce is a fixed JUMP_VELOCITY*0.58 = -162px/s, about 19px (OverworldPlayScene.ts:675; liveObjects/enemyLifecycle.ts:150-173). Changes: (1) 40-60ms hitstop on sword, stomp and butt-stomp kills (physics.world.pause() then resume via a real-time setTimeout, since the scene clock may also be paused), skipped in PvP. (2) Death beat: hide the sprite, play a burst plus 'player-death', hold ~200ms, respawn with a 120ms fade-in; total under 400ms so retries stay fast. (3) Stomp rule: if jump is held at contact, bounce with the full JUMP_VELOCITY (-280); otherwise -162. This enables enemy-bounce chains as a builder tool. (4) Squash/stretch tweens on jump (scaleY 1.12, 80ms) and land (0.88, 90ms) where landing dust fires (playerPresentation.ts:137-140). Also only play 'land' sfx/dust for falls over ~20px to avoid spam on small steps.

**Evidence.**

- src/scenes/overworld/sessionReset.ts:62-63 — playPlayerFailFx() then respawnPlayerToCurrentRoom() in the same call
- src/scenes/OverworldPlayScene.ts:1630-1634 — death FX reuses playGoalFx('fail') (goal-fail cue)
- src/audio/sfx.ts:170-175 — 'player-death' cue defined but not referenced anywhere outside sfx.ts
- src/scenes/OverworldPlayScene.ts:675 — enemyStompBounceVelocity = JUMP_VELOCITY * 0.58 regardless of jump held
- src/scenes/overworld/combatController.ts:258 — sword kill feedback is a 50ms camera shake only

**Fact-check (partially confirmed).**

Keep: add 40-60ms hitstop on sword, stomp and butt-stomp kills, skipped in PvP; add a short death beat (hide the sprite, burst, hold about 200ms, then respawn with a fade-in) instead of respawning in the same frame (sessionReset.ts:62-63); add squash/stretch, and play landing dust only after a minimum fall height (playerPresentation.ts:137-140).

Fix the premises:
(a) 'player-death' (sfx.ts:170-175) is not a separate sound. It plays the same game-fail.wav as 'goal-fail' (sfx.ts:226-229) at 0.92 playback rate. Simply switching to it changes almost nothing. A distinct death sound needs a new audio file. Also stop the 'respawn' sfx (OverworldPlayScene.ts:4435) from playing in the same frame as the death sound.
(b) Stomp bounce height already depends on holding jump. The jump cut at movementController.ts:646-652 multiplies upward speed by 0.85 per frame when jump is released (about 6px released vs about 17px held). The real proposal is to raise the held stomp bounce toward the full JUMP_VELOCITY (about 54px) so enemy-bounce chains work; there is no hold rule to add.
(c) Kills already get hit and dust animations, a flash and the 'enemy-kill' sfx (fx/controller.ts:50-62). What's missing is hitstop, plus a camera shake on stomps; the sword (combatController.ts:258) and gun (:157/:167) already shake on hit.

### F145: Player sprite is ~38px tall but the airborne hitbox is 14px: head sinks into ceilings, air slash hits at knee height

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** defect · **impact:** medium · **effort:** medium

**Summary.** The character art is about 38px tall, but in the air its collision box is only the bottom 14px (26px when standing). When you jump into a ceiling, your head and shoulders visibly sink about 1.5 tiles into the blocks. In the air, things touching your head don't hurt you, and your sword slash only reaches knee height. It looks broken in clips and makes air combat feel off.

**Technical detail.**

OverworldPlayScene.ts:355-357 sets PLAYER_HEIGHT 14, STANDING 26 and CROUCH 14. getPlayerHitboxHeight returns the 14px height whenever the player isn't grounded (movementController.ts:1186-1188). Measured from public/assets/player/default/PlayerSheet.png: idle frame 0 is visible from y=44 to 84 in a 96×84 frame (~40px), and jump-rise frame 32 is ~39px. The sprite is drawn with origin (0.5,1) at body.bottom+2 (playerLifecycle.ts:100; defaultPlayer.ts:258), so in the air ~24px of the sprite sits above the collision top. The air forward-slash rect is body.top+2 with height body.height+10 (combatController.ts:212-219), covering roughly bottom-12 to bottom+12. Fixes, cheapest first: (a) always build the forward slash rect from the standing profile (bottom-26 … bottom+4) regardless of the current body height. (b) In the air, use the standing height (26) when canPlayerFitHitbox(26) passes (the logic exists at 1396-1445) and shrink to 14 only when needed to fit a gap, so 1-tile tunnels still work. (c) When rising, probe at bottom-26 and zero upward velocity (head bonk) before the sprite visibly enters terrain. (d) Longer term, scale avatar art so the visible height is about the standing hitbox + 4-6px. Keep hazard hurtboxes slightly lenient (inset 2-3px, Celeste-style) rather than 60% smaller. Before shipping (b), run a script over published rooms to flag 1-tile-high mid-air slots, since it can change passability.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:355-357 — PLAYER_HEIGHT = 14, PLAYER_STANDING_HEIGHT = 26, PLAYER_CROUCH_HEIGHT = 14
- src/scenes/overworld/movementController.ts:1186-1188 — `if (!groundedProfile) return this.options.playerHeight` (14px whenever airborne)
- public/assets/player/default/PlayerSheet.png — measured alpha bbox: frame 0 y 44→84 (~40px), frame 32 ~39px visible height
- src/scenes/overworld/combatController.ts:212-219 — forward slash rect = body.top+2, height body.height+10 (knee height when airborne)
- src/scenes/overworld/playerLifecycle.ts:100 — sprite origin (0.5,1) anchored at the body bottom

**Fact-check (confirmed).**

Nearly all facts check out. Three adjustments:
- The airborne 14px body is an intentional legacy profile: commit 10a2cba6's feature-ledger entry says it "keeps the legacy 14px airborne body". Treat this as a feel and visual improvement with a passability trade-off, not a pure defect.
- The sprite is anchored at body.bottom+2 in playerPresentation.ts:113-114. playerLifecycle.ts:100 only calls setOrigin(0.5,1).
- The visible head also sits 12px above the 26px standing box, so the sprite clips even when grounded in 2-tile corridors.
The forward-slash rect fix (a) is small on its own. Changing the airborne collision height (b) or adding a head probe (c) can block existing published routes, so it needs a published-room scan first.

### F153: Sword only checks hits on the button-press frame; 'damage' values actually control max hits and bullet radius

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** The sword only checks for hits on the exact frame you press the button, even though the slash animation lasts 170ms, so an enemy that walks into the swing a moment later isn't hit. Separately, the code's 'damage' numbers actually control other things (how many enemies one swing can kill and how big bullets are), which will trip up future work on enemy health or bosses.

**Technical detail.**

performSwordAttack computes attackRect once and calls attackEnemiesInRect at press time (combatController.ts:212-221), while SWORD_ATTACK_MS = 170 (OverworldPlayScene.ts:398). swordHitDamage: 3 and gunHitDamage: 5 (OverworldPlayScene.ts:1601, 1606) are passed through the host (1572-1584) into attackEnemiesInRect(rooms, rect, maxHits) (liveObjects.ts:1308-1313) and attackEnemyAtPoint(rooms, x, y, radius) (liveObjects.ts:1316-1322). So a slash kills at most 3 enemies and bullets use a 5px radius instead of the 6px default; enemies have no HP and defeatEnemy always one-shots. Fix: keep `activeSwing {rectRelativeToPlayer, until: now+100ms, hitKeys: Set}` and re-test each frame during the active window, hitting each enemy at most once per swing. Rename the host params to maxHits/radius now, and add a real `damage` field when enemy HP is introduced.

**Evidence.**

- src/scenes/overworld/combatController.ts:212-221 — one attackRect evaluated once per press
- src/scenes/OverworldPlayScene.ts:398 — SWORD_ATTACK_MS = 170
- src/scenes/OverworldPlayScene.ts:1572-1584,1601,1606 — 'damage' 3/5 passed as the third argument
- src/scenes/overworld/liveObjects.ts:1308-1322 — the third parameter is maxHits (sword) and radius (gun)

**Fact-check (confirmed).**

The core claim needs no correction. Additions for whoever implements it:
1. Recompute the active-swing rect from the current playerBody each frame. A rect saved at press time would leave the hitbox behind as the player moves, which is the problem being fixed.
2. Include attackPeerInRect (PvP, combatController.ts:222) in the active window, hitting each peer at most once per swing.
3. Defer the hit-only effects to the first frame that actually connects: enemy-hit sfx, downward-slash bounce, lunge knockback and camera shake (lines 235-258).
4. The per-swing hit Set is not needed for normal enemies today, because defeatEnemy removes them on the first hit. It is still useful later, and for invincible NPCs and Sword Hunters, which currently only rate-limit their "can't be defeated" toast with a 700ms cooldown (enemyLifecycle.ts:226-231).
5. Renaming: swordHitDamage 3 should become swordMaxHitsPerSwing, and gunHitDamage 5 should become gunHitRadius (5px instead of the 6px default).

### F149: Retune jump forgiveness: coyote 80→110ms, cap landing buffer, shorter wall-jump lock, add corner correction

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** The jump forgiveness is a bit stingy or odd compared with Celeste. Coyote time (the grace period after running off a ledge) is only 80ms. An early jump press is remembered for 240ms, so a tap well before landing comes out as a tiny hop. Wall jumps lock your steering for 240ms. And there's no 'corner correction', so clipping a ceiling corner by one pixel kills your jump. Small number changes would make jumps feel fairer without making rooms easier to cheese.

**Technical detail.**

OverworldPlayScene.ts:364-371 sets COYOTE_MS 80, JUMP_BUFFER_MS 100, WALL_JUMP_BUFFER_MS 240 and WALL_JUMP_INPUT_LOCK_MS 240. Every airborne press uses the 240ms wall buffer (movementController.ts:619-625), and that buffer also triggers ground jumps on landing (630-637). The jump cut (646-653) then shortens a buffered jump if the button was already released, producing a ~18px 'mini hop' at 60Hz. The wall-jump lock forces vx = ±205 for 240ms, about 49px (551-557). Recommendations: coyote 110ms. Landing buffer 120ms: track `wallJumpBufferUntil` separately and keep 240ms only for wall jumps. For buffered or coyote jumps, skip the cut for the first ~70ms (a minimum jump height). Wall lock 160ms, and let input toward the new wall cancel it after 100ms. Corner correction: when rising and blocked.up, test shifting ±1..4px using host.isSolidTerrainAtWorldPoint at the head corners and nudge if clear, mirroring how tryApplySingleTileGapAssist probes feet (1229-1335). Ledge pop: when moving into a wall with vy >= -40 and the foot within 4px below a free ledge top, snap up. All of these only add forgiveness, so published rooms stay beatable. Leaderboard times may improve slightly; mention it in release notes.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:364-371 — COYOTE_MS 80, JUMP_BUFFER_MS 100, WALL_JUMP_BUFFER_MS 240, WALL_JUMP_INPUT_LOCK_MS 240
- src/scenes/overworld/movementController.ts:619-625 — airborne presses get wallJumpBufferMs (240ms), later consumed as a ground jump at 630-637
- src/scenes/overworld/movementController.ts:551-557 — horizontal velocity forced to ±205 during the wall-jump lock
- src/scenes/overworld/movementController.ts:1229-1335 — foot-probe gap assist exists; no equivalent head-corner correction

**Fact-check (partially confirmed).**

1) The tap mini-hop is about 14px at 60Hz, not about 18px (simulated with JUMP_VELOCITY -280, GRAVITY 700, 0.85 cut per frame). A full jump is about 54px, roughly 3.4 tiles. The cut is also frame-rate dependent. It runs once per scene update, but Phaser 3.90 Arcade physics uses fixedStep at 60Hz by default (node_modules/phaser/src/physics/arcade/World.js:170). On 120Hz phones and monitors the cut runs about twice per physics step, so short hops and early releases come out shorter. Any minimum-jump or cut fix should be time-based, e.g. scale by 0.85^(delta/16.67). 2) JUMP_BUFFER_MS=100 is effectively dead code, which strengthens the claim. Splitting the buffers as proposed is right; the fix is to apply the 240ms window only in the tryPerformWallJump branch. 3) "All of these only add forgiveness, so published rooms stay beatable" is false. Capping the landing buffer at 120ms takes forgiveness away. Cutting the lock to 160ms shrinks forced horizontal travel from about 49px to about 33px with neutral input, or about 45px holding away. Published wall-jump gaps or ledges that depend on the current 240ms push could become harder or impossible. Safer: keep 240ms and add an early cancel (e.g. after 120ms when input points the other way), then QA in authored wall-jump rooms before changing the duration. 4) Every change must also go into the duplicated directional-gravity path (movementController.ts:735-737 coyote, 767 lock, 805-834 buffer). Otherwise jumps under gravityUp/Left/Right will behave differently. 5) Corner correction that only probes host.isSolidTerrainAtWorldPoint will miss solid runtime objects such as crates and moving platforms (isSupportedBySolidRuntimeObject, 495). In Arcade it also has to run before the collision zeroes vy, e.g. a pre-step probe of the head corners, or restoring vy after the nudge.

### F146: Follow camera bobs with every jump and doesn't look ahead

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** In the default follow camera, the screen chases every hop, moving up and down on each jump, and it doesn't shift ahead in the direction you're running, so you see less of what's coming. Mario-style cameras hold still vertically until you land on a new height and lead the view ahead of you, which makes platforming easier to read and is easier on the eyes on a phone.

**Technical detail.**

cameraController.startFollow calls camera.startFollow(player, true, 0.12, 0.12, 0, offsetY) with no setDeadzone and a fixed X offset of 0 (cameraController.ts:168-180; FOLLOW_CAMERA_LERP = 0.12 at OverworldPlayScene.ts:312). Phaser applies the lerp once per render frame (node_modules/phaser/src/cameras/2d/Camera.js:550-551), so it tracks tighter on 120Hz screens. Changes: (1) camera.setDeadzone(≈48 × 64 world px, converted to screen px with the current zoom) and refresh it when zoom changes. (2) Vertical platform-snap: move the vertical target only on landing (grounded edge) or when the player leaves the deadzone while falling. (3) Lookahead: each frame ease camera.followOffset.x toward -facing * min(48, 0.12 * visibleWorldWidth) with ~300ms smoothing, only while |vx| > 20, and combine it with the mobile Y offset from getMobilePlayFollowOffsetY (camera.ts:73-89). (4) Make the lerp delta-correct: setLerp(1 - Math.pow(0.88, delta/16.667)) each frame. Leave the per-room 'room' camera mode (cameraController.ts:40-83) unchanged. Small, self-contained change; test on a phone in portrait.

**Evidence.**

- src/scenes/overworld/cameraController.ts:168-180 — startFollow with lerp 0.12 on both axes, X offset 0, no deadzone
- src/scenes/OverworldPlayScene.ts:312 — FOLLOW_CAMERA_LERP = 0.12
- node_modules/phaser/src/cameras/2d/Camera.js:550-551 — lerp applied per frame via Linear(), not scaled by delta
- src/scenes/overworld/camera.ts:73-89 — the only follow offset is a mobile vertical anchor

**Fact-check (partially confirmed).**

1. Phaser's deadzone is measured in world pixels, not screen pixels. In Camera.js preRender (around lines 513-579), the deadzone is centered on camera.midPoint, which is the world-space center (scrollX + width/2), and compared against follow.x/y, which are also world coordinates. So setDeadzone(w, h) takes world pixels directly. Converting by the current zoom, as the claim suggests, would make it about 2x the intended size at desktop fit zoom (about 2.18). The deadzone still has to be re-applied on resize/zoom (handleResize at OverworldPlayScene.ts:2795 calls applyCameraMode, then startFollowCamera), but only so it stays a sensible fraction of the visible area, not to convert units.
2. A centered 48x64 deadzone only absorbs ±32 px vertically. A full jump rises about 56 px, so the camera would still move about 24 px each hop. Either make the deadzone about 120 px tall, offset it so the standing player rests at its bottom edge, or rely on step (2), moving the vertical target only on landing using movementController's grounded flag, which is what actually removes the bob.
3. Lookahead should use Phaser's sign convention: the camera aims at follow.x - followOffset.x, so followOffset.x = -facing * lead. The claim gets this right. Each frame's update must keep the mobile followOffset.y from getMobilePlayFollowOffsetY.
4. Effort: steps (1), (3) and (4) are small. The landing snap in step (2) needs the grounded/landing signal passed from movementController into the camera controller, plus tuning on desktop and phone portrait. Small to medium overall; small is acceptable with AI agents.

### F154: 'Water Pool'/'Water Ripple' objects kill on touch, and their descriptions wrongly say swimming doesn't exist

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** A builder who places the 'Water Pool' or 'Water Ripple' object gets instant-death water, and the description says swimming doesn't exist yet. Swimming does exist, through water tiles. So builders who want a swimmable pool pick the obvious object and end up with a death trap.

**Technical detail.**

objects.ts:301-302 defines water_surface_a/b in category 'hazard' with descriptions 'No swim move exists yet, so it is lethal.' and 'lethal for now'. The hazard default branch kills on overlap (hazardController.ts:100-105). Swimming is implemented: special tile kind 'water' (tilesets.ts:380; SPECIAL_TILE_LOCAL_INDICES.water = 13) sets environment.inWater (specialTiles.ts:450-451), which drives swim kicks, reduced gravity and capped fall speed (movementController.ts:43-46, 612-618, 669-671). Fix without changing existing rooms: add new swimmable ids ('water_pool_swim') whose body is an inWater volume. Extend specialTilesController.getEnvironmentForBody to also OR in overlapping water-volume objects, or have the object stamp water special tiles under itself at load. Rename the old objects 'Toxic Water' with accurate descriptions. Update the editor palette grouping so swimmable water sits next to the water tiles.

**Evidence.**

- src/config/objects.ts:301-302 — water_surface_a/b: category 'hazard', 'No swim move exists yet, so it is lethal.'
- src/scenes/overworld/liveObjects/hazardController.ts:100-105 — the hazard default branch calls handlePlayerDeath
- src/scenes/overworld/specialTiles.ts:450-451 — 'water' special tiles set inWater (swimming exists)
- src/scenes/overworld/movementController.ts:43-46 — WATER_MOVE_FACTOR / SWIM_KICK / gravity constants

**Fact-check (confirmed).**

Facts are accurate. Minor framing fix: the objects already warn that they are lethal, so builders are not surprised by the death. The defect is the false statement that swimming doesn't exist, plus no swimmable water object next to these in the palette. Swimming is only reachable through the Special tiles 'Water' entry, 'Swim zone tile.' (tilesets.ts:500-503). Also, the 'water' tileset at tilesets.ts:809 is a terrain/theme tileset, not the swim tile. The swim tile is special-tile index 13.

**2026-10-06 release preparation (not implemented).** Read-only production D1 at 08:32:03.269Z confirms 666 published rooms and **1,121** legacy water objects across **42** rooms: 728 Water Pool objects in 35 rooms and 393 Water Ripple objects in 28 rooms. Every query reports zero rows written. Retain both existing ids, body bounds and lethal behavior so authored hazards and NPC interactions stay compatible. Add distinct swimmable ids using the existing animated artwork and accurate names; rename the legacy palette entries Toxic Water Pool/Ripple with a clear lethal description. Feed non-solid terrain-layer water volumes into the shared environment scan, including per-body/NPC queries, and keep decorative background/foreground placements visual only. The existing runtime-solid spatial query excludes liquids; add a bounded water partition rather than scanning every loaded object on each physics tick. Check entering/leaving volumes, exact touching edges, overlapping old toxic hazards, existing water-tile swimming, resets, gravity directions, editor persistence and verified local guest clears. Swimming already clears the F149 buffered launch grace through the existing movement path.

The authoring asset contract serializes the complete built-in object registry, including names/descriptions. Even a copy-only registry change alters its hash. This item therefore needs a coordinated staged renderer and API Worker release, readiness/coverage proof and guarded activation before Pages. It must not use Pages-only delivery. First Build Prompt remains unset. No water catalog, runtime, production room, fixture/account or UI changes were made during this preparation. Evidence: `/tmp/wamp-f154-production-water-audit.json` and `/tmp/wamp-f154-prior-snapshot-audit.json`. F154 stays unchecked.

### F142: Idea: Ghost races against the #1 run and your personal best

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** Let players race a see-through ghost of the room's #1 run, or their own best. It turns every leaderboard into both a teacher and a rival, which is the core time-trial loop in Trackmania and Mario Kart. It's fun because you can see exactly where the top player is faster. Builders do nothing: every room with a goal gets it automatically. WAMP already records most of the data needed.

**Technical detail.**

The data mostly exists: RankedRunTraceRecorder records breadcrumbs (x, y, vx, vy, grounded) every 250ms plus input and room-transition events (rankedRunTraceRecorder.ts:11, 19-29; runs/verificationTrace.ts:11-31). Traces are sent with ranked runs, but the Worker only keeps them in run_verification_audit when an audit runs (cloudflare/worker/runs/routes.ts:412-419; migrations/0021_ranked_run_trace_verification.sql:26-34). Plan: (1) lower BREADCRUMB_INTERVAL_MS to 100ms and add an animation-state byte (a 60s run is ~600 points, ~25KB). (2) When finalizing a ranked run that becomes the room-version #1 or the user's personal best, write the trace to R2 at ghosts/{roomId}/{version}/{userId}.json. (3) Add a GET endpoint for the top or PB ghost. (4) Client playback: Hermite-interpolate between breadcrumbs using vx/vy, and render through the existing remote-player/presence ghost renderer (multiplayerRemotePlayerRenderer.ts, presence ghosts with avatar packs), starting on the goal-run 'start' event. Add a 'Race #1' / 'Race my best' toggle in the goal intro or leaderboard modal; courses use the recorded roomTransitions. Low cost on mobile: one extra sprite.

**Evidence.**

- src/scenes/overworld/rankedRunTraceRecorder.ts:11 — BREADCRUMB_INTERVAL_MS = 250 with x/y/vx/vy/grounded per breadcrumb
- src/runs/verificationTrace.ts:11-31 — trace schema already includes breadcrumbs and room transitions
- src/cloudflare/worker/runs/routes.ts:412-419 — the trace is persisted only into the audit table when audited
- src/scenes/overworld/multiplayerRemotePlayerRenderer.ts — existing remote-player sprite rendering to reuse for ghost playback

**Fact-check (partially confirmed).**

Keep the idea but fix the plan.
- **Sampling:** do not lower BREADCRUMB_INTERVAL_MS for all ranked runs. Either keep 250ms and use Hermite smoothing from vx/vy, or record a separate, capped ghost stream. If the interval does change, raise MAX_BREADCRUMBS (verification.ts:22) to match, or long runs fail with 'trace_size'.
- **Ghost payload:** at finalize, when isNewPersonalBest is true or the run takes #1, save a stripped payload keyed by attemptId: breadcrumbs, roomTransitions, avatarId, elapsedMs. Leave out the nonce, snapshotHash and inputEvents. Store it in a new D1 run_ghosts table, or add an R2 binding; none exists today.
- **Lookup:** find the #1 ghost through the existing leaderboard query's top attempt_id, so equivalent versions are covered.
- **Rendering:** write a small standalone GhostRacePlayback class. Reuse ensureSceneAvatarPackLoaded and the sprite/animation setup, but not MultiplayerRemotePlayerRenderer or the PartyKit presence ghost map.
- **Look:** style it clearly apart from live presence ghosts, for example with a label like "#1 name 12.3s".
- **Discontinuities:** snap instead of smoothing across deaths, respawns, portals and room jumps.
- **Scope:** start with time-ranked goals only.
- **Docs:** note the existing PRD line at docs/product/product-requirements.md:461.

**Delivery (2026-10-06, PRs #73/#74/#75; final app main `b05c96ed`).** Delivered for time-ranked ordinary rooms. No ghost / Race #1 / Race my best use a standalone noncolliding avatar, the real run clock, safe Hermite movement, death/portal/seam snaps and refreshed newly beaten bests on Restart. Migration 0059 retains bounded movement-only personal bests; exact/equivalent family lookup uses the actual winning attempt. Verified guest bests persist on this browser. Private credentials/inputs/analytics stay excluded; old or mismatched recordings remain explicitly unavailable. The original reported game time is independently verified before trusted recording, while public timestamps/velocities align to the stored ranked time. Ranking/XP policy and 250ms trace sampling remain unchanged. Expanded Room/course and score/protect ghosts stay outside this first release.

All seven full checks pass with 356 files / 2,841 tests. Eight source and eight published desktop/touch cases plus two unchanged official public-API iterations each pass; actual screenshots are viewed and unexpected errors are zero. Exact source/main checks, guarded API/Pages delivery, strict map/live smoke and all 179 served JS/CSS assets plus death audio/HTML bootstrap pass. Fixture writes stay local, first Build Prompt stays unset and primary edits stay preserved. Master 54/214. See `docs/development/checkup-delivery-2026-10-03.md` and ignored `output/web-game/ghost-races/` for acceptance; F143 is next.

### F143: Idea: Traversal object pack: crumbling blocks, sideways springs, double-jump feather

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** Add three new drop-in objects that greatly widen what builders can make: crumbling blocks that fall a moment after you step on them, sideways and diagonal springs, and a 'feather' that gives one extra mid-air jump and reappears after a few seconds. Each is one click to place and instantly readable to players: crumble blocks create urgency, springs create flow, and feathers create routing choices. None of them exist yet.

**Technical detail.**

Hooks: (a) Crumble block: a solid runtime object (isSolidRuntimeObjectConfig / getRuntimeSolidLiveObjectsInBounds, which movement already uses for standing support at movementController.ts:1460-1510), with a runtime state machine idle → shaking 400ms → gone 2s → respawn, using the same runtime.cooldownUntil/activatedUntil fields the bounce pad uses (hazardController.ts:122-139). Disable the body while gone and fade in when it returns. (b) Side and diagonal springs: reuse addBouncePadInteraction (hazardController.ts:109-149) with a placed-object direction field (same pattern as policeBehaviorMode normalizers in enemies/policeEnemy.ts). Set vx/vy, grant externalLaunchGrace so the jump cut doesn't shorten the launch, and lock horizontal input for ~180ms using the existing weapon-knockback override (movementController.ts:359-368, 549-550). (c) Feather: add `airJumpsAvailable` to movement state. In updateMovement, when jumpPressed && !grounded && coyote <= 0 && the wall jump fails, consume it and jump (612-637). Pick it up through the collectible overlap path (liveObjects/collection.ts), but use a respawn timer instead of permanent collection. Art for all three can be generated with PixelLab. Roughly one day each with agents.

**Evidence.**

- src/config/objects.ts — the 'platform' and 'interactive' categories have no crumble, side-spring, dash or double-jump objects (only doors, bridges, crates, bounce_pad, tornado, ladders, vines)
- src/scenes/overworld/liveObjects/hazardController.ts:109-149 — bounce pad interaction is vertical only; it reuses cooldown/active timers and launch grace
- src/scenes/overworld/movementController.ts:1460-1510 — solid runtime objects already provide standing support (needed for crumble blocks)

**Fact-check (partially confirmed).**

Three changes to the build plan:

(1) **Build the crumble block as a special tile, not a solid runtime object.** Special tile slots 16-63 are unused ("Reserved", tilesets.ts:517-520). The breakable brick already has the remove, track and restore machinery: `removeTileAt` plus `brokenSpecialBrickTileKeysByRoomId` at specialTiles.ts:884-899, and restore on room reset at 376-410. A crumble tile only needs a "standing on it" check (like the ice/sticky detection around specialTiles.ts:495), a shake timer, then remove and restore after a delay. That is cheaper than a new live object and paints in rows like other terrain.

(2) **For side and diagonal springs, don't add a new saved per-object field.** The police-style mode field touches about 23 files (persistence, lineage, worker, inspectors). Instead, use the existing `facing` field on PlacedObject (objects.ts:674) and/or separate object ids such as spring_side and spring_diagonal. Also make the existing bounce_pad respect the gravity direction, like the bounce tile does, for consistency.

(3) **Don't make the feather a 'collectible'.** That category is counted for score, collect goals and trust caps (objects.ts:849, cloudflare/worker/progression/trustCaps.ts:136-145). Make it an 'interactive' object with its own overlap handler and a respawn timer (the respawn pattern is at enemyLifecycle.ts:357-374). Reset `airJumpsAvailable` on landing, wall-grab and room reset, and keep it from stacking with coyote time and the wall-jump buffer.

Finally, correct the evidence: the game already has bounce tiles, wind, gravity plates, moving platforms, portals and switch blocks. These three would be meaningful additions, not a big expansion.

**Delivered 2026-10-07** (`d1210e01`, PR #79). Crumbling special slot 18 keeps Portal A/B slots 16/17, shakes 400ms, drops for 2s and waits while occupied. Separate spring ids reuse saved facing and protect 180ms of tangent momentum; existing bounce pads now follow gravity. Interactive Jump Feather supplies one nonstacking extra air jump and returns after 3s without changing collectible score or goals. Landing, walls, water/ladders, death and play resets clear it. Full quality passes 363 files / 2,895 tests; native ordinary/expanded authoring and actual death cleanup pass locally. Eight published-frontend keyboard/touch cases use isolated local API fixtures; four actual public camera/ghost regressions and healthy official gameplay pass, with inspected images. Coordinated renderer/API/Pages release verifies all 994 tiles and 974 nonempty object keys, public pixel parity, exact served assets and healthy scheduled direct alerts. Master is 55/214; next F150. Full receipt: `docs/development/checkup-delivery-2026-10-03.md`.

### F150: Idea: Optional player hearts per room (and make the Heart pickup actually heal)

**2026-10-08 implementation candidate.** Ready for local play review on `codex/checkup-player-hearts-2026-10-08`. Ordinary rooms and shared course/Expanded Room roots expose 1–3 hearts through desktop and phone controls, defaulting to one. Nonfatal hits give bounded recoil and 1,000ms blink protection; all three healing pickups restore one while retaining score and collect-goal credit. Hearts clamp on transitions and refill on spawn/Restart. Deadly outer falls bypass health and protection; Room Rush stays at one and PvP retains its server health. Nondefault counts enter version fingerprints and ranked verification hashes; manual leaderboard carry-over across counts is blocked. Legacy one-heart hashes remain unchanged.

Full **366 files / 2,936 tests**, lint, types, bindings, build, DOM contract, Worker safety and strict map asset checks pass. Native local desktop/touch and real save/publish/history/Expanded Room checks pass; a guest clear is server-verified and screenshots are inspected. [Local demo](http://127.0.0.1:3040/r/84/40?welcome=0&avatar=gamejew-red). The checklist remains unticked pending Jonathan's play review and coordinated API Worker/Pages delivery. See [candidate receipt](../development/checkup-delivery-2026-10-03.md); evidence `/tmp/wamp-player-hearts-2026-10-08/`. F249 follows.

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** Give builders a room setting for 1-3 hearts, with a brief flash of invincibility after a hit. Combat rooms full of police shooters are brutal with one-hit deaths. Also make the existing Heart pickup restore a heart: its description already promises that, but today it's just worth 1 point. It's a single dropdown for builders and opens up 'gauntlet' and boss rooms.

**Technical detail.**

The heart's description says 'Restores health on pickup.' (objects.ts:262), but pickups.ts only maps it to a score value and a sound cue (pickups.ts:3-29, 47-49). Every hazard and enemy calls handlePlayerDeath directly (hazardController.ts:100-105; enemyLifecycle.ts:163-170). PvP already has the parts: PvpHeartDisplay (pvpHeartDisplay.ts), invulnerability blink (pvpInvulnerabilityFx.ts) and the 'player-hurt' cue (sfx.ts:165-169). Add `playerHearts: 1|2|3` to the room snapshot like cameraMode (roomModel.ts:123), defaulting to 1 (current behaviour). In sessionReset.handlePlayerDeath, if hearts > 1 and the reason isn't a fall: decrement, apply knockback via movementController.applyWeaponKnockback, grant 1000ms invulnerability (skip handlePlayerDeath calls during it), play 'player-hurt' and show the hearts. Heart, boygame_heart and health_potion restore +1 up to the max. Leaderboards are already per room version, so no fairness issue.

**Evidence.**

- src/config/objects.ts:262 — heart: 'Restores health on pickup.'
- src/scenes/overworld/liveObjects/pickups.ts:47-49 — heart only selects the 'collect-fruit' cue; no health logic
- src/scenes/overworld/liveObjects/hazardController.ts:100-105 — any hazard overlap → handlePlayerDeath
- src/scenes/overworld/pvpHeartDisplay.ts — reusable heart UI; src/scenes/overworld/pvpInvulnerabilityFx.ts — reusable i-frame blink

**Fact-check (partially confirmed).**

Remove the line "Leaderboards are already per room version, so no fairness issue". Leaderboards merge the scores of versions the code treats as the same room, using buildRoomVersionFingerprint (src/persistence/roomVersionLineage.ts:93-158), and builders can also carry an old leaderboard over by hand (leaderboardSourceVersion in src/persistence/roomLeaderboardLineage.ts). Add `playerHearts` to the fingerprint the way cameraMode is added at line 141 (only when it isn't 1, so existing rooms keep their scores), and block manual carry-over between versions with different heart counts. Also cover:
- Room Rush and expanded-room runs: give them their own setting or force 1 heart.
- Moving between rooms: clamp the player's hearts to the new room's maximum.
- Repeated hits: skip hazard contact during invincibility and knock the player clear of the hazard.
- Collect goals: Heart pickups still count as collectibles.
- Editor: the setting needs controls in the desktop dock, the phone shell and the expanded editor.

Effort is closer to medium than small. A version limited to single rooms, with courses and Room Rush fixed at 1 heart, would be small.

### F155: Idea: Boss mode for the Sword Hunter and police: health bar, multiple hits, phase change

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium
- **Flagged before:** docs/product/ideas-inbox.md (2026-03-18) lists boss enemies as a premium-room idea; not built
- **Already in the product backlog.**

**Summary.** Add a 'Boss' option for the Sword Hunter and police enemies: a health bar, 3-10 hits to defeat, and a faster, angrier second phase at half health. Bosses are one of the most-loved things in player-made level games, and WAMP already has a smart enemy that chases you across platforms to build on. For builders it's one toggle and a hit-count slider.

**Technical detail.**

The Sword Hunter has a real traversal planner (enemies/swordsmanTraversal.ts, swordsmanRobustPlanner.ts; physics-aligned constants in swordsmanTuning.ts:25-34) and defeat modes defeatable/invincible/respawn (swordsmanObjectives.ts:6-11). Police enemies have 'hurt' and 'death' animations (enemies/policeEnemy.ts). Today defeatEnemy always one-shots (enemyLifecycle.ts:139-173). Add a placed field `bossHitPoints` and real damage plumbing (fix the damage→maxHits/radius mismatch from the sword finding first). On hit: decrement HP, play hurt, apply knockback and 600ms invulnerability. Show an HP bar using a container pattern like PvpHeartDisplay. Phase 2 at 50%: shorten windup/cooldown (POLICE_AI_WINDUP_MS etc. at liveObjects/swordsmanController.ts:112-114; swordsman timing constants alongside) and raise run speed. The 'defeat_all' goal already provides the win condition, so no new goal type is needed.

**Evidence.**

- src/enemies/swordsmanObjectives.ts:6-11 — defeat modes exist (defeatable/invincible/respawn), no HP
- src/scenes/overworld/liveObjects/enemyLifecycle.ts:139-173 — contact and stomp always call defeatEnemy (one hit)
- src/scenes/overworld/liveObjects/swordsmanController.ts:112-114 — police windup/attack/cooldown timing to vary per phase
- docs/product/ideas-inbox.md:53 — 'special assets like boss enemies'

**Fact-check (confirmed).**

Refinements to the detail section:

(1) Phase 2 must not raise jump/air speeds, and run-speed increases should be modest and ground-only. `swordsmanTuning.ts:25-26` says the traversal planner is deliberately kept "aligned with the live jump physics". `SWORDSMAN_AI_SPEED` (84, `swordsmanController.ts:89`) is a module constant reused in planner edge execution (line 2354) and jump-launch clamps (lines 709-711). Changing it globally or mid-route can cause overshoots or stalls. Safer phase-2 levers:
- shorter windup and cooldown;
- a per-instance ground-chase multiplier (about 1.2x) applied only in the plain chase path (around line 916).

The timing constants (lines 105-114) are also module-level, so they need per-liveObject overrides; they can't just be edited.

(2) Police enemies have no defeat-mode field. `defeatEnemy` hardcodes 'defeatable' for every non-swordsman enemy (`enemyLifecycle.ts:220-224`). The boss toggle has to be a new field that works for both enemy families, not an extension of `SwordsmanDefeatMode`.

(3) Reuse the existing unused hurt/death animations: `swordsmanAi.ts:39`, `policeEnemy.ts:193`.

(4) Non-stomp contact with police kills the player (`enemyLifecycle.ts:168-171`). Boss invulnerability frames should apply to the boss being hit, but they must not suppress the player-death check.

(5) In PvP matches only full removals sync (`OverworldPlayScene.ts:4733`), so partial HP stays per-client. That's acceptable for v1, but say so.

(6) Optionally add a `defeat_boss` goal later, since `defeat_all` forces players to also clear any minions. `product-requirements.md:278` already lists a boss clear as a future goal type.

### F144: Idea: World collectathon: one hidden 'Lost Song' per room, tracked across the whole world

- **Status:** local candidate ready 2026-10-08, stacked on F155; morning review and coordinated migration/API/map/Pages release pending. Master remains unticked.

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** Let builders hide one special collectible per room, for example a golden cassette or note (a 'Lost Song', which fits Song A Day), and track how many each player has found across the whole world, with a counter on profiles and a tint on the map. It gives explorers a reason to visit every room and sends builders traffic. It's very simple for builders: place one item and pick a sneaky spot.

**Technical detail.**

Hooks: add a new collectible config (objects.ts collectible list) and enforce a limit of one per room in editor validation, the same way spawn_point is limited ('Only one is stored per room'). On pickup in a published room (liveObjects/collection.ts:50-70, where 'key' already triggers a special callback), call a new idempotent Worker endpoint (user_id, room_id, room_version) that writes to a D1 table with a unique (user, room) constraint. Don't count rooms the player owns, so builders can't farm their own. Show the total on profiles (src/profiles) and in the browse HUD, and tint found-room cells in roomCells.ts. Award small XP and milestone badges through the progression system (src/progression/xpReceipts.ts). It's evergreen with no daily pressure, which fits docs/product/xp-badges-ratings-prd.md:43-51. Optional later: themed 'albums', e.g. find all 12 songs in a World.

**Evidence.**

- src/scenes/overworld/liveObjects/collection.ts:50-70 — collectible pickup path with a special case for 'key' to extend
- src/scenes/overworld/liveObjects/pickups.ts:3-29 — collectibles today only give room-local score
- docs/product/xp-badges-ratings-prd.md:43-51 — goal: encourage return visits without daily-compulsion loops

**Fact-check (partially confirmed).**

Use these hooks instead of the ones in the claim:
- Don't copy the spawn_point approach. Add a new one-per-room check for placed objects in three places: editor placement (editRuntime.ts near line 1904), Worker room save/publish validation, and agentBuilder authoringCatalog plus commandCore, with parity tests.
- Award XP and badges on the server, in src/cloudflare/worker/progression/awards.ts and badgesTrophies.ts BADGE_DEFINITIONS. xpReceipts.ts only shows the result.
- Set countsTowardGoals=false for the Lost Song so collect and collect_race goals are unchanged.
- Tie the "found" write to a server-issued play or run session, and cap or trust-gate the XP, to block scripted or alt-account farming.
- Add a guest localStorage path that is claimed at sign-up, modeled on guestRunProgress.ts.
- Load each player's found-room list once per session, so found songs show ghosted on re-entry and the map can be tinted without a fetch per room.
- Plan for cold start: seed Lost Songs in Prime, or nudge owners of existing rooms to add one.
- Decide how Expanded Rooms count.

### F151: Idea: Weekly seeded Room Rush: everyone starts from the same room for 7 days

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium
- **Flagged before:** docs/product/ideas-inbox.md:47 mentions 'seasons' or events with objectives; the XP PRD prefers weekly cadence
- **Already in the product backlog.**

**Summary.** Turn Room Rush into a weekly event: everyone starts from the same room with the same rules for seven days, with its own leaderboard and a shareable result card. It gives the community a shared thing to talk about each week and pushes players through many builders' rooms, without daily-streak pressure.

**Technical detail.**

Room Rush already has server-issued start ids and expiry, easy/hard difficulty (on hard, one death ends the run), and a score of unique rooms visited (roomRushRuns.ts:26-41, 167-189). It also has a Worker leaderboard (cloudflare/worker/runs/roomRushLeaderboards.ts) and share capture (src/social/roomRushShare). Add a 'weekly' start rule: a Worker cron picks a start room each Monday (published, decent rating, at least 3 playable neighbours) and stores {weekId, startCoordinates, difficulty}. The client offers 'This week's Rush' in browse; the leaderboard is keyed by weekId and shows last week's winners. Later add 'Course of the week' using existing course runs. This matches docs/product/xp-badges-ratings-prd.md:126-128 ('Weekly cadence is safer than harsh daily streaks').

**Evidence.**

- src/scenes/overworld/roomRushRuns.ts:26-41 — run state already carries serverStartId/serverExpiresAt/startRule
- src/scenes/overworld/roomRushRuns.ts:167-189 — difficulty rules and score = rooms visited
- docs/product/xp-badges-ratings-prd.md:126-128 — weekly cadence preferred over daily streaks

**Fact-check (partially confirmed).**

Describe this as adding weekly rotation and a weekly leaderboard reset to the existing "Start From 0,0" mode, not as a new shared-start feature. Make the weekly mode hard-only, or give it a fixed time limit (for example 3 to 5 minutes, enforced through the run start's expiresAt). Without that, scoring by unique rooms with a 2-hour cap rewards grinding over skill. Skip the scoring algorithm at first and let Jonathan pick the weekly room by hand: store {weekKey, startCoordinates} in a small D1 table, written through an admin route modeled on the existing featured-rooms admin (src/admin/featuredRoomsClient.ts). That gives better choices and is cheaper to build. Reuse getUtcWeekKey from progression/ratings.ts. The picked room must be published and standalone. Add an event_week column to room_rush_run_starts and room_rush_runs, plus a 'weekly' start rule (or an extra filter) in the leaderboard query. A cron job is optional.

### F152: Idea: Co-op pressure plates that count other live players

- **Area:** Gameplay feel & new gameplay ideas
- **Type:** idea · **impact:** medium · **effort:** medium
- **Flagged before:** docs/product/ideas-inbox.md (2026-03-18) Emergent Mechanics note; pressure plates shipped, co-op part not done
- **Already in the product backlog.**

**Summary.** Let builders mark a pressure plate as 'co-op' so other players standing on it count too. Builders can then make two-person puzzle doors where one player holds the plate and the other runs through. That's real cooperation in a shared world rather than just ghosts walking past, and it's a single checkbox on a plate.

**Technical detail.**

isPressurePlatePressed checks only the local player's body and live objects (triggerController.ts:601-630). Remote players are already rendered with positions (presenceController.getRenderedGhostsByConnectionId, used at OverworldPlayScene.ts:2494 for lighting). Add a placed-object flag `coopPlate`, using the normalizer pattern from policePatrolShoots in enemies/policeEnemy.ts. When it's set, also test each rendered ghost's feet rect (≈10×6px at ghost.sprite.x/y) in the same room. Each client evaluates this locally, so door state is eventually consistent; that's fine for casual co-op. Exclude rooms with co-op plates from solo ranked runs, or show a 'co-op' badge on their leaderboards. Lightweight for performance: there are few ghosts per room.

**Evidence.**

- src/scenes/overworld/liveObjects/triggerController.ts:601-630 — plates are pressed only by the local player body or live objects
- src/scenes/OverworldPlayScene.ts:2494 — ghost positions are already available via presenceController.getRenderedGhostsByConnectionId()
- docs/product/ideas-inbox.md:45 — 'having two players need to stand each on different pressure plates to unlock a door means you can make Portal style puzzles'

**Fact-check (confirmed).**

Four notes for whoever builds this:

1. **It doesn't give you the inbox's Portal-style puzzle.** Plates are OR'd per target: any pressed plate linked to a door opens it (`src/scenes/overworld/liveObjects/triggerController.ts:251-259`, `activeTargetKeys`). So a co-op flag alone supports "one player holds the door while the other runs through". The inbox's "two players each on a different plate" needs a separate "require all linked plates" (AND) option on the door. Scope that as a follow-up.

2. **Rooms can get stuck when nobody else is online.** A room that truly needs two players can't be finished alone. Add a "needs 2 players" badge on the room card and in Explore. Note that crates and enemies already press plates, which builders can use as a solo fallback.

3. **Read ghost positions even when the ghost isn't drawn yet.** Use the rendered ghost's `targetX`/`targetY`, or its presence `x`/`y`, without gating on `sprite.visible`. The sprite stays hidden until the avatar pack loads (`src/scenes/overworld/presence.ts:518-525`), and a plate shouldn't stay up just because an avatar is still downloading. Also skip PvP-instance opponents and stale presences.

4. **The summary undersells the work.** The flag has to be stored and wired through roughly 9 files, so "a single checkbox" is misleading even though medium effort is right. Also cite `docs/product/product-requirements.md:459` (v2+ "Collaborative switches") under `previously_recommended`.

### F157: No on-screen Undo/Redo in the desktop/tablet editor; iPad builders have no Undo at all

- **Area:** Level building / editor UX
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** The new dock editor has no Undo or Redo buttons, so mouse-only builders need Cmd/Ctrl+Z and iPad builders without a keyboard can't undo at all. Redo has no button anywhere, including on phones. For a level editor, Undo is the most-used safety net.

**Technical detail.**

The dock's top cluster (index.html:1334-1339) has Back, Room, Share, Save, Test and Publish, with no Undo or Redo. The only Undo button is #btn-mobile-editor-undo inside #mobile-editor-nav, which mobile/controller.ts:463-467 shows only when deviceClass==='phone'. Tablets (coarse pointer, shortest edge >540, deviceLayout.ts classifyDeviceClass) get the dock shell (editorDockShell.ts:185-188) and have no undo. EditorScene.undoAction/redoAction (EditorScene.ts:1940-1948) are wired only to keyboard handlers (EditorScene.ts:238-255). redoAction is declared in sceneBridge.ts:163 but nothing calls it. Fix: add two chunky buttons (↶ Undo, ↷ Redo) next to the tool cluster in editor-shell-top. Disable them using editRuntime.hasUndoHistory()/hasRedoHistory() (editRuntime.ts:2875-2881) through the existing view model (viewModel.ts) and update the state on EDITOR_UI_STATE_CHANGED_EVENT. Add Redo to the phone nav. Show 'Cmd+Z' in the tooltips. Extend smoke:editor-dock to assert both buttons at 1024×768 and on a tablet viewport.

**Evidence.**

- index.html:1334-1339 — dock top actions: Back/Room/Share/Save/Test/Publish only
- index.html:2034 — the only Undo button lives in #mobile-editor-nav
- src/ui/mobile/controller.ts:463-467 — mobile nav hidden unless isPhone && coarsePointer && isEditor
- src/ui/setup/editorDockShell.ts:185-188 — dock shell active for every non-phone device incl. tablets
- src/ui/setup/sceneBridge.ts:163 — redoAction declared; no UI caller exists anywhere
- src/scenes/EditorScene.ts:238-255 — undo/redo only via Cmd/Ctrl+Z, Shift+Z, Ctrl+Y

**Fact-check (confirmed, confirmed, confirmed).**

Only one line reference is off. The keyboard handler starts at EditorScene.ts:233 (handleDocumentKeyDown), and the undo/redo checks are at lines 240-254, not 238-255. Two notes for the fix: CourseEditorScene.ts:335-337 and 1315-1331 has the same keyboard-only undo/redo, so the course composer has the same gap on tablets. Also, the dock's Erase popover now offers destructive Nuke Terrain/Nuke Objects actions (progress.md:252), which makes on-screen Undo more urgent on tablets.

A small wording fix: iPads with a hardware keyboard can undo and redo with Cmd+Z and Cmd+Shift+Z. Touch-only iPads and tablets have no way to undo at all. No device has an on-screen Redo. Line references: the dock action grid is index.html:1333-1340, and keyboard handling is EditorScene.ts:233-256.

Small fix-plan detail: canUndo/canRedo are not in the editor view model yet. They show up only in EditorScene's debug/state snapshot (EditorScene.ts:2103-2104). The implementer needs to add them to viewModel.ts (or have the buttons read editRuntime.hasUndoHistory()/hasRedoHistory() on the UI-state update) so the buttons can be disabled. The new buttons should call scene.undoAction()/redoAction(), the same path the phone button uses (controller.ts:175-179), because those methods also refresh the bar (EditorScene.ts:1940-1948). Also mirror the music-mode and sprite-mode locks that already disable the phone Undo button (music.css:412, sprite.css:35, controller.ts:476-478). An iPad with a hardware keyboard can already use Cmd+Z through the document-level handler, so only keyboard-less tablets are completely stuck. Mouse-only desktop builders do have a keyboard, but nothing tells them Cmd+Z exists.

### F156: Rooms that can't be beaten (or are beaten instantly) can be published

- **Area:** Level building / editor UX
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** A builder can pick "Reach Exit" and publish without ever placing the exit, which makes a room nobody can finish. "Checkpoint Sprint" with no finish has the same problem. "Defeat All" with zero enemies clears the moment you spawn, which hands out free clears and XP. The editor shows the hint "Set an exit marker to finish the room" but still lets the room publish.

**Technical detail.**

getRoomGoalPublishValidationError (src/goals/roomGoals.ts:414-457) only checks collect counts, the Collect Race hunter and NPC quests. It has no branch for reach_exit (exit null), checkpoint_sprint (finish null) or defeat_all (0 enemies). The same function is the server gate (src/persistence/roomModel.ts:937-951), so the API and agent publishes also let these rooms through. At runtime, objectiveController.ts:134-150 completes reach_exit only `if (runState.goal.exit && …)`, so the run never ends. goalRuns.ts:1049-1051 marks defeat_all complete immediately when enemyTarget===0, and runs/routes.ts:983-986 accepts it because 0 >= 0. Expanded rooms already reject the exit/finish cases (courses/store.ts:713-724), so single rooms are the inconsistent path. Fix: (1) extend the shared validator to return errors for reach_exit && !exit, checkpoint_sprint && (!finish || checkpoints.length===0) and defeat_all && enemy count===0. Add enemyCount to RoomGoalPublishValidationContext, which both callers can compute. Add unit tests in roomGoals.test.ts. (2) In editRuntime.setGoalType (editRuntime.ts:2644-2650), automatically enter exit/finish placement mode when the goal type needs a marker, the same way the one-shot spawn placement works. (3) Run a one-off read-only D1 query to count already-published rooms with an exitless reach_exit or a zero-enemy defeat_all, and flag them in the suspicious-activity admin view.

**Evidence.**

- src/goals/roomGoals.ts:414-457 — validation has no reach_exit/checkpoint_sprint/defeat_all checks
- src/persistence/roomModel.ts:937-951 — server publish uses the same validator
- src/scenes/overworld/objectiveController.ts:134-150 — reach_exit completes only when goal.exit is non-null
- src/scenes/overworld/goalRuns.ts:1049-1051 — defeat_all with enemyTarget 0 → markCompleted('No enemies remain.')
- src/cloudflare/worker/runs/routes.ts:983-986 — server accepts enemiesDefeated >= maxEnemies (0 >= 0)
- src/cloudflare/worker/courses/store.ts:713-724 — expanded rooms DO reject missing exit/finish
- src/scenes/editor/goalDocument.ts:228-231 — editor only shows a hint 'Set an exit marker to finish the room.'
- src/scenes/editor/editRuntime.ts:2644-2650 — choosing a goal type doesn't arm marker placement

**Fact-check (confirmed, confirmed, partially confirmed).**

Small detail fixes; the core claim is unchanged.
1. A checkpoint_sprint with a finish but zero checkpoints is not unbeatable. Reaching the finish completes it, and the verifier's `checkpoints.size < 0` check never fails. That case is just a weak sprint. Only a finish of null makes the room unbeatable. Rejecting zero checkpoints is still reasonable so single rooms match the expanded-room rule.
2. The free-XP abuse is limited. Points are paid only on first completion (or a new personal best), and the number of zero-enemy rooms anyone can make is held down by the daily room-claim limits. The bigger player-facing harm is unbeatable rooms appearing in the world.
3. Expanded rooms (courses/store.ts:734) also let zero-enemy defeat_all through, so the defeat_all fix should go in both validators.

For Checkpoint Sprint, only a missing finish makes the room unbeatable. A sprint with zero checkpoints and a finish placed works fine: `objectiveController.ts:275-310` skips straight to the finish check when there is no next checkpoint, and the server accepts it (`routes.ts:988-990`, 0 >= 0). Requiring at least one checkpoint would match expanded rooms (`courses/store.ts:720`), but that is a design choice, not a bug fix. The "Defeat All with zero enemies" gap also applies to expanded rooms (`courses/store.ts:733-736` returns without checking), so single rooms are not the only path with that hole. The cited line numbers are otherwise accurate.

Production sample (495 published rooms near the origin, 125 standalone rooms with these three goal types): one exitless reach_exit room (7,-1 "Death", v9) and one checkpoint_sprint room with no checkpoints and no finish (3,4, v1212). There were zero zero-enemy defeat_all rooms, so that part is theoretical, and its "free XP" is no different from any trivially easy room. Impact should be medium, not high.

The editor already shows a dedicated "Place Exit" button when Reach Exit is chosen (viewModel.ts:177, uiBridge.ts:1152). It shows more than a hint.

Fix notes:
(a) A sprint with 0 checkpoints but a finish works fine at runtime (objectiveController.ts:280-311). Requiring checkpoints.length > 0 is a choice to match the course rules (courses/store.ts:719), not a bug fix. The must-have check is a missing finish.
(b) Automatically entering exit-placement mode when the goal type changes could cause accidental marker placement on the next tap or drag on mobile. Blocking publish with a clear error and pulsing the existing Place Exit / Place Finish buttons is safer.
(c) No D1 query is needed to find the existing broken rooms. The public /api/world plus /api/rooms/:id/current GETs already reveal them. Once the validator ships, their owners will get the error the next time they republish.

### F163: Starter room templates (backlog G-001): build them as command scripts

- **Area:** Level building / editor UX
- **Type:** idea · **impact:** high · **effort:** medium
- **Flagged before:** Backlog G-001 (Codex Ready, High) — still not built.
- **Already in the product backlog.**

**Summary.** "Build Here" still opens a completely empty room, and "empty canvas is hard" has been in the backlog as High priority since March. Offer 4–6 one-tap starters that match the neighbors' tileset (Flat Run, Stairs Up, Vertical Climb, Arena, Platform Chain, plus Blank). Each one comes with ground, a spawn, and an exit already placed, so a first-time builder is one edit away from a playable room.

**Technical detail.**

createDefaultRoomSnapshot (persistence/roomModel.ts:413-442) returns empty tileData, goal null and spawnPoint null. The cheapest robust implementation reuses the agent command API. applyRoomDraftCommands(baseSnapshot, commands) (cloudflare/worker/rooms/commandCore.ts:922) is pure: it imports only shared config and model modules (commandCore.ts:1-40), and it already supports platform, fill_rect, set_tiles, place_object, set_spawn and set_goal with validation. Write each template as a small RoomDraftCommand[] and parameterize the tileset with the neighbors' dominant tileset, or with the Smart theme in Beginner mode. Apply it client-side in the editor as one undoable 'template' history entry by diffing it into editRuntime with applyRoomSnapshot plus a history record. Show a picker card in the Terrain panel when the room has no tiles and no objects, and from the Room panel as 'Start over from template'. The same scripts double as worked examples for /agent-room-design.md and as built-in Stamps (see the Select/Move finding).

**Evidence.**

- docs/product/backlog.md:45 — G-001 Starter room templates, Status: Codex Ready, Priority: High
- docs/product/ideas-inbox.md:58 — 'Start from a template - empty canvas is hard'
- src/persistence/roomModel.ts:413-442 — new rooms are fully empty (no ground, spawn, or goal)
- src/cloudflare/worker/rooms/commandCore.ts:922 — pure applyRoomDraftCommands usable client-side

**Fact-check (partially confirmed).**

The plan to build template terrain with the agent command API and "parameterize with the Smart theme in Beginner mode" has a gap.

**The gap:**
- commandCore has no Smart-terrain command. Its platform, fill_rect and set_tiles commands write raw tile numbers from the agent tileset catalog (getBuildStyleOrThrow, commandCore.ts:489-496). They never touch the room's Smart terrain data (smartTerrain: semanticCells, ownedOutputs and so on; autotiling/model.ts:299-313).
- The editor's default brush mode is Smart (paletteMode: 'smart', config/editorState.ts:118).
- So a beginner's template ground would be plain tiles. When they extend it with the default Smart brush, edges and seams won't blend, which undercuts the "one edit away" goal.

**The fix:**
1. Lay template terrain down as Smart brush cells with the pure applyRegisteredSmartBrushCells / getRegisteredSmartBrushRectangleCells (autotiling/brushEngine.ts:59 and :113). Store the before and after Smart state in the new combined undo entry, the same way 'tiles' entries carry smartBefore/smartAfter (editRuntime.ts:222-226).
2. Use commandCore only for set_spawn, set_goal and place_object, plus raw-tile templates for Advanced builders. Alternatively, add a smart_fill command to commandCore so agents and templates share one path.

**Two smaller notes:**
- Load commandCore and agentBuilder/tilesetCatalog only when the picker opens (dynamic import). The catalog builds AGENT_TILESET_CATALOG from every tileset when the module loads (tilesetCatalog.ts:89), so this keeps it out of the main editor bundle.
- Choosing the neighbours' most common tileset is new work. buildRoomTilesetHint (tilesetCatalog.ts:191) works per room and could be run on adjacent loaded rooms.

### F159: Add a "Clear Check" plus a Ready-to-Publish checklist (Mario Maker style)

- **Area:** Level building / editor UX
- **Type:** idea · **impact:** high · **effort:** medium

**Summary.** Before a room goes live, show builders a short checklist: ground under the spawn, goal set and markers placed, a title, and "You beat it." Track whether the builder actually cleared the current version during Test, and put a ✓ on the Publish button. This catches impossible jumps and broken rooms that code checks can't detect. It also gives beginners an obvious sequence: build, spawn, goal, test, publish.

**Technical detail.**

Today a Test run of a draft is a local practice run ('Draft room runs stay local.', goalRuns.ts:603-604, 1251-1265). When the run finishes, nothing is sent back to the editor: editorPlaytestReturnTarget carries only coordinates (playMode.ts:69-71; overworld/flow.ts:300-315). Publish is one click with no summary (roomSession.ts:526-560). Plan: (1) When a goal run on a draft completes during an editor playtest, store {roomId, snapshotHash} in sessionStorage. A cheap hash of exportRoomSnapshot() works; the run-verification code already uses verification_snapshot_hash (migrations/0021). (2) On wake (EditorScene.ts:186-193 handleWake), compare it to the current snapshot hash and set clearedCurrentVersion. Any edit invalidates it. (3) Render a compact checklist in the Goal/Markers panel and as a pre-publish card: spawn placed and standing on ground (reuse findSpawnSurfaceTile/getTerrainTileCollisionProfile from overworld/goalRunStartGate.ts), spawn not inside solid terrain or on a hazard, goal markers placed and not inside solid terrain, title set, cleared ✓. (4) Policy, starting soft: allow publishing without a clear but label the room 'Creator hasn't cleared this yet' and keep it off leaderboards/XP until someone clears it; consider making the clear required later. (5) Polish for the test loop: rename the in-play 'Stop' button to '◀ Back to Editor' when editorPlaytestReturnTarget is set (hudViewModel.ts:474-480), add 'Enter' to the Test button tooltip, and add 'Test from here' (long-press or Shift+Enter) that spawns at the cursor. (6) Move the guest 'Awesome work!' sign-up modal from 30 placed tiles (guestBuilderActivityTracker.ts, GUEST_BUILDER_BUILD_PLACEMENT_THRESHOLD=30), which fires after a single rectangle fill, to the first successful Clear Check, when intent to publish is highest.

**Evidence.**

- src/scenes/overworld/goalRuns.ts:603-604 — 'Draft room runs stay local.'
- src/scenes/editor/playMode.ts:69-71 — playtest return target carries coordinates only, no result
- src/scenes/editor/roomSession.ts:526-560 — publish has no preflight beyond goal-count validation
- src/scenes/overworld/goalRunStartGate.ts:18-41 — reusable spawn-surface logic for a spawn-safety lint
- migrations/0021_ranked_run_trace_verification.sql — verification_snapshot_hash infra already exists
- src/progression/guestBuilderClaimEvents.ts:5 — guest modal threshold is 30 placements
- src/scenes/overworld/hudViewModel.ts:474-480 — playtest button just says 'Stop'

**Fact-check (partially confirmed).**

Put two things first.

1. Hard publish blockers in getRoomGoalPublishValidationError (src/goals/roomGoals.ts:414):
   - a reach_exit room with no exit marker;
   - a checkpoint_sprint room with no finish marker or no checkpoints (match the course rule in courseRuns.ts:345-351);
   - goal markers inside solid terrain.

2. An advisory checklist. Spawn and goal are optional in WAMP (goal-free rooms are first-class; spawn falls back to a surface point), so neither can be required. 'Creator cleared ✓' applies only to goal rooms.

The 'cleared this version' flag (stored as {roomId, snapshotHash} in sessionStorage) is set by the client. Use it for the UI only, never to gate rewards.

If you gate XP or leaderboards, do it on the server and use clears it already verifies: the first verified ranked clear of the published version, by anyone. Today awards.ts:106-123 pays 25 BXP plus trust on the first publish of a goal room. You could defer that payout until the first verified clear.

Smaller fixes:
- Export findSpawnSurfaceTile (goalRunStartGate.ts:86).
- Copy the existing 'Test Play (Enter / P)' tooltip onto the editor-shell Test button. Don't add a new shortcut.
- On mobile, make 'Test from here' a button, not a long-press.
- Scope v1 to single rooms. Expanded rooms and courses have separate publish paths.
- Under anyone-can-edit, 'creator' means whoever published this version.

### F162: No way to move things: add a Select/Move tool, a clipboard that works across rooms, and saved stamps

- **Area:** Level building / editor UX
- **Type:** improvement · **impact:** high · **effort:** large

**Summary.** Builders can't drag a placed enemy, chest, NPC or linked pressure plate to a new spot. They have to delete it and place it again, which loses its settings, links, dialogue and contents. Copy only grabs tiles from one layer, can't include objects, and is cleared when you open another room, so you can't reuse a set piece you built in an earlier room.

**Technical detail.**

The tool list is pencil/rect/ellipse/line/fill/randomize/eraser/copy (config/room.ts:13), with no select, move or cut. Clicking an existing object either opens its inspector or places a new object (interaction.ts:676-690). EditorClipboardState holds one sourceLayer's tiles plus smart data and no placed objects (clipboard.ts:31-43). copyTilesToClipboard reads only editorState.activeLayer (editRuntime.ts:501-526), and reset() nulls the clipboard on every room load (editRuntime.ts:432). Plan: (1) Select tool (shortcut M): marquee-select a rectangle that captures all three tile layers, the smart terrain in that footprint (reuse buildEditorClipboardState per layer), and every placed object whose anchor is inside. Objects keep their config, and instanceIds are remapped on paste. Links that point outside the selection are dropped, with a toast. (2) Drag the selection to move it as a single undo entry. Moving one object while keeping its instanceId preserves links and NPC dialogue. (3) Persist the clipboard in localStorage so Cmd+C in room A and Cmd+V in room B works. (4) 'Save as Stamp' adds the selection to a per-user 'My Stamps' list in the Stuff/Deco panels, stored locally first and synced later the way community sprites are. Stamps are the prefab system, and the same format can ship built-in stamps such as a 'checkpoint ledge' or 'spike pit with coin arc'.

**Evidence.**

- src/config/room.ts:13 — TOOLS has no select/move/cut
- src/scenes/editor/clipboard.ts:31-43 — clipboard = one layer of tiles + smart data, no objects
- src/scenes/editor/editRuntime.ts:501-526 — copy reads only the active layer
- src/scenes/editor/editRuntime.ts:432 — clipboard cleared on every room reset
- src/scenes/editor/interaction.ts:676-690 — object-mode click places or inspects; no drag-to-move

**Fact-check (confirmed).**

Tile copy and paste between rooms already works inside the course editor. CourseEditorScene.ts:253, 2694 and 2799-2815 keep one clipboard for the whole scene and push it into each room's runtime on paste. "Cleared when you open another room" is accurate only for the standalone room editor (EditorScene.create → resetRuntimeState → editRuntime.reset at editRuntime.ts:432). That course clipboard still holds only one layer of tiles and no objects. Suggestion: break the work up and ship object drag-to-move (same instanceId, one undo entry, a tap-and-hold or explicit Move mode on phones) first. It is the highest-value part and about medium effort. The marquee multi-layer selection, the localStorage clipboard and the saved stamps can follow.

### F065: Expanded-room editor silently drops NPC, police, swordsman and goal-intro settings (duplicated inspector)

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** defect · **impact:** medium · **effort:** medium
- **Flagged before:** 2026-07-13 audit §1.2 'Extract a shared inspector core parameterized by a small InspectorDataSource interface': still undone

**Summary.** Builders making expanded (multi-room) levels can place NPCs, police and swordsmen from the shared palette, but they can't name them, give them dialogue, or set their behavior. They also can't write a goal intro. The expanded-room editor wires those controls to empty functions because it uses a separate copy-pasted inspector that never got those features.

**Technical detail.**

CourseEditorScene (which edits expanded rooms) passes no-op callbacks to the shared EditorUiBridge:
- `onSetGoalIntroText: () => {}` at line 685
- `onSetFocusedSwordsmanObjectiveMode/DefeatMode`, `onSetFocusedPoliceBehaviorMode/PatrolShoots`, and `onSetFocusedNpcMode/Pushable/CanJumpFall/PlayerCollision/FriendlyFire/Name/Dialogue/DefeatMode: () => {}` at lines 698-709
Its inspector (src/scenes/courseEditor/objectInspector.ts, 1,063 lines) is a parallel copy of src/scenes/editor/inspector.ts (1,322 lines). They share 30 method names with identical copy (getObjectLinkBeginStatus, drawPressurePlateLink…). The course copy lacks every getFocusedNpc/Police/Swordsman and setFocused* method, and it always renders the empty inspector state (CourseEditorScene.ts:1628), so those panels never appear. editRuntime.handleObjectPlace places any palette object with no expanded-room restriction.

Fix: extract an InspectorCore parameterized by a small data-source interface: resolve placed object by instanceId, commit object patch, list link targets with slice origin offset. Both scenes then use one implementation. The course scene supplies slice-aware refs, and the NPC/police/swordsman panels come for free. Add a parity test asserting both scenes wire every EditorUiBridge callback to a non-noop. This also advances backlog G-009 (NPC story tools).

**Evidence.**

- src/scenes/CourseEditorScene.ts:685 — `onSetGoalIntroText: () => {},`
- src/scenes/CourseEditorScene.ts:698-709 — twelve NPC/police/swordsman setters wired to `() => {}`
- src/scenes/courseEditor/objectInspector.ts vs src/scenes/editor/inspector.ts — 30 shared method names; getObjectLinkBeginStatus/getObjectLinkConnectStatus bodies are character-identical
- src/scenes/CourseEditorScene.ts:1628 — `renderInspector(createEmptyCourseInspectorState())` (empty state → NPC/police/swordsman panels hidden)
- src/scenes/editor/editRuntime.ts handleObjectPlace — no restriction on NPC objects in expanded-room slices
- docs/product/backlog.md:154 — G-009 Friendly NPCs, sign text and story tools

**Fact-check (partially confirmed).**

Change the title to something like: "Expanded-room editor can't configure NPCs, police or Sword Hunters (no inspector; duplicated inspector code)."

Remove the goal-intro claim. Room goals are intentionally hidden in the expanded editor (CourseEditorScene.ts:3188-3190, viewModel.ts:155), so the intro no-op can't be reached.

Remove "silently drops". Existing NPC, police and swordsman settings round-trip intact through the slice's EditorEditRuntime (editRuntime.ts:484, 615-630). Newly placed ones just keep their defaults and show no inspector.

Fix the line-1628 reference. It is the teardown path (destroyWorkspace). The empty state actually comes from the fall-through in objectInspector.ts:1061, which renders it for anything that isn't a pressure plate or container.

Mention the workaround: open the cell in the regular room editor.

Fix approach: the minimal version is small. Add focus tracking for NPC, police and swordsman to CourseEditorObjectInspectorController and call the existing slice.runtime setters. The shared InspectorCore extraction is still worth doing to stop the two inspectors drifting apart again. Jonathan explicitly asked to "keep future changes in sync" (progress.md:302).

### F165: Undo history grows without limit and copies the whole terrain twice per stroke

- **Area:** Level building / editor UX
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Every brush stroke saves two full copies of the room's terrain in Undo, with no limit. In a long session on a smart-terrain-heavy room this grows to hundreds of MB, which risks phone browser tabs crashing and losing the session. Each stroke also does about 4 ms of extra copying on desktop, and likely 15–20 ms on a phone.

**Technical detail.**

EditorHistory (scenes/editor/history.ts:1-16) has no cap. The sprite editor caps at 80 (customSpriteEditor.ts:64). beginTileBatch always deep-normalizes smartTerrain (editRuntime.ts:709). commitTileBatch JSON.stringify-compares the before and after states (746) and records two more deep clones, smartBefore and smartAfter (757-763), even for a plain manual-tile stroke that didn't touch smart terrain. cloneRoomSmartTerrainState is a full normalize with per-key regex validation (autotiling/model.ts:775-777). I measured it with a synthetic 480-cell room built from the live tutorial room's smart-cell shapes (Node, M-series): 188 KB JSON per snapshot, ~1.0 ms per clone, ~3.8 ms per stroke, and ~143 MB of heap after 300 strokes of history. Separately, EditorScene.getLightingPreviewStaticEmitters re-runs a full exportRoomSnapshot() on every edit because its cache key includes lastDirtyAt, even when lighting is Off (EditorScene.ts:1194-1214, 1261-1275). Fix: (1) cap history at about 150 entries (drop the oldest); (2) record smartBefore/After only when the stroke changed smart state, with a cheap dirty flag set by the smart controller instead of JSON.stringify; ideally store per-key diffs; (3) skip the static-emitter extraction when roomLightingUsesDynamicOverlay(lighting) is false.

**Evidence.**

- src/scenes/editor/history.ts:1-16 — no history limit
- src/scenes/editor/editRuntime.ts:709 — deep clone of smartTerrain on every stroke start
- src/scenes/editor/editRuntime.ts:746 — JSON.stringify(before) !== JSON.stringify(after) per stroke
- src/scenes/editor/editRuntime.ts:757-763 — two more deep clones stored per history entry
- src/ui/setup/customSpriteEditor.ts:64 — sprite editor caps history at 80 (room editor doesn't)
- src/scenes/EditorScene.ts:1261-1275 — full room export for lighting emitters keyed on lastDirtyAt, even with lighting off
- Measured: 480-cell synthetic room → 188 KB/snapshot, ~3.8 ms/stroke, ~143 MB after 300 strokes (Node)

**Fact-check (confirmed).**

Small refinements:
1. "Copies the whole terrain" means the smart-terrain metadata (RoomSmartTerrainState). Tile data is already stored as per-cell diffs.
2. Each stroke does 3 deep clones + 2 JSON.stringify calls and keeps 2 copies. On commit it can reuse currentBatchSmartBefore instead of cloning it again.
3. Memory grows about 0.24 MB per retained copy (about 0.47 MB per stroke) on a fully smart-filled room. That is about 140 MB after 300 strokes, so "hundreds of MB" is only reached in very long sessions in very heavy rooms.
4. The per-stroke cost is a single hitch on pointer-up, not per frame.
5. Lighting re-export happens once per committed edit, not per frame.

Add to the fix: cache the per-frame weather export at EditorScene.ts:1239 (exportRoomSnapshot + buildRoomWeatherSurfaceSegments every frame when rain is on), keyed on lastDirtyAt.

For the "skip unchanged smart state" fix: storing undefined is safe because undo/redo only restore when action.smartBefore is truthy (editRuntime.ts:2918, 3019). Manual tile strokes can change smart state through recordManualSmartEdit (editRuntime.ts:799-812), so any dirty flag must be set there as well as in the smart-tool paths.

### F166: Show neighbor openings at the room edges so the world actually connects

- **Area:** Level building / editor UX
- **Type:** idea · **impact:** medium · **effort:** small

**Summary.** The PRD says rooms connect at their edges, but nothing in the editor shows builders where the neighboring rooms have openings, or warns them when they wall one off. Show small door arrows on the room border wherever a neighbor's edge is passable, and warn before publishing if your room is sealed on every side.

**Technical detail.**

The editor already loads and draws published neighbors at radius 1 (EditorScene.ts:110; scenes/editor/backgrounds.ts:258-318 loads each neighbor's full snapshot). The room border is a plain stroke (overlays.ts:169-174). Implementation: in refreshSurroundingRoomPreviews, after loading the snapshots, compute for each orthogonal neighbor which cells on the shared edge are passable for a player standing there: the terrain-layer column 0 or 39, or row 0 or 21, is empty or one-way. Reuse getTerrainTileCollisionProfile so slopes and one-ways count correctly. Cache this per neighbor version. Draw green chevrons on this room's border for those rows/cols, and red ones where this room's own edge cell is solid opposite a neighbor opening. Recompute this room's side on commitTileBatch only (cheap: 4 edges × ≤40 cells). Add 'Connects to N neighbors' to the Ready-to-Publish checklist (see the Clear Check finding), and suggest 'Leave an opening on at least one side' when there are 0.

**Evidence.**

- src/scenes/editor/backgrounds.ts:258-318 — neighbor snapshots already loaded and rendered in the editor
- src/scenes/EditorScene.ts:110 — EDITOR_NEIGHBOR_RADIUS = 1
- src/scenes/editor/overlays.ts:169-174 — room border is a plain rectangle; no opening guides
- docs/product/product-requirements.md:74 — 'Thick visual borders between rooms with openings at connection points'

**Fact-check (partially confirmed).**

Change the summary: the editor already draws neighbor rooms in full beside the current room (camera bounds in interaction.ts:282-292, images in backgrounds.ts:296-313), but at the default fit zoom (interaction.ts:376-395) they are off screen. The value is explicit markers at the edge, mainly for mobile. Implementation fixes: (a) detect one-way cells by comparing getTerrainCollisionTileValue(...).gid to SPECIAL_TILE_ONE_WAY_PLATFORM_GID, because getTerrainTileCollisionProfile has no one-way flag; (b) optionally count solid placed objects (crates, doors) on edge cells; (c) give sides facing unclaimed or unpublished neighbors an "open to empty space" state, since only published neighbors are loaded, and base the sealed-room nudge on this room's own open edges rather than a count of connected neighbors; (d) keep any publish nudge soft and informational, never a blocker, because product-requirements.md:75 makes edges freeform on purpose and players can warp into sealed rooms; (e) leave out the dependency on a "Ready-to-Publish checklist", which does not exist yet; (f) skip the internal seams inside expanded multi-cell rooms.

### F167: Use the existing agent API for an in-editor "Sketch my room" AI helper

- **Area:** Level building / editor UX
- **Type:** idea · **impact:** medium · **effort:** large

**Summary.** WAMP already has a complete, validated API that lets outside AI agents build rooms with commands, but human builders in the editor get no AI help. A "Describe a room → Sketch it" button could generate a first layout that fits the neighbors (terrain, spawn, goal, a few hazards), shown as a preview you can accept or tweak, in the same Song A Day spirit of getting to something playable fast.

**Technical detail.**

The pieces exist. RoomDraftCommand parsing and validation (normalizeRoomDraftCommandsRequestBody, commandCore.ts:767) and the pure applyRoomDraftCommands (commandCore.ts:922) cover set_tiles, fill_rect, platform, place_object, set_spawn and set_goal. The design heuristics in public/agent-room-design.md (safe spawn, one main mechanic, readable path) and the catalog in agentBuilder/authoringCatalog.ts can go straight into a system prompt. No LLM binding exists yet (none in wrangler.jsonc). Plan: a Worker route POST /api/rooms/{id}/sketch that takes {prompt, beginner|advanced}, gathers neighbor tileset hints the same way the agent workflow does (public/skill.md:41-58), calls an LLM with a tool schema that equals RoomDraftCommand[], validates with normalizeRoomDraftCommandsRequestBody, and returns the commands, not a saved draft. The editor applies them to a preview copy, the builder hits Keep (one undo entry) or Retry. Rate-limit through the existing daily claim/publish quotas. Once the Clear Check exists, sketches still have to be cleared by the human before publishing, which keeps quality up. Pairs naturally with templates (same command format).

**Evidence.**

- src/cloudflare/worker/rooms/commandCore.ts:767 — command request normalization/validation
- src/cloudflare/worker/rooms/commandCore.ts:922 — pure applyRoomDraftCommands
- public/skill.md:41-58 — agent builder workflow already defined for external agents
- public/agent-room-design.md:46-98 — design heuristics ready to reuse as prompt guidance

**Fact-check (confirmed).**

Implementation details the claim glosses over:
- **"One undo entry" needs new undo support.** The editor's undo list (src/scenes/editor/editRuntime.ts:220-230) has only tiles, objects, spawn, goal and music entries. Nothing restores a whole room, so "Keep" needs a new whole-room or compound undo kind.
- **Sketched terrain won't be Smart terrain.** commandCore never writes RoomSmartTerrainState, which tile undo tracks via smartBefore/smartAfter. Terrain from a sketch would be plain tiles, and the Smart/autotile tools may not treat it as smart terrain unless that is added.
- **The daily quotas can't serve as the rate limit.** They count claims and publishes, not generations, so one claimed room could be sketched without limit. The route needs its own per-user generation counter (like the comment limits at roomComments/routes.ts:62-63), and guests should be excluded.
- **The cost of LLM calls needs an owner decision.** That covers who pays for the calls (a Workers AI binding or an external API key) and the per-day cap.
- **Ship starter templates first.** Backlog G-001 is already prioritized High. A template can be stored as a saved RoomDraftCommand[] list in the same format and applied with the same preview/Keep flow, so it builds most of the sketch feature's plumbing without any LLM. Add the AI sketch on top afterwards.

### F220: Music editor re-renders the whole song on every note edit and keeps every version in memory

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** While the Play preview is on, every painted cell, every step of a volume or pan slider drag, and every phrase dropped into an Arrange slot rebuilds the entire loop on the main thread. Every version is then kept in memory for the rest of the session. Drawing notes stutters on phones and tablets, and a long composing session can grow to hundreds of MB and crash an iPad or iPhone tab.

**Technical detail.**

musicWorkflow.ts:764-772 commitRoomMusic calls syncRoomMusicPreviewPlayback (745-761), which calls globalRoomMusicController.playArrangement for every commit. musicPatternEditor.ts:537-570 commits on each pointermove cell, and setActiveInstrumentMix (360-385) commits on each slider move. Volume has 51 quantized values and pan has 41, so one slider drag can mean about 50 full renders. Each new pattern key goes through loadPatternLoopBuffer (controller.ts:1020-1039), or loadPhraseArrangementLoopBuffer (1042-1063) for Arrange, and is stored in patternLoopBufferPromises with no eviction anywhere (no .delete or .clear on these maps in src/music). Size: a 2-bar pattern is 1.5 MB at 120 BPM and 3 MB at 60 BPM (stereo Float32 at 48 kHz). A 16-slot arrangement is 25-49 MB per edit. Fix: (1) debounce preview re-renders to about 150 ms after the last edit or pointerup, and drop superseded requests before rendering, not after; (2) give editor-preview its own cache capped at 2 entries (current plus previous, kept for the crossfade) and free the rest; (3) never re-render for mix changes: render per-instrument mono stems and apply volume/pan with Gain and StereoPanner nodes (see the stems idea); (4) for Arrange, render each unique 2-bar slot once and schedule the slots, not one 64 s buffer.

**Evidence.**

- src/scenes/editor/musicWorkflow.ts:764-772 — every commitRoomMusic re-syncs preview playback while playing
- src/scenes/editor/musicWorkflow.ts:758-761 — preview calls playArrangement(roomMusic, {mode:'editor-preview', transition:'immediate'})
- src/scenes/editor/musicPatternEditor.ts:360-385 — mix slider rounds to 1/50 (volume) and 1/20 (pan) and commits on every change
- src/scenes/editor/musicPatternEditor.ts:537-570 — pointermove paints commit per cell
- src/music/controller.ts:1020-1039 — each distinct pattern key is rendered and stored in patternLoopBufferPromises
- src/music/controller.ts:116-118 — buffer caches are plain Maps; grep finds no delete or clear on them
- Benchmark (esbuild bundle of patternRenderer, Node, Apple silicon): 2-bar pattern 13.7 ms / 1.5 MB; 8-slot arrangement 84 ms / 12.3 MB; 16-slot 171 ms / 24.6 MB per render

**Fact-check (confirmed, confirmed, confirmed).**

The claim is correct, with four small additions.
- **When it happens:** the cost and the memory growth only occur while editor Play preview is on (`musicPreviewState === 'playing'`). They do not occur during normal editing with preview stopped.
- **Fix item 1 is right:** the stale-request check at controller.ts:666-670 and 738-742 sits after the `await` on the buffer, so dropping superseded requests before rendering is the correct change.
- **Garbage per render:** each render also creates about 5 temporary full-length Float32Arrays (patternRenderer.ts:268-295). That adds GC pressure beyond the buffer that gets cached.
- **Gameplay:** the same unbounded maps also keep every room's music buffer as a player moves around the world, so a size-capped cache helps gameplay too, not just the editor.

On effort: the debounce plus a capped editor-preview cache is a small job. Per-instrument stems with Gain/StereoPanner nodes, and scheduling Arrange per slot, are medium-sized.

Minor fixes and additions; the core claim stands as written.
1. The arrangement buffer length follows the highest filled slot, not the chosen slot count (phraseArrangement.ts:316-336, getRoomPhraseArrangementActiveSlotCount). The 25-49 MB per-edit figure applies only once slot 16 is filled; an arrangement filled to slot 8 is 12-25 MB.
2. The render is not fully synchronous. Tonal tracks are synthesized synchronously in a microtask, but renderDrumTrack is awaited (patternRenderer.ts:296), so drum rendering can land in a later task. Either way, the work runs on the main thread.
3. Each render also creates about 3x the cached buffer's size in temporary garbage (patternRenderer.ts:268-295).
4. The unbounded cache is shared with world play (OverworldPlayScene.ts:1147-1158 → roomMusicPlaybackController.ts:128). The fix should therefore be a global size or LRU cap on patternLoopBufferPromises and laneLoopBufferPromises, for example a few entries or about 50 MB. Capping only an editor-preview cache would leave world play growing.

The core claim is accurate. Three refinements:

(a) The scope is wider than the editor. The same never-freed cache also grows during world play: roomMusicPlaybackController.ts:128 calls playArrangement on the shared globalRoomMusicController (OverworldPlayScene.ts:1147-1158). Any eviction or size cap should cover world-play mode as well, for example a small LRU across the whole controller. bufferPromises and laneLoopBufferPromises (controller.ts:116-117) are also never freed.

(b) The mix slider is only reachable in sequencer mode (handleMusicPointerDown is gated at musicWorkflow.ts:786). Slider drags therefore re-render 2-bar patterns (about 1.5-3 MB each), never 64 s arrangements. In Arrange mode the re-render triggers are slot drops and clears plus the tempo, swing, key, mode and octave buttons.

(c) Effort is split. Fixes 1 and 2 are small: debounce or render on pointerup for drags and slider moves, and an LRU cap of about 2-4 entries. Fixes 3 and 4 are medium, not small. Fix 3 (per-instrument stems mixed with Gain and StereoPanner nodes) needs a master WaveShaper to reproduce finalizeBuffer's tanh soft-clip. Fix 4 (scheduling Arrange slots one by one) has to re-implement the loop-offset and transport sync in controller.ts:676-707.

The crash risk on iOS is plausible but needs a long session with the preview on. On the editor side alone the impact would be medium. Including the world-play buildup keeps it high.

### F224: Room-to-room music transitions: mid-note starts, slow cross-tempo blends, and a 'ghost' room on fast crossings

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Walk from a silent room into a music room and the song jumps in at a random point, often mid-note with a click and no fade. Going between rooms with different tempos waits up to a bar, then blends two clashing tempos for another bar (up to 8 seconds at 60 BPM). Darting through a room quickly can make that room's music blast briefly at full volume.

**Technical detail.**

(1) Re-entry: stopArrangement nulls activePattern, so in playPatternArrangement (controller.ts:674-704) quantizeToBar and hasPriorPlayback are both false, startAt is now+0.02, and loopOffset is (startAt - transportStartTime) % loop, which is an arbitrary sample. startLoopPlayback then sets full gain with no fade (controller.ts:1092). (2) The transport is never re-anchored in world play (resetTransport only on mode exit), so the bar grid comes from the first room of the session. A 145 BPM room's 'bar boundary' is computed on a grid started by a 60 BPM room, and the fade lasts one bar of the new tempo (controller.ts:677-679). With 60 BPM rooms (4 s bars) you get up to a 4 s wait plus a 4 s crossfade. Production tempos vary widely: 10 distinct BPMs among 37 sampled music rooms, 14 of them at 60. (3) Ghost room: if room B is still waiting for its start time when C is requested, scheduleStopPlayback (controller.ts:1131-1132) cancels B's pending fade-in, reads gain.value (still the default 1.0), and fades from 1.0 over a full bar, so B plays loud. (4) No hysteresis: the room switches the instant the player's center crosses (roomTransition.ts:211), so bouncing on a doorway retriggers. Fix: if a playback has not started yet, stop it at its start time with no fade; always fade in about 80 ms and start new music at bar 1 (offset 0) when there is no prior playback; re-anchor transportStartTime to each new room's start; same tempo and key: keep the phase-locked bar crossfade; different tempo: fade out in about 300 ms and start the new room on its own downbeat; add about 0.4 s or 24 px of hysteresis before switching.

**Evidence.**

- src/music/controller.ts:674-681 — quantize only if something is playing; loopOffset taken from a transport that is never reset
- src/music/controller.ts:1092 — startSilent=false means full gain immediately (no fade-in)
- src/music/controller.ts:1131-1132 — cancelScheduledValues then setValueAtTime(gain.value) on a not-yet-started node
- src/music/controller.ts:1161-1168 — next bar boundary measured from the session's first transportStartTime
- src/scenes/overworld/roomMusicPlaybackController.ts:119-131 — empty room stops with 'bar'; music room plays with 'bar'
- src/scenes/overworld/roomTransition.ts:211 — room changes the instant the player point crosses the edge
- Production sample: BPMs 60 (14), 120 (11), 100, 65, 75, 105, 135, 145, 90, 70

**Fact-check (confirmed, confirmed, confirmed).**

Small refinements, not refutations:
(a) The fade-in is not just missing. The callers pass fadeInDuration 0.08 for starts with no prior playback (controller.ts:703, plus the same in the phrase and stem paths at 628), but startLoopPlayback only applies a fade when startSilent is true (controller.ts:1094). The simplest fix is to always ramp from 0 over fadeInDuration whenever fadeInDuration > 0.
(b) The room-crossing check is at roomTransition.ts:131 (getRoomCoordinatesForPoint), and :211 is where the change is committed.
(c) The same start/stop logic is duplicated in playPhraseArrangement (744-753) and playStemArrangement (575-584). A fix has to cover all three, ideally through one shared helper.
(d) Entering an empty room also keeps the old music playing until its next bar boundary before the 0.18 s fade (controller.ts:237-238), which can be up to 4 s at 60 BPM.
(e) The ghost-room case needs B's buffer to be already cached or quick to render, and C's request has to arrive before startAt_B - 0.02. Bouncing back and forth across a doorway meets both conditions.
(f) The production BPM distribution was not independently verified.

These are small precision fixes; the core claim holds. (a) In case 1 the entry point is not random. It follows a clock that has been running since the first music room of the session, so it is deterministic but not on a bar line. The problem only occurs once a music room has played earlier in the session. The very first music room after entering Play starts at offset 0, though it still has no fade. The real bug is that the fadeInDuration of 0.08 passed at controller.ts:703 is ignored because startSilent is false (controller.ts:1092-1096). (b) There is a related problem the reviewer did not list. When a silent room is crossed in under a bar, the previous room's music keeps playing until its scheduled bar-quantized stop, and the controller no longer tracks it. If the next music room is the same song, it restarts as a second copy over the tail of the first, because the 'already-playing' check sees activePattern as null. (c) Case 3 is louder than described for stem and lane music: gain.value reads 1.0 while those lanes normally play at about 0.6 (controller.ts:630). (d) The 145-on-60 grid point is right but needs one clarification. The boundary falls on the new room's own bar length counted from the session start, so it lines up with neither song's actual downbeat.

The core claims are accurate. Additions and refinements:
(a) The same bug also affects stem-pack music (playStemArrangement, controller.ts:577-584 and 628-629), and phrase arrangements (controller.ts:746-753 and 775-776), not only pattern rooms.
(b) The root cause of (1) is that controller.ts:1094 gates the fade-in on startSilent. The authors meant to fade in over 80 ms (the 0.08 passed at :703), so the simplest fix is to always schedule 0 → baseGain over fadeInDuration.
(c) There is a related case. Going from music room A to a silent room and back to A within a bar starts a second, phase-aligned copy of A at full gain while the old copy is still playing until the bar boundary. A is roughly 6 dB too loud for up to a bar.
(d) When the room after a pending room is silent, the ghost is a 0.18 s blip, not a full-bar fade. Stem lanes are boosted from about 0.6 to 1.0.
(e) Re-anchoring the transport is not what fixes the long wait, because the wait comes from bar length, not grid origin. The real fix for tempo changes is the proposed short fade-out followed by a start on the new room's own downbeat. A music-only debounce in roomMusicPlaybackController.sync is safer than adding hysteresis to the gameplay room transition.
(f) Impact is closer to medium: frequent but cosmetic audio polish.

### F221: Most room loops click at the seam, and open hi-hats pile up into hiss

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** In 36 of 45 published pattern rooms, a note or drum tail is cut off when the loop restarts, so you hear a click or chopped cymbal every 4-8 seconds for as long as you stay in the room. Open hi-hats also ring for 3.5 seconds and stack on top of each other (up to 29 at once in one room), which muddies the mix in a way a real drum machine never would.

**Technical detail.**

patternRenderer.ts:127-131: a note on the last step sustains to loopDurationSec, and totalSamples is clamped to target.length, so the waveform is cut mid-cycle at sustain level (0.74 x amplitude) with no release. When the loop wraps to sample 0, the result is a discontinuity. Drums do the same at patternRenderer.ts:185 (copyLength = min(sample.length, target.length - startSample)), so crash (1.88 s after trimSilence) and open hat (3.56 s) tails are hard-cut at the loop end. Fix: render into a buffer of loop length plus the longest tail, then fold samples past the loop end back onto the start (target[i % loopSamples] += …), so release tails and cymbals wrap seamlessly. Add choke groups in renderDrumTrack (patternRenderer.ts:177-190): a closed hat or another open hat should cut a ringing open hat with a 5-10 ms fade, and ideally each drum row should be monophonic like an MT-32 or 808 voice. Optional: naive saw and square oscillators (patternRenderer.ts:55-66) alias on high notes; a PolyBLEP correction using phaseStep is about 10 lines and makes Saw and Square sound less harsh.

**Evidence.**

- src/music/patternRenderer.ts:127-131 — last note runs to loopDurationSec; totalSamples clamped to buffer end (hard cut)
- src/music/patternRenderer.ts:183-189 — every drum hit summed in full, tail truncated at buffer end, no choke
- public/assets/music/roland-mt32/hat-open.wav — 3.76 s raw / 3.56 s after the trimSilence threshold; crash.wav 1.88 s
- Production sample (GET /api/rooms/{id}/published for 45 pattern rooms): 28 have a tonal note on step 32, 21 have a drum tail crossing the loop end, 36 have at least one
- Same sample: 18 rooms use open hat; worst case 29 open-hat voices overlapping
- src/music/patternRenderer.ts:55-66 — non-band-limited triangle, saw and square

**Fact-check (confirmed, confirmed, partially confirmed).**

The core seam bug and all line references are accurate. Three corrections on severity and details:

1. Hi-hat build-up is overstated. The missing choke is real, and dense open-hat patterns can technically have about 29 overlapping voices. However, the trimmed hat-open decays about 16 dB/s, so stacked tails add only a few dB of extra wash: about +2 dB for 8th notes and about +4 dB for every 16th. That is a smeared, unchoked open hat, not a "hiss" pile-up. The worst case in my own 11-room sample was 4 overlapping, so the 29 figure is unverified, though the code allows it.

2. The seam repeats every 2.4–8 s depending on BPM (4 s at the 120 bpm default), not strictly every 4–8 s.

3. Triangle aliasing is negligible. The PolyBLEP suggestion matters only for saw and square.

Impact should be medium rather than high. Only rooms with pattern or phrase music are affected (about 11 of 81 in my sample), but in those rooms the click repeats for as long as the player stays.

Small corrections to the details:
- The loop is 32 steps (8 beats) at 60-200 BPM, so the seam comes every 2.4-8 s, not every 4-8 s.
- The open-hat sample is 3.56 s long after trimming, but most of it is quiet. Its RMS is about 0.08 at 0.5 s, about 0.034 at 1 s and about 0.006 at 2 s, against a normalized peak of 0.92.
  - So "29 voices overlapping" counts tails that are nearly silent and overstates how much they build up into hiss.
  - In my sample, the worst case was 5 overlapping open hats, so I could not reproduce 29.
  - Choke groups are a real improvement, but the seam click and chopped tails are the main defect.
- Impact is medium, not high: only the roughly 15% of rooms that have music are affected, though in those rooms it happens on every loop.
- Effort stays small: the renderer builds the loop offline. Rendering extra tail samples and folding them back to the start (i % loopSamples), then fading out any open hat when the next hat hits, takes about 20-40 lines in patternRenderer.ts.

Seam truncation (the core of the claim) is confirmed, with these corrections:

1. Scope. In an independent sample of 300 published rooms (37 unique pattern rooms), 32 of 37 cut something at the loop end. Only about 24 of 37 (~65%) are plausibly audible: cut content above -40 dBFS, or a seam step above 0.02 of full scale. The rest are tiny closed-hat or clap tails. Phrase-arrangement rooms (controller.ts:1060) and the editor preview use the same renderer, so they are affected too.

2. Open hats. "Hiss pile-up" is overstated. The open hat's audible tail is about 1 s (-17 dB at 1 s, -32 dB at 2 s), not 3.5 s. The 29-voice worst case is a room with the drum mix at 0.14 volume. A simulated choke changes drum-bus level by only 0-1.1 dB. Treat choke groups as an optional sound improvement, not part of the defect.

3. Implementation notes for the fold fix:
- Fold each track's mono buffer before the nonlinear stages: applySoftDrive at patternRenderer.ts:282 and :297, and finalizeBuffer at :308.
- Size the extra length by the longest sample actually used: crash 1.88 s, open hat 3.56 s, low tom 1.04 s.
- The first playthrough will carry a faint "previous loop" tail at t=0. The 0.08 s fade-in in startLoopPlayback (controller.ts) hides it.
- Buffers are only cached in memory per session (patternLoopBufferPromises), so there is no persisted cache to clear.
- PolyBLEP anti-aliasing remains optional polish.

### F223: Entering a room builds its music on the main thread, causing a frame hitch at the doorway

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** Room music is synthesized sample by sample in JavaScript at the moment you cross into the room, which is exactly when you are running and jumping. On phones that is roughly a 50-110 ms freeze for a normal room, and up to about a second for long arranged songs. Building the music in the background while you approach the room removes the hitch.

**Technical detail.**

loadPatternLoopBuffer (controller.ts:1020-1039) wraps renderRoomPatternLoopBuffer in Promise.resolve().then, which is a microtask and still one long main-thread task. The renderer (patternRenderer.ts:260-315) runs per-sample loops for 3 tonal tracks, 4 tanh passes, 4 mix passes and a stereo copy. envelopeAt recomputes Math.round(attackSec*sampleRate) for every sample (patternRenderer.ts:75-76). Measured on the 45 real production patterns (Node, Apple silicon): median 12.5 ms, p90 18.8 ms, max 22 ms. Arrangements: 84 ms (8 slots) and 171 ms (16 slots, dense). Expect 4-6x slower on mid-range phones (estimate). Fix: (a) move the renderer into a module Worker (it is pure Float32Array math; post the decoded MT-32 drum samples in once, then transfer the channel buffers back); (b) pre-render when a neighbor room is predicted, using the existing roomTransition.ts:284 prepareApproachingNeighbors / preparePlayableRoomForTransition hook, so playArrangement finds a ready buffer; (c) hoist the envelope constants out of the per-sample loop. Optionally, render with OfflineAudioContext oscillators, which run off the main thread and are band-limited.

**Evidence.**

- src/music/controller.ts:1020-1039 — render happens lazily inside playArrangement on room entry
- src/music/patternRenderer.ts:260-315 — synchronous per-sample synthesis and mixing
- src/music/patternRenderer.ts:75-76 — Math.round of attack and decay recomputed per sample
- src/scenes/overworld/roomTransition.ts:284-314 — neighbor-approach preparation hook that music prefetch can reuse
- src/scenes/OverworldPlayScene.ts:2295-2299 — roomMusicPlaybackController.sync runs in the frame update right after the room changes
- Benchmark on 45 production patterns: median 12.5 ms, p90 18.8 ms, max 22.1 ms per render (desktop)

**Fact-check (partially confirmed).**

The hitch happens only the first time each distinct song is heard in a session: renders are cached forever by music key (controller.ts:118, 1024). On desktop a normal 2-bar pattern costs 7–19 ms, about one frame. The real pain is on phones and with 8–16-slot arrangements: 74–262 ms on desktop, so possibly a second or more on phones.

For phrase arrangements, the render waits for network phrase fetches first (libraryClient.ts:94-99). Their hitch lands a moment after entry rather than at the seam.

Prefetching via prepareApproachingNeighbors (roomTransition.ts:332-356) on its own only moves the freeze into the run-up. It must be paired with the Worker, or with chunked rendering spread over idle time.

Two related problems should go in the same fix:
- **Memory.** The unbounded buffer cache is a phone memory risk. A 16-slot, 120 bpm arrangement makes a roughly 24.6 MB stereo AudioBuffer at 48 kHz. During rendering, about six full-length temporary Float32Arrays (around 74 MB at peak) are allocated, and every buffer visited stays cached for the whole session. Cap the cache with an LRU of a few entries.
- **Muted music still renders.** Rendering still runs when the player has music volume at 0: main.ts:180 sets the volume, but playArrangement has no volume or mute check. Cheap win: skip or defer the render while muted.

Hoisting the envelope constants (patternRenderer.ts:75-76) is a minor micro-optimisation, not the main cost.

### F225: Played room music is never freed; it is always stereo and still rendered when music volume is 0

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Every room's song you hear stays in memory until you reload, so roaming the world steadily eats RAM on phones (about 100 MB for today's 45 pattern rooms, plus 16-20 MB per arranged room). Most songs are mono but stored in stereo, and players who turn music off still pay the full CPU and memory cost.

**Technical detail.**

bufferPromises, laneLoopBufferPromises and patternLoopBufferPromises (controller.ts:116-118) are plain Maps with no eviction (sets at 937, 1038, 1063). The renderer always creates a 2-channel buffer (patternRenderer.ts:311), but 33 of 45 production patterns have all four pans at 0, so both channels are identical. setVolume (controller.ts:320-333) only moves the master gain, and playArrangement never checks for volume 0. Fix: (1) replace the Maps with a small LRU keyed by music key, budgeted by bytes (e.g. 24 MB on phones, 64 MB on desktop), always pinning the active and predicted-neighbor entries, and evict rejected promises; (2) if every pan is 0, render one channel (AudioBufferSourceNode upmixes) to halve memory; (3) when musicVolume is 0, skip fetch and render and stop playback, then re-sync when volume goes above 0.

**Evidence.**

- src/music/controller.ts:116-118 — three unbounded buffer caches
- src/music/controller.ts:937, 1038, 1063 — set with no delete anywhere in src/music
- src/music/patternRenderer.ts:311 — createBuffer(2, …) always stereo
- src/music/controller.ts:320-333 — volume 0 only lowers the gain; rendering still happens
- Production sample: 45 pattern buffers total 104 MB if all are visited; 33/45 are fully center-panned

**Fact-check (confirmed).**

Three corrections:
- **Line cites.** The lane-loop cache is set at controller.ts:1016. Line 1063 is the phrase-arrangement set, which stores into patternLoopBufferPromises.
- **Unverified numbers.** I could not confirm the production figures (45 rooms, 104 MB, 33 of 45 center-panned). Treat them as estimates: about 1.5 MB per pattern at 120 BPM and up to about 3 MB at 60 BPM, at 48 kHz stereo float.
- **Missing editor case.** Add the larger growth path the claim left out. While editor preview is playing, every song edit re-renders the whole buffer and caches it forever, because the cache key covers the full song contents. Edits include painting a note and moving the volume or pan slider (musicPatternEditor.ts:360-385 and :1345, then musicWorkflow.ts:764-771, then controller.ts:1038). The fix needs two more pieces: remove the old preview key whenever a newer edit replaces it, and debounce slider-driven re-renders. A failed entry should also be removed from its Map in a .catch() so the song can load again later.

### F222: Arranged rooms depend on other people's phrases by live ID: deletes and edits break or change them, and loading takes 26-28 API calls

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** medium · **effort:** medium

**Summary.** An Arrange-mode room stores only links to library phrases, not the notes. If any of those phrase authors deletes or overwrites a phrase, the room's music silently changes or goes completely silent. The delete confirmation even says it 'only removes your saved phrase entry'. Each visit also fires one uncached API call per phrase before the music can start.

**Technical detail.**

RoomPhraseArrangementLaneSlots is (string|null)[] of phrase IDs (phraseArrangement.ts:47). At play time controller.ts:1042-1063 calls loadMusicPhrasesById, which does one GET /api/music/phrases/:id per unique phrase (libraryClient.ts:67-100). The responses have no Cache-Control header (http.ts:109-121), so only the in-memory promise cache helps. Promise.all means one 404 fails the whole arrangement. The rejected promise is also cached forever in both phrasePromiseCache and patternLoopBufferPromises, so one flaky mobile request leaves that room silent for the session. Server side: deleteMusicPhrase (store.ts:854-874) and overwrite (store.ts:393-437, UPDATE payload_json by id) never check whether any room references the phrase. In production, room -4,10 uses 28 phrases (27 from 16 other rooms by 10 creators) and room -4,-4 uses 26; serial GETs took about 2.8 s from a desktop connection. Fix: (1) when an arrangement is saved or published, embed each referenced phrase's materialized payload in the room music (e.g. phrasePayloads: {id: payload}, about 1 KB each), keep the IDs only for credit and remix lineage, have the client prefer embedded payloads, and backfill existing rooms with a one-off script; (2) until then, add a batch GET ?ids= endpoint with Cache-Control, and delete rejected promises from the client caches; (3) fix the delete copy, or block deleting phrases that are in use.

**Evidence.**

- src/music/phraseArrangement.ts:47 — arrangement slots hold phrase IDs only
- src/music/controller.ts:1042-1063 — phrases are fetched at play time; the promise is cached even if it rejects
- src/music/libraryClient.ts:67-100 — one GET per phrase; failed promise never evicted; Promise.all fails the whole set
- src/cloudflare/worker/music/store.ts:854-874 — delete has no reference check
- src/cloudflare/worker/music/store.ts:393-437 — overwrite rewrites payload_json in place
- src/ui/setup/musicControls.ts:272 — confirm text: 'This only removes your saved phrase entry.'
- src/cloudflare/worker/core/http.ts:109-121 — jsonResponse sets no Cache-Control
- Production: room -4,10 needs 28 phrase GETs from 16 rooms and 10 creators; -4,-4 needs 26

**Fact-check (confirmed, confirmed, partially confirmed).**

One small correction: the client starts all phrase GETs at the same time (Promise.all), so the real wait is about the slowest single request plus browser connection limits, not the 2.8 s serial total. Also, overwriting is limited to the phrase's creator re-saving from that phrase's own source room and instrument (store.ts:400). It still changes every arrangement that references the phrase.

One small sourcing detail is off. Room -4,10's 28 phrases come from 16 rooms in total, and that count includes -4,10 itself (1 phrase). So it is 27 phrases from 15 other rooms, by 10 distinct creators, not "16 other rooms". Also, overwrite is limited to the phrase's creator working in that phrase's own source room, which matches "phrase authors" in the claim. Everything else is accurate. On impact: the confirmed mechanisms are the delete and overwrite risk plus the session-long cached failure, but deletions are owner-only, rare actions, and the actual production rate of broken arrangements was not measured. So medium rather than high is the defensible rating. The 26-28 uncached, unbatched calls per arranged room are confirmed and matter most on mobile.

The client fetches phrases in parallel via Promise.all, not one by one. 28 concurrent GETs took about 0.25 s, so the "about 2.8 s" serial figure does not describe what players experience. The real cost is 26-28 uncached Worker/D1 round trips per room visit, plus a slightly later music start on mobile.

None of the phrases in the two cited rooms are currently missing (51 of 51 return 200), so the breakage is latent, not happening now.

Room -4,-4's 26 phrases all come from one source room by one creator. Only -4,10 shows dependence on many creators (27 phrases from 16 rooms and 10 creators).

Overwrite is limited to the phrase's creator and its origin room, but it is the default Save action (src/scenes/editor/musicWorkflow.ts:249, 257), so changes reaching other rooms are common. Whether that counts as a bug or a feature is a product decision. The unambiguous defects are:
- one deleted phrase, or one failed fetch, silences the whole arrangement (Promise.all, with the error swallowed at controller.ts:202);
- the rejection stays cached for the session, since patternLoopBufferPromises is never evicted.

Recommended order: first ship the small fixes (allSettled, evicting failed promises, a delete guard or copy change, Cache-Control on the GET). Then embed payloads at publish time as a medium follow-up.

### F229: Three audio engines run at once; music never pauses when the tab is hidden

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The game spins up three separate audio engines: Phaser's built-in one (never used), one for music and one for muffled sound effects. Music also keeps playing after you switch tabs or background the browser on desktop and Android. Using one shared audio engine and pausing it when hidden saves battery, avoids unlock glitches on iPhones, and gives one mixer for things like ducking music under victory stings.

**Technical detail.**

(1) main.ts:76-102 has no audio key in the Phaser config. Phaser 3.90 WebAudioSoundManager creates an AudioContext at boot (WebAudioSoundManager.js:47, 153) and registers unlock listeners, but the codebase never uses this.sound (grep finds none). Set audio: { noAudio: true }. (2) Music creates its own context (controller.ts:868) and SFX creates another for the low-pass route (sfx.ts:834, used at 780). Export one shared context from a tiny src/audio/engine.ts with musicBus and sfxBus GainNodes into a master, so music can be ducked under stings or death and both share one unlock and resume path. (3) Both controllers only resume on visibilitychange or focus (controller.ts:150-153, sfx.ts:411-414) and never call suspend(). Suspend the shared context when document.hidden and resume on visible. In the statechange handler (controller.ts:873), when state becomes 'suspended' or 'interrupted' (iOS phone call or Siri) while visible and the user has interacted, try resume() instead of only logging it. (4) Where available, set navigator.audioSession.type once (Safari 16.4+) so music and SFX behave the same with the iPhone silent switch. Today Web Audio music and HTMLAudio SFX follow different rules.

**Evidence.**

- src/main.ts:76-102 — Phaser GameConfig has no audio:{noAudio:true}
- node_modules/phaser/src/sound/webaudio/WebAudioSoundManager.js:47,153 — Phaser creates its own AudioContext
- src/music/controller.ts:868 — music AudioContext
- src/audio/sfx.ts:834 — SFX AudioContext (for createMediaElementSource at 780)
- src/music/controller.ts:150-153 — resume on visible; no suspend on hidden
- src/music/controller.ts:873-878 — statechange only records debug info

**Fact-check (partially confirmed).**

The music and SFX AudioContexts are created lazily, not at boot. Music creates its context on first playback or clip preview (controller.ts:856-868). SFX creates its context only the first time a routed cue plays, mainly the muffled sound from adjacent rooms (roomAudio.ts:20-49 → sfx.ts:517/541 → 834). Most SFX are plain HTMLAudio playback. Only Phaser's unused context always exists from boot. Two or three contexts can exist at once, but not from page load. The most valuable fix is the hidden-tab suspend/pause, plus `audio: { noAudio: true }`. Merging into one shared engine with buses is a nice-to-have, mostly useful for future ducking; it has no proven unlock or battery benefit.

### F226: Sequencer overlay redraws 24 text labels and deep-clones the song every frame

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** While the music grid is open, the editor rebuilds all of its row-name and mix labels as fresh images every frame, even when nothing changed, and copies the whole song every frame just to place the playhead. This burns CPU and battery on tablets and phones and makes the editor feel sluggish.

**Technical detail.**

EditorScene.ts:1029 calls musicPatternController.updateOverlay every frame. updateOverlay (musicPatternEditor.ts:695-708) clears and redraws the backdrop, about 55 grid line paths, the cells and the mix panel, then updateRowLabels and updateMixLabels. Those call Text.setColor on 22 row labels plus 2 mix labels (1104, 1127, 1132). In Phaser 3.90, TextStyle.setColor always calls update() → Text.updateText(), which redraws the canvas and re-uploads the texture (TextStyle.js:756-760, Text.js:1245, 1455). Unlike setText, it has no 'same value' check, so that is 24 canvas renders plus GPU uploads per frame. drawPlayhead uses getMusicPlaybackDebugState (musicPatternEditor.ts:1021), which runs controller.getDebugState() including cloneRoomMusic and getRoomMusicKey string building (controller.ts:506-537) every frame. Fix: cache the last color, text and tab per label and call setColor only when it changes; redraw grid, cells and backdrop only on a dirty flag (pattern key, tab, theme, origin); add a cheap controller.getPlayheadInfo() that returns {audioTime, transportStart, startTime, loopDurationSec, kind} without cloning.

**Evidence.**

- src/scenes/EditorScene.ts:1029 — updateOverlay called every frame in music mode
- src/scenes/editor/musicPatternEditor.ts:695-708 — full redraw every frame
- src/scenes/editor/musicPatternEditor.ts:1104, 1127, 1132 — setColor on 24 Text objects every frame
- node_modules/phaser/src/gameobjects/text/TextStyle.js:756-760 — setColor always calls update() and re-renders
- src/scenes/editor/musicPatternEditor.ts:1021 — playhead reads the full debug state
- src/music/controller.ts:506-537 — getDebugState deep-clones currentArrangement and builds the key string

**Fact-check (confirmed).**

There is one small overstatement. The song copy and key-string building in getDebugState do not run on every frame the sequencer is open. They run only while the music preview is playing: drawPlayhead returns early when getMusicPreviewState() !== 'playing' (musicPatternEditor.ts:909-911). The 24 setColor re-renders and texture uploads do happen on every frame the sequencer is open, playing or not.

Also, a dirty flag on the Graphics redraws (backdrop, grid, cells, mix) saves less. Phaser's WebGL Graphics re-submits its command buffer every frame anyway, so the saving is only the JS-side command rebuilding. The biggest win is caching each label's color, text and alpha so setColor runs only when the color actually changes. Next is a cheap getPlayheadInfo() that avoids cloneRoomMusic and getRoomMusicKey.

### F227: Phone sequencer cells are about 8-13 px, far too small to tap accurately

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** On phones the music grid is the whole room squeezed onto the screen, so each note cell is roughly the size of a fingertip's edge (well under the usual 44-48 px tap target). Phone builders will hit wrong notes and paint accidental ties. A phone mode that shows one bar and one octave at a time would make cells about 3x bigger.

**Technical detail.**

The grid is a 32x22 cell grid of 16 px tiles (config/room.ts:2-4). The camera fit frames room + 72 px label gutter + 48 px neighbor peeks (musicRoomFit.ts:33-35; interaction.ts:350-364), a 760x448 world-px frame, with zoom = min(vw/760, vh/448) (musicRoomFit.ts:152-155). The phone overlay also reserves 84 px of bottom padding plus a wrapped control shell (phone-editor-music.css:1-8). Estimate (not measured): a 390 px-tall landscape phone gives zoom about 0.5-0.8, so cells are about 8-13 CSS px; portrait 390 px wide gives zoom about 0.49, so about 8 px. Fix: on data-device-class='phone' (and coarse-pointer tablets), use a paged sequencer view: 16 steps (one bar) x 8-12 rows (one octave, or the active drum rows) with Bar 1/2 and Octave up/down buttons, dropping the neighbor peek. That gives about 2.5-3x larger cells. Make pencil-drag ties opt-in on touch (tap = note, long-press-drag = tie).

**Evidence.**

- src/config/room.ts:2-4 — 16 px tiles, 40x22 room used as the music grid
- src/scenes/editor/musicRoomFit.ts:33-35 — 72 px gutter and 48 px neighbor peek added to the frame
- src/scenes/editor/musicRoomFit.ts:152-155 — zoom is fit-to-viewport with no minimum cell size
- src/scenes/editor/interaction.ts:350-364 — music fit uses gutter and peek insets on all devices
- src/styles/sections/responsive/phone-editor-music.css:1-8 — phone overlay reserves 84 px of bottom padding

**Fact-check (partially confirmed).**

1. **Grid size.** The music grid is 32 steps × 22 rows (src/music/pattern.ts:33-34) inside the 40×22-tile room (config/room.ts). The finding says both "32x22" and "40x22". The frame math (760×448) is correct.
2. **84-px padding.** The 84-px bottom padding on the phone overlay (phone-editor-music.css:1-8) does not shrink the fit. readMusicRoomViewport subtracts only the .editor-music-shell box (when it sits at the top) and the left workbench column (musicRoomFit.ts:100-120, 239-257). What actually costs height is the wrapped phone shell sitting at the top of the screen (flex-wrap, phone-editor-music.css:17-32).
3. **Landscape estimate.** The landscape figure of 8-13 px is too optimistic. A landscape phone is about 340 px tall once the browser chrome is gone, and the wrapped shell takes roughly another 100-150 px. That leaves about 190-230 px for the frame, so zoom is about 0.42-0.51 and cells are about 7-8 px. Portrait is also about 7.8 px.
4. **Zoom is blocked.** The finding misses that pinch and wheel zoom are deliberately blocked in music mode (interaction.ts:847, 893-895, 1095-1100). That makes the problem worse. It also points to a quick partial fix: on touch devices, allow two-finger pinch-zoom and pan in music mode while one finger keeps painting notes.
5. **Paged view still falls short.** A one-bar (16-step) paged view frames about 16×16 + 72 = 328 world px across a 370-px viewport. That gives zoom of about 1.13, so cells of about 18 px. This roughly matches the "2.5-3x larger" claim but is still well under a 44-px tap target. Reaching 44 px would need fewer steps per page (about 8) or dropping the label gutter on phones.
6. **Easy wins.** Making ties opt-in on touch (tap places a note; long-press then drag makes a tie) is valid. It targets shouldTieFromPrevious in musicPatternEditor.ts:1413-1417. That change plus enabling pinch-zoom are small. The full paged view is medium effort.

### F231: No way to audition a library phrase before placing it, and no playhead in Arrange mode

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Clicking a phrase in the library immediately writes it into your song, so the only way to hear it is to place it and undo it. In Arrange mode you can't see which slot is playing, and the sequencer playhead runs slightly ahead of the sound, more so with swing or Bluetooth headphones.

**Technical detail.**

useMusicPhrase (musicWorkflow.ts:616-627) inserts or assigns on click. The library items (musicUi.ts:220-223) have no play button, and the drag-to-slot path relies on HTML5 dragstart (musicControls.ts:340-360), which touch devices largely don't fire, so phones only get click-to-commit. resolvePlayheadStep returns null unless currentArrangement.kind === 'pattern' (musicPatternEditor.ts:1033-1040), so Arrange has no current-slot indicator. musicPlayhead.ts:25-30 maps time linearly to steps, but the renderer swings step pairs (patternRenderer.ts:193-225), and it ignores audioContext.outputLatency (100-250 ms on Bluetooth). Fix: add a small play icon on each library item that renders that 2-bar phrase in the room's key and tempo (renderRoomPatternLoopBuffer already handles a sequence) and plays it as a preview clip without committing; highlight the playing slot in Arrange using the same transport math; compute the playhead from the swung step start times and subtract outputLatency (or use getOutputTimestamp).

**Evidence.**

- src/scenes/editor/musicWorkflow.ts:616-627 — clicking a library phrase commits it immediately
- src/scenes/editor/musicUi.ts:220-223 — library item is a draggable button with no audition control
- src/ui/setup/musicControls.ts:340-360 — slot assignment relies on HTML5 drag events
- src/scenes/editor/musicPatternEditor.ts:1033-1040 — playhead disabled for phraseArrangement
- src/scenes/editor/musicPlayhead.ts:25-30 — linear step mapping, no swing, no output latency

**Fact-check (partially confirmed).**

1. The mobile point is overstated. Modern touch browsers do fire HTML5 drag events after a long press on draggable elements (iOS Safari 15+ and recent Chrome on Android). Touch users also don't need drag at all: they can tap a slot to select it (selectArrangementSlot, musicWorkflow.ts:638) and then tap a phrase, and assignPhraseToArrangementSlot (musicWorkflow.ts:1423) fills that slot. So placing phrases works on phones. What every device lacks is a way to hear a phrase first.
2. The swing drift only shows up after a builder raises swing. The default ROOM_PATTERN_SWING_PERCENT is 50 (pattern.ts:25), which means no swing. Swing is adjustable with the +/- buttons (index.html:1521-1524), and the error then reaches at most (swing% - 50)/50 of a step, and only on the off-beat steps.
3. Output latency is never compensated, so the playhead always runs ahead of what you hear. The gap is tens of milliseconds on wired or speaker output and roughly 100-250 ms on Bluetooth.
Priority: the audition button and the playing-slot highlight are the parts worth doing. Latency and swing compensation are low-impact polish.

### F228: Make neighboring rooms sound like one world: 'Match neighbors' plus muffled music bleed (G-007)

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** idea · **impact:** medium · **effort:** medium
- **Flagged before:** docs/product/backlog.md G-007 (status Later) and docs/product/ideas-inbox.md:44
- **Already in the product backlog.**

**Summary.** Show builders the key and tempo of the rooms next door, with a one-tap 'Match neighbors' button. When neighbors match, let the next room's music fade in, muffled, as you walk toward its door, the same way neighbor sound effects already bleed through walls. The world would feel like one evolving song instead of a playlist of clashing loops.

**Technical detail.**

WAMP already has the building blocks. roomAudio.ts:20-51 plays adjacent-room SFX through a low-pass filter at low volume (the 'adjacent-bleed' route). The controller keeps a shared, phase-locked transport (controller.ts:1171-1177 getLoopOffsetAtTime). The editor already frames neighbor rooms (MUSIC_ROOM_NEIGHBOR_PEEK, musicRoomFit.ts:35). Plan: (1) in the music workbench, read the 4 neighbors' music (room snapshots already streamed) and show 'Left: 120 BPM A minor' chips plus a 'Match neighbors' button that sets bpm, keyTonic and keyMode (rekeyRoomPatternMusicPreservingMidi already exists); (2) in world play, once a neighbor's buffer has been prefetched, start it phase-locked at gain 0 through a BiquadFilter low-pass, and raise gain and cutoff as the player approaches that edge, finishing the swap at the doorway. Only do this when bpm matches; otherwise fall back to the normal transition. Data: 29 of 37 sampled music rooms are C major (the default), so keys already mostly agree; tempo is the problem (10 distinct BPMs).

**Evidence.**

- docs/product/backlog.md:126-137 — G-007 Dynamic modular room music (Later)
- docs/product/ideas-inbox.md:44 — Luftrausers-style layered room music request
- src/scenes/overworld/roomAudio.ts:20-51 — existing low-pass 'adjacent-bleed' SFX route to reuse for music
- src/music/controller.ts:1171-1177 — shared transport offset makes phase-locked neighbor starts possible
- src/music/pattern.ts:582 — rekeyRoomPatternMusicPreservingMidi helper for a one-tap key match
- Production sample: 29/37 music rooms in C major; BPMs spread from 60 to 145

**Fact-check (partially confirmed).**

Change the plan as follows.
(a) Make tempo the main "Match neighbors" action. Set bpm only, on pattern and phrase rooms. For key, show the neighbor's key as information. Real key matching needs a new helper that shifts every stored MIDI pitch by the semitone difference; rekeyRoomPatternMusicPreservingMidi and setKeyTonic only relabel the key and leave the notes as they are. A major/minor change is not a simple shift, so offer the relative key or skip it.
(b) Leave stem-pack rooms out, since their tempo is fixed by the pack. Decide what to do when neighbors disagree with each other: show the most common BPM, or offer one choice per side.
(c) In world play, build prefetch first. Render only the neighbor the player is heading toward, during idle time, and reuse the existing patternLoopBufferPromises cache. Then add a per-playback low-pass filter between the source and its gain, and ramp gain and cutoff by distance to the edge, throttled rather than recomputed every frame.
(d) Say that bar-timed crossfades, stem-lane continuity and seamless expanded-room music already ship, so this builds on them rather than replacing hard cuts.
Overall impact is medium, not high: it is polish for atmosphere, and the current one-bar crossfade already avoids hard cuts.

### F232: Keep the four instruments as separate layers at playback: instant mixing and music that reacts to gameplay

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** Each room's drums, triangle, saw and square are already built as separate parts, then flattened into one track. Keeping them separate lets volume and pan sliders respond instantly with no rebuild. It also lets the game shape the music: drop the drums when you are underwater or in a dark room, add the hi-hats when a race timer runs low, muffle everything on death.

**Technical detail.**

renderRoomPatternLoopBuffer already renders each instrument into its own mono Float32Array (patternRenderer.ts:271-306) before summing into left and right. Return those 4 mono buffers instead, and have startLoopPlayback (controller.ts:1080-1110) start 4 sample-locked AudioBufferSourceNodes, each through a Gain and StereoPanner into the room bus. Memory is about the same as stereo today (4 mono vs 2 stereo channels) and below it once silent instruments are skipped. Benefits: (1) the editor mix sliders only move AudioParams (removes the re-render storm in the first finding); (2) gameplay hooks such as roomMusic.setLayerGain('drums', 0, {ramp: 0.5}) driven by weather or lighting controllers, goal timers or the death and respawn flow; (3) the per-lane crossfade foundation that G-007 needs (the legacy stem path already crossfades lanes independently, controller.ts:597-631).

**Evidence.**

- src/music/patternRenderer.ts:271-306 — per-instrument mono buffers are produced, then summed
- src/music/controller.ts:1080-1110 — one buffer source per room means no per-layer control
- src/music/controller.ts:597-631 — the stem path already does per-lane crossfades to reuse
- src/scenes/editor/musicPatternEditor.ts:360-385 — mix edits currently force a full re-render

**Fact-check (partially confirmed).**

Memory: four mono layers hold twice the retained samples of today's stereo buffer, not "about the same" (it only breaks even when two or more layers are silent). Pair the change with an LRU cap on patternLoopBufferPromises (controller.ts:118, which never evicts today), and with a cache key that leaves out mix (pattern.ts:970-974). Keep the sound unchanged by putting a tanh WaveShaperNode on a per-room bus, because finalizeBuffer (patternRenderer.ts:228-232) soft-clips the summed mix. Add a live setMix path in the controller so editor slider changes don't go through playArrangement with a new key (musicWorkflow.ts:758-771). Drop or rework the "add hi-hats when the timer runs low" example: hats are summed into the single drum layer (patternRenderer.ts:170-191), so it needs a drum sub-split. Mark in_backlog for the cross-room crossfade part (G-007, docs/product/backlog.md:125-138). The gameplay-reactive part and the instant-mix part are not in the backlog.

### F233: Seed and curate the phrase library with Jonathan's own phrases, plus sorting and filters

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** idea · **impact:** low · **effort:** small

**Summary.** The shared phrase library is small (about 80-90 phrases per instrument) and only sorted by newest, so new builders mostly see whatever was saved last. A pinned 'WAMP Originals by Jonathan Mann' starter set, with sorting by key, tempo and 'most remixed', would give every builder a good-sounding start and give the world a recognizable musical signature.

**Technical detail.**

listMusicPhrases is ORDER BY created_at DESC with only an instrument filter (store.ts:744-790; routes.ts:15-22). Production today has 82 triangle phrases from 46 rooms and 90 drum phrases from 59 rooms. Cheap path: add a featured flag (or a curated_phrase_ids list in config) returned first under a 'Starter' header. Jonathan writes 15-25 hooks, bass lines and grooves in the existing sequencer and saves them like any builder; no audio files are needed because the synth renders them. Add query params ?key=&bpm=&sort=remixed. 'Most remixed' comes free from the music_phrase_sources lineage table (store.ts:93-101, COUNT by source_phrase_id). Stretch: a 'Daily Jam' key and tempo (Song A Day style) that the editor suggests by default, so rooms built that day fit together.

**Evidence.**

- src/cloudflare/worker/music/store.ts:788 — library sorted only by created_at DESC
- src/cloudflare/worker/music/routes.ts:15-22 — only instrument, cursor and limit are supported
- src/cloudflare/worker/music/store.ts:93-101 — phrase lineage table enables a 'most remixed' sort
- Production GET /api/music/phrases: 82 triangle phrases (46 rooms), 90 drum phrases (59 rooms)
- Production sample: 29/37 music rooms never left the default C major

**Fact-check (partially confirmed).**

Change the pitch from "Jonathan seeds the library" to "pin and label the phrases Jonathan already made". His account already wrote about 45% of all phrases (105/229 tonal, 39/90 drums), but newest-first paging of 24 at a time buries them.

Cheapest version:
- Keep a curated list of phrase IDs in config, or add a featured column. Return those first under a "WAMP Originals" or "Starter" header.
- Add client-side filters for key and BPM, plus a "my key" toggle. At about 300 phrases this needs no new server sort or cursor.
- If "most remixed" is wanted: music_phrase_sources only counts sequencer inserts. To count real use, also count how often each phrase ID appears in published rooms' arrangement slots.
- The "Daily Jam" key and tempo is an optional extra.

### F234: Room music as identity: 'Now playing' credit, remix button and shareable loop

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** idea · **impact:** low · **effort:** small

**Summary.** When you enter a room with music, briefly show who wrote it ('♪ Lava Lullaby, by Sam') with a button to remix it or save the phrase. Let builders download or share their room's loop as an audio file. Music then becomes a reason to visit, credit and share rooms, the way Song A Day turns each song into a moment.

**Technical detail.**

Phrase records already carry creatorDisplayName, roomTitle and lineage (store.ts INSERT_MUSIC_PHRASE_SQL columns), and the playback controller knows the source room for expanded rooms and courses (roomMusicPlaybackController.ts:151-193). Hook a 3 s HUD toast into OverworldRoomMusicPlaybackController.sync when playArrangement is issued for a new identity (roomMusicPlaybackController.ts:113-131). The 'Remix' action opens the editor's phrase library filtered to that room's phrases. Share: the renderer already produces PCM (patternRenderer.ts:311-314); a 44-byte WAV header writer (about 30 lines) gives a 'Download loop' button in the music workbench, and the same file can go into minted-room metadata. Nothing like this exists today (no now-playing UI in src).

**Evidence.**

- src/scenes/overworld/roomMusicPlaybackController.ts:113-131 — single place where a new room song starts
- src/scenes/overworld/roomMusicPlaybackController.ts:151-193 — already resolves the source room for credit
- src/music/patternRenderer.ts:311-314 — rendered PCM is available for WAV export
- src/cloudflare/worker/music/store.ts:64-88 — phrases store creator and room metadata

**Fact-check (partially confirmed).**

Narrow the scope to the parts that are actually missing.

1. **"Download loop" button (new).** Add it in the music workbench, and optionally in the room's HUD/share popover. Encode the AudioBuffer from loadPhraseArrangementLoopBuffer / renderRoomPatternLoopBuffer (controller.ts:1042-1060) as WAV. Cover pattern and phraseArrangement music first; legacy stemArrangement needs an OfflineAudioContext mix. Use a Blob plus an anchor download so it works on mobile Safari and Chrome.

2. **Play-mode "Use this room's phrases" link.** Don't add a new library API filter. The arrangement already lists its phrase IDs (collectRoomPhraseArrangementPhraseIds), so load them with loadMusicPhrasesById (libraryClient.ts:94) and open the builder's own room editor with those phrases ready. The library already credits creators and records lineage. This handoff into the builder's own room is medium effort, not small.

3. **Music credit toast.** Show it only when the music source differs from the current room's creator, or when the arrangement mixes phrases by other creators. The HUD creator card (hudViewModel.ts:224-229) already credits the room owner. There is no song-title field, so use the room title.

4. **Drop "put the file in minted metadata."** The Worker can't render audio, so this needs a client-upload endpoint. A cheaper related win is that the minted-room page (src/minted-room.ts, the token's animation_url) plays no music at all today.

### F235: Builders max out the slow end of the tempo range: add 4-bar patterns or a half-time switch

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** idea · **impact:** low · **effort:** medium

**Summary.** 38% of sampled music rooms sit at exactly 60 BPM, the slowest allowed. That suggests builders are slowing songs down mainly to make the 2-bar loop last longer. A 4-bar option (or half-time) would give longer melodies at normal tempos, and those rooms would also crossfade faster.

**Technical detail.**

Patterns are fixed at 32 steps / 2 bars, with BPM from 60 to 200 (pattern.ts:21-33). normalizeStepIndex rejects steps ≥ ROOM_PATTERN_STEP_COUNT (pattern.ts:167-175). In the production sample, 14 of 37 music rooms are at exactly 60 BPM, and slow tempos also mean 4 s bars, which drives the long bar-quantized transitions. Option A: a pattern length of 2 or 4 bars (stepCount 32 or 64), with the sequencer grid paging between bars 1-2 and 3-4 (the same paging the phone view needs). The renderer and playback already take stepCount dynamically (phrase arrangements use 256-512 steps). Option B (cheaper): a 'half-time' flag that doubles the step duration in getRoomPatternLoopDurationSec while letting the BPM display read the musical tempo. Validate first by asking a few 60 BPM builders why they chose it.

**Evidence.**

- src/music/pattern.ts:21-33 — MIN_BPM 60, STEP_COUNT 32, BAR_COUNT 2
- src/music/pattern.ts:167-175 — steps beyond 32 are rejected on normalize
- src/music/model.ts:440-441 — phrase arrangements already play variable step counts through the same renderer
- Production sample: 14 of 37 music rooms at exactly 60 BPM

**Fact-check (partially confirmed).**

Say that Arrange mode already gives 16-32 bar songs at any tempo (phraseArrangement.ts:37, musicUi.ts:32, commit 7dca01fc). Pitch this as a cheaper way to get there without the save-and-arrange steps, not as a missing ability. Lead with Option B and build it as a step-resolution switch (stepsPerBeat 4 or 2; today normalize forces 4 at pattern.ts:622-623), not a separate half-time flag. Settle how half-time phrases mix with 16th-note phrases in Arrange mode, for example by making it a setting on the whole arrangement. Downgrade Option A to large effort, because the sequencer is drawn on the room's 32+8 columns (musicPatternEditor.ts:795-836) and arrangement segments are fixed at 32 steps (phraseArrangement.ts:41). Restate the evidence using the public phrase library: 60 BPM is the second most common tempo after the 120 default, about 17-30% per instrument. Keep the 'ask builders why' validation step, since 16ths sounding frantic is an equally likely reason.

### F241: After a sale or transfer, the new owner cannot reach the editor, and the seller keeps the credit

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** If someone buys a minted room on OpenSea, WAMP keeps showing the old owner until somebody edits that room. The buyer's Edit button stays greyed out ('Only the room token owner can edit'), so they can never trigger the update themselves. The room also stays on the seller's profile under the seller's name.

**Technical detail.**

The world HUD decides Edit from the D1-cached mintedOwnerWalletAddress returned by loadRoomSummary (OverworldPlayScene.ts:1707-1716; hudViewModel.ts:265-283) and caches it for the session (hudState.ts:276-286). Live ownerOf reads exist only inside mutations and confirms (mint/service.ts:217-222, 352-358, 509-514), and those are what the buyer cannot reach. The server already has POST /api/rooms/:id/ownership/refresh (rooms/routes.ts:195-226), but nothing in the client calls it (git grep 'ownership/refresh' over src finds only the route). On sync, claimer_user_id and claimer_display_name use COALESCE (service.ts:411-415), so the seller stays the 'creator'. Profiles list rooms by claimer_user_id (auth/store.ts:587-600), and Expand Room is gated on the claimer, not the token holder (hudViewModel.ts:284). Fix: (1) When the viewer has a linked wallet and a selected minted room's cached owner differs from it, or on an Edit click for a minted room, call ownership/refresh and re-render. (2) Pick up Transfer logs in the cron reconcile from the previous finding. (3) Display 'Built by X · Owned by Y' separately, and add the room to the holder's profile (a 'Collection' shelf). No secondary transfers have happened yet (all 11 Transfer events are mints), so this is cheap to fix before the backlog marketplace item (G-018) makes it common.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:1707-1716 — HUD ownership comes from loadRoomSummary (D1)
- src/scenes/overworld/hudViewModel.ts:265-289 — Edit is disabled when the wallet differs from the cached owner: 'Only the room token owner can edit a minted room.'
- src/cloudflare/worker/rooms/routes.ts:195-226 — POST /ownership/refresh exists; git grep shows no client caller
- src/cloudflare/worker/mint/service.ts:411-415 — the claimer columns are COALESCEd, so the seller is never replaced
- src/cloudflare/worker/auth/store.ts:587-600 — profile rooms are selected by claimer_user_id
- src/scenes/overworld/hudViewModel.ts:284 — canOpenCourseBuilder uses the claimer, not the NFT owner

**Fact-check (confirmed).**

Core claim confirmed. Smaller corrections:

(a) This is a regression. Commit a889dc39 removed the chain sync that ran on signed-in room reads and added POST /ownership/refresh without any client caller. The fix restores what that commit dropped.

(b) "Until somebody edits" really means until someone hits a mutation route (save, publish, revert, mint, metadata or construction-preview). In practice that is the seller pressing Save. The seller's Edit button still looks enabled from the stale cache, so the seller gets a confusing 403 on save. That save syncs D1, and the buyer can edit only after reloading or starting a new session, because hudState caches ownership per session.

(c) The canOpenCourseBuilder gate is at hudViewModel.ts:291, not 284.

(d) Keeping the original builder as "creator" and on their profile is arguably intended builder credit, not a bug. Treat the "Built by X · Owned by Y" and Collection-shelf parts as a product idea; only the editing lockout is a defect. Fix parts (2) and (3), the Transfer-log cron and the profile/attribution split, are medium effort. Part (1), calling ownership/refresh when the cached owner differs from the viewer's linked wallet or when a minted room's Edit is pressed, is small.

(e) The "11 Transfer events" figure is unverified. If it is accurate, the impact today is latent.

### F237: 4 of the 11 real NFTs have no metadata at all because minting skips the artwork step

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Minting does not attach any picture or room data to the NFT. A separate, optional 'Refresh NFT Metadata' transaction does that, and most builders never run it. Tokens #5, #7, #8 and #11 on Base mainnet show up as blank, untitled NFTs in wallets and on OpenSea, even though their owners paid 0.01 ETH each.

**Technical detail.**

mintRoom in RoomOwnershipToken.sol:94-116 never sets a URI, and ERC721URIStorage with no baseURI returns ''. The client mint flow (editor/roomSession.ts:839-927) stops after confirmMint. Metadata is written only by refreshMintMetadata (roomSession.ts:929-1027), a second button under Advanced. Read-only eth_calls against 0xc3032d5e…dd9a1 on chain 8453 return tokenURI '' for tokens 5, 7, 8 and 11. Tokens 1-4 were backfilled by the contract owner 0x11598E12… (4 setRoomTokenURI transactions at blocks 43535940-43572294), and only tokens 9 and 10 were set by their holders. Fix now: (a) run the same owner-key backfill for tokens 5, 7, 8 and 11 (and re-render 1 and 4, which still carry the old SVG text card) using buildRoomTokenMetadata plus a node canvas or the existing renderer. (b) After confirmMint succeeds, go straight into the metadata step ('Step 2 of 2: add your room's artwork') instead of returning. (c) For wallets that support EIP-5792 wallet_sendCalls, batch mintRoom and setRoomTokenURI(x,y,uri) into one confirmation. setRoomTokenURI is keyed by coordinates, so the tokenId does not need to be known in advance, and animation_url can be keyed by coordinates too. (d) In any v2 contract, take tokenURI as a mintRoom argument.

**Evidence.**

- contracts/src/RoomOwnershipToken.sol:94-116 — mintRoom stores tokenId and calls _mint, with no _setTokenURI
- src/scenes/editor/roomSession.ts:894-907 — the mint flow ends after confirmMint, with no metadata step
- index.html:1234-1235 — 'Refresh NFT Metadata' is a separate hidden button in the Advanced block
- On-chain read (Base 8453, contract 0xc3032d5e67c8a67c9745943929f8dff2410dd9a1): tokenURI(5), tokenURI(7), tokenURI(8) and tokenURI(11) all return '' (length 0)
- Blockscout tx list for the contract: setRoomTokenURI from owner 0x11598E12 for tokens 1-4, and from holders only for tokens 9 and 10

**Fact-check (partially confirmed, confirmed, partially confirmed).**

1) Token 6 is missing from the claim. Token 6 (room 0,0, "Hello World", held by 0x3d9456…) does have metadata: a PNG image and a checksummed contract address in animation_url, which looks like the in-app refresh. Blockscout's list of transactions sent directly to the contract shows no setRoomTokenURI for it, so the call probably went through 0x3d9456's smart-account code. That makes the "only tokens 9 and 10 were set by their holders" statement wrong: holders set 6, 9 and 10, the owner set 1-4, and 5, 7, 8 and 11 are blank. The same wallet holds tokens 4, 5, 6 and 10 and refreshed 6 and 10 but not 5.

2) Fix (a) needs no new tooling. scripts/backfill-room-token-metadata.ts already exists for exactly this: it hard-codes this contract, uses a Playwright room-preview renderer plus buildRoomTokenMetadata, and supports --only= and --write. The owner can run it with --only=5,7,8,11,1,4 --write (needs PRIVATE_KEY and ROOM_MINT_RPC_URL; without --allow-fallback-image it will not fall back to the SVG card).

3) "A second button under Advanced" is incomplete. The Refresh button is also surfaced elsewhere. In the dock Share popover, the "Collect Room" action becomes "Refresh Room Metadata" once a room is minted (src/ui/setup/editorDockShell.ts:776-789). The History modal has its own copy too (index.html:2068, historyModal.ts:65-73). Still, nothing prompts the builder after a mint.

4) Small line drift: index.html:1234 is the Mint button and 1235 is the hidden Refresh button.

5) Scale: minting is low volume (11 mints, the last on 2026-07-15), so the damage is limited to 4 tokens and 3 wallets.

1. Fix (a) does not need building. scripts/backfill-room-token-metadata.ts already exists (commit 07f6c275). It uses the owner key to call setRoomTokenURI with buildRoomTokenMetadata and a render helper (render-room-preview-data-url.mjs). It already has --only=<ids> and --write flags, plus an --allow-fallback-image flag, which is how tokens 1 and 4 ended up with SVG text cards. The fix is to run it for tokens 5, 7, 8 and 11, and to re-run it for 1 and 4 without that fallback flag.
2. The breakdown is incomplete. Token 6 (room 0,0, "Hello World") also has full metadata: 8157 chars, a PNG image and a wamp_room payload. Blockscout shows no RoomTokenURIUpdated or MetadataUpdate log for it, so I could not tell how it was set. In total 7 of 11 tokens have metadata (1-4, 6, 9 and 10). The 4 without it are 5, 7, 8 and 11, which is still correct.
3. The refresh action is not only a hidden Advanced button. It appears once a room is minted (viewModel.ts:115), the dock relabels "Collect Room" to "Refresh Room Metadata", and the History modal has its own copy. All of these are optional second transactions, so the recommendation to chain the metadata step automatically after confirmMint still stands.
4. Token 5 belongs to 0x3d9456, which holds 4 of the 11 tokens and is probably a project or owner wallet. Only 3 of the blank tokens clearly belong to outside collectors.

There are 4 blank tokens (5, 7, 8 and 11), each minted for 0.01 ETH. Token 6 also has on-chain metadata, so 7 of 11 tokens have it. The "Refresh NFT Metadata" button is not hidden after a mint. It appears in Advanced (viewModel.ts:115), and on desktop and tablet the share menu's "Collect Room" item becomes "Refresh Room Metadata" (editorDockShell.ts:776-789). The real gap is that nothing prompts the minter right after the mint, the blank state is never explained, and the label says "Refresh" instead of something like "Add artwork". The backfill tool already exists at scripts/backfill-room-token-metadata.ts. The owner can run it with --only=5,7,8,11 --write (plus 1,4 to re-render the SVG cards), so nothing needs to be written. EIP-5792 batching needs server changes, because the prepare route at mint/routes.ts:159 requires the room to already be minted in D1, and the tokenId is baked into animation_url. That makes batching a medium-effort follow-up, not part of the core fix. The core fix is: run the existing backfill script, then chain straight into the metadata step after confirmMint succeeds in roomSession.ts:894-907. Both are small.

### F239: A lost mint confirmation (phone backgrounded, tab closed, 3-minute timeout) leaves the room looking unminted, with no automatic recovery

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** On a phone, the player jumps to their wallet app to approve and pays. If WAMP's tab is suspended or the receipt wait times out, the game never records the mint. The room keeps looking unprotected in the world, the builder sees an error, and nothing retries. It only heals if someone later tries to edit the room. A metadata confirmation has already been lost this way in production (token #10).

**Technical detail.**

sendPreparedWalletTransaction waits on waitForTransactionReceipt through the wallet provider (auth/client.ts:357, viem default timeout 180 s). confirmMint is then a single attempt (roomSession.ts:894-896). The tx hash lives only in memory and console.error (roomSession.ts:910). The busy overlay hides its Close and Retry buttons (ui/appFeedback.ts:146-149), so a WalletConnect promise that never resolves locks the UI until the page is reloaded. The server's only reconcile is lazy: syncRoomOwnershipFromChain runs only inside mutations (rooms/store.ts:600-622), and 'no room GET performs chain synchronization' (docs/performance-code-health-roadmap.md:102). The worker already has an hourly cron that only purges guest replays (src/cloudflare/worker.ts:261). Fix: (1) Write {kind, roomId, coords, txHash, chainId} to localStorage the moment sendTransaction returns. On app or editor load, and on visibilitychange, resume the confirm with backoff. (2) Change confirm to 'sync from chain', i.e. tokenIdForRoomCoordinates plus ownerOf, using the hash only as a hint. A 409 'not found yet' then becomes an automatic poll instead of an error. (3) Show Close/'I already approved — check again' on the wallet-wait overlay. (4) Extend the cron to getLogs RoomMinted, Transfer and MetadataUpdate since a stored last block (currently only 36 logs in total), then upsert D1. That one job also fixes the next two findings.

**Evidence.**

- src/auth/client.ts:349-357 — the tx is sent, then the client waits for the receipt via the wallet provider before returning
- src/scenes/editor/roomSession.ts:894-920 — one confirm attempt; on failure, only a status text and console.error
- src/ui/appFeedback.ts:134-150 — showBusyOverlay hides the retry and close buttons
- src/cloudflare/worker.ts:261 — scheduled() only calls purgeGuestReplays
- docs/performance-code-health-roadmap.md:102 — no room GET performs chain synchronization
- Live: token 10 setRoomTokenURI by holder 0x3d94… (block 44487446) is on-chain, but GET /api/rooms/8%2C0/summary reports mintedMetadataRoomVersion null

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

1. "confirmMint is a single attempt": if waitForTransactionReceipt throws or times out, confirmMint is never called at all. Also, the 180 s timer starts only after the hash comes back, i.e. after the user returns from the wallet. On Base (2 s blocks) the timeout is a less likely trigger than the OS killing or reloading the tab during the wallet hop.

2. "Only heals if someone later tries to edit the room": for mints, any mutation heals it. That includes simply pressing Mint again. handleRoomMintPrepare (mint/routes.ts:34) runs loadRoomRecordForMutation, which reads tokenIdForRoomCoordinates/ownerOf, saves the mint, then throws 409 "already minted". The client's 409 branch reloads and shows the room as minted. So the builder's natural retry recovers the mint state, just with a confusing error message.

3. For metadata (the token #10 case), mutations never heal it. syncRoomOwnershipFromChain/roomMintStateNeedsUpdate (mint/service.ts:318-328) compare only chainId, contract, tokenId and owner, never the metadata version or hash. A lost metadata confirmation stays wrong until the user pays gas for another setRoomTokenURI.

4. The cause of the token #10 loss is not proven. It could have been a client-side loss, or the server's verifyRoomTokenMetadataTransaction rejecting the tx (it has several 400/409 throws).

5. Useful for the fix: there is already an authenticated server route, POST /api/rooms/:id/ownership/refresh (rooms/routes.ts:196-224), that runs chain sync. No client code calls it, so recovery on load or visibilitychange can reuse it.

6. A WalletConnect request usually expires rather than hanging forever. The overlay is still undismissable until the request settles.

1. The core is real: no automatic retry or recovery, a single confirm attempt, the hash kept only in memory, hidden overlay buttons, and a cron that only purges guest replays.
2. A lost mint confirm is not permanent. If the owner clicks Mint again, the prepare route syncs ownership from chain first (mint/routes.ts:34 → rooms/store.ts:615). It then returns 409 "already minted", and the client's 409 handler reloads the room and shows it as minted. Recovery is manual and the message is confusing.
3. The room only looks unminted. Every server mutation re-syncs from chain before checking permissions, so non-owners cannot actually edit a minted room. It is not a security hole.
4. A server endpoint that syncs from chain already exists (POST /api/rooms/:id/ownership/refresh, rooms/routes.ts:196-227) but nothing in the client calls it. The fix should:
   - save {roomId, coords, txHash, kind} to localStorage as soon as sendTransaction returns;
   - call that endpoint on editor load, on visibilitychange, and on a "check again" button (with backoff);
   - show Close or "check again" on the overlay while waiting for the wallet.
5. The production example (token #10, MetadataUpdate at block 44487446, 2026-04-09 19:50:39 UTC; D1 mintedMetadataRoomVersion is null) is a lost metadata-refresh confirm, not a mint confirm. Those never self-heal: owner sync keeps the old metadata fields (mint/service.ts:170-172). Recovering them needs a separate reconcile: read tokenURI, hash it, and match it to a published version, e.g. in the hourly cron. The cause of that loss (backgrounding vs a hash-mismatch 409) is not proven.

The ownership loss heals itself on the next mutation, including a simple Mint retry. That retry returns 409 'already minted', the client refreshes, and the user is not charged twice. Another user is blocked server-side by the sync that runs before the permission check. The confirm endpoint already syncs from the chain before it checks the hash.

The lasting gap is the metadata confirm, not the mint confirm. syncRoomOwnershipFromChain copies mintedMetadataRoomVersion, mintedMetadataUpdatedAt and mintedMetadataHash forward unchanged (mint/service.ts:163-166). So a lost setRoomTokenURI confirm, like the one for token #10, is never reconciled, and the UI would push the owner to pay gas for another refresh. Token #10's mint confirm itself was recorded correctly.

Cheapest fix:
(a) Call the existing POST /api/rooms/:id/ownership/refresh on editor open, on visibilitychange, and from a Close / 'I already approved, check again' button on the wallet-wait overlay.
(b) Extend that sync to read the token's on-chain tokenURI or MetadataUpdate events, so it also reconciles the metadata fields.
(c) Optionally keep the pending transaction hash in localStorage.

The hourly getLogs cron would be a nice addition, but it is not needed at the current volume of about 11 tokens.

### F238: Smart-account wallets (Google/email login in the wallet popup, Coinbase Smart Wallet) cannot sign in or mint

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Phone players without MetaMask will usually tap 'Continue with Google/Email' in the wallet popup, or would use Coinbase's passkey wallet. Both produce smart-contract wallets, and WAMP's server rejects their signatures. Coinbase Wallet is switched off entirely, even though it is the most natural wallet on Base.

**Technical detail.**

The worker verifies wallet sign-in with viem's standalone verifyMessage (auth/routes.ts:1, 562-566). That function only supports EOAs (it uses ecrecover), as its own docstring says: 'Only supports Externally Owned Accounts' (node_modules/viem/_esm/utils/signature/verifyMessage.js). Reown AppKit 1.8.22 is created without features or defaultAccountTypes overrides (auth/client.ts:972-985), so its defaults apply: DEFAULT_REMOTE_FEATURES email:true plus 7 social logins, and DEFAULT_ACCOUNT_TYPES eip155:'smartAccount'. Those users get ERC-1271/6492 signatures that fail verification, with 'Wallet signature could not be verified.' or a 500 on a malformed signature. The only exception is if the Reown dashboard has disabled them remotely; check this. enableCoinbase:false (client.ts:979) arrived in a lockfile-fix commit (d207c85f), not as a product decision. Even after sign-in works, mint confirm rejects any transaction whose receipt.to is not the contract (mint/service.ts:262-264, 470-477). 4337 bundles and 7702 batched calls fail that check, although token #5's holder already uses a 7702 (Calibur) account. Fix: verify with createPublicClient({chain: base}).verifyMessage, which handles ERC-6492 and 1271. Re-enable the Coinbase connector with preference 'all'. In confirm, drop the receipt.to and tx.input checks and trust the RoomMinted and RoomTokenURIUpdated logs emitted by the contract address, or re-read chain state directly. Optionally set defaultAccountTypes {eip155:'eoa'} until all of this ships.

**Evidence.**

- src/cloudflare/worker/auth/routes.ts:1 — import { verifyMessage } from 'viem' (the EOA-only utility)
- src/cloudflare/worker/auth/routes.ts:562-570 — sign-in/link fails when the ecrecover result does not match
- node_modules/viem/_esm/utils/signature/verifyMessage.js — 'Only supports Externally Owned Accounts. Does not support Contract Accounts.'
- node_modules/@reown/appkit-controllers/dist/esm/src/utils/ConstantsUtil.js:196-216,262-264 — defaults email:true, socials [google,x,discord,farcaster,github,apple,facebook], eip155 account type 'smartAccount'
- src/auth/client.ts:972-985 — createAppKit has no features or defaultAccountTypes override, and enableCoinbase:false
- src/cloudflare/worker/mint/service.ts:262-264 — confirm requires receipt.to === contract

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

Coinbase is not entirely off. The Base Account connector (Coinbase's smart wallet, renamed) is active because enableBaseAccount is unset and @base-org/account is installed (appkit-adapter-wagmi/dist/esm/src/client.js:171-176). It fails sign-in like the other smart accounts. So the fix is not "re-enable Coinbase with preference 'all'". Instead, make the server verify smart-account signatures with createPublicClient({chain: base, transport: http(rpc)}).verifyMessage, which handles ERC-1271 and ERC-6492, and leave the connectors as they are. Until that ships, the stopgap is defaultAccountTypes {eip155:'eoa'} (which fixes Reown email/social users), plus enableBaseAccount:false or a server-side message for Base Account users.

Production config is confirmed: the Reown project 0cfe5ae6… has social_login enabled with a null config, so email and the 7 default socials are live.

Line references: mint confirm is service.ts:262-264. Lines 470-477 are the metadata-refresh confirm, which also decodes tx.input with decodeFunctionData, so 7702 batched calls and 4337 bundles fail there too. The verifyMessage call is routes.ts:561-569. A 6492-wrapped signature throws 'invalid signature length' from viem's recoverPublicKey, which gives a 500.

Unverified: whether smart accounts are enabled on Base in Reown's runtime list, and the claim that token #5's holder uses a 7702 Calibur account.

The core claim is real in production. Standalone `verifyMessage` (EOA-only) is the only signature check for wallet sign-in and wallet linking. AppKit defaults to smart accounts, and the live Reown config (social_login enabled, config null) means email and 7 socials are on. Mint confirm requires `receipt.to` to be the contract. Corrections: (1) `enableCoinbase:false` only removes the legacy Coinbase SDK connector. The Base Account passkey smart-wallet connector is still enabled because `enableBaseAccount` is unset and @base-org/account is installed, so Coinbase's smart wallet is probably offered and then fails. The fix is to verify with `createPublicClient({chain: base, transport: http(rpc)}).verifyMessage`, which supports 1271 and 6492, and to catch errors so 6492 signatures do not cause a 500. Re-enabling the Coinbase connector is optional. (2) 7702-delegated EOAs (e.g. Calibur) are not broken: they sign with the EOA key, and the client's single `sendTransaction` normally goes straight to the contract. Only 4337 user operations, and 5792 batches, fail the `receipt.to`/`tx.input` checks. (3) Impact is lower than stated, because WAMP has its own email-code sign-in outside the wallet modal. The damage is dead-end wallet-modal options, plus no wallet linking or minting for smart-account users. A quick stopgap is `defaultAccountTypes: {eip155: 'eoa'}` and/or `features: {email: false, socials: false}`. Note that the Reown dashboard's social_login toggle overrides local settings only when it has a non-null config.

The mechanism is real. Wallet sign-in and linking use EOA-only ecrecover. Production's Reown config enables email and social login with AppKit's default smartAccount type. Smart-account users therefore cannot link a wallet and cannot mint, because mint/routes.ts:32 requires a linked wallet.

The impact is narrower than claimed:
- WAMP's own email sign-in still works for playing and building. Only wallet sign-in, linking and minting break.
- 6492/1271 signatures usually produce a 500 (viem throws a plain 'invalid signature length' Error), not the 401 message.
- A 4337 or 7702-batched mint is not lost. loadRoomRecordForMutation (rooms/store.ts:615) syncs ownership from the chain before the receipt.to check throws, so the user only sees a spurious error. Only the metadata-refresh confirm actually fails to record.
- Coinbase Smart Wallet is blocked mainly because enableCoinbase:false removes its connector. Turning that back on means adding the Coinbase SDK and fixing signature verification first.
- Whether smart accounts are active on Base depends on what Reown's frame returns at runtime.

Fastest mitigation: add defaultAccountTypes: { eip155: 'eoa' } to createAppKit. Then switch verification to publicClient.verifyMessage against Base, and catch verification errors so they return a 401 instead of a 500.

### F240: Mint errors are raw developer dumps, and the price is never shown before the wallet opens

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Players never see the price (0.01 ETH, about $27) inside WAMP. They only see it in the wallet. When something goes wrong (not enough ETH, cancelled in the wallet, wrong network, the price changed, the 30-minute approval expired), the editor shows a long technical error block. Clear messages and a 'Try again' would rescue paying users.

**Technical detail.**

roomSession.ts:918 shows error.message directly. viem errors include multi-line 'Request Arguments / Details / Docs / Version: viem@…' blocks, and a git grep across src finds no handling of 4001, UserRejectedRequestError, InsufficientFunds or shortMessage. priceWei is returned by prepare (mint/routes.ts:52,68) but never rendered client-side (git grep priceWei/formatEther finds only the type). Q2: the contract requires msg.value == mintPriceWei exactly (RoomOwnershipToken.sol:103), and the signed authorization does not bind the price. If setMintPriceWei runs between prepare and send, the wallet simulation fails with 'Incorrect mint price.'. The deadline is now+30 min (mint/routes.ts:53), which is ample for a mobile wallet. When it lapses, the result is 'Mint authorization expired.'. In both cases the right action is to re-prepare. Fix: (1) Before opening the wallet, show a confirm sheet: 'Collect this room for 0.01 ETH (~$X) on Base. Your balance: Y'. Read the balance via the public client, and if it is short, offer AppKit's onramp view. (2) Map errors: UserRejected → 'You cancelled in your wallet'; InsufficientFunds → 'You need ~0.0101 ETH on Base'; ContractFunctionRevertedError reason 'Incorrect mint price.' or 'Mint authorization expired.' → silently re-prepare once and re-prompt; a chain-switch rejection → 'Switch your wallet to Base'. (3) Make the mismatch error at client.ts:345-347 name the linked address ('Switch your wallet to 0x12…ab').

**Evidence.**

- src/scenes/editor/roomSession.ts:917-919 — status text = error.message
- src/auth/client.ts:345-347 — 'Connected wallet does not match the linked account wallet.' does not say which wallet
- src/cloudflare/worker/mint/routes.ts:52-53 — the price is read at prepare and the deadline is now + 30 min
- contracts/src/RoomOwnershipToken.sol:102-103 — exact-price and deadline requires
- git grep 'insufficient|UserRejected|4001|shortMessage' over src/**/*.ts — no matches
- On-chain: mintPriceWei() = 10000000000000000 (0.01 ETH)

**Fact-check (confirmed).**

The code facts are accurate; three details need adjusting.
1. The error is not shown as a large block. It goes into a status strip capped at 42-44px tall that scrolls, with newlines collapsed (retro-skin.css:106-124, dock-shell.css:276-281). Players see a cramped run-on line that starts with viem's short message and continues into request arguments and calldata hex. The strip is hidden entirely while the publish nudge is visible (retro-skin.css:133).
2. Mid-flow price changes (owner-only setMintPriceWei, sol:118-119) and lapsed 30-minute deadlines are rare edge cases. The common cases worth mapping are user rejection, insufficient funds, a rejected chain switch, and the wallet mismatch.
3. Impact should be medium, not high: minting is optional and needs a linked wallet.

### F247: Wallet linking has dead ends that can permanently block a builder from minting their own room

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** An account can hold one wallet, forever. If a player ever pressed 'Sign in with wallet' before using email, that wallet already belongs to a separate empty account, so it can't be linked to the account that owns their rooms, and they can't mint. Players also can't switch to a new wallet (for example a hardware wallet) without losing edit rights to rooms they minted.

**Technical detail.**

Wallet sign-in silently creates a new user when the wallet is unknown (auth/routes.ts:590-593). attachWalletToUser then refuses with 409 'That wallet is already linked to another account.' or 'This account is already linked to a different wallet.' (auth/store.ts:280-290). No unlink or merge exists (git grep finds none). The feature ledger records 'conflicts never merge accounts' as a deliberate choice. Mint requires the claimer's account and its linked wallet (rooms/store.ts:1839-1845), and the authorization binds that linked wallet as msg.sender (mint/routes.ts:54-61; RoomOwnershipToken.sol:101). A narrow, safe fix that keeps the no-merge rule: on the 409, if the other account is wallet-only and empty (no claimed rooms, runs, sprites, XP or email), move the wallet to the current account. The signature that was just verified proves control of the wallet. Also allow replacing a linked wallet when the account holds no minted tokens on the old one, or add a user_wallets table and treat any linked wallet as owner in buildRoomPermissionsFromState. At minimum, make the 409 explain what to do.

**Evidence.**

- src/cloudflare/worker/auth/routes.ts:590-593 — findUserByWallet ?? createUserForWallet on every wallet sign-in
- src/cloudflare/worker/auth/store.ts:280-290 — the two 409 conflicts, with no recovery path
- src/cloudflare/worker/rooms/store.ts:1839-1845 — canMint requires viewerUserId === claimerUserId plus a linked wallet
- src/cloudflare/worker/mint/routes.ts:54-61 — the authorization is signed for auth.user.walletAddress only
- feature-ledger.md:52 — 'conflicts never merge accounts'

**Fact-check (confirmed).**

1. **Line numbers:** the find-or-create ternary is at src/cloudflare/worker/auth/routes.ts:588 (inside 586-589), not 590-593.
2. **The wallet-switching sentence:** edit rights on minted rooms follow whichever wallet currently holds the NFT (rooms/store.ts:1817-1821, `mintedOwnerWalletAddress`). They are not tied to the account. The real problem is that an account can never change its linked wallet at all, because there is no unlink or replace. If a player transfers the NFT to a new wallet (for example a hardware wallet), edit rights move to whichever account holds that wallet. That is usually a brand-new, separate wallet-only account, so the player's identity gets split across two accounts.
3. **The reverse route is also blocked:** adding the email to the empty wallet-only account fails with a 409 (routes.ts:190-191; store.ts:320/345).
4. **The client never explains the error:** client.ts:1329 shows "Link Wallet" and client.ts:875-877 just displays the 409 text with no next step.
5. **Effort:** the clearer error plus moving a wallet off an empty wallet-only account is small effort, not medium.

### F246: Make ownership visible and use one word for it: 'Collect'

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** idea · **impact:** medium · **effort:** medium
- **Flagged before:** docs/product/product-requirements.md:36 lists 'clearer in-world ownership/minted-room UX' as an open gap; still undone.

**Summary.** Today a minted room only shows a small lock icon when you select it in the world. The same action is called 'Mint Room', 'Collect Room' and 'buy a room as a collectible' in different places. Builders whose published rooms are still unprotected are never told that others can overwrite them.

**Technical detail.**

Minted state reaches only the selected-room HUD title (index.html:1752-1768; hudViewModel.ts:250-252, 458-462). The world, Explore and profile APIs carry no minted fields (the /api/world rooms payload keys are id, coordinates, title, state, background, goalType, version, publishedAt, previewUpdatedAt, creator*, publishedBy*, course, expandedRoom). Wording varies: sidebar 'Mint Room' (index.html:1234; editor/viewModel.ts:114), dock 'Collect Room' and 'Refresh Room Metadata' (ui/setup/editorDockShell.ts:776-779), HUD tooltip 'you can buy a room as a collectible' (hudViewModel.ts:462, which wrongly implies you can buy someone else's room), and 'Refresh NFT Metadata' (index.html:1235). Ideas: (1) a gold frame or crown on minted rooms in the world and in Explore cards, plus a 'Collected' filter. The minted cluster sits around spawn (0,0), (1,0), (0,1), (1,1), (-1,0), which makes a ready showcase. (2) A room title line 'Built by X · Collected by Y'. (3) A profile 'Collection' shelf. (4) When the claimer views their own published, unminted room, show a soft banner: 'Anyone can edit this room. Collect it to lock it — 0.01 ETH'. (5) Pick 'Collect' everywhere in player-facing text, keep 'NFT' for the wallet step, and link 'View your collectible' (minted-room page or OpenSea) after success instead of only the transaction hash (roomSession.ts:899-905).

**Evidence.**

- src/scenes/overworld/hudViewModel.ts:458-462 — the minted tooltip appears only for selected minted rooms
- src/ui/setup/editorDockShell.ts:776-779 — 'Collect Room' vs index.html:1234 'Mint Room'
- index.html:2965-2967 — About copy uses 'collected and locked' and 'small fee'
- Live: GET api.wamp.land/api/world?centerX=0&centerY=0&radius=12 room objects have no minted fields
- src/scenes/editor/roomSession.ts:899-905 — the post-mint success links only to the explorer transaction

**Fact-check (partially confirmed).**

Players already use 'Collect' for coins, Collect Target and Collect Race, so the shared word for ownership should be a two-word phrase that cannot be confused with gameplay. 'Collect & Lock' or 'Lock Room (collect)' both work, and the About text and the HUD already use 'lock'. Use one form across the dock, sidebar, history modal and HUD. Rewrite the HUD tooltip so it does not suggest you can buy other people's rooms; only the claimer can collect their own room. The 'unprotected room' banner must show the price returned by the prepare-mint/price call, not a hardcoded 0.01 ETH. After a mint succeeds, link to the existing /minted-room.html?chainId=&contract=&tokenId= page instead of building something new. Implementation: add an `isMinted` boolean, derived from minted_token_id, to both the world summary query (rooms/store.ts:770-818) and the compact chunk-summary path. Only then build the world-map frame and the Explore/profile badges. The copy cleanup alone is a small task and could ship first.

### F244: NFT artwork is an 80×44-pixel thumbnail with no link back to play the room

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The picture stored in each NFT is tiny (80×44 pixels), so OpenSea and wallets blow it up into a blurry smudge. The NFT also has no link back to WAMP, and the NFT's viewer page has no Play button and doesn't show who owns it. A collectible should look good and send people back into the game.

**Technical detail.**

refreshMintMetadata renders with tilePixelSize: 2 (roomSession.ts:967-969), so a 40×22-tile room becomes an 80×44 PNG. All four PNG tokens on mainnet (2, 3, 9, 10) decode to 80×44. Tokens 1 and 4 carry an older SVG text card instead of the room. The metadata keys are only name, description, image, animation_url, attributes and wamp_room, with no external_url (roomMetadata.ts:391-417). minted-room.ts renders the room from chain but shows no owner (no ownerOf call) and no CTA. Its chainId falls back to Base Sepolia when the parameter is missing (minted-room.ts:27). Cheap fix that keeps gas flat: wrap the existing PNG in a small SVG, for example <svg viewBox='0 0 80 44' width='640' height='352'><image href='data:image/png…' width='80' height='44' style='image-rendering:pixelated'/></svg>. That adds about 150 bytes on-chain and gives crisp pixel art at any size. Alternatively use tilePixelSize 4, which roughly doubles to quadruples image bytes. Add external_url: https://wamp.land/r/{x}/{y} (the share route already exists: social/roomShareLinks.ts:6). On minted-room.html, add a big 'Play this room in WAMP' button plus 'Owned by 0x…/ENS'. Fix the brand string 'Everybody's Platformer' that still appears in token 1's description and in the wallet sign-in message (auth/store.ts:1424).

**Evidence.**

- src/scenes/editor/roomSession.ts:967-969 — renderRoomSnapshotToPngDataUrl(..., { tilePixelSize: 2 })
- src/mint/roomMetadataRender.ts:68-71 — canvas = ROOM_WIDTH*tilePixelSize × ROOM_HEIGHT*tilePixelSize
- src/mint/roomMetadata.ts:391-417 — metadata has no external_url
- src/minted-room.ts:27 — default chain is DEFAULT_ROOM_MINT_CHAIN_ID (Base Sepolia)
- src/minted-room.ts:51-82 — no owner lookup and no play link
- Live on-chain tokenURIs: tokens 2, 3, 9 and 10 have PNG IHDR 80×44; tokens 1 and 4 are SVG text cards

**Fact-check (partially confirmed).**

There are five PNG tokens on mainnet, not four: 2, 3, 6, 9 and 10 are all 80×44 PNGs. Tokens 1 and 4 are SVG cards. Tokens 5, 7, 8 and 11 have an empty tokenURI, so OpenSea and wallets show nothing for them. mintRoom (contracts/src/RoomOwnershipToken.sol:94-116) never sets a URI, and metadata only appears after the owner manually runs "Refresh NFT Metadata" and pays for a second transaction. The finding should add: write the room metadata automatically right after a mint confirms (or prompt for it), and do a one-time contract-owner batch setTokenURI for all 11 tokens using the new crisp image plus external_url (https://wamp.land/r/{x}/{y}). The minted-room.ts:27 Sepolia fallback is cosmetic only, since every generated animation_url includes chainId=8453. The minted-room page already renders crisply at tilePixelSize 6. What is low-resolution is only the `image` field.

### F242: The game's record of NFT metadata disagrees with the chain, so owners are told to pay for artwork that is already on-chain

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** For 5 of the 6 tokens that do have on-chain artwork (#1, #2, #3, #4, #10), WAMP still tells the owner 'NFT metadata is not on-chain yet' and nudges them to run another transaction. The game never re-checks the chain for metadata, and the 'up to date at version N' label trusts whatever the browser reports.

**Technical detail.**

syncRoomOwnershipFromChain and roomMintStateNeedsUpdate compare only chainId, contract, tokenId and owner (mint/service.ts:318-328). minted_metadata_* are written only by the metadata confirm route (service.ts:539-596). Tokens 1-4 were set directly by the contract owner, and token 10's confirm was lost, so D1 still shows null for all five. The editor then says 'NFT metadata is not on-chain yet' (roomSession.ts:291-293). metadataRoomVersion is client-supplied (mint/routes.ts:316-322, persisted at 253) and is not derived from the URI that was actually stored. The verify step also checks tokenURI against config.contractAddress, but persistRoomTokenMetadataState writes record.mintedChainId and record.mintedContractAddress (service.ts:580-582) without asserting they match, and never compares the chain tokenId to record.mintedTokenId (service.ts:498-507). Fix: during sync (or the cron), also read tokenURI. If sha256 differs from minted_metadata_hash, parse wamp_room.version via parseRoomTokenMetadataUri and persist version, hash and updatedAt. In the confirm route, take metadataRoomVersion from the on-chain payload. Assert record.mintedContractAddress == config.contractAddress and tokenId == record.mintedTokenId before writing.

**Evidence.**

- src/cloudflare/worker/mint/service.ts:318-328 — needs-update check ignores metadata fields
- src/scenes/editor/roomSession.ts:291-293 — 'NFT metadata is not on-chain yet' when mintedMetadataRoomVersion is null
- src/cloudflare/worker/mint/routes.ts:247-257,316-322 — the client-asserted metadataRoomVersion is persisted
- src/cloudflare/worker/mint/service.ts:580-582 — persists record chain/contract, not the verified config
- Live: GET /api/rooms/{-1,0|0,1|1,2|-3,1|8,0}/summary → mintedMetadataRoomVersion null, while on-chain tokenURI(1,2,3,4,10) are 23,033/21,033/8,169/21,525/9,869 chars
- Live: room 0,0 D1 mintedMetadataHash bafdc9ce… equals sha256(tokenURI(6)), so the confirm path works when it completes

**Fact-check (partially confirmed).**

There are 7 tokens with on-chain metadata (1, 2, 3, 4, 6, 9, 10), not 6. D1 is correct for 6 and 9 and null for 1, 2, 3, 4 and 10.

On-chain versions vs. current published versions:
- Token 1: on-chain v6, published v6 (current)
- Token 2: on-chain v1, published v1 (current)
- Token 3: on-chain v2, published v2 (current)
- Token 10: on-chain v19, published v19 (current)
- Token 4: on-chain v3, published v8 (genuinely stale)

So for 4 of the 5 rooms the "not on-chain yet" message and the "stale" message after publishing are both false. For token 4 a refresh really is needed, but the message is still wrong: it should say "stale at v3", not "not on-chain yet".

The root cause visible in the repo is scripts/backfill-room-token-metadata.ts. It sets the tokenURI on-chain as the contract owner (lines 183-192) and never updates D1. A lost confirm is unproven.

Old payloads (v=1) store `version`, while newer ones store `pv`. normalizeMintedRoomPayload in src/mint/roomMetadata.ts handles both and exposes `.version`, so the proposed parseRoomTokenMetadataUri fix works for both formats.

Drop or downgrade the tokenId/contract assertion sub-points:
- setTokenURI already checks the tokenId against record.mintedTokenId.
- The persisted tokenId is read from the chain.
- The hash check already ties the stored metadata to the actual on-chain URI. Only the version label comes from the client.

Recommended fix: run a one-off backfill of D1 from the chain for the 5 rooms. Then make the backfill script (or sync) read the tokenURI and persist the hash plus the parsed version. Derive metadataRoomVersion from the on-chain payload in the confirm route.

### F245: Cheaper or free first mint: put the price in the signed approval

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** idea · **impact:** medium · **effort:** large
- **Flagged before:** xp-badges-ratings-prd.md:402 proposes manual quarterly free mints for trusted builders; not implemented (the contract has no per-claim price).
- **Already in the product backlog.**

**Summary.** Minting is the only real protection a builder has, but it costs about $27 and needs ETH already on Base. Only 11 rooms have been minted (4 of them by Jonathan). A free or cheap first mint for real builders, with gas paid by WAMP for smart-wallet users, would turn protection from a crypto-native extra into something normal players actually use.

**Technical detail.**

Today mintPriceWei is a single global value (RoomOwnershipToken.sol:24,103; deploy default 0.01 ether at DeployRoomOwnershipToken.s.sol:19), so there is no per-player discount without dropping the price for everyone. Option A, no redeploy: lower the price now with setMintPriceWei (owner-only, RoomOwnershipToken.sol:118-121) and show a fiat estimate. Option B, a v2 contract: add priceWei and tokenURI to the RoomMintAuthorization struct and the mintRoom args, so the Worker can sign 'first room free', XP-tier discounts, or the PRD's 'manual quarterly free mints'. Add ERC-2981 royalties (split builder/WAMP) and contractURI for the OpenSea collection page. With only 11 tokens and 7 holders, a v2 migration (airdrop replacements, mark v1 retired in D1) is as cheap now as it will ever be. Gas: with the Coinbase Smart Wallet connector re-enabled, pass a paymasterService capability through wallet_sendCalls (ERC-7677, CDP/Base paymaster) to sponsor gas. This does not cover msg.value, which is why the signed price matters. Pair it with the AppKit onramp for players who still have to pay.

**Evidence.**

- contracts/src/RoomOwnershipToken.sol:24,103 — one global mintPriceWei, exact match required
- contracts/script/DeployRoomOwnershipToken.s.sol:19 — DEFAULT_INITIAL_MINT_PRICE = 0.01 ether
- On-chain: mintPriceWei = 1e16; 11 RoomMinted events across 7 wallets; FundsWithdrawn 0.11 ETH (block 49157021)
- Live D1 claimer of tokens 4, 5, 6 and 10 is 'jonathan'
- docs/product/xp-badges-ratings-prd.md:402 — 'manual quarterly free mints' listed as a top-builder reward
- index.html:2967 — About copy promises 'a small fee' without stating it

**Fact-check (partially confirmed).**

Split this into two steps.

**Step 1: quick win, small effort.**
- The owner's cold wallet calls setMintPriceWei to lower the price. The Worker already reads the price live (src/cloudflare/worker/mint/service.ts:83-92).
- Show the price in ETH plus a fiat estimate before the wallet popup (src/scenes/editor/roomSession.ts ~880). Today the price only appears inside the wallet's confirm screen.

**Step 2: v2 contract, large effort.**
- Add priceWei, and optionally tokenURI, to the signed RoomMintAuthorization.
- Add an owner-only migration mint for the 11 existing tokens.
- Before re-enabling Coinbase Smart Wallet or adding a paymaster:
  - switch wallet sign-in verification from viem's standalone verifyMessage (src/cloudflare/worker/auth/routes.ts:561) to publicClient.verifyMessage, which supports ERC-1271/6492; otherwise smart-wallet users cannot link a wallet;
  - move the send in src/auth/client.ts:349 to wallet_sendCalls.
- Find out why enableCoinbase was turned off (commit d207c85f, a lockfile fix) before turning it back on.

**Also:**
- Treat the wallet-link requirement (mint/routes.ts:32) as an equal barrier for players who signed in by email.
- Keep free mints narrow (first room only, or XP/trust-gated per xp-badges-ratings-prd.md:402) rather than setting the global price to 0. Free locking for everyone would cut into the "anyone can edit unless collected" collaboration model (index.html:2965).
- Soften "only real protection": claimer revert (index.html:2966) and World policies also exist.

### F248: Sepolia defaults in code and stale docs could cause a wrong-network mint setup

- **Area:** Room ownership, NFT minting and wallet flow
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** Production has been on Base mainnet with the hardened contract for months, but the code's fallback network is still the test network and the planning docs still say the migration hasn't happened. One missing setting would make every mint fail, and AI agents reading the docs may try to redo work that is already finished.

**Technical detail.**

DEFAULT_ROOM_MINT_CHAIN_ID = 84532 with name 'Base Sepolia' (mint/roomOwnership.ts:4-6) is used when ROOM_MINT_CHAIN_ID is unset (mint/service.ts:40-41). The authorization digest includes chainId (roomOwnership.ts:183-211) while the contract hashes block.chainid (RoomOwnershipToken.sol:84). With mainnet RPC and contract but the var missing, every mint would revert 'Invalid mint authorization.', and ensureWalletChain would switch users' wallets to Sepolia. Production config lives only in the dashboard (wrangler.jsonc:5 keep_vars, with no ROOM_MINT_* in prod vars). The Blockscout-verified source of 0xc3032d5e… is byte-identical to contracts/src/RoomOwnershipToken.sol, and owner, mintAuthority and withdrawAuthority are three distinct live addresses. Yet product-requirements.md:36 and :856 still list 'migrate live minting to the hardened claimer-signed contract' as undone. :83/:124/:520 call on-chain tokenURI 'future work' and 'Base Sepolia first', and frontend-redeploy-and-minting.md:55,122-124 still recommends Sepolia values. Fix: at prepare time, assert await client.getChainId() === config.chainId (or switch the defaults to 8453 / basescan.org). Put the non-secret ROOM_MINT_CHAIN_ID, CONTRACT_ADDRESS and EXPLORER values in wrangler.jsonc vars. Update the PRD and runbook to the actual mainnet state.

**Evidence.**

- src/mint/roomOwnership.ts:4-6 — the default chain is 84532 Base Sepolia
- src/cloudflare/worker/mint/service.ts:40-41 — that default is used when ROOM_MINT_CHAIN_ID is unset
- wrangler.jsonc:5,25-38 — keep_vars, and no ROOM_MINT_* in production vars
- docs/product/product-requirements.md:36,856 — hardened-contract migration listed as pending
- docs/product/product-requirements.md:83,124,520 — tokenURI artifacts called future work; 'Base Sepolia first'
- Blockscout: 0xc3032d5e… verified 2026-06-21, source identical to the repo contract; owner 0x11598E12…, mintAuthority 0x03538A06…, withdrawAuthority 0x42469B0A…

**Fact-check (partially confirmed).**

1. The failure mode is described inconsistently. If ROOM_MINT_CHAIN_ID went missing, the prepare response (mint/routes.ts:69-95) would give the client chain 84532. sendPreparedWalletTransaction then calls ensureWalletChain (src/auth/client.ts:337, :1023-1058), which switches the user's wallet to Base Sepolia before sending. The transaction would therefore go to that address on Sepolia, not revert on mainnet. It would either revert, if no compatible contract is there, or be a worthless Sepolia transfer that never mints. Confirm would then fail, because verifyMintTransactionForRoom reads through the mainnet RPC. The result is still "every mint fails", with a confusing network switch and no real-ETH loss. The "Invalid mint authorization." revert only happens if the wallet stays on mainnet.

2. Production is configured correctly right now: 11 tokens have been minted on the mainnet contract. This is a latent footgun for re-setup or rotation, not a live bug.

3. docs/development/environment.md:57-61 also uses Sepolia values, but that block is the local .dev.vars example, where Sepolia is appropriate. Flipping the code defaults to 8453 would make local dev default to mainnet. The safer fix is either:
   - make ROOM_MINT_CHAIN_ID required (no default) whenever ROOM_MINT_CONTRACT_ADDRESS/RPC_URL are set, or
   - check the RPC's chain id (eth_chainId, cached per isolate) against config.chainId in signRoomMintAuthorization.

4. Caveat on moving values into wrangler.jsonc: the runbook puts ROOM_MINT_CHAIN_ID/NAME/EXPLORER in with `wrangler secret put` (:131-136). If production stored them as secrets, they must be deleted as secrets before being declared as vars, or the deploy will fail on the duplicate binding name.

5. product-requirements.md:124 ("content permanence ... later decision") is arguably still accurate. The clearly stale lines are :36, :83, :520 and :856.

### F198: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F201: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F199: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F200: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F202: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F203: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F206: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F204: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F205: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F207: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F208: Students can chat with strangers, including anonymous guests, through in-room speech bubbles

- **Area:** School/classroom accounts, Worlds pilot and Jam modes
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** Classroom accounts are blocked from World Chat, comments and the guestbook, but in-room 'Say' bubbles have no student check. A student can talk to anyone standing in the same room, and anyone can talk to them, including signed-out guests who picked their own name. Students can also read all of the public World Chat. For a school product, this open two-way channel between kids and strangers is the biggest child-safety gap.

**Technical detail.**

The PartyKit identity token carries no school flag. presence/routes.ts:47-49 signs only {userId, displayName, avatarId} plus a `source`. presenceServer.ts:800-818 parseIdentity then throws away even `source`, and ConnectionPresenceState (src/partykit/presenceProtocol.ts:54-62) has no school or guest field. handleRoomChatSay (presenceServer.ts:837-879) checks only channel, play mode, length and rate. The one gate is client-side (src/presence/roomChat.ts:166-170, authenticated only, no schoolManaged check), so even guests can send by hand-crafting a websocket message. Guest display names are chosen by the client (presence/routes.ts:89-104). Fix: (1) add `school: boolean` (or classroomId) and keep `source` in PartyKitIdentityTokenClaims when minting (auth.school is already in scope in handlePresenceIdentityTokenIssue via loadOptionalRequestAuth), and store both in ConnectionPresenceState. (2) In handleRoomChatSay, drop messages from guest or school senders, and in the sendRoomChatMessage filter skip delivery to school connections, or deliver only between connections with the same classroomId if a classroom chat is wanted later. (3) Apply the same filter to PvP invites (handlePvpInvite, presenceServer.ts:881) so strangers cannot pull students into matches. (4) On the client, hide the Say composer when schoolManaged. Also consider hiding World Chat message bodies for school accounts; panel.ts:762-764 currently shows them in read-only mode.

**Evidence.**

- partykit/presenceServer.ts:837-879 — handleRoomChatSay has no school/guest/source check before broadcasting to everyone in the room
- partykit/presenceServer.ts:800-818 — parseIdentity keeps userId/displayName/avatarId only; token `source` is discarded
- src/cloudflare/worker/presence/routes.ts:47-49 — identity token minted from auth.user without any school claim
- src/cloudflare/worker/presence/routes.ts:89-104 — guest identity uses client-supplied displayName
- src/presence/roomChat.ts:166-170 — only client-side gate is `authenticated`; no schoolManaged check
- src/ui/chat/panel.ts:762-764 — 'Classroom accounts can read chat, but cannot post.'

**Fact-check (confirmed, confirmed, confirmed).**

No core correction needed. A few small additions and nuances:
1. Guests cannot send bubbles from the normal UI. The send function (roomChat.ts:166) and the composer (overworld/roomChat.ts:228) are both gated on sign-in, so a guest has to hand-craft a websocket message, as the claim says. The everyday risk is any signed-in non-school stranger who is in the same room as a student. Guests do receive and read bubbles.
2. Room-chat bubbles also skip the World Chat ban list and have no content filter. normalizeRoomChatText only trims the text and checks its length. So a user banned from World Chat can still send bubbles to students.
3. PvP invites (relayProtocol.ts:49-74) carry no free text, so they are a lower-risk vector than the bubbles.
4. The fix also needs a client gate in OverworldRoomChatController.openComposer (src/scenes/overworld/roomChat.ts:228), not only in WorldRoomChatClient.send.

No core correction needed. Two additions:
- normalizeRoomChatText (src/partykit/relayProtocol.ts:17-21) has no word filtering, so guest text and guest display names go out unfiltered.
- The client-side check that allows only signed-in players is duplicated in src/scenes/overworld/roomChat.ts:225-226 and 410-415 (opening the composer and disabling its input). That file needs the same schoolManaged check as src/presence/roomChat.ts:166-170.

**Guest part of the summary is overstated.**
- A signed-out guest cannot send a bubble through the normal UI. Both `src/presence/roomChat.ts:167` and `OverworldRoomChatController.openComposer` require a signed-in account.
- Guest names are not chosen through the UI. They are auto-generated as "Guest xxxx" (`src/presence/worldPresence.ts:858-861`).
- A guest can only send, or pick a custom name, by hand-crafting the token request or the websocket message. The server does accept that.
- Guests can, however, read students' bubbles. They open a room-chat socket and the broadcast filter at `presenceServer.ts` handleRoomChatSay does not exclude them.
- So the realistic exposure is: any signed-in non-school user can talk with students both ways, and guests can watch.

**Understated, worth adding to the same fix:**
- The presence server never enforces chat bans either: no ban, moderation or report references in `partykit/presenceServer.ts`. A user banned from World Chat can still use in-room bubbles.
- There is no profanity filter on room chat (`relayProtocol.ts:17-21`).

**Implementation notes for the fix:**
- `verifyPartykitIdentityToken` rebuilds the identity field by field (`identityToken.ts:195-212`), so its parsing must be extended to carry the new school claim.
- Tokens issued before deploy will lack the claim until they expire.
- The PartyKit server and the Worker are deployed separately, so both deploys are needed.

**PvP invites:** `handlePvpInvite` (`presenceServer.ts:881-911`) has no school check, so the point is valid. Risk is lower because an invite carries only identity, no free text.

### F209: School restrictions are opt-in per route, so many public-posting paths are still open to students

- **Area:** School/classroom accounts, Worlds pilot and Jam modes
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Each feature has to remember to block students on its own, and many don't. A student can rename themselves to any public name, publish public playlists with free-text descriptions, create public Wamp-O-Gram cards with messages, share pixel-art sprites to the public catalog, and create bot 'agents' with public names. The intended 'students can't post text' rule is easy to get around, and the only test checks that certain words appear in the source code.

**Technical detail.**

assertNotSchoolRestricted (school/restrictions.ts:4-10) is called only in roomComments, chat, backgroundImages, guestbook and profiles. Gaps: POST /api/auth/display-name (auth/routes.ts:403-430) has no school check, while the profile endpoint blocks the same change (profiles/routes.ts:129). Playlists create/update (playlists/routes.ts:54+) store title (60 characters) and description (280 characters) publicly. Wamp-O-Gram POST (wampOGram/routes.ts:29-39) stores title, message, sender/recipient names and a third party's recipientEmail. Custom sprite PUT (customSprites/routes.ts:66-79) and agent creation (agents/routes.ts:68-83) use requireCurrentSession (auth/request.ts:18-30), which never loads school context and never checks whether the classroom is disabled. API token creation (auth/routes.ts:467-475) has the same issue. Fix: switch to deny-by-default. In src/cloudflare/worker.ts, before dispatch, when the method is POST/PUT/PATCH/DELETE and the session resolves to auth.school, return 403 unless the path matches an explicit SCHOOL_ALLOWED_MUTATIONS list (room draft/publish/revert, runs, avatar select, presence identity token, logout, music phrases if desired). Make requireCurrentSession call the same school/disabled resolution. Replace routes.contract.test.ts (a readFileSync string grep) with a table-driven test that sends every mutating route with a school RequestAuth and expects 403 unless the route is allow-listed. New routes then fail closed.

**Evidence.**

- src/cloudflare/worker/school/restrictions.ts:4-10 — per-route opt-in guard
- src/cloudflare/worker/auth/routes.ts:403-430 — handleUpdateDisplayName: no school check
- src/cloudflare/worker/profiles/routes.ts:129 — the profile path blocks the same change ('edit profile text')
- src/cloudflare/worker/customSprites/routes.ts:66-79 — public sprite catalog PUT via requireCurrentSession
- src/cloudflare/worker/auth/request.ts:18-30 — requireCurrentSession does not attach school context or check disabled classrooms
- src/cloudflare/worker/wampOGram/routes.ts:29-39 — public card creation with free-text message, no school check
- src/cloudflare/worker/agents/routes.ts:68-83 — students can create agents with public display names
- src/cloudflare/worker/school/routes.contract.test.ts:4-17 — only test is a source-text grep

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

1) Display name and playlists can only be changed through the API, because the client already hides both from students. The display-name row only appears when the user has no saved name (auth/client.ts:1096). Playlist creation is hidden whenever isSchoolAvatarOnlyEdit is true (profileModal.ts:573, 655, 1312). The real defect is that the server does not enforce what the UI intends.

2) Agents and API tokens have no client UI, so they too are reachable only through the API. API tokens and agent tokens are not a restriction bypass. When a token is used, loadOptionalRequestAuth calls requireEnabledSchoolContext (request.ts:89, 273-279), which attaches the student's school context again and rejects disabled accounts. Students minting tokens is a minor issue.

3) The missing disabled-classroom check in requireCurrentSession matters little in practice. Disabling a student deletes their sessions (school/store.ts:341-343). No route disables a classroom; nothing in the code runs UPDATE school_classrooms.

4) Wamp-O-Grams are unlisted links with random slugs, not a public feed. recipientEmail is stored, but makePublicWampOGramRecord strips it, and no email is ever sent (delivery_status is 'draft', store.ts:~98).

5) The gaps students can actually reach through the normal UI are these two:
- Custom sprites (pixel art plus a 32-character name) are synced to the public catalog automatically for any signed-in user (customSprites/sync.ts:103-125). This contrasts with background-image uploads, which are blocked for students.
- Wamp-O-Gram creation (wampOGramModal.ts:226, which only checks that the user is signed in).

6) The proposed fix still stands. Router.ts already has an unused `auth` field on each route, which is a natural place for a deny-by-default gate. The gate also has to cover the hand-written if-chain in worker.ts, not just the route table.

1. "requireCurrentSession never checks disabled" mostly doesn't apply. Disabling a student deletes all their sessions (school/store.ts:341-342 runs `DELETE FROM sessions WHERE user_id = ?`), so a disabled student has no session to use. The gap only matters for a classroom-level disable (`c.disabled_at`). No API route sets that; the school routes only expose per-student disable/enable (school/routes.ts:97-113). So it is a minor gap for manual DB disables, not a live hole.
2. Letting students create API tokens is not a real bypass. When any bearer token (API token or agent token) is used, the code re-attaches the owner's school context through requireEnabledSchoolContext (auth/request.ts:79-89). Agent tokens are covered the same way, because agent auth sets user = owner (agents/store.ts:365-376). Existing guards still apply to those tokens.
3. Agents have no client UI. Nothing outside the worker calls /api/agents, so that path is API-only. The display-name path is also mostly API-only: the UI hides the rename row once a name is saved (auth/client.ts:1096). It still works through a hand-made request from devtools on wamp.land. Playlists, Wamp-O-Gram and custom sprites, though, are reachable through the normal UI.
4. school/routes.contract.test.ts:8-17 is a source-text grep, but it tests the teacher enable/disable toggle, not student restrictions. The accurate statement is that no server-side test covers school restrictions at all. The only restriction-related test is client-side UI state (src/scenes/overworld/roomCommentsComposerController.test.ts:90).
5. Wamp-O-Gram's recipientEmail is stored and is not returned in public responses (wampOGram/model.ts:46-47, 85). It is not publicly exposed, but a student can still enter a third party's email address.
The suggested fix (deny-by-default mutation allowlist plus a table-driven route test) is still appropriate. Any allowlist must account for room publish carrying free-text titles.

What's real: playlists (always public, listed on student profiles, title up to 60 characters and description up to 280) and Wamp-O-Gram share cards (title, message and names) have no school check in either the API or the UI, so students can create them through normal use. Custom sprite catalog sharing is also ungated. The only worker-side school test is a source-text grep.

Corrections:
- Display-name rename, agent creation and API token creation are API-only for students. The UI hides the display-name row once a name exists, and no client code calls /api/agents or /api/auth/tokens.
- Token and agent auth still carry the owner's school context, so they don't get around the existing chat and comment blocks.
- The disabled-classroom gap in requireCurrentSession hardly matters: disabling a student deletes their sessions, and no route can disable a whole classroom.
- recipientEmail is never emailed (cards stay 'draft') and is removed from the public record. Wamp-O-Grams are unlisted links, not a public feed.
- Rooms already allow public free text through titles (40 characters) and sign objects (signText). A "students can't post text" rule never existed, and the proposed allowlist, which keeps room publish, wouldn't create one. First decide the policy: block social and communication channels only, or also moderate creative text.

Recommended fix order: (1) add assertNotSchoolRestricted to playlist create/update, the Wamp-O-Gram POST, custom sprite PUT, display-name, agent create and token create, and hide those buttons when schoolManaged (small). (2) Add real request-level tests that send a school RequestAuth to each route. (3) Optionally, a deny-by-default guard in dispatch (medium effort, because the allowlist is long and the school lookup adds a query per request).

### F211: Student login can be brute-forced, and accounts that were never logged into can be taken over

- **Area:** School/classroom accounts, Worlds pilot and Jam modes
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** The student login has no limit on wrong guesses, and the starting passwords come from a small pool of about 400,000 combinations. Anyone who knows the classroom link and a student's username could keep guessing. If they guess a temporary password before the student first logs in, they get to set the new password and take the account. Also, when a teacher clicks 'Reset Password', anyone already logged in as that student stays logged in.

**Technical detail.**

handleStudentLogin (school/routes.ts:123-136) has no throttle, unlike the email code flow, which caps at 5 attempts (auth/routes.ts:303-307). Temporary passwords are word-word-NNN from 22 words × 21 × 900, about 415k (school/store.ts:25-48, 692-700). The first valid temporary password plus newPassword sets a password of the caller's choice (store.ts:375-402). An unknown username returns 401 before PBKDF2 runs, while a known one runs 100k iterations (store.ts:363-371), which leaks valid usernames through timing. Every guess also burns 100k PBKDF2 iterations of Worker CPU with no limit (store.ts:19). Classroom slugs can be looked up publicly (school/routes.ts:60-64) and default to the display name (store.ts:112). Reset does not revoke sessions (store.ts:281-289), but disable does (store.ts:341-343). Fix: (a) add a school_login_attempts table keyed by (classroom_id, lower(username)) and a hashed IP; after 8 failures in 15 minutes return 429 and show 'ask your teacher'. (b) On a missing username, verify against a fixed dummy hash so timing matches. (c) Use 3 words from a ~250-word list plus 2 digits (~1.5B), or have the teacher hand out a one-time 6-digit activation code that expires in 7 days. (d) Add DELETE FROM sessions WHERE user_id=? to resetSchoolStudentPassword. (e) Reject very common passwords such as 'password' and '12345678', since the current minimum is just 8 characters (store.ts:686).

**Evidence.**

- src/cloudflare/worker/school/routes.ts:123-136 — no rate limit or attempt counter
- src/cloudflare/worker/school/store.ts:25-48 and 692-700 — 22-word list, word-word-NNN
- src/cloudflare/worker/school/store.ts:363-371 — unknown username short-circuits before PBKDF2 (timing oracle)
- src/cloudflare/worker/school/store.ts:375-402 — temporary password plus newPassword sets the attacker's password
- src/cloudflare/worker/school/store.ts:281-289 — reset leaves existing sessions alive (contrast 341-343)
- src/cloudflare/worker/auth/routes.ts:303-307 — email codes are capped at 5 attempts; student passwords are not

**Fact-check (confirmed, confirmed, partially confirmed).**

Every cited fact checks out; only the framing needs adjusting. (1) Takeover via temporary password works only while password_reset_required=1, i.e. before first login or after a teacher reset. The attacker must win that race, and it takes about 200k online guesses on average (out of about 415-436k combinations). (2) The steadier risk is guessing student-chosen passwords: the minimum is 8 characters with no blocklist (store.ts:686), and there is no throttle. (3) The fix can use Cloudflare's built-in Workers Rate Limiting binding (a ratelimits entry in wrangler.jsonc), keyed by classroom+username and by IP, instead of a new D1 table. Either works. Pair it with a dummy-hash verify when the username is unknown and a DELETE FROM sessions WHERE user_id=? in resetSchoolStudentPassword's batch (store.ts:281-289).

The password pool is about 22×22×900 ≈ 436k, not 22×21×900. generateStudentPassword (store.ts:692-700) re-rolls the second word only once, so the same word can appear twice. The difference doesn't matter.

The claim also understates the risk. An attacker doesn't have to target one student. They can try the same guesses against every student in a classroom who hasn't logged in yet. With 30 such students, roughly 7k guesses are expected to take over some account, compared with about 218k for a single student. That makes the per-classroom IP/username lockout in fix (a), together with longer temporary passwords or activation codes in fix (c), the priority.

The route table at worker.ts:166 marks /api/school as 'authenticated', but the router never enforces that label (core/router.ts:26-40). It looks protected but isn't, and it should be corrected or enforced.

How bad this is depends on how many classrooms are live, which the code alone can't show.

The core claim is real. No rate limit or lockout exists on POST /api/school/classrooms/:slug/student-login (the router's 'authenticated' tag isn't enforced, core/router.ts:26-40). Temporary passwords are about 416k combinations. A guessed temporary password lets the guesser take over an account that hasn't been activated yet. Reset doesn't revoke sessions, and sessions last 30 days (auth/store.ts:23). Corrections:
(1) The timing-oracle sub-point is close to moot, because student usernames are their public display_name (store.ts:222-225).
(2) The 'burns Worker CPU' point is negligible in cost and needs a valid username.
(3) Brute-forcing the temporary password only works while password_reset_required=1, usually a short window in a classroom. The more realistic exposures are reset not revoking sessions and unlimited guessing of weak passwords students chose themselves.
(4) For the rate-limit design, don't key the lockout mainly on IP, because a school shares one NAT address and the whole class would get locked out. Key on (classroom_id, username), have teacher reset clear the counter, and add a generous IP limit only as a backstop. Cloudflare's Workers Rate Limiting binding is a simpler option than a new D1 table.
Priority order: (d) add DELETE FROM sessions to the reset; then the per-username attempt cap; then the longer temporary passwords and the common-password blocklist.

### F210: Student accounts can link a personal email or crypto wallet and then mint paid NFTs

- **Area:** School/classroom accounts, Worlds pilot and Jam modes
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** A signed-in student can attach their own email address or crypto wallet to the school account. From then on they can sign in outside the teacher's classroom login, and with a wallet attached they can pay to mint rooms as NFTs on Base. A school-managed child account should not be able to collect a personal email, connect a wallet, or spend money.

**Technical detail.**

handleRequestMagicLink (auth/routes.ts:178-195): when an existing session has no email, the purpose becomes 'link_email' and the email is attached on verify (auth/routes.ts:271/319, attachEmailToUser). There is no auth.school check. handleWalletVerify (auth/routes.ts:574-585) calls attachWalletToUser for any existing session. Mint prepare only needs a linked wallet (mint/routes.ts:32 requireWalletLinkedRequestAuth). Students are created with email/wallet NULL (school/store.ts:222-225), so the system assumes they stay that way. Fix: when existingAuth.school is set, reject link_email and wallet link with 403 'Classroom accounts can't link email or wallets'. Add school to the mint prepare/confirm deny list (or the deny-by-default gate in the previous finding). Hide the link and mint UI when schoolManaged. Also add a one-off D1 audit query for school users that already have email or wallet_address set.

**Evidence.**

- src/cloudflare/worker/auth/routes.ts:178-195 — existing session plus no email becomes purpose 'link_email'; no school check
- src/cloudflare/worker/auth/routes.ts:574-585 — wallet attached to any existing session auth
- src/cloudflare/worker/mint/routes.ts:32 — mint gated only by requireWalletLinkedRequestAuth
- src/cloudflare/worker/school/store.ts:222-225 — students are created with NULL email/wallet

**Fact-check (confirmed, confirmed, partially confirmed).**

Clarifications to the claim:

- **The account stays classroom-managed after linking.** auth/request.ts:93-104 re-attaches the school context on every request, so the existing chat, comment and profile restrictions still apply. Teacher disable also still works, because a disabled student's session is deleted. What the student gains is a way to sign in that a teacher's password reset does not shut off. The bigger problem is that the account now holds a personal email or wallet.

- **Minting is limited to rooms in the main world.** World rooms always return canMint false (worlds/access.ts:176). The mint fee comes from the student's own funded wallet, not a stored card.

- **The client fix belongs in auth/client.ts renderAuthUi (lines 1073-1091).** For school accounts it should hide the "Add Email" row and the wallet button, not just the mint UI.

Everything the claim says is accurate, with three clarifications. (1) There is now a second way to attach an email: the six-digit code verify at routes.ts:319 (handleVerifyEmailCode), alongside the magic-link verify at routes.ts:271. Both need the school check. (2) Signing in by email or wallet does not drop the school restrictions. School context is looked up by user_id on every request (auth/request.ts:248-266), so chat, comment and profile limits still apply and a teacher disabling the student still ends the session. The escape is a login the teacher's password reset can't revoke, plus a child's personal email and wallet being stored. (3) All four mint handlers (mint/routes.ts:32, 107, 149, 217) need the guard, not only prepare and confirm. The client is also part of the problem: renderAuthUi (src/auth/client.ts:1073-1092) offers 'Add Email' and the wallet button to student accounts.

The core claim holds: there is no server or client gate on students linking an email or wallet, or on minting. Three details need correcting.
1. Linking does not let a student escape teacher control. School context is re-attached by user_id on every request (auth/request.ts:93-97, 249-257). Teacher disable still ends email or wallet sessions, and the chat, comment and profile restrictions still apply.
2. Minting requires a self-custodial Base wallet the child already holds and has funded with ETH, plus a claimed Prime-world room. There is no stored payment method, so "spend money" is rare.
3. The main real harm is that the auth panel (src/auth/client.ts:1074-1091) shows every student an "Add Email" prompt, which collects a child's personal email and blocks that email for future use. Wallet linking and a permanent public on-chain mint are smaller, rarer risks.

Impact is medium rather than high: this is a pilot-scale feature, and the main consequence is privacy and compliance, not loss of control. Effort remains small.

### F219: Student logins last 30 days on shared school computers

- **Area:** School/classroom accounts, Worlds pilot and Jam modes
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** When a student signs in, they stay signed in for a month. School laptops are often shared, so the next kid who opens WAMP on that laptop is playing, building and publishing as the previous student. Class accounts should sign out at the end of the school day.

**Technical detail.**

Student login calls the generic createSession (school/routes.ts:149), which always uses SESSION_MAX_AGE_SECONDS = 30 days (auth/store.ts:23, 966-971). The cookie Max-Age matches (auth/request.ts createSessionCookie). Fix: add an optional ttlSeconds parameter to createSession and pass about 10 hours for school logins, with a matching cookie Max-Age. Add a visible 'Not you? Switch student' button in the game HUD when schoolManaged that calls /api/auth/logout and returns to school-login.html?classroom=slug (the slug is already in auth.school.classroomSlug).

**Evidence.**

- src/cloudflare/worker/auth/store.ts:23 — SESSION_MAX_AGE_SECONDS = 30 days
- src/cloudflare/worker/auth/store.ts:966-971 — createSession has no TTL override
- src/cloudflare/worker/school/routes.ts:149 — student login uses the default session

**Fact-check (confirmed).**

A Logout button already exists. It is index.html:197, shown for school students too (auth/client.ts:1098). The real gap is that it is hidden in the menu and does not return to school-login.html?classroom=slug. The fix should reuse or redirect that button rather than add a separate logout path. When you add a ttlSeconds option, pass it to both createSession (store.ts:966) and createSessionCookie (request.ts:142); right now both read the single SESSION_MAX_AGE_SECONDS constant.

### F212: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F213: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F214: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F215: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F218: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F216: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F169: Game key capture blocks arrow keys and Space in menus, so volume sliders, radio choices and modal scrolling don't work from the keyboard

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Unless you're typing in a text box, the game grabs the arrow keys and Space. In Settings you can't nudge the Music/SFX sliders or move between choices with the arrow keys, you can't scroll long lists like Leaderboard or Explore with the keyboard, and during play your character keeps moving behind the open menu.

**Technical detail.**

setupGameplayKeys registers cursors (UP/DOWN/LEFT/RIGHT/SPACE/SHIFT), WASD, Q/E and 9 with Phaser's default enableCapture=true (OverworldPlayScene.ts:2673-2684; KeyboardPlugin.js:493). It runs in create(), so the captures exist in every mode. KeyboardManager.onKeyDown calls preventDefault on any captured key (KeyboardManager.js:200-202). syncGameKeyboardFocus turns that off only when isTextInputFocused() is true (ui/keyboardFocus.ts:74-86), and isEditableInputType deliberately excludes range, radio, checkbox and button (keyboardFocus.ts:6-17). So with focus on #settings-music-volume, ArrowLeft/Right are cancelled. Scene keyboards also stay enabled, so the player moves. Fix: in syncGameKeyboardFocus, treat any focused element that isn't body or the game canvas, plus any open .history-modal, as UI focus. Set keyboardManager.preventDefault=false and keyboard.enabled=false (with resetKeys) in that case. Re-run it from a MutationObserver on `.history-modal` class changes, or have createModalLifecycle dispatch an event. Then, when play starts or the user clicks the canvas, move focus to the canvas (paletteController.ts:784 focusGameCanvasForShortcuts already does this for the editor). Otherwise a HUD button left focused after a mouse click would get 'clicked' by Space once Space stops being captured.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:2673-2684 — cursor keys, WASD, Q/E and 9 are added with default capture
- node_modules/phaser/src/input/keyboard/KeyboardPlugin.js:493 — addKey defaults enableCapture to true
- node_modules/phaser/src/input/keyboard/KeyboardManager.js:200-202 — preventDefault is called on every captured keyCode, whatever the event target
- src/ui/keyboardFocus.ts:6-17 — range, radio, checkbox and button are classed as 'not text input'
- src/ui/keyboardFocus.ts:74-86 — capture and the scene keyboard are relaxed only for text inputs
- index.html:2836-2845 — Settings has range sliders for Music/SFX and radio groups for Performance, Builder and Panning

**Fact-check (confirmed, confirmed, partially confirmed).**

Minor detail fixes:
1. The index.html citation is slightly off. The Music/SFX range sliders are at index.html:2843-2852. The radio groups span 2810-2881: Performance 2810-2824, Builder 2858-2865, Panning 2877-2881.
2. Only native default actions are blocked. Element-level JS key handlers still run, because Phaser listens on window in the bubble phase. Examples are the ArrowLeft tab handling at sidebarSections.ts:235 and the Enter/Space handling at buttonFeedback.ts:121. PageUp/PageDown/Home/End still scroll modals, since those keys are not captured.
3. The captures sit on the global KeyboardManager. The same blocking therefore also hits editor-side range inputs, such as the spray-rate slider at index.html:305.
4. I'd lower impact to medium. Mouse and touch users can still adjust everything. The harm falls mostly on keyboard-only players, plus anyone who presses arrows while a menu is open during play.

The core claim holds. These are small refinements, not reasons to reject it:
(a) Home, End, PageUp and PageDown are not captured, so the range sliders can still be moved with those keys. Arrow keys and Space are blocked, and so are Tab-then-Space on radio buttons and checkboxes.
(b) Phaser skips preventDefault when Shift, Ctrl, Alt or Meta is held (KeyboardManager.js:198-200), so modified arrow presses still reach the controls.
(c) Two modals already pause the scene, room-goal intro and performance-suggestion (OverworldPlayScene.ts:3842-3854). There the player does not move. The 'character keeps moving' part applies to Settings, Leaderboard, Explore and the other non-pausing modals.
(d) Explore room cards handle Enter and Space themselves and call preventDefault (exploreModal.ts:573-579). Phaser then skips those events, so Space works on those cards.
(e) The listener is on window in the bubble phase, so an alternative small fix is a per-modal keydown handler that calls stopPropagation for arrow keys and Space when the target is inside an open .history-modal. Either approach also needs the focus-to-canvas step the claim describes, so that a focused HUD button is not activated by Space.

Mechanism confirmed, both in code and in a headless browser test. Corrections:
(1) Impact is medium for accessibility and low for typical players. It needs a physical keyboard aimed at menu controls, and mobile is unaffected.
(2) Some keyboard paths still work, which narrows the "can't scroll / can't use menus from the keyboard" claim. Tab, Enter, Escape, and PageUp/PageDown/Home/End are not captured, and Shift+Arrow gets past the capture. What's actually blocked: arrow-key changes to sliders and radio groups, arrow/Space scrolling, and Space on focused buttons and checkboxes.
(3) Narrow the fix so it doesn't break movement after a mouse click on a HUD button. In syncGameKeyboardFocus, treat focus as UI focus when either (a) document.activeElement is inside an open `.history-modal:not(.hidden)`, or (b) it is an input of type range, radio or checkbox. Also set scene `keyboard.enabled=false` plus resetKeys() while any `.history-modal` is open. Re-run the sync when a modal opens or closes, either by dispatching an event from createModalLifecycle.show/hide and SettingsModal.open/close, or with a MutationObserver on the class attribute of the modals. Don't turn capture off just because a plain HUD or toolbar button has focus. When a modal closes, blur the element that had focus inside it, so focus returns to the body and the game.

### F175: Modals never move, trap or restore keyboard focus (including the welcome and goal-intro popups)

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** medium · **effort:** medium
- **Flagged before:** docs/2026-07-13-code-health-and-performance-recommendations.md:56-59 recommended one createModal owning backdrop, escape and focus. The helper exists (modalLifecycle.ts) but owns no focus behaviour and is used by only 5 of about 20 modals.

**Summary.** When any popup opens (Welcome, room goal intro, Settings, Leaderboard), keyboard focus stays behind it. Keyboard and screen-reader players have to Tab through the whole HUD to reach the popup's buttons, can Tab back out into the hidden page, and lose their place when it closes. The goal intro's Start button isn't focused, so Enter doesn't start the room.

**Technical detail.**

createModalLifecycle.show()/hide() only toggle `.hidden` and aria-hidden (modalLifecycle.ts:37-55). Only 5 modals use it; about 15 others hand-roll the same open/close (e.g. settingsModal.ts:169-187). A grep finds no focus-trap, Tab handler or `inert` anywhere in src. Of the modal controllers, only chatModeration, guestbook, performanceSuggestion, pvp, signText and the editor dock call .focus() at all. Upgrade the shared helper: on show, store document.activeElement, then on the next frame focus the panel's `[autofocus]` or first primary button (add autofocus to #btn-room-goal-intro-start and the Welcome lane buttons), set `inert` on the other top-level children of body, and add a keydown Tab/Shift+Tab wrap inside the `[role=dialog]` panel. On hide, remove inert and restore the stored focus if it's still connected, otherwise focus the game canvas. Then migrate the hand-rolled modals to the helper as they're touched. The markup side is already good: every panel has role=dialog, aria-modal and aria-labelledby.

**Evidence.**

- src/ui/setup/modalLifecycle.ts:37-55 — show/hide toggle visibility only, with no focus handling
- src/ui/setup/settingsModal.ts:169-187 — open()/close() with no focus move or restore
- src/ui/setup/roomGoalIntroModal.ts:51-55 — the goal intro uses the helper, so its Start button is never focused
- index.html:2236 — the welcome modal is role=dialog aria-modal, but nothing focuses into it on first visit
- docs/2026-07-13-code-health-and-performance-recommendations.md:59 — earlier advice to centralise backdrop/escape/focus in one createModal

**Fact-check (partially confirmed).**

playlistIntroModal.ts:60 already focuses its Start button after lifecycle.show(), so the claimed list of focusing modals is incomplete. roomGoalIntroModal is inconsistent with its sibling, and the fix is to copy that line. performanceSuggestionModal.ts:441-506 already has the full pattern: save previousFocus, focus the primary button, restore if isConnected. Lift it into modalLifecycle.ts instead of writing it fresh. Keyboard users can already start the goal-intro run with Escape (onClose → finish(true,true)); only Enter/Space don't work. Recommended order: (1) focus #btn-room-goal-intro-start in open() and the first Welcome lane button in welcomeModal open() (small); (2) move the save/restore focus from performanceSuggestionModal into the helper, plus `inert` on the other top-level children of body and a Tab wrap (small); (3) migrate the hand-rolled modals as they're touched (medium).

### F170: There's no pause: menus opened mid-run leave enemies, hazards and the timer running

- **Area:** Accessibility & inclusivity
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** The only way to stop is to leave the room (P, Esc or Stop), which throws away your attempt. Players who need a break, get interrupted, play one-handed or tire quickly have no way to pause, and opening Settings during a run can get you killed. Pausing anywhere is one of the most basic game accessibility features.

**Technical detail.**

syncScenePauseState pauses the scene only for roomGoalIntroPauseRequested or performanceSuggestionPauseRequested (OverworldPlayScene.ts:3842-3856), so the plumbing exists. Add a userPauseRequested flag plus a modalPauseRequested flag that is set whenever a blocking `.history-modal` opens in play mode (same hook as the keyboard fix). Show a small pause overlay with Resume / Restart / Settings / Controls / Leave Room. Bindings: Escape opens the pause menu instead of leaving instantly (which also removes the accidental-exit class of bugs); P stays 'leave'; on mobile the portrait Stop button opens the menu (portraitPlayControls.ts:139-143) and Leave moves inside it. Ranked fairness: while a qualified run is paused, cover the canvas with an opaque overlay so players can't study the room for free, and either keep counting goal-run time or downgrade the attempt to practice. Disable pause in PvP and Room Rush, or make it leave/forfeit there, since those involve other players or a shared clock.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:3842-3856 — scene pause is applied only for the goal intro and the performance suggestion
- src/scenes/overworld/inspectInput.ts:113-117 — P and Esc immediately call returnToWorld
- index.html:2919-2928 — the Controls list has no pause binding; 'P / Esc Return to browse'
- src/styles/sections/responsive/phone-chrome.css:85-96 — Settings/Controls stay tappable in play-world on phones

**Fact-check (confirmed).**

The core claim is accurate. Two additions. (1) Mitigation: Phaser pauses the loop by default when the tab or app is hidden (phaser Game.js:590), and the goal timer counts frame time, so switching apps or tabs already freezes a run. The gap is a real in-game pause and pausing while in-game modals are open. (2) Extra bug to fix alongside it: modalLifecycle.ts:18-24 closes the modal on Escape without stopping the event, and inspectInput.ts:63 also fires on ESC. So pressing Esc to dismiss Settings or Controls during play probably also leaves the room. A cheap first step is to call a modal pause request from modalLifecycle show/hide while mode === 'play', and have the ESC handler do nothing when a modal is open.

### F171: Phone UI text is 6–7px pixel font, and there's no readable-font or larger-text option

- **Area:** Accessibility & inclusivity
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** On phones, the main bottom-bar buttons, HUD actions and status pills use 6–7px retro pixel fonts. That's hard to read for kids, older players, low-vision and dyslexic players, and anyone in sunlight. A 'Readable text' toggle (plain font) and a 'Large' text size in Settings would help every mobile player while keeping the pixel look as the default.

**Technical detail.**

About 166 CSS rules set font-size at 10px or below. The worst are phone overrides: the bottom bar at 7px (phone-chrome.css:39), play-world Settings/Controls/online count at 7px (phone-chrome.css:95), HUD mobile actions at 7px (phone-world-chat.css:66), tertiary actions at 7px (:154), the world state pill at 6px (:89) and the level label at 6px (:327). Font tokens exist (base.css:62-66: --editor-pixel-font, --hud-ui-font, --hud-room-title-font), but about 230 declarations hard-code 'HomeVideo' / 'Early GameBoy' / 'Super Mario Bros. NES', so one toggle can't swap them. Plan: (1) mechanically replace the literal pixel-font family strings with the three vars (sed-able, zero visual change). (2) Add settings fields `textStyle: 'pixel'|'readable'` and `textSize: 'normal'|'large'` to GameSettings (settings/model.ts:5-12). The Worker reuses normalizeGameSettings, so these sync to the account automatically. Mirror them to body data attributes as builderMode does (settingsModal.ts:190). (3) body[data-text-style='readable'] redefines the font vars to 'IBM Plex Mono' (already loaded, base.css:1) and sets a floor of `font-size: max(11px, …)` on the phone overrides. body[data-text-size='large'] applies `zoom: 1.2` to #world-hud, #bottom-bar and .history-modal-panel (CSS zoom is baseline in all current browsers). Phaser canvas text (signs, nameplates) can read the same setting for its fontFamily.

**Evidence.**

- src/styles/sections/responsive/phone-chrome.css:39 — phone bottom-bar buttons use font-size: 7px
- src/styles/sections/responsive/phone-chrome.css:93-96 — play-world Settings/Controls/online count use 7px
- src/styles/sections/responsive/phone-world-chat.css:89 — world state pill uses 6px
- src/styles/sections/responsive/phone-world-chat.css:327 — mini-profile level label uses 6px
- src/styles/sections/base.css:62-66 — font tokens exist but are referenced only about 25 times, against about 230 literal pixel-font declarations
- src/settings/model.ts:5-12 — GameSettings has no text, motion or assist options

**Fact-check (confirmed).**

Refinements, not reversals:
1. Do a quick win first, with no setting needed. Raise the 16 rules at 7px or below to a 9–10px floor. That means the 10 cited phone overrides plus jam.css:263/333, base.css:658, phone-portrait-play-controls.css:332/352, profile-avatar-picker.css:63/161/282, retro-skin.css:905 and sprite.css:374. This is small effort and helps every phone player. The toggle can follow as a medium-effort job.
2. Some of the cited phone buttons already get their font from var(--hud-ui-font) (bars-buttons.css:148-151), so redefining that var partly works today. The mechanical literal→var replacement is still needed, though. Over 200 literals remain, and some are !important (e.g. dock-shell.css:81 forces 'Early GameBoy' !important on the bottom-bar pill), which would override any var swap.
3. The 34 font literals in .ts files (canvas/Phaser text) also need to read the setting.
4. Treat `zoom: 1.2` on #world-hud/#bottom-bar as risky on phones. Those bars are tightly packed: the bottom bar is a wrapping flex row with a 30px minimum height, and safe-area padding applies. Scaling the whole container could overflow or cover the play area in landscape. Prefer raising font-size per rule under body[data-text-size='large'], or zoom only the text-bearing children, and check in both phone orientations.
5. Note the count as about 227 literal declarations, not about 230. Close enough.

### F174: The signature red buttons (Build, Publish, Mint, errors, chat badge) fail text contrast at about 3:1

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** White or cream text on the retro red (#ed5f4b) measures only 3.0–3.3:1, below the 4.5:1 needed for small text. That's on the most important buttons in the game (Build, Play while active, Publish, Mint), on every error banner, and on the 8px chat unread badge. Switching that text to the dark ink colour already used on the yellow buttons fixes it without changing the look.

**Technical detail.**

Computed WCAG ratios: #fff on #ed5f4b = 3.31; #fff3db on #ed5f4b = 3.01. Fixes: #18161c ink on #ed5f4b = 5.42 (matches the existing ink-on-yellow style), or darken the red to #c2392b, which gives 5.37 with white and 4.88 with cream. There are 4 red token definitions (base.css:428, hud-goals.css:25 and :432, retro-skin.css:10) and 43 literal #ed5f4b uses. About 30 rules pair red with light text. Main ones: bars-buttons.css:239-243 (.world-btn-play.active), :284-288 (.world-btn-build), dock-shell.css:241-244 (publish), retro-skin.css:182/491/890 (publish nudge, danger, Mint), chat-and-jump.css:279-282 (8px badge), and every `.history-modal-error` (e.g. wamp-o-gram.css:189-196). Also: --success #347433 used as text on dark panels is 3.58:1 (bars-buttons.css:112 save-status accent; sidebar-layout.css:291), so use --accent-cool #5dc16b (9.0:1). --danger #b22222 as text on dark is 2.95:1 (sidebar-layout.css:269; backgrounds-lighting.css:93 upload error), so use --accent-hot #ff7a5c (7.95:1). Add a tiny contrast-check script over the token pairs to the quality gate so new retro colours don't regress.

**Evidence.**

- src/styles/sections/world/bars-buttons.css:284-288 — .world-btn-build: background var(--hud-trial-red), color #fff (3.31:1)
- src/styles/sections/editor/dock-shell.css:241-244 — Publish button: cream on red (3.01:1)
- src/styles/sections/world/chat-and-jump.css:279-282 — chat unread badge: cream on red at 8px Early GameBoy
- src/styles/sections/modals/wamp-o-gram.css:189-196 — error banner: cream on red (3.01:1)
- src/styles/sections/world/bars-buttons.css:112 — color: var(--success) #347433 on near-black (3.58:1)
- src/styles/sections/world/hud-goals.css:25 — --hud-trial-red: #ed5f4b token

**Fact-check (partially confirmed).**

Keep the red-button finding: it is real. Light text on #ed5f4b is 3.0-3.3:1 on small 8-11.5px text, which affects Build, active Play, Publish, Publish nudge, Mint, Danger, the chat unread badge, and the .history-modal-error banners in wamp-o-gram, room-course and shared-modal-skin. The preferred fix is #18161c ink text, which keeps the look. If a darker red is wanted, reuse the existing #bd382b (5.58:1 with white) rather than inventing #c2392b.

Drop or downgrade the --success and --danger part. The sidebar-section-toggle is overridden to black on blue or yellow in editor mode and hidden in the dock shell. The background-upload error and the save-status accent both appear on cream (#fff3db or #fffaf0), where they pass at 6.07:1 and 5.17:1. Only the phone-editor save status (mobile-editor-save-status, which has color var(--text)) might still show the green accent on a dark panel; that needs a check in the browser. Also correct the quoted ratios: #5dc16b on #18161c is 7.95:1 and #ff7a5c is 7.0:1.

### F173: Reduced-motion is ignored except for scrolling comments; add a Comfort section (reduce motion and flashes, camera style)

- **Area:** Accessibility & inclusivity
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** Players who get motion sick or have vestibular or photosensitivity issues still get screen shake on every hit and stomp, a full-screen red flash plus a bigger shake when hurt in PvP, particle bursts and flickering lights. Their phone or PC 'reduce motion' setting is honored only by the browse-mode comment ticker. The calmer fixed-room camera exists, but it's hidden behind the 9 key, isn't remembered, and can't be reached on mobile.

**Technical detail.**

The only prefers-reduced-motion checks are roomComments.ts:887/999, which call a local prefersReducedMotion() that runs matchMedia on every check (roomComments.ts:1665-1671), and jam.css:931. Add `reduceMotion: 'system'|'on'|'off'` to GameSettings. Resolve it once in a tiny module that caches a MediaQueryList and listens for 'change', and export isReducedMotion(). Gate these: the shakeCamera host (OverworldPlayScene.ts:1595, used by combatController.ts:157/167/258) becomes a no-op; the stomp shake at OverworldPlayScene.ts:5212; in pvpLocalPresentationController.ts:79-81, replace the DOM red overlay plus camera flash plus shake with a heart-icon pulse; reward-sting and XP-receipt CSS keyframes via `body[data-reduce-motion] .reward-sting-layer *{animation:none}`; lighting flicker amplitude to 0 (lighting/controller.ts:448-455); and cap weather particle intensity (the Battery Saver visualDataProfile='reduced' path in performancePolicy.ts can be reused). Also add a persisted 'Camera: Follow / Room' choice to Settings. The toggle logic is already in cameraController.ts:111-121, but it's only bound to key 9 (OverworldPlayScene.ts:2684). The 'cameraToggle' touch action is consumed at OverworldPlayScene.ts:2308 but nothing ever presses it (portraitPlayControls.ts presses only jump/slash/shoot/stop/restart). Note on photosensitivity: the lightning hazard (190ms on / 1150ms off, hazardController.ts:20-21) and the PvP flash (single-shot, 1.8s invulnerability) stay under the 3-flashes/second threshold, so this is about comfort rather than an urgent seizure risk.

**Evidence.**

- src/scenes/overworld/roomComments.ts:999 — reduced motion gates only the browse 'danmaku' comment ticker
- src/scenes/overworld/roomComments.ts:1665-1671 — local, uncached matchMedia check
- src/scenes/overworld/pvpLocalPresentationController.ts:79-81 — DOM red flash overlay, a 150ms red camera flash and a shake on every hit
- src/styles/sections/modals/pvp.css:280-294 — the overlay animates from rgba(255,24,34,0.64)
- src/scenes/overworld/combatController.ts:157,167,258 — camera shake on enemy hit and kill
- src/scenes/OverworldPlayScene.ts:2308 — consumeTouchAction('cameraToggle') has no mobile control that triggers it

**Fact-check (partially confirmed).**

1) The 9 key (OverworldPlayScene.ts:2684, cameraController.ts:111-121) switches between 'follow' and 'inspect' (camera.ts:4). Inspect is a stationary camera that stops tracking the player. It is not the fixed-room camera, which is a per-room setting the builder chooses (cameraController.ts:40-44) and which the toggle cannot change (:112). The Settings choice should therefore be a player preference that turns on the existing syncRoomCamera room-snap behavior (e.g. isRoomCameraFixed() returns true when the preference is set), not a way to expose the inspect toggle. 2) OverworldPlayScene.ts:5212 is the PvP stomp only. Normal enemy stomps don't shake the screen. Shakes happen only when a gun or sword hit connects (combatController.ts:157/167/258, 40-50ms at 0.0015-0.002 intensity, about 1-3 px) and on PvP damage. 3) The full-screen red flash only appears in PvP, which players opt into. 4) jam.css:931 only sets scroll-behavior on the separate jam.html page, not the game. roomComments.ts:887 also turns off the comment-marker jiggle, so reduced motion covers the browse-mode comment ticker and the marker jiggle, not just the ticker. Neither is relevant to play-mode comfort.

### F172: Add an Assist mode (slower game speed, safe respawn) that plays as practice so leaderboards stay clean

- **Area:** Accessibility & inclusivity
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** User-made rooms are often brutal (the welcome screen itself says 'devilishly difficult'), and kids in the classroom flows or players with slower reactions just bounce off them. A Celeste-style Assist option (80% or 60% speed, and respawn at the last safe ground instead of the room start) would let far more people actually finish and enjoy rooms. Assisted attempts would never touch the leaderboards.

**Technical detail.**

A clean fairness hook already exists. Goal runs are either 'practice' or 'qualified' (goalRuns.ts:37, 195-197), and practice never submits. When any assist is on, force qualificationState='practice' and show an 'ASSIST' tag in the goal panel and mobile footer. Ranked verification (runs/verificationTrace.ts) is untouched because assisted runs never reach it. Game speed: on the OverworldPlayScene, set physics.world.timeScale = 1/speed (Arcade: >1 slows), time.timeScale = speed, anims.globalTimeScale = speed and tweens.timeScale = speed. Check hazards that use scene.time.now (hazardController.ts:248-255, lightning) so their cycles slow too. Safe respawn: sessionReset.ts:63 always calls respawnPlayerToCurrentRoom(). Under assist, respawn at the last grounded position recorded by the movement controller, at least 1 tile from any hazard, with brief invulnerability. Optional touch-only leniency: raise COYOTE_MS/JUMP_BUFFER_MS (OverworldPlayScene.ts:364-366, 80/100ms) to about 120/150ms when assist is on. Disable assists in PvP and Room Rush. Product decision for Jonathan: should an assisted clear count toward personal 'beaten' progress or Player XP (recommend yes for progress, no XP or leaderboard)?

**Evidence.**

- src/scenes/overworld/goalRuns.ts:195-197 — the existing practice/qualified split can carry an 'assisted' flag
- src/scenes/overworld/goalRuns.ts:1243-1248 — practice runs already have their own status message path
- src/scenes/overworld/sessionReset.ts:51-63 — every death respawns to the room start (respawnPlayerToCurrentRoom)
- src/scenes/OverworldPlayScene.ts:364-366 — COYOTE_MS=80 and JUMP_BUFFER_MS=100 are fixed for every device
- index.html:2270 — welcome copy says 'Some rooms are easy, some are devilishly difficult'

**Fact-check (partially confirmed).**

Use the existing 'local-only' path for assisted runs, not 'practice'. Forcing qualificationState='practice' would make every room impossible to finish: the timer, goals and checkpoints never register in practice (goalRuns.ts:270-275, 349-518), and the run turns ranked when the player touches spawn or respawns (goalRuns.ts:330-344; goalRunStartGate.ts:43-45).

Instead, add an `assisted` flag to GoalRunState and to the course run state:
- When assist is on, set leaderboardEligible=false so the run uses submissionState 'local-only' (goalRuns.ts:1039; courseRuns.ts:122).
- Make shouldPromptGuestClaimForLocalClear (goalRuns.ts:1023) return false for assisted runs, so the clear never becomes guest XP that can be claimed later (guestRunProgress.ts).
- Keep assisted clears out of difficulty and rating prompts.

For game speed, time.timeScale is not enough, because scene.time.now ignores it (Phaser Clock.js:360-367). Add a scaled `gameNowMs` that grows by delta*speed. Use it in the seven `getCurrentTime: () => this.time.now` closures in OverworldPlayScene.ts. Pass the scaled delta only to the gameplay updates: live objects, goal tick, movement and combat. Set physics.world.timeScale = 1/speed.

Safe respawn only needs a new respawn position under assist, in respawnPlayerToCurrentRoom (OverworldPlayScene.ts:4410). Record the last grounded position in the movement controller to use as that position. Turn assist off for PvP and Room Rush. Earning 'beaten' progress with assist would need a new server-side record type, so start with no progress and no XP for assisted clears.

### F177: Controls are hard-coded: no remapping, WASD breaks on AZERTY keyboards, and there's no Z/X layout

- **Area:** Accessibility & inclusivity
- **Type:** improvement · **impact:** low · **effort:** medium

**Summary.** Players can't change keys, so one-handed players and people using alternate keyboards are stuck with Arrows/WASD + Space + Q/E. French and Belgian (AZERTY) keyboards scramble WASD and put 'Slash' on the key they'd use for moving left. The Controls screen even says remapping 'can layer onto this later'.

**Technical detail.**

Keys are created directly from Phaser KeyCodes in setupGameplayKeys (OverworldPlayScene.ts:2673-2684), and movementController.ts:400-426 reads cursors/wasd/space directly. Phaser matches on event.keyCode, which follows the keyboard layout, so on AZERTY the physical W key reports 'Z' and Q sits where QWERTY A is. Implement a `keyBindings: Record<'left'|'right'|'up'|'down'|'jump'|'slash'|'shoot'|'camera'|'pause', string[]>` setting (default Arrows+WASD / Space+Up / Q / E). Build the Phaser keys from that map in setupGameplayKeys and read through a small `isActionDown(action)` / `justPressed(action)` layer that also merges touch (touchControls.ts) and gamepad. Add Z=jump, X=slash as default alternates (the classic platformer layout, and also what the mann.cool virtual controller sends by default). Render the Controls modal (index.html:2918-2930) from the same map with a 'Change' button per row. The ranked verification trace records abstract controls (moveX/moveY/jump in verificationTrace.ts:3), so remapping doesn't affect run verification.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:2673-2684 — fixed cursor keys, W/A/S/D, Q/E and NINE
- src/scenes/overworld/movementController.ts:400-426 — movement reads specific keys (cursors.left, wasd.A, cursors.space)
- index.html:2934 — 'Custom control remapping can layer onto this later…'
- src/runs/verificationTrace.ts:3 — the trace uses abstract controls 'moveX' | 'moveY' | 'jump', so it is binding-agnostic

**Fact-check (partially confirmed).**

The index.html note is at line 2933, not 2934. AZERTY players can still play fully with Arrows + Space + Q/E; only WASD is scrambled, and Q (AZERTY 'left') fires slash. WASD + Space + Q/E is already a left-hand one-handed layout, so the missing piece is a right-hand option (for example Z/X or ./, next to the arrows). Drop the mann.cool rationale: WAMP has no postMessage listener and is not embedded through the mann.cool controller. There is a cheaper partial fix than the full remap UI (which is medium effort): add Z/X as jump/slash alternates, and use navigator.keyboard.getLayoutMap(), or event.code with a small custom key handler, to treat physical WASD positions as movement. Keep the remap modal as a follow-up.

### F179: Checkpoint flags change only red to green, which colour-blind players can barely tell apart

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** In checkpoint rooms, a flag you haven't reached is red and a reached one is the same sprite in green. For the roughly 1 in 12 men with red-green colour blindness, both look beige and differ only slightly in brightness. Adding a shape cue (a checkmark or star on reached flags) fixes it.

**Technical detail.**

markerFlags.ts:37-43 maps checkpoint-pending to flag.png and checkpoint-reached to flag-green.png. The two sheets are pixel-identical except the cloth colour (#CB4D68 vs #56C478). In a deuteranopia simulation (Machado matrix) they come out as about (137,130,101) vs (182,171,125): both beige, separated only by lightness, on a 32px moving sprite. The finish flags use a checkered pattern and are fine. Fix: give the reached variant a distinct silhouette, either a new sheet with a white check or star on the cloth or a lowered/furled flag frame. Optionally pulse the next pending checkpoint in ordered sprints (goalRuns tracks nextCheckpointIndex). The HUD already shows 'N/M checkpoints' text (hudState.ts:464) and a 'Checkpoint N reached.' toast (goalRuns.ts:530), so counts are covered; the problem is spotting which flag in the room still matters.

**Evidence.**

- src/goals/markerFlags.ts:37-43 — checkpoint-pending is the red sheet, checkpoint-reached the green sheet
- public/assets/objects/flag.png vs flag-green.png — same 288x32 sheet, only the cloth colour differs (#CB4D68 vs #56C478)
- src/scenes/overworld/hudState.ts:464 — text progress exists ('N/M checkpoints'), but the in-world markers are colour-only

**Fact-check (partially confirmed).**

The checkpoint state change (sprite plus label text colour) is colour-only. Each flag is also labelled with its number ("1", "2", …; goalMarkers.ts:163/233), checkpoints count only in order (objectiveController.ts:285-292), and the HUD shows N/M. So a colour-blind player can already tell which flag is next; they just can't see reached vs pending at a glance. Under deuteranopia the two colours differ by ΔE ≈ 18 in lightness, which is noticeable, so "barely tell apart" overstates it. Under protanopia they are clearly distinct. Mostly dichromats (≈2% of men) are affected, not 1 in 12. The cheapest fix needs no new art: in goalMarkers.ts:163-165 and :233-235, change reached labels to "✓" (or "1✓") and/or dim reached flags with alpha ≈0.5 (the descriptor already supports `alpha`). A furled or checkmarked sprite sheet can come later. Pulsing the next pending flag is a reasonable optional addition.

### F180: Unlabeled form fields, '+'/'−' buttons and div-based palette items

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** Screen readers and voice-control users ('click Sign In email') can't find several fields: the email sign-in box, display-name box, Warp box and lighting/weather sliders have no label. Zoom and tempo buttons are announced as just 'plus' or 'hyphen', and the editor's object palette uses clickable boxes that a keyboard or voice command can't select.

**Technical detail.**

A parse of index.html finds 19 inputs with no <label>, aria-label or aria-labelledby, including line 184 #auth-email-input (placeholder only), 200 #auth-display-name-input, 1846 #world-jump-input, 999/1018 lighting ranges (visible text in .lighting-slider-label isn't linked), 1057 weather range, 918 #goal-type-select and 1960 #chat-input (placeholder only). Fix with aria-labelledby pointing at the existing visible labels, or aria-label. 14 buttons have names of only '-', '+', '16' or '32' (index.html:1215-1217 mobile editor zoom, 1512-1524 music octave/tempo/swing, 2016-2017 world zoom); add aria-label='Zoom out' and so on. The object palette builds `<div class='object-item' aria-label=…>` with a click listener but no role or tabindex (paletteController.ts:683-686, 729). Make it a <button type='button'> with aria-pressed for the active item. Chat: index.html:1956 #chat-messages should be role='log' (polite is implied) rather than a bare aria-live div.

**Evidence.**

- index.html:184 — <input id="auth-email-input" type="email" placeholder="you@example.com"> has no label
- index.html:1846 — #world-jump-input (Warp) has no label
- index.html:2016-2017 — world zoom buttons are named only '-' and '+'
- src/ui/setup/paletteController.ts:683-686 — object palette items are divs with aria-label but no role or tabindex
- src/ui/setup/paletteController.ts:729 — selection happens only on 'click' of that div

**Fact-check (partially confirmed).**

The code evidence is accurate: 19 unlabeled fields, 14 buttons named only by a symbol or number, and palette items that are divs with no role or tabindex at paletteController.ts:683-686 and 729. Corrections:
(a) The email, display-name and chat inputs fall back to their placeholder as an accessible name, so they are poorly labeled rather than unfindable. The fields with truly no name are #world-jump-input (index.html:1846), #mobile-world-jump-input (index.html:2052) and the lighting and weather range sliders (index.html:999, 1018, 1057).
(b) #goal-type-select, #lighting-mode-select and #weather-mode-select are display:none whenever the editor dock shell is active (dock-shell.css:1131-1135), and visible button grids replace them. Drop them as primary examples.
(c) The 16/32 sprite-size buttons (index.html:1587-1588) already have aria-pressed and a visible "Size" label. The chat log already has aria-live="polite". Both are nits, not defects.
(d) Also add: the palette's <img> has no alt text.
The highest-value fixes are naming the -/+ buttons ("Zoom out", "Zoom in", "Tempo down" and so on), labeling the Warp inputs and the sliders through aria-labelledby, and turning .object-item into a <button type="button"> with aria-pressed.

### F182: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F184: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F183: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F185: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F190: In-room chat bubbles skip sign-in and chat bans on the server

- **Area:** Trust & safety, moderation, ops & observability
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Only the game's own interface keeps guests and chat-banned players from talking in a room. The multiplayer server itself doesn't check either. Someone who connects directly can chat in rooms with no account, under any name they type (including 'jonathan'), even after being banned. Nothing is logged, so there's no evidence to act on.

**Technical detail.**

`/api/presence/identity-token` issues guest tokens with a caller-supplied displayName, up to 32 chars, with no filter (presence/routes.ts:88-100; identityToken.ts:81-98). `parseIdentity` keeps only channel/userId/displayName/avatarId and drops `source` (partykit/presenceServer.ts:800-816). `handleRoomChatSay` checks only the channel, play mode and a 1s rate limit before broadcasting (presenceServer.ts:837-876). The sign-in gate lives only in the client (scenes/overworld/roomChat.ts:226, 410-415). Fix: (1) add `source` and `chatBanned` claims to the identity token. The Worker already has `resolveChatModerationViewer` to compute the ban when issuing. (2) In handleRoomChatSay, drop messages when `source !== 'auth' || chatBanned`. (3) Have the server generate guest display names ('Guest 4aao') and stop accepting them from the request body. (4) Run the shared text filter (see the separate text-filter finding) on room-chat text. (5) Keep a 24h ring buffer of the last 200 room-chat lines per shard in PartyKit storage, so a future Report button can attach evidence.

**Evidence.**

- partykit/presenceServer.ts:837-876 — room chat broadcast with no auth-source or ban check
- partykit/presenceServer.ts:800-816 — identity parsing drops the token's `source`
- src/cloudflare/worker/presence/routes.ts:88-100 — guest tokens accept caller-chosen displayName
- src/scenes/overworld/roomChat.ts:410-415 — sign-in requirement enforced only by disabling the input client-side

**Fact-check (confirmed).**

1. **Chat bans are not enforced anywhere for in-room chat, not even in the game's interface.** The summary says the interface keeps banned players out. It doesn't: `openComposer` (src/scenes/overworld/roomChat.ts:220-243), `renderComposer` (roomChat.ts:410-415) and `RoomChatClient.send` (src/presence/roomChat.ts:166-170) check only `authenticated`, never `chatModeration.banned`. Only the global chat panel checks bans (src/ui/chat/panel.ts:304, 767). So a banned signed-in player can post room-chat bubbles through the normal UI, with no direct connection needed. The client fix is to also disable the composer when `getAuthDebugState().chatModeration.banned` is true.

2. **The name-impersonation point is overstated for chat.** Bubbles show only the message text, not the sender's name (createRenderedBubble, roomChat.ts:509-537). A bubble appears only when the sender also has a visible ghost with the same userId in that room (resolveBubbleAnchor, roomChat.ts:476-505). So an attacker has to publish presence too, which is easy with the same token. The 'jonathan' name would show up on the ghost and in presence lists. That comes from free-form guest presence names in general (also editable in localStorage, worldPresence.ts:840-860), not from chat specifically.

3. **Implementation note:** the token is checked only in `onConnect` (presenceServer.ts:197), and the socket stays open after the 5-minute token TTL. A ban added after someone connects therefore won't apply until they reconnect, unless the server re-checks or the Worker pushes a revoke.

### F188: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F191: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F049: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F189: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F192: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F194: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F193: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F196: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F134: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F127: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F197: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F061: Add an in-repo AGENTS.md: the agent guide was deleted and the rules are scattered across 78 KB of logs

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** 2026-07-13 code-health audit §1.7 ('rewrite CLAUDE.md around the actual architecture'): the file was deleted instead of rewritten

**Summary.** Every AI session starts this ~283k-line repo without a map. The old CLAUDE.md was deleted in July and never replaced. The rules that keep agents out of trouble are spread across several docs and two very large log files: which checks to run, never to work from the stale local checkout, safety vs production deploys, the DOM contract, and how scenes talk to the UI. A short AGENTS.md would prevent many repeat mistakes and wasted sessions.

**Technical detail.**

Commit 53fe55cc ('Clean up public repo presentation', 2026-07-07) deleted CLAUDE.md. Nothing replaced it: there is no AGENTS.md or CLAUDE.md anywhere in the repo, only one Cursor rule about tile localIndex. docs/development/architecture.md is 63 lines and stale. It says OverworldPlayScene 'owns browse/play mode, chunk streaming, room traversal, goals, runs, comments, presence', but that scene is now a composition root over 43 controllers in src/scenes/overworld/, and the doc never mentions sceneBridge, editorState, editRuntime, or the backdrop-ignore protocol. Required gates exist only in docs/development/refactor-plan-2026-08-13.md:88-94 (npm run check + smoke:dom-contract + git diff --check), and `npm run check` itself does not run the DOM contract. The owner's agent memory records that the local main checkout lagged 304 commits. Agents are told to read progress.md (78 KB, an append-only release log) and feature-ledger.md (57 KB of paragraph-length table rows).

Fix: write a ≤150-line AGENTS.md, plus a CLAUDE.md that just says 'see AGENTS.md'. Include:
(1) Workflow: always `git fetch` and branch from origin/main, never the root checkout.
(2) Commands: npm run check, smoke:dom-contract, smoke:worker-safety, and how to deploy to safety vs prod.
(3) Module map: scenes → controllers, editRuntime shared by both editors, Worker route groups, PartyKit modules.
(4) Invariants and gotchas: new display objects must be registered for the backdrop camera; sceneBridge methods are optional and called with ?.(); IDs touched in index.html must be added to the contract; editorState is a global with no change events; tile localIndex is 0-based.
(5) Glossary: 'Course*' in code mostly means the expanded-room editor; 'Composer' is the world-footprint tool.
(6) Where new code goes: live-object behaviorRegistry, typed events.
Also archive progress.md history to docs/history/ and keep only current state plus open threads (<10 KB). Add `smoke:dom-contract` to `npm run check`.

**Evidence.**

- git show --stat 53fe55cc — CLAUDE.md (75 lines) deleted 2026-07-07; no AGENTS.md/CLAUDE.md exists in the tree
- docs/development/architecture.md:11 — describes OverworldPlayScene as owning streaming/goals/comments/presence; no mention of src/scenes/overworld controllers, sceneBridge or editorState
- docs/development/refactor-plan-2026-08-13.md:88-94 — the only place the required gates (check + smoke:dom-contract + diff --check) are written down
- package.json:7 — `check` = lint+test+typecheck+world-tiles types+build; DOM contract and worker-safety only run in .github/workflows/quality.yml
- wc -c progress.md feature-ledger.md — 78,498 and 56,694 bytes of append-only release logs
- docs/2026-07-13-code-health-and-performance-recommendations.md:78-82 — earlier audit asked for a CLAUDE.md rewrite

**Fact-check (confirmed).**

These are minor factual fixes; the core claim is unchanged.

(a) The `check` script is at package.json:8, not line 7.

(b) The "previously recommended" story has the order wrong. The July 13 audit (§1.7, file added in commit d5a903ca on Jul 17) came after the July 7 deletion in 53fe55cc. It was apparently written against an older checkout, so "deleted instead of rewritten" is inaccurate. The better citation is docs/2026-06-10-repo-improvement-plan.md §5.1 (lines 376-388, 437). That plan explicitly recommended making AGENTS.md canonical with CLAUDE.md pointing to it, before the deletion. It was never done, and the July 13 audit repeated it.

(c) DOM contract and worker-safety are not enforced only by docs. They already run in CI (.github/workflows/quality.yml). The gap is only local `npm run check`, before pushing.

(d) Nothing in the repo tells agents to read progress.md. That convention comes from the parent games/AGENTS.md and the web-game skill. Also, progress.md is listed in .gitignore yet force-tracked, which is a confusing signal the new AGENTS.md should resolve: either un-ignore it or keep it out of the repo.

(e) "43 controllers" holds if you count the scene's controller/coordinator fields: 43 private fields and about 44 constructions, while only 17 module filenames contain "Controller".

(f) Also remove the stray tracked .cursor/debug-843bc4.log while doing this.

### F064: Core gameplay and money paths have zero unit tests: goal runs, the auth client, and room minting

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** The suite is big (1,904 passing tests), but the code that decides whether a player's run counts has no tests: time-ups, collectibles, checkpoints, survival and NPC quests. The sign-in client and on-chain room-mint confirmation are untested too. These are the places where an agent's 'small fix' could quietly break leaderboards, XP or ownership.

**Technical detail.**

src/scenes/overworld/goalRuns.ts (1,344 lines) is Phaser-free. Its OverworldGoalRunController drives tick() time-up and survival completion (lines 270-309), recordDeath (311), recordCollectibleCollected (376-425), enemy and NPC events, checkpoints (514), markCompleted and markFailed for all 7 goal types. No *.test.ts imports it. src/auth/client.ts (1,480 lines, 42 module-level `let`s, wallet + magic link + email code + display name) has no tests. The Worker mint routes and service (src/cloudflare/worker/mint/routes.ts 325 lines and service.ts 609 lines: tx verification, owner check, persistRoomMintState) have no direct tests. vitest.config.ts:9-13 limits coverage to 3 files, so `npm run test:coverage` cannot show these gaps.

Fix, cheapest first:
(1) A goalRuns characterization table test, one `describe` per goal type. Cover qualified vs practice, time limit, collect_race exhaustion, survival duration, npc give/protect, death count and abandon.
(2) Mint confirm tests with a stubbed chain reader: wrong owner → 403, non-claimer → 403, happy path persists.
(3) Extract auth state transitions (session refresh, email-code verify, link-email) from DOM code into a pure module and test it.
(4) Widen coverage.include to src/** and record a baseline in AGENTS.md.

**Evidence.**

- src/scenes/overworld/goalRuns.ts:124-766 — OverworldGoalRunController run state machine; no Phaser import; no test file imports goalRuns
- src/scenes/overworld/goalRuns.ts:270-309 — tick() resolves collect_race time-up, time limits, survival and NPC protect completion
- src/auth/client.ts:125-172 — 42 module-level mutable variables; no test imports auth/client
- src/cloudflare/worker/mint/routes.ts:101-141 — handleRoomMintConfirm (wallet ownership check + persist) with no direct tests
- vitest.config.ts:9-13 — coverage.include lists only runs/points.ts, progression/shared.ts, runs/model.ts
- npx vitest run — 256 files / 1,904 tests pass in 12.6 s, so adding tests is cheap

**Fact-check (partially confirmed).**

Confirmed: goalRuns.ts, the browser auth client and the mint routes/service have no unit tests, and coverage only covers 3 files. Three corrections:
(a) The client goal controller is not the final judge of whether a run counts. The server's normalizeFinalizedRunBody (src/cloudflare/worker/runs/routes.ts:934-1012) rejects rule-breaking completions for every goal type except reach_exit with a 409, and only its collect-target branch is tested. Client regressions would mostly cause rejected or stuck runs, not silent leaderboard damage.
(b) Server-side auth already has tests (worker/auth/routes.code.test.ts, store.test.ts). Only src/auth/client.ts is untested, and its 42 `let`s are at lines 125-178.
(c) A bigger integrity gap goes unmentioned: the trace verifier verifyRoomRunTrace/verifyCourseRunTrace in runs/verification.ts (1,146 lines) is only ever tested as a mock (finalizationVerification.contract.test.ts:12). Add a table test of normalizeFinalizedRunBody per goal type and a real trace-verifier test next to the goalRuns tests.
The auth extraction step is medium effort, not small.

### F062: Scene↔UI bridge is unchecked: 135 optional methods, an unchecked `as T` cast, and scenes never `implements` it

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** defect · **impact:** medium · **effort:** medium

**Summary.** Buttons in the HTML UI call into the game scenes through a list of 'maybe this method exists' calls. If an agent renames or removes a scene method, the button silently does nothing. Typecheck, lint and tests all still pass, so nobody notices until a player reports a dead button.

**Technical detail.**

How it works now: src/ui/setup/sceneBridge.ts declares EditorSceneBridge and OverworldSceneBridge with about 135 members, all optional (`foo?: () => void`). getScene<T>() at line 278 returns `game.scene.getScene(key) as T`, and UI code calls `scene.shiftRoomMusicTempo?.(5)` (musicControls.ts:150-216, 52 such call sites in src/ui). EditorScene (EditorScene.ts:148), CourseEditorScene (CourseEditorScene.ts:202) and OverworldPlayScene (OverworldPlayScene.ts:350) do not declare `implements`. Only CourseComposerScene does (CourseComposerScene.ts:83).

Drift is already visible. A scratch type probe (keyof bridge minus keyof scene) showed that `clearAllTiles` and `clearCurrentLayer` (sceneBridge.ts:101-102) exist as public methods on neither editor scene. Separately, to satisfy this duck-typed surface, EditorScene has 37 and CourseEditorScene has 35 one-line `this.musicWorkflow.x()` delegates.

Fix, in order:
(1) Add `implements EditorSceneBridge` / `implements OverworldSceneBridge` to the scene classes. This is free and catches signature drift.
(2) Split the bridge into required capability interfaces (EditorPersistenceBridge, EditorMusicBridge, CourseGoalBridge…). Each scene implements the ones it supports, and getActiveEditorScene returns typed capabilities instead of `?.` calls.
(3) Replace the ~72 music delegates with one `getMusicWorkflow(): EditorMusicWorkflow` accessor.
(4) Delete dead members such as clearAllTiles/clearCurrentLayer.

**Evidence.**

- src/ui/setup/sceneBridge.ts:71 — `export interface EditorSceneBridge {` with ~135 optional members across the file
- src/ui/setup/sceneBridge.ts:278-284 — getScene<T> returns `game.scene.getScene(key) as T` (unchecked cast)
- src/ui/setup/musicControls.ts:150-216 — UI calls `scene.toggleMusicMode?.()`, `scene.shiftRoomMusicTempo?.(-5)` etc.; a rename becomes a silent no-op
- src/scenes/EditorScene.ts:148 / src/scenes/CourseEditorScene.ts:202 / src/scenes/OverworldPlayScene.ts:350 — no `implements`; contrast src/scenes/CourseComposerScene.ts:83 which does
- src/ui/setup/sceneBridge.ts:101-102 — clearCurrentLayer/clearAllTiles declared on the bridge; neither scene exposes them publicly (scratch tsc probe) and no UI calls them
- grep `this.musicWorkflow.` one-liners — 37 in EditorScene.ts, 35 in CourseEditorScene.ts

**Fact-check (partially confirmed, partially confirmed, partially confirmed).**

Kind should be "improvement" (a latent risk), not "defect". There is no broken button today. clearAllTiles and clearCurrentLayer are dead bridge declarations that no UI code calls. Every member the scenes share with the bridge is currently type-compatible: assigning each scene to its bridge type compiles cleanly.

Corrected counts:
- EditorSceneBridge has 76 optional members and OverworldSceneBridge has 36 (112 together). Adding CourseComposerSceneBridge's 17 gives 129.
- About 57 `scene.x?.()` call sites in src/ui.
- About 30 of EditorScene's musicWorkflow delegates are bridge-facing. The rest are internal.

Fix-order caveat: adding `implements EditorSceneBridge` / `OverworldSceneBridge` costs nothing and compiles today. Because every member is optional, though, it only catches signature changes, not renames or removals. Catching the silent dead-button rename needs step (2): required members, or split capability interfaces with required methods, so a removed scene method breaks tsc. A cheaper interim guard is a compile-time test asserting `Required<Pick<EditorSceneBridge, ...>>` against EditorScene for the members the UI actually calls.

The bridge interfaces have 112 optional members (76 Editor + 36 Overworld), or 129 including the composer bridge. That is not "about 135".

Fix step (1) should be reframed. Because every member is optional, `implements` only catches a changed signature on a method that keeps its name. It does not catch a renamed or removed method, which is the dead-button failure the summary describes. All three scenes already type-check as their bridges today, so (1) would catch nothing right now.

The real fix is step (2): make members required per capability, or add a compile-time check that the scene class supplies every member the bridge declares. A cheap version of that check is a type test asserting that `Required<Pick<EditorSceneBridge, K>>` is assignable from EditorScene for the keys each scene must support.

About 30 of the music delegates in each scene serve the bridge. The rest (pointer handlers, renderUi, isActive, preview sync) are internal.

clearAllTiles and clearCurrentLayer are confirmed dead bridge members. The real path is the toolController/editRuntime path at EditorScene.ts:918-919 and 1435-1439.

This is a latent risk: no dead button exists today.

Corrected facts and fix:
- No bridge member called by the UI is missing from its scene today. All three scenes already satisfy their bridge types.
- There are about 30 dead bridge members, not 2, because core editor buttons moved to the typed, required-callback uiBridge (src/scenes/editor/uiBridge/model.ts, wired at EditorScene.ts:897-935).
- Fix (1), `implements`, does not catch renames or removals while the members are optional.

Cheapest effective fix (small):
(i) Delete the ~30 unused members, and the music delegates that only serve them.
(ii) Add a compile-time key-existence assertion so typecheck fails if any bridge key is missing from the scenes that serve it, e.g. `const _e: Exclude<keyof EditorSceneBridge, keyof EditorScene | keyof CourseEditorScene> extends never ? true : false = true;`, and the same for Overworld and CourseComposer.
(iii) Then add `implements` to catch signature drift.

The capability-interface split and replacing the delegates with a single getMusicWorkflow() accessor are worthwhile, but they are medium effort, not small. Adjusted impact: low to medium (a hazard to future agent edits on the music, history, Wamp-O-Gram and overworld HUD buttons, with no current player-facing breakage).

### F068: Backdrop-camera bookkeeping is half migrated: every new sprite still has to be registered by hand

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** 2026-07-13 audit §2.4 'Replace the camera ignore-list bookkeeping with display Layers' and roadmap Wave 4; layers exist but the collect/register protocol remains

**Summary.** To keep the starry background from drawing the game world twice, every system that creates sprites must remember to add them to a hand-maintained list. An agent adding a new effect, enemy or overlay who doesn't know this rule creates a rendering bug. The fix the team already started (Phaser display layers) was only half finished.

**Technical detail.**

src/scenes/overworld/backdropController.ts:55-56 creates backdropDisplayLayer and worldDisplayLayer, but syncIgnores() (105-121) still does `worldDisplayLayer.add(this.options.collectWorldObjects())` on every sync. collectWorldObjects is OverworldPlayScene.collectBackdropIgnoredObjects (2718-2766). It walks 19 controllers' getBackdropIgnoredObjects() plus every loaded room's backgrounds, live objects, helpers and edge walls into a fresh array. There are 42 getBackdropIgnoredObjects/BackdropIgnored references and 23 syncBackdropCameraIgnores() call sites in the scene, plus 5 elsewhere. That is both hidden coupling (a forgotten registration means a visual bug) and O(world) allocation on each sync.

Fix: expose `ctx.addWorldObject(obj)`, ideally through the runtime context from the composition-root finding, which adds to worldDisplayLayer at creation time. Convert controllers one at a time, keeping collect() as a fallback until the list is empty. Then delete the protocol and the 23 sync calls. Add a test asserting that after creating a full room, every child is in worldDisplayLayer.

**Evidence.**

- src/scenes/overworld/backdropController.ts:105-121 — syncIgnores re-adds `collectWorldObjects()` into worldDisplayLayer each call
- src/scenes/OverworldPlayScene.ts:2718-2766 — collectBackdropIgnoredObjects builds an array from 19 controllers plus every loaded room's sprites/helpers/walls
- grep — 42 getBackdropIgnoredObjects/BackdropIgnored references; 23 syncBackdropCameraIgnores() calls in OverworldPlayScene.ts

**Fact-check (confirmed).**

Only small count corrections; the core is right.
- OverworldPlayScene.ts has 22 call sites of syncBackdropCameraIgnores(). The 23rd grep hit is the method definition at line 2714.
- collectBackdropIgnoredObjects calls 17 controller getters directly. There are 19 getBackdropIgnoredObjects implementations if you count indirect ones such as the worldTiles controller and phaserLayer.
- The sync calls outside the scene are 3 in production code (playerLifecycle.ts:105,133 and runtimeController.ts:282), not 5. The other hits are in a test file.
- Strengthen the claim: there are existing unregistered objects that live outside the world layer today.
  - The brick-break sprite at specialTiles.ts:987.
  - Cannon bullets from hazardController.ts:377, pushed at line 556 with no sync.
- Note the extra performance cost: Phaser Layer.add dedupes with an indexOf per item, so each sync is O(items × layer size), not just O(world).
- The 52 onDisplayObjectsChanged-style callback references should also go when the protocol is removed.

### F070: Adding a goal type touches ~30 files: make goal types a typed registry like live objects

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** New goal types (king of the hill, escort, coin-rush and so on) are one of the most natural ways to grow WAMP. Today the knowledge of each goal type is spread over about 30 files across the game, editor, server, scoring and minting, with switch statements that won't complain if one is missed. A single goal-type registry would make new goals much cheaper and safer for agents to build.

**Technical detail.**

ROOM_GOAL_TYPES (src/goals/roomGoals.ts:3-13) has 7 types. The literal 'checkpoint_sprint' appears in 30 non-test files, including:
- goalRuns.ts, objectiveController.ts, goalMarkers.ts, hudState.ts, courseRuns.ts
- editor goalDocument.ts, viewModel.ts, playMode.ts
- Worker runs/routes.ts, runs/verification.ts, runs/points.ts, rooms/commandCore.ts, courses/store.ts, profiles/store.ts
- mint/roomMetadata.ts, runs/scoring.ts, courses/scoring.ts
Several switches end in `default: break` or `return markers`, so the type checker gives no help: goalMarkers.ts:143, objectiveController.ts:133, goalDocument.ts:193, courses/store.ts:678.

Fix: introduce `GOAL_TYPE_DEFINITIONS: Record<RoomGoalType, GoalTypeDefinition>` in src/goals/. It holds label, normalize/validate, default config, marker builder, objective per-frame check, run-event reducers used by goalRuns, verification-trace expectations, and scoring weight. The `Record<RoomGoalType,…>` type forces every type to be handled. Move one concern at a time (labels/validation first, then markers/objectives, then server verification), mirroring the existing liveObjects/behaviorRegistry.ts. Pair with the goalRuns characterization tests first.

**Evidence.**

- src/goals/roomGoals.ts:3-13 — ROOM_GOAL_TYPES (7 types)
- grep -rl "'checkpoint_sprint'" src (non-test) — 30 files spanning client, editor, Worker, scoring and mint metadata
- src/scenes/overworld/objectiveController.ts:133-159 — switch over goal.type handles 3 types, `default: break`
- src/scenes/overworld/goalMarkers.ts:143 — switch over goal.type not exhaustive (ESLint probe)
- src/scenes/overworld/liveObjects/behaviorRegistry.ts — existing registry pattern to mirror

**Fact-check (partially confirmed).**

About 30 files is accurate only when room goals and the separate course / expanded-room goal system (COURSE_GOAL_TYPES, 5 types, src/courses/model.ts:9) are counted together. A room-only goal type touches about 19 non-test files; npc_quest's commit touched about 20 goal-related files. The type checker already enforces coverage in createDefaultRoomGoal, cloneRoomGoal, computeRunScore and getLeaderboardRankingMode. Partial registries already exist: ROOM_GOAL_LABELS, the browseOverlays badge maps, and authoringCatalog's `satisfies Record<RoomGoalType, …>`. The cited `default:` branches are mostly deliberate, because event-driven goals need no markers or per-frame checks.

The real silent hazard is src/cloudflare/worker/runs/verification.ts:882. Its switch has no default and falls through to success, so a new type would be accepted without verification.

Fix order:
(a) Make the switches type-safe cheaply: add an `assertNever` default (or the @typescript-eslint switch-exhaustiveness-check rule), starting with verification.ts, goalRuns, hudState and roomMetadata.
(b) Replace optional behaviour with Record-keyed tables that state "none" explicitly (e.g. `markers: null`).
(c) Use three registries instead of one: shared data, normalize, validate and scoring in src/goals (safe for the Worker); a client runtime registry for markers, objectives and HUD; and a Worker verification table. Each is typed `Record<RoomGoalType, …>`.
(d) Decide whether course goals become a filtered view of the room registry.

### F066: OverworldPlayScene's constructor is 1,392 lines of closure wiring, and the RuntimeContext built to fix it is used by no controller

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** medium · **effort:** large
- **Flagged before:** 2026-07-13 audit §1.1 (shared OverworldRuntimeContext passed to every controller) and performance-code-health-roadmap Wave 5 'Introduce a shared overworld runtime context': the context exists but is not consumed

**Summary.** The main game scene is still the biggest file (6,561 lines). Over a fifth of it is one constructor that hand-wires 43 helper systems, each handed its own bag of 'get the player / get the mode' functions. Any change to a game system means an agent must read and edit this wall of wiring, which is slow and error-prone. worldStreaming.ts (6,182 lines) has a clear next split as well.

**Technical detail.**

OverworldPlayScene.ts:590-1981 is the constructor and instantiates 43 controllers. The closure getters are re-plumbed repeatedly: getMode 22×, getSelectedCoordinates 14×, getCurrentRoomCoordinates 14×, getPlayer 10×, getPlayerBody 10×. src/scenes/overworld/runtimeContext.ts was added for this purpose, but it is only constructed at OverworldPlayScene.ts:598 and read inside the scene. No controller receives it. update() (2226-2459) hand-numbers 20 profiler slots (`controllerProfileSlot === 0..19`, `% 20` at line 2240) with 52 begin/end calls interleaved with logic, so adding a per-frame system means editing magic numbers.

Seams:
(1) Extend OverworldRuntimeContext with the stable refs: player, playerBody, loadedFullRooms, camera mode, coordinates. Pass it to controllers instead of closure bags, converting one controller per PR.
(2) Move wiring into src/scenes/overworld/composition/{world,player,pvp,roomRush,social,ui}.ts. Each exports `wireX(scene, ctx)`, so the constructor becomes ~60 lines.
(3) Replace the slot plumbing with a declarative `FRAME_STAGES: {label, run}[]` loop that does the round-robin profiling generically.
(4) worldStreaming.ts: 50 fullRoom/background methods total ~1,968 lines (ensureFullRoom 201, commitPreparedFullRoom 113, createRoomBackground 139, cancelPendingFullRoomTeardown 120). T11 already moved the lifecycle state out, so the next seam is a FullRoomPresenter that owns the Phaser create/destroy operations. The façade keeps scheduling and selection.

**Evidence.**

- src/scenes/OverworldPlayScene.ts:590-1981 — constructor spans 1,392 lines and instantiates 43 controllers (lines 592-2158)
- src/scenes/OverworldPlayScene.ts:598 — `this.runtimeContext = new OverworldRuntimeContext({...})`; grep shows runtimeContext.ts imported only by the scene
- src/scenes/overworld/runtimeContext.ts:20-33 — context exposes only mode/camera/coords/flags, not player or loaded rooms
- src/scenes/OverworldPlayScene.ts:2236-2240 — round-robin `controllerProfileSlot` with `% 20`; slots 11-13 reused in two branches
- src/scenes/overworld/worldStreaming.ts:364-420 — single class with ~143 fields; fullRoom/background methods ≈1,968 lines

**Fact-check (partially confirmed).**

1. worldStreaming.ts has about 70 class property declarations, not about 143. The 50 fullRoom/background methods total about 1,905 lines, not 1,968.
2. One controller does use part of the context: roomAudioController gets `runtimeContext.mode.get` at OverworldPlayScene.ts:638. No controller receives the context object itself.
3. Slots 11-13 are used twice on purpose: the pairs are in branches that never run together (no player vs. player). This is a maintainability issue, not a profiling bug.
4. The constructor is lines 589-1980. The rest of the claim is accurate: 1,392 lines, 43 controllers, getter counts of 22 (excluding the context's own getMode)/14/14/10/10, `% 20` at line 2240, and 52 profiler begin/end calls.
5. Adjusted ratings: impact medium. Effort large for all four proposed changes; small for the profiler loop alone; medium for extending the context and moving a few controllers onto it.

### F072: Make the DOM contract automatic: 575 IDs are used from code but only 159 are checked

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** The main page's HTML is a single 3,072-line file with 786 element IDs that code looks up by name. If an agent renames or deletes one, the feature quietly stops working, because the code is written to ignore missing elements. The existing safety check only covers about a quarter of the IDs the code actually uses, and it could cover all of them automatically.

**Technical detail.**

scripts/smoke_dom_contract.mjs:17+ lists 159 required IDs by hand ('DOM contract smoke passed: 786 IDs found, 159 required IDs checked'). Client code makes 849 literal getElementById calls across 67 files, covering 575 unique index.html IDs. All of them are typed `| null` and guarded, so missing markup no-ops silently. A scan of literal getElementById ids against all root HTML files found 3 dangling references:
- profileModal.ts:239/241 still query profile-modal-meta and profile-modal-title, removed in commit 10ab17a1.
- musicWorkflow.ts:835 queries 'music-summary', which is styled in CSS but absent from HTML.
Because the drift is this small, the check can become a hard gate today.

Fix:
(1) Extend smoke_dom_contract.mjs to collect every literal `getElementById('…')` and `querySelector('#…')` id in src (excluding dynamically created ids, detected via `.id = '…'` and template `id="…"`). Assert each exists in its entry HTML, keep the hand list only for structural assertions, and delete the 3 dead lookups.
(2) Follow-up: split index.html into per-feature partials (24 modals, 481 buttons) with a ~20-line transformIndexHtml include plugin, co-located with each controller. Agents then edit a 100-line partial instead of a 3k-line file.

**Evidence.**

- node scripts/smoke_dom_contract.mjs — 'DOM contract smoke passed: 786 IDs found, 159 required IDs checked.'
- scratch scan — 849 literal getElementById calls in 67 non-test files; 575 unique index.html IDs referenced
- src/ui/setup/profileModal.ts:239,241 — queries profile-modal-meta / profile-modal-title, removed from index.html in 10ab17a1
- src/scenes/editor/musicWorkflow.ts:835 — `document.getElementById('music-summary')`; no such id in any HTML entry
- wc -l index.html — 3,072 lines; 786 ids; 24 *-modal containers; 481 <button>

**Fact-check (partially confirmed).**

Corrected facts: there are 827 literal getElementById calls in 61 non-test src files, not 849 in 67. The 575 unique index.html IDs and the 3 dead lookups are correct.

The proposed scan (literal getElementById plus querySelector('#…')) would miss the editor's `byId(doc, '…')` wrapper (src/scenes/editor/uiBridge/elements.ts:174, 146 calls, 122 index.html IDs not found by the literal scan). About 697 index.html IDs are used from code and about 548 are unchecked, not 575 and about 416.

There is a 4th dead lookup: elements.ts:272 `background-upload-card`, bound at uiBridge.ts:1079. It is harmless because `background-upload-button` gets the same handler.

None of the dead lookups causes a bug players can see; all are leftover code. The smoke already runs in CI (.github/workflows/quality.yml:24), so the fix should also scan the `byId(` wrapper (or any `(doc, 'literal')` id helper) and delete all 4 dead lookups.

Part 2, splitting index.html into partials, is medium effort. The smoke's dock-order, marker-popover and bootstrap-order checks run on the raw index.html text and would have to move to the assembled HTML.

### F067: Lint has exactly one rule: turn on the cheap ones that catch agent mistakes and add a file-size ratchet

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** low · **effort:** small
- **Flagged before:** 2026-07-13 audit §1.6 recommended typescript-eslint 'recommended' rules; only no-floating-promises was adopted. refactor-performance-closeout T17 left Knip report-only

**Summary.** Linting currently checks a single thing, forgotten awaits. A few more rules would flag real classes of agent mistakes at no runtime cost: async click handlers that swallow errors, and switch statements that silently ignore new goal or tile types. A size limit would also stop the giant files from growing further.

**Technical detail.**

eslint.config.js:30-32 enables only '@typescript-eslint/no-floating-promises'. A scratch config run over src+partykit (no repo changes) found:
- no-misused-promises: 15. Async handlers passed to addEventListener in historyModal.ts:115-125, guestBuilderClaimModal.ts:114/127, sceneCommands.ts:354/366, analytics/replay/recorder.ts:176/189.
- switch-exhaustiveness-check: 22. Includes goalMarkers.ts:143, objectiveController.ts:133, goalDocument.ts:193, specialTiles.ts:449/482, courses/store.ts:678, touchControls.ts:43.
- no-non-null-assertion: 663. no-unnecessary-type-assertion: 519.
- 16 files over 1,500 non-blank lines.
- no-explicit-any: 0.
A TS probe with noFallthroughCasesInSwitch + noImplicitReturns yields 0 errors, and noImplicitOverride only 8 (TS4114).

Fix:
(1) Enable no-misused-promises (checksVoidReturn) and switch-exhaustiveness-check (requireDefaultForNonUnion off) as errors, fixing ~37 sites.
(2) Add `max-lines: ['error', {max: 1500}]` with a per-file override list of today's 16 offenders, each pinned to its current length, so files can only shrink.
(3) Add noFallthroughCasesInSwitch, noImplicitReturns and noImplicitOverride to tsconfig.
(4) Knip: apply its 47 'redundant entry' hints. The report now lists 478 unused exports / 256 types (the Aug 13 closeout recorded 133 / 83), so consider `ignoreExportsUsedInFile: true` and gating on unused files only (currently 0).

**Evidence.**

- eslint.config.js:30-32 — rules: only `'@typescript-eslint/no-floating-promises': 'error'`
- scratch ESLint probe — no-misused-promises 15, switch-exhaustiveness-check 22, no-non-null-assertion 663, no-unnecessary-type-assertion 519, max-lines(1500) 16 files, no-explicit-any 0
- src/ui/setup/historyModal.ts:115-125 — async click handlers registered as void listeners (no-misused-promises)
- src/scenes/overworld/goalMarkers.ts:143 — switch over goal.type missing collect_target/collect_race/defeat_all/survival with no exhaustive guard
- tsconfig.json — strict + noUnused*, but no noFallthroughCasesInSwitch/noImplicitReturns/noImplicitOverride (probe: 0/0/8 errors)
- knip --no-exit-code — 0 unused files, 478 unused exports, 256 unused types, 47 configuration hints; docs/development/refactor-performance-closeout-2026-08-13.md:73-75 recorded 133/83

**Fact-check (partially confirmed).**

1. switch-exhaustiveness-check: 20 of the 22 flagged switches already have a `default:` branch, so they don't silently ignore new cases by accident. The evidence that goalMarkers.ts:143 has "no exhaustive guard" is wrong: it ends with `default: return markers;`. Only 2 switches have no default (editorDockShell.ts:280/306, missing `undefined`). Pitch this rule as "make agents revisit every switch when adding a goal or tile type," and accept that fixing it means listing the remaining types explicitly at about 20 sites. Do not present it as fixing existing bugs.
2. no-misused-promises: configure it with checksConditionals:false (or inline disables). The sfx.ts:642 and worldTiles/controller.ts:1862 hits check on purpose whether a promise exists. One of the 15 hits is in a test file. About 12 production sites need fixing. One is a real latent issue: historyModal.ts:63-85 needs try/finally around refreshMintMetadata() so metadataRefreshInFlight is always reset.
3. max-lines: 18 files exceed 1,500 non-blank lines, not 16. Three are barely over: autotiling/solver.ts 1503, movementController.ts 1503, roomComments.ts 1507. The override list needs 18 entries.
4. Knip: the 47 hints are 45 'redundant entry pattern' hints plus 2 'Remove from ignoreBinaries' hints (python3, tsx). The closeout figure is at line 74.
5. The tsc probe numbers (0 / 0 / 8×TS4114) and the other lint counts are confirmed.

### F069: Global editorState and string events: 136 writes from 11 files with no change signal, plus orphaned events

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** low · **effort:** medium
- **Flagged before:** 2026-07-13 audit §1.5 'one src/events.ts declaring every cross-boundary event name and its payload type' and roadmap Wave 5 'centralize typed cross-boundary events': only an untyped helper landed

**Summary.** Editor settings live in one big shared object that 11 different files change directly, with nothing announcing the change. Each change site has to remember which panels to refresh, a common cause of 'the button didn't update' bugs. Some event names are already orphaned: there are listeners nobody triggers and triggers nobody hears.

**Technical detail.**

src/config/editorState.ts:94 exports a mutable 48-field `editorState`. It is written 136 times from 11 modules: uiBridge.ts 35, EditorScene 22, CourseEditorScene 19, paletteController 16, customSpriteEditor 10, editRuntime 10, and others.

Cross-boundary refresh relies on ad-hoc window events, which are already drifting:
- controllers.ts:219-225 listens for 'tileset-changed' and 'tile-selected', but nothing in src dispatches either.
- exploreQueueEvents.ts:15-19 dispatches EXPLORE_QUEUE_START_EVENT, which has no listener (superseded by requestRoomSequenceStart).
- src/events/typedEvent.ts:1-21 takes `type: string` with an unconstrained generic, so payloads aren't checked. It is used by only 4 files, and there are 50 `as EventListener` casts.

The repo already has the right pattern in DevicePerformanceModeStore (devicePerformanceMode.ts:40-62, set + subscribe) and subscribeGameSettings.

Fix:
(1) Wrap editorState in a store: `getEditorState(): Readonly<EditorState>`, `updateEditorState(patch)`, `subscribeEditorState(fn)`. Export only the readonly view so TS forces writes through the setter, then delete manual renderUi/refresh calls where a subscription covers them.
(2) Add `interface WampEventMap {…}` and typed `emit<K>`/`on<K>` helpers keyed by it, and migrate the 35 *_EVENT constants.
(3) Delete the orphaned listeners and dispatches.

**Evidence.**

- src/config/editorState.ts:94 — `export const editorState: EditorState = {` (48 mutable fields, no subscribe)
- grep `editorState.x =` — 136 writes across 11 modules (uiBridge.ts 35, EditorScene.ts 22, CourseEditorScene.ts 19, paletteController.ts 16…)
- src/ui/setup/controllers.ts:219-225 — listeners for 'tileset-changed' / 'tile-selected'; no dispatcher exists anywhere in src
- src/ui/setup/exploreQueueEvents.ts:15-19 — dispatches EXPLORE_QUEUE_START_EVENT; no listener in src
- src/events/typedEvent.ts:1-21 — `type: string` with free generic TDetail; used by 4 files; 50 `as EventListener` casts elsewhere
- src/performance/devicePerformanceMode.ts:40-62 — existing store/subscribe pattern to copy

**Fact-check (partially confirmed).**

editorState has 38 fields, not 48. The 136 writes come from 11 modules plus 3 inside editorState.ts itself. There is already a change signal, but it is fired by hand. EDITOR_UI_STATE_CHANGED_EVENT ('editor-ui-state-changed', src/scenes/editor/uiEvents.ts:1) is dispatched from uiBridge.notifyEditorStateChanged, paletteController, customSpriteEditor and editorDockShell. It drives a broad view-model re-render (uiBridge.ts:596-604, editorDockShell.ts:436-442), alongside 120 manual renderUi() calls in 6 files. So the problem is a signal each site must remember to fire, not a missing one. The proposed store should replace that event and the renderUi calls rather than be described as adding a signal for the first time. No git-log evidence shows editor UI sync bugs, so the player-facing effect is speculative. The orphaned 'tileset-changed' and 'tile-selected' listeners, the orphaned EXPLORE_QUEUE_START_EVENT dispatch, the untyped typedEvent.ts helper, and the 50 `as EventListener` casts in 19 files are all confirmed.

### F074: CSS is growing by override: a 995-line skin with 100 !important rules and an unscaled z-index

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** low · **effort:** medium

**Summary.** The editor's retro look is applied as a layer of forced overrides on top of the older styles, so later style changes often 'don't work' unless an agent adds yet another forced rule. Stacking order is set with arbitrary numbers from 1 to 1200, which makes 'this panel is behind that one' bugs likely on phones.

**Technical detail.**

src/styles has 58 files and 16.9k lines. retro-skin.css (995 lines) holds 100 of the 172 `!important`s and uses hacks like `box-shadow: inset 0 0 0 999px var(--editor-retro-red) !important` to paint over earlier backgrounds (lines 185-188, 421-425). There are 64 z-index declarations with ad-hoc values: 1/10-24/30/90/100/135/140/1185/1190/1200 (pvp.css:4 1200, base.css:92 140). There are 1,648 color literals against 163 custom-property definitions. The responsive approach of JS-set data-device-class/data-app-mode attributes (≈1,200 attribute selectors) is good and should stay.

Fix:
(1) Declare `@layer base, components, editor-skin, responsive, overrides;` in main.css and put retro-skin.css in editor-skin. Layer order then beats specificity, and most !important can be removed mechanically.
(2) Add z-index tokens (--z-world-ui, --z-hud, --z-drawer, --z-modal, --z-toast, --z-critical) and replace literals.
(3) Add stylelint with declaration-no-important as a warning plus a max count, to ratchet down.

**Evidence.**

- grep -c '!important' src/styles/sections/editor/retro-skin.css — 100 of 172 total
- src/styles/sections/editor/retro-skin.css:185-188 — four !important declarations incl. `box-shadow: inset 0 0 0 999px ...` background hack
- src/styles/sections/modals/pvp.css:4 — z-index: 1200; src/styles/sections/base.css:92 — z-index: 140 (64 z-index declarations, no scale)
- src/styles/main.css:1-6 — plain @import order, no cascade layers

**Fact-check (partially confirmed).**

Corrected counts: 163 `!important` in total (100 of them in retro-skin.css), 66 z-index declarations, and about 840 `data-device-class`/`data-app-mode` occurrences in CSS. The 1185/1190/1200 cluster is confined to pvp.css (lines 274, 200 and 4).

Fix step 1 has a catch. With cascade layers, `!important` rules in an EARLIER layer beat `!important` rules in later layers. Unlayered CSS also beats all layered CSS, and inline styles set from JS beat both. So putting retro-skin.css in an `editor-skin` layer does nothing for the `!important`s it already has. The layer change and the `!important` removal have to land together, and that is a selector-by-selector job with visual checks, not a mechanical one.

The phone stacking-bug risk is a guess; no actual stacking bug was found.

### F009: Every jump, landing and coin pickup rebuilds the whole world's display bookkeeping

_Merged into F068; track it there._

- **Area:** Runtime performance (frame rate, GC, memory)
- **Type:** defect · **impact:** low · **effort:** small
- **Flagged before:** 2026-07-13 §2.4 'Replace camera ignore-list bookkeeping with display Layers'; 2026-07-29 plan 'Display layers: Partial — replace the remaining ignore-list rebuild protocol with registration at creation'. Layers landed, but the rebuild-on-every-change protocol remains.

**Summary.** Each small effect (jump dust, landing dust, coin sparkle, '+10' popup) tells the scene 'my objects changed'. The scene responds by rebuilding a list of every object in the world and re-checking each one against the world layer, once when the effect appears and again when it disappears. A single coin pickup triggers this 6 times. Effects should simply be added to the world layer once.

**Technical detail.**

fx/controller.ts:300-307 track() calls onDisplayObjectsChanged when an effect is created and again on DESTROY. That is wired (OverworldPlayScene.ts:2158-2161) to syncBackdropCameraIgnores → backdropController.ts:105-121, which calls collectBackdropIgnoredObjects (OverworldPlayScene.ts:2718-2766). That function spreads about 20 controller arrays plus every room's backgrounds, live-object sprites/helpers and edge walls, then calls worldDisplayLayer.add(array) (:119).

Phaser's Layer.add → utils/array/Add.js runs `array.indexOf(item)` for each item against the layer's whole list, which is O(n²). Desktop microbenchmark of that dedupe: 0.22 ms at 1,000 objects, 0.55 ms at 2,000, 1.9 ms at 4,000; phones are several times slower. playCollectFx creates 2 sprites + 1 Text (:28-48), so 3 syncs now and 3 more on destroy; jump and landing dust are 2 each. Other triggers: world-tile and preview changes, chat, comments and ghosts (OverworldPlayScene.ts:868, 997, 1014-1110). spawnScorePopup also creates a brand-new Phaser Text per pickup (:243-262: canvas, font measure and texture upload).

Fix:
- Add a scene `addToWorld(obj)` that calls worldDisplayLayer.add(obj) once at creation, and use it in FX, chat, comments and ghosts.
- At minimum, in syncIgnores add only `objs.filter(o => o.displayList !== worldLayer)` (O(n) instead of O(n²)), and coalesce sync requests to once per frame (dirty flag flushed on POST_UPDATE).
- Pool score popups (BitmapText, or a few reused Text objects).

**Evidence.**

- src/fx/controller.ts:300-307 — track() fires onDisplayObjectsChanged on create and on destroy
- src/scenes/OverworldPlayScene.ts:2158-2161 — fxController.onDisplayObjectsChanged → syncBackdropCameraIgnores
- src/scenes/overworld/backdropController.ts:119 — worldDisplayLayer.add(this.options.collectWorldObjects()) on every sync
- src/scenes/OverworldPlayScene.ts:2718-2766 — collectBackdropIgnoredObjects rebuilds an array of every world object
- node_modules/phaser/src/utils/array/Add.js — indexOf per item when adding an array → quadratic
- src/fx/controller.ts:243 — new Phaser Text created for every score popup
- scratchpad microbench: Layer.add dedupe 0.55 ms @2,000 objects, 1.93 ms @4,000 (desktop)

**Fact-check (confirmed).**

The mechanism and the numbers are accurate. The impact is overstated for mobile. Phones and tablets run the 'reduced' profile (deviceLayout.ts:48-50), which loads 1 full room and 9 preview rooms (previewStreaming.ts:28-31, 49). The world-object list there is small, so the quadratic dedupe is negligible on phones. It matters mainly on the desktop default profile, which loads 9 full rooms plus 49–256 previews (n ≈ 500–1,500, about 0.1–0.5 ms per sync). Two additions to the claim:
- The sync on DESTROY is a complete no-op, because Phaser removes the object from the layer itself (GameObject.js:889 then :898). It can simply be deleted.
- Combat is a bigger trigger than chat or comments: muzzle flash, projectile and impact add about 8 syncs per shot (combatPresentation.ts:117/159/228/268).
Fully replacing the ignore-list protocol (the planned delivery step 2) is medium effort. The FX-only fix plus a displayList check is small.

### F016: Fast pre-drawn world-map tiles have been off in production for about a month

_Merged into F003; track it there._

- **Area:** Load time, bundle size & assets
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** The pre-drawn world-map tiles are switched off in production right now. That feature shows the map instantly while the game loads and makes zoomed-out browsing cheap. The tile renderer was never rebuilt after the early-September Cyber tileset update, so the server marks the tiles "unavailable", and every visitor falls back to slower drawing inside the browser. Re-running the renderer rollout fixes it today, and making it part of every release keeps it from silently breaking again.

**Technical detail.**

GET https://api.wamp.land/api/world/tiles/config on 2026-10-03 returned:
{"available":false, "activeRendererVersion":"production-2026-08-31-smart-autotiling-4b122cb7", "activeRendererAssetContractHash":"authoring-catalog-v1:4b122cb7accc8026", "expectedRendererAssetContractHash":"authoring-catalog-v1:d9d6c8cf7dbb63c3"}

loadWorldTileConfig only sets available when the two hashes match (service.ts:69-87). The early bootstrap (earlyWorldTileBootstrap.classic.ts:546-547) and the in-game rollout (worldTiles/rollout.ts:57) then disable tiles: no instant map cover, and the overview falls back to browser composition from room snapshots, which is heavier on phones.

The registries changed after the 08-31 renderer: 8276c629 (09-03, Cyber v3 tiles) and fee5804d (09-03, GID split). Since then, progress.md release notes keep saying no renderer rollout was required.

The contract hash (src/worldTiles/assetContract.ts:17-29) is FNV-1a over JSON.stringify of the entire TILESETS/GAME_OBJECTS/BACKGROUND_GROUPS arrays, including names, descriptions and palette groups. Even a copy-only change therefore disables tiles in production.

Fix:
(1) Now: run world-tiles:renderer:deploy:production, then backfill and activate (all exist in package.json).
(2) Hash only render-affecting fields: path including ?v=, frame and display sizes/offsets, GID layout.
(3) Make deploy:prod compare the build's WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH with the active renderer and block or auto-enqueue a renderer build.
(4) Make smoke:prod assert config.available === true.

**Evidence.**

- GET https://api.wamp.land/api/world/tiles/config → available:false, active hash 4b122cb7accc8026 vs expected d9d6c8cf7dbb63c3
- src/cloudflare/worker/worldTiles/service.ts:69-87 — available requires activeRenderer.asset_contract_hash === WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH
- src/worldTiles/assetContract.ts:17-29 — hash input is JSON.stringify({tilesets: TILESETS, objects: GAME_OBJECTS, backgrounds: BACKGROUND_GROUPS}) (every field)
- src/scenes/overworld/worldTiles/rollout.ts:57 and src/main/earlyWorldTileBootstrap.classic.ts:546-547 — client disables tiles when !config.available
- git log: 8276c629 (2026-09-03) and fee5804d (2026-09-03) changed src/config/tilesets.ts after renderer production-2026-08-31

**Fact-check (confirmed, confirmed, confirmed).**

These details don't change the verdict, but should be fixed in the finding:

1. **Point (2) would not have prevented this case.** 8276c629 and fee5804d were real rendering changes: new or updated Cyber atlas PNGs, and the `CYBERCITY_EXTRAS_TILESET_FIRST_GID` change from 2077 to 2149. A rebuild was genuinely needed. Hashing only render-affecting fields is still a good way to avoid false invalidations, but the real guardrails are points (3) and (4): a deploy-time hash comparison, and a smoke check for `available === true`.
2. **The hash moved twice on 09-03:** first to 264ba6e9 at 8276c629, then to d9d6c8cf at fee5804d.
3. **The early bootstrap check is the single line 546**, not 546-547.
4. **One more stale doc:** `docs/smart-autotiling-roadmap.md:21` still says the production contract is 4b122cb7 and should be updated with the rollout.
5. **Rollout should follow the established order:** deploy to the safety env first, then production deploy-renderer, then backfill and verify parity, then activate (`feature-ledger.md:16`, `feature-ledger.md:36`).

Three details need correcting. None of them changes the verdict.

1. **The hash changed twice, both times on 09-03.** 8276c629 changed it to `264ba6e94e75b789`, and fee5804d changed it to `d9d6c8cf7dbb63c3`. The 09-18 and 09-25 commits that touched `src/config` did not change it.

2. **This time the hash did its job.** The 09-03 changes affect how the map is drawn: a new Cyber extras tileset, plus `CYBERCITY_EXTRAS_TILESET_FIRST_GID` moving from 2077 to 2149 in fee5804d. So the renderer genuinely had to be rebuilt. Fix (2), hashing only fields that affect drawing, is still worth doing, but it would not have prevented this outage. Fixes (3) and (4) are the ones that would have caught it: a deploy that blocks or warns when the hashes differ, and a smoke test that checks `available === true`.

3. **Timing and effort.** The outage started with the first API Worker deploy from fee5804d or later, between about 09-05 and 09-08. That makes it roughly 4 weeks, not exactly a month. "Fixes it today" is optimistic. Per `docs/overworld-tile-pyramid.md:92-106`, the rollout needs a renderer deploy, a backfill of about 800 objects across every pyramid level, and parity checks before activation.

The map stays correct throughout because of the fallback. What players lose is the instant map cover while the game loads and cheap zoomed-out browsing on phones.

The September changes that broke the match really did change how rooms render, so this is not a copy-only false alarm. fee5804d moved CYBERCITY_EXTRAS_TILESET_FIRST_GID from 2077 to 2149 (src/config/tilesets.ts:340), and 8276c629 added the Cyber v3 tiles. The old renderer genuinely needed a rebuild. Hashing fewer fields (fix 2) is optional hardening against future false alarms, not the root fix. The root fix is fix 3 (deploy:prod compares the build's contract hash with the active renderer) plus fix 4 (smoke:prod asserts available===true). Also update the stale docs/smart-autotiling-roadmap.md:21. Restoring service only needs existing scripts, and the guard is a short check, so effort is small. It becomes medium only if the hash narrowing is included.

### F022: Guest recording grabs a screenshot every second on players' phones

_Merged into F001; track it there._

- **Area:** Load time, bundle size & assets
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** For the first 5 minutes of every guest's play or build session, the game copies the screen, compresses it to a JPEG once per second, and uploads it: up to about 300 images, several MB over the player's mobile data. Copying the game screen stalls the phone's graphics chip, so phones likely hitch once a second during a new player's first impression.

**Technical detail.**

src/analytics/replay/recorder.ts:100-113 runs on Phaser POST_RENDER (wired in main.ts:387-395). It calls drawImage(host.canvas) from the WebGL canvas into a 2D canvas, which forces a synchronous GPU→CPU readback. Then it runs canvas.toDataURL('image/jpeg', 0.35), and again at 0.12 if the result is too big: a synchronous main-thread JPEG encode plus base64.

It is armed every 1000 ms (recorder.ts:190) for up to REPLAY_SECONDS = 300 samples (model.ts:1), with images up to REPLAY_IMAGE_LIMIT = 16,000 chars (model.ts:2). That is up to ~4.8 MB of base64 JSON per guest. It is on for every guest unless DNT/GPC or opt-out is set, and each sample also calls getGameDebugState(game) (main.ts:265).

Fix:
- Capture every 3–5 s, or only on action events (death, publish, tool change).
- Downscale to ≤320×180.
- Use createImageBitmap(host.canvas) plus OffscreenCanvas.convertToBlob in a worker: async, binary upload, no base64.
- Skip when devicePerformanceMode is battery saver or frame-work p95 is high.
- Sample a percentage of guests via the /start response so the server can tune volume.

**Evidence.**

- src/analytics/replay/recorder.ts:107-109 — context.drawImage(host.canvas…) then canvas.toDataURL('image/jpeg',0.35) / 0.12 inside the render callback
- src/analytics/replay/recorder.ts:190 — window.setInterval(tick, 1000) arms a capture every second
- src/analytics/replay/model.ts:1-2 — REPLAY_SECONDS = 300, REPLAY_IMAGE_LIMIT = 16_000
- src/main.ts:387-395 — initializeGuestReplay hooked to Phaser.Core.Events.POST_RENDER for all guests

**Fact-check (partially confirmed).**

The core claim holds: at 1 fps it does a synchronous drawImage plus toDataURL, sometimes twice, inside POST_RENDER, phones are not excluded, and the worst case is about 4.8 MB per session. Corrections:
(a) Not every guest. The server caps recording at 100 sessions per rolling 24h globally and 10 per visitor per day (src/cloudflare/worker/guestReplay/routes.ts:61-74). Once the cap is hit, the client stops right after a 429 from /start (recorder.ts:138,142).
(b) Images are captured only in play/edit modes, not browse (recorder.ts:102), and not while the tab is hidden (recorder.ts:124).
(c) Captures are already downscaled to fit 640×480 (recorder.ts:104-106). There is no ≤1 clamp, though, so small canvases get upscaled, and the 2D canvas is resized (reallocated) on every capture.
(d) Each sample runs the heavy scene describeState three times (recorder.ts:76,78,102 → main.ts:265,424-433 → OverworldPlayScene.ts:6218). Reuse one snapshot per sample.
(e) Nobody has measured the hitch, and "stalls the graphics chip" overstates it: the cost is main-thread readback plus JPEG/base64 encoding.

Suggested fix: skip image capture on touch devices or battery-saver mode (or sample every 3–5 s there), clamp the scale to ≤1 and target about 320 px wide, keep one fixed-size 2D canvas, and compute describeState once per sample.

### F043: No origin check or rate limit on magic-link / email-code requests enables email bombing of arbitrary addresses

_Merged into F187; track it there._

- **Area:** Security & abuse resistance
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Anyone, from any website, can make WAMP send a real sign-in email to any email address they type, limited only to one per minute per address. There is no CAPTCHA and no per-IP cap, so an attacker can sign up thousands of victim addresses and flood inboxes with WAMP mail (and burn the Resend quota/reputation).

**Technical detail.**

The /api/auth prefix route is auth:'optional' (src/cloudflare/worker.ts:159-164) and handleRequestMagicLink (auth/routes.ts:166-237) does NOT call requireTrustedOriginForMutation for the unauthenticated sign_in path — it only does so when an existing session is linking email (routes.ts:183). So any cross-origin page can POST {email} and a real email is sent via sendMagicLinkEmail (store.ts:1363). The sole limiter is hasRecentEmailSignInRequest (routes.ts:174, 60s per email). There is no per-IP limit and no Turnstile, unlike the guestbook which does gate on Turnstile (guestbook/routes.ts:93, verifyTurnstileToken). For a brand-new address createUserForEmail (routes.ts:197) even creates a user row per unique address, so attackers can mass-create accounts. Fix: require a trusted origin for all POST /api/auth/request-link, add per-IP rate limiting, and add Turnstile on the unauthenticated request path.

**Evidence.**

- src/cloudflare/worker/auth/routes.ts:166 — handleRequestMagicLink sends email with no origin assertion on the sign_in branch
- src/cloudflare/worker/auth/routes.ts:174 — only throttle is per-email 60s (hasRecentEmailSignInRequest)
- src/cloudflare/worker/auth/routes.ts:197 — unknown address auto-creates a user before any verification
- src/cloudflare/worker/guestbook/routes.ts:93 — contrast: guestbook gates writes behind Turnstile

**Fact-check (partially confirmed).**

(1) The origin-check part of the claim is mostly irrelevant. requireTrustedOriginForMutation guards cookie-authenticated mutations (CSRF), and isTrustedRequestOrigin (core/http.ts:58-61) treats a request with no Origin header as trusted. An attacker running curl or a script sends no Origin, so "require a trusted origin for all POST /api/auth/request-link" would stop almost nothing. The fixes that work are a per-IP limit (a Cloudflare Rate Limiting binding or WAF rule, or the guestbook's ipHash-table pattern), Turnstile on the unauthenticated path, and a global hourly/daily send cap so the Resend quota can't be drained. Draining the quota would block every real sign-in.
(2) The throttle is weaker than "one per minute per address". normalizeEmail (store.ts:1443-1445) only trims and lowercases. Plus-addressing (victim+1@gmail.com, victim+2@...) and Gmail dot variants count as different addresses, so one victim's inbox can be flooded with no limit, and each variant also creates its own user row.
(3) Extra effect the reviewer missed: createUserForEmail calls ensureFounderIdentityQualification (store.ts:177 → progression/awards.ts:34-64) before the email is verified. Every junk sign-up therefore takes a founder number and a badge sync, which inflates founder numbering for real players. Creating the user should wait until verify. magic_link_tokens already stores the email, so the row can be created at verify time.
(4) Effort is small, not medium. The guestbook already has IP hashing, per-IP limits and Turnstile verification that can be reused, and a Rate Limiting binding or WAF rule needs no schema work. Moving user creation to verify time is the only part that leans toward medium.

### F044: In-room live chat (PartyKit) has no content moderation or ban enforcement

_Merged into F190; track it there._

- **Area:** Security & abuse resistance
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** The floating speech-bubble chat that players see while playing a room is completely unmoderated: banned users can still use it, there is no profanity/length filtering beyond a character cap, and messages are broadcast live to everyone in the room with no record for review. World Chat (the other chat) does check bans; room chat does not.

**Technical detail.**

handleRoomChatSay (partykit/presenceServer.ts:838-879) accepts any message from a connection whose identity token verified, checks only presence.mode==='play' and a 1s rate limit (ROOM_CHAT_SEND_RATE_LIMIT_MS, presenceServer.ts:856), normalizes text only for non-empty and <=140 chars (relayProtocol.ts:17-21), then broadcasts via buildRoomChatBroadcast with the sender's userId/displayName (relayProtocol.ts:23-43). There is no call to resolveChatModerationViewer / isChatBannedUser — compare the HTTP World Chat path which rejects banned users (chat/routes.ts:143-150) and school-restricted users (chat/routes.ts:144). So a user banned from World Chat can still broadcast in room chat, and there is no server-side log for admin review or deletion. The identity token (presence/routes.ts:88-104) is even issued to guests, so guests can broadcast too. Fix: resolve the chat moderation viewer in onBeforeConnect or handleRoomChatSay and drop banned/school-restricted senders; consider persisting a short rolling log for moderation.

**Evidence.**

- partykit/presenceServer.ts:851 — only checks non-empty text, then 1s rate limit; no ban check
- src/partykit/relayProtocol.ts:20 — content validation is length<=140 only
- src/cloudflare/worker/chat/routes.ts:147 — World Chat rejects viewer.banned, room chat has no equivalent
- src/cloudflare/worker/presence/routes.ts:88 — presence identity tokens are issued to guest identities too

**Fact-check (confirmed, partially confirmed, partially confirmed).**

Line references are slightly off. handleRoomChatSay starts at presenceServer.ts:837, not 838, and the rate-limit check is at 857, not 856 or 851. Two points the claim understates: (1) School-restricted (classroom) accounts are the bigger gap. Every other free-text UGC path calls assertNotSchoolRestricted: world chat (chat/routes.ts:144), room comments (roomComments/routes.ts:147), guestbook (guestbook/routes.ts:81) and profile text (profiles/routes.ts:129). Room chat has no such check on the server or the client, so students can send and receive free text with strangers. (2) Guest tokens accept any client-chosen displayName. Only the userId must match /^guest-.../ (src/presence/identityToken.ts:100-110, 248). A scripted guest could therefore broadcast room chat under someone else's name, for example a well-known creator's. One point is overstated: World Chat has no profanity filter either (chat/routes.ts:394-404 is trim and length only). Its real advantages are bans, school gating and persistence, not content filtering. Simplest fix, which is small: at token issuance (presence/routes.ts), where auth is already loaded, add claims such as roomChatAllowed = source==='auth' && !chatBanned && !school-restricted. Reject room-chat:say in handleRoomChatSay when the claim is false, and hide the composer on the client for those accounts. A rolling moderation log would be a separate, medium-effort follow-up. Note that tokens have a TTL, so a new ban only takes effect when the token expires.

Corrections:
- Line references: handleRoomChatSay starts at presenceServer.ts:837, not 838. The World Chat checks are chat/routes.ts:144 (assertNotSchoolRestricted) and 145-147 (ban).
- Guests: the client UI already stops guests from sending, but the server does not enforce it. The token's `source: 'guest'` claim is verified and then thrown away in parseIdentity, so a raw socket can still send. Guests can also pick any display name, which allows impersonation in bubbles.
- Profanity: World Chat has no profanity filter either, so drop that as a room-chat-specific gap.
- Missing from the claim: the room-chat composer never checks authState.schoolManaged, unlike the World Chat panel and room comments. School student accounts can use room chat today.

Practical fix:
- PartyKit cannot cheaply query D1. Since identity tokens expire in 5 minutes (identityToken.ts:2), add a `chatRestricted` claim at issuance in presence/routes.ts. Set it to true when the user is chat-banned (resolveChatModerationViewer), school-managed (auth.school), or a guest.
- Keep `source`/`chatRestricted` in the ConnectionPresenceState built by parseIdentity, and return early in handleRoomChatSay when it is set.
- Also hide the room-chat composer, and optionally incoming bubbles, for schoolManaged users on the client.
- A rolling server log for review is optional.

Core is correct: room chat skips the chat-ban and school-restriction checks that World Chat (chat/routes.ts:144-147) and room comments (roomComments/routes.ts:147-150) enforce. Corrections:
(a) The main concrete gap is school-managed student accounts. Commit 71638ea3 restricted every other text channel but not room chat. Students get an auth-source presence token and can both send and receive unmoderated room chat.
(b) Guests cannot room-chat through the real UI (src/presence/roomChat.ts:168). Only a tampered client can, because presenceServer never checks claims.source.
(c) World Chat has no profanity filter either, so that is not a difference between the two.
(d) Persistent logging is a nice-to-have. Messages are ephemeral 6s bubbles.

Recommended fix (small):
1. In presence/routes.ts resolveIssueIdentity, add a claim such as `roomChat: 'ok' | 'banned' | 'school' | 'guest'`, computed with resolveChatModerationViewer and auth.school.
2. In presenceServer.parseIdentity, store it on connection state, and in handleRoomChatSay drop messages unless it is 'ok'.
3. Mirror the check client-side so banned and school users see 'Chat unavailable' instead of a silent drop.
4. Optionally, have the room-chat client skip rendering incoming bubbles for school accounts.

Ban changes will apply on reconnect (tokens have a 5-minute TTL but sockets are long-lived). An immediate kick would need a PARTYKIT_INTERNAL_TOKEN call from the ban route, and that is optional.

### F047: Chat @mention emails can be used to email-bomb any user with an email on file

_Merged into F187; track it there._

- **Area:** Security & abuse resistance
- **Type:** defect · **impact:** medium · **effort:** small

**Summary.** Each World Chat message you post can trigger WAMP to email up to 5 mentioned users. The only limit on sending chat is 1 message per second per author, so a single malicious account can generate a continuous stream of 'X mentioned you' emails to chosen victims, and the victim's own chat message body is quoted into the email.

**Technical detail.**

handleCreateChatMessage (chat/routes.ts:143-172) rate-limits a user to one message per 1000ms (CHAT_RATE_LIMIT_WINDOW_MS, chat/routes.ts:58,157), then scheduleChatMentionNotificationEmails fires emails to every mentioned @username that has an email (mentions.ts:40-104, up to MAX_CHAT_MENTION_EMAILS=5, mentions.ts:8). There is no per-recipient cooldown or daily cap: one account can send ~5 emails/second to targets of its choice, and the message excerpt (attacker text) is embedded in the email (mentions.ts:100). Fix: add a per-recipient notification cooldown (e.g. at most one mention email per sender->recipient per N minutes) and a global per-sender daily mention-email budget.

**Evidence.**

- src/cloudflare/worker/chat/routes.ts:157 — only 1s/author rate limit gates message creation
- src/cloudflare/worker/chat/mentions.ts:66 — emails sent to each mentioned user with an email, no cooldown
- src/cloudflare/worker/chat/mentions.ts:100 — attacker-controlled excerpt embedded in the outbound email

**Fact-check (partially confirmed).**

1. The summary says "the victim's own chat message body is quoted into the email." That is wrong. The excerpt is the sender's (attacker's) message. It is capped at 140 characters by CHAT_MESSAGE_MAX_LENGTH (src/chat/model.ts:1), so the 500-character trim at mentions.ts:10 and 80 never applies. It is HTML-escaped (mentions.ts:100 and 191-197), so the risk is harassment or phishing text, not injected markup. The attacker-chosen display name also appears in the subject line (mentions.ts:88).
2. The 1 message per second limit is not strictly enforced. It is a non-atomic read-then-insert (routes.ts:152-168, store.ts:155-172 and 51-66), so concurrent requests can push the email rate above about 5 per second.
3. Recipients have no way to opt out or unsubscribe.
4. A bigger risk than harassing one user is that mention emails share the Resend account and From address with sign-in emails (mentions.ts:5 and 77). Abuse could exhaust the Resend quota or damage the domain's reputation, and sign-in emails would stop arriving.

Fix:
- Add a per-recipient cooldown, for example a small D1 table keyed by sender and recipient, or a recipient_last_mention_email_at column, allowing one email per N minutes.
- Add a per-sender daily email budget.
- Make the chat rate limit atomic, using a conditional INSERT or the Workers rate-limit binding.
- Add an opt-out flag for mention emails, or at least an unsubscribe link.
- Optionally, send notification emails from a different From address than sign-in emails.

### F053: Pinch-zooming in the mobile editor paints, places, or flood-fills under the first finger

_Merged into F079; track it there._

- **Area:** Client bug hunt (gameplay & editor)
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** On a phone or tablet, the first finger of a two-finger pinch immediately applies the current tool. With the pencil you get a stray tile, with an object selected you get an object, and with Fill the whole area floods. The stray edit is committed to history and autosaved, so mobile builders have to Undo after nearly every zoom. This happens even when both fingers land at the same moment, because Phaser delivers each finger's touchstart as a separate pointerdown.

**Technical detail.**

handleTouchPointerDown registers the pointer (interaction.ts:1094). With one finger it falls through to the tool code: object placement (interaction.ts:1145-1149), shape start, or `this.host.handleToolDown(pointer)` (interaction.ts:1186). For pencil that places a tile, and for fill it runs floodFill and commits immediately (tools.ts:180-204). When the second finger's pointerdown arrives, the size>=2 branch calls finishCurrentTouchDraw() (interaction.ts:1101-1104), which commits the stray batch and marks the room dirty (interaction.ts:1291-1309). Phaser's InputPlugin processes changedTouches one pointer at a time, so even a simultaneous two-finger touch runs the first finger's handler before the second is in touchPointers. Fix: add a short 'touch intent' window to the editor touch path. On first touch, record the point and arm a pending action instead of applying it. Apply it when the finger moves past a small threshold, after about 80-100 ms, or on pointerup (tap). If a second pointer arrives first, discard the pending action. If a batch already started, roll it back instead of committing it: restore oldGid for each currentBatch entry and smartTerrain from currentBatchSmartBefore. One-shot tools (fill, single object place, shape second tap) should fire on tap-up for touch.

**Evidence.**

- src/scenes/editor/interaction.ts:1094 — each touch pointer added to touchPointers on its own pointerdown
- src/scenes/editor/interaction.ts:1186 — single-touch path calls handleToolDown right away
- src/scenes/editor/tools.ts:200-204 — fill tool runs floodFill and commits on pointer down
- src/scenes/editor/interaction.ts:1145-1149 — object pencil places an object on the first touch
- src/scenes/editor/interaction.ts:1101-1104 — second finger calls finishCurrentTouchDraw before starting the pinch
- src/scenes/editor/interaction.ts:1291-1309 — finishCurrentTouchDraw commits the tile/object batch (history + dirty + autosave)

**Fact-check (confirmed, confirmed, confirmed).**

Small corrections and caveats:
- **Line range:** finishCurrentTouchDraw is interaction.ts:1292-1310.
- **Room bounds:** tile tools only make a stray edit if the first finger lands inside the room. handleToolDown returns early outside it (tools.ts:175-177).
- **Shape tools:** a shape tool with no pending first tap makes no stray tile. Its first finger only sets rectStart. But if a first tap is already pending, the pinch's first finger stamps and commits the shape (interaction.ts:1157-1182).
- **Rollback limits:** some first-finger actions commit right away, outside any batch: single object placement (handleObjectPlace at :1152), floodFillObjects (:1144), the shape stamp, and tile fill. A rollback inside finishCurrentTouchDraw cannot undo these. The fix has to defer them to tap-up or to a short intent window, not only roll back currentBatch.
- **Why it matters more:** mobile has no single-finger pan, so every pan, not just zooms, can trigger a stray edit.

Core claim is accurate and the line numbers are right. Additions:
- The eraser is also affected. It erases tiles, and it can delete objects or goal markers instantly (interaction.ts:1128-1137); deletions like these happen immediately, so they can't be "discarded" by a pending window that only covers placement.
- Stray tile commits also bump build stats via recordBuildPlacement (editRuntime.ts:768).
- "Nearly every zoom" should read "any pinch or two-finger pan whose first finger lands inside the room". There is no pan tool, so two fingers are the only way to move the camera on touch, and in phone portrait the room fills most of the screen.

For the fix, roll back an already-started tile batch with the editRuntime batch state (currentBatch oldGid values plus currentBatchSmartBefore), and clear the object batch instead of committing it.

The core claim is accurate, but the scope is slightly understated.
1. The bug fires on every two-finger PAN as well as every pinch-zoom. One finger always draws, so two fingers is the only way to pan by touch. Zoom has a workaround in the mobile -/+/Fit buttons (index.html:1214-1219); panning does not.
2. Other tools leave strays too. Eraser removes a tile under the first finger. Goal-placement mode places the goal marker (interaction.ts:1124-1129). With rect, ellipse, line or copy, if the first corner was already tapped, the pinch's first finger counts as the second tap and stamps and commits the shape (interaction.ts:1158-1182).
3. "Undo after nearly every zoom" is slightly too strong. Nothing is recorded when the first finger lands outside the room bounds (tools.ts:175-177), or when the cell already holds that tile, because commitTileBatch filters out changes where oldGid === newGid (editRuntime.ts:744).
4. editRuntime has no rollback helper. The cheapest fix is to commit and immediately undo (dropping the redo entry) when the second finger arrives within about 150-250 ms, or to defer the first finger's action.

### F071: details withheld

Security, safety or anti-cheat item; details withheld from this public repo until it is fixed (see the private review page, or ask Claude to read it from the review artifact).

### F073: Modal handling is copy-pasted 18+ times, and Escape closes every open modal at once

_Merged into F116; track it there._

- **Area:** Code health & architecture (AI-agent friendliness)
- **Type:** improvement · **impact:** low · **effort:** medium
- **Flagged before:** 2026-07-13 audit §1.4 'extract createModal… owning backdrop/escape/focus behavior once'; roadmap lists 'shared modal lifecycle helper' as landed, but adoption is 5 of ~23 modals

**Summary.** Each pop-up window has its own copy of the 'close on Escape / click outside' code, so agents keep re-implementing it slightly differently. Because none of them know which window is on top, pressing Escape closes all open pop-ups together, for example the leaderboard opened from Explore.

**Technical detail.**

src/ui/setup/modalLifecycle.ts (59 lines) is the shared helper, but only 5 small modals use it: about, controls, performanceSuggestion, playlistIntro, roomGoalIntro. Explore, leaderboard, profile, runRating, settings, welcome, history, pvp, roomRush and others each register their own document 'keydown' Escape handler and backdrop-click check, e.g. exploreModal.ts:97-103 and leaderboardModal.ts:117-123. Each handler only checks its own `hidden` class, so a single Escape closes every open modal. A third pattern exists in emailCodeDialog.ts, which uses a native <dialog> with showModal.

Fix: grow modalLifecycle into a small modal manager with a stack. open() pushes, Escape and backdrop clicks only close the top entry, close() restores focus (to the opener or the game canvas via keyboardFocus.ts), and aria-hidden is managed once. Migrate modals as they're touched; explore/leaderboard/profile first, since they open each other. Coordinate with the mobile reviewer on safe-area handling.

**Evidence.**

- src/ui/setup/modalLifecycle.ts:7-59 — shared lifecycle; imported by only 5 modules
- src/ui/setup/exploreModal.ts:97-103 — private Escape handler on document; checks only its own hidden class
- src/ui/setup/leaderboardModal.ts:117-123 — identical copy of the Escape handler
- src/auth/emailCodeDialog.ts:6-45 — third modal pattern (native <dialog> + innerHTML)

**Fact-check (partially confirmed).**

Copy count: about 16 copies (15 src/ui/setup modals with private handleBackdropClick/handleDocumentKeydown plus src/ui/worlds/controller.ts:39-41), not 18+. pvpModal has no Escape handling.

Stacking example: replace "leaderboard opened from Explore" (Explore never opens the leaderboard). Real cases:
- The Profile modal opened from a leaderboard row (leaderboardModal.ts:935-999).
- The Profile modal opened from a builder name on an Explore room card (exploreModal.ts:907-917, where stopPropagation keeps Explore open).

In both cases one Escape closes the profile and the modal under it. Backdrop clicks are fine, because the click lands on the profile overlay.

emailCodeDialog.ts: only used on the jam and school-admin pages, not in the game, so it is not part of the game's modal family.

Fix order: give modalLifecycle a module-level open stack and have Escape close only the top entry. Migrate profile, leaderboard and explore first, then the rest as they're touched.

### F081: No frame-rate cap: 90/120Hz Android phones run the whole game at up to 120fps

_Merged into F002; track it there._

- **Area:** Mobile experience (code review)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** Many Android phones have 90Hz or 120Hz screens, and the game redraws as fast as the screen allows. That can double the work and battery drain compared with 60fps for no gameplay benefit, and makes phones heat up and throttle sooner. Capping touch devices at 60fps, and lower in Battery Saver, is a small change.

**Technical detail.**

The Phaser config sets no `fps` block (main.ts:77-104), so TimeStep.fpsLimit=0 and the loop runs on every rAF (Phaser 3.90 TimeStep.js:138-162). Arcade physics keeps its default fixed 60Hz step, so at 120Hz the extra frames re-render with no new simulation, which costs GPU without adding smoothness. The existing 'battery-saver' mode (devicePerformanceMode.ts:5) changes only streaming/visual data profiles (performancePolicy.ts:44-53; worldStreaming.ts:5694) and never touches frame pacing. Fix: before `new Phaser.Game`, compute coarse = matchMedia('(pointer: coarse)').matches and pass `fps: { limit: coarse ? 60 : 0 }`. stepLimitFPS is bound at loop start (TimeStep.js:546), so set it at config time or restart the loop when the mode changes. Optionally measure the real refresh rate in the first second (game.loop.actualFps). On 90Hz panels a 60 cap gives uneven 1-2-vsync pacing, so there prefer 45 or no cap. In Battery Saver, use a 30fps cap while in browse mode.

**Evidence.**

- src/main.ts:77-104 — game config has no fps/limit
- node_modules/phaser/src/core/TimeStep.js:138-162 — fpsLimit defaults to 0 (unlimited)
- src/performance/performancePolicy.ts:44-53 — battery-saver only lowers visual/runtime data profiles
- src/scenes/overworld/worldStreaming.ts:5694 — only other battery-saver consumer

**Fact-check (partially confirmed).**

Don't use `fps: { limit: 60 }`. Phaser 3.90's stepLimitFPS (TimeStep.js:688) uses a strict `delta >= 1000/limit` test and throws away the remainder. On 120Hz panels, two vsyncs (about 16.6ms after timestamp coarsening) often fall just short of 16.667ms, so frames alternate between 16.7ms and 25ms and the game judders. Use a limit of about 64-65 instead (_limitRate ≈ 15.4ms). That gives a steady 60fps on 120Hz, a steady 45fps on 90Hz with no special case, and every frame on 60Hz screens. Alternatively, patch the comparison to allow about 1ms of tolerance. A cap saves CPU as well as GPU: OverworldPlayScene.update, world streaming and the HUD run once per step, not just rendering. To change the cap at runtime (e.g. Battery Saver), set loop.fpsLimit, hasFpsLimit and _limitRate, then call the existing restartPhaserRenderLoop in main.ts:118-133, which goes through wake() and start() and rebinds the step function. Any cap must keep the performance advisor's frame thresholds in mind (performanceAdvisor.ts:197-199: p95 25ms, over-33ms counts). A badly quantized 60 cap could trigger false 'frame pressure' suggestions in auto mode. A 30fps cap is only safe in battery-saver, because there the advisor is turned off (OverworldPlayScene.ts:6093). Evidence line numbers check out, apart from small offsets (the config spans main.ts:75-104).

### F083: Touch stick ergonomics: dead zone around the stick and down-drift triggers accidental butt-stomps

_Merged into F140; track it there._

- **Area:** Mobile experience (code review)
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** docs/product/product-requirements.md:785 — open item 'Tune the shipped mobile controls'
- **Already in the product backlog.**

**Summary.** The move pad only responds if your thumb lands inside the small square stick, so about two-thirds of the grey move area does nothing when you miss it. Your thumb also tends to drift slightly down while running, and that counts as pressing down, so a normal jump can turn into a butt-stomp mid-air.

**Technical detail.**

pointerdown on #mobile-move-zone is ignored unless it hits #mobile-move-stick's rect (portraitPlayControls.ts:84-87, :272-285). The stick is 132×132 (phone-portrait-play-controls.css:114-115) inside a zone that is 50% wide and about 250px tall (:94-100), so roughly 64% of the zone is dead. Make it a floating stick: accept pointerdown anywhere in the zone, set movePointerOrigin there, and move the stick visual to that spot. Down handling: touch 'down' is a level signal (moveY>=0.42, movementController.ts:399, about 22px of vertical drift given the 10px deadzone and 38px full tilt at portraitPlayControls.ts:12-13), and startButtStomp fires on `downPressed || touchDown` while airborne (movementController.ts:506-511). Keyboard uses JustDown (edge). So a touch player holding a slightly low diagonal stomps immediately after every jump. Directional-gravity jumps have the same level-vs-edge mismatch (movementController.ts:906-934). Fix: derive edge 'pressed' flags for touch in touchControls (track the previous frame's thresholded direction), use them for stomp and gravity jumps, and add angular sectors (treat down as down only when |dy| > |dx|·1.2).

**Evidence.**

- src/ui/mobile/portraitPlayControls.ts:84-87 — touches outside the stick rect are ignored
- src/styles/sections/responsive/phone-portrait-play-controls.css:114-115 — 132px stick in a half-screen zone
- src/scenes/overworld/movementController.ts:399 — touchDown = moveY >= 0.42 (level)
- src/scenes/overworld/movementController.ts:506-511 — butt stomp triggers on downPressed || touchDown
- src/scenes/overworld/movementController.ts:414-416 — keyboard downPressed uses JustDown (edge)

**Fact-check (partially confirmed).**

Dead zone: the facts are accurate, but it is intentional. A drag has had to start inside the stick since the Apr 14 real-device tuning (progress note in commit 55162cbb), and scripts/mobile_smoke.mjs:393-399 asserts that the grey area does not move the player. Frame the floating stick as a reversal to propose to Jonathan, and update the smoke test if he agrees.

Stomp: holding a low diagonal on the ground does not cause a stomp after every jump. It causes a crouch (movementController.ts:524-527), which drops speed to crawlSpeed (:560) and blocks the jump entirely (:590-593). So thumb drift reads as "running slows to a crawl and Jump does nothing". The mid-air stomp happens only when the thumb drifts about 22px down after takeoff.

Fix priority: angular sectors (treat down as down only when |dy| > ~1.2|dx|) are the main fix, because they solve both the crouch and the mid-air stomp. Touch edge flags are a separate fix for three cases: crawling off a ledge stomping instantly, re-stomping after the brick-break bounce in handleButtStompImpact (:370-380), and auto-repeating jumps in left/right/up gravity zones (:906-934). In left/right gravity, a sideways drift of only about 6.4px counts as a jump. Edge flags alone do not prevent a mid-air drift stomp.

### F084: Phone HUD uses 6–8px text and 20–34px buttons (tablets get 44px, phones don't)

_Merged into F109; track it there._

- **Area:** Mobile experience (code review)
- **Type:** improvement · **impact:** medium · **effort:** small
- **Flagged before:** docs/product/product-requirements.md:785 — open item 'phone/tablet layout density, and touch-target polish'
- **Already in the product backlog.**

**Summary.** On phones, the main browse buttons (Play Room, Edit Room, Build Here) and the in-play Settings/Controls buttons are tiny, with 6–8px text and buttons as short as 20px. They're hard to read and easy to mis-tap. Tablets already get finger-sized 44px buttons, but phones, which need them most, don't.

**Technical detail.**

utility-tablet.css:7-14 sets min-height:44px for tablets only. On phones: primary browse actions are 34px tall with 8px text (phone-world-chat.css:124-129); tertiary 'More' actions 30px/7px (:149-154); title-row mobile actions 28px/7px (:63-66); state pills 6px (:85-89); bottom bar 30px/7px (phone-chrome.css:34-39); in-play #btn-world-settings/#btn-world-controls 20px/7px (phone-chrome.css:84-95); portrait Stop/Restart 52×34 with 9px text (phone-portrait-play-controls.css:264-288); goal label 8px (:38-41). HomeVideo is a pixel font, and at 6–7px it renders off its native grid. Fix: phone tokens with --tap-min:44px (keep the visual size and grow the hit area with padding or ::after insets if space is tight), a minimum of 10–11px for HomeVideo text, and an automated check in mobile_smoke.mjs that flags any visible button under 40×40 in each phone scenario.

**Evidence.**

- src/styles/sections/responsive/utility-tablet.css:7-14 — 44px min-height applied to tablets only
- src/styles/sections/responsive/phone-world-chat.css:124-129 — Play/Edit/Build buttons 34px, 8px font
- src/styles/sections/responsive/phone-world-chat.css:85-89 — state pill 6px font
- src/styles/sections/responsive/phone-chrome.css:84-95 — in-play Settings/Controls 20px tall, 7px font
- src/styles/sections/responsive/phone-portrait-play-controls.css:264-288 — Stop/Restart 34px tall, 9px font

**Fact-check (confirmed).**

Minor clarifications, none of which change the core claim:
(1) The 20px Settings/Controls buttons only appear in landscape phone play. In portrait play, isPortraitFocusedRoom is true (src/ui/mobile/controller.ts:407-412) and the whole bottom bar is hidden (phone-portrait-world-hud.css:21-23).
(2) The small sizes were a deliberate choice: commit 019cf3a5 "feat: compact mobile overworld hud" (Aug 15), whose feature-ledger entry describes a compact phone browse HUD. The smoke test enforces it at scripts/mobile_smoke.mjs:557-560: the portrait focused-room HUD must be ≤150px tall, with exactly three primary buttons in one row. The fix has to stay within that limit or update the test on purpose. It fits: about 8+8 padding, 4 border, 44 title row, 14 owner row, 44 primary row and 12 gaps comes to roughly 134px. The fix should grow the hit area and the text without bringing back the hidden rows.
(3) I could not confirm that HomeVideo "renders off its native grid" at 6-7px. Treat that as a plausible legibility concern, not a fact.
(4) This is in the PRD roadmap, not docs/product/backlog.md.

### F088: Add game controller (Gamepad API) support

_Merged into F148; track it there._

- **Area:** Mobile experience (code review)
- **Type:** idea · **impact:** medium · **effort:** small

**Summary.** Let people play with a Bluetooth or USB controller (Xbox, PlayStation, Switch Pro, 8BitDo). That makes iPads and Android tablets fully playable even before touch controls exist there, gives phone players an option, and suits a platformer on desktop too.

**Technical detail.**

There's no gamepad code anywhere (no getGamepads or input.gamepad in src). Phaser 3.90 supports `input: { gamepad: true }` in the config (main.ts:97-101). Add a small GamepadInputSource next to touchControls that maps the left stick/D-pad to the same thresholded left/right/up/down, A to jump (held and pressed), X/B to sword/shoot, Start to stop/restart. Feed it into movementController.updateMovement the way touch is fed (movementController.ts:395-427), with edge detection for the pressed flags. Show a 'Controller connected' toast, and update the Controls modal. With the AGENTS.md virtual-controller key map (arrows/z/x), this also gives one input abstraction for keyboard, touch, pad and postMessage.

**Evidence.**

- src/main.ts:97-101 — input config has only mouse.preventDefaultWheel; no gamepad
- src/scenes/overworld/movementController.ts:395-427 — movement merges keyboard and touch sources only
- src/ui/mobile/touchControls.ts:1-92 — existing per-source state module pattern to mirror

**Fact-check (confirmed).**

The detail says to feed the pad into movementController the way touch input is fed. That covers only movement and jump. Four other places read input directly and need the pad too:
- OverworldPlayScene.ts:2308-2323: camera toggle, stop and restart via consumeTouchAction.
- OverworldPlayScene.ts:2362-2363: sword and gun via JustDown(Q/E) or consumeTouchAction('slash'/'shoot').
- OverworldPlayScene.ts:4326: ladder drop via touchInput.moveY.
- OverworldPlayScene.ts:6153: the input-held/idle check via touchInput.moveX/moveY.

Don't write the pad into touchControls' state. render() calls setTouchControlsActive(false) on every non-portrait layout pass, which resets that state, and every touch read is gated on `active`. So a pad would be silently ignored on tablets and in landscape, which is exactly where it's needed.

Instead, add a separate gamepadInput module and a small merged getter (e.g. getVirtualInput()) used at all five call sites, with per-frame edge detection for the pressed flags.

Two smaller points:
- Browsers don't report a pad until a button is pressed after page load. Use a "press any button" hint, not just a "connected" toast.
- Wiring the mann.cool postMessage controller is out of scope: no 'keyEvent' listener exists in src, and WAMP runs standalone at wamp.land.

Effort: about a day with agents for play mode only, since editor and menu navigation by pad aren't needed. Testing on real iOS Safari and Android Chrome with a pad is the main cost.

### F092: Phone landscape and all tablets get zero touch controls in play

_Merged into F075; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** defect · **impact:** high · **effort:** medium

**Summary.** On an iPad (any orientation) or a phone held sideways, pressing Play puts you in the level with no joystick and no jump button, and nothing tells you to rotate. The timer starts, but the character can't move. Anyone on a tablet, or on a phone in landscape, can't play at all.

**Technical detail.**

The on-screen controls only render when deviceClass==='phone' AND orientation==='portrait' (src/ui/mobile/controller.ts:408-414 → portraitPlayControls.render(isPortraitPlay) at :484). deviceLayout.ts:36-43 labels any coarse-pointer screen whose shortest edge is over 540px as 'tablet', so iPads never qualify. The mobile smoke test locks this in: it asserts the controls are hidden and that no rotate gate exists in phone landscape (scripts/mobile_smoke.mjs:741-744). Fix: (1) Enable the joystick/jump/action cluster for any coarse-pointer device in play-world. For landscape, use a split layout (stick bottom-left, buttons bottom-right, overlaid on the canvas with ~30% opacity) so the HUD doesn't need the portrait bottom band. (2) If landscape can't be supported yet, show a 'Rotate your phone to play' gate and pause the run timer until the device is portrait. (3) Update mobile_smoke to assert touch.active===true in phone-landscape and tablet play.

**Evidence.**

- Live, Playwright iPhone UA at 812x375: after Play Room, render_game_to_text().touch.active=false, #mobile-play-controls has class 'hidden', no rotate hint in the DOM. Tapping the canvas didn't move the player (p=(-6952,-1821) before and after) while the timer ran (t=20915→21456ms)
- Live, 820x1180 tablet with touch: deviceClass='tablet', touchActive=false, mobile-play-controls hidden, mode=play (screenshot: half-black screen with the room HUD panel covering the room)
- src/ui/mobile/controller.ts:408-414 — isPortraitFocusedRoom requires isPhone && orientationState==='portrait'
- src/ui/deviceLayout.ts:36-43 — shortestEdge > 540 → 'tablet' (every iPad)
- scripts/mobile_smoke.mjs:741-744 — smoke asserts controls hidden and '#rotate-gate' absent in landscape play

**Fact-check (confirmed, confirmed, confirmed).**

One caveat: "can't play at all" is true for touch-only devices. An iPad or phone with a hardware keyboard attached can still move with the arrow keys or WASD, because movementController still reads cursors and WASD. Gamepads are not supported anywhere. Also worth noting for the fix: docs/product/product-requirements.md:28 claims landscape-first mobile play support, which is stale. The tablet smoke scenario (scripts/mobile_smoke.mjs:817-824) only checks browse, so no test covers tablet play at all.

Small refinements, none of which change the core claim:
1. Touch-only devices are blocked, but an iPad or tablet with a hardware or Bluetooth keyboard can still play.
2. This is a regression from commit 6f3fe3e4 (Apr 2026), which removed the legacy D-pad and the rotate gate. It is not a gap that was never filled.
3. Tablets in portrait also get no controls. Simply letting tablets in won't work, because the CSS at src/styles/sections/responsive/phone-portrait-play-controls.css:57 only targets phone + portrait, so it needs new layout rules too.

Small fix to the claim: on phones in landscape this is a silent trap, not a hard block. Rotating to portrait mid-run brings up the joystick and buttons, because the controller re-renders on DEVICE_LAYOUT_CHANGED_EVENT (controller.ts:123). Only tablets are blocked in every orientation. The missing rotate gate was removed on purpose in commit 6f3fe3e4. A quick first fix is to show an in-play "rotate to portrait" hint on phones in landscape (small effort). Supporting tablets and landscape properly also needs changes to the camera settings, which key off mobilePortraitPlay (camera.ts:77-85, OverworldPlayScene.ts:5880).

### F097: Welcome 'Play' drops newcomers into a walk-right room that teaches nothing; make it a 3-room starter run

_Merged into F126; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** idea · **impact:** high · **effort:** small

**Summary.** The Welcome 'Play' button sends everyone to 'de ja vu 1', which you beat by holding right for 4 seconds. You never jump and never learn the controls, and afterwards there's nowhere obvious to go. A short curated run (move → jump → hazards → a fun community room) would teach the game and show off the best player-made rooms.

**Technical detail.**

Commits fa460144/9cd7a1eb route welcome arrivals to room -11,-6. Instead, have btn-welcome-play start a curated room sequence with the existing room-sequence controller (src/ui/setup/roomSequenceController.ts; the #room-sequence-hud with Stop/Restart/Next in index.html). Use 3-5 hand-picked rooms, for example the existing '🍄 Learn2WAMP' rooms by KamiSawZe (seen in Explore), followed by 2 Featured EASY rooms. Show a one-line control hint per room via the goal intro. End with a summary card ('3 rooms cleared, +60 XP → Save progress / Build your own'). Keep the list in a small config or an admin-curated playlist so Jonathan can swap rooms without code.

**Evidence.**

- Live: Welcome → Play put the player in -11,-6 'de ja vu 1' (goal reach_exit). Holding ArrowRight alone completed it (no jump input needed): Exit reached at about 4s of running
- Explore → Top Rated lists '🍄 Learn2WAMP 3' (KamiSawZe, MEDIUM), so tutorial-style community rooms already exist
- git log: fa460144 'Send welcome tutorial to room -11,-6'
- index.html room-sequence-hud already has Stop/Restart/Rate/Next/Comment buttons

**Fact-check (partially confirmed).**

The reviewer's main point is overstated. Room -11,-6 is room 1 of Jonathan's own sign-guided De Ja Vu tutorial chain: room 2 at -10,-6 says 'You have to jump.', room 3 says 'up up up the ladder', room 4 has hazards. The chain continues by walking right. The real problem is that the Welcome Play button starts only that one room, with no progress HUD and no 'next', so new players don't know a series continues.

Fix using what already exists:
1. Jonathan creates a public playlist, e.g. slug 'learn-wamp', containing De Ja Vu 1..N plus 1-2 community rooms. He can reorder it later in the existing playlist UI, with no code.
2. Change welcomeModal.handlePlayAction to call playlistModal.open(slug, {autoPlay: true}). Alternatively, add an autoPlay flag to the PLAYLIST_OPEN_REQUEST_EVENT detail. That gives the room-sequence HUD with '1/N', Next/Finish, forceGoalIntro and the controls intro. Fall back to -11,-6 if the playlist fails to load.
3. Add one-line hints in each room's existing goalIntroText field. This is data, not code.

Genuinely new work:
(a) A completion card replacing the bare 'Playlist complete.' text, showing rooms cleared and XP with Save progress / Build your own buttons.
(b) A touch-controls version of the controls intro for phones, because shouldShowDesktopControlsIntro currently skips phones entirely.

Root visits also land on -11,-6 (commit 9cd7a1eb, src/navigation/defaultArrival.ts), so this chain is the de facto first impression for every visitor.

### F102: The loading screen waits for the whole asset catalog: about 500 files, including 221 separate tree PNGs

_Merged into F013; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** docs/2026-07-13-code-health-and-performance-recommendations.md §2.6 (load non-default background packs on first use; it called boot preload 'in good shape' at 15 load calls, but it's now 479 groups) and docs/2026-06-10-repo-improvement-plan.md §1.3 (overlap the world chunk fetch with the asset preload)

**Summary.** Before you see anything, WAMP downloads every tileset, every background, every enemy and every decoration: about 500 files and 3.5 MB of art, most of which the first room never uses. On a throttled phone profile it took about 12 seconds to get past the loading screen.

**Technical detail.**

BootScene.preload (src/scenes/BootScene.ts:71-84, 137-160) loads all TILESETS, every BACKGROUND_GROUPS layer, and every GAME_OBJECTS sheet (479 asset groups per the boot log). That includes DEVKIDD_TREE_DECORATION_OBJECTS (src/config/objects.ts:217-226): 221 individual 'assets/objects/trees/devkidd/<family>/tree-NN.png' files, about 1.5 MB. Fix: (1) pack trees, deco, and enemy extras into a few texture atlases (Phaser load.atlas) to cut about 400 requests; (2) at boot, preload only the player, UI, core hazards/collectibles, and the tilesets/backgrounds referenced by the arrival room's snapshot, and lazy-load the rest per room via the same ensure-loaded pattern used for avatar packs and custom backgrounds; (3) start the world chunk/snapshot fetch in main.ts in parallel with the asset preload (the boot log shows world-stream starting about 1s after boot-scene:assets-complete).

**Evidence.**

- Live boot log: 'boot-scene:preload-start {assetGroupCount: 479}'
- Playwright cold load (cache disabled): 504 unique static asset files, 3,551 KB, including 221 unique /assets/objects/trees/devkidd/* PNGs (each also requested twice: once as Image, once via the Phaser XHR loader)
- Throttled phone profile (9 Mbps, 60ms RTT, 4x CPU, iPhone UA): DOMContentLoaded 642ms, splash gone at 12,069ms. Note this run used the legacy chunk fallback because my harness blocked POSTs, which adds about 2 MB
- Pane boot log: assets-complete +14543ms → overworld-refresh:start +15542ms, so the world fetch is serial after assets
- src/config/objects.ts:217-226 — one GameObjectConfig per tree variant with its own path

**Fact-check (confirmed).**

Minor: an early world-tile bootstrap already exists (src/main/earlyWorldTileBootstrap.classic.ts, inlined via vite.config.ts:90-115). It is meant to overlap the coarse world tile fetch with the asset preload, but production's /api/world/tiles/config currently returns available:false because the asset-contract hashes don't match, so it does nothing right now. Fix (3) should mention re-enabling or keeping it enabled, as well as prefetching the chunk/snapshot window in main.ts. Config-referenced boot art is about 434 unique files / 2.1 MB; the 504 files / 3.5 MB measured includes avatar atlases, FX sheets and other extras.

### F103: Phone HUD text is 7-8px and most buttons are under 44px tall

_Merged into F109; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** On a phone, labels like 'More +', 'Room −', Settings, Guestbook and Controls are 7px pixel-font text on buttons about 28-30px tall. They're hard to read and easy to mis-tap, especially for kids and older players.

**Technical detail.**

src/styles/sections/responsive/phone-chrome.css:34-41 sets the phone bottom-bar buttons to font-size 7px / min-height 30px, and :91-95 does the same in play-world. There are 12 'font-size: 7px' rules and 66 rules at ≤8px across src/styles. Measured on 375x812: menu-toggle 36x36, More+/Room− 41x28 at 7px, world-selected-creator-card 53x14, footer buttons 75-119x30 at 7px, Play/Edit/Build 90x34 at 8px. Fix: set a floor of 10px for pixel fonts on phones, at least 44x44 hit areas (padding or ::after hit-slop if the visual must stay small), and hide desktop-only footer items (Controls lists keyboard keys) from the phone bottom bar to free room.

**Evidence.**

- Live Playwright iPhone 375x812 getBoundingClientRect: 'btn-mobile-world-hud-details "More +" 41x28 fs=7px', 'btn-mobile-world-hud-minimize "Room −" 41x28 fs=7px', 'world-selected-creator-card 53x14', 'btn-world-settings 75x30 fs=7px', 'btn-world-play 90x34 fs=8px', 'menu-toggle 36x36'
- Phone landscape 812x375 in play: footer buttons 77x20 and 100x24
- src/styles/sections/responsive/phone-chrome.css:34-41 — min-height: 30px; font-size: 7px
- No horizontal overflow at 375 or 812 widths (scrollWidth == clientWidth), so this is purely sizing

**Fact-check (confirmed).**

Three small corrections. (1) The More+/Room−, creator-card and Play/Edit/Build sizes come from src/styles/sections/responsive/phone-world-chat.css:63-67, :93-113 and :123-129, not phone-chrome.css. phone-chrome.css:34-41 and :84-96 cover only the bottom bar and footer. (2) The Controls modal is not keyboard-only: index.html has a 'Mobile' controls-section (around line 2922, 'Tap — Select room / place terrain'). Hiding the Controls button on phones should therefore be presented as an optional way to free space, not as a fix for wrong content. Alternatively, make the modal show only the Mobile section on touch devices. (3) Some text is smaller than the claim says: the state pill is 6px (phone-world-chat.css:89) and there is another 6px rule at :327.

### F105: About 1 in 5 'Top Rated' rooms is called 'Untitled Level': ask for a name at publish

_Merged into F133; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** small

**Summary.** In Explore, 10 of the first 48 top-rated rooms are named 'Untitled Level', so good rooms are hard to tell apart, remember or share. Expanded rooms already require a title before publishing; single rooms don't.

**Technical detail.**

exploreModal.ts:1076 falls back to 'Untitled Level' when roomTitle is empty. Single-room publish validation (src/scenes/editor/editRuntime.ts:2856-2864) checks only goal requirements, while expanded rooms block publish without a title (src/courses/editor/state.ts:224 'Add an expanded room title before publishing.'). Fix: on Publish with an empty title, show a quick inline prompt in the publish confirmation: a prefilled fun suggestion (e.g. '<Tileset> <GoalType> #<x,y>', or a two-word random name) the builder can accept with one tap. Optionally let the Explore card show '<creator>'s room x,y' instead of 'Untitled Level'.

**Evidence.**

- Live Explore (Top Rated, ALL): 48 cards, 10 titled 'Untitled Level' (e.g. by tmndz, fidgetmcwidget, jonathan, PlayGame4Fun, paulmaduagwu, flalaski, tkinter)
- src/scenes/editor/editRuntime.ts:2856-2864 — getPublishValidationError only calls getRoomGoalPublishValidationError
- src/courses/editor/state.ts:224 — expanded rooms already require a title
- Editor top bar shows the placeholder 'NAME THIS ROOM' but publish doesn't enforce it

**Fact-check (confirmed).**

Small fixes only. The Explore file is at src/ui/setup/exploreModal.ts:1076, not just "exploreModal.ts". The same fallback text also appears in src/ui/setup/roomSequenceController.ts:325 ('Untitled Level') and src/ui/setup/runRatingModal.ts:1160 ('Untitled Room'). A "<builder>'s room x,y" fallback should change those spots too, so names stay the same everywhere. The discovery response already includes builderDisplayName and roomCoordinates, so that fallback needs no API change. Put the title prompt in persistence.publishRoom (src/scenes/editor/persistence.ts:110), before the busy overlay. It should also work in the phone editor layout, because AGENTS.md requires mobile support.

### F106: New builders still start on a blank black canvas (starter templates not shipped)

_Merged into F163; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** docs/product/backlog.md G-001 (Codex Ready, High)
- **Already in the product backlog.**

**Summary.** Welcome → Build opens a completely empty room with no starting layout and no checklist ('1. draw ground 2. place start 3. place goal 4. test 5. publish'). The editor itself looks great, but a blank page is the hardest place to start, especially for kids.

**Technical detail.**

Backlog G-001 is still 'Codex Ready'. I found no template code in src. The Beginner dock (Terrain/Stuff/Characters/Hazards/Deco/Markers) makes this easy to add: on a fresh frontier room, show a 'Start from…' strip in the Terrain drawer with 4 templates (Flat run, Stairs, Vertical climb, Platform chain) as RoomSnapshot fragments (terrain + spawn + exit goal) applied through the existing history so Undo works. Add a small dismissible checklist chip near Test/Publish that ticks off ground → spawn → goal → test → publish, using state already exposed (spawnPoint, goal, canPublish).

**Evidence.**

- Live: Welcome → Build → Beginner opened room 9,14 empty; visible editor text had no guidance besides tool labels (Terrain/Brush/Draw/Erase/…/Test/Publish)
- Editor state after load: spawnPoint=null, goal=null, placedObjects empty
- docs/product/backlog.md G-001 'Starter room templates' Status: Codex Ready, Priority: High
- grep for 'starterTemplate|roomTemplate|room-template' in src returns nothing

**Fact-check (confirmed).**

These corrections only affect the suggested build, not the finding itself. (a) `canPublish` in the editor state is a permission flag (EditorScene.ts:2083 `canPublish: this.roomPermissions.canPublish`), not a sign the room is ready to publish. The checklist's "publish" tick needs to check whether the room has actually been published. (b) Rooms can be published without a goal (commit d6292ef6 "Show goal-free published rooms in Explore Newest"), so "place goal" should be an optional step, not something that blocks publishing. (c) Templates have to fill in smartTerrain state (roomModel.ts:432 `smartTerrain`) as well as raw tileData, so Smart/Beginner terrain still auto-tiles cleanly after edits, and they should be applied as one undoable history step. (d) There are a few small editor hints already (the Terrain drawer's brush description, uiBridge.ts:2215, and a goal placement hint), but nothing that guides a first-time builder from start to finish.

### F107: Developer-facing copy shown to players (Controls note, Explore 'focus x,y · v1', switch-block status in browse)

_Merged into F119; track it there._

- **Area:** Live play-through (desktop + mobile, browser)
- **Type:** improvement · **impact:** low · **effort:** small

**Summary.** A few internal notes reach players: the Controls window ends with 'Custom control remapping can layer onto this later without changing the basic world HUD.' Explore cards say things like '2 cells · v1 · focus -4,12'. After leaving a room, 'Blue blocks active.' lingers in the room panel and footer. Small things, but they make the game feel unfinished.

**Technical detail.**

index.html:2933 contains the remapping note; replace it with something useful ('Tip: press 9 to toggle follow cam') or delete it. src/ui/setup/exploreModal.ts:1097 builds '${cellCount} cells · ${versionText} · focus x,y'; show '2-room level · by X' and drop the version and focus coordinates. triggerController.ts:394 emits 'Red/Blue blocks active.' via showTransientStatus; clear transient statuses when switching play→browse, so the browse panel doesn't show stale play state.

**Evidence.**

- index.html:2933 — 'Custom control remapping can layer onto this later without changing the basic world HUD.'
- Live Explore cards: 'CYBERTOWERS 2 CELLS · By Farès · 2 cells · v1 · focus -4,12'
- src/ui/setup/exploreModal.ts:1097 — `${expandedRoom.cellCount} cells · ${versionText} · focus ${x},${y}`
- Live after Esc from room -11,-6: left panel and footer both showed 'BLUE BLOCKS ACTIVE.' (screenshot d-after-stop)
- src/scenes/overworld/liveObjects/triggerController.ts:394 — showTransientStatus('Red blocks active.' / 'Blue blocks active.')

**Fact-check (partially confirmed).**

The "Blue blocks active." message is not stuck. It is a 4.2-second transient (OverworldPlayScene.ts:3099), and the browse HUD re-renders every 100 ms (OverworldPlayScene.ts:2349/5905), so the message disappears about 4 seconds after the switch was hit. The real bug is narrower: returnToWorld → resetPlaySession → resetTransientPlayState (OverworldPlayScene.ts:4778) resets the switch states but leaves transientStatusMessage set. For a few seconds the browse panel and footer report play-mode state that was just reset. The fix is to clear transientStatusMessage and transientStatusExpiresAt in resetTransientPlayState, or in flow.ts returnToWorld.

The Explore card also repeats the cell count: exploreModal.ts:1081 makes an "N cells" badge and :1097 says "N cells" again. Drop the cell count from the :1097 meta line as well as the version and focus text.

For the Controls note at index.html:2933, delete it or replace it with something new. "9 = follow cam" is already in the list at :2918.

### F110: Phone builders still get the editor from before the redesign

_Merged into F161; track it there._

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** high · **effort:** large

**Summary.** The new chunky editor (Draw/Erase/Fill tiles plus the Terrain/Stuff/Characters/Hazards/Deco/Markers dock) only runs on desktop and tablet. On a phone, builders get the old dark slide-up sheet with different tabs (Tools/Background/Palette/Objects/Goal), black native dropdowns inside a cream panel, and hints that say 'right-click'. Building on a phone looks and works like an older, different game.

**Technical detail.**

isEditorDockShellActive() returns false when deviceClass==='phone' (editorDockShell.ts:186-189). The ledger records this as intentional: 'Phone and expanded-room shells remain unchanged' (feature-ledger.md:13). Expanded rooms later got dock parity (feature-ledger.md:7); phones did not. The phone path uses #sidebar as a fixed sheet (phone-editor-shell.css:41-58): rgba(11,11,11,.96) background, backdrop-filter blur(6px), 16px top radius and a soft 48px shadow. That is the blur style docs/product/design-ideas.md says to avoid, and a backdrop blur over a WebGL canvas that redraws every frame costs GPU on every frame. The tab strip #mobile-editor-nav (index.html:2022-2035) uses legacy IBM Plex .bar-btn tabs. Proposed phone layout, reusing the dock's structure: (1) bottom: the same six dock tiles as a horizontally scrollable 56px icon strip; (2) the Draw/Erase/Fill/More tools as a vertical floating rail on the stage's left edge; (3) the dock's contextual drawer becomes the slide-up sheet, reusing the panel DOM the dock already renders, with a drag handle and 3 snap heights; (4) top bar: Back/Test/Publish chunky buttons; (5) no blur or radius; use a 3px ink border and a hard 4px shadow. Make the 'Right-click or Erase removes it' hint depend on the device (index.html:667, src/scenes/editor/uiBridge.ts:2219), e.g. 'Tap with Erase to remove' on touch. Ship one drawer at a time and extend the smoke:editor-dock 390x844 checks.

**Evidence.**

- src/ui/setup/editorDockShell.ts:186-189 — dock shell disabled when deviceClass === 'phone'
- feature-ledger.md:13 — 'Phone and expanded-room shells remain unchanged'
- src/styles/sections/responsive/phone-editor-shell.css:53-56 — dark bg, backdrop-filter: blur(6px), border-radius 16px 16px 0 0
- index.html:2022-2035 — phone tabs Tools/Background/Palette/Objects/Goal vs desktop dock Terrain/Stuff/Characters/Hazards/Deco/Markers
- index.html:667 and src/scenes/editor/uiBridge.ts:2219 — 'Right-click or Erase removes…' shown on touch devices
- headless render: scratchpad/shots/editor-phone.png vs editor-dock.png

**Fact-check (partially confirmed).**

Drop or narrow the performance claim. In portrait (phone-editor-shell.css:15-38) the canvas is laid out above the sheet, so the backdrop-filter blur (line 54) has no animated WebGL content behind it. The per-frame GPU cost only applies in phone landscape, where the fixed sheet covers the canvas. The blur is still worth removing, mainly because design-ideas.md:4 says to avoid soft blur. The desktop dock has eight tools (Draw, Erase, Copy, Fill, Scramble, Rectangle, Circle, Line), not three. Add the related bug: mobile-controls.css:169-181 combines justify-content: center with overflow-x: auto on .mobile-editor-nav, so the "← World" tab is clipped and can't be scrolled to at 390px wide (visible in editor-phone.png).

### F111: Dying is instant and almost silent; give it a short beat

_Merged into F147; track it there._

- **Area:** Visual design, UI polish & information architecture
- **Type:** improvement · **impact:** medium · **effort:** medium

**Summary.** When you die in normal play, a small hit effect plays and you're teleported back on the same frame. The only sound is the respawn chime: no death sound, freeze, shake or fade. A ~0.3-second death beat (freeze, pop, shake, quick fade back), the way Celeste and Super Meat Boy do it, makes failure readable and satisfying. That matters in a game full of hard rooms.

**Technical detail.**

OverworldSessionResetController.handlePlayerDeath (sessionReset.ts:51-63) calls playPlayerFailFx() and then respawnPlayerToCurrentRoom() in the same call. The fail-FX host passes cue null (OverworldPlayScene.ts:1630-1634), so no fail sound plays. Respawn plays 'respawn' (OverworldPlayScene.ts:4435). The 'player-death' cue is defined (sfx.ts:31, :170-175) but never called. Camera shake is used only for sword/PvP hits (combatController.ts:157,167,258; pvpLocalPresentationController.ts:80-81). Goal success (fx/controller.ts:170-183) is sprites plus a ring only: no hit-stop or flash. Proposal: add a short 'dying' state in handlePlayerDeath. Disable player input and the body for ~120ms of hit-stop, play 'player-death', burst plus ring at the death point, cameras.main.shake(140, 0.004), then fadeOut(90) / respawn / fadeIn(120), ≤350ms in total. Decide whether ranked timers pause during it so leaderboards stay comparable. For success, add 80ms of hit-stop and a short warm flash. Add a 'Reduce motion' setting that also honors prefers-reduced-motion (currently used only in jam.css:931 and roomComments.ts:1670) to turn off shake and flash. Put the timings in debug_options booleans/consts so Jon can tune them by feel.

**Evidence.**

- src/scenes/overworld/sessionReset.ts:60-63 — recordDeath → playPlayerFailFx → respawnPlayerToCurrentRoom, same tick
- src/scenes/OverworldPlayScene.ts:1630-1634 — fail FX invoked with cue null (no sound)
- src/scenes/OverworldPlayScene.ts:4410-4436 — respawn is immediate, plays 'respawn'
- src/audio/sfx.ts:170-175 — 'player-death' cue defined; grep finds no playSfx('player-death') call
- src/scenes/overworld/combatController.ts:157,258 — shakeCamera only used on combat hits

**Fact-check (partially confirmed).**

The claim's facts about the code are accurate, but it misses that commit 1eccec1b (2026-03-16, "Refine world warp and respawn audio") deliberately removed the player-hurt, player-death and goal-fail sounds from the death path, leaving only the respawn chime. Any fix should replace that with one chosen death cue, for example play 'player-death' and drop or delay 'respawn', rather than stacking several sounds again. Death is also not entirely silent or unexplained: bomb deaths play the 'enemy-kill' explosion sound, and every death outside a run shows its reason as a HUD status for 4.2s (OverworldPlayScene.ts:3097). A deferred "dying" state needs a re-entrancy guard, because maybeRespawnFromVoid runs every frame (OverworldPlayScene.ts:4398-4407) and the overlap death callbacks can fire again. The run-mode branching in sessionReset.ts:65-110 would also have to be deferred. Keep the respawn delay short (or zero in ranked/speedrun contexts) so restarting stays fast.

### F136: 'Race the #1 ghost': the game already records the top run's path

_Merged into F142; track it there._

- **Area:** New-player experience, retention & community loop
- **Type:** idea · **impact:** medium · **effort:** medium

**Summary.** When someone sets a #1 or top-10 time, WAMP saves their path through the room (positions every quarter second) to verify the run, but nobody ever sees it. Showing a see-through "ghost" of the record holder while you play, plus a "Race my ghost" challenge link, would make leaderboards exciting and give players a strong reason to share.

**Technical detail.**

verificationTrace.ts:12-21 defines breadcrumbs {atMs, roomX, roomY, x, y, vx, vy, grounded}, sampled every 250 ms (rankedRunTraceRecorder.ts:11) and capped at 2,048 (verification.ts:22). verification.ts:328-350 persists the full trace in run_verification_audit.trace_json whenever verification triggers: take_top_1, enter_top_10, record_gap, point_gain (verification.ts:412-423). admin/routes.ts:460-499 already reads it back. Build: GET /api/rooms/:id/ghost?version=, returning the breadcrumbs (no input events) of the current #1 verified attempt for the current version, cached publicly per version. The client interpolates positions between samples and draws one translucent sprite of the leader's avatar, with a 'Race #1' toggle in the room HUD (off by default; auto-on via /r/x/y?race=1). Add a 'Race my ghost' share variant to the run-share card. Performance: one extra sprite and an O(1) lookup per frame; skip it in Battery Saver mode.

**Evidence.**

- src/runs/verificationTrace.ts:12-21 — breadcrumb positions/velocities recorded for ranked runs
- src/scenes/overworld/rankedRunTraceRecorder.ts:11 — BREADCRUMB_INTERVAL_MS = 250
- src/cloudflare/worker/runs/verification.ts:328-350 — trace_json stored in run_verification_audit
- src/cloudflare/worker/runs/verification.ts:412-423 — traces are captured for take_top_1 / enter_top_10 runs

**Fact-check (partially confirmed).**

Drop "the game already records the top run's path." The server stores traces only for T0 accounts, and even then not always for the current #1 time (see reasoning). Building GET /ghost on run_verification_audit would return nothing for most leaders.

Instead, at the end of the room, course and expanded-room finish routes (runs/routes.ts, courses/routes.ts, expandedRooms/runRoutes.ts), check whether a completed run became the new #1 for (content id, version). If it did, save its breadcrumbs plus roomTransitions, without inputEvents, to a new ghost table or R2 key. Do this for every trust tier, and replace the stored ghost when the record improves.

Other adjustments:
- Offer the ghost only on time-ranked leaderboards (getLeaderboardRankingMode). A score-ranked "ghost" means little.
- Sampling at 250 ms is coarse for jump arcs. Use Hermite interpolation with the recorded vx/vy, or record a denser ghost-only stream.
- Give it a distinct name in the UI, such as "Record run" or "Rival," so players don't confuse it with the live-player presence ghosts.
- Set in_backlog=true (product-requirements.md:461).

### F160: Every pinch-zoom on touch leaves a stray tile, object, or flood fill

_Merged into F079; track it there._

- **Area:** Level building / editor UX
- **Type:** defect · **impact:** high · **effort:** small

**Summary.** On phones and tablets, the first finger of a two-finger pinch is treated as a paint stroke and saved. Zooming or panning drops a tile or enemy where your finger landed, and with the Fill tool it floods a whole area. Builders end up undoing after nearly every zoom, and on tablets there's no Undo button.

**Technical detail.**

handleTouchPointerDown (interaction.ts:1084-1190) acts on the first finger immediately: handleToolDown + beginTileDrag for drawing, floodFillObjects for Fill, and handleObjectPlace/placeObjectAtTile for objects. When the second finger arrives, interaction.ts:1101-1104 calls finishCurrentTouchDraw(), which commits the partial stroke (interaction.ts:1292-1309: commitObjectBatch/commitTileBatch) as a real undo entry before beginPinchGesture(). Fix: treat the first touch as provisional. Either (a) hold the first touch's action for ~90 ms or until it moves past ~6 px, and if a second pointer arrives first, discard it; or (b) keep acting immediately, but when a second pointer arrives within ~150 ms with little movement, roll back the in-progress batch. For tiles, revert the currentBatch oldGids and restore currentBatchSmartBefore. For objects, restore objectBatchBefore. Then clearTileBatch() instead of commit. Fill and object single-place should always use (a). Add a unit test with a synthetic two-pointer sequence asserting no history entry is recorded.

**Evidence.**

- src/scenes/editor/interaction.ts:1101-1104 — second finger → finishCurrentTouchDraw() then pinch
- src/scenes/editor/interaction.ts:1292-1309 — finishCurrentTouchDraw commits the tile/object batch
- src/scenes/editor/interaction.ts:1144-1152 — first touch immediately flood-fills or places objects
- src/scenes/editor/interaction.ts:1186-1190 — first touch immediately paints via handleToolDown

**Fact-check (confirmed, confirmed, confirmed).**

The core claim and line numbers are correct. A few details need adjusting:

1. **"Every pinch" is too strong.**
   - It only happens when the first finger lands inside the room bounds. handleToolDown returns early outside the room (tools.ts:175-177), and floodFillObjects and handleObjectPlace check bounds too (editRuntime.ts:1690, 1888).
   - The tool also has to actually change something. commitTileBatch drops no-op batches (editRuntime.ts:744-752), so penciling onto an identical tile records nothing.
2. **Tile Fill is committed earlier than the claim says.** It commits inside handleToolDown (tools.ts:198-202) before the second finger ever arrives, not in finishCurrentTouchDraw. Rolling back the batch (option b) cannot undo it. Fill needs the deferred-action approach (a), or a history pop. The claim already recommends (a) for Fill and single object placement.
3. **The bug covers more cases than listed.**
   - The first finger also erases tiles or objects with the Eraser, and can delete the goal marker (interaction.ts:1131).
   - In goal-placement mode it moves the goal (1123-1128).
   - If a two-tap shape or line is half done (rectStart set), the pinch's first finger completes and commits the shape (1160-1176).
4. **"Saved" means less than it sounds.** The change becomes an undo-history entry and marks the draft dirty; it is not published.

"Every pinch" is a slight overstatement. It happens when the first finger lands on an editable cell inside the room while using pencil (the default), eraser, randomize, tile Fill, object Fill or object placement. A pinch that starts outside the room does nothing (tools.ts:175-177), and so does one that starts on an unchanged cell, because empty batches are skipped. With rect/ellipse/line/copy, the first finger only sets rectStart, and finishCurrentTouchDraw then clears it. One related case the claim misses: if one shape corner is already tapped, the first finger of a pinch completes and commits that shape (interaction.ts:1157-1180). With eraser the stray change is an erased tile, not a placed one. Single object placement through handleObjectPlace records its own history entry outside any batch, so rollback option (b) won't catch it. Deferring the first touch (option a) is the right fix there, as the claim says.

"Every pinch-zoom" is slightly overstated:
- Rect, ellipse, line and copy with no corner set only record a start corner, and finishCurrentTouchDraw clears it via clearShapePreview (interaction.ts:188-189). No stray edit.
- A first finger landing outside the room does nothing (tools.ts:175-177).

The claim also understates some of the damage:
- The eraser silently deletes a tile on each pinch, which is harder to notice than an added one.
- With a shape tool, if the builder has already tapped the first corner, the first finger of a pinch completes the shape and commits it at that finger's position (interaction.ts:1155-1176).
- In goal-placement mode, the first finger of a pinch moves the goal marker (interaction.ts:1122-1127).

The fix should defer all of these paths, not only drawing, Fill and object placement. Pair it with an on-screen Undo for the tablet editor, since mobile-editor-nav is shown on phones only (mobile/controller.ts:463-466).

### F164: Show builders how their room is doing: plays, clears, clear rate, and where players die

_Merged into F124; track it there._

- **Area:** Level building / editor UX
- **Type:** improvement · **impact:** medium · **effort:** medium
- **Flagged before:** PRD product-requirements.md:286 lists creator stats (total plays, most played) as future work; not built.

**Summary.** After publishing, builders only see star ratings and a difficulty badge. They never learn whether anyone cleared the room, how many people gave up, or where players keep dying, and that feedback is what makes Mario Maker builders improve. The server already records the result and death count of every attempt, but only the admin dashboard sees totals.

**Technical detail.**

room_runs stores result (completed/failed/abandoned) and deaths per attempt (migrations/0003_runs_and_leaderboards.sql:15-29). admin/launchStats.ts:841-844 already computes completed, failed and abandoned counts with SUM(CASE…), but only for Launch Admin. The builder-facing card (profileModalRoomRenderer.ts:117-123; ProfilePublishedRoomEntry in profiles/model.ts:10-20) has only difficulty and quality. Phase 1 (small): add GET /api/rooms/{id}/stats?version=… returning attempts, unique players, clears, clear rate, median clear time, avg deaths per clear and abandon rate. It's a single indexed query on idx_room_runs_room_version_result, cacheable for 5 minutes. Show it in the editor Room/Share panel and on profile room cards, with a nudge such as 'Only 4% clear this room. Consider an easier first jump.' Phase 2 (medium): record death positions. Append {x,y,cause} to the existing ranked run trace or a small capped room_deaths table, sampled to at most N per room-version. Render a heat overlay in the editor (an 'Insights' toggle) using the existing overlay graphics layer (scenes/editor/overlays.ts).

**Evidence.**

- migrations/0003_runs_and_leaderboards.sql:15-29 — room_runs has result + deaths per attempt
- src/cloudflare/worker/admin/launchStats.ts:841-844 — completed/failed/abandoned counts exist for admin only
- src/ui/setup/profileModalRoomRenderer.ts:117-123 — builder room card shows difficulty + stars only
- docs/product/product-requirements.md:286 — 'Creator: Still future work — most played rooms, highest-rated rooms, total plays'

**Fact-check (partially confirmed).**

Room_runs only records attempts by signed-in players on rooms that have a goal (runs/routes.ts:79-93); guest clears stay in the browser. Stats would undercount, and the UI should say they come from signed-in players. Builders can already see who cleared through the public room leaderboard (top-N ranked entries), and they get account-wide builder XP and unique-player badges. What is missing is per-room attempts, fails, abandons and clear rate. Phase 2 cannot reuse an existing run trace: trace_json is only saved in run_verification_audit for runs flagged for verification. Death positions need a new capped table and client-side capture. Median needs a workaround because SQLite has none. The stats query should use the same legacy-identity and verification filters as the leaderboard and dashboard queries.

### F176: Phone tap targets for Settings, Controls, Online and the creator card are 14–20px tall

_Merged into F109; track it there._

- **Area:** Accessibility & inclusivity
- **Type:** defect · **impact:** low · **effort:** small

**Summary.** In phone play mode the Settings, Controls and Players-Online buttons are only 20px tall, and the room creator's profile button is 14px. That's well under the 24px minimum, and far from the roughly 44px fingers need, so mis-taps are common, especially for younger players or anyone with a tremor.

**Technical detail.**

phone-chrome.css:85-91 sets `min-height: 20px; padding: 3px 7px` for #world-online-count, #btn-world-settings, #btn-world-controls and #room-save-status in play-world. phone-world-chat.css:93-94 sets .world-creator-card (a <button>, index.html:1786) to min-height 14px. Phone bar buttons elsewhere are 28–30px (phone-chrome.css:36-38, phone-world-chat.css:63-64). To keep the compact pixel look and still get at least 32x32 (ideally 44) hit areas, expand the hit area invisibly: `position:relative` plus `::after{content:'';position:absolute;inset:-8px}`, or raise min-height to 32px and trim the vertical padding. The big gameplay buttons are already fine (Jump 106px, others 74px), so this only affects HUD chrome.

**Evidence.**

- src/styles/sections/responsive/phone-chrome.css:85-91 — min-height: 20px for Settings/Controls/online/save status in play-world
- src/styles/sections/responsive/phone-world-chat.css:93-94 — .world-creator-card min-height: 14px
- index.html:1786 — world-selected-creator-card is a <button> (opens the builder profile)
- src/styles/sections/world/mobile-controls.css:115-119 — by contrast, the Jump button is 106x106px

**Fact-check (partially confirmed).**

The 20px Settings/Controls/Online buttons show only in landscape phone play-world. In portrait phone play, the main touch-control mode, the whole #bottom-bar is hidden by phone-portrait-world-hud.css:21-23 (gated by controller.ts:408-414). In landscape, the on-screen touch controls are off (portraitPlayControls.ts:65-66), so few players reach those buttons by touch. #room-save-status is a non-interactive <span> (index.html:2015) and should be dropped from the list. The Guestbook button in the same row keeps the 24px minimum (online-popover.css:34-39). The creator card (phone-world-chat.css:93-99, about 14px tall, any phone mode, mostly world-browse) is the clearest real problem. Frame both as ergonomic problems (below about 44px, easy to mis-tap), not as WCAG 2.5.8 AA failures: the targets are wide and spaced, so they probably pass the spacing exception. Fix: give the creator card at least 28-32px of hit area, for example `min-height: 28px` plus vertical padding, or an invisible `::after { inset: -8px }` hit area. Raise the landscape play-world bar buttons to the same 28-30px used in world mode (phone-chrome.css:34-38).

### F178: No gamepad support (which also rules out adaptive controllers)

_Merged into F148; track it there._

- **Area:** Accessibility & inclusivity
- **Type:** idea · **impact:** medium · **effort:** small

**Summary.** A platformer is most comfortable with a controller, and many disabled players rely on adaptive controllers (such as the Xbox Adaptive Controller) that show up in the browser as gamepads. WAMP ignores gamepads completely, though the existing touch-control plumbing makes adding one cheap.

**Technical detail.**

The Phaser config enables only mouse input (main.ts:97-101), and there's no getGamepads or gamepad reference anywhere in src. touchControls.ts is already a clean virtual input layer (moveX/moveY/jumpHeld + pressTouchAction edges) that movementController.ts:395-426 and the attack check (OverworldPlayScene.ts:2362-2363) consume. Add a gamepadInput module polled once per frame in the scene's update. Use navigator.getGamepads() directly, or enable `input: { gamepad: true }`. Reuse a preallocated state object (no per-frame allocation). Mapping: left stick/D-pad → moveX/moveY with a 0.3 deadzone; A/Cross → jump (held + just-pressed edge); X/Square → slash; B/RB → shoot; Start → pause; Select/View → camera toggle. Merge it with keyboard and touch in the same `isActionDown` layer proposed for remapping. Menu navigation with a gamepad can wait. Note that getTouchInputState() currently returns a fresh spread copy each call (touchControls.ts:71-73); return a readonly reference when adding the gamepad path.

**Evidence.**

- src/main.ts:97-101 — Phaser input config has only `mouse: { preventDefaultWheel: true }`; no gamepad
- src/ui/mobile/touchControls.ts:37-69 — setTouchMove / setTouchActionHeld / pressTouchAction are a reusable virtual-input API
- src/scenes/overworld/movementController.ts:395-426 — movement merges keyboard and touch, so a gamepad source slots in alongside
- src/scenes/OverworldPlayScene.ts:2362-2363 — slash/shoot take keyboard or touch edges only

**Fact-check (confirmed).**

Change the mapping. The game has no player-facing pause: the only pause handling is internal, for the goal intro and the performance advisor (OverworldPlayScene.ts:409, :454, :2929). Map Start to the existing 'stop' action (return to world, or end a Room Rush; :2313) and Select/View to 'restart' (:2322) or camera toggle (:2308). Also include in scope the ladder-drop check (:4326) and the "any input held" check (~:6153), and keep the gamepad state in its own module instead of routing it through touchControls' active-gated state. Menu and editor navigation stay pointer-only, so it is only a partial accessibility win.

### F195: Public room endpoint returns a 10 MB room history, and the agent guide sends every bot to it

_Merged into F026; track it there._

- **Area:** Trust & safety, moderation, ops & observability
- **Type:** defect · **impact:** high · **effort:** medium

**Summary.** Loading one room through the public API downloads every version ever published, with full contents. For the starter room (0,0) that is 10.5 MB and over 4 seconds. Anyone can request it in a loop, the agent instructions tell every bot to call it, and every publish loads that whole history three times.

**Technical detail.**

`loadRoomRecord` batches the room row with `SELECT ... snapshot_json FROM room_versions WHERE room_id=? ORDER BY version` and JSON-parses every version (rooms/store.ts:73-118, 826-848). Unauthenticated `GET /api/rooms/:id` returns it uncached (rooms/routes.ts:136-149). The publish route preloads it (routes.ts:402), then `publishRoom` → `loadRoomRecordForMutation` loads it twice more (store.ts:600-624). That's three full histories per publish, a risk to the Worker's CPU/memory limits as rooms age. Own-room republishes are unlimited (routes.ts:410-412), so history grows without bound. skill.md step 2 tells agents to 'Read the target room with GET /api/rooms/{roomId}' (public/skill.md:46). Measured on prod: `GET https://api.wamp.land/api/rooms/0,0` returned 10,526,904 bytes in 4.3s (176 versions). Fix: return version *metadata* only (no snapshot_json) from loadRoomRecord, since the paginated `/versions` and `/versions/:n` routes already exist. Mutation paths should load only the latest published version and the count. Point skill.md/openapi at `/current` and `/published`. Cap republishes, e.g. 60/day/room.

**Evidence.**

- src/cloudflare/worker/rooms/store.ts:826-848 — versions query selects snapshot_json for every version
- src/cloudflare/worker/rooms/routes.ts:136-149 — public uncached GET returns the full record
- src/cloudflare/worker/rooms/store.ts:600-624 — loadRoomRecordForMutation calls loadRoomRecord twice
- public/skill.md:46 — agents instructed to read rooms via the full-history endpoint
- Prod GET /api/rooms/0,0 — 10,526,904 bytes, 4.31 s; /versions?limit=1 shows version 176

**Fact-check (confirmed).**

Publish loads the full history four times, not three: once at routes.ts:402, twice inside publishRoom through loadRoomRecordForMutation (store.ts:990), and once more for the return value at store.ts:1137. Draft saves load it three times. More important, the player-facing paths also load the full history: run finish (runs/routes.ts:198), the room leaderboard (runs/routes.ts:505, measured at 0.4–0.9 s of room_record time for 0,0), ratings and difficulty votes (runs/routes.ts:538, 586), and the in-browser course composer and editor (CourseComposerScene.ts:396, CourseEditorScene.ts:1814). Room 0,0 is the starter room and it has a goal, so this hits ordinary first-time players, not only bots. The bot angle is weaker than claimed. Agents mostly build in claimable rooms, which have short histories, so the bigger risk from skill.md is anyone reading or polling old rooms. Agents that publish without `response=compact` also get the full record back in the publish response. My full GET took 6.9 s, not 4.3 s. Fix scope: load version metadata only, without snapshot_json. Look up exact versions on demand with loadExactRoomVersion, as run start already does at runs/routes.ts:88. Have mutations load only the latest published snapshot. About 31 server-side uses of record.versions need auditing, including awardRoomPublishPoints, which reads version.snapshot.goal. Also add /current and /summary to openapi.json and skill.md.

### F217: Let players join and browse jams from inside the game

_Merged into F128; track it there._

- **Area:** School/classroom accounts, Worlds pilot and Jam modes
- **Type:** idea · **impact:** medium · **effort:** medium
- **Already in the product backlog.**

**Summary.** Entering the jam meant leaving the game, filling a web form with your username, email and room coordinates, and hoping it matched. Entries were never visible in-game. A 'Enter this room in the current jam' checkbox when you publish, plus a 'Jam entries' tab in Explore and a jam portal sign, would turn every jam or weekly prompt into an event people can play together.

**Technical detail.**

The current flow is an external form keyed on typed username plus email (jam/routes.ts:109-160, loadMatchingJamAccount 183-208). Students (no email or username) and email-less wallet users can't enter at all, because findMatchingJamAccount requires both (routes.ts:207). Proposal: POST /api/jam/:slug/entries authenticated by session (rooms:write), with roomId. The server reuses assertJamRoomOwnedByAccount (routes.ts:211-238) with the configured windows. Show a checkbox in the publish dialog when a jam is active. Add a jam_slug filter to the Explore/playable-content index so 'Jam entries' is a tab. Add a simple judges page in launch-admin with per-judge scores stored in JAM_DB, matching the 19-point rubric already in jam.html:181. This is the 'events with in-game rewards like special avatars' idea from backlog G-013.

**Evidence.**

- src/cloudflare/worker/jam/routes.ts:109-160 — submission is an unauthenticated typed-identity form
- src/cloudflare/worker/jam/routes.ts:207 — accounts without both username and email can't match
- jam.html:181 — scoring rubric exists only as page text
- docs/product/backlog.md:222 — G-013 notes seasons and events with avatar rewards

**Fact-check (partially confirmed).**

Keep the idea but rescope it.
- **Fix the citations.** The match check is at routes.ts:209 and assertJamRoomOwnedByAccount is at routes.ts:212-243.
- **Phase 1 (small):** Make jams data-driven with a jams table (slug, title, open/close windows) instead of the JAM_SLUG and date constants in src/jam/model.ts. Add a session-authenticated POST that takes a roomId and reuses the ownership and claim-window check. Make username and email nullable in JAM_DB's jam_submissions (jam-migrations/0003), so students and wallet-only users can enter. Students might need teacher opt-in or a classroom-scoped jam.
- **Browsing:** Start with what already exists. Auto-create or curate a Room Playlist of the entries and pin it via Featured, rather than building a new Explore tab right away. If a tab is built later, copy jam_slug into the main DB, because JAM_DB is a separate D1 database and cannot be joined.
- **Phase 2:** Store judge scores in JAM_DB, shown in the existing launch-admin Game Jams section (admin/gameJams.ts).
- **Rewards:** Special-avatar rewards already exist as hand-granted entitlements (GameJew Red, registry.ts:188-195).
- **Backlog:** The link is only loose. G-013 mentions "seasons, events", and the avatar-reward wording is from ideas-inbox.md:47.

### F230: MT-32 drum kit loads one file at a time; early drum taps arrive later as one burst

_Merged into F023; track it there._

- **Area:** Room music system (composer, playback, audio engine)
- **Type:** defect · **impact:** medium · **effort:** small
- **Flagged before:** docs/2026-06-10-repo-improvement-plan.md:98-99 suggested reviewing public/assets/music size and format (lower priority); the serial-load problem was not covered

**Summary.** The first time any pattern music plays, or a builder taps a drum cell, the game downloads the 15 drum samples one after another instead of all at once. Music starts late and the first drum taps are silent, then all play together in a pile-up. One failed download also swaps that drum to a synthesized stand-in for the rest of the session.

**Technical detail.**

getPatternDrumSamples (patternKit.ts:302-308) loops over ROOM_PATTERN_DRUM_ROWS with await loadRolandMt32DrumSample per row, so 15 fetch+decode waterfalls happen in series. previewDrumPatternCell (controller.ts:451-462) awaits that promise and then starts at currentTime+0.005 with no staleness check, so taps queued during loading all fire together. It also allocates a fresh AudioBuffer per tap (463) instead of caching one per drum. rolandMt32DrumKit.ts:165-177 caches .catch(() => null), so a transient failure permanently falls back to renderDrumSample synthesis and the room sounds different than the builder composed. The kit is 2.0 MB of stereo 44.1 kHz WAV that is immediately mixed to mono (rolandMt32DrumKit.ts:69-79). Fix: Promise.all the 15 loads; warm the kit when the music workbench opens or after the first gesture in play mode; drop preview taps older than about 150 ms; cache one AudioBuffer per drum; don't cache failures (retry next time); ship mono, trimmed samples.

**Evidence.**

- src/music/patternKit.ts:302-308 — sequential await inside a for loop over 16 drum rows
- src/music/controller.ts:451-463 — preview awaits all samples, fires without a staleness check, allocates a new AudioBuffer per tap
- src/music/rolandMt32DrumKit.ts:165-177 — failures cached as null, so synth fallback for the whole session
- src/music/rolandMt32DrumKit.ts:69-79 — stereo WAVs mixed down to mono at runtime
- public/assets/music/roland-mt32/ — 16 WAVs, 2.0 MB, 2-channel 44.1 kHz 16-bit

**Fact-check (confirmed).**

Minor additions, not reversals:
1. The music renderer (patternRenderer.ts:176 and :296) waits for the full drum kit even for patterns with no drum hits, and phrase arrangements take the same path (controller.ts:1060). So the delay hits all pattern and phrase music on first play, not only drum-heavy rooms.
2. There are 16 loads but only 15 distinct files: kick-1 and kick-2 both fetch and decode bassdrum.wav under separate cache keys. snare-01.wav is an unused 62 KB asset.
3. Production serves the WAVs with immutable one-year caching, so repeat visits mostly skip the network. The cost is mostly a first-session cost, plus the serial decode every session.
4. On slow connections, shrinking the 2 MB (mono, trimmed or compressed, with hat-open at 663 KB and crash at 413 KB the main targets) is about as valuable as switching to Promise.all.

## Dropped after fact-checking

- **F007 The HUD forces a full page re-layout 10 times a second** (refuted): Not a 10-times-a-second full-page forced layout. The timer text changes every tick but is written after the measurement (hud.ts:1196 read, ~:1201/:1215 timer writes). The HUD writes before the read skip themselves when nothing changed (hud.ts:685-751, :808ff, :1157), so layout is normally clean when getBoundingClientRect runs. What is real: updateGoalPanelDockPosition() runs a querySelector and a rect read every 100 ms even when the goal panel is hidden. On the occasional tick where something else already changed layout (button-press class, status or selection change), it causes one extra incr
- **F087 No overscroll containment: scrolling the phone editor sheet past the top can trigger Android pull-to-refresh** (refuted): Not a live defect. body has overflow:hidden at src/styles/sections/base.css:76-77, and html has no overflow rule, so the root viewport cannot scroll vertically. Chromium disables pull-to-refresh in that case: layer_tree_host_impl.cc:2618-2620 sets root_overflow_y_hidden, and overscroll_refresh.cc:174-176 resets the gesture. Swiping down on the phone editor sheet therefore cannot reload the page on Chrome Android. The most that could happen is a cosmetic rubber-band bounce on iOS Safari older than 16. If anything is kept, it should be an optional hardening note: `html, body { overscroll-behavio
- **F181 The phone goal footer re-announces the running timer to screen readers every tenth of a second** (refuted): There is no timer spam. #mobile-goal-footer is always display:none (mobile-controls.css:193-194, plus phone-chrome.css:49-51 with !important) and has been unused since commit bdd3a5cf, so its live region never speaks. The real issues: (1) #world-goal-panel (index.html:1890), the goal panel shown on both desktop and phone, has no live region, so screen-reader users never hear goal progress, completion or failure. Fix: put aria-live="polite" on #world-goal-panel-progress only, or send goal-state changes to one visually hidden role="status" element, and leave #world-goal-panel-timer silent. (2) O
