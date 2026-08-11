# Multiresolution Overworld Tile Pyramid

This document is the implementation and rollout contract for replacing browser-composed published
overworld previews. Exact room snapshots remain authoritative for play, editor, run verification,
construction previews, and mutation overlays.

## Geometry and visual contract

All raster objects have a `640x352` content rectangle plus a one-pixel extruded gutter, producing a
lossless `642x354` PNG. Coordinates use mathematical floor division, including west and north of
the origin.

| Level | Room coverage | Pixels per game tile | Initial zoom band |
| --- | ---: | ---: | ---: |
| L0 | 16x16 | 1 | `< 0.10` |
| L1 | 8x8 | 2 | `0.10-0.20` |
| L2 | 4x4 | 4 | `0.20-0.40` |
| L3 | 2x2 | 8 | `0.40-0.80` |
| L4 | 1x1 | 16 | `>= 0.80` |

Parents use a deterministic 2x premultiplied-alpha box reduction in sRGB. This preserves the
perceived palette of the covered source area instead of promoting one small highlight into an
entire low-LOD game tile. Published tiles include canonical backgrounds, every tile layer, objects,
custom tiles and sprites, and deterministic starfields. Empty cells remain transparent. Phaser
still uses nearest filtering and places the gutter outside the tile's world-space core, so the
precomputed representative pixels remain crisp on screen.

Promotion thresholds are `0.108`, `0.216`, `0.432`, and `0.864`; demotion thresholds are `0.092`,
`0.184`, `0.368`, and `0.736`. A gesture scales attached imagery immediately, then changes level
after 80 ms idle and complete replacement coverage.

## Published and dynamic imagery

Only current published appearances may enter public immutable objects. Drafts and
claimed-unpublished content must never enter tile rows, Queue messages, manifests, or R2.

Dynamic precedence is:

1. Full playable room
2. Course or editor override
3. Local draft
4. Live PartyKit construction preview
5. Saved claimed-unpublished preview
6. Optimistic publish or revert overlay
7. Published tile pyramid

Selection, ownership, badges, expanded-room boundaries, population, comments, chat, ghosts,
lighting, frontier UI, and animation remain typed Phaser overlays. A live construction preview is
ignored when the canonical summary says the room is published.

## Consistency model

Published-room mutation and L4 invalidation share one D1 transaction through an additive trigger
and durable outbox. Queue delivery is only a wake-up mechanism: consumers validate generations,
acquire conditional leases, and make duplicate or out-of-order jobs no-ops. A content-addressed R2
object is uploaded before a compare-and-swap publishes its ready pointer. Missing assets fail
strictly and retain the previous ready tile.

Completed children invalidate their parent. Parents publish only after every nonempty child is
current; an empty parent is a ready marker without an R2 object. One-minute repair recovers
undispatched outbox rows and expired leases. Object garbage collection is an explicit guarded
operation for unreferenced objects older than 30 days.

Every build derives a versioned `rendererAssetContractHash` from the canonical built-in tileset,
object, and background registries and publishes it through `GET /api/authoring/catalog`. A renderer
version must store that exact value as its `asset_contract_hash`. If the active immutable renderer
does not match the current registry, config reports tiled reads unavailable and manifests return
404, activating the current browser-composed fallback instead of serving stale parent imagery.
Backfill and activate a matching immutable renderer to restore tiled reads after registry changes.

## Client coverage contract

Cold entry paints the smallest complete L0 cover first and then refines. Attached parents, stale
tiles, and previous renderer versions remain until all visible replacement siblings are decoded and
GPU-ready. Four-child groups swap together, with a 75 ms stationary-browse blend and atomic swaps in
play or reduced-motion mode.

Manifest refreshes are coalesced to 10 Hz while moving and always include the latest trailing camera
state. The guard covers 25% of the viewport on every side plus 50% in the direction predicted from
smoothed velocity 250 ms ahead. Selection uses summary coordinates rather than raster hit testing.

The default budgets are six fetches, two decodes, and two uploads per frame within four milliseconds;
the reduced profile uses three, one, and one within two milliseconds. Immutable bytes use
CacheStorage with IndexedDB LRU metadata; textures use a pixel-counted Phaser LRU. Visible tiles,
fallback ancestors, replacement siblings, and directional guards are pinned.

Permanent manifest incompatibility disables tiled reads for the session. Transient failures retain
current imagery and retry at 0.5, 1, 2, 5, and 10 seconds. Three critical failures while uncovered,
or ten seconds without complete coverage, activates the session-sticky compact fallback behind
existing imagery.

## Rollout state

`WORLD_TILE_GENERATION_ENABLED`, `TILED_OVERWORLD_READS`, and
`TILED_OVERWORLD_ROLLOUT_PERCENT` are independent. Safety and production use separate D1 runtime
rows, R2 buckets, Queues, DLQs, domains, and renderer versions. Generation hooks and backfill land
before reads.

Safety must pass full parity, object-existence checks, zero-DLQ status, and two consecutive browser
probe suites before activation. Production advances through stable anonymous cohorts at 5%, 25%,
and 100%, holding each cohort for at least 24 hours. Compact rendering remains the rollback path for
30 successful days at 100%; only then may browser-side published-room composition be deleted.

Use the current catalog's `rendererAssetContractHash` for the backfill command's
`--asset-contract-hash`. The public world-tile config exposes both the active and expected hashes
for diagnosis. Never activate a renderer whose asset contract differs from the catalog.

Run the standalone safety parity gate against an activated renderer with:

```bash
npm run perf:overworld:tiles:parity -- \
  --api-base https://everybodys-platformer-safety.novox-robot.workers.dev \
  --renderer-origin https://<deployment-hash>.wampland.pages.dev \
  --renderer-version <renderer-version> \
  --out output/overworld-tile-pyramid/safety-parity
```

It records manifest size/timing/cache headers, advertised-object HEAD parity, missing/empty/stale
coverage, canonical L4 pixel comparisons, gutter checks, and an independent premultiplied-alpha box
parent composition in `world-tile-parity-report.json`. PNG evidence is written beside the report.
The default visual tolerance is at most 0.1% differing pixels with per-channel delta at most 1.

## Measured compact baseline

The 2026-07-19 desktop baseline is stored under
`output/overworld-tile-pyramid/baseline-compact`. It found `stream.buildChunkPreviewTexture` to be the
dominant task: p95 was roughly 795 ms while zooming out and 1.34 seconds while zooming in, with
individual browser-composed chunk builds reaching 1.34 seconds. This is the comparison point for
coarse coverage, sharp readiness, transfer, and replacement-gap metrics.
