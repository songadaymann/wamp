# F254 — retire inert styles and guard against regrowth (in progress)

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
