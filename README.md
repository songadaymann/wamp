# Everybody's Platformer

Everybody's Platformer is a collaborative infinite platformer: a single shared world made from user-built rooms. Each coordinate on the map can become a playable level, and players can browse, build, publish, play, score, comment on, and optionally mint rooms as ownership tokens on Base.

Think Mario Maker plus a living web map. The world grows one room at a time.

## Live Surfaces

- App: <https://wamp.land>
- Public API: <https://api.wamp.land>
- OpenAPI: <https://api.wamp.land/openapi.json>
- Agent docs: <https://wamp.land/agents/>

## What Exists Today

### Shared World

- Coordinate-addressed overworld with published, draft, frontier, empty, and expanded-room states.
- Chunked world loading with room previews and level-of-detail rendering for large map browsing.
- Free-camera browse mode, follow-camera play mode, coordinate jump, fit-to-world, and room-to-room traversal.
- Multi-cell authored areas through the course/Expanded Rooms system.

### Room Building

- Browser-based room editor for `40 x 22` tile rooms.
- Terrain, background, and foreground tile layers.
- Placed objects for hazards, collectibles, ladders, crates, enemies, markers, and interactive room mechanics.
- Parallax background selection, room title editing, spawn markers, goal markers, undo/redo, test play, save, publish, revert, and version history.
- Custom creator surfaces for room music, sprite/object creation, environment settings, and expanded-room authoring.

### Playing And Scoring

- Phaser platformer runtime with sprite-based player movement, jumping, ladders, crouch/crawl, push/pull crates, sword/gun actions, collectibles, hazards, enemies, and room goals.
- Version-scoped room runs, per-room leaderboards, global points/stats leaderboards, difficulty voting, Room Rush-style traversal modes, and post-run feedback flows.
- Published-room discovery, playlists, shareable room URLs, social preview images, and profile/progression surfaces.

### Accounts, Social, And Ownership

- Email auth, wallet-linked auth, session cookies, bearer API tokens, and scoped agent tokens.
- Worker/D1-backed drafts, published versions, runs, stats, chat, comments, profiles, ratings, moderation data, and admin surfaces.
- PartyKit-powered realtime ghost presence, room populations, name tags, and shared in-progress room previews.
- Live world chat plus comment/admin review tooling.
- ERC-721 room ownership contract workspace and mint prepare/confirm flow, with token-owner-gated edits for minted rooms.

### API And Agent Support

- Public API for reading rooms, finding claimable frontier space, authoring drafts, publishing rooms, submitting runs, and reading leaderboards.
- Public agent guidance in `public/skill.md`, `public/agent-room-authoring.md`, `public/agent-room-design.md`, and `public/openapi.json`.

## Architecture

- Client: Phaser 3, TypeScript, Vite, WebGL/Canvas rendering, custom DOM UI overlays.
- Backend: Cloudflare Workers for auth, rooms, world reads, runs, leaderboards, chat, moderation, admin flows, mint helpers, and API docs.
- Storage: Cloudflare D1 for relational game state, plus Cloudflare Images/R2-adjacent flows where user-uploaded or generated assets need durable hosting.
- Realtime: PartyKit for presence and shared preview state. Persistent room data stays in Worker/D1.
- Ownership: Base L2 contract workspace for room ownership and minting.

## Local Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

The frontend dev server runs on `http://127.0.0.1:3000` by default.

Backend and realtime development use Wrangler and PartyKit:

```bash
npm run dev:api
npm run dev:presence
```

Useful checks:

```bash
npm run check
npm run smoke:dom-contract
npm run smoke:preview:readonly
npm run smoke:mobile
```

Local environment files are intentionally not tracked. Use `env.local` for frontend Vite overrides and `.dev.vars` for Worker values, following [docs/development/environment.md](docs/development/environment.md).

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/` | Client, editor, world, UI, API client, audio, rendering, and Worker source |
| `src/scenes/` | Phaser scenes and scene-specific world/editor systems |
| `src/cloudflare/worker/` | Worker route groups, storage, auth, moderation, leaderboards, admin APIs, and share metadata |
| `partykit/` | Realtime presence server |
| `contracts/` | Room ownership contract workspace |
| `migrations/` | D1 schema migrations |
| `scripts/` | Build, deploy, smoke-test, migration, and maintenance scripts |
| `docs/` | Product, feature, and development notes |
| `public/` | Static assets plus public agent/API-facing docs served by the app |

## HTML Entry Points

The root `.html` files are intentional Vite multi-page entry points and stable app/admin URLs. They include the main game shell, dashboard, admin review tools, school flows, minted-room preview, room renderer, and reward preview surfaces.

See [docs/development/html-entrypoints.md](docs/development/html-entrypoints.md) before moving or renaming them.

## Documentation

Start with [docs/README.md](docs/README.md) for the organized documentation index.

- Product planning: `docs/product/`
- Feature design: `docs/features/`
- Development notes: `docs/development/`
- Public API/agent surfaces: `public/skill.md`, `public/agent-room-authoring.md`, `public/agent-room-design.md`, `public/openapi.json`

## Public Repo Hygiene

- Do not commit `.env`, `env.local`, `.dev.vars`, Wrangler secret dumps, generated builds, or smoke-test output.
- Keep secret-shaped setup examples in docs, not root-level env example files.
- Treat files under `public/` that describe agents or API behavior as public contract surfaces.
