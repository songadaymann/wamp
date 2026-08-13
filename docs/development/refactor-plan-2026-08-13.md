# Refactor Plan Audit — 2026-08-13

This is the current implementation plan for the cleanup proposal reviewed against
`origin/main` at `667f766`. The original proposal had the right overall goal—small,
independently verified extractions—but several findings were stale or based on a dirty
checkout rather than the tracked repository.

## Verdict

Proceed incrementally. Keep behavior-preserving extraction work separate from measured
performance changes, add characterization tests before moving unowned behavior, and do
not use line count alone as an exit criterion.

## Corrections to the original proposal

| Original claim | Current finding | Decision |
| --- | --- | --- |
| `README.md`, `node-app/`, `about-wamp-copy.txt`, and `.claude/` need Phase 0 cleanup | These are local artifacts in a stale root checkout; current `origin/main` already has the correct README and does not track the other paths | Leave the user-owned root checkout untouched |
| `earlyWorldTileBootstrap.classic.ts` is dead | `vite.config.ts` reads, compiles, and injects it into `index.html` before Phaser starts | Keep the module and its tests; treat it as critical startup code |
| Ghost playback and Room Rush still need controllers | Their scene methods are already thin delegations to `OverworldPresenceController` and `OverworldRoomRushModeController` | Do not create duplicate controllers |
| Grid overlay redraws unconditionally | `OverworldGridOverlayController` already caches viewport, zoom, and content revision, with focused tests | No change without profile evidence |
| Presence constructs and sends every frame | The scene reuses presence scratch objects; the controller coalesces updates at 25 ms for PvP, 200 ms while changing, and 5 seconds while unchanged | Profile realistic client fanout before changing cadence |
| `swordsmanTraversal.ts` has one consumer and should move under `liveObjects/` | Several modules under `src/enemies/` consume its types and behavior | Keep domain traversal code together until a dependency-boundary audit proves a better home |
| `worldStreaming.ts` is about 2,950 lines | It is now about 6,300 lines and is covered by ten focused test files | Split only along already-tested lifecycle/hydration/replacement seams |
| `OverworldPlayScene.ts` is about 6,460 lines | It is now about 7,240 lines | Reduce responsibilities in reviewable slices; do not force an arbitrary 1,200-line target |
| All three editor-family scenes should share one editing core | `EditorScene` and `CourseEditorScene` already share runtime, music workflow, and UI primitives; `CourseComposerScene` is a world-footprint composer with different responsibilities | Converge the two tile/object editors incrementally; do not force the composer into the same abstraction |
| Rename all of `src/ui/setup/` to `src/ui/modals/` | The directory also contains non-modal scene bridges, HUD setup, and orchestration | Split real modal boundaries first; avoid a misleading whole-directory rename |
| Make Knip an immediate CI gate | Knip is configured but is not a package dependency or repository script, and build-time inputs such as the Vite-read bootstrap are not ordinary imports | Model build and dynamic entry points first; then introduce the tool as an explicit, reviewed gate |

## Implementation tracks

### 1. Overworld composition root

Extract cohesive state owners one at a time, preserving call order and public behavior.

1. Quicksand contact, cooldown, and visual-sink state, with direct characterization tests.
2. Room-music target selection and signature-based playback synchronization, after tests cover
   normal rooms, expanded rooms, courses, empty music, mode exit, and deduplication.
3. Backdrop lifecycle and camera-ignore ownership, after tests cover camera ordering, parallax,
   resize, ignored-object completeness, and teardown.
4. PvP collision/action glue, only after outbound retry/throttling, inbound deduplication,
   stomp geometry, cooldown, and collision resolution are characterized.

Keep void respawn with death/session handling unless a broader player-hazard owner emerges.

### 2. Large client modules

- Move shared live-object/runtime types out of `liveObjects.ts` first; nine child modules currently
  import types back from their parent. Then split behavior only along seams with focused tests.
- Split `worldStreaming.ts` along its existing test boundaries: lifecycle, hydration,
  replacement coverage, dormant activation, and teardown races.
- Split comment data/sync from Phaser presentation without moving both at once.
- Keep enemy traversal domain code under `src/enemies/`; split the scene controller's state
  machine separately.
- Treat broad directory renames as low-priority import churn, not architectural progress.

### 3. Editor convergence

Before sharing selection, placement, undo, or persistence code, add scene-level characterization
for place/delete, selection, undo/redo, dirty state, and save/reload. Extract one primitive at a
time and retain scene-specific policy at each scene boundary. Keep `CourseComposerScene` outside the
tile/object editing core. Separately characterize and remove the apparently dormant legacy
`overworld/courseComposer.ts` controller only after proving the current scene/panel flow covers its
DOM and preview behavior.

### 4. Worker, admin, and PartyKit surfaces

- Convert the Pages Worker route-by-route behind parity tests. T13 completed that migration and
  removed `workerLegacy.js` only after typed static, share, image, and fallback routing covered the
  full contract.
- Separate Worker routes, queries, and pure scoring logic with route-contract coverage.
- Move admin application bodies behind thin entry modules without changing URL entry points.
- Split PartyKit message validation/handlers only after connect, disconnect, shard movement,
  population/editor accounting, rate limiting, and malformed-message behavior are tested.

### 5. Performance work

Performance changes remain a separate measured track. The current residual candidates are finer
profiler segments and verified allocation churn such as `lastMovementInput`. Controller gating is
not assumed safe because an inactive-looking update may perform cleanup or synchronization.

Run the existing runtime probes before and after each performance patch and report the exact path
affected. Preserve browser-composed published-room fallback while the production renderer remains
inside its documented soak period.

## Required gates

Every structural slice must pass:

```bash
npm run check
npm run smoke:dom-contract
git diff --check
```

Also run the focused unit tests and an official web-game browser smoke for the affected gameplay
surface. Worker or PartyKit changes additionally require their safety/identity probes. Performance
changes require comparable before/after runtime artifacts; a structural extraction makes no
performance claim by itself.

## Current branch status

`codex/refactor-foundation-2026-08-13` starts Track 1 with the quicksand controller extraction.
The extraction owns only contact buffering, status cooldown, and visual-sink state; movement factors,
hazard collision, player presentation, and void death routing keep their existing owners.

## Continuous manual-QA execution

The remaining work advances linearly on this branch. Every tranche ends at a recorded commit,
passes its automated gates, and is copied to an immutable build directory named
`/private/tmp/everybodys-platformer-refactor-qa/TNN-<short-sha>/`. The frozen build is served on
port `46NN` while the source worktree advances.

Manual `PASS` accepts the tranche. `PASS WITH NOTES` accepts only cosmetic or otherwise
non-behavioral notes. `STOP` freezes that dependency lane; the repair receives a new commit and
frozen build while work may continue only on an independent lane. Commits already under test are
never rewritten. No production deployment or production-data mutation is part of this program.

| Tranche | Deliverable | Status |
| --- | --- | --- |
| T00 | Quicksand state controller | Accepted: manual `PASS` at `000741f`; frozen on port 4600 |
| T01 | Room-music playback selection and synchronization controller | Accepted: manual `PASS` at `8909001`; frozen on port 4601 |
| T02 | Executable-entry guard and dormant course-composer cleanup | Accepted: manual `PASS` at repair commit `7a5336c`; frozen on port 4602 |
| T03 | Live-object model types and spatial index | Accepted: manual `PASS` at `3d93c4e`; frozen on port 4603 |
| T04 | Live-object lifecycle and interaction coordinators | Accepted: manual `PASS` at `1244099`; frozen on port 4604 |
| T05 | Movement-state ownership | Accepted: manual `PASS` at `9f8f752`; frozen on port 4605 |
| T06 | Movement and swordsman state-machine decomposition | Accepted: manual `PASS` at `d730e31`; frozen on port 4606 |
| T07 | Backdrop and camera ownership | Accepted: manual `PASS` at `a811551`; frozen on port 4607 |
| T08 | Room-comments data, composer, and presentation owners | Accepted: manual `PASS` at `aaef66f`; frozen on port 4608 |
| T09 | Editor document, history, and presentation core | Accepted: manual `PASS` at `fd1c070`; frozen on port 4609 |
| T10 | World-streaming model, selection policy, and readiness | Candidate source at `f77599a`; shared streaming DTOs now live in a model module with cache compatibility re-exports. Pure candidate precedence, nearest-preview selection, and full-room retention planning sit behind the stable streaming façade, while a focused coordinator owns dynamic-overlay generation aborts and the exact capped 500/1000/2000/5000/10000 ms retry policy. All 35 streaming/preview suites pass 260 tests; the complete 177-file / 1,222-test gate, lint, TypeScript, generated bindings, production build, DOM contract, and diff checks are green. Manual QA pending on port 4610 |
| T11 | World-streaming preparation and teardown lifecycles | Candidate source at `516215d`; focused coordinators now own full-room preparation state, standard/portal activation ownership, cancellation/failure, deferred commits, phased teardown, forced destruction, retention, and reconciliation while the stable façade retains Phaser operations and their exact destruction order. All 36 streaming suites pass 264 tests; the complete 178-file / 1,226-test gate, lint, TypeScript, generated bindings, production build, DOM contract, and diff checks are green. Manual QA pending on port 4611 |
| T12 | PvP combat geometry, ledger, presentation, and coordinator | Candidate source at `419e6fd`; a two-client fake PartyKit baseline locks the 4.2-second countdown, combat relay, hit deduplication, 1.8-second invulnerability, death/finalization, and winner result. Pure geometry owns sword/gun/stomp envelopes and peer collision resolution; a combat coordinator owns the exact 180 ms hit throttle, 450 ms stomp cooldown, inbound ledger/rollback, hit IDs, action latch, and 25 ms instance cadence; local hearts/invulnerability/damage feedback now have a presentation owner. Invitation, setup, and match lifecycle remain in the arena controller. Focused 21-test coverage and the authoritative complete 182-file / 1,241-test rerun pass with lint, TypeScript, generated bindings, production build, DOM contract, and diff checks green. Manual QA pending on port 4612 |
| T13 | Typed Pages Worker migration | Accepted: manual `PASS` at `68b362b`; frozen on port 4613 |
| T14 | Cloudflare Worker analysis/admin module split | Pending |
| T15 | Thin admin UI entries and application modules | Pending |
| T16 | PartyKit protocol and server decomposition | Pending |
| T17 | Measured performance and dead-code closeout | Pending |

Every client tranche receives an exact route, fixture expectations, account/write requirements,
and a short manual checklist. The common sweep covers direct-link refresh, Browse pan/zoom/Fit,
Play movement and a room seam, editor entry/return without saving, and visible/runtime errors.
Worker tranches add the safety probe; PartyKit adds identity and load probes; performance work uses
comparable before/after artifacts. Current `origin/main` is merged at clean lane boundaries without
rewriting reviewed commits, then reconciled once more before final acceptance.
