# F166 standalone neighbor edge guides review

First local slice on F165 `209e601a` / draft #91. Primary and production are unchanged. Master stays unticked; review/release and Expanded external-perimeter guides remain pending. Internal Expanded seams are untouched.

## Behavior

Standalone editing shows green chevrons for matching standing-player clearance, orange X marks for openings blocked on either side, and blue chevrons for openings into empty space. Geometry uses the shared gameplay standing body (10×26), actual terrain collision profiles, encoded flips, custom-tile collision, runtime one-way/Smart Background platform semantics and initial built-in solid-object footprints. Moving NPCs and custom sprite bodies are outside this static first slice. Hints describe geometry; they do not certify reachability through triggers, hazards or movement.

Published neighbor snapshots come from existing editor preview loads with no additional guide requests. Own geometry caches by monotonic document revision; neighbor geometry is weakly cached by snapshot identity/version/update time. Unchanged frames do not export or rebuild geometry. Missing published snapshots and load errors stay unknown. Reset/inactive/stale loads cannot install late snapshot ownership.

Markers and the pre-publish review show an optional connection count and legend. A sealed room can remain sealed and publish. Edge information never changes server validation, Clear Check eligibility, rewards or room data.

## Evidence

- Full quality check: 397 files / 3,143 tests; lint, types, bindings and build. DOM 992/242, Worker safety and diff checks pass.
- Eighteen new tests cover shared clearance rather than raw cell overlap, crouch-only gaps, vertical entry depth, one-way/projected platforms, custom tiles, static objects/layers, orthogonal published neighbors, version/reset/disabled caches, missing/error/stale loads, responsive drawing and advisory publication.
- Four completed native cases: desktop blocked-to-matched edits and exact Undo/Redo with actual local publication; phone touch blocked/matched hints and exact Undo/Redo; actual goal-free sealed-room publication; Expanded seam isolation. Only completed cases from diagnostic suites are counted in `accepted-report.json`.
- Desktop cache instrumentation records four exports for two edits and Undo/Redo, and zero additional exports across stable frames. Existing neighbor preview contains 197/42; no extra neighbor fetch is introduced.
- Read-only local D1 confirms rooms 196/42 and 198/42 at v2 and neighbor 197/42 exactly equal to its original v1 snapshot.
- Inspected desktop blocked/matched, phone blocked/matched, sealed publication, Expanded seam and unchanged installed-client gameplay screenshots. No page errors in accepted native cases. Local construction-preview 404s and the inherited synthetic legacy-course preferred expanded run-start FK/fallback limitation are retained.
- Initial native diagnostics retain a same-tool click cycling to Spray and an incorrect expectation that a sealed edge has no X even when the neighbor has an opening. Corrected native inputs/expectations pass; no complete pass is claimed for those diagnostic suites.

Evidence: `/tmp/wamp-neighbor-guides-2026-10-09/`, including source fingerprints, exact neighbor/publication proof and primary preservation hashes. Official room 128/40 has healthy gameplay and no error artifact.

## Delivery

No migration, saved/replay format, asset/catalog, renderer or PartyKit change. Gameplay body values remain numerically unchanged; shared constants avoid divergence in the guides. This slice is frontend-only by itself. The inherited stack still requires coordinated API/Pages, migrations 0060–0062 and a matching catalog/renderer; its existing catalog mismatch release gate remains unresolved.
