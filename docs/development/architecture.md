# Architecture Notes

Everybody's Platformer is a Phaser/Vite app backed by Cloudflare Workers, D1 storage, PartyKit presence, and Base L2 ownership flows.

## Client

- `src/main.ts` boots the Vite/Phaser client and wires the game container.
- `src/scenes/BootScene.ts` preloads assets and transitions into the playable world/editor flow.
- `src/scenes/OverworldPlayScene.ts` owns browse/play mode, chunk streaming, room traversal, goals, runs, comments, presence, and HUD integration.
- `src/scenes/EditorScene.ts` owns room editing, tools, inspector state, test play, save/publish flow, and editor overlays.
- `src/scenes/CourseEditorScene.ts` and `src/scenes/CourseComposerScene.ts` cover course and expanded-room authoring.
- `src/ui/setup.ts` and `src/ui/setup/` connect DOM controls, modals, palettes, auth UI, chat, profile surfaces, and scene commands.

## Backend

- `src/cloudflare/worker.ts` is the Worker entry point.
- `src/cloudflare/worker/` contains route groups for room storage, auth, chat, runs, leaderboards, admin review, school flows, background uploads, profiles, and share metadata.
- D1 migrations live under `migrations/`.
- `public/_worker.js` handles Pages-side route aliases and metadata injection for selected public routes.

## Realtime

- `partykit/presenceServer.ts` handles realtime room/world presence.
- The Worker issues presence identity tokens, and PartyKit validates the shared signing secret.

## Rendering Model

- Rooms are `40 x 22` tiles at `16 x 16` pixels, for a native room size of `640 x 352`.
- Saved room data includes layered tiles, placed objects, background/environment settings, spawn/goal data, metadata, and version information.
- The overworld streams room chunks and renders preview textures for distant rooms while promoting nearby rooms to fuller runtime representations.
- The editor renders the selected room with tile layers, placed objects, background previews, grid overlays, and tool-specific overlays.

## Public Surfaces

- Root HTML files are multi-page app/admin entry points. See [html-entrypoints.md](html-entrypoints.md).
- Public agent-facing docs and schemas live under `public/` because the app serves them directly.
- Environment examples live in [environment.md](environment.md), not tracked root-level env files.
