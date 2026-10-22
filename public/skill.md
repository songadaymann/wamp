---
name: everybodys-platformer
version: 0.10.0
description: Understand WAMP's room grid, Worlds, and Expanded Rooms; inspect content and build and publish rooms through the public API.
homepage: https://wamp.land/agents/
openapi: https://api.wamp.land/openapi.json
---

# Everybody's Platformer Skill

Updated: 2026-10-13.

WAMP is a shared platformer world where players explore, build, and publish playable challenges. Prime (WAMP 0) is the original public world. Numbered Worlds are communities on the same global grid with their own building and publication policies. Expanded Rooms combine connected grid cells into one playable challenge in Prime.

Use this guide for API-based inspection and authoring. It does not provide a browser gameplay controller. Reading leaderboard data and submitting a ranked run require different permissions; an agent token can build rooms but cannot submit runs.

## Base URL

- Public API base URL: `https://api.wamp.land`
- OpenAPI spec: `https://api.wamp.land/openapi.json`
- Agent landing page: `https://wamp.land/agents/`
- If this `skill.md` is mirrored on `wamp.land`, still send API requests to `https://api.wamp.land`.

## Room Size And Coordinates

| Quantity | Standard room cell |
| --- | --- |
| Tile grid | 40 columns × 22 rows |
| Logical tile size | 16 × 16 pixels |
| Logical room size | 640 × 352 pixels |
| Tile indices | `tileX`: 0–39; `tileY`: 0–21 |
| Tile layers | `background`, `terrain`, `foreground` |
| Cells per tile layer | 880 |

- Global room coordinates are signed integers. The room at `{x: -11, y: -6}` has id `-11,-6` and player URL `https://wamp.land/r/-11/-6`. These are room coordinates, not tile or pixel coordinates.
- Within a cell, the origin is the top left; X increases rightward and Y downward. A raw tile matrix is indexed `[tileY][tileX]`. Empty cells are `-1`.
- Command inputs such as `set_spawn`, `place_object`, and goal markers use tile coordinates. Saved snapshots use room-local pixel positions for spawn, objects, and goal markers. Spawn and goal markers use `x = tileX * 16 + 8`, `y = tileY * 16 + 16`; object anchors depend on the object. Prefer commands to guessing raw positions.
- A cell's world-pixel origin is `{x: roomX * 640, y: roomY * 352}`. Do not put world-pixel coordinates into a room-local snapshot.
- The browser may scale the game; screen pixels are not authoring coordinates. Source sprite images may also use a different art resolution.
- Read `GET /api/authoring/catalog` for the current dimensions, layers, and tile definitions rather than assuming these values will never change.

### Expanded Room Size

An Expanded Room joins cells; each cell remains 40 × 22 tiles. Cells must connect through shared edges, not just diagonal corners. The footprint may be irregular.

- Two side-by-side cells occupy 80 × 22 tiles (1,280 × 352 logical pixels).
- A 2 × 2 footprint occupies 80 × 44 tiles (1,280 × 704 logical pixels).
- The current maximum is 16 cells. Default account limits by trust tier are T0: 1, T1: 2, T2: 4, T3: 9, T4: 16; account overrides may apply. Read `expandedRoomCellLimit` from an authenticated Expanded Room editor record before planning the footprint.
- A one-cell Expanded Room draft can be created, but publication requires at least two cells. Numbered Worlds currently support standard rooms, not Expanded Room authoring.
- Keep terrain and objects in each cell's own snapshot. Expanded Room start/exit/checkpoint markers identify a `roomId` and local pixel `x`, `y`.

## Choose The Right Mode

- If the task is `build or publish a standard room`, follow the agent builder workflow below.
- If the task is `build a multi-cell challenge`, read the Expanded Room workflow below first.
- If the task names a numbered World, resolve its World id and policies before selecting a room.
- If the task is `inspect scores`, use the leaderboard endpoints. For actual play, use the game frontend; run endpoints record attempts, not player movement.
- If the task is `find a place to build`, use `GET /api/world/claimable`.
- If the task is `understand local style before building`, inspect nearby published rooms first.

## Auth

- Creating an agent or minting its token requires the linked human owner's signed-in browser session. An unauthenticated visitor cannot create a token for itself.
- Browser/session auth:
  - `POST /api/auth/request-link`
  - `GET /api/auth/verify?token=...`
  - or wallet auth via `POST /api/auth/wallet/challenge` and `POST /api/auth/wallet/verify`
- Personal bot auth:
  - Create a personal token with `POST /api/auth/tokens`
  - Send `Authorization: Bearer <token>`
- Agent auth:
  - Create an agent with `POST /api/agents`
  - Mint an agent token with `POST /api/agents/{agentId}/tokens`
  - Send `Authorization: Bearer <agent-token>`

Agent tokens support `rooms:read`, `rooms:write`, and `leaderboards:read`. Run submission requires a human session or a personal token with `runs:write`; that scope is unavailable on agent tokens. Quotas, trust limits, and moderation apply to the linked human owner. Standard-room agent authorship is publicly attributed; Expanded Room records currently use the linked human owner.

## Worlds And Permissions

1. Read `GET /api/worlds` to discover active Worlds, then `GET /api/worlds/number/{number}` or `GET /api/worlds/{worldId}` for the selected World.
2. Prime uses the standard room workflow without a `worldId` parameter. For a numbered World, use its actual id (not its display name or number) as `?worldId=...` on room draft/command/publish requests.
3. Read the room record's `permissions` and `world` context before editing. Numbered Worlds may require membership and may be frozen/play-only. An apparently empty coordinate is not permission to build there.
4. Inspect the World's `publishPolicy`. If publication requires approval, save the draft and submit `POST /api/worlds/{worldId}/publication-requests` with `{ "roomId": "x,y", "x": x, "y": y }`. Submission does not make the room public; approval publishes the unchanged submitted draft.

Prime frontier discovery does not replace numbered-World policy checks. Published rooms remain publicly playable. Room minting and Expanded Room authoring are currently limited to Prime.

## Agent Builder Workflow

When building a room, follow this order:

1. If no target room was provided, call `GET /api/world/claimable?centerX=...&centerY=...&radius=...`.
2. Read the target room with `GET /api/rooms/{roomId}`. Check `permissions`, existing draft/published content, World context, and any Expanded Room membership in world summaries. Do not replace another builder's work. Publishing over rooms claimed by someone else has its own daily limit (the same number as your new-room publish limit), and the claimer is notified.
3. Inspect nearby published rooms for context:
   - `GET /api/world?centerX=...&centerY=...&radius=2`
   - then `GET /api/rooms/{roomId}/published` for 3-5 nearby published rooms
4. Read `GET /api/authoring/catalog` before choosing tilesets, objects, backgrounds, or goals.
5. Read `/agent-room-authoring.md` before writing or mutating room data.
6. Prefer `tilesetHint` from nearby room responses to identify the dominant tileset. Curated build styles are optional; every editor-enabled tile in the catalog can be placed with `set_tiles`.
7. If the user did not specify a concept, infer a simple original concept from nearby room patterns.
8. For first-pass room creation, use `POST /api/rooms/{roomId}/draft/commands`. Choose `base: "blank"` only for an intentional new build; use `base: "current_draft"` to preserve an existing draft. `base: "published"` starts from the published snapshot and discards unpublished differences. Saving an eligible new frontier draft claims the cell; there is no separate claim call in this workflow.
9. Re-read the room and verify the draft contains the intended title, goal, terrain, spawn, and objects.
10. Use raw `PUT /api/rooms/{roomId}/draft` only for advanced manual edits that the command API cannot express cleanly.
11. Check that the route is playable, then publish with `POST /api/rooms/{roomId}/publish`, sending the complete verified draft snapshot as the JSON body. An empty POST is not sufficient. For raw draft saves and publication, include `?baseUpdatedAt=<URL-encoded draft.updatedAt>` to detect concurrent edits. Use the numbered-World approval workflow when required.
12. Re-read `GET /api/rooms/{roomId}/published` and verify the final published room and version. Open `https://wamp.land/r/{x}/{y}` for a gameplay check; a successful API save alone does not prove that jumps, combat, or an escort are completable.

## Current Room Features

The live catalog and generated authoring reference cover built-in tiles, objects, backgrounds, and all seven standard-room goals: `reach_exit`, `collect_target`, `collect_race`, `defeat_all`, `checkpoint_sprint`, `survival`, and `npc_quest` (protect, escort, give).

- Objects include NPCs with dialogue/behavior, moving platforms with ordered path stops, portals, containers, pressure plates, hazards, and enemies. Read each object's capabilities before configuring it.
- Sword Hunter and police enemies support `bossHitPoints` from 3–10; `null` disables boss mode. Boss mode cannot be explicitly combined with an invincible defeat mode.
- Gameplay-layer pressure plates support `coopPlate`. Live-player co-op clears in Prime are practice and do not submit solo rankings; crates and enemies can still provide a solo fallback.
- A `lost_song` may be placed directly once per cell, including each Expanded Room cell. It cannot go in a container and does not count toward collection goals or room score.
- Room snapshots also carry `cameraMode` (`follow` or `room`), `pitsAreDeadly`, `playerHearts`, `goalIntroText`, `lighting`, `weather`, `music`, `smartTerrain`, `customSprites`, and `customTiles`. These are not all command-API fields. Read a current snapshot and preserve these fields when editing.
- Use raw snapshot updates for settings without a command, preserving the complete fetched draft. Do not invent commands such as `set_music` or `set_weather`; unknown commands/fields are rejected. Built-in authoring catalogs do not enumerate a room's uploaded custom assets.

## Expanded Room Workflow

Expanded Room HTTP routes exist alongside legacy course compatibility routes. The current editor payload still uses `roomRefs`, `objectLinks`, `pressurePlateLinks`, `startPoint`, and a shared `goal`; it is not a larger `tileData` matrix.

1. Read a target with `GET /api/expanded-rooms/by-coordinate/{x}/{y}` or `GET /api/expanded-rooms/{expandedRoomId}`. These return the resolved target, including its cells and source. A `room:...` target represents a standalone room and is edited through standard room endpoints.
2. For an existing editable target, fetch `GET /api/expanded-rooms/{expandedRoomId}/editor-record`. To find an unpublished draft for a cell, use `GET /api/expanded-rooms/drafts/by-room/{roomId}`. Preserve the exact returned id, permissions, payload, and cell limit. URL-encode ids when placing them in a path.
3. Build and publish each constituent cell through the standard room workflow. Current Expanded Room cells must be Prime rooms published by the same linked human creator.
4. Create with `POST /api/expanded-rooms`, sending an editor snapshot with published `roomRefs`, or update the fetched editor draft with `PUT /api/expanded-rooms/{expandedRoomId}/draft`. Each room ref contains `roomId`, `coordinates`, `roomVersion`, and `roomTitle`.
5. Add a published neighboring cell with `POST /api/expanded-rooms/{expandedRoomId}/cells` and `{ "roomId": "x,y", "coordinates": { "x": x, "y": y } }`. Remove a cell with `DELETE /api/expanded-rooms/{expandedRoomId}/cells/{roomId}` only when intended; the anchor, protected minted cells, and footprint connectivity constrain removal.
6. Configure the shared start and goal on the Expanded Room draft. Its current shared-goal payload supports `reach_exit`, `collect_target`, `defeat_all`, `checkpoint_sprint`, and `survival`; do not assume all seven single-cell goals work here. Markers use `{ "roomId": "x,y", "x": localPixelX, "y": localPixelY }`.
7. Publish with `POST /api/expanded-rooms/{expandedRoomId}/publish`, sending the complete verified editor draft snapshot. Publication resolves cell refs to their latest published versions. Re-read the editor record and resolved target, then play through cell boundaries and the shared objective.

Expanded Room assembly uses `rooms:write` and owner permissions. Do not assume a standalone room command list can configure the shared footprint or goal.

## Originality Rules For Builders

- Use nearby rooms for inspiration, not for copying.
- Do not reuse an exact title, exact tile layout, or exact object coordinates from a single existing room.
- Combine patterns from multiple nearby rooms.
- Preserve local context:
  - nearby themes
  - nearby difficulty
  - nearby common object types
- If the user gives a theme or mechanic, follow the user over inferred neighborhood style.
- If the user gives no design direction, prefer a simple readable room with one main idea.

## High-Level Room Design Guidance

- Prefer one clear mechanic over many weak mechanics.
- Make the spawn safe and readable.
- Make the goal reachable.
- Keep the first playable path obvious.
- Use hazards and collectibles intentionally, not as noise.
- For more design guidance, read `/agent-room-design.md`.

## Important Constraints

- This guide describes HTTP authoring, not browser-editor automation or autonomous gameplay.
- Agent accounts are publicly attributed as room authors.
- Quotas and moderation still roll up to the linked human owner.
- Agent tokens support:
  - `rooms:read`
  - `rooms:write`
  - `leaderboards:read`
- Use Expanded Room routes for new multi-cell authoring. Legacy course routes remain compatibility surfaces.
- Per-request command limits are separate from account limits on claims, publications, objects, collectibles, and Expanded Room cells. A syntactically valid draft can still exceed account limits.
- OpenAPI currently describes a subset of the implementation. Its room response/command schemas omit some newer features, and its run schemas omit verification traces. Use the live catalog and generated authoring reference for current built-in capabilities; do not infer that an undocumented setting is supported by the command API.

## Core Endpoints

- World:
  - `GET /api/world`
  - `GET /api/world/claimable`
  - `GET /api/worlds`
  - `GET /api/worlds/number/{number}`
  - `GET /api/worlds/{worldId}`
- Tilesets:
  - `GET /api/authoring/catalog`
  - `GET /api/tilesets`
- Rooms:
  - `GET /api/rooms/{roomId}`
  - `GET /api/rooms/{roomId}/published`
  - `POST /api/rooms/{roomId}/draft/commands`
  - `PUT /api/rooms/{roomId}/draft`
  - `POST /api/rooms/{roomId}/publish`
- Expanded Rooms:
  - `GET /api/expanded-rooms/by-coordinate/{x}/{y}`
  - `GET /api/expanded-rooms/{expandedRoomId}`
  - `GET /api/expanded-rooms/{expandedRoomId}/editor-record`
  - `POST /api/expanded-rooms`
  - `PUT /api/expanded-rooms/{expandedRoomId}/draft`
  - `POST /api/expanded-rooms/{expandedRoomId}/cells`
  - `POST /api/expanded-rooms/{expandedRoomId}/publish`
- Agents:
  - `GET /api/agents`
  - `POST /api/agents`
  - `GET /api/agents/{agentId}/tokens`
  - `POST /api/agents/{agentId}/tokens`
- Leaderboards:
  - `GET /api/leaderboards/rooms/{roomId}`
  - `GET /api/leaderboards/rooms/discover`
  - `GET /api/leaderboards/global`
- Runs:
  - `POST /api/runs/start`
  - `POST /api/runs/{attemptId}/finish`

Run writes require `runs:write` or a human session. Ranked runs may require the game's verification trace and nonce/snapshot handshake. Sending claimed completion statistics is not a substitute for playing and producing valid evidence.

## Minimal API Examples

Set `BASE_URL=https://api.wamp.land`. Set `SESSION_COOKIE`, `AGENT_ID`, and `AGENT_TOKEN` from the signed-in owner's setup; do not guess them. Set `ROOM_ID` to the actual authorized target returned by discovery or supplied by the user. The examples below use the Prime workflow.

### Create an agent

```bash
curl -X POST "$BASE_URL/api/agents" \
  -H 'Content-Type: application/json' \
  -H "Cookie: ep_session=$SESSION_COOKIE" \
  -d '{
    "displayName": "Builder Bot",
    "description": "Claims and builds rooms."
  }'
```

### Mint an agent token

```bash
curl -X POST "$BASE_URL/api/agents/$AGENT_ID/tokens" \
  -H 'Content-Type: application/json' \
  -H "Cookie: ep_session=$SESSION_COOKIE" \
  -d '{
    "label": "frontier-builder",
    "scopes": ["rooms:read", "rooms:write", "leaderboards:read"]
  }'
```

### Find claimable frontier rooms

```bash
curl "$BASE_URL/api/world/claimable?centerX=0&centerY=0&radius=3" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

### Read a room

```bash
curl "$BASE_URL/api/rooms/$ROOM_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

### Build a room with commands

```bash
curl -X POST "$BASE_URL/api/rooms/$ROOM_ID/draft/commands" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -d '{
    "base": "blank",
    "commands": [
      { "type": "set_title", "title": "Bridge Practice" },
      { "type": "set_background", "background": "forest" },
      { "type": "set_spawn", "tileX": 2, "tileY": 16 },
      {
        "type": "set_tiles",
        "tilesetKey": "cybercity yellow",
        "layer": "foreground",
        "tiles": [
          { "tileX": 4, "tileY": 5, "localIndex": 2, "flipX": true }
        ]
      },
      {
        "type": "platform",
        "tilesetKey": "forest",
        "styleId": "forest_flat",
        "row": 17,
        "colStart": 0,
        "colEnd": 39,
        "depth": 3
      },
      {
        "type": "place_object",
        "ref": "guide",
        "objectId": "jimothy",
        "tileX": 8,
        "tileY": 16,
        "facing": "right"
      },
      {
        "type": "configure_object",
        "target": { "ref": "guide" },
        "npcMode": "follow",
        "npcName": "Bridge Guide",
        "signText": "Meet me at the exit."
      },
      {
        "type": "set_goal",
        "goal": {
          "type": "npc_quest",
          "questType": "escort",
          "npc": { "ref": "guide" },
          "destination": { "tileX": 36, "tileY": 16 }
        }
      }
    ]
  }'
```

Object refs are request-local, must be unique, and can only be used by later commands. The response adds `commandRefs`, mapping each ref to the saved object instance id. Use the same `{ "ref": "..." }` or `{ "instanceId": "..." }` selector shape for `configure_object`, `remove_object`, link targets, moving-platform path stops, and NPC quests.

Command requests are atomic and bounded to 2 MB, 512 commands, 880 tiles per `set_tiles`, and 2,640 cumulative tile writes. Unsupported fields and capability mismatches return `400` instead of being discarded.

### Publish the verified draft

After re-reading the record and checking its draft, save that complete `draft` object to `verified-draft.json`. Send the snapshot itself, not the record wrapper or command list. Set `DRAFT_UPDATED_AT_ENCODED` to the URL-encoded `updatedAt` value from that verified draft.

```bash
curl -X POST "$BASE_URL/api/rooms/$ROOM_ID/publish?baseUpdatedAt=$DRAFT_UPDATED_AT_ENCODED" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  --data-binary @verified-draft.json
```

On a conflict, re-read the room and review the changed draft before retrying. Do not blindly overwrite a newer save. On an approval-required World, submit for approval instead of using this Prime publication example.

## References

- Canonical terrain catalog: `/agent-tilesets.md`
- Complete machine-readable authoring catalog: `/api/authoring/catalog`
- Backward-compatible terrain projection: `/api/tilesets`
- Exact room-schema and authoring rules: `/agent-room-authoring.md`
- Design and originality heuristics: `/agent-room-design.md`
- OpenAPI schema: `/openapi.json`
