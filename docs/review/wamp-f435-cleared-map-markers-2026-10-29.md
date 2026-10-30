# F435 — cleared-room markers on the world map (2026-10-29)

Delivered through PR #344, merge `2bd76733`. All20 checks passed for tested
head `d3bda257` (18 GitHub jobs plus two Cloudflare previews).

Published rooms now have a cream corner check in map browse mode when the player
has cleared them. The shape remains distinct from the gold Lost Song frame; both
can appear together. A Cleared count sits alongside Songs. Markers redraw when
personal progress changes, including while the scene is idle, and disappear in
Play mode or private Worlds.

Signed-in progress comes from a private, session-owned, paged endpoint. Only
completed runs with accepted verification count. Expanded clears use the cells
from the completed version, rather than the current footprint. Switching accounts
clears the old view immediately; failed refreshes preserve that account's last
confirmed progress. Guest progress stays local and survives the existing 50-run
history limit, with up to 5,000 room checks retained. Guest history never becomes
an account claim. Explicitly ineligible clears do not add checks.

New guest Expanded records retain their exact cell IDs. Older records resolve
published historical geometry through a public version-bound footprint endpoint;
this exposes no personal completion state. Unpublished/private World geometry is
excluded. Failed historical lookups retain confirmed checks and can retry.

## Verification

- Real D1/Worker route tests cover unauthenticated access, session ownership,
  accepted/invalidated runs, deduplication, 512+3 pagination, private cache policy,
  and the old Expanded footprint after a larger republish.
- Cache tests cover identity races, all-page atomic updates, failed refreshes,
  guest persistence beyond 50 history entries, blocked storage, ineligible clears,
  historical lookups and mismatched version responses.
- Renderer tests exercise actual graphics, coexistence with Lost Songs, idle
  redraw, subscription cleanup and exclusion from Play/draft/private cells.
- Native workerd/D1 and a real signed-in desktop browser load three completed
  cells, exclude a newly added uncompleted cell, then clear another room through
  the actual game and update the map. Zero page errors.
- Native workerd/D1 and a real phone-sized guest browser use touch controls to
  finish a room, update the checks and preserve them after reload. A second case
  starts with an older Expanded guest record: v1's two cells are marked, v2's
  added cell stays unmarked, and a new ordinary clear persists too. No private
  account-progress requests; zero page errors.
- Account and phone screenshots inspected; no production room/player writes or
  emails. No schema migration.

Local evidence: `/tmp/wamp-f435-native-browser.log`,
`/tmp/wamp-f435-native-phone.log`, `/tmp/wamp-f435-native-legacy-phone.log`,
ignored `output/f435-native/`, and `/tmp/wamp-f435-final-check.log`.

Final full check passed:728files, 6,186tests, one existing expected failure and
two skips. All lint, types, DOM, generated binding, build and asset stages pass.
Boot667.9KB/670KB. Worker-safety and strict immutable map-asset contract probes
pass. Final check: `/tmp/wamp-f435-final-check.log`.

CI initially exposed missing isolated responses for the new signed-in map read in
existing browser fixtures. Added session-bound empty progress to those fixtures;
their missing-request, HTTP and console-error assertions remain unchanged. Native
Worker/D1 progress tests continue to exercise the real endpoint and nonempty data.


## Live delivery

The clean merged-main release passed migration and strict map asset guards.
Worker `e6f01c31-267f-4b3a-bd98-efdf915b5c9c` is confirmed at100%; Pages
`5c0b2569` is published. Live entry `main-CEMa21wF.js`, runtime, lazy cleared-room
service, both editors, result dialog and styles match release bytes. The live
counter is present. Signed-out account-progress reads return401 even with a
spoofed user query. A real public Expanded target returns its16 exact version3
cells, no personal state and no-store; invalid version0 returns400.

The immediate post-publish smoke saw an old boot asset404 during propagation.
The standalone production smoke then passed all19 boot scripts, DB/migration0076,
email configuration and immutable map health. No deployment was restarted for
that observation. No production player/room writes or emails were used.

Evidence: `/tmp/wamp-f435-deploy.log`, `/tmp/wamp-f435-prod-smoke-retry.log`,
`/tmp/wamp-f435-deployments.json`, `/tmp/wamp-f435-live-api.json`,
`/tmp/wamp-f435-live-assets.json`. Local fixture follow-ups also pass14 native
collection checks/two desktop gate flows and12 native wallet-auth checks/three
desktop login flows. A local full recovery sweep hit one editor-entry timeout
with no API misses/page errors; the exact case passed its targeted rerun, and
all four complete recovery profiles passed CI before merge.
