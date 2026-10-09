# Overnight release integration — October 9

Original request: "deploy all the other stuff you made last night as well" while preserving a partner's overlapping changes.

Release branch: `codex/release-overnight-stack-2026-10-09`, using the existing clean managed archive worktree. Start from freshly fetched production `39189b93`, preserve the ghost-archive acceptance bookkeeping, and merge the complete overnight stack through `997c5251`. Original preview and primary edits remain intact.

- [x] Inventory all 18 draft PRs #81–#98 and the morning boss-bar/guest-reminder fixes.
- [x] Review current partner changes (editor camera anchoring, layer visibility/markers, dock/navigation) and ghost-archive integration.
- [x] Reconcile seven conflict files explicitly, retaining both layer visibility and object movement, partner navigation and Templates, all new API routes and atomic ghost saving.
- [x] Pass combined quality, DOM, Worker safety and feature/editor regression checks.
- [ ] Verify actual hidden/background-tab audio behavior and native desktop/phone integration; inspect captures.
- [ ] Prepare compatible Lost Song map renderer/catalog and verify image readiness without bypassing release guards.
- [ ] Commit/push/review, pass exact source/main checks and merge the complete release.
- [ ] Apply migrations 0060–0062 before dependent API, deploy the coordinated renderer/API/Pages release, and verify actual custom-domain behavior, storage and map alerts.
- [ ] Record final release versions, checks and preservation. Superseded stacked drafts remain traceable to the integrated release.

The release includes optional hearts/healing, bug reports/private inbox, bosses, Lost Songs, manually configured weekly Room Rush, co-op plates, publish validation, starter templates, advisory Clear Check, object Move, bounded history/cache, standalone neighbor guides and the six music/audio improvements. Weekly Room Rush and Build Prompt stay unlaunched until a room/theme is chosen. Partial follow-up scopes listed in the overnight handoff are preserved.

Combined source verification: all 406 test files / 3,225 tests, lint, TypeScript, generated bindings, build, DOM contract and Worker safety probes pass. Native integration runs against an independent SQLite backup of the local fixture database, with a separate API/client and no remote fixture writes. Production `origin/main` remains `39189b93` at the reconciliation checkpoint.

Native integration passes ordinary and Expanded editor panel-center/cursor-zoom preservation, layer hiding/restoration and object Move/Undo/Redo, plus portrait touch Move. The combined toolbar reserves five tool slots before the partner's separator and fixes both history controls in the last column. The first merged grid squeezed Fill and Redo; inspected final captures and minimum button-width checks cover the correction. Other checks pass four health/restart/pit/guest cases (with a real 2,383-byte archived recording and cleared upload body), both guest/account co-op ranking guards, five private bug-report/replay/admin flows, four boss-bar browser cases and two quiet Guest clears flows. Initial harness selector/offscreen-target failures are retained in scratch evidence; corrected native checks use the visible dock controls and Fit.

Controlled visibility checks pass on desktop/phone with real Web Audio clock suspension and retained playback ownership, stopped effects and no unused Phaser context. Actual native switching remains pending: the Mac is locked, and browser automation focus emulation keeps document visibility visible. The user has been asked to unlock or explicitly defer that last manual check. Temporary local instrumentation is excluded from the release.

Immutable renderer preview: `https://e061f121.wampland.pages.dev`, catalog `authoring-catalog-v1:843f81f7cad2c688`. Strict browser leaf rendering includes the cassette with no asset/page errors. Renderer Worker `6b5fc87f-96bd-4248-a65f-e0c46722ef6a` is deployed; candidate `production-2026-10-09-overnight-843f81f7` is rebuilding while the existing active map remains available. Parent-wait observations clear as children complete; final readiness/parity gates remain mandatory.

Production migrations 0060–0062 applied successfully (8, 8 and 6 SQL commands). Existing 0063 and ghost data are preserved. No weekly event or Build Prompt was launched. PR #101 is the integration review; initial exact-source Quality and both Pages preview checks passed on `2808b5d9`.
