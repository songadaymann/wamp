# WAMP checkup map recovery: F010 and F003

Jonathan authorized the next recommended pair and its production delivery. Base: `8a469416`, isolated in the existing managed worktree. Preserve the dirty primary checkout.

- [x] F010: replace history-wide request/retry scans with direct address lookups and limit availability refresh to relevant entries. Preserve timed LOD commits, retries, fallback, and context restoration.
- [x] Add regressions proving old manifest history does not increase frame candidate work and timed state transitions still complete.
- [x] F003: deploy the canonical renderer and backfill the current asset contract from an immutable Pages build.
- [ ] Verify renderer readiness, published-leaf/ancestor parity, object existence, and browser coverage before activation. Keep the strict contract gate and existing compact fallback.
- [x] Add production availability monitoring and asset-contract CI diagnostics to prevent a silent repeat.
- [ ] Complete repository checks, merge, deploy the frontend, activate compatible imagery, and verify the actual custom domain twice.
- [ ] Update the master checklist, progress and feature ledger only after delivery.

Initial live diagnosis: active imagery uses `authoring-catalog-v1:4b122cb7accc8026`; the application expects `authoring-catalog-v1:d9d6c8cf7dbb63c3`. Rebuild rather than weakening compatibility checks.

Implementation verification: 273 files / 2,014 tests pass; targeted tile/health checks pass 24 files / 140 tests, including timed LOD/fallback transitions. Lint, TypeScript, generated bindings and production build pass. DOM contract passes. An initial bindings check saw local `.dev.vars` secrets as type inputs; removing that test-only symlink restores the unchanged generated contract.

Delivery order: merge and publish the frontend with the guarded Pages-only command's explicit `--skip-smoke` option while the known incompatible map is still disabled; complete candidate verification, activate matching imagery, then run the strict production smoke. This temporary omission does not waive the final smoke gate.
