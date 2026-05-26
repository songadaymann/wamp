# Expanded Rooms Fresh Context Handoff

Date: 2026-05-26
Worktree: `/Users/jonathanmann/SongADAO Dropbox/Jonathan Mann/projects/games/everybodys-platformer-worktrees/design/expanded-rooms`
Branch: `design/expanded-rooms`

## Latest Production Status

The stale "Current Slice In Progress" section below is from an earlier share-preview handoff. The branch advanced through safety QA, merged to `main`, and is now deployed to production.

Production targets:

- App: `https://wamp.land`
- API: `https://api.wamp.land`
- Merge commit: `ac0b90f`
- Production Worker version: `2c31b8c0-a04b-4b2d-be5c-3bf1caaea875`
- Production Pages deploy: `https://86aec669.wampland.pages.dev`
- Production D1 migration: `0037_expanded_rooms.sql` applied on 2026-05-26

Current safety targets:

- Pages alias: `https://safety-design-expanded-rooms.wampland.pages.dev`
- Latest immutable Pages deploy: `https://fd871b28.wampland.pages.dev`
- Safety Worker/API: `https://everybodys-platformer-safety.novox-robot.workers.dev`
- Latest safety Worker version: `f28c34d3-ab50-4fb7-9fcf-e86e0f0ce39d`
- Safety PartyKit: `everybodys-platformer-presence-safety.songadaymann.partykit.dev`

Latest fix:

- Fixed the overworld HUD actions for selected Expanded Rooms.
- When the selected playable area is already an Expanded Room, `Edit Room` now reads `Edit Expanded Room` and opens `CourseEditorScene` directly for the expanded-room record.
- When the selected playable area is a normal single-cell room, the setup action now reads `Expand Room`.
- Existing Expanded Rooms now show the expected two choices: `Edit Expanded Room` and `Expanded Room Setup`.

Verification for the latest deploy:

- Safety deploy build/typecheck via `npm run deploy:safety:branch -- --skip-migrations`
- Required local web-game client smoke against safety-backed local frontend
- Focused local Playwright HUD probe confirming selected expanded-room labels at `7,2` and single-room labels on a standalone room
- Safety deploy: Worker, PartyKit, and Pages alias completed
- Safety Worker `/api/health` returned healthy D1/auth status
- `PREVIEW_SMOKE_URL='https://safety-design-expanded-rooms.wampland.pages.dev/?renderer=canvas&previewSmoke=1' npm run smoke:preview:readonly`
- Focused deployed Playwright HUD/edit probe confirmed `Edit Expanded Room` / `Expanded Room Setup` for `Metroidvania Maddness` at `7,2` and confirmed clicking edit switches to `course-editor`; the anonymous probe then hit the expected signed-in-only `401` on `/api/expanded-rooms/:id/editor-record`

Next practical step:

- Live QA on production: create/edit/publish multi-cell Expanded Rooms, play/rate/clear them, test playlists/profiles/explore/share/admin views, and watch migration-report/admin surfaces for parity issues.

## Important Warning

The current Codex context started showing `{"detail":"Bad Request"}` in the UI while I was testing the share image endpoint. The app endpoint itself returned HTTP 200, but I accidentally printed PNG bytes from `curl` into command output while checking `/api/share/rooms/:roomId/image.png`. After that, even saved-file image checks appeared to keep tripping the Codex UI.

For a fresh context:

- Do not print binary output.
- Do not pipe PNG response bodies to stdout.
- Prefer JSON-only checks first.
- If image verification is needed, use a fresh context and save the image silently, then inspect through a safe image viewer only if the environment handles it.
- Avoid `head`, `cat`, or direct terminal output on PNG files.

## Overall Project Goal

We are converting player-facing "courses" into "Expanded Rooms":

- Every playable thing is a room.
- A room may occupy one cell or multiple connected overworld cells.
- Existing single-cell rooms remain valid.
- Existing published courses become multi-cell Expanded Rooms.
- Internal cell boundaries are hidden visually and traversable in normal play.
- Course-specific player-facing identity is being retired behind compatibility aliases.

## Already Implemented Before This Handoff

The worktree already contains a large Expanded Rooms implementation. Key completed slices:

- Added `migrations/0037_expanded_rooms.sql` for expanded room, version, cell, run, rating, migration-copy, minted-cell protection, and builder cap override schema.
- Added native Expanded Room resolver/store under `src/cloudflare/worker/expandedRooms/`.
- World/chunk APIs return `expandedRoom` metadata behind `EXPANDED_ROOMS_ENABLED`.
- Overworld renders connected multi-cell areas as one footprint with no internal seams.
- Selecting any internal cell resolves to the same Expanded Room.
- Added Expanded Room run/leaderboard/rating endpoints and frontend playback bridge.
- Native editor endpoints exist under `/api/expanded-rooms`.
- Course composer/editor write paths have been moved toward native Expanded Room draft/save/publish/cell mutation APIs while retaining course-compatible editor records.
- Builder-tier cell caps are enforced and surfaced in editor UI.
- Room Rush counts a multi-cell Expanded Room once.
- PvP Arena remains focused-cell scoped and blocks internal Expanded Room traversal in arena mode.
- Music playback is area-level for Expanded Room play.
- Comments resolve to the area and preserve per-cell pin coordinates.
- Playlists de-dupe cells from the same Expanded Room and carry `expandedRoom` metadata.
- Playlist summary counts in profiles and `/api/playlists/me` use playable-area counts.
- Profile published room lists de-dupe cells from the same Expanded Room and show area metadata.

Local fixture commonly used:

- Expanded Room id: `course:expanded-room-fixture-course`
- Legacy course id: `expanded-room-fixture-course`
- Cells: `20,20` and `21,20`
- Area title: `Expanded Room Fixture`
- Area version: `5`
- Goal: `survival`

Typical local URLs:

- App: `http://127.0.0.1:3007`
- Worker/API: `http://127.0.0.1:8787`

## Current Slice In Progress

Current slice: share/deep-link metadata and preview compatibility.

Goal:

- Coordinate share links inside an Expanded Room should use the whole area identity.
- `/api/share/rooms/:roomId/meta` should return area title, area goal description, focused coordinate, and `expandedRoom` metadata.
- `/api/share/rooms/:roomId/image.png` should render a full-footprint area preview for multi-cell rooms.
- `/r/:x/:y` remains the public/canonical focus URL for now.

## Files Changed In Current Share Slice

### `src/cloudflare/worker/share/routes.ts`

Changes made:

- Imports `ResolvedExpandedRoomTarget`.
- Imports `resolveExpandedRoomAtCoordinates`.
- Imports `parseStoredSnapshot` so the share path can load pinned room version snapshots.
- Share metadata now includes:
  - `expandedRoom: null | { expandedRoomId, expandedRoomVersion, title, source, legacyCourseId, cellCount, anchorCoordinates, focusedCoordinates }`
- Added `RoomShareTarget` shape:
  - `focusSnapshot`
  - `expandedRoom`
  - `previewCells`
- `handleRoomShareRequest` now loads a `RoomShareTarget` instead of just a single published room snapshot.
- `loadRoomShareTarget`:
  - Resolves the containing Expanded Room for the coordinate when `EXPANDED_ROOMS_ENABLED` is on.
  - Uses the target's pinned cell version snapshots where available.
  - Falls back to standalone `loadPublishedRoom` behavior when no multi-cell Expanded Room applies.
- Metadata now uses the area title for multi-cell Expanded Rooms.
- Description now says e.g. `Expanded Room Fixture is a 2-cell WAMP room focused at 20,20. Beat the survival challenge.`
- `imageUrl` adds `area` and `av` query params when an Expanded Room is present.
- The image response uses `renderExpandedRoomSharePreviewPng` for multi-cell targets and `renderRoomSharePreviewPng` for standalone rooms.

JSON-only smoke that passed:

```bash
curl -sS 'http://127.0.0.1:8787/api/share/rooms/20%2C20/meta' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); console.log(JSON.stringify({title:j.title, description:j.description, roomId:j.roomId, roomVersion:j.roomVersion, expandedRoomId:j.expandedRoom?.expandedRoomId ?? null, expandedRoomVersion:j.expandedRoom?.expandedRoomVersion ?? null, cellCount:j.expandedRoom?.cellCount ?? null, focused:j.expandedRoom?.focusedCoordinates ?? null}, null, 2));})"
```

Expected output:

```json
{
  "title": "Expanded Room Fixture on WAMP",
  "description": "Expanded Room Fixture is a 2-cell WAMP room focused at 20,20. Beat the survival challenge.",
  "roomId": "20,20",
  "roomVersion": 1,
  "expandedRoomId": "course:expanded-room-fixture-course",
  "expandedRoomVersion": 5,
  "cellCount": 2,
  "focused": {
    "x": 20,
    "y": 20
  }
}
```

Also passed for internal second cell:

```bash
curl -sS 'http://127.0.0.1:8787/api/share/rooms/21%2C20/meta' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); console.log(JSON.stringify({title:j.title, description:j.description, focused:j.expandedRoom?.focusedCoordinates ?? null, cellCount:j.expandedRoom?.cellCount ?? null}, null, 2));})"
```

Expected key result:

```json
{
  "focused": {
    "x": 21,
    "y": 20
  },
  "cellCount": 2
}
```

### `src/cloudflare/worker/share/roomPreviewImage.ts`

Changes made:

- Added `ExpandedRoomSharePreviewCell`.
- Added `renderExpandedRoomSharePreviewPng(cells)`.
- Refactored internal room drawing to accept a `RoomPreviewLayout`:
  - `drawRoomFrame(canvas, layout)`
  - `drawTiles(canvas, snapshot, layout)`
  - `drawObjects(canvas, snapshot, layout)`
- Single-cell renderer still uses the old layout and behavior.
- Multi-cell renderer:
  - Sorts cells by y/x.
  - Computes footprint bounds.
  - Scales the footprint to fit the 1200x630 share image.
  - Draws all cell snapshots in one shared frame.
  - Draws only an outer footprint border, not internal cell borders.

Potential issue:

- The local fixture cells are visually sparse/empty in the generated PNG. The rendered full-footprint preview looked like a wide dark area with an outer white border. That may be correct for the fixture, but should be tested against a richer migrated room/course later.

## Verification Already Completed In Current Share Slice

Completed successfully:

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- JSON metadata smoke for `20,20`
- JSON metadata smoke for `21,20`

Build output had only the usual Rollup pure-comment warnings and chunk-size warnings.

Do not repeat the PNG binary checks in the current broken context. If a fresh context needs image verification, use safe commands that never print response body bytes.

## Commands To Avoid

Do not run commands like this:

```bash
curl .../image.png
curl .../image.png | head
head output/file.png
cat output/file.png
```

These can dump binary to the tool output and appear to cause the Codex UI/API `Bad Request`.

## Suggested Safe Next Steps

1. In a fresh context, inspect the current diff:

```bash
git diff -- src/cloudflare/worker/share/routes.ts src/cloudflare/worker/share/roomPreviewImage.ts
```

2. Re-run safe checks:

```bash
npm run typecheck
npm run build
git diff --check
```

3. Re-run JSON-only share metadata checks for:

```bash
curl -sS 'http://127.0.0.1:8787/api/share/rooms/20%2C20/meta'
curl -sS 'http://127.0.0.1:8787/api/share/rooms/21%2C20/meta'
```

4. If image verification is needed, save silently and do not print the file:

```bash
curl -sS -o output/share-preview.png 'http://127.0.0.1:8787/api/share/rooms/20%2C20/image.png'
```

Then inspect with an image-safe tool only if the environment supports it.

5. Run the required web-game smoke after finalizing:

```bash
node /Users/jonathanmann/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js \
  --url 'http://127.0.0.1:3007/?x=20&y=20&renderer=canvas&previewSmoke=1' \
  --actions-json '{"steps":[{"buttons":[],"frames":20}]}' \
  --iterations 1 \
  --pause-ms 300 \
  --screenshot-dir output/expanded-room-share-final-smoke
```

6. Update `progress.md` after final verification with a note like:

```text
- Added the share/deep-link metadata compatibility slice. Coordinate share routes now resolve containing Expanded Rooms, expose area metadata in `/api/share/rooms/:roomId/meta`, keep `/r/:x,:y` coordinate focus URLs, and render multi-cell share previews through a full-footprint renderer with only an outer boundary. Verification passed ...
```

## Remaining Backlog After Share Slice

Likely next slices after share/deep-link work:

1. Explore/discovery de-duping and ranking by playable area.
2. Progression/rewards/trophies: move more copy/types toward `expanded_room`.
3. Admin/moderation/maintenance: include expanded-room runs/ratings and avoid legacy double counts.
4. Presence aggregation: cell-scoped network presence, area-scoped HUD counts.
5. Migration dry-run report and safety/prod migration validation.
6. Legacy course cleanup and route/UI alias removal after QA.
