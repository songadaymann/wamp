# F266 — retire unused map coverage contracts (delivered)

Remove the old sibling replacement/visible coverage/ancestor planners and their
result types, unused viewport coverage assembly and old pixel-scale/room-bound
helpers/constants. Keep the real map scheduler, display planner, geometry used by
it, manifest bounds, renderer model and isWorldTileDisplayable/availability union.
The production controller calls resolveWorldTileDisplayPlan and its replacement
completion check; this remains the authoritative behavior.

Remove tests that only exercise retired planners. Strengthen the existing live
four-child display-plan invariant: parent imagery remains attached while the last
child is pending, failed, decoded-but-not-GPU-ready, or GPU-ready-but-not-decoded.
Only once the fourth child is ready-empty does the real planner replace the parent
with the other three ready images. Existing actual display-plan/restoration/
scheduler tests retain nearest fallback, gaps, ordering and restoration coverage.

Strict typecheck and27 map/renderer-model test files155tests pass. No new unused
baseline allowances; preserve unrelated fakeDom entries. No production requests or
writes needed for this removal of uncalled pure functions.

Evidence: /tmp/wamp-f266-focused.log, types-final.log, dead-code.log and shrink.log.
Final combined full check, PR CI and live map/frontend checks remain before delivery.

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
