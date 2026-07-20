# Code Health & Performance Recommendations

> Historical audit. Superseded by [Performance and code-health roadmap](performance-code-health-roadmap.md).

**Date:** 2026-07-13
**Scope:** Game client (`src/`), with brief notes on shared tooling. Based on a read-through of the largest files, all per-frame code paths in the overworld runtime, the two editor scenes, the UI layer, and the build setup.

The codebase is ~165k lines of TypeScript. The good news first: this is *not* spaghetti. There's a clear controller-extraction pattern already underway (`src/scenes/overworld/` has ~50 focused controller modules), `config.ts` is already split into `src/config/*`, a mobile performance profiler exists, the HUD render is already throttled, wallet libraries are already dynamically imported, and the world streaming layer has budgets and LOD. The problems are the *residue* of fast growth: a god-object scene, two editors that copied each other, switch-statement dispatch that has outgrown itself, and per-frame allocation churn.

---

## Part 1 — Code cleanup

### 1.1 `OverworldPlayScene` is a god object (highest-leverage refactor)

[OverworldPlayScene.ts](src/scenes/OverworldPlayScene.ts) is 6,039 lines with **412 class members** and ~30 controllers. The extraction pattern is right, but the scene is still the hub for everything, and the wiring style is the real problem: each controller receives a large "host callbacks" bag of closures (see the ~30-line options object around [OverworldPlayScene.ts:1428](src/scenes/OverworldPlayScene.ts:1428)). Every new controller re-plumbs the same getters (`getPlayer`, `getPlayerBody`, `getMode`, `getLoadedRooms`...), which is why the scene keeps growing even as logic moves out.

**Recommendation:**
- Define one shared `OverworldRuntimeContext` interface (player refs, mode, loaded rooms map, camera refs, settings) that the scene implements once and passes to every controller, instead of per-controller closure bags. This removes hundreds of lines of wiring and makes controller signatures uniform.
- Move the remaining big private method families out of the scene into the controllers that own them. Candidates visible in the file: PvP glue (`syncPvpInstanceState`, `maybeStompPvpPeer`, `resolvePvpPeerCollision`, heart/invulnerability sync → `pvpArenaController`), backdrop/starfield (`updateBackdrop`, `ensureBackdropCamera`, `syncBackdropCameraIgnores` → a `BackdropController`), room-rush tick, lighting emitter assembly (`updateRoomLighting` → `lighting.ts`).
- Target: the scene becomes a composition root + Phaser lifecycle adapter, under ~1,500 lines. Do this incrementally, one subsystem per PR — the controller seams already exist.

The same treatment applies to [CourseEditorScene.ts](src/scenes/CourseEditorScene.ts) (3,873 lines) and [EditorScene.ts](src/scenes/EditorScene.ts) (2,925 lines).

### 1.2 EditorScene ↔ CourseEditorScene duplication

The two editor scenes share **~95 identical method signatures** — almost all music-editing plumbing (`commitRoomMusic`, `ensureArrangementPhraseCache`, `getActiveMusicTempo`, `handleMusicPointerDown/Move/Up`, phrase library loading, arrangement slot management, save prompts...). Both already delegate to the shared `EditorMusicPatternController` ([musicPatternEditor.ts](src/scenes/editor/musicPatternEditor.ts)), but each scene keeps its own full copy of the wrapper/state layer around it. A fix in one scene silently misses the other.

**Recommendation:** finish the extraction — move the wrapper state (phrase cache, arrangement selection, save-prompt flow, pointer handling) *into* `EditorMusicPatternController` or a new `MusicEditingSession` class, and have each scene hold one instance plus scene-specific glue (which room/course the music commits to). Expected deletion: roughly 1,000–1,500 lines across the two scenes.

Similarly, [editor/inspector.ts](src/scenes/editor/inspector.ts) (921 lines) and [courseEditor/objectInspector.ts](src/scenes/courseEditor/objectInspector.ts) (927 lines) are parallel implementations of the same inspector (pressure plates, containers, links) with different data sources. Extract a shared inspector core parameterized by a small `InspectorDataSource` interface (get placed objects, commit change, resolve link targets); keep the swordsman- and course-specific panels as extensions.

### 1.3 Live-object behavior: replace switch dispatch with a behavior registry

[liveObjects.ts](src/scenes/overworld/liveObjects.ts) (2,348 lines) dispatches per-frame updates through a 36-case `switch (liveObject.config.id)` (starting near [liveObjects.ts:793](src/scenes/overworld/liveObjects.ts:793)); [liveObjects/triggers.ts](src/scenes/overworld/liveObjects/triggers.ts) has another 11-case switch. Several cases are the same function with different tuning numbers (bat/bird/ghost/fish/shark all call `updateFlyingEnemyObject`). Adding an object type means touching the switch, the trigger switch, the factory, and the inspector.

**Recommendation:** a behavior registry keyed by object id:

```ts
interface LiveObjectBehavior {
  update?(ctx: LiveObjectUpdateContext, obj: LoadedRoomObject, delta: number): void;
  onPlayerOverlap?(...): void;
  onWeaponHit?(...): WeaponHitResult;
}
const BEHAVIORS: Record<string, LiveObjectBehavior> = {
  bat: flyingEnemy({ speed: s.batSpeed, amp: s.batWaveAmplitude, waveSpeed: s.batWaveSpeed }),
  bird: flyingEnemy({ speed: s.birdSpeed, ... }),
  ...
};
```

This collapses the switches, lets the update loop skip objects with no `update` behavior entirely (a perf win, see 2.3), and makes new object types a single-file addition. The directory split under `src/scenes/overworld/liveObjects/` (bodies, pickups, projectiles, hazards...) is already most of the way there — the registry is the missing dispatch layer.

### 1.4 UI layer: extract a modal framework

`src/ui/` is ~20,400 lines, with individual modals up to 2,300 lines ([profileModal.ts](src/ui/setup/profileModal.ts), [leaderboardModal.ts](src/ui/setup/leaderboardModal.ts), [exploreModal.ts](src/ui/setup/exploreModal.ts), [runRatingModal.ts](src/ui/setup/runRatingModal.ts)...). Each modal re-implements the same lifecycle: build DOM via `createElement`, open/close, backdrop click, escape handling, keyboard-focus handoff to/from the game canvas, cleanup.

**Recommendation:**
- Extract `createModal({ title, onClose, ... })` returning a handle with `open/close/setContent`, owning backdrop/escape/focus behavior once. Migrate modals opportunistically as they're touched, not in one big pass.
- Extract the repeated list-fetch-render-paginate pattern (leaderboard, explore, history, guestbook all do fetch → spinner → render rows → "load more") into one helper.
- Good existing habit to keep: DOM built with `createElement` (32 sites) rather than `innerHTML` (1 site) — safe against injection; don't regress this in a refactor.

### 1.5 Event-bus and shared-state hygiene

Global mutable `editorState` plus string-named `CustomEvent`s bridge Phaser and the DOM UI. This works, but event names and payload shapes are scattered (`tileset-changed`, `background-changed`, `COURSE_COMPOSER_STATE_CHANGED_EVENT`, `AUTH_STATE_CHANGED_EVENT`, `PLAYER_AVATAR_CHANGED_EVENT`...), some as exported consts, some as inline strings.

**Recommendation:** one `src/events.ts` (or grow `ui/setup/sceneBridge.ts` into it) declaring every cross-boundary event name and its payload type, plus tiny typed `emit`/`on` helpers. Grep-for-string becomes go-to-definition. Don't rewrite to a new event system — just centralize and type what exists.

### 1.6 Tooling gaps: no linter, no unit tests

There is no ESLint/Biome config and no unit-test runner — only Playwright smoke scripts. For a codebase this size, with this much pure logic (music model at ~1,000 lines, room/coordinate math, `swordsmanTraversal.ts` at 1,430 lines, difficulty scoring, verification), that's the biggest silent risk to any refactor recommended above.

**Recommendation:**
- Add **Biome** (single fast tool, near-zero config) or ESLint with `typescript-eslint` recommended rules. Turn on `no-floating-promises` — with this many `void someAsync()` call sites, unawaited-promise bugs are the most likely latent bug class.
- Add **Vitest** targeting pure modules only (no Phaser imports): `src/music/model`, `src/persistence/roomModel`, `src/enemies/swordsmanTraversal`, `src/goals`, coordinate/chunk math in worldStreaming helpers. These are exactly the modules the cleanup refactors will touch; tests there make the refactors safe. Skip trying to unit-test scenes.
- Wire `typecheck` + lint + vitest into a single `npm run check` used before deploys (check currently runs typecheck + full build only).

### 1.7 Stale documentation

`CLAUDE.md` describes the original prototype: "Boot → Editor ↔ Play", "player is a blue rectangle placeholder", "no persistence yet". The real app has five scenes, a Cloudflare Worker backend, D1, PartyKit presence, PvP, minting, courses, and avatars. Every contributor (and every AI session) starts with a wrong map.

**Recommendation:** rewrite CLAUDE.md around the actual architecture: scene inventory, the controller pattern in `scenes/overworld/`, the worker/API layout under `src/cloudflare/`, the editorState/sceneBridge contract, and the deploy scripts. Keep it under ~150 lines and link to `docs/` for depth.

### 1.8 Repo organization (lower priority)

- Root-level entry files (`dashboard.ts`, `launch-admin.ts`, `school-admin.ts`, `suspicious-admin.ts`, `background-admin.ts`, `minted-room.ts`, `room-preview-render.ts`) mixed with `main.ts` blur what's game vs. admin tooling. A `src/entries/` (or `src/admin/entries/`) folder would make the boundary visible. Cosmetic, do it when convenient.
- `src/cloudflare/worker/` files like [admin/suspicious.ts](src/cloudflare/worker/admin/suspicious.ts) (2,238 lines) and [runs/difficulty.ts](src/cloudflare/worker/runs/difficulty.ts) (1,846 lines) would benefit from the same split-by-concern treatment, but the worker is out of the hot path and can wait.

---

## Part 2 — Performance (no visual-fidelity cost)

The rendering fundamentals are already right: `pixelArt: true`, `roundPixels`, NEAREST filtering, dual-camera parallax, LOD'd world streaming with budgets, throttled HUD. The remaining wins are almost all **per-frame allocation and per-frame work that should be event-driven**, plus one structural rendering change. On desktop these are invisible; on mobile (where the profiler exists for a reason) they show up as GC hitches.

### 2.1 Per-frame allocation churn in `update()` (quick wins, do first)

Every frame, [OverworldPlayScene.update](src/scenes/OverworldPlayScene.ts:2026) allocates ~39 arrow-function closures for `measureMobilePerformance(...)` wrappers — even when the profiler is disabled. Individually cheap; collectively it's steady GC pressure at 60fps on exactly the devices the profiler targets.

Additional per-frame allocations found:

- **`updateRoomLighting`** ([OverworldPlayScene.ts:2258](src/scenes/OverworldPlayScene.ts:2258)): `Array.from(map.values()).filter().map()` over rendered ghosts, plus two more array spreads, every frame. Rebuild the emitter array only when the ghost set / opponent presence changes; mutate the player emitter's x/y in place each frame.
- **`updateLiveObjects`** ([liveObjects.ts:780](src/scenes/overworld/liveObjects.ts:780)): `Array.from(loadedRooms)` each frame — iterate the iterable directly, the copy is unnecessary.
- **`specialTiles`**: `getPlayerEnvironment()` and the mode-reset path return `{ ...spread }` copies ([specialTiles.ts:189](src/scenes/overworld/specialTiles.ts:189)); return a readonly reference instead.
- **`buildMobilePerformanceContext`** runs twice per frame *when profiling* and does an `Array.from().reduce()` + `.filter()` over every live object in every loaded room ([OverworldPlayScene.ts:5584](src/scenes/OverworldPlayScene.ts:5584)). Sample it (every N frames) or keep a running counter incremented on spawn/despawn.

**Recommendation for the profiler wrappers:** replace the closure-per-section pattern with begin/end marks (`profiler.begin('update.movement'); ...; profiler.end()`) or make `measureMobilePerformance` a no-op passthrough constant when disabled and accept the closures only in profiling builds. Either removes ~39 allocations/frame in production.

### 2.2 Per-frame scans that should be indexed or event-driven

- **`findOverlappingLadder`** is called every frame from movement ([liveObjects.ts:1275](src/scenes/overworld/liveObjects.ts:1275)) and walks *every live object in every loaded full room*, allocating bounds rectangles per candidate. Keep a per-room `ladders: LoadedRoomObject[]` list (there's already an indexing module at `liveObjects/indexing.ts` to extend), and only check the room(s) the player's body overlaps. Same pattern applies to `findCratePullHintTarget` called each frame from the contextual-hints block.
- **`updateFullRoomBackgrounds`** ([worldStreaming.ts:666](src/scenes/overworld/worldStreaming.ts:666)) iterates all loaded full rooms each frame. Skip rooms whose bounds don't intersect the camera view — parallax on an off-screen room is invisible by definition.
- **Starfield backdrop** ([OverworldPlayScene.ts:2463](src/scenes/OverworldPlayScene.ts:2463)): `setPosition/setSize/setTileScale` run every frame but only change on resize. Move them to `handleResize`; keep only the two `tilePositionX/Y` writes per frame.
- **`update.roomChat` / `update.roomComments` / sign controller** run every frame; if they mostly reposition labels, throttle them the way the HUD already is (`FRAME_HUD_RENDER_INTERVAL_MS` pattern at [OverworldPlayScene.ts:5624](src/scenes/OverworldPlayScene.ts:5624)) or make them dirty-flag driven from the events that change them.

### 2.3 Live-object update culling (pairs with the behavior registry, 1.3)

Currently every active live object in every loaded full room gets a switch-dispatch and special-tile-state check per frame. Two cheap wins:

1. With the behavior registry, objects with no `update` behavior (signs, ladders, doors, decor — likely the majority) skip the loop entirely. Partition each room's `liveObjects` into `updating` / `static` lists at spawn time.
2. Distance culling: only run enemy/moving-platform updates for rooms within one room of the camera/player (with a "wake on approach" reset so behavior stays deterministic when you arrive). Off-screen bats flapping in a room three screens away is pure waste. Keep an exception list for anything gameplay-linked across rooms (linked switches, pressure-plate targets).

### 2.4 Replace the camera ignore-list bookkeeping with display Layers (structural, biggest simplification)

`syncBackdropCameraIgnores` ([OverworldPlayScene.ts:2497](src/scenes/OverworldPlayScene.ts:2497)) manually assembles a giant array of *every* game object in the world — grid, cells, player, projectiles, every live object's sprite and helpers, every room's background sprites, edge walls, ghosts, chat, comments, FX — and feeds it to `backdropCamera.ignore()`. It's called from 22 sites, every controller must remember to expose `getBackdropIgnoredObjects()`, and one forgotten sprite renders twice (actual visual bug class, not just perf).

**Recommendation:** invert it with Phaser Layers. Create two `Layer` objects — `backdropLayer` (starfield only) and `worldLayer` (everything else). Then camera setup is two lines, once: `cameras.main.ignore(backdropLayer)` and `backdropCamera.ignore(worldLayer)`. New objects just get added to `worldLayer` (a one-line helper in the runtime context from 1.1) and inherit correct camera visibility forever. This deletes the whole `getBackdropIgnoredObjects()` protocol (~15 controller methods), the 22 sync call sites, and the O(world) array builds.

### 2.5 Physics scope

All loaded full rooms keep live arcade bodies (enemies, crates, edge walls). Arcade physics broadphase is O(bodies), so this scales with streaming budget rather than what's near the player. When applying 2.3's culling, also `disableBody()` on culled dynamic objects (colliders skip disabled bodies cheaply). Static bodies (edge walls, ladders) are cheap — leave them.

### 2.6 Startup and memory

- **Boot preload:** BootScene has only 15 load calls and `public/assets` is 17MB total, with avatar packs already lazy-loaded (`ensureSceneAvatarPackLoaded`). This is in good shape. The one check worth doing: audit which of the 17MB ships in the critical path (`network` tab on cold load) — backgrounds are the likely heavy directory; load non-default background packs on first use, same pattern as avatars.
- **Bundle:** wallet libs (`ethers`, `@reown/appkit`, wagmi adapter) are already behind dynamic `import()` — good. Add `build.rollupOptions.output.manualChunks` to split `phaser` (~1.2MB min) into its own long-lived cacheable chunk, and run `rollup-plugin-visualizer` once to verify nothing heavy (e.g. `tonal`, `jpeg-js`) leaked into the main chunk.
- **Texture memory:** room snapshot textures and preview-chunk canvases are the main GPU-memory consumers. `destroyFullRoom` exists; worth one pass with `game.textures.list` in devtools after 10 minutes of roaming to confirm no texture-key leak (keys are content-hashed via `buildRoomTextureKey`, so stale versions of edited rooms are the risk).

### 2.7 Measure before/after

You already own the right tool: the mobile performance profiler with named sections. Before starting, capture a baseline on a mid-tier phone (section timings + a Chrome performance trace watching for GC sawteeth), then re-measure after each of 2.1–2.4. The expected shape of the win: fewer/smaller GC pauses and a flatter `update.*` profile, rather than a dramatic average-FPS jump — which is exactly what "snappier without losing fidelity" feels like.

---

## Suggested sequencing

| Order | Item | Effort | Payoff |
|---|---|---|---|
| 1 | Lint + Vitest on pure modules (1.6) | S | Makes everything else safe |
| 2 | Per-frame allocation fixes (2.1, 2.2) | S | Immediate mobile smoothness |
| 3 | Layers instead of ignore-lists (2.4) | M | Deletes a whole bug class + perf |
| 4 | Behavior registry + update culling (1.3, 2.3) | M | Perf + makes content growth cheap |
| 5 | Shared runtime context, shrink OverworldPlayScene (1.1) | M–L | Long-term velocity |
| 6 | Music-editing session extraction (1.2) | M | ~1.5k lines deleted |
| 7 | Inspector unification (1.2) | M | Kills a divergence trap |
| 8 | Modal framework, event registry, CLAUDE.md, repo org (1.4, 1.5, 1.7, 1.8) | S each | Ongoing hygiene |

Items 2 and 3 are the "make it snappier" core; items 4–7 are where the codebase stops fighting back.
