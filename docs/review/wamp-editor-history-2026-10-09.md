# F165 editor history and preview performance review

Local candidate on F162 `f546b106` / draft #90. Primary and production are unchanged; review and release remain pending.

## Changes

- Room history retains the latest 150 committed edits. Undo/Redo transfers preserve order and new edits still clear Redo. Old entries are released in both editors.
- Plain manual tile strokes outside Smart-owned metadata allocate and retain no Smart history snapshots. Smart-affecting operations capture the before snapshot lazily and reuse it on commit. Unchanged Smart metadata is not retained. A structural comparison replaces full JSON serialization; Smart strokes still retain full before/after metadata, rather than per-key diffs.
- Manual locks, generated-output suppression, Smart erasure, semantic-only settings, no-op strokes and cancelled gestures preserve existing history behavior.
- Rain surfaces are exported once per document revision, rather than every frame. Static lighting emitters are not exported with lighting off. A monotonic revision covers runtime edits, Undo/Redo, loads and persistence-host Room settings/title edits, even when dirty timestamps coincide.

## Verification

Full quality check: 394 files / 3,125 tests, lint, types, bindings and build. DOM contract 992/242, Worker safety and diff checks pass. Eleven new tests cover cap/order/transfers, actual runtime boundaries, absent plain-tile snapshots, manual Smart restoration/cancellation, semantic-only history, no-op Redo preservation, revision changes and disabled/stable/invalidated preview caching.

Three completed native cases in `native-c/report.json` cover:

1. 170 desktop input strokes retain 150 history entries and no Smart snapshots. Exact Undo/Redo passes. The rain exporter runs once per committed stroke, zero times across stable frames, and static lighting exports remain zero while off. Native lighting/weather toggle invalidation and local save pass.
2. Native phone touch painting, exact Undo/Redo and local save under rain.
3. Expanded Room Smart painting, exact metadata Undo/Redo, neighboring cell preservation, local save and selected-cell publication. Read-only local D1 confirms cell 194/40 v2 and neighbor 195/40 v1.

Desktop, phone, Expanded and unchanged installed-client gameplay screenshots are inspected. Accepted cases have no page errors. Local construction-preview 404s are retained. The synthetic legacy-course fixture lacks an `expanded_rooms` row: its preferred expanded run-start request hits a foreign-key 500 before the existing legacy course fallback succeeds. This is documented, not treated as a clean area gameplay/server run-start verification. Initial native reports retain the Environment-tab selector diagnostic and the cache invalidation defect subsequently fixed. Initial test reports retain incorrect fixture GID and optional-type assertions subsequently corrected.

Evidence: `/tmp/wamp-editor-history-2026-10-09/`, including native preview export counts, accepted report, source fingerprints, local publication proof and primary preservation hashes. Official room 128/40 has a healthy play scene and no error artifact.

## Delivery

No new asset/catalog, migration, renderer, replay format or PartyKit change. This slice is frontend-only by itself. The inherited stack still requires coordinated API/Pages, migrations 0060–0062 and matching catalog/renderer delivery; its catalog mismatch release gate remains unresolved. Master checklist stays unticked until review/release.
