# F198 ranked trace coverage for honest play

Delivered 2026-10-10 in [PR #110](https://github.com/songadaymann/wamp/pull/110), merge `b999fb4f`, and deployed to the production API Worker (https://api.wamp.land, version `cd6f0752`, release check, build and production smoke passing). Death respawns were already handled by the respawn-checkpoint work (`4ea126e7`). No trace format change, so clients already in players' browsers benefit without updating.

## Behavior

- **Portals.** A portal teleport leaves no trace event. The verifier now lists every teleport the published room or course allows (`src/runs/portalHops.ts`, mirroring play's pairing rules) and accepts a gap between two breadcrumbs, or a room change, when reaching the portal's entrance plus leaving its exit fits the normal movement limits. A portal grants no extra reach, and a jump no portal can explain still fails.
- **Long runs.** Trace limits cover the existing 30-minute run limit: breadcrumbs for the full duration plus one per respawn, 16,384 input events, 1,024 respawns and 2,048 room changes. Before, runs past about 8.5 minutes or with more than 256 deaths were rejected.
- **Audit storage.** A trace over 1.5 MB keeps only its summary in the audit row, so a long run cannot fail on the database row limit.

## Evidence

- Before the change, a read-only count of production verification outcomes found no failures since 2026-09-23. Stored traces put honest play at about 2-6 input changes a second and 30-40 KB a minute; the only traces above 50 changes a second were a script flipping left/right every frame.
- `npm run check` on Node 22: 417 files, 3,313 tests.
- `traceCoverage.test.ts` drives the real recorder into the real verifier: portal pairs in both directions; a same-room teleport passes and the same jump fails without portals or with portals that cannot explain it; a course-linked portal between non-adjacent rooms passes and fails without the link; a 12-minute run with 300 deaths and about 6 input changes a second passes, including through the request normalizer; an oversized trace is audited as summary only. Five of these seven fail against the previous verifier.
- Deployment shipped only this change: no other Worker source changed since the previous production deploy, and the one changed shared module in the bundle only adds an unused function.

## Follow-up: PR #113

Merged as `84de79ec` and deployed (API Worker `8c06f631`). While calibrating F199, the stored-trace replay showed two older rules rejecting likely-honest runs: Expanded Room and course runs compared the trace with server time including network latency (0.7-3.5 s vs a 0.6 s tolerance; 20 of 54 rejections since May), and enemy defeats had to be within 64 px of the placed enemy although enemies patrol, fly and chase (11 of 54). Those routes now verify against the reported play time like rooms and guests, and a non-boss enemy defeat must be inside its room and within 400 px of the player. Replay: 11 of the 12 enemy rejections pass; no previously passing run changes.
