# F334: reuse cached map artwork for share previews — 2026-10-29

Implementation and local verification complete; PR, CI and delivery pending.
The checklist item remains open until verified in production.

## Behavior

Share metadata and HTML advertise the ready, real-art world-map leaf for a
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

- Full check: 722 files, 6,147 passing tests, 10 expected failures, two skips;
  types, lint, DOM, generated bindings, build and assets passed. Boot JavaScript
  is 665.5 KB Brotli / 670 KB. Dead-code baseline shrinks from 783 to 781 because
  the world-tile content dimensions now have a live consumer.
- Share tests: cached URL/dimensions, HTML, both image aliases, bodyless HEAD,
  missing/unavailable storage fallback and moderation fallback.
- Artwork tests: ready/empty/stale/missing leaves, renderer/contract mismatch,
  older pinned versions, negative/vertical coordinates, overlap cropping,
  footprint holes, cached composite reuse and invalidation after repair/version
  changes, malformed/missing/wrong-size PNGs and read/write failures.
- Isolated native workerd/D1/R2 probe passed real SQL reads, stored leaf URLs,
  PNG decode/composite/encode, composite reuse, stale-generation fallback and
  pinned-version mismatch fallback. No production data writes were used.

Local evidence: /tmp/wamp-f334-check.log, /tmp/wamp-f334-native.log;
ignored native probe sources and bundle: output/f334-native/.
