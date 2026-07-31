# Gameplay Performance Plan — Single Player & Multiplayer

**Date:** 2026-07-29
**Branch:** `codex/gameplay-performance-2026-07-29`
**Base:** live `main` at `277c805`
**Scope:** The play-mode frame loop and its multiplayer presentation paths. Network wire formats, PartyKit server behavior, persistence, and overworld appearance are unchanged.

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
- No push, PR, deployment, or PartyKit deployment is part of this branch task.

## Evidence

Baseline and final artifacts are written under `output/gameplay-performance-2026-07-29/` and summarized in `progress.md`.

### Clean-main baseline

- Runtime: traversal 10.1 ms p95, idle 10.0 ms p95, traversal 12.1 ms p95; three-run median 10.1 ms. All three 60-second 4×-CPU runs reported zero application errors.
- GC: 391.684 ms, 427.909 ms, and 671.063 ms total traced GC duration, retained as the comparison baseline rather than an absolute pass/fail threshold.
- Presence: 48/48 peers connected with 2,928 messages; 150/150 peers connected with 22,650 messages.
- Node 20.19.4 quality baseline: lint, typecheck, generated binding checks, and production build pass. The aggregate `npm run check` reaches 75 passing test files / 386 tests, then four existing world-tile suites fail to start because current `main` imports `node:sqlite`, which is unavailable in Node 20.
