# Performance and Code-Health Roadmap

This is the canonical implementation tracker for the June 10 and July 13 audits. It is rebased on
`origin/main` at `4b10b27`; the older audits remain in `docs/` as historical evidence.

## Baseline

- Production profile responses sampled on 2026-07-17 took roughly 0.7–1.8 seconds.
- Production room discovery responses sampled on the same date took roughly 0.8–1.2 seconds.
- Direct production D1 statements completed in milliseconds. The dominant backend cost is query
  orchestration: repeated round trips, read-time writes, N+1 expanded-room resolution, and enriching
  all rows before applying a limit.
- The production build has a 3.1 MB minified main chunk, eagerly loads 3.8 MB of avatar color packs,
  and ships 5.2 MB of WAV sound effects.

## Already Landed

- Shared editor music workflow.
- Initial live-object behavior registry.
- Shared modal lifecycle helper.
- PartyKit inclusion in TypeScript checks.
- Documentation reorganization and several modal/profile extractions.

These are foundations to extend, not work to repeat.

## Delivery Gates

| Wave | Deliverable | Exit gate |
| --- | --- | --- |
| 1 | Timing, API probe, lint, tests, CI | Quality commands pass from a clean install |
| 2 | Profile/discovery D1 read path | Profile p95 <= 500 ms; newest discovery p95 <= 500 ms |
| 3 | Startup and asset loading | Initial JS/assets reduced by at least 25% |
| 4 | Frame loop and multiplayer | Frame p95 < 20 ms; 48- and 150-peer probes pass |
| 5 | Structural cleanup | No public API, persistence, gameplay, or visual regressions |

## Wave 1: Measurement and Guardrails

- Add request-scoped Server-Timing segments and cache diagnostics.
- Add a repeatable p50/p95 API probe.
- Add Vitest coverage for ranking, discovery, progression, and read-model parity.
- Add type-aware ESLint and CI gates.

## Wave 2: D1, Profiles, and Discovery

- Add an additive `playable_content_index` read model with a legacy-read feature flag.
- Make public progression/profile reads read-only and move badge synchronization to mutations.
- Replace all-user profile ranking and N+1 expanded-room resolution.
- Split profile summary, room, and playlist subresources while preserving the aggregate route.
- Limit discovery before enrichment and add cursor pagination.
- Cache public bases for 20 seconds and overlay viewer-specific state afterward.

## Wave 3: Startup and Assets

- Split stable engine code and lazy-register editor-only scenes.
- Lazy-load avatar packs.
- Add immutable build-asset cache headers.
- Ship compressed SFX with browser fallbacks.
- Consolidate browser wallet operations on viem.

## Wave 4: Runtime and Multiplayer

- Partition static/updating objects and index per-room interaction targets.
- Cull distant updates and physics without changing simulation on wake.
- Replace camera ignore-list rebuilding with display layers.
- Remove frame-loop allocation churn and throttle non-critical DOM positioning.
- Serialize presence updates once, coalesce population broadcasts, and add interest management.

## Wave 5: Structural Cleanup

- Introduce a shared overworld runtime context and extract remaining lifecycle state.
- Finish trigger behavior registration.
- Convert the Pages Worker to TypeScript and centralize typed cross-boundary events.
- Replace route-order-dependent dispatch with a declarative route table.
- Continue modal/index markup attrition and expanded-room convergence in compatibility-safe slices.

## Rollout Policy

Each wave is implemented in independently reviewable commits, exercised against the safety D1 and
Worker first, and promoted only after its functional and performance gates pass. Additive D1 reads
remain behind `PLAYABLE_CONTENT_INDEX_READS` until parity is proven; disabling that flag is the
rollback path.

## Multiresolution Overworld Extension (2026-07-19)

- Replace browser-composed published browse previews with a sparse, immutable five-level PNG tile
  pyramid. Exact snapshots remain authoritative for play, editing, verification, construction, and
  optimistic mutation overlays.
- Generate lossless tiles asynchronously through a separate Browser Run Worker, R2, Queues, and a
  transactional D1 outbox. Published mutations invalidate the finest tile and recursively converge
  ancestors without exposing an R2 URL before the object exists.
- Stream coarse complete coverage before refinement, retain ancestors until complete sibling groups
  are GPU-ready, and apply signed-coordinate floor division plus LOD hysteresis to prevent fractional
  zoom seams and the former 0.17/0.18 oscillation.
- Keep compact world streaming as a session-sticky circuit breaker throughout staged safety and
  production rollout. Browser-side published-room composition is eligible for deletion only after a
  successful 30-day production soak at 100% tiled rollout.

## Selective Reads and Shared Caching Extension (2026-07-18)

- Compact room APIs separate ownership/summary metadata, current snapshots, paginated version metadata,
  exact immutable versions, and bounded snapshot batches. The full room route remains the compatibility
  aggregator and no room GET performs chain synchronization or D1 writes.
- Set-based reads use `playable_content_index` for builder counts, bounded candidate reads for frontier
  discovery, and one membership pass plus one resolution per expanded target for playlists.
- Course, expanded-room verification, playback, and share previews use the shared exact-version loader and
  fail explicitly when a pinned reference is unavailable.
- `COMPACT_WORLD_READS` gates projected chunk summaries and near-first progressive preview loading. Safety is
  enabled; production remains disabled. Endpoint or batch failure is remembered for the browser session and
  restores the legacy chunk route without a migration rollback.
- One capped browser snapshot/card cache is shared across world streaming, courses, Explore, Profiles, and
  Playlists. Anonymous public bases use 20-second Cache API entries after authentication checks; authenticated
  overlays, errors, mutation responses, and `Set-Cookie` responses bypass shared edge caching.

### Safety evidence

- Worker version `afefcd3c-6314-4d60-82aa-8706a763b37f` and Pages deployment
  `358ff9d6-b6ee-4039-a748-5b1b49f81b43` passed two consecutive 10-run API probes.
- Room summary is 1.1 KB at p95 122 ms; current room is 34.5 KB at p95 117 ms; builder discovery
  p95 is 139 ms; compact 3x3 world p95 is 107 ms.
- Compact/legacy world summaries and hashes match. Compact summary plus the awaited nearest nine snapshots is
  419.4 KB, 94.2% below the 7.19 MB legacy chunk response.
- The eleven-cell expanded-room snapshot batch is 166.2 KB at p95 119 ms with no missing pinned versions.
- Official browser smoke passed with a ready nine-chunk world and no application errors. The canonical 60-second
  4x-throttled mobile trace passed at p95 11.7 ms frame work with zero browser errors.
