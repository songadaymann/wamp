# F254 — retire inert styles and guard against regrowth (delivered)

Remove49 dead selector entries across14 CSS files, preserving live siblings in
selector lists (including auth-row and playlist level grids). This includes the
review's old auth/HUD/profile/tooltip/menu styles and playlist-intro-control(s),
plus two newly confirmed unused names, editor-music-select and the old secondary
HUD action row. The old non-dock editor layout rules and redundant UI branch were
already removed in F253; no new removal of those is claimed.

Add a conservative selector-source scan to the existing smoke_dom_contract.mjs,
using the existing PostCSS dependency. It checks3,795 selectors against client
source/root HTML tokens and permits generated class prefixes. Explicit retired
playlist-class guards handle the live playlist-intro-controls ID sharing that name;
explicit layout guard prevents the old editor-without-dock pattern returning.
This token scan is conservative source evidence, not a full DOM reachability proof.

Actual CLI probes accept a generated prefix class and reject an absent name, the
retired playlist class, and the obsolete editor layout; temporary probe files were
removed. DOM contract, shared style/cascade checks and guard lint pass.

Real browser compares baseline and changed computed styles on desktop and phone
for the actual menu, editor, playlist controls and About modal. Every sampled style
matches; all removed selectors have zero DOM matches in these states; zero page
errors. Screenshots inspected. Baseline/current Vite servers run sequentially with
separate caches; the first dual-server attempt stalled during module startup.
Recorded local API/browser fixtures, blocked live multiplayer/external requests;
local proxy warnings from background requests are separate from page errors and
do not affect the style comparison. No production writes.

Evidence: /tmp/wamp-f254-removed-selectors.json, guard-probes.json, dom-contract.log,
styles.log, guard-lint.log, native-2.log/native.json. Local screenshots/harness under
ignored output/f254-native/. Final combined full check, PR CI and live verification
remain; this item is not yet delivered.

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
