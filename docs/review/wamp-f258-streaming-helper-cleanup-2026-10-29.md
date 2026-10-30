# F258 — retire unused streaming wrappers (in progress)

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
