# F258 — retire unused streaming wrappers (delivered)

Remove unused singular transient-override setters/clearers from the streaming
controller, playback host interface and composition wiring; current playback uses
the plural methods. Camera smoke now calls setTransientRoomOverrides([room]).
Remove unused controller snapshot-map and preview-presence wrappers and the now
uncalled renderer presence method. Point social startup at the existing secondary
startup method directly. Delete previewCache compatibility re-exports after moving
both the unit-test type import and live-construction smoke to worldStreamingModel.
Remove obsolete singular mocks and six method-spacing gaps.

Keep setDraftRoom, its ingress-normalization test and camera use. Keep the preview
cache's own snapshot-map method (used internally), exact-snapshot advisor hooks,
clone counter and all live plural override behavior. F257 already removed the
other four uncalled methods listed by this older finding.

Strict typecheck and18 focused files/182tests pass, covering room snapshot ingress,
readiness/lifecycle/previews and ranked/guest playback. Actual live-construction
smoke passes. Exact maintained camera smoke passes on desktop and phone: save/
reload, fixed framing during movement/zoom, portrait fit, adjacent-room crossing,
reentry/respawn and phone toggle back to follow. No runtime errors.

Camera smoke's GET guard now falls through to installed local replay fixtures;
without a fixture this still reaches the network. Initial native run bypassed
those fixtures and timed out on an incomplete world response. Routing fix changes
no camera assertion or production behavior. Native Vite/recorded HTTP and browser
API, multiplayer blocked, no production writes. Evidence: /tmp/wamp-f258-focused.log,
live-construction.log, camera-desktop-2.log, camera-phone.log, types.log and
shrink.log. Harness ignored under output/f258-native/.

Full combined check, PR CI and live rollout remain before delivery.

## Combined verification — 2026-10-30

Integrated all5 cleanups on delivered main649a9f12. Full check passes746files/
6271tests, one existing expected failure/two skips, all stages, boot662.1/670KB
across16 files. Tighten four oversized-file limits to actual reduced line counts;
the initial combined run caught the stale streaming pin before proceeding.
Evidence: /tmp/wamp-client-final-five-check-final.log. Individual browser/CLI/
algorithm proofs above remain valid. PR CI and live rollout still required;
this item remains unchecked. No API/schema change in this batch.

## Delivery verified — 2026-10-30

The pending delivery status above is superseded. PR356 passed all20 checks on
18446370 and merged as067726eb. Guarded Pages-only rollout559d79e5 and production
smoke pass. Live entry/editor/style asset bytes match release. Real desktop/phone
browsers with recorded API and blocked multiplayer reach appReady, open/close
About, load hot sound assets with zero footstep requests, retain inactive boot
diagnostics and have zero page errors. Removed selectors have zero DOM matches.
Public map PNG200/642x354 remains valid; API health expects/applies0078.
API Worker and renderer unchanged. No production player/room/email/transaction
tests. Evidence: /tmp/wamp-client-final-five-release.log, live-assets.log,
live-browser.json/log and live-map.json. Goal27/28; Round2 99/248.
