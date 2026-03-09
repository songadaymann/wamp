# Everybody's Platformer — Product Requirements Document

## Vision

A massively collaborative, ever-expanding online platformer where every room is built by a different person. Think Million Dollar Homepage meets Mario Maker — except the whole world is one continuous, playable game that anyone can add to.

Players claim rooms on an infinite grid, lay down tiles using a browser-based editor, and publish playable platformer scenes that connect to their neighbors. The world grows organically from a central seed, one room at a time. Mint your room as an NFT on Base to lock ownership and make your creation permanent.

---

## Current Product State (March 8, 2026)

- The current prototype is a strong **single-room vertical slice**, not the world-grid game yet.
- The editor, tile/object placement, backgrounds, undo/redo, and local test play are working.
- Single-room **draft save / load / publish / version history** is now live on **Cloudflare Workers + D1**.
- The game is deployed at `https://everybodys-platformer.novox-robot.workers.dev`.
- Core differentiators from the PRD are still missing: world map, frontier claiming, multi-room traversal, auth, multiplayer ghosts, minimap, goals, and leaderboards.

### Recommendation

The next milestone should be the **world shell**, not the full “infinite room economy” all at once.

That means:

1. Make rooms load by coordinate, not just the default `(0,0)` room.
2. Add a world query that can answer: occupied, frontier, or empty.
3. Render a simple world grid/map UI and let the player enter adjacent rooms.
4. Only after that, add room claiming/auth rules and broader multiplayer/world systems.

So yes: now is the right time to start the big grid system, but in a constrained way. The next step is **coordinate-addressed multi-room navigation + frontier state**, not full ownership/minting/claiming logic yet.

---

## Core Concepts

### The World

- An infinite 2D grid of **rooms** (chunks/scenes)
- Each room is a self-contained platformer scene: platforms, hazards, enemies, collectibles, decorations
- Rooms connect at their edges — walk off the right side of one room, enter the left side of the next
- The world starts from a single seed room and expands outward — you can only build adjacent to an existing room (the **frontier**)
- Every room has a coordinate address (e.g., `12,-3`) for navigation and sharing

### Rooms

- **Size:** 40x22 tiles at 16x16 pixels (640x352 px native, rendered at 2x–3x)
- **Layers:** 3–4 layers per room:
  - Background (sky, parallax, decorative — non-collidable)
  - Terrain (ground, platforms, walls — collidable)
  - Objects (enemies, springs, switches, collectibles — interactive)
  - Foreground (decorative overlay — non-collidable, renders in front of player)
- **Boundaries:** Thick visual borders between rooms with openings/doorways at connection points. Creator name and room coordinates displayed subtly
- **Edge behavior:** Freeform — no requirement to match floor heights or terrain at boundaries. Discontinuities are part of the charm. Edge compatibility is a possible future feature

### Tile Format

- 16x16 pixel tiles
- Tileset stored as spritesheets with index-based references
- Room data stored as tile index arrays per layer
- Export format: **Tiled JSON** — the de facto standard for platformer tile data, importable by Phaser, Godot, Unity, and most engines
- This means every room (and especially every minted room) is a functional, portable game artifact

---

## User Flows

### Onboarding (Zero Friction)

1. User lands on the site, sees the world map
2. Can immediately zoom in, explore, and play through existing rooms — no account needed
3. Clicks an empty frontier room to start building
4. Editor opens, user begins placing tiles — still no account needed
5. After placing **~20 tiles**, a non-intrusive prompt appears: "Sign up to save your progress"
6. User creates account (email magic link) and their work is preserved
7. Wallet connection is entirely optional, surfaced only when the user wants to mint

### Building

1. User claims a frontier room
2. Editor opens with the tile palette, tools, and layer controls
3. User builds their room — places terrain, objects, enemies, decorations
4. User can **test play** their room at any time (runs the platformer in their room)
5. User sets a **room goal** (see Goals section)
6. User publishes — room goes live, other players can now enter it
7. User can continue editing after publishing; changes go live on next publish

### Playing

1. Player spawns at their chosen location (default: central hub)
2. Player runs, jumps, and traverses rooms in real-time
3. Other players are visible as ghosts — you see them moving around, but no collision/interaction (v1)
4. Camera defaults to free-cam (pan/zoom), with a **follow-cam toggle** for Celeste-style room-by-room play
5. Minimap always visible, click to jump to any room. Coordinate input for direct navigation
6. Room goals provide objectives; leaderboards track completions and times

### Editing Other Rooms

- **Pre-mint rooms:** Anyone can edit. Creator can revert to any previous version. Full version history stored
- **Post-mint rooms:** Only the NFT holder can edit. Edits require an onchain transaction (writing new layout to token)
- Editing happens in a draft layer; changes go live on publish (off-chain) or on transaction confirmation (on-chain)

---

## Editor

The editor is the core product. It needs to be dead simple for casual users but powerful enough for creators who want precision.

### Tools

| Tool | Description |
|------|-------------|
| **Single Tile** | Click to place one tile. The default tool |
| **Rectangle Fill** | Click-drag to fill a rectangular area |
| **Flood Fill** | Fill a contiguous area of same/empty tiles |
| **Eraser** | Click or drag to remove tiles |
| **Tile Picker** | Click on an existing tile in the room to select it from the palette |
| **Select/Move** | Select a region and drag to reposition (v1.5) |
| **Object Placer** | Place enemies, springs, collectibles, etc. with property controls |

### Interface

- **Left sidebar:** Tile palette organized by theme/category. Click to select, scroll to browse
- **Top bar:** Tool selection, layer toggle, undo/redo, zoom controls
- **Bottom bar:** Room info (coordinates, creator), test play button, publish button
- **Canvas:** The room grid, rendered via Phaser 3 (WebGL). Scroll to zoom, middle-click/space+drag to pan
- **Layer visibility:** Toggle layers on/off for easier editing. Active layer highlighted

### Rendering

- Canvas/WebGL — not DOM-based
- Smooth zoom from room-level to world overview
- Only render rooms in the current viewport
- Tile rendering uses spritesheet atlas for performance

---

## Tileset & Art

### Launch Set — Rocky Roads Asset Pack (itch.io)

One cohesive tileset pack with 6 platformer themes, all 16x16 tiles:

1. **Forest** (`tileset_forest.png`, 192x96, 12x6 = 72 tiles) — green ground, dirt, grass edges
2. **Desert** (`tileset_desert.png`, 192x96, 12x6 = 72 tiles) — sand, sandstone, desert terrain
3. **Dirt** (`tileset_dirt.png`, 192x96, 12x6 = 72 tiles) — brown earth, stone, underground
4. **Lava** (`tileset_lava.png`, 240x112, 15x7 = 105 tiles) — volcanic rock, lava flows
5. **Snow** (`tileset_snow.png`, 176x96, 11x6 = 66 tiles) — ice, snow, frozen terrain
6. **Water** (`tileset_water.png`, 192x96, 12x6 = 72 tiles) — aquatic terrain, seaweed

Total tile indices: ~459 tiles across all themes. Each tileset contains terrain fill, edges, corners, and detail pieces in a consistent pixel art style.

### Decorations (Non-Interactive)

From the Rocky Roads `Deco/` folder:
- Trees (multiple variants), bushes, rocks, logs
- Clouds, sun
- Water animations (2 variants, animated)
- Lava (animated)

### Game Objects (Interactive)

From the Rocky Roads `Objects/` folder:

| Object | Source | Behavior |
|--------|--------|----------|
| **Gold Coin** | `coin_gold.png` (8-frame anim) | Collectible. Triggers room goal if applicable |
| **Silver Coin** | `coin_silver.png` | Collectible, lower value |
| **Gem** | `gem.png` | Premium collectible |
| **Bounce Pad** | `bounce pad.png` (multi-frame) | Launches player upward |
| **Flag** | `flag.png` | Goal marker / checkpoint |
| **Key / Lock** | `key.png`, `lock.png` | Key unlocks matching lock gate |
| **Crate** | `crate.png` | Breakable / pushable |
| **Treasure Chest** | `treasure_chest.png` | Contains reward |
| **Ladder** | `ladder.png` | Climbable surface |
| **Sign** | `sign.png`, `sign_arrow.png` | Displays creator-written text |
| **Cloud Platforms** | `cloud_platforms.png` | Semi-solid, can jump through from below |
| **Button** | `button.png` | Toggles doors/blocks |
| **Brick Box** | `brick_box.png` | Breakable block (hit from below) |

### Enemies & Hazards

From the Rocky Roads `Enemies/` folder (30 sprites):

| Enemy | Source | Behavior |
|-------|--------|----------|
| **Slime** (blue/red) | `slime_blue.png`, `slime_red.png` | Walker — patrols back and forth |
| **Bat** | `bat.png` (multi-frame) | Flyer — moves in pattern |
| **Bird** | `bird.png` | Flyer |
| **Crab** | `crab.png` | Walker |
| **Frog** | `frog.png` | Hopper — jumps periodically |
| **Snake** | `snake.png` | Walker |
| **Fish / Shark** | `fish.png`, `shark.png` | Water enemy |
| **Bear** (brown/polar) | `bear_brown.png`, `bear_polar.png` | Heavy walker |
| **Chicken** | `chicken.png` | Walker |
| **Penguin** | `penguin.png` | Walker (snow theme) |
| **Saw** | `saw.png` | Rotating hazard on fixed path |
| **Cannon + Bullet** | `cannon.png`, `bullet.png` | Shoots projectiles |
| **Bomb** | `bomb.png` | Explodes on timer or contact |
| **Spikes / Ice Spikes** | `spikes.png`, `ice_spikes.png` | Static hazard, kills on contact |
| **Cactus** | `cactus.png`, `cactus_spike.png` | Static hazard (desert theme) |
| **Fire** | `fire.png`, `fire_big.png`, `fireball.png` | Static/projectile hazard |
| **Tornado** | `tornado.png`, `tornado_sand.png` | Moving hazard, pushes player |
| **Icicle** | `icicle.png` | Falls when player is beneath |
| **Lightning** | `lightning.png` | Periodic hazard |
| **Quicksand** | `quicksand_8frames.png` (animated) | Sinks player slowly |
| **Wood Stakes** | `wood_stakes.png` | Static hazard |
| **Propeller** | `propeller.png` | Flying hazard |

### FX (Visual Effects)

From the Rocky Roads `FX/` folder — used for feedback and juice:
- `dust.png`, `walk_dust.png` — movement particles
- `splash.png` — water entry
- `boing.png` — bounce pad activation
- `hit.png` — damage feedback
- `bomb_explosion.png` — explosion
- `coin_collect.png` — collection sparkle
- `shine.png`, `shine_white.png` — item gleam
- `bubble.png` — underwater
- `rain_particles.png`, `snow_particle.png` — weather
- `wind.png` — wind visual

### Backgrounds

From the Rocky Roads `Backgrounds/` folder — parallax layers:
- `mountains_a.png`, `mountains_b.png` (256x128) — mountain silhouettes
- `trees.png` — tree line silhouette
- `clouds.png` — cloud layer
- `desert_a.png`, `desert_b.png` — desert variants

### UI Elements

From the Rocky Roads `UI/` folder:
- `hearts.png`, `healthbar.png` — health display
- `coin.png`, `gem.png` — HUD counters
- `buttons.png` — button sprites
- `ui.png` — panel frames
- `arrow.png` — directional indicators

### Player Character

- **Not included in Rocky Roads pack** — need a separate character sprite
- TBD: Find a matching-style character on itch.io, or commission one
- Placeholder: simple colored rectangle or basic sprite during development
- Simple moveset: run, jump, wall-slide (maybe), no attack in v1
- Customizable via paid cosmetics (see Monetization)

---

## Room Goals

Each room can optionally have a goal set by the creator. Goal infrastructure is built into the data model from day one, even if the goal types are limited at launch.

### v1 Goal Types

- **Reach the Star** — a star/collectible placed somewhere in the room. Reaching it = completion
- **Reach the Exit** — designated exit point, reaching it = completion
- **Time Trial** — reach the star/exit as fast as possible. Time recorded on leaderboard

### Future Goal Types

- Collect all coins
- Defeat all enemies
- Puzzle (activate switches in order)
- Survive for X seconds

### Leaderboards

- **Per-room:** Fastest completion time, number of completions
- **Global:** Most rooms completed, most rooms built, most stars collected, fastest average clear time
- **Creator:** Most played rooms, highest-rated rooms, total plays

---

## Multiplayer

### v1: Cooperative Ghosts

- All players share the world in real-time via PartyKit
- You see other players as semi-transparent sprites running and jumping
- No player-to-player collision, no damage, no direct interaction
- Presence is the feature — seeing a dozen tiny characters bouncing through a room feels alive
- Player count per room displayed subtly
- Name tags visible above characters

### v2+: Interaction (Future)

- Emotes / gestures
- Simple chat (speech bubbles)
- Collaborative switches (require 2+ players)
- Optional PvP zones (rooms flagged as arenas by creator)
- Racing (ghost comparison on time trials)

---

## Camera & Navigation

### Camera Modes

- **Free-cam (default):** Pan by dragging, zoom with scroll wheel. Works in both editor and play mode. Player character stays in the world but camera is independent
- **Follow-cam (toggle):** Camera locks to player character, room-by-room transitions (Celeste-style). Snaps to the current room's bounds

### Navigation

- **Minimap:** Persistent in corner. Shows room grid topology, your position, other players. Click to teleport
- **Coordinate input:** Type or click coordinates (e.g., `12,-3`) to jump directly to a room
- **Random room:** "Take me somewhere" button for exploration
- **Spawn point:** Player chooses where to spawn:
  - Central hub (default)
  - Their own room
  - Specific coordinates
  - Random

---

## Tech Stack

### Frontend

- **Game Engine:** Phaser 3 (WebGL renderer with Canvas fallback)
  - Native Tiled JSON tilemap support — aligns with our data format
  - Arcade Physics for platformer mechanics (gravity, velocity, tilemap collision)
  - Camera system with follow, zoom, bounds — supports free-cam/follow-cam toggle
  - Spritesheet animation — all Rocky Roads assets are animation strips
  - Sprite batching and texture atlas support for performance
- **Editor:** Custom-built tile editor using Phaser scene + HTML/CSS sidebar overlay
- **Build Tool:** Vite (fast dev server, optimized production builds)
- **Language:** TypeScript
- **Hosting:** Cloudflare Workers static assets + Cloudflare D1 (current). Cloudflare Pages is still optional if the frontend and API are separated later

### Backend

- **API:** Cloudflare Workers (handles auth, room CRUD, leaderboards)
- **Database:** Cloudflare D1 (SQLite — room metadata, user accounts, leaderboard entries, moderation flags)
- **Object Storage:** Cloudflare R2 (tileset images, room snapshots/thumbnails)
- **Real-time:** PartyKit (multiplayer presence, live position broadcasting, editor collaboration)

### Blockchain (Base)

- **Contract:** ERC-721 for room NFTs
- **Onchain data:** Tile layout stored fully onchain as packed bytes. `tokenURI` returns a `data:application/json` URI assembled from the onchain data into Tiled JSON format
- **Minting:** Optional action from the editor. Writes current room layout to contract, creates NFT
- **Post-mint edits:** Onchain transaction writes updated layout to token storage. Edits are batched in the editor (draft mode), then published as a single transaction
- **Network:** Base L2 (low gas costs make onchain tile data viable — rooms are ~5–7KB packed)
- **Wallet:** Optional wallet connection via standard connector (wagmi/viem). Only needed for minting/editing minted rooms

### API-First Architecture

All game actions are API-driven. The frontend is one client among many. This enables:

- **Agent builders:** AI agents can create rooms via the same API the editor uses
- **Agent players:** AI agents can connect via WebSocket and play the game
- **Third-party tools:** Anyone can build alternative editors, bots, visualizations
- No special agent system needed — agents are just another API client with auth tokens

---

## Authentication

### Primary: Email Magic Link

- User enters email, receives a login link
- Simple, accessible, no password to remember
- Account created on first login

### Secondary: Wallet Connect (Optional)

- Connect a wallet (MetaMask, Coinbase Wallet, etc.) to an existing account
- Required only for minting/buying/selling rooms
- Never required for core gameplay

### Anonymous / Pre-Auth

- Users can explore and play without any account
- Users can start building without any account
- After ~20 tiles placed, prompt to sign up (email) to save progress
- All pre-auth work is preserved in local storage and synced to account on signup

---

## Monetization

### Primary: Avatar Customization

- Everyone gets a generic default character for free
- Paid cosmetics:
  - **Character skins:** Knight, robot, cat, wizard, alien, etc.
  - **Color palettes / palette swaps** (cheapest tier)
  - **Hats & accessories:** Top hat, crown, sunglasses, wings, etc.
  - **Trails & effects:** Particle effects on run/jump (sparkles, fire, etc.)
- Cosmetics are purely visual — no gameplay advantage

### Secondary: NFT Room Trading

- Secondary sales royalties on room NFTs (2.5–5%)
- Minting fee (small, covers gas + platform margin)

### Future Monetization Options (Not for v1)

- Premium tilesets
- Extra room claims (if daily limits are introduced)
- Custom tileset uploads (paid feature)
- Sponsored/branded rooms

---

## Moderation

### Approach: Permissive with Guardrails

- No pre-approval queue — rooms go live immediately on publish
- **Flagging system:** Any user can flag a room for review
- **Flag categories:** Offensive content, spam, broken/unplayable, copyright
- Flagged rooms are reviewed (manually at first, automated later if scale demands it)
- Consequences: Room hidden, creator warned, repeat offenders banned
- Minted rooms: Cannot be deleted from chain, but can be hidden from the game's frontend
- Community moderators appointed if the game grows

---

## Data Model (Conceptual)

### Room

```
{
  id: string,
  coordinates: { x: number, y: number },
  creator_id: string,
  layers: {
    background: number[],   // tile indices, length = width * height
    terrain: number[],
    objects: Object[],       // positioned entities with properties
    foreground: number[]
  },
  goal: {
    type: "star" | "exit" | "time_trial",
    config: {}               // goal-specific params
  },
  version: number,
  versions: Version[],       // full history
  is_minted: boolean,
  nft_token_id: number | null,
  status: "draft" | "published" | "flagged" | "hidden",
  created_at: timestamp,
  updated_at: timestamp
}
```

### User

```
{
  id: string,
  email: string | null,
  wallet_address: string | null,
  display_name: string,
  avatar: {
    character: string,
    accessories: string[],
    trail: string | null
  },
  rooms_created: number,
  rooms_completed: number,
  created_at: timestamp
}
```

### Leaderboard Entry

```
{
  room_id: string,
  user_id: string,
  completion_time_ms: number | null,
  completed_at: timestamp
}
```

---

## Roadmap

### Next Milestone — World Shell

- [ ] Add multi-room load-by-coordinate in the client and API
- [ ] Add a room index / metadata query that returns occupied and frontier coordinates
- [ ] Add simple room-to-room traversal at world edges
- [ ] Add a lightweight world map UI for navigating claimed/frontier rooms
- [ ] Add a minimal claim flow for frontier rooms before layering on auth and permanence
- [ ] Keep room data/editor semantics stable while the world shell is added

This is the right bridge between the current single-room prototype and the eventual “endless collaborative world.”

### v1 — MVP

- [ ] Browser-based tile editor with core tools (single tile, rectangle fill, eraser, flood fill, tile picker)
- [x] Single-room draft save / load / publish / version history
- [ ] One cohesive tileset: Grasslands + Underground + Castle + Sky themes
- [ ] Room grid system with coordinate addressing and frontier expansion
- [ ] Playable platformer character (run, jump)
- [ ] Room publishing and version history
- [ ] Multiplayer ghost presence via PartyKit
- [ ] Free-cam with zoom + follow-cam toggle
- [ ] Minimap and coordinate navigation
- [ ] Email magic link authentication
- [ ] Anonymous editing with signup prompt at ~20 tiles
- [ ] Basic game objects: coins, spikes, springs, walking enemies
- [ ] Room goals: reach the star, reach the exit
- [ ] Per-room and global leaderboards
- [x] Cloudflare deployment (Workers static assets + D1; R2 not needed yet)
- [ ] Responsive — works on desktop browsers (mobile is stretch)

### v1.5

- [ ] Moderation: flagging system, admin review panel
- [ ] Select/move tool in editor
- [ ] More game objects: moving platforms, switches, doors, signs
- [ ] Time trial goal type with leaderboards
- [ ] Room rating / favoriting
- [ ] Edit-while-occupied (draft layer, publish updates live)
- [ ] Creator profiles

### v2

- [ ] Avatar customization store (monetization)
- [ ] Wallet connect + room minting on Base
- [ ] Onchain tile data in Tiled JSON format via tokenURI
- [ ] Post-mint edit flow (onchain transactions)
- [ ] Secondary market for room NFTs
- [ ] Version history for minted rooms (onchain)
- [ ] More tilesets / themes

### v3+

- [ ] PvP zones / arena rooms
- [ ] Agent API documentation and developer portal
- [ ] Collaborative game objects (multi-player switches)
- [ ] Custom tileset uploads
- [ ] Emotes, chat, social features
- [ ] Mobile support
- [ ] Room templates / prefabs
- [ ] World events (collaborative build challenges)

---

## Open Questions

- ~~Exact room dimensions~~ **DECIDED: 40x22 tiles**
- ~~Specific tileset choice~~ **DECIDED: Rocky Roads asset pack from itch.io** — 6 themes, consistent style
- How room-to-room transitions work when edge terrain doesn't align (hard cut? fade? doorway?)
- Goal reward system — what do you get for completing a room's goal besides leaderboard placement?
- Should there be a world-level metagame (total stars collected unlocks something)?
- Room reclamation — what happens to unminted rooms whose creators go inactive?
- Rate limiting for room claims (even without daily limits, need anti-spam measures)
- ~~Physics engine choice~~ **DECIDED: Phaser 3 Arcade Physics** — simple, fast, purpose-built for 2D platformers
- Player character sprite — need to source a character that matches Rocky Roads art style
