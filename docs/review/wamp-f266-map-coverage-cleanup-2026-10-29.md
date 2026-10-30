# F266 — retire unused map coverage contracts (in progress)

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
