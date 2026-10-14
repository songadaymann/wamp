# F008 — grouped obstacle collisions

Moving world actors use at most one static-obstacle and one dynamic-obstacle group collider. Phaser's existing spatial trees find nearby members; room reach, collision masks, self/duplicate-pair filters and the original switch/pushing callbacks remain in effect. Terrain and inset colliders keep their current reach behavior. The player interaction path is unchanged. Room-load rebuilds remain; their previous measured cost did not justify replacing them.

The groups index existing bodies without applying Phaser's new-body velocity/mass defaults or disabling bodies on removal. Body type selects the appropriate tree. Sleeping actors keep their links ready to wake. Rebuild and scene shutdown dispose the groups without destroying their sprites. Lightweight hosts without Arcade groups keep the individual-pair fallback.

## Validation plan and results

Jonathan authorized completing the unfinished candidate and shipping if validation passes on October 14, after the overnight work window had closed. This is separate from that completed overnight goal. Work stays in the attached checkout on `codex/wamp-category-colliders-2026-10-14`; the primary checkout is preserved.

- Focused group/coordinator unit tests pass (13 tests in three files); helper coverage includes existing velocity/mass/disabled state, membership, scene-shutdown disposal and listener removal. Other coordinator/reach tests are included in the full suite.
- Nine full-scene fixtures at seven render cadences pass all 63 comparisons: ordinary movement, ice, conveyor, water, wind, three rotated gravities and moving platforms. The player and NPC actually ride the platform; screenshots inspected. Three fixtures also pass 21 comparisons in a phone viewport. Zero page errors.
- Real Chrome/Metal Arcade-engine comparison exercises wall blocking, stacked crates, switch contact, pushing, sleep/wake, collision masks, obstacle destruction, reach growth and a collider rebuild. Grouped and fallback paths match all sampled body positions/velocities exactly for 120 steps per case and retain identical switch/pushing callback counts. Existing body state is preserved. The destruction check exposed that Phaser clears a group without invoking its remove callback; `contains()` now rejects disposed groups, and the unit double models that actual behavior. The final engine probe passes with zero page errors.
- Full quality gates pass: 484 test files / 3,577 tests, lint, TypeScript, DOM/bindings, production build, 642.0 KB startup brotli (670 KB gate), deferred-chunk boundaries and all asset checks. All 13 mobile CI scenarios pass with zero console/page errors and no missing API fixtures. Final busy-room timing, hosted CI and production delivery/proof are pending.

Proof directories: `/tmp/wamp-f008-final-2026-10-14/` for engine/cadence results and screenshots; `/tmp/wamp-f008-2026-10-14/` for the initial two-round busy-room comparison. Probes are retained in ignored `output/f008-colliders-2026-10-14/`. The initial mean collider count fell from 860.5 to 462; collision work from approximately 0.223 to 0.191 ms. Those timings are preliminary measurements rather than an overall FPS claim.

## Delivery

Pending. F008 remains partial and the master stays 139/215 until the final gates, merge, guarded Pages delivery and live checks succeed.
