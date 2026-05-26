# Expanded Rooms Impact Audit

Date: 2026-05-24
Worktree: `design/expanded-rooms`

## Summary

The first implementation slice proves the core visual/product direction:

- Published legacy courses can be displayed as contiguous Expanded Rooms on the overworld.
- Internal grid seams can be removed.
- Selecting any internal cell can surface one area-level identity in the HUD.
- Internal borders can be traversed in play when adjacent cells belong to the same Expanded Room.

The remaining risk is not the visual treatment. It is identity. A lot of the game still assumes that a playable thing is either:

- one `room_id` plus one `room_version`, or
- a separate `course_id` plus one `course_version`.

Expanded Rooms need to become the canonical playable identity everywhere player-facing content is selected, played, rated, shared, listed, or counted. Until that happens, the implementation is a compatibility shim over courses.

## Current State

Already implemented in this worktree:

- `migrations/0037_expanded_rooms.sql` creates `expanded_rooms`, `expanded_room_versions`, `expanded_room_cells`, `expanded_room_runs`, and `expanded_room_ratings`.
- Published courses are migrated into `expanded_rooms` using ids like `course:<legacyCourseId>`.
- Minted course cells are marked `protected_minted`.
- `src/expandedRooms/model.ts` has cell caps, footprint validation, and protected-cell removal validation.
- World APIs add `expandedRoom` membership metadata from published course membership when `EXPANDED_ROOMS_ENABLED` is on.
- Overworld rendering removes internal seams and shows one selected footprint boundary.
- HUD copy and some labels now say "Expanded Room".
- Builder capabilities include `expandedRoomCellLimit`.

Still compatibility-based:

- World membership currently comes from `loadPublishedCourseMembershipsInBounds` in `src/cloudflare/worker/world/routes.ts`, not from native expanded-room tables.
- Course APIs in `src/cloudflare/worker.ts` remain the active create/play/leaderboard/rating routes.
- The composer/editor scenes are still `CourseComposerScene` and `CourseEditorScene`.
- `MAX_COURSE_ROOMS` is still `4` in `src/courses/model.ts`.
- Area-level goals/runs/ratings exist in schema, but the main runtime still routes through room runs or course runs.

## Launch Blockers

### 1. Native Expanded Room Identity

Problem:

- `WorldRoomSummary.expandedRoom` is currently attached by translating course membership.
- Standalone rooms are not yet first-class 1-cell Expanded Rooms in backend API responses.
- Many systems still infer identity from `roomIdFromCoordinates(coordinates)`.

Required V1 decision:

- Every playable target resolves to an area identity:
  - 1-cell room: `expandedRoomId = room:<roomId>`
  - migrated course: `expandedRoomId = course:<legacyCourseId>` or a generated id with a legacy alias
  - new area: native expanded-room id

Implementation work:

- Add an expanded-room repository/resolver:
  - `resolveExpandedRoomAtCoordinate(x, y)`
  - `loadExpandedRoom(expandedRoomId)`
  - `loadExpandedRoomVersion(expandedRoomId, version)`
  - `loadExpandedRoomsInBounds(bounds)`
  - `loadStandaloneRoomAsExpandedRoom(roomId)` view-model helper
- Change world/chunk APIs to read `expanded_room_cells` for multi-cell areas.
- Keep old course membership as a migration alias only.

### 2. Area-Level Play, Goals, Runs, Ratings, and Leaderboards

Problem:

- Single-room play uses `room_runs`, room goals, and `contentType: 'room'`.
- Multi-cell play still uses course run state and course endpoints.
- `expanded_room_runs` and `expanded_room_ratings` are populated by migration, but not yet the primary write path.

Evidence:

- Room goal runs are started from the current `RoomSnapshot.goal` in `src/scenes/overworld/goalRuns.ts`.
- Course play posts to `/api/courses/:id/runs/start` and `/api/course-runs/:attemptId/finish` through `src/courses/courseRepository.ts`.
- Post-run rating types only allow `'room' | 'course'` in `src/progression/postRunRatingEvents.ts` and `src/progression/model.ts`.
- Trophy logic only accepts `'room' | 'course'` in `src/cloudflare/worker/progression/badgesTrophies.ts`.

Required V1 decision:

- The player-facing content type should be `expanded_room`.
- Legacy `course` can remain as an alias during transition.
- Cell-level room goals are ignored inside multi-cell Expanded Rooms.
- 1-cell Expanded Rooms keep current room goal behavior through the area abstraction.

Implementation work:

- Add expanded-room run endpoints:
  - `POST /api/expanded-rooms/:id/runs/start`
  - `POST /api/expanded-room-runs/:attemptId/finish`
  - `GET /api/leaderboards/expanded-rooms/:id`
  - `POST /api/expanded-rooms/:id/ratings`
- Add frontend `ExpandedRoomRepository`.
- Replace `activeCourseRun` with `activeExpandedRoomRun`.
- Add rating/progression/trophy support for `expanded_room`.
- Keep `/api/courses/*` and `/api/course-runs/*` as aliases to migrated expanded-room records until old links are safe to remove.

### 3. Editor Conversion

Problem:

- The course editor is a good base, but it still models a course assembled from existing published rooms.
- V1 creation is supposed to be "claim a room, then expand into adjacent frontier cells".
- The current course validation still allows only 2 to 4 cells for published expanded rooms.

Evidence:

- `src/cloudflare/worker/courses/store.ts` still rejects more than 4 cells and requires published rooms for all cells.
- `src/scenes/CourseComposerScene.ts` and `src/scenes/overworld/courseComposer.ts` still enforce `MAX_COURSE_ROOMS`.
- Existing routes in `src/cloudflare/worker.ts` expose `/api/courses` as the mutation surface.

Required V1 decision:

- The editor should create and mutate one expanded-room draft, not a course made of standalone room versions.
- Expansion claims adjacent frontier cells.
- Removing cells is allowed only for non-anchor, non-minted cells when the footprint stays connected.
- Publishing validates all cells atomically and consumes one publish allowance per area publish.

Implementation work:

- Rename or wrap course editor code as Expanded Room Composer/Editor.
- Replace `MAX_COURSE_ROOMS` with `builderCaps.expandedRoomCellLimit`.
- Add frontier expansion and claim consumption.
- Persist native expanded-room drafts and versions.
- Pin each cell's segment snapshot/version at publish time.
- Update marker placement and pressure-plate link inspection to target area versions.

### 4. Legacy Migration and Alias Layer

Problem:

- Migration `0037` creates expanded-room tables and copies published courses, runs, and ratings.
- Runtime still writes to course tables.
- Admin, suspicious-run, Play.fun cleanup, profile, and reporting code still query `course_runs`, `course_versions`, and `course_ratings`.

Required V1 decision:

- Production cutover should be dual-read/alias first, then primary expanded-room writes, then legacy cleanup.

Implementation work:

- Dry-run migration report:
  - published courses converted
  - draft-only courses archived
  - migrated runs
  - migrated ratings
  - minted protected cells
  - conflicting room membership
- Add id alias lookup:
  - legacy course id -> expanded room id
  - coordinate -> containing expanded room id
- Make old course endpoints return expanded-room-backed data.
- Add `expanded_room_runs` and `expanded_room_ratings` to admin invalidation, launch stats, maintenance counts, and leaderboard cleanup.

## Feature Impact Audit

### Room Rush

Current behavior:

- `OverworldRoomRushRunController` counts unique `room.id` values in `visitedRoomIds`.
- Route steps store `{ roomId, coordinates, uniqueVisitIndex }`.
- The backend recomputes score from route room ids in `src/cloudflare/worker/runs/roomRushLeaderboards.ts`.
- `room_rush_runs.unique_rooms` ranks the leaderboard.

Impact:

- A 4-cell Expanded Room would currently count as 4 rooms if the player crosses internal cells.
- The route map can still show cell-by-cell movement, but the score should count playable areas.
- Start and finish coordinates still matter for the route image, but the leaderboard needs area ids.

Recommended V1:

- Count each Expanded Room once in Room Rush.
- Store route steps with both cell and area identity:
  - `roomId`
  - `coordinates`
  - `expandedRoomId`
  - `expandedRoomVersion`
  - `uniqueAreaVisitIndex`
- Rename internal score fields toward `uniqueAreas` or keep API field `uniqueRooms` while changing the meaning to "unique playable rooms".
- Add server-side validation that recomputes expanded-room membership from coordinates, not from trusted client ids.
- In UI copy, keep "rooms" because the product term remains room, but make sure a multi-cell room scores once.

Priority: Blocker before public launch, because otherwise Room Rush scoring is inflated by the redesign.

### PVP

Current behavior:

- Arena Duel stores one `roomId` and `roomCoordinates`.
- The mode has `lockToStartRoom: true` and `camera: 'room_fit'`.
- Spawn resolution and camera lock are single-cell.
- Opponent lookup matches ghosts by current cell room id.

Impact:

- The new internal-border rule can accidentally make a 16-cell area traversable during PvP.
- A multi-cell arena is a different game mode, with different camera, spawn, syncing, fairness, and object-state expectations.

Recommended V1:

- Keep PvP explicitly cell-scoped.
- If a duel starts from inside an Expanded Room, the selected/focused cell is the arena.
- During `arena` mode, ignore Expanded Room internal border traversal and use the existing single-cell room walls.
- Store `expandedRoomId` as context only, not as the arena bounds.

Future option:

- Add a separate `area_arena` mode later with `camera: 'free_roam'`, area spawn rules, and multi-cell state sync.

Priority: Blocker before public launch if PvP is enabled with Expanded Rooms, because current internal traversal conflicts with `lockToStartRoom`.

### Music

Current behavior:

- Music is stored on `RoomSnapshot.music`.
- World playback follows the current cell's `currentRoom.music` in `OverworldPlayScene`.
- Music phrase batches are keyed by `room_id` and `room_version`.

Impact:

- Moving across cells inside one Expanded Room can switch or stop music by cell.
- The product expectation for an Expanded Room is one coherent soundtrack.
- The phrase library can still use cell provenance, but published area playback needs one area-level music source.

Recommended V1:

- Add area-level music to the expanded-room snapshot.
- During expanded-room play, play `expandedRoom.music`; ignore per-cell music.
- During migration, default area music from:
  1. legacy course-level music if added before migration,
  2. start/anchor cell music,
  3. first non-empty cell music,
  4. null.
- Keep music phrase library rows keyed to the source cell for V1, but add optional `source_type/source_id` later if area music authoring becomes phrase-library-native.

Priority: Should decide before native editor work, because editor save/publish shape changes.

### Comments

Current behavior:

- Comments are keyed by `room_id` and `room_version`.
- Comment pins store local x/y inside one room cell.
- Admin emails and public links point to `/r/:x/:y`.

Impact:

- Comments inside a multi-cell area would fragment by cell.
- Rate limits also apply per cell/version, which would let a user comment repeatedly across the same Expanded Room.

Recommended V1:

- Add expanded-room comments keyed by `expanded_room_id` and `expanded_room_version`.
- Store pin position as `{ roomId, coordinates, localX, localY }` so pins remain spatial.
- Resolve `/api/rooms/:roomId/comments` to the containing expanded room for migrated areas during transition.
- Admin review links should open `/r/:x/:y` with coordinate focus, while the review copy names the Expanded Room.

Priority: Should decide before launch, but can ship read-only legacy comments hidden or cell-scoped if comments are not central to the launch.

### Playlists and Room Sequences

Current behavior:

- `room_playlist_items` references `room_id` and `room_version`.
- Playlist entries jump to coordinates and call `playSelectedRoom`.
- Playlist item count is a room count.

Impact:

- If a playlist targets a cell inside a migrated Expanded Room, the player should get the whole Expanded Room, not one segment.
- Multiple cells from the same Expanded Room can currently appear as duplicate playlist items.

Recommended V1:

- Playlist items should target `expanded_room_id` and version.
- Existing playlist items that point inside a migrated area should alias to the area and de-dupe per playlist.
- Keep coordinate focus on the original added cell so creator intent is not lost.
- Update sequence/rating events to handle `contentType: 'expanded_room'`.

Priority: High, especially because playlist work is adjacent and likely touches discovery flows.

### Share Links and Deep Links

Current behavior:

- Canonical coordinate links are `/r/:x/:y`.
- Share metadata/image endpoints are `/api/share/rooms/:roomId`.
- Share preview renders one `RoomSnapshot`.
- Course share URLs mostly fall back to the current app URL.

Impact:

- A coordinate inside an Expanded Room should open the whole area while preserving focused cell.
- A share card for an Expanded Room should show the full footprint, not just one cell.

Recommended V1:

- Keep `/r/:x/:y` as a compatibility and focus URL.
- Add a canonical area URL later, such as `/room/:expandedRoomId`, only if needed for stable non-coordinate sharing.
- Share metadata for coordinates inside an Expanded Room should use area title, area goal, creator, and full-footprint preview.
- Old course links should redirect or hydrate the migrated Expanded Room.

Priority: High for external sharing and migration safety.

### Presence and Online Roster

Current behavior:

- Presence populations and editor counts are keyed by cell room id.
- Browse dots are sampled per visible cell.
- PVP invites use current selected cell.

Impact:

- A user inside one Expanded Room can appear as being in a different "room" if they are in another cell of the same area.
- Aggregated area population is more useful in the HUD.

Recommended V1:

- Keep network presence cell-scoped for movement accuracy.
- Add derived area aggregation for HUD and browse overlays:
  - population in this Expanded Room
  - editors in this Expanded Room
  - roster location label using area title plus optional coordinate focus
- Keep PVP invite coordinates cell-scoped.

Priority: Medium. Not a blocker if current cell-level presence remains functional, but area aggregation will make the new model feel coherent.

### Profiles, Discovery, Featured Content, and Global Stats

Current behavior:

- Profiles list published rooms from `rooms`.
- Profiles separately expose `publishedCourseCount`.
- Discovery/leaderboards still distinguish room and course tabs.
- Trophy and progression content types are `room` and `course`.

Impact:

- A migrated 4-cell course can appear as 4 published rooms plus 1 course unless de-duped.
- Creator stats can double count area work.
- Discovery needs to rank playable areas, not cell segments.

Recommended V1:

- Profile "Published Rooms" should list expanded-room entries.
- Include `cellCount` and preserve coordinate focus for thumbnails.
- Remove public `publishedCourseCount` once old course UI is retired.
- Discovery should return one result per playable area.
- Trophies should attach to expanded-room versions.

Priority: High for player-facing consistency.

### Minting and Version History

Current behavior:

- Minted metadata is stored on `rooms`.
- Mint permissions and history are cell-level.
- `0037` protects migrated cells whose source room has `minted_token_id`.

Impact:

- Expanded Rooms do not replace room tokens in this rollout.
- A minted cell can be part of an Expanded Room, but the token still represents that coordinate/cell metadata.
- Reverting or republishing a cell independently can diverge from a published area version.

Recommended V1:

- Keep tokens cell-level.
- Prevent removing minted protected cells from an Expanded Room.
- Area publish pins each cell segment version.
- Cell revert/publish does not mutate the live Expanded Room until the area is republished.
- Editor/history UI should clearly show when a cell is minted and protected inside an Expanded Room.

Priority: Blocker for migrated minted cells.

### Admin, Moderation, Suspicious Runs, and Maintenance

Current behavior:

- Admin cleanup and suspicious-run views query `room_runs` and `course_runs`.
- Maintenance counts include room/course runs but not expanded-room runs.
- Play.fun cleanup similarly handles room/course leaderboard rows.

Impact:

- Expanded-room runs can be missed by invalidation, reports, and cleanup.
- During dual-write or alias windows, counts can double if dashboards sum both legacy and expanded tables.

Recommended V1:

- Add expanded-room runs/ratings to admin tooling.
- Use `legacy_course_attempt_id` to avoid double counting migrated course runs.
- Update suspicious invalidation to delete or mark expanded-room run rows.
- Update launch stats and maintenance counts.

Priority: High before production migration.

### Guest Progress, Rewards, and Sharing

Current behavior:

- Guest run progress stores `contentType: 'room' | 'course'`.
- Potential PXP differs for room clears and course clears.
- Run share text says "room" or "course".

Impact:

- Expanded Rooms need one reward model.
- Migrated courses should not keep saying "course" after the redesign.

Recommended V1:

- Add `expanded_room` to guest progress and post-run rating events.
- Decide PXP baseline:
  - 1-cell Expanded Room: current room clear value.
  - multi-cell Expanded Room: either current course clear value or a formula capped by cell count.
- Copy should always say room or Expanded Room, never course.

Priority: Medium-high. It affects onboarding and post-run conversion.

## Recommended Implementation Order

1. Build the native expanded-room resolver/repository.
   - Read from `expanded_rooms` and `expanded_room_cells`.
   - Wrap standalone rooms as 1-cell areas.
   - Add coordinate -> area resolution.

2. Convert gameplay identity.
   - Add `activeExpandedRoomRun`.
   - Add expanded-room run start/finish/leaderboard/rating endpoints.
   - Add `expanded_room` progression/trophy/rating types.
   - Make old course run endpoints alias to expanded-room runs.

3. Convert world discovery and profile surfaces.
   - Native area membership in chunk APIs.
   - Discovery returns one playable area per result.
   - Profiles list area entries, not cell/course duplicates.

4. Convert editor.
   - Use existing course editor workspace.
   - Replace course refs with expanded-room cells.
   - Add frontier expansion, tier caps, claim consumption, protected-cell rules, and atomic area publish.

5. Handle cross-feature decisions before public QA.
   - Room Rush scoring by area.
   - PvP single-cell override.
   - Area-level music.
   - Area-level comments.
   - Playlist item migration.
   - Share/deep-link aliasing.

6. Run migration and cleanup.
   - Dry-run report.
   - Safety migration.
   - Safety QA on migrated examples.
   - Production migration report review.
   - Keep legacy aliases until links and Play.fun surfaces are confirmed.

## Concrete Test Additions

Required unit/model tests:

- coordinate resolves to containing Expanded Room
- standalone room resolves as a 1-cell Expanded Room
- migrated course id aliases to Expanded Room id
- footprint connected validation
- protected minted cell removal rejection
- area publish pins segment versions
- Room Rush unique score counts Expanded Room once
- PvP arena ignores expanded-room internal traversal

Required API tests:

- world/chunk APIs return native expanded-room membership
- expanded-room run start/finish/rating/leaderboard lifecycle
- old course run endpoint aliases to expanded-room run
- playlist item inside migrated area de-dupes to area target
- comments on any internal coordinate attach to area target
- share metadata for internal coordinate returns area metadata
- admin invalidation includes expanded-room run rows

Required browser scenarios:

- migrated 4-cell line, 2x2, tower, and zig-zag render without internal seams
- selecting any internal cell opens the same Expanded Room HUD
- direct `/r/:x/:y` inside an area focuses the area
- play crosses internal borders in normal expanded-room play
- PvP arena remains single-cell inside an Expanded Room
- Room Rush crossing cells inside one area does not increase score
- area-level music does not restart when crossing internal cells
- playlist item for a migrated area plays the whole area
- mobile browse/play/editor smoke for expanded footprints

## Immediate Next Step

The next engineering step should be the native expanded-room resolver/repository plus API aliases. That gives every other feature one answer to the key question: "what playable room does this coordinate belong to?"

Without that layer, every feature has to keep inventing its own course-vs-room compatibility logic.
