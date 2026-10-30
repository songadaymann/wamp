# F334: reuse cached map artwork for share previews — 2026-10-29

Delivered in [PR #338](https://github.com/songadaymann/wamp/pull/338), merged
`a1470b3532b45675569f6d36faf9ea83ff758a57`.

## Behavior

API and public Pages share metadata and HTML advertise the ready, real-art world-map leaf for a
standalone room, with its actual 642×354 dimensions. The existing image/image.png
API endpoints also serve those stored PNG bytes. The prior renderer remains the
fallback when a leaf is absent, stale, empty, unavailable or from a different
renderer/asset contract. HEAD responses remain bodyless.

Expanded Rooms compose the ready cell leaves into a 1200×630 PNG once and store
it in the existing R2 bucket under share-artwork/v1. The content key includes the
area/version, renderer, exact pinned cell versions, geometry, ready hashes and
object keys. Repeat requests reuse the PNG. Composition crops the map overlap,
uses nearest sampling, preserves negative coordinates and empty footprint cells,
and fits the complete footprint within the card.

A consistent manifest read includes current published version summaries. A leaf
must match the exact requested/pinned room version as well as its ready/desired
generation. Current map art never substitutes for an older Expanded Room pin;
that case retains the existing renderer. Moderation masking runs before cache
selection, and changed snapshots use the masked fallback rather than an old leaf.
A missing/corrupt PNG or R2/D1 failure also preserves fallback behavior.

This item changes share routes. Wamp-O-Gram previews and improvements to the old
renderer remain the separate F269/F389 tasks. No schema migration or new bucket
is required. Composite objects use a separate prefix from world-tile GC.

## Verification

- Full check: 722 files, 6,154 passing tests, 10 expected failures, two skips;
  types, lint, DOM, generated bindings, build and assets passed. Boot JavaScript
  is 665.5 KB Brotli / 670 KB. Dead-code baseline shrinks from 783 to 781 because
  the world-tile content dimensions now have a live consumer.
- Share tests: cached URL/dimensions, API HTML, public Pages metadata and trusted
  tile-host/path validation, both image aliases, bodyless HEAD,
  missing/unavailable storage fallback and moderation fallback.
- Artwork tests: ready/empty/stale/missing leaves, renderer/contract mismatch,
  older pinned versions, negative/vertical coordinates, overlap cropping,
  footprint holes, cached composite reuse and invalidation after repair/version
  changes, malformed/missing/wrong-size PNGs and read/write failures.
- Isolated native workerd/D1/R2 probe passed real SQL reads, stored leaf URLs,
  PNG decode/composite/encode, composite reuse, stale-generation fallback and
  pinned-version mismatch fallback. No production data writes were used.

Local evidence: /tmp/wamp-f334-final-check.log, /tmp/wamp-f334-native.log;
ignored native probe sources and bundle: output/f334-native/.

## Production delivery

All 18 GitHub jobs passed in [CI run 40897749531](https://github.com/songadaymann/wamp/actions/runs/40897749531).
Merged runtime source matches tested candidate `62afd61b`; only the prior F275
delivery-record documents differ. Guarded full frontend/API deployment and
production smoke passed. Worker `301ccc79-d40d-4fa0-92a6-99bbf9004902` is confirmed
at 100%; previous Worker `f0292cdb-b7f8-453a-896b-4594ed81b4d2` remains available
for rollback. Pages: [d2851806](https://d2851806.wampland.pages.dev).
Production entry `main-BXrozcfs.js` and both editor bundles match release bytes.
Migration 0076, database, map and email health checks passed; no migration.

All 25 sampled published standalone rooms advertise ready map leaves. Five live
end-to-end samples passed public Pages OG URL/dimension checks, PNG dimensions,
bodyless HEAD and equality between the advertised PNG and the existing API image
endpoint: one 642×354 leaf, two 1200×630 Expanded composites and two 1200×630
fallbacks. The four-cell fallback at 0,-3 pins cell 0,-4 version 3 while the map
shows its current version 7, confirming the exact-version guard on live data.
Two first composite metadata reads took 654/756 ms in these samples. The composed
real-art image was visually inspected. No production room/player writes or emails
were used; normal R2 image-cache writes occurred through the feature's GET path.

Evidence: `/tmp/wamp-f334-deploy.log`, `/tmp/wamp-f334-deployments.json`,
`/tmp/wamp-f334-live-assets.json`, `/tmp/wamp-f334-live-verification.json`,
`/tmp/wamp-f334-fallback-evidence.json`. Goal 5/28 delivered; Round 2 77/248.
