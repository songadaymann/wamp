# F199 ranked trace anchoring

Delivered 2026-10-10 in [PR #112](https://github.com/songadaymann/wamp/pull/112), merge `3e6d82f8`, and deployed to the production API Worker (https://api.wamp.land, version `222ae49e`). No trace format change.

## Behavior

A ranked trace must look like what the recorder produces for real play:

- **Starts at the start.** First breadcrumb at the beginning of the recording (≤ 50 ms) and within 400 px of the room's start point, or the course start for Expanded Rooms.
- **Continuous.** At most 1 s between breadcrumbs, except at a death respawn; goal events while recording (≤ 1 s after the last breadcrumb); the nearest-breadcrumb fallback only within 1 s of an event.
- **Enemy defeats near the player.** Within 400 px of the player at that moment, measured in world space.

## Calibration

From the 109 stored traces of real play since May (April excluded: it includes scripted test traffic): first breadcrumb always at 0 ms, gaps ≤ 287 ms, goal events ≤ 241 ms after the last breadcrumb, first breadcrumb ≤ 310 px from the start point (a run can qualify while moving), enemy defeats ≤ 251 px from the player. Replaying the 108 with room snapshots through the previous and new verifier changes no outcome; all 54 current passes still pass.

## Evidence

- `npm run check` on Node 22: 419 files, 3,326 tests.
- `traceAnchoring.test.ts` (real recorder into the real verifier): honest run passes; one-breadcrumb-at-exit, start-and-exit with a 1.5 s gap, no breadcrumbs, late first breadcrumb, and goal event after recording are rejected; an enemy defeat passes when stomped and fails from across the room; an Expanded Room run is anchored at the course start. Six of seven fail against the previous verifier.

## Found while calibrating

The replay showed two older rules rejecting likely-honest runs: 20 of the 54 rejections since May were a trace-duration mismatch caused by network latency between the run start request and the game timer (0.7-3.5 s against a 0.6 s tolerance), and 11 were enemies defeated more than 64 px from where they were placed (patrolling and flying enemies move). Neither is changed here.
