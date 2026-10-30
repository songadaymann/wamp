# F255 — retire the superseded Cyber resolver (delivered)

Remove the old cardinal/eight-neighbor Structure topology, facade, rectangle,
underground, footprint and disabled auto-decoration/detail-picker code after
checking current callers. Preserve live diagonal tie and tunnel outline resolvers,
their structural deco guard and all runtime rubble/support/neon/fence/platform
paths. Narrow the old topology type to a four-corner union for live tie tiles.
Git history retains the deliberately disabled automatic-decoration implementation.
Production use of the retired resolver ended in122edaf3 (2026-08-30).

Remove the unused v2 brush constants, framed-panel wrapper and recipeBounds.
Move letter/void edge invariant validators into test support with unchanged bodies;
retain their existing assertions on actual solver results. Keep live platform-span,
Foreground tie, tunnel, rubble, support, neon and structural deco invariants. Delete
only superseded resolver/picker assertions, including mixed statements inside
otherwise retained tests. Rollup already removed these exports, so this is chiefly
maintenance and test-time cleanup, not a promised download saving.

Full check on this independent base passes747files/6277tests, one existing expected
failure/two skips, all stages,669.5/670KB. Focused4files/131tests pass. Exact
smart-autotiling smoke passes every editor/Cyber/Expanded/local-persistence assertion
with no console/page errors or synthetic room mutations. It uses local recorded API
responses (including server-side requests), local Vite and blocked live multiplayer;
its Vite development websocket is allowed locally. Initial fixture attempts passed
editor assertions but reported proxy/resource/HMR errors; fixed only local harness
routing, then reran the unchanged maintained smoke successfully.

Evidence: /tmp/wamp-f255-check.log, focused-final.log, smart-smoke-3.log,
reference-audit.json and shrink.log. Local harness under ignored output/f255-native/.
No production writes. Must rebase on preceding deliveries and verify the combined
head before PR, CI and live delivery; checklist remains open.

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
