---
name: everybodys-platformer
version: 0.5.0
description: Build, publish, play, score, and mint room-based platformer levels over the Everybody's Platformer API.
homepage: /
openapi: /openapi.json
---

# Everybody's Platformer Skill

Use this API to read and mutate rooms, submit scored runs, inspect leaderboards, and lock published rooms with an ERC721 mint.

## Base URL

- Use the same origin that serves this `skill.md`.
- OpenAPI spec: `/openapi.json`

## Auth

- Browser/session auth:
  - `POST /api/auth/request-link`
  - `GET /api/auth/verify?token=...`
  - or wallet auth via `POST /api/auth/wallet/challenge` and `POST /api/auth/wallet/verify`
- Bot auth:
  - Create a personal token with a signed-in browser session via `POST /api/auth/tokens`
  - Send `Authorization: Bearer <token>` on bot requests
- Token scopes:
  - `rooms:read`
  - `rooms:write`
  - `runs:write`
  - `leaderboards:read`
- Important:
  - Anonymous clients can still read public room and leaderboard data.
  - If you send a bearer token on a read request, that token must include the matching read scope.

## Coordinate Model

- Room ids are `"x,y"` strings such as `"0,0"` or `"-2,5"`.
- The `roomId` path segment is canonical and should match the embedded `coordinates`.
- World reads use integer center coordinates plus a radius:
  - `GET /api/world?centerX=0&centerY=0&radius=2`

## Room Model

- `RoomSnapshot` includes:
  - `id`
  - `coordinates`
  - `background`
  - `goal`
  - `spawnPoint`
  - `tileData`
  - `placedObjects`
  - `version`
  - `status`
  - timestamps
- Live goal types:
  - `reach_exit`
  - `collect_target`
  - `defeat_all`
  - `checkpoint_sprint`
  - `survival`

## Common Flows

### Read a room

- Draft + metadata: `GET /api/rooms/{roomId}`
- Published only: `GET /api/rooms/{roomId}/published`
- Version history: `GET /api/rooms/{roomId}/versions`

### Save and publish a room

1. Read the current room record.
2. Modify `draft`.
3. `PUT /api/rooms/{roomId}/draft` with the full `RoomSnapshot`.
4. `POST /api/rooms/{roomId}/publish` with the full `RoomSnapshot`.

If you authenticate with a bearer token, it must include `rooms:write`.

### Start and finish a scored run

1. Read the published room and active goal.
2. `POST /api/runs/start`
3. Play the room.
4. `POST /api/runs/{attemptId}/finish`

Bearer tokens for run submission must include `runs:write`.

### Read leaderboards

- Per room/version:
  - `GET /api/leaderboards/rooms/{roomId}`
  - optional `?version=3&limit=10`
- Global:
  - `GET /api/leaderboards/global?limit=10`

Bearer tokens for leaderboard reads must include `leaderboards:read`.

### Mint room ownership

1. Publish the room first.
2. Ensure the authenticated account has a linked wallet.
3. `POST /api/rooms/{roomId}/mint/prepare`
4. Send the returned transaction through the linked wallet.
5. `POST /api/rooms/{roomId}/mint/confirm` with `{ "txHash": "0x..." }`

After mint, only the current token owner can save drafts, publish, revert, or re-confirm ownership sync on that room.

## Examples

### Create a bot token from a signed-in browser session

```bash
curl -X POST "$BASE_URL/api/auth/tokens" \
  -H 'Content-Type: application/json' \
  -H "Cookie: ep_session=$SESSION_COOKIE" \
  -d '{
    "label": "builder-agent",
    "scopes": ["rooms:read", "rooms:write", "runs:write", "leaderboards:read"]
  }'
```

### Read a room with a bearer token

```bash
curl "$BASE_URL/api/rooms/0,0" \
  -H "Authorization: Bearer $API_TOKEN"
```

### Publish a room draft

```bash
curl -X POST "$BASE_URL/api/rooms/0,0/publish" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d @room-snapshot.json
```

### Submit a run

```bash
curl -X POST "$BASE_URL/api/runs/start" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "roomId": "0,0",
    "roomCoordinates": { "x": 0, "y": 0 },
    "roomVersion": 1,
    "goal": { "type": "reach_exit", "exit": { "x": 320, "y": 192 }, "timeLimitMs": null }
  }'
```

### Prepare a mint

```bash
curl -X POST "$BASE_URL/api/rooms/0,0/mint/prepare" \
  -H "Authorization: Bearer $API_TOKEN"
```

## Agent Notes

- Prefer `GET /api/rooms/{roomId}/published` when you only need live playable data.
- Preserve `goal` and `spawnPoint` fields when rewriting snapshots.
- Leaderboards are version-scoped by default; omit `version` to target the current published version.
- Minting does not store room geometry onchain in this phase. D1 remains the source of truth for room content.
