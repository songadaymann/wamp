# Refactor Health Check - 2026-06-03

Worktree: `everybodys-platformer-worktrees/refactor`  
Branch: `refactor/consolidation-health-check-2026-06-03`  
Base: `origin/main` at `f5827d8`

## Verification Baseline

- `npm ci` failed on `sharp` native install scripts; `npm ci --ignore-scripts` succeeded.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm audit` reported 21 advisories: 15 moderate, 6 high.
- Production build warned about large chunks, including a 3.1 MB main bundle.
- Initial `knip` reported 4 unused-file candidates and 379 unused-export candidates; after this slice the unused-file section is gone, but 379 unused-export candidates remain.
- Current Workers types were fetched as `@cloudflare/workers-types@4.20260603.1`.

## Final Verification In This Pass

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run smoke:worker-safety` passed.
- `npm run smoke:dom-contract` passed.
- `PREVIEW_SMOKE_URL=http://127.0.0.1:3000 npm run smoke:preview:readonly` passed against local Vite + Wrangler after seeding one local published smoke room.
- `npm run smoke:mobile` passed against local Vite + Wrangler after the same local smoke seed.
- `npx wrangler deploy --dry-run --env="" --outdir /tmp/everybodys-platformer-refactor-worker-dry-run` passed.
- `git diff --check` passed.
- `npx knip --no-progress` still reports 378 unused exports and 1 duplicate export; unused-file findings remain gone.
- `npm audit` still reports 21 advisories: 15 moderate, 6 high. `npm audit --omit=dev` reports 14 advisories: 11 moderate, 3 high.

## Applied In This Pass

- Tightened Worker CORS in `src/cloudflare/worker/core/http.ts` so credentialed CORS is only emitted for trusted app, preview, same-origin, and dev origins. Unknown origins now get wildcard CORS without credentials.
- Tightened magic-link redirect fallback in `src/cloudflare/worker/auth/store.ts` so untrusted `Origin` no longer becomes the auth return base when `APP_BASE_URL` is unset.
- Added mutating cookie-auth origin/CSRF hardening in `src/cloudflare/worker/auth/request.ts`, with explicit guards for logout, chat moderation, and admin restore routes. Header auth remains first priority for untrusted mutating requests.
- Added strict room snapshot parsing with a 2 MiB cap, exact tile layer shape checks, finite integer tile validation, known object/custom-sprite ID validation, and bounded object positions.
- Replaced client-authoritative Room Rush leaderboard finalization with server-issued run starts in `migrations/0039_room_rush_run_starts.sql`, `src/cloudflare/worker/runs/roomRushLeaderboards.ts`, and the client run repository/scene flow. Finalize now checks the server start, route adjacency, published-room membership, timing sanity, and duplicate finalize behavior.
- Added `scripts/worker_safety_probes.ts` and `npm run smoke:worker-safety` covering trusted/hostile CORS, invalid snapshots, oversized snapshots, invalid Room Rush spoof routes, and valid Room Rush start/finalize.
- Added `scripts/smoke_dom_contract.mjs` and `npm run smoke:dom-contract` for required DOM IDs and stale leaderboard discover IDs.
- Removed stale leaderboard discover logic from `LeaderboardModalController`; discovery remains owned by `ExploreModal`.
- Moved editor-only button ownership out of `sceneCommands` by leaving editor controls to `EditorUiBridge` and keeping `sceneCommands` focused on world/global commands.
- Added missing live DOM anchors for the palette preview, course workbench, creator progress bars, and world zoom label.
- Consolidated basic modal lifecycle behavior into `src/ui/setup/modalLifecycle.ts` and migrated About, Controls, and Playlist Intro modals.
- Removed confirmed orphan wrapper modules:
  - `src/courses/pressurePlateLinks.ts`
  - `src/pvp/matchClient.ts`
  - `src/scenes/overworld/pvpInstanceRenderer.ts`
- Removed the direct root dependency on `@ethersproject/sha2`; it remains only as a transitive dependency of `@reown/appkit-adapter-ethers`.
- Added school pages and entrypoints to `knip.json` to avoid false unused-file reports.
- Consolidated duplicated world chunk-bound helpers into `src/persistence/worldModel.ts`.

## Highest Priority Findings

1. **Credentialed CORS was too broad.**  
   `corsHeaders()` reflected any request `Origin` and set `Access-Control-Allow-Credentials: true`. This branch now restricts credentialed CORS and adds mutating cookie-auth origin checks.

2. **Magic-link fallback trusted untrusted request origins.**  
   This branch changes magic-link fallback to configured `APP_BASE_URL` or Worker origin instead of raw untrusted `Origin`.

3. **Room snapshot validation is shallow.**  
   Fixed in this pass with size-limited parsing and strict snapshot validation before clone/storage.

4. **Room Rush leaderboard is client-authoritative.**  
   Fixed in this pass with server run starts, finalize validation, published-room route scoring, and smoke probes.

5. **PartyKit identity is query-param based and outside normal typecheck.**  
   Still open. Add short-lived Worker-issued signed tokens for presence/PVP/chat, and add PartyKit/scripts to CI typechecking.

6. **Editor controls may double-fire.**  
   Fixed in this pass by narrowing `sceneCommands` to world/global commands and leaving editor controls with `EditorUiBridge`.

7. **DOM contract drift exists.**  
   Fixed in this pass with a static DOM-contract smoke test and matching HTML/style cleanup.

## Main Refactor Pressure

- `src/scenes/OverworldPlayScene.ts`: still a god object at 6k+ lines with controller construction, PVP runtime, camera, room rush, music, and state orchestration.
- `src/scenes/overworld/liveObjects.ts` and `liveObjects/swordsmanController.ts`: object runtime, switches, hazards, moving platforms, pickups, multiplayer events, and swordsman AI need narrower behavior modules.
- `src/scenes/EditorScene.ts` and `src/scenes/CourseEditorScene.ts`: large duplicated music workflow and editor interaction flow.
- `src/ui/setup/profileModal.ts`, `leaderboardModal.ts`, and related modal controllers: large controllers mix data loading, DOM rendering, feature state, sharing, tabs, and subfeature workflows.
- `src/cloudflare/worker/*`: several route/store modules mix routing, policy, validation, storage, serialization, and third-party service calls.

## Recommended Next Order

1. Add PartyKit signed identity tokens and include `partykit/presenceServer.ts`, scripts, and tool config in broader typechecking.
2. Extract shared editor music workflow behind a host adapter for single-room and course editors.
3. Introduce `LiveObjectBehavior` registry and peel off moving platforms, pushables, switches, and swordsman subcontrollers.
4. Split profile/leaderboard modal controllers into data, renderer, and feature subcontrollers.
5. Continue `knip` export-surface triage one subsystem at a time; do not bulk-delete public model/route surfaces.
6. Add Vite chunking/dynamic import work for wallet/auth/admin surfaces after behavior tests exist.

## Deferred Cleanup

- Public asset deletion was deferred. Several assets look orphaned, but they may still be useful as source/reference assets outside runtime imports.
- `pressurePlateLinks` schema fields were not removed. They still serve legacy compatibility and should stay until persisted payloads and API consumers are migrated.
- The 378 unused-export signals from `knip` should be handled as an export-surface sweep, not as bulk deletion.
- The large Wave 4 scene/runtime splits were deferred from this patch to avoid mixing high-risk behavior refactors into the same branch as backend security remediation and UI contract fixes.

## References

- Cloudflare Workers best-practices documentation: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
