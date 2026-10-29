# F269 / F389: shared real-art share renderer — 2026-10-29

Implementation and local verification complete; PR, CI and rollout pending.
Both checklist items remain open until production delivery is verified.

## One painter and layout

The API share fallback and Wamp-O-Gram preview now use the same real-art painter
as standalone Pages images. Shared primitives, assets and renderer live in
`src/roomImage/`; Pages retains a thin HTTP adapter and the API supplies an
injected asset/background environment. The former 721-line abstract API painter
is removed. Changed runtime TypeScript shrinks by 684 nonblank lines relative
to the F334 candidate, including the new shared modules and cache bounds.

Expanded fallback cells render at the native room grid, then use the same
composition geometry as cached map leaves. Negative coordinates, footprint
holes, input ordering and all sixteen cells fit the card. Map overlap is cropped
only for cached leaves; existing cached-composite pixels/key format stay valid.

Approved uploaded backgrounds load through the API's local public background
handler, retaining approval/deletion checks without an HTTP self-fetch. Uploads
are validated anew for each render operation. Expanded cells decode sequentially
and retain at most the current cell's photo. The shared decoded-asset cache is
bounded to 32 MB / 64 entries, with recent entries reused.

## Correct drawing and moderation

The painter uses canonical background normalization, tile decoding/lookup,
custom-sprite IDs, object display scale/offset and background-layer layout.
Default rooms use the game's seeded starfield on #050505. Group base colors and
nonrepeating layers are honored; approved photos draw their actual pixels.
Custom tile pixels and flips work on all layers. Background objects and custom
sprites draw with real art. Room content is painted at native resolution before
scaling, preventing fractional object-offset drift and transparent-pixel bleed.
Source-over blits preserve alpha on intermediate transparent layers.

Pages moderation now includes custom-tile source sprite IDs even when no sprite
is embedded. It applies the same canonical mask as API/map rendering; if the
blocklist cannot load, community art is masked and cached briefly. Wamp-O-Gram
visibility/deletion checks stay ahead of the cache. Uploaded-photo previews,
like community art, get an hour in the Worker and no immutable ETag. Hidden
versions still draw the redacted snapshot. Renderer versions bump to gram 2 and
Pages assets-v6 so clients can refresh intentional drawing changes.

## Verification

- Full check: 722 files, 6,150 passing tests, one existing expected failure,
  two skips; lint, types, DOM, bindings, build and asset checks passed. Boot
  JavaScript 665.5 KB Brotli / 670 KB. Dead-code baseline shrinks 781 to 780
  because the canonical solid-color parser now has a live consumer.
- Eight renderer-equivalence checks formerly marked expected failure now pass
  normally: custom tiles, scaled/offset background tree, transparent sprite gaps,
  default starfield, flipped custom tiles, omitted background/custom objects and
  blocked art. Obsolete abstract-style characterizations are replaced by real-art
  parity, PNG pins, geometry and source-over tests. The unrelated expected failure
  remains unchanged.
- API and Pages cards match every pixel for feature rooms. Native room-sized
  starfield, desert, jungle, spooky moon and spooky mountain backgrounds match
  the game/world canvas exactly, including repeat/base color behavior.
- Tests cover image aliases/HEAD and cached-art fallback, pinned-version guards,
  all sixteen cells without clipping, photos/approval refresh, sequential upload
  decoding, cache count/byte eviction, Wamp-O-Gram deletion/hidden-version/cache
  policy and Pages tile-only moderation with an unavailable blocklist.
- Isolated compiled workerd/D1/ASSETS probe passes real published-room PNG
  rendering and Wamp-O-Gram pixel parity (hash
  30dcb711c5b9fe211fdf7f9ac10e4ca5f27a6108debd759374a189168c7a5073),
  community-art ETag policy, deleted gram 404 and bodyless HEAD. Native feature
  PNG was visually inspected. No production room/player writes or emails.

Evidence: `/tmp/wamp-f269-complete-check.log`,
`/tmp/wamp-f269-native-complete.log`; ignored native probe/artifacts:
`output/f269-native/`. No migration. Goal stays 5/28 until delivery.
