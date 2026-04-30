# 2026-03-18 Repo Audit Wave 3 Tracker

## Overview

This document is the living tracker for the March 18, 2026 repo audit follow-through and Wave 3 refactor work. The baseline audit findings were recorded against `origin/main` at `e5d913d`; implementation work now continues from the current repo tip while keeping `progress.md` as local history rather than the primary cleanup tracker.

## Wave Map

- Wave 0: Hygiene and obvious cruft
  - dead imports, dead locals, stale generated/ownership notes
  - completed 2026-03-18 as a compiler-proven unused-symbol sweep
- Wave 1: Local dedupe and naming drift
  - docs/API drift, repeated copy, duplicated guidance
- Wave 2: Module boundary cleanup
  - narrow interfaces, route/client dedupe, state boundary cleanup
  - April 11 continuation extracted auth runtime config, Worker run request parsing, and progression weighted-change metrics into focused modules
  - April 11 phase 2 moved run leaderboard SQL/ranking/response mapping into `src/cloudflare/worker/runs/leaderboards.ts`
- Wave 3: Broader refactor candidates
  - active
  - `src/scenes/OverworldPlayScene.ts`
  - `src/scenes/EditorScene.ts`
  - `src/styles/main.css`
  - April 11 continuation split the largest CSS section partials further and moved Editor music DOM rendering out of `EditorScene`

## Finding Ledger

| ID | Category | Severity | Evidence | Why it matters | Planned handling |
| --- | --- | --- | --- | --- | --- |
| `AUD-001` | `structure` | `high` | `src/scenes/OverworldPlayScene.ts` | Overworld browsing, course runs, HUD sync, camera behavior, and debug overlays are mixed into one scene file. | Wave 3A: extract helpers first, then controller seams, then clean state boundaries. |
| `AUD-002` | `structure` | `high` | `src/scenes/EditorScene.ts` | Editor room runtime, course marker editing, publish/test-play flow, and view-model assembly are interleaved. | Wave 3B: extract editor helpers, flow modules, then reduce scene responsibilities. |
| `AUD-009` | `structure` | `medium` | `src/styles/main.css` | App shell, auth, world, editor, chat, modals, and responsive overrides live in one stylesheet, making ownership and drift hard to see. | Wave 3C: split into ordered partials behind the existing `main.css` entrypoint. |

## Current Priorities

1. Overworld first
2. Editor second
3. CSS third

Defaults for this wave:

- behavior-preserving refactor, not feature work
- no intentional public API or persistence changes
- newly discovered Wave 0/1/2 issues go to `Deferred Items` unless they block the refactor

## Execution Plan

### Wave 3A: Overworld

1. Pure helper extraction
   - badge and label layout math
   - browse overlay transform math
   - course-run progress helpers
   - camera/zoom helper functions
2. Controller extraction
   - room/course badge layout and overlay sync
   - course run progression and completion/failure handling
   - camera/follow/inspect behavior and zoom helpers
3. State boundary cleanup
   - remove duplicated state across scene and helpers
   - keep one source of truth for browse overlays, course run state, and HUD-facing derived state
   - current pass:
     - extracted badge overlay math and transform sync into `src/scenes/overworld/badgeOverlays.ts`
     - extracted camera math helpers into `src/scenes/overworld/camera.ts`
     - extracted active course run state/progression helpers into `src/scenes/overworld/courseRuns.ts`

### Wave 3B: Editor

1. Pure/editor helper extraction
   - view-model assembly helpers
   - marker readiness and summary helpers
   - test-play payload building
2. Flow extraction
   - course marker editing state
   - save/publish/test-play flow helpers
   - scene handoff helpers
3. Scene responsibility reduction
   - keep Phaser lifecycle in scene
   - move orchestration detail into focused editor modules
   - current pass:
     - extracted course editor state and marker descriptor helpers into `src/scenes/editor/courseEditing.ts`
     - extracted play-mode handoff payload building into `src/scenes/editor/playMode.ts`
     - extracted editor UI view-model assembly into `src/scenes/editor/viewModel.ts`
     - April 11 follow-up extracted the Editor music DOM renderer into `src/scenes/editor/musicUi.ts`, keeping `EditorScene` as the state/action owner
     - April 11 phase 2 extracted Course Editor pressure-plate/container inspector state building into `src/scenes/courseEditor/inspectorUi.ts`
     - April 11 phase 4 moved the remaining Course Editor pressure-plate/container inspector focus, linking, container contents, and overlay rendering into `src/scenes/courseEditor/objectInspector.ts`

### Wave 3C: CSS

1. Keep `src/styles/main.css` as the root import path
2. Split stable sections into partials
   - base/app shell
   - auth/account
   - world/HUD/chat
   - editor
   - modals/leaderboards
   - responsive overrides
3. Preserve selector names and cascade order exactly
   - current pass:
     - `src/styles/main.css` now stays as the root entrypoint and imports ordered partials from `src/styles/sections/`
     - April 11 follow-up split `modals.css`, `editor.css`, and `world.css` into ordered ownership partials while preserving selectors and cascade order

## Decision Log

- 2026-03-18: Use a living tracker doc in `docs/` instead of extending `progress.md`.
- 2026-03-18: Prioritize Overworld decomposition before Editor and CSS.
- 2026-03-18: Preserve current behavior and public interfaces unless a blocking bug is found.
- 2026-03-18: Keep the scene-facing methods in place where that lowers risk, but move their logic into modules first.
- 2026-03-18: Split CSS by contiguous ownership slices to preserve exact cascade order before doing any selector cleanup.
- 2026-03-18: Keep Wave 0 strictly limited to symbols TypeScript proves unused under `--noUnusedLocals --noUnusedParameters`.
- 2026-03-18: Tackle Wave 1 as a docs-first drift pass, leaving generated API-contract completeness as separate follow-up work.
- 2026-04-11: Continue deeper cleanup from `refactor/deep-cleanup-waves-2026-04-11` with mechanical extractions first: no public API, schema, selector, persisted format, or gameplay behavior changes.
- 2026-04-11: Treat live-room edit smoke as data-dependent when the remote room belongs to another account; use the existing synthetic editor smoke hook for editor-renderer validation.
- 2026-04-30: Run the next cleanup line on isolated branch `refactor/cruft-alleviator-2026-04-30` from fresh `main`, preserving public routes, payloads, D1 schema, smoke/debug globals, and compatibility import barrels.

## Verification Log

- Baseline before Wave 3 edits:
  - `npm run build` passed
  - `npx tsc --noEmit` passed
- Wave 3 checkpoints:
  - tracker doc created at `docs/2026-03-18-repo-audit-wave-3-tracker.md`
  - `npm run build` passed after the Overworld, Editor, and CSS refactor pass
  - `npx tsc --noEmit` passed after the refactor pass
  - local Playwright smoke against `http://127.0.0.1:3001` wrote `output/web-game/state-0.json` and `output/web-game/shot-0.png`
  - `render_game_to_text` showed a clean overworld browse boot with auth/chat/device state intact
  - note: the headless screenshot came out black again, so the automated browser check validated boot/state safety rather than visual correctness
- Manual Wave 3 follow-up:
  - centered room/course badges in browse mode looked correct in-browser
  - editor publish/test-play flow looked correct after extraction
  - responsive chat/HUD/editor layout looked correct after the stylesheet split
- Wave 0 hygiene pass:
  - removed compiler-proven dead imports, dead helpers, and unused type aliases only
  - `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` passed
  - `npx tsc --noEmit` passed
  - `npm run build` passed
- Wave 1 docs drift pass:
  - updated the PRD current-state snapshot to reflect shipped courses, difficulty discovery, agent tokens, chat moderation, and the public API/frontend topology
  - corrected the frontend redeploy doc to use the `wampland` Pages project instead of the stale `wamp` reference
  - updated the in-product About modal copy so challenge/course messaging matches the shipped product
  - clarified that `docs/asset-intake-rules.md` is the detailed asset intake reference and the About modal is only the short public summary
  - clarified `public/openapi.json` as the agent/builder API contract instead of a full public-route mirror, and added the missing room discovery endpoint plus current leaderboard payload fields
- April 11 deep-cleanup continuation:
  - `npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` passed after the cleanup slices
  - `npm run typecheck` passed
  - `npm run build` passed with only the existing Rollup dependency annotation and large-chunk warnings
  - CSS split verification confirmed the new modal/editor/world partials concatenate back to the previous section contents in the same order
  - desktop synthetic editor/music Playwright probe passed with no console/page errors and wrote `output/web-game/deep-cleanup-synthetic-editor-music-probe/summary.json`
  - phone-landscape synthetic editor/music Playwright probe passed with no console/page errors and wrote `output/web-game/deep-cleanup-synthetic-editor-music-mobile-probe/summary.json`
  - `scripts/preview_smoke_readonly.mjs` reached overworld boot without console/page errors, but this run was blocked by the welcome modal on the first play click; live-room edit probing was also blocked by a correctly disabled Edit button on published room `0,0` for the guest session
- April 11 phase 2:
  - strict unused-symbol TypeScript passed after the Course Editor inspector extraction and after the leaderboard extraction
  - `npm run typecheck` passed
  - `npm run build` passed with only the existing Rollup dependency annotation and large-chunk warnings
  - local D1 migrations were applied for the cleanup worktree's local Worker stack
  - debug email sign-in UI flow passed on `http://127.0.0.1:3011/` with Worker API `http://127.0.0.1:8789/`
  - local global leaderboard API smoke returned a valid empty response from the extracted leaderboard module
  - frontend/API Playwright check passed with no console/page errors and wrote `output/web-game/deep-cleanup-phase-2-dev-check/summary.json`
- April 11 phase 4:
  - strict unused-symbol TypeScript passed after extracting `CourseEditorObjectInspectorController`
  - `npm run typecheck` passed
  - `npm run build` passed with only the existing Rollup dependency annotation and large-chunk warnings
  - required `develop-web-game` browser smoke wrote `output/web-game/deep-cleanup-phase-4-course-inspector/state-0.json`
  - targeted synthetic course-editor Playwright probe forced the inspector visible, called `startPlayMode()`, and confirmed the editor-to-overworld transition hid the inspector root and pressure panel with no console/page errors
- April 11 final readiness pass:
  - user confirmed local QA looked good
  - strict unused-symbol TypeScript, `npm run typecheck`, `npm run build`, and `git diff --check` passed
  - final `develop-web-game` smoke reached overworld browse mode and wrote `output/web-game/deep-cleanup-final-branch-check/state-0.json`
  - direct full-page Playwright screenshot rendered the overworld welcome modal with no page errors at `output/web-game/deep-cleanup-final-branch-check/full-page.png`
- April 30 cruft alleviator pass:
  - branch `refactor/cruft-alleviator-2026-04-30` was cut from clean, up-to-date `main`
  - compiler-proven unused code was removed, unused dev dependencies `@types/react` / `csstype` were removed, stale tracked preview HTML was deleted, and `noUnusedLocals` / `noUnusedParameters` were enabled
  - `src/config.ts` stayed as a compatibility barrel while config data moved into focused `src/config/*` modules; main bootstrap/debug/preview-smoke helpers moved into `src/main/*`
  - Worker progression storage, editor UI bridge, live-object helpers, large responsive/profile CSS partials, and shared frontend request/error handling were split into focused modules without D1 migrations or route/payload changes
  - low-risk perf reductions landed for presence publish/snapshot churn, mobile pressure full-room budget, pressure/link scans, live-object indexing, focused/deferred chunk preview texture builds, lower-detail preview zoom, and hot-path preview snapshot reuse
  - strict unused-symbol TypeScript, `npm run typecheck`, `npm run build`, and `git diff --check` passed
  - browser/smoke validation passed preview readonly smoke, mobile smoke, progression rating smoke, required `develop-web-game` client smoke, zoom perf probe at `output/overworld-zoom-perf/cruft-alleviator-final/result.json`, and a 48-peer live-presence stress probe at `output/perf-local-2026-04-30-presence-stress-final/summary.json`
  - local progression API smoke was blocked because no local Worker/D1 API was running on `127.0.0.1:8787`

## Deferred Items

- If we ever want `public/openapi.json` to become a full public-route contract instead of an agent/builder contract, it still needs a broader route-coverage pass.
- Remaining naming/copy drift outside the updated docs stays in Wave 1.
- Remaining Wave 2 boundary cleanup should continue in small backend/client slices, especially Worker rating/progression store decomposition with D1/Wrangler smoke coverage.
- Remaining scene cleanup should continue with `OverworldPlayScene` runtime/state extraction behind narrow host interfaces; any further `CourseEditorScene` pressure-plate/container work should be real-interaction polish rather than another structural split.
