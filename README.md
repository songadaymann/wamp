# Everybody's Platformer

Everybody's Platformer is a collaborative, web-based platformer world. Players explore an infinite grid of rooms, build and publish their own rooms, play authored goals and courses, and connect identity, ownership, leaderboards, chat, and presence around the world.

Live app: <https://wamp.land>

## Stack

- Phaser 3, TypeScript, and Vite for the client
- Cloudflare Workers, D1, R2/Images, and Pages for the backend and hosting surface
- PartyKit for realtime presence
- Base L2 contracts for room ownership and minting flows

## Local Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

The frontend dev server runs on `http://127.0.0.1:3000` by default. Backend development uses Wrangler and PartyKit:

```bash
npm run dev:api
npm run dev:presence
```

Local environment files are intentionally not tracked. Use `env.local` for frontend Vite overrides and `.dev.vars` for Worker values, following [docs/development/environment.md](docs/development/environment.md).

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/` | Client, editor, world, UI, audio, API client, and Worker source |
| `src/scenes/` | Phaser scenes and scene-specific systems |
| `src/cloudflare/worker/` | Worker routes, storage, auth, moderation, leaderboards, and admin APIs |
| `partykit/` | Realtime presence server |
| `contracts/` | Room ownership contract workspace |
| `scripts/` | Build, deploy, smoke-test, migration, and maintenance scripts |
| `docs/` | Product, feature, and development notes |
| `public/` | Static assets plus public agent/API-facing docs served by the app |

## HTML Entry Points

The root `.html` files are intentional Vite multi-page entry points and stable app/admin URLs. See [docs/development/html-entrypoints.md](docs/development/html-entrypoints.md) before moving or renaming them.

## Documentation

Start with [docs/README.md](docs/README.md) for the organized documentation index. Product planning lives under `docs/product/`, feature design under `docs/features/`, and implementation notes under `docs/development/`.

## Public Repo Hygiene

- Do not commit `.env`, `env.local`, `.dev.vars`, Wrangler secret dumps, generated builds, or smoke-test output.
- Keep secret-shaped setup examples in docs, not root-level env example files.
- Treat `public/agent-room-authoring.md`, `public/agent-room-design.md`, `public/skill.md`, and `public/openapi.json` as public API surfaces.
