# F257 — unused client helpers and completed boot diagnostics (delivered)

Remove47 uncalled functions/methods/getters after checking source, scripts and
current tests. This covers badge placement, obsolete editor labels/document
updates/randomize wrappers, custom-sprite single-entry/metadata helpers, old
share/draft/identity/agent/path helpers, streaming/class accessors and other small
client leftovers. Keep setDraftRoom: camera smoke and snapshot tests use it.
The two unused minted render helpers were already removed by F261 in PR352.
Remove the unused SfxController mute methods and now-constant private mute field;
real volume and shared audio-engine controls remain.

Keep finishBootDiagnostics and call it once immediately before wamp:app-ready is
dispatched. Existing stall-watch callbacks now stop producing boot warnings once
ready. Forced runtime error reporting remains. Unit test checks readiness listeners
observe inactive diagnostics, duplicate readiness does not log again, and a watch
started before readiness stays silent afterward. Real browser reaches appReady,
then confirms exactly one readiness entry, inactive diagnostics, no additional
post-ready logs/watches and zero page errors using local recorded API fixtures.

Smart Brush tests now exercise brushEngine's registered cell/outline entrypoints,
with existing semantic-lock assertions using the live manual-edit/reconciliation
flow. Sword Hunter order-invariance tests now compare actual warmed planner
results against recorded plans for both preparation orders, including zero cold
simulations; the debug-only edge wrapper is gone. Remove only assertions for
retired wrapper behavior, retaining live clone, label, flip-mode and API-error tests.
No new unused-code baseline allowances; shrink20 addressed entries and preserve
unrelated pre-existing fakeDom entries.

Full check passes747files/6287tests, one existing expected failure/two skips,
all stages, boot669.2/670KB. Focused10files/186tests and planner5tests pass;
final readiness-watch test passes9tests after enhancement. Native real-browser
readiness proof passes. Initial strict typecheck found six orphaned imports/state
left by deletions; removed them and reran the full check successfully.

Evidence: /tmp/wamp-f257-check-final.log, focused.log, planner.log,
boot-final-test.log, native.log/native.json, reference-audit.json and
removed-symbols.json (same prefix). Native harness ignored under output/f257-native/.
No production room/player/email/wallet writes. Delivery proof follows.

PR354 passed all20 exact-head checks on97bf1712 and merged as8fac31e5. Guarded
Pages-only rollout cfcda957 and production smoke pass. Live entry/editor/styles
match release bytes. Real live browser with recorded API and blocked multiplayer
confirms diagnostics inactive, exactly one app-ready entry, stable logs and zero
page errors. API unchanged; no migration or real player/room/email/tx writes.
Evidence: /tmp/wamp-f257-release.log, live-assets.log and live-browser.json/log.
