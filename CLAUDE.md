# Everybody's Platformer

Mario Maker meets Million Dollar Homepage — collaborative infinite platformer on Base L2.

## Commands

```bash
npm run dev      # Vite dev server (hot reload)
npm run build    # tsc && vite build
npx tsc --noEmit # Type-check only
```

## Tech Stack

- **Phaser 3.87** (WebGL, Arcade Physics, pixelArt: true)
- **TypeScript 5.7**, **Vite 6.2**
- Room dimensions: 40x22 tiles @ 16px = 640x352px

## Architecture

### Scenes (Boot -> Editor <-> Play)

- **BootScene** (`src/scenes/BootScene.ts`): Preloads all assets, creates animations, transitions to Editor
- **EditorScene** (`src/scenes/EditorScene.ts`, ~984 lines): Tile editor with tools (pencil/rect/fill/eraser), undo/redo, object placement, parallax bg preview, camera pan/zoom, grid overlay
- **PlayScene** (`src/scenes/PlayScene.ts`, ~503 lines): Runtime platformer with physics (gravity=700, coyote time, jump buffering), dual-camera parallax system, collectible/hazard/enemy interactions

### Key Files

- `src/config.ts` — Central config: room dims, tilesets (6), background groups (7+), game objects (25+), editor state
- `src/ui/setup.ts` — HTML UI integration: palette rendering, tool/layer/bg selectors, keyboard shortcuts
- `src/main.ts` — Phaser game init, window resize handling
- `index.html` — Editor UI layout (sidebar, palette, bottom bar)

### State Management

Global `editorState` in config.ts shared between Phaser scenes and HTML UI. Custom events (`tileset-changed`, `background-changed`) bridge HTML and Phaser.

## Background/Parallax System

### Play Mode (PlayScene)
- Separate `bgCamera` at zoom 1x renders TileSprites filling the full viewport
- Main camera at 3x zoom renders game world on top
- Scale: `Math.ceil(viewportHeight / textureHeight)` — integer scaling for crisp pixels
- Horizontal-only parallax: `tilePositionX = (cam.scrollX * scrollFactor) / scale`
- `tilePositionY = 0` always (vertical scroll exposes tile seams)
- `Phaser.Textures.FilterMode.NEAREST` forced on all bg textures

### Editor Mode (EditorScene)
- TileSprites extend beyond room bounds (padding = max(roomW, roomH)) to fill visible area
- Same integer scale formula as play mode: `Math.ceil(screenHeight / textureHeight)`
- tilePosition offset compensates for padding: `tilePositionX/Y = -pad / scale`
- Alpha 0.85 for slight transparency over game elements

### Background Assets
- **Optimal resolution**: ~576x324px (scales to 3x on typical screen, matching game's 3x zoom)
- **Current packs**: craftpix nature series (576x324) + cave (960x480)
- Groups defined in `BACKGROUND_GROUPS` array in config.ts with `bgColor` optional field for transparent-layer packs

## Tilesets

6 themes (Forest, Desert, Dirt, Lava, Snow, Water) from Rocky Roads pack. Each has sequential firstGid offsets. 16x16px tiles.

## Physics (PlayScene)

- GRAVITY: 700, JUMP_VELOCITY: -280, PLAYER_SPEED: 150
- Coyote time: 80ms, Jump buffer: 100ms
- Player is currently a blue rectangle placeholder
- Respawn at room center top on hazard/enemy/fall

## Known Issues & Notes

- Player sprite is placeholder (blue rect) — needs art matching Rocky Roads style
- No persistence yet (editor state lost on refresh)
- nvm shell setup throws harmless warnings (`ln: Not a directory`)
- Dev server sometimes gets stuck; kill port and restart on different port if needed
