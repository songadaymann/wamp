# Overnight release integration — October 9

Original request: "deploy all the other stuff you made last night as well" while preserving a partner's overlapping changes.

Release branch: `codex/release-overnight-stack-2026-10-09`, using the existing clean managed archive worktree. Start from freshly fetched production `39189b93`, preserve the ghost-archive acceptance bookkeeping, and merge the complete overnight stack through `997c5251`. Original preview and primary edits remain intact.

- [x] Inventory all 18 draft PRs #81–#98 and the morning boss-bar/guest-reminder fixes.
- [x] Review current partner changes (editor camera anchoring, layer visibility/markers, dock/navigation) and ghost-archive integration.
- [x] Reconcile seven conflict files explicitly, retaining both layer visibility and object movement, partner navigation and Templates, all new API routes and atomic ghost saving.
- [ ] Pass combined quality, DOM, Worker safety and feature/editor regression checks.
- [ ] Verify actual hidden/background-tab audio behavior and native desktop/phone integration; inspect captures.
- [ ] Prepare compatible Lost Song map renderer/catalog and verify image readiness without bypassing release guards.
- [ ] Commit/push/review, pass exact source/main checks and merge the complete release.
- [ ] Apply migrations 0060–0062 before dependent API, deploy the coordinated renderer/API/Pages release, and verify actual custom-domain behavior, storage and map alerts.
- [ ] Record final release versions, checks and preservation. Superseded stacked drafts remain traceable to the integrated release.

The release includes optional hearts/healing, bug reports/private inbox, bosses, Lost Songs, manually configured weekly Room Rush, co-op plates, publish validation, starter templates, advisory Clear Check, object Move, bounded history/cache, standalone neighbor guides and the six music/audio improvements. Weekly Room Rush and Build Prompt stay unlaunched until a room/theme is chosen. Partial follow-up scopes listed in the overnight handoff are preserved.

Combined source verification: all 406 test files / 3,225 tests, lint, TypeScript, generated bindings, build, DOM contract and Worker safety probes pass. Native integration runs against an independent SQLite backup of the local fixture database, with a separate API/client and no remote fixture writes. Production `origin/main` remains `39189b93` at the reconciliation checkpoint.
