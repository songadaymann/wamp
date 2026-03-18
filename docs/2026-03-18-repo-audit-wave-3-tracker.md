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
- Wave 3: Broader refactor candidates
  - active
  - `src/scenes/OverworldPlayScene.ts`
  - `src/scenes/EditorScene.ts`
  - `src/styles/main.css`

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

## Decision Log

- 2026-03-18: Use a living tracker doc in `docs/` instead of extending `progress.md`.
- 2026-03-18: Prioritize Overworld decomposition before Editor and CSS.
- 2026-03-18: Preserve current behavior and public interfaces unless a blocking bug is found.
- 2026-03-18: Keep the scene-facing methods in place where that lowers risk, but move their logic into modules first.
- 2026-03-18: Split CSS by contiguous ownership slices to preserve exact cascade order before doing any selector cleanup.
- 2026-03-18: Keep Wave 0 strictly limited to symbols TypeScript proves unused under `--noUnusedLocals --noUnusedParameters`.
- 2026-03-18: Tackle Wave 1 as a docs-first drift pass, leaving generated API-contract completeness as separate follow-up work.

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

## Deferred Items

- If we ever want `public/openapi.json` to become a full public-route contract instead of an agent/builder contract, it still needs a broader route-coverage pass.
- Remaining naming/copy drift outside the updated docs stays in Wave 1.
- Wave 2 boundary cleanup remains pending in auth/client, worker routing, and client/store seams.
