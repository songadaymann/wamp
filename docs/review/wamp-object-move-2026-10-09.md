# F162 object movement: first slice review

This local candidate stacks on F159 `156df31a` (draft #89). Production and the dirty primary checkout are unchanged. F162 stays unticked: marquee selection, cross-room clipboard and saved stamps remain separate slices.

## Behavior

Move (M) drags one object by whole tile offsets in either editor, including native phone touch. The preview moves its rendered sprite; only a valid release updates the document and records one Undo action. Existing identity, layer, contents, actor settings, dialogue and incoming/outgoing links remain attached. Objects cannot overwrite another object's same-layer anchor or transfer between room cells. Empty clicks do not paint.

Escape, tool changes, second touches, touch cancellation, release outside the canvas, window blur, document hiding, scene sleep/pause and resizing restore the original preview without changing history. Read-only rooms cannot start an edit. Undo/Redo uses the existing objects history and replay event; placement counters are unchanged.

## Evidence

- Full quality check: 392 files / 3,114 tests; lint, types, generated bindings and build pass. Final CSS build, DOM contract (992 IDs / 242 references), Worker safety and diff checks pass.
- Twenty meaningful new tests cover snapping, exact object document preservation, occupancy/layers, stale/no-op moves, runtime history, cancellation and lifecycle listener cleanup.
- Twelve completed native cases cover six configured desktop moves, exact fields/links, Undo/Redo, save/reload and actual publication; desktop cancellation and occupied/no-op drops; phone touch and cancellation; custom sprites; selected Expanded cell movement/publication with other cells and markers preserved; Clear Check invalidation/Undo recovery; actual browser focus loss; final desktop/phone layout and private read-only policy.
- Local D1 confirms room 184/40, 186/40 and 188/40 at v2, unchanged neighbor 189/40 at v1, and the separate two-cell area's v2 references and markers. All writes are local synthetic fixtures.
- Inspected desktop, phone, Expanded Room, read-only and unchanged installed-client gameplay screenshots. Official room 128/40 has a healthy play scene and no error artifact. Accepted native cases have no page errors. Existing construction-preview 404s and Chrome's warning for an explicitly cancelled non-cancelable touch event are retained in evidence.
- Primary HEAD, status, staged and unstaged diff hashes match the F159 preservation proof. Source fingerprints and read-only database proof are saved.

Evidence directory: `/tmp/wamp-object-move-2026-10-09/`. `accepted-report.json` counts only completed cases, including recovered desktop publication proof with canonical JSON equality. Partial diagnostic reports are retained: invalid synthetic actor modes, omitted undefined JSON properties, small-viewport editor reentry, Playwright focus emulation and a published collaborative-room permission fixture were corrected in the harness. No complete pass is claimed for those diagnostic suites.

## Delivery

This slice adds no asset/catalog, migration, renderer or PartyKit change. It is frontend-only by itself. The inherited draft stack still needs coordinated API/Pages delivery, migrations 0060–0062 and a matching renderer/catalog; the existing catalog mismatch release gate remains unresolved. Review and release are pending.
