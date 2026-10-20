# F145: published-room compatibility and player geometry

Canonical branch: `codex/wamp-player-hitbox-audit-2026-10-19`, baseline main `adcd47f2` (F074 delivered in PR257). The ongoing objective remains Jonathan's full checklist. Master167/216; F145 stays open through this audit and any remaining collision/art work.

## Confirmed current source

`src/player/geometry.ts` defines base height14, standing26 and width10. Base14 also serves spawn headroom, so changing that shared constant would reach beyond airborne movement. `movementController.ts` retains crouch and grounded pushing profiles, forces standing height when the host requests it, uses base height while otherwise airborne, and grows a grounded body only when it already has standing height or the headroom check passes. The composition host currently forces full body in PvP. Preserve that distinction rather than treating all modes as legacy14.

The fit check samples terrain at the candidate head and checks solid runtime objects in the added headroom. Body resizing also maintains offsets and Arcade catch-up-step history. Presentation separately positions the sprite from the body's support edge plus a visual offset and applies feedback scaling; it handles gravity direction. The original review's sprite alpha measurements and line numbers need refreshing against current assets/owners.

The combat portion shipped in PR68 and is not the remaining implementation target. Keep that standing-profile forward reach and its local/remote/instance behavior intact.

## Required evidence and sequence

1. Identify the current public published inventory and full-snapshot readers for ordinary and Expanded rooms, plus any distinct world/mode geometry policy. Use read-only operations. Keep raw room records, snapshots and per-room diagnostic output in ignored output; public notes should report aggregate evidence without user records.
2. Measure current default-avatar alpha bounds across standing/jumping/crouching frames and identify its render scale/anchor owners. Audit spawn, pickup, hazard, PvP, pushing, gravity, ladder and replay callers of the shared dimensions before proposing a global change.
3. Scan published geometry for passages that depend on14px clearance, including elevated one-tile slots. Reuse actual terrain/one-way/runtime-object collision semantics. Record inventory coverage and missing/unsupported data; a conservative flagged-slot scan is not proof that every route is safe.
4. Build representative paired baseline/candidate cases from those findings: low ceilings, airborne slots, crouch tunnels, ledges, one-way platforms, gravity variants and solid objects. Confirm visual head position as well as passability, spawn/respawn, combat and replay compatibility.
5. Choose and implement the collision/art correction from the evidence, using existing narrow owners. If a necessary change blocks published routes or requires an unresolved product/art decision, prepare a concrete comparison and ask Jonathan while continuing independent work. Do not claim this scan alone completes F145, and do not ship a height/head-probe change before the required compatibility evidence.
6. Verify all affected flows and complete the authorized push/merge/guarded release workflow. Determine whether shared replay/server code requires API delivery; do not assume a frontend-only release. Preserve the selected animation, unrelated dirty checkouts, TAS lab, declined F061/F118 and remaining private/physical-device/product decisions. Complete F145 only after its remaining requirements are proven, then continue the full checklist.

## Published compatibility evidence

The October20 00:45UTC read-only inventory contains688 current published rooms,23 active native Expanded Rooms and23 migrated legacy courses. All published cells are in Prime; no separate numbered-world geometry was present in this inventory. The playable index contains563 standalone targets and23 Expanded targets. All125 Expanded cells were resolved through their public targets and loaded at their exact published room versions. Across current rooms and Expanded cells,739 distinct versions were required and all739 loaded successfully;51 are historical versions used by Expanded Rooms. There are no missing snapshots. These are point-in-time counts, not permanent production totals.

The scan uses the current gameplay terrain-profile functions, including encoded flips, custom solid tiles, Smart background surfaces and collision insets. One-way surfaces can support a floor but are not treated as a physical ceiling. It flags tile-column spans at least16px wide with14–25px clearance. Results:

| Scope | Exact snapshots | Snapshots with narrow slots | Narrow spans | With an open edge and air below the supporting platform |
| --- | ---: | ---: | ---: | ---: |
| Current published rooms | 688 | 217 | 1,129 | 93 |
| Expanded published cell versions | 125 | 32 | 112 | 17 |
| Distinct versions across both | 739 | 223 | 1,147 | 95 |

The scopes overlap; do not add their rows together. A separate adjacency scan covers599 horizontal/570 vertical neighboring pairs in the current overworld and74 horizontal/39 vertical pairs within23 Expanded targets. It flags202 current-world and22 Expanded vertical seam columns with narrow clearance. Horizontal boundary bands are already covered by the within-room scan. This is conservative static geometry evidence, **not a solvability or full-route proof**. Runtime objects, triggers, temporarily removed terrain, movement timing and side-gravity traversal still need representative runtime tests. Seventy-two distinct snapshots contain potentially dynamic solids;90 contain object IDs needing custom/other runtime definitions. They are recorded rather than silently treated as clear or solid.

Raw inventories, snapshots and per-room records remain in ignored `output/f145-hitbox-2026-10-19/`; no production records belong in public source. Accepted aggregates: `collection-proof.json`, `scan-proof.json` and `seam-proof.json`. Direct SELECT metadata reports zero rows written and no database change. The first Wrangler SQL-file invocation returned its import summary rather than SELECT records; that result is retained as a diagnostic and was not used as inventory evidence. The successful direct SELECT and public snapshot/target reads supply the counts above.

## Current avatar and caller audit

Fresh alpha measurements cover all default base/combat atlas frames and23 relevant base frames in each of28 locally shipped compatible packs. No measured pack is missing these frames. Default idle art is38–40px tall, rising jump art39px and falling jump art35px. With the current2px feet offset and scale1, the rising frame reaches38px above the body's support edge:24px above the airborne collision top and12px above the standing top. Crouch frames remain23–25px tall despite the14px crouch body. Across the28 packs, idle frame0 ranges40–51px and rising-frame head extent38–50px; a uniform scale would not normalize all avatars. Dynamically fetched remote packs were not measured.

The narrow owners requiring preservation are:

- `src/player/geometry.ts`: shared14px spawn/base,26px standing and10px width. The API's `runs/respawnVerification.ts` also imports base height when resolving a valid start; changing that constant would change server verification as well as local movement.
- `src/scenes/overworld/movementController.ts`: crouch14, push22, air14, standing26, fit checks, body/previous-frame offsets and runtime solids; ladder, butt-stomp, wall correction and four gravity directions also use these bodies. Crouch takes precedence over the PvP force-standing rule.
- `src/scenes/overworld/playerLifecycle.ts` and `playerPresentation.ts`: body anchor26, sprite bottom origin,2px visual offset, feedback scale, rotated-gravity placement and pickup sensor. Pickup height is the actual body height plus15px. Hazards register overlap against the player body; changing body height also changes damage/contact behavior, not only ceilings.
- `src/scenes/overworld/combatController.ts`: forward slash already uses the26px standing profile (PR68), which must not regress. Presence/PvP ghosts and the instance renderer have separate body and attack geometry; the presence ghost starts from base14 and receives its existing hit padding. PvP local movement already requests the full standing body.
- `src/scenes/overworld/ghostRace.ts`: race ghosts are presentation-only, with no Arcade body. Local, presence, race and multiplayer-instance sprite creation/rendering have distinct paths; a visual-size change must cover them consistently and preserve recorded positions and combat geometry.

The unchanged baseline's five focused terrain/movement/presentation/respawn suites pass99 tests. This verifies the owners used by this audit; it is not acceptance of an unimplemented collision change.

## Rejected prototype and decision boundary

An isolated Chromium comparison uses a16px passage from an exact published terrain snapshot. It holds the support edge at207px, starts atx96 and applies the same18 fixed physics steps moving right. Current14px air collision enters the passage and reachesx141. A browser-only prototype that grows to26 when the existing fit check passes stops atx107 against the upper wall; its height remains26. Both cases have ready collision infrastructure, the expected terrain, an unpaused scene, zero browser errors and zero fixture misses. Screenshots were inspected. Production data was not changed; goals/markers come from an isolated test fixture, and this is a terrain-entry comparison rather than a complete authored-route playthrough.

The prototype proves why the existing fit check alone cannot guarantee passability: the body can hit the upper wall before its position overlaps the gap enough for the check to shrink it. It is not a shippable implementation. Earlier preview-capture attempts are retained as diagnostics: an undismissed intro, an unloaded room and a preview collision-readiness timeout. None is counted as a passed comparison. Accepted proof is `published-runtime-proof.json` and `published-runtime/`; the actual runtime source files are unchanged.

Jonathan has been asked whether to preserve current physics and address the visual overlap first, or proceed with collision changes and recheck affected routes. **No answer has been assumed.** F145 remains unchecked at master167/216; this scan does not complete the remaining collision/art work. Dependent implementation/deployment awaits that direction. Independent source/coverage audits can continue, as can the broader checklist within its existing decision boundaries.

Status: inventory, static/seam scan, asset measurements, caller audit and paired rejection evidence complete. Remaining: select the collision/art direction, implement the full accepted remainder, verify representative low ceilings, air slots, crouch/push/ladder/gravity/runtime objects/spawn/combat/replay/PvP cases, then full quality and appropriate source/main/release proof. No F145 collision, avatar, API or production-data changes have been made. Evidence folder: ignored `output/f145-hitbox-2026-10-19/`.
