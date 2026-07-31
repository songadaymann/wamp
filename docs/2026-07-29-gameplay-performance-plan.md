# Gameplay Performance Plan — Single Player & Multiplayer

**Date:** 2026-07-29
**Original branch:** `codex/gameplay-performance-2026-07-29`
**Original base:** live `main` at `277c805`
**Salvage branch:** `codex/fix-room-transition-continuity-prod`, reconciled onto `main` at `0c24eaf`
**Scope:** The play-mode frame loop and its multiplayer presentation paths. Network wire formats, PartyKit server behavior, persistence, and overworld appearance are unchanged.

## 2026-07-31 salvage outcome

The dirty performance worktree was not transplanted wholesale. Its saved traces showed that it could run playable rooms, while the reproducible no-player failure also existed on clean current `main`: deep-link autoplay could enter Play before the exact selected-room snapshot was hydrated. The combined branch now requests a full refresh whenever Play has no exact current-room snapshot and retries if an in-flight chunk poll initially cancels that hydration request, with focused regression coverage.

Safe work retained:

- Comparable runtime tooling with idle, traversal, and continuous-keyboard room-transition scenarios.
- Presence payload deadline gating before allocation, using the existing wire cadence: 200 ms moving, 25 ms in PvP, and 5 seconds idle.
- Reused presence payload state, ghost prediction state, ghost label/style caches, and unchanged PvP-heart guards.
- Numeric grid redraw revisions, reusable special-tile environments, off-camera room-background update culling, and allocation-free comment badge iteration.

Deferred work:

- The grouped-physics migration. Cannon bullets spawned by the hazard controller are not registered with the new groups after legacy colliders are removed, and `dynamicActors` is never populated.
- The world display registry and persistent-lighting rewrite, which change ownership/camera filtering across most Phaser display objects without sufficient lifecycle coverage.
- The broader live-object index, chat/comment reconciliation, PvP rectangle, and heart-lifecycle rewrites until they have targeted gameplay or two-player tests.

Salvage verification:

- Three comparable 60-second 4×-CPU traces: 11.2, 9.8, and 8.9 ms update-work p95; median 9.8 ms versus the original 10.1 ms baseline. All had zero application errors.
- Continuous `ArrowRight` input crossed `0,0` to `1,0` with the player present and positive X velocity before and after the seam; update-work p95 was 10.0 ms at 4× CPU.
- Two real browser sessions remained mutually visible through 16 seconds idle, observed movement, and observed the peer move from room `0,0` to `1,0`.
- Object-heavy room `1,-1` passed at real speed with 7.9 ms update-work p95. Its 4× result remained an existing hotspot and was effectively unchanged versus clean `main` (41.3 vs 39.8 ms in one A/B run).
- Canvas and WebGL visual smokes were healthy with no browser errors.
- `npm run check` passed: 86 test files / 427 tests, lint, type checks, generated binding checks, and production build. The PartyKit identity-token probe also passed.

## Current-main reconciliation

The original audit was written in a stale dirty checkout. Current `main` already includes the first runtime-performance wave, so landed work is preserved rather than repeated.

| Area | Current-main status | Remaining work |
| --- | --- | --- |
| Profiler wrapper closures | Landed | Add snapshot attribution and active-PvP/ranked-trace guards |
| Live-object behavior registry | Partial | Complete behavior-owned dispatch |
| Static/updating partition and distance sleeping | Landed | Preserve while adding cached room/index ownership |
| Ladder index | Landed | Limit spatial searches to player-overlapping rooms and index crates/signs |
| Display layers | Partial | Replace the remaining ignore-list rebuild protocol with registration at creation |
| Chat/comment frame work | Partial | Existing 20Hz throttle still performs structural reconciliation |
| Lighting emitters | Open | Persist structure and mutate positions in place |
| Presence payload construction | Open | Gate construction before allocation |
| Collider consolidation | Open | Replace per-object registrations with category groups |
| Small frame allocations | Open | Special-tile copies, ghost targets, grid signatures, PvP rectangles, profiler reductions |

## Delivery sequence

1. Add `presence.snapshot` instrumentation and improve the repeatable mobile trace, then capture clean-main baselines.
2. Finish world/backdrop display ownership and remove `syncBackdropCameraIgnores`, object-list getters, and display-change callbacks.
3. Make lighting structure event-driven; add cached room/object indexes; remove small per-frame allocations; cull off-camera background animation.
4. Gate presence construction; split chat/comment structure from position work; guard ghost text/style writes; tighten PvP-only work.
5. Complete behavior-owned dispatch and introduce shared Arcade Physics category groups with spawn/despawn/sleep/wake membership.
6. Run focused unit tests, the full quality gate, gameplay browser smokes, mobile traces, and 48/150-peer presence probes.

## Acceptance gates

- `npm run check`
- `npm run smoke:partykit-identity`
- `npm run perf:runtime:mobile`
- `npm run stress:presence:48`
- `npm run stress:presence:150`
- Three-run median mobile frame-work p95 remains below 20ms and does not regress from baseline.
- WebGL and Canvas rendering show no missing or duplicated world/backdrop objects.
- Pickups, hazards, enemies, NPCs, crates, ladders, switches, doors, bounce pads, moving platforms, projectiles, ghosts, chat/comments, and PvP behavior remain intact.
- No merge, production deployment, or PartyKit deployment is part of this salvage review.

## Evidence

Baseline and final artifacts are written under `output/gameplay-performance-salvage/` and summarized in `progress.md`.

### Clean-main baseline

- Runtime: traversal 10.1 ms p95, idle 10.0 ms p95, traversal 12.1 ms p95; three-run median 10.1 ms. All three 60-second 4×-CPU runs reported zero application errors.
- GC: 391.684 ms, 427.909 ms, and 671.063 ms total traced GC duration, retained as the comparison baseline rather than an absolute pass/fail threshold.
- Presence: 48/48 peers connected with 2,928 messages; 150/150 peers connected with 22,650 messages.
- Node 20.19.4 quality baseline: lint, typecheck, generated binding checks, and production build pass. The aggregate `npm run check` reaches 75 passing test files / 386 tests, then four existing world-tile suites fail to start because current `main` imports `node:sqlite`, which is unavailable in Node 20.
