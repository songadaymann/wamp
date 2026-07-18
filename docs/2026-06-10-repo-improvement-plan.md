# 2026-06-10 Repo Improvement Plan

> Historical audit. Superseded by [Performance and code-health roadmap](performance-code-health-roadmap.md).

Planning/audit document only — no code changes accompany it. This builds on (and tries not to repeat)
`docs/2026-03-18-repo-audit-wave-3-tracker.md` and `docs/expanded-rooms-impact-audit.md`.

## Snapshot of the repo today

- **412 TypeScript files, ~164k lines** in `src/`, 635 commits.
- Frontend: Phaser 3.87 + a large hand-rolled HTML/CSS UI layer (`src/ui/` is ~20k lines; `index.html` is 151KB with 711 `id=` elements).
- Backend: Cloudflare Worker API (`src/cloudflare/` ~43k lines, D1, ~30 route domains), a Cloudflare Pages worker (`public/_worker.js`, 2,219 lines), and a PartyKit presence server (`partykit/presenceServer.ts`, 2,155 lines).
- Built payload: **7.4MB of JS** (3.1MB main chunk), 300KB CSS, 17MB of static assets.
- Tooling: strict tsc (with `noUnusedLocals`/`noUnusedParameters`), knip configured, Playwright smoke scripts. **No unit tests, no CI, no linter.**
- Largest/highest-churn file: `src/scenes/OverworldPlayScene.ts` (6,039 lines, 155 commits in the last 6 months — by far the hottest file in the repo).

Each item below has Evidence / Why / Suggestion, plus an effort+impact guess. A prioritized
sequencing list is at the end.

---

## 1. Load-time performance

### 1.1 Split the 3.1MB main bundle (Phaser vendor chunk + lazy editor scenes)

**Evidence:** `dist/assets/main-*.js` is 3.1MB (one chunk = Phaser + all game/UI code). `vite.config.ts`
has no `manualChunks`. All five scenes are imported statically in `src/main.ts:15-19` and registered
eagerly in the Phaser config (`src/main.ts:70`), so editor code (`EditorScene` 2,929 lines +
`src/scenes/editor/` 13k lines shared with courseEditor + `musicPatternEditor` 1,619 lines, etc.)
ships to every player who only browses/plays.

**Why:** Every byte of the main chunk gates first paint. A new player downloads and parses editor,
course-composer, and music-pattern-editor code they may never open. Also, one mega-chunk means any
one-line gameplay change invalidates the whole 3.1MB in users' HTTP caches.

**Suggestions:**
1. `manualChunks: { phaser: ['phaser'] }` — splits ~1.3–1.5MB of rarely-changing engine code into its
   own long-cacheable chunk. Near-zero risk, immediate repeat-visit win.
2. Lazy-register editor scenes: register only `BootScene` + `OverworldPlayScene` up front; on first
   "Edit"/"Compose" action, `await import('./scenes/EditorScene')` then `game.scene.add(...)`.
   Phaser supports adding scenes at runtime; this moves a large slice of code out of the
   critical path. Requires routing all editor entry points through one async helper.
3. Add `rollup-plugin-visualizer` to the build (dev-only) and record a baseline; without a treemap
   it is hard to know what else is in the 3.1MB (e.g. confirm `jpeg-js` and `resend` are not being
   pulled into the client graph — both are listed in main `dependencies` but should be
   worker/Pages-only).

**Effort:** (1) hours, (2) 1–2 days, (3) hours. **Impact:** high — this is the single biggest
load-time lever.

### 1.2 Stop preloading every avatar color pack at boot (~3.8MB)

**Evidence:** `BootScene.preload` loads `listPlayerAvatarAtlasAssets()` (`src/scenes/BootScene.ts:176-179`),
which enumerates *all* registered packs (`src/player/avatar/loader.ts:7-17`) — that includes the
default pack, punk-465, and ~22 color packs at ~176KB each (`src/player/avatar/registry.ts:186-204`,
`public/assets/player/colors/` = 3.8MB of the 4.5MB player asset dir).

**Why:** A player needs exactly one local avatar pack at boot; remote players' packs can stream in.
The lazy-load machinery already exists — `ensureSceneAvatarPackLoaded` / `isSceneAvatarPackLoaded`
in `src/player/avatar/dynamic.ts` is used for dynamic cryptopunk packs and is already called from
the presence renderer path (`src/scenes/overworld/presence.ts:6-9`).

**Suggestion:** At boot, load only the default pack + the locally selected avatar's pack. Route
color packs through the same dynamic-pack path punks use. This cuts the boot image payload roughly
in half.

**Effort:** 1–2 days (animation registration for lazily-loaded packs needs the same treatment
`BootScene.create` does eagerly today). **Impact:** high for first load, especially mobile.

### 1.3 Overlap the network waterfall: assets → scene → world chunks is serial

**Evidence:** Boot order is: Phaser preloads all assets → `BootScene.create` → `startInitialScene`
→ `OverworldPlayScene.create` → `windowController` refresh → `/api/world/chunks` fetch
(`src/scenes/overworld/worldStreaming.ts:376-423`). The chunk-window fetch — the data the player
actually stares at while "Loading world..." — doesn't start until all static assets finish.

**Why:** On a cold cable connection the asset preload and the chunk fetch could run concurrently;
today their latencies add.

**Suggestion:** Kick off the initial chunk-window fetch (and `/api/world` bootstrap, playfun config,
user settings) in `main.ts` as soon as the app boots, and hand the in-flight promise to
`OverworldPlayScene`/`worldStreaming` as a warm cache. `setupAuthUi` already runs in parallel
(`src/main.ts:116`); extend that pattern to world data.

**Effort:** ~1 day. **Impact:** medium-high (hundreds of ms to seconds on slow links).

### 1.4 Convert SFX from WAV (5.2MB) to compressed audio

**Evidence:** 30 `.wav` files under `public/assets/sfx/` totaling 5.2MB; cues reference `.wav`
paths in `src/audio/sfx.ts`. Playback is `HTMLAudioElement`-based and lazily instantiated
(`src/audio/sfx.ts:704`), so this doesn't block boot — but each first-play of a cue fetches an
uncompressed file, and any future preload/pool-warming would pay full price.

**Why:** WAV is uncompressed; the same cues as OGG/M4A would be roughly 5–10x smaller with no
audible difference for short SFX.

**Suggestion:** Batch-convert to OGG (plus M4A fallback if Safari matters — it does for iOS) and
update the manifest paths. Consider the same review for `public/assets/music/` (4.5MB; already
fetched+decoded on demand via `src/music/controller.ts:922`, so lower priority).

**Effort:** hours (scriptable). **Impact:** medium; biggest for mobile data and first-interaction
latency.

### 1.5 Cache headers for immutable build output

**Evidence:** No `public/_headers` file. The Pages worker sets short TTLs for share/meta routes
(`public/_worker.js:151` etc.) but hashed build assets (`dist/assets/*-<hash>.js/css`) rely on
Pages defaults (etag revalidation) rather than `immutable`.

**Why:** Hashed filenames are safe to cache forever; revalidation round-trips add latency on every
revisit, multiplied across the ~7 chunks `dist/index.html` modulepreloads.

**Suggestion:** Add `_headers` with `/assets/* → Cache-Control: public, max-age=31536000, immutable`
(build-output assets only — the unhashed `public/assets/` game art should keep a moderate TTL since
paths are stable across content changes). Long-term: consider content-hashing game art too, or
folding frequently-co-loaded art (tiles, objects, fx) into a few texture atlases to cut request
count and GPU texture binds.

**Effort:** minutes for `_headers`; atlas work is days. **Impact:** medium for repeat visits.

---

## 2. Multiplayer & runtime performance

The April 30 cruft-alleviator pass already landed presence-churn reductions and a 48-peer stress
probe — these items are the next tier beyond that.

### 2.1 Presence server: per-recipient serialization is O(N²)

**Evidence:** `flushPresenceUpserts` (`partykit/presenceServer.ts:1976+`) builds and
`JSON.stringify`s a *personalized* payload for every connection (each recipient's payload excludes
only their own echo). With N connections in a shard, each 80ms flush does N serializations of
~N peers.

**Why:** At 48 peers this is fine; at 150+ it becomes the shard's dominant CPU cost and a latency
amplifier, since serialization runs on the same event loop as message handling.

**Suggestion:** Serialize once, broadcast to all, and let clients drop their own `connectionId`
from the upsert list (they already know it). That turns the flush into O(N) with a single
stringify. Same pattern applies to `broadcastPvpSnapshot`.

**Effort:** ~1 day incl. client-side self-filter. **Impact:** high for scalability headroom; nil at
current population.

### 2.2 Presence server: `broadcastPopulations` recomputes and fans out full maps on every churn event

**Evidence:** `broadcastPopulations` (`partykit/presenceServer.ts:521`) sends complete
`roomPopulations` + `roomEditors` + `roomPreviews` maps, and is called from ~8 sites (join, leave,
mode change, etc.).

**Why:** Burst joins/leaves (e.g. a stream raid, or reconnect storms after a deploy) cause
redundant full-map broadcasts — bytes and CPU that grow with world size, not with what changed.

**Suggestion:** Coalesce on a short timer (e.g. flush at most every 250–500ms, like the existing
`PRESENCE_UPSERT_FLUSH_MS` pattern) and/or switch to delta messages (`room X population +1`).
Coalescing alone is a few lines and removes the burst behavior.

**Effort:** hours. **Impact:** medium.

### 2.3 Server-side interest management (longer-term)

**Evidence:** Every presence connection in a shard receives upserts for *all* peers in the shard;
filtering to the visible viewport happens client-side (`BROWSE_PRESENCE_DOT_MAX_TOTAL` caps in
`src/scenes/overworld/presence.ts:31-32` cap rendering, not bandwidth). PvP publishes at 25ms /
40Hz (`src/presence/worldPresence.ts:29`) and pvp upserts bypass the 80ms batch
(`partykit/presenceServer.ts:1955-1960`), so spectator-heavy shards get 40Hz fanout.

**Why:** Bandwidth per client scales with shard population rather than with what the client can
see. Mobile clients pay for ghosts three screens away.

**Suggestion:** Have clients report their chunk window (they already compute it for
`worldStreaming`), and have the server send movement upserts only for peers within or near that
window, with a low-frequency "global dots" summary for the rest. Consider scoping 40Hz PvP traffic
to match participants + opted-in spectators. This is the natural next step if concurrency targets
grow past a few hundred per shard; not urgent before then.

**Effort:** ~1 week. **Impact:** high at scale, low today — file under "before the launch spike,
not after."

### 2.4 Frame-loop micro-allocations

**Evidence:** `OverworldPlayScene.update` wraps ~39 sections in
`this.measureMobilePerformance('label', () => ...)` closures (`src/scenes/OverworldPlayScene.ts:2026-2223`);
when the profiler is off the wrapper still allocates the closures every frame (~2,300 allocations/sec
at 60fps).

**Why:** Minor GC churn on mobile. This is a polish item, not a hotspot — the profiler design is
otherwise a strength of this codebase.

**Suggestion:** Only worth touching if Wave 3 extraction restructures `update()` anyway; a
`if (profiler) profiler.measure(...) else inline-call` shape (or hoisted bound methods) removes the
allocations. Don't do it as a standalone pass.

**Effort:** trivial-but-tedious. **Impact:** low.

---

## 3. Backend (Worker, Pages worker, D1)

### 3.1 `public/_worker.js` is 2,219 lines of un-typechecked JS importing TS sources

**Evidence:** `public/_worker.js` imports from `../src/...` (`profiles/username.ts`,
`playlists/model.ts`, `config.ts`, etc.) and gets esbuild-bundled by `scripts/build_pages_worker.mjs`.
`tsconfig.json` includes only `src/**/*`, so this file — which handles share-link routing, OG-image
rendering, and meta SSR for wamp.land — has no type checking at all. It's also a `.js` file living
in `public/`, which Vite copies verbatim into `dist/` before the build script overwrites it with
the bundle.

**Why:** Highest-risk type gap in the repo: it consumes typed model functions from `src/` with zero
compiler verification, and it churns (it's modified in the current working tree). The
`public/` location also makes it look like a static asset rather than the production router for
the frontend domain.

**Suggestion:** Move the logic to `src/pagesWorker/` as TypeScript, leave a thin
`public/_worker.js` shim or point the build script at the TS entry directly (esbuild handles TS
natively). Add it to the typecheck. No behavior change.

**Effort:** ~1 day. **Impact:** high on safety/maintainability, zero on runtime.

### 3.2 Same gap: `partykit/` and `scripts/` are outside the typecheck

**Evidence:** `tsconfig.json` `include: ["src/**/*"]`. The 2,155-line presence server — the most
concurrency-sensitive code in the system — is only type-checked incidentally if PartyKit's own
tooling does so during deploy; `npm run typecheck` never sees it.

**Suggestion:** Add a `tsconfig.partykit.json` (and optionally one for `scripts/*.ts`) and fold them
into `npm run typecheck` via project references or a compound script.

**Effort:** hours. **Impact:** medium-high.

### 3.3 Worker router: 651-line if/else + regex chain

**Evidence:** `src/cloudflare/worker.ts` dispatches ~70 route patterns through sequential `if`
blocks, with inline regexes (`/^\/api\/avatars\/cryptopunks\/([^/]+)\/status$/` etc.) and
per-route auth calls.

**Why:** Mostly a maintainability issue: route order is load-bearing, auth requirements are easy to
forget on a new route (each handler re-declares scope checks), and the file is a merge-conflict
magnet (43 commits in 6 months).

**Suggestion:** Move to a declarative route table: `{ method, pattern, scope?, handler }[]` walked
in a loop, with auth/scope enforcement driven by the table rather than hand-written per route.
This is mechanical and behavior-preserving — a good Wave-2-style slice. (A library like
itty-router/hono is optional; the hand-rolled table is enough and keeps the dependency surface
flat.)

**Effort:** 1–2 days. **Impact:** medium (correctness-by-construction for auth scopes is the real
win).

### 3.4 Four parallel run/leaderboard/rating pipelines

**Evidence:** `worker.ts` mounts run-start/finish/leaderboard/rating handlers for rooms
(`runs/routes.ts`, 1,063 lines), courses (`courses/routes.ts`, 1,052), expanded rooms
(`expandedRooms/runRoutes.ts`, 1,242), and Room Rush (`runs/roomRushLeaderboards.ts`) — plus
`runs/difficulty.ts` (1,846) and `runs/verification.ts` (1,119) shared underneath.

**Why:** `docs/expanded-rooms-impact-audit.md` already names the end-state: expanded rooms become
the canonical playable identity. Until then every anti-cheat fix, scoring tweak, or leaderboard
column lands 3–4 times (or quietly doesn't).

**Suggestion:** Don't refactor these in place. Treat the expanded-rooms convergence as the
deduplication plan: route course/room runs through the expanded-room pipeline behind the existing
`EXPANDED_ROOMS_ENABLED` flag, then delete the legacy pipelines. Sequencing this *before* adding
more run-adjacent features prevents a fifth copy from appearing.

**Effort:** the big one — multi-week, already roadmapped. **Impact:** the largest single
spaghetti-reduction available in the backend.

### 3.5 Session auth does D1 reads on every API request

**Evidence:** Nearly every route calls `loadOptionalRequestAuth`/`requireAuthenticatedRequestAuth`
(`src/cloudflare/worker.ts`), backed by `worker/auth/store.ts` (1,432 lines) session lookups
against D1.

**Why:** Fine today; D1 single-region reads add tail latency to every call and become a throughput
ceiling during spikes (the same spikes that hit presence).

**Suggestion:** Measure first (wrangler analytics / `verificationTrace`-style timing). If session
lookups show up, add a short-TTL cache: Workers KV or the Cache API keyed by token hash with
60–300s TTL plus explicit invalidation on logout/revoke. Low urgency, high leverage during a
launch spike.

**Effort:** 1–2 days incl. invalidation paths. **Impact:** medium, deferred until measured.

---

## 4. Code organization & spaghetti

### 4.1 `OverworldPlayScene` is still the god object (6,039 lines, top churn)

**Evidence:** 155 commits in 6 months — double the next file. It owns mode switching
(browse/play/edit handoff), PvP match flow (~15 `pvp*` methods in `update()` alone), room-rush
runs, lighting sync, HUD frame rendering, presence sync, and respawn/transition logic. The Wave 3
tracker's own deferred item says: continue "runtime/state extraction behind narrow host
interfaces."

**Why:** Churn × size = where bugs are born. Every feature (per the git status: contextual hints,
pvp spawn, live-object triggers) has to thread through this file, which keeps its commit rate high
and reviews shallow.

**Suggested next seams** (in order of how cleanly they'd come out, based on what `update()` calls):
1. **PvP**: `maybeApplyRemotePvpActionHit` / `maybeStompPvpPeer` / `resolvePvpPeerCollision` /
   countdown lock / arena camera lock → a `PvpRuntimeController` peer to the existing
   `pvpInstanceRenderer`/`pvpArenaController`. PvP state is the most self-contained cluster left.
2. **Room Rush**: `tickRoomRushRun` / `endRoomRushRun` / results flow → controller alongside the
   existing `roomRushRuns.ts` helpers.
3. **Mode lifecycle**: the browse↔play↔edit transitions plus `returnToWorld`/`restartCurrentRun`
   into a state-machine module; this is the piece that makes everything else in the scene tangle.

The controller-extraction pattern used for movement/combat/presence is working — the remaining
problem is that the scene still owns the *state* those controllers read. Prioritize moving state
ownership (e.g. current mode, current room coordinates, active run descriptors) into a scene-scoped
context object that controllers receive, so new features can stop adding fields to the scene class.

**Effort:** ongoing; PvP slice ~3–4 days. **Impact:** high on velocity and defect rate.

### 4.2 `index.html` as a 151KB single file with 711 IDs

**Evidence:** All modals, HUD panels, editor sidebars, and admin affordances live as static markup
in one file; `src/ui/setup/` (profileModal 2,327 lines, leaderboardModal 1,597, exploreModal 1,256…)
queries into it by ID. Zero `<template>` usage.

**Why:** Wire cost is small (gzip), but: (a) every feature edits the same file (merge conflicts);
(b) markup and the TS controller that owns it live far apart, so dead markup accumulates
invisibly — knip can't see unused HTML; (c) initial DOM has ~all UI parsed/attached whether or not
it's ever opened.

**Suggestion:** Incremental, not big-bang: when a modal next gets meaningful work, move its markup
into a `<template>` (or a TS string/render function colocated with its controller in
`src/ui/setup/`), instantiated on first open. Adopt "new UI never adds to index.html" as a rule and
let the file shrink by attrition. A one-time audit pass matching `id="..."` occurrences against
`getElementById`/querySelector hits would also surface already-dead markup.

**Effort:** rule is free; per-modal migration ~hours each. **Impact:** medium, compounding.

### 4.3 Editor-family duplication: EditorScene vs CourseEditorScene vs CourseComposerScene

**Evidence:** `EditorScene.ts` (2,929) + `CourseEditorScene.ts` (3,873) + `CourseComposerScene.ts`
(1,480) plus parallel helper dirs `src/scenes/editor/` and `src/scenes/courseEditor/`, with
sibling inspector implementations (`editor/inspector.ts`, `courseEditor/inspectorUi.ts`,
`courseEditor/objectInspector.ts` — all three touched in the current working tree, which suggests
features regularly need triple edits).

**Why:** Same reason as 3.4 — and the same answer. The expanded-rooms audit already concludes the
composer/course scenes are a compatibility layer.

**Suggestion:** Resist further structural cleanup *inside* the course scenes (the Wave 3 tracker
says the same); instead fold this into the expanded-rooms convergence so the end-state is one
editor + one composer. Worth writing the target scene architecture into the expanded-rooms plan
now so new editor features land on the surviving side.

**Effort/Impact:** subsumed by 3.4.

### 4.4 Wallet stack: ethers AND viem AND wagmi AND Reown

**Evidence:** `package.json` ships `ethers` 6, `viem`, `wagmi`, `@reown/appkit*`. `src/auth/client.ts`
dynamically imports `ethers.BrowserProvider` (lines 323, 783) while the Reown/wagmi path pulls
viem. Lazy chunks in dist include a 356KB `zoraTestnet-*.js` (the all-chains module from the
viem/appkit graph) plus ~1MB of other wallet chunks.

**Why:** All lazy, so boot is unaffected — but the wallet *moment* (auth) downloads two duplicate
EVM stacks, and two stacks means two places signing/typed-data bugs can hide.

**Suggestion:** Standardize on viem (wagmi/Reown already require it); replace the two
`BrowserProvider` usages with viem `walletClient` equivalents and drop `ethers` from the main app
(keep it in `contracts/` if Foundry/deploy scripts want it). Also audit whether Reown's default
network list can be narrowed to Base/Base-Sepolia to shrink the chains chunk.

**Effort:** 1–2 days + wallet-flow regression testing. **Impact:** medium (wallet UX latency,
dependency hygiene).

---

## 5. Dead code, docs, hygiene

### 5.1 CLAUDE.md / AGENTS.md actively mislead

**Evidence:** Both files are byte-identical and describe a three-scene prototype: "PlayScene.ts
~503 lines" (file no longer exists), "EditorScene ~984 lines" (now 2,929), "No persistence yet",
"Player sprite is placeholder". None of the worker/D1/PartyKit/auth/mint/PvP stack is mentioned.

**Why:** These are the first context every coding agent (and new contributor) loads. Stale claims
("no persistence") can cause confidently wrong work.

**Suggestion:** Rewrite once, accurately and briefly: real architecture map (client / worker API /
Pages worker / PartyKit / D1 / contracts), the dev-stack commands that matter
(`dev:safety`, `dev:api`, `dev:presence`), and pointers to `feature-ledger.md` + `docs/`. Make
AGENTS.md the canonical file and have CLAUDE.md reference it (or symlink-equivalent content) so
they can't drift apart again.

**Effort:** an hour. **Impact:** high per dollar; cheapest item in this doc.

### 5.2 Make knip + strict checks enforceable: add CI

**Evidence:** No `.github/workflows`, no eslint config. Quality gates exist (`npm run typecheck`,
`npm run build`, knip.json, smoke scripts) but only run when someone remembers. Zero `*.test.ts`
files exist.

**Why:** With no unit tests and no CI, the strict tsc config is the only automated safety net, and
it runs on the honor system. The repo has many pure, easily-testable modules where regressions
would be silent (run `scoring.ts`, `runs/verification.ts`, `progression/model.ts`,
`music/pattern.ts`, `persistence/roomModel.ts` validation, `expandedRooms/model.ts` footprint
rules).

**Suggestion (in order):**
1. GitHub Actions workflow: `typecheck` + `build` + `knip` on PR/push. (Knip may need a triage pass
   first; park known-false-positives in its ignore list.)
2. Add vitest and start with the anti-cheat/scoring/validation pure modules listed above — highest
   regression cost, zero DOM/Phaser mocking needed. Don't attempt scene tests.
3. ESLint (typescript-eslint, recommended ruleset, low rule count) mostly for the unused/floating-
   promise classes tsc doesn't catch (`@typescript-eslint/no-floating-promises` would formalize the
   `void`-discipline the codebase already follows by convention).

**Effort:** (1) hours, (2) ~a day for the first batch, (3) hours + noise-tuning. **Impact:** high —
it protects every other item in this document.

### 5.3 Root-level clutter & flag cleanup (small stuff)

- Ten HTML entry points at repo root (`vite.config.ts:36-47`) — consider a `pages/` directory to
  declutter root; purely cosmetic.
- `feature-ledger.md` (90KB) and `PRD.md` at root: move under `docs/` unless tooling depends on
  their paths.
- Feature flags: `EXPANDED_ROOMS_ENABLED` will earn its keep, but audit `PLAYFUN_ENABLED` and any
  flags that have been globally on/off for months — each one doubles the untested configuration
  space.
- `src/config.ts` and `src/ui/setup.ts` survive as compatibility barrels (5/10 lines). Fine — but
  set a deadline to migrate importers and delete them, or they become permanent.
- `.DS_Store` files are tracked-adjacent in `public/assets/sfx/`; add a global ignore if not
  already covered.

---

## 6. What I'd do first (sequencing)

Quick wins (a focused week, roughly in order):

1. **Rewrite CLAUDE.md/AGENTS.md** (5.1) — an hour, stops misleading every agent session.
2. **CI with typecheck+build+knip** (5.2.1) — makes everything else durable.
3. **`manualChunks` for Phaser + bundle visualizer baseline** (1.1.1, 1.1.3).
4. **`_headers` immutable caching** (1.5).
5. **SFX WAV→OGG conversion** (1.4).
6. **Coalesce `broadcastPopulations`** (2.2).
7. **Typecheck `partykit/` + plan `_worker.js` TS migration** (3.2, 3.1).

Medium-term (next month):

8. **Lazy avatar color packs** (1.2) and **boot network overlap** (1.3) — together these plus #3
   should visibly change time-to-overworld.
9. **Lazy editor scene registration** (1.1.2).
10. **Presence broadcast O(N²) → O(N)** (2.1) — do before any growth push.
11. **Worker route table** (3.3) and **first vitest batch on scoring/verification** (5.2.2).
12. **PvP/RoomRush extraction from OverworldPlayScene** (4.1) — continue Wave 3 with state
    ownership, not just method relocation.

Strategic (quarter):

13. **Expanded-rooms convergence as THE dedupe plan** (3.4 + 4.3) — sequence it ahead of new
    run-adjacent features so the 4 parallel pipelines become 1 instead of 5.
14. **Server-side interest management** (2.3) — gate on concurrency targets.
15. **Wallet stack consolidation on viem** (4.4).
16. **index.html attrition rule** (4.2) — adopt now, harvest forever.

## What's already good (don't break it)

Worth saying explicitly, because several "obvious" refactors would make these worse:

- The controller-extraction pattern in `src/scenes/overworld/` and the wave-based refactor
  discipline (tracker docs, behavior-preserving slices, verification logs) are genuinely strong.
- The mobile performance profiler woven through `update()` is rare and valuable instrumentation.
- D1 access already uses `batch()` for multi-statement writes (`worker/rooms/store.ts`).
- PartyKit hibernation is on; presence publish rates are already tiered (200ms move / 5s idle /
  25ms PvP) with client-side snapshot batching.
- Wallet code is already off the boot path via dynamic import.
- knip, strict tsc with unused-symbol enforcement, and an extensive Playwright smoke suite exist —
  they just need CI to matter.
