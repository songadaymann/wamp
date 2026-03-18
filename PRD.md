# Everybody's Platformer — Product Requirements Document

## Vision

A massively collaborative, ever-expanding online platformer where every room is built by a different person. Think Million Dollar Homepage meets Mario Maker — except the whole world is one continuous, playable game that anyone can add to.

Players claim rooms on an infinite grid, lay down tiles using a browser-based editor, and publish playable platformer scenes that connect to their neighbors. The world grows organically from a central seed, one room at a time. Mint your room as an NFT on Base to lock ownership and make your creation permanent.

---

## Current Product State (March 18, 2026)

- The repo is now a real **shared-world vertical slice**, not a single-room editor prototype.
- Working today:
  - coordinate-addressed overworld browse/play with published, draft, frontier, and empty room states
  - room-to-room traversal, free-cam browse, follow-cam play, coordinate jump, fit-to-world, first-load splash/busy overlays, and chunked room streaming/LOD
  - editor authoring for tiles, placed objects, parallax backgrounds, room titles, spawn markers, goals, undo/redo, test play, and version history
  - current gameplay loop with a sprite-based player, ladders, crouch/crawl, crate push/pull, sword slash, gun shot, collectibles, hazards, and the first enemy set
  - single-room **draft save / load / publish / revert / mint-gated permissions** on **Cloudflare Workers + D1**
  - authored `course` drafts and published 2-4 room course runs, with marker editing routed through the room editor, browse-mode course badges, and course leaderboard support
  - version-scoped room runs, per-room leaderboards, and a global **points/stats** leaderboard
  - room difficulty voting plus a published-room `Discover` flow keyed by difficulty
  - email auth, linked-wallet auth, session cookies, and bearer API tokens
  - PartyKit ghost presence with chunk subscriptions, room populations, and name tags
  - ERC-721 room ownership contract workspace plus mint prepare/confirm flow
  - live world chat backed by Worker + D1, plus owner/delegated chat moderation for delete/ban/admin actions
  - agent accounts with scoped tokens, claimable frontier discovery, and public `skill.md` / `openapi.json` surfaces
  - landscape-first mobile/touch support for browse, play, editor, chat, auth, leaderboard, and mint flows
  - goal badges in browse mode and in-room challenge panel/timer presentation during play
- The live frontend is `https://wamp.land`, the public API is `https://api.wamp.land`, and the raw Worker endpoint is `https://everybodys-platformer.novox-robot.workers.dev`.
- The biggest gaps versus the full PRD are now:
  - minimap / topology navigation and better large-world browse UX
  - a true anonymous-to-account save/sync flow with an inline signup prompt
  - broader mobile/touch tuning and tablet/phone layout polish
  - course authoring polish, stronger course discovery/curation, authoritative PvP, and the broader challenge platform
  - live migration to the hardened claimer-signed mint contract plus clearer in-world ownership/minted-room UX
  - money-backed challenge settlement, anti-cheat, and broader operator/report/review tooling beyond chat moderation
  - creator identity/profile UX, ratings/favorites, and richer social systems

### Recommendation

The next milestone should be **hardening the shared-world shell**, not adding a second major system on top of shaky foundations.

That means:

1. Add minimap/world-navigation polish on top of the current coordinate jump flow.
2. Clarify frontier / claim / minted ownership states directly in the world UI.
3. Tune the shipped mobile/touch foundation and improve zoomed-out browse performance.
4. Keep room-level goals and runs stable while hardening the newly shipped authored `course` system.

So yes: the world shell now exists. The next step is making it durable, legible, and scalable before layering on bigger creator systems.

---

## Core Concepts

### The World

- An infinite 2D grid of **rooms** (chunks/scenes)
- Each room is a self-contained platformer scene: platforms, hazards, enemies, collectibles, decorations
- Rooms connect at their edges — walk off the right side of one room, enter the left side of the next
- Frontier rooms are the intended and enforced expansion path for new room claims
- Every room has a coordinate address (e.g., `12,-3`) for navigation and sharing

### Rooms

- **Size:** 40x22 tiles at 16x16 pixels (640x352 px native, rendered at 2x–3x)
- **Current room data shape:** 3 tile layers plus a placed-object list:
  - Background tile layer (non-collidable)
  - Terrain tile layer (collidable)
  - Foreground tile layer (non-collidable overlay)
  - Placed objects array for enemies, hazards, collectibles, ladders, crates, spawn markers, and goal markers
- **Backgrounds:** Parallax/background selection is stored per room, but it is not a tile layer
- **Boundaries:** Thick visual borders between rooms with openings at connection points. Coordinates and room title are surfaced in the HUD; claimer ownership is clearer in editor/history than in the overworld itself
- **Edge behavior:** Freeform — no requirement to match floor heights or terrain at boundaries. Discontinuities are part of the charm. Edge compatibility is a possible future feature

### Tile Format

- 16x16 pixel tiles
- Tileset stored as spritesheets with index-based references
- Room data stored today as custom room snapshots: coordinates, title, background id, goal, spawn point, tile arrays, placed objects, and version metadata
- **Current storage/export format is not Tiled JSON yet**
- Portable room export and minted `tokenURI`/Tiled-style artifacts are still future work

---

## User Flows

### Onboarding (Zero Friction)

1. User lands on the site and enters the world browse/play shell
2. They can immediately zoom, jump to coordinates, inspect rooms, and play published rooms with no account
3. They can inspect rooms freely and click a frontier room to open the editor immediately
4. Guest editing works today, with local draft persistence as the fallback when remote save/publish is auth-gated
5. Publishing as a guest prompts sign-in, but the planned `~20 tiles` signup prompt and automatic local-to-account sync are **not shipped yet**
6. Email auth unlocks durable remote publish, ranked runs, chat posting, API tokens, and mint preparation
7. Wallet connection is optional and only needed for wallet-linked auth or minting

### Building

1. User selects a frontier room and opens the editor
2. Editor opens with tile tools, object placement, background selection, room title, goal controls, and layer controls
3. User builds the room with terrain, placed objects, decorations, spawn markers, and goals
4. User can **test play** the room at any time
5. The first authenticated publish claims the room; a Worker-side daily cap currently limits how many new rooms an account can claim per UTC day
6. Publish creates a new live room version and keeps the draft layer editable
7. User can keep iterating after publish; history and revert stay available, and minted rooms switch to token-owner-only writes

### Playing

1. Player enters play mode from the selected room and spawns at the authored spawn marker or a surface-scan fallback
2. Player can run, jump, climb ladders, crouch/crawl, push/pull crates, use sword/gun attacks, and traverse between rooms
3. Other players are visible as ghosts with name tags and per-room population counts; there is no collision or gameplay interaction yet
4. Camera defaults to free-cam browse, with a **follow-cam toggle** for room-by-room play
5. Coordinate jump navigation and fit-to-world are live. Minimap and random-room exploration are still future work
6. Room goals, version-scoped runs, per-room leaderboards, and the global points leaderboard are live
7. World chat is live for signed-in posting and public read-only viewing

### Editing Other Rooms

- **Pre-mint rooms:** Anyone can edit. Creator can revert to any previous version. Full version history stored
- **Post-mint rooms (current):** Only the NFT holder can edit. Ownership is enforced from chain, but room content still publishes through the Worker/D1 flow
- **Post-mint rooms (future upgrade):** Optional onchain room-data writes could replace or augment the current off-chain content flow
- Editing happens in a draft layer; changes go live on publish. Minted-room content permanence beyond ownership is still a later decision

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
| **Object Placer** | Place enemies, springs, collectibles, etc. with property controls |
| **Spawn / Goal Authoring** | Place the player spawn, exit, checkpoints, finish marker, and goal settings |

Not yet shipped:
- Tile picker / eyedropper
- Select/move region editing

### Interface

- **Left sidebar:** Tools, layers, tileset/object palette, background select, room title, goal controls, and editor actions
- **Bottom/world HUD:** Coordinates, selected room title/state, jump-to-room input, build/edit/play buttons, leaderboard, controls, save status, online counts, and zoom controls
- **Canvas:** The room grid/world, rendered via Phaser 3 (WebGL). Scroll to zoom; middle-click or space-drag pans
- **Layer visibility:** Toggle layers on/off for easier editing. Active layer highlighted

### Rendering

- Canvas/WebGL — not DOM-based
- Smooth zoom from room-level to world overview
- World rendering uses chunk streaming plus near/mid/far preview budgets rather than loading the whole world at once
- Tile rendering uses spritesheet atlases and room snapshot textures for previews

---

## Tileset & Art

### Current Integrated Art

- Rocky Roads tilesets are integrated for all six current themes:
  - Forest
  - Desert
  - Dirt
  - Lava
  - Snow
  - Water
- Additional parallax background sets are wired and selectable:
  - Forest
  - Dark Forest
  - Grassland
  - Mountains
  - Meadow
  - Aurora
  - Cave

### Runtime-Backed Objects

- Collectibles:
  - gold coin
  - silver coin
  - gem
  - heart
  - key
  - apple
  - banana
- Movement / interaction:
  - bounce pad
  - ladder
  - crate
  - authored spawn marker
  - goal flag/checkpoint markers
- Hazards:
  - spikes
  - saw
  - fire
  - fireball
  - wood stakes
  - cannon + bullet
  - cactus
  - tornado
- Enemies:
  - blue slime
  - red slime
  - bat
  - crab
  - bird
  - fish
  - frog
  - snake
  - penguin
- Decorations:
  - signs and arrow signs
  - bush / rock
  - tree variants
  - clouds
  - sun

### Not Yet Wired From The Asset Pool

- Buttons, locks, treasure chests, cloud platforms, moving platforms, doors, readable sign text, and several unused enemies/hazards are still backlog items even where raw art exists

### FX + Audio

- Visual FX are wired for movement, bounce pads, pickups, combat hits, bullet impacts, explosions, goal events, and general juice
- SFX are wired for movement, combat, pickups, goals, UI interactions, respawn, and chat

### Player Character

- A default sprite atlas is integrated; the player is no longer a placeholder block
- Current animation set:
  - idle
  - run
  - jump rise / jump fall / land
  - ladder climb
  - crouch / crawl
  - push / pull
  - sword slash / downward air slash / gun fire
- Current play moveset:
  - run
  - jump
  - ladder climb
  - crouch / crawl
  - crate push / pull
  - sword attack
  - gun attack
- Avatar customization is still future work

---

## Room Goals

Each room can optionally have a goal set by the creator. Goal infrastructure is built into the data model from day one, even if the goal types are limited at launch.

### v1 Goal Types

- **Reach the Exit** — designated exit point, reaching it = completion
- **Collect Target** — collect the configured number of collectibles in the room
- **Defeat All** — defeat all enemies in the room
- **Checkpoint Sprint** — hit ordered checkpoints, then reach the finish marker
- **Survival** — stay alive for the configured duration

### Future Goal Types

- Puzzle (activate switches in order)
- Escort / carry objective
- Secret-route discovery
- Creator-authored boss or event clear

### Leaderboards

- **Per-room:** Version-scoped room leaderboards. Ranking mode depends on the goal type:
  - time-first for `reach_exit`, `checkpoint_sprint`, `collect_target`, and `defeat_all`
  - score-first for `survival`
- **Global:** Aggregate player stats across submitted runs, with **points** currently acting as the primary world ranking
- **Creator:** Still future work — most played rooms, highest-rated rooms, total plays

## Challenge Platform

Cross-room challenges, PvP, and crypto stakes should be treated as one future program layered on top of the current room/version/run stack, not as isolated features.

### Summary

- **Cross-room challenges** become the new authored `course` system
- **PvP** becomes an opt-in, server-authoritative challenge mode that can run across authored room areas
- **Crypto stakes** only sit on top of authoritative challenge/match results
- Existing single-room goals/runs remain the live baseline and are not replaced immediately

### Challenge Classes

- **Course Challenges**
  - single-owner only
  - built from an explicit, version-locked path of room versions
  - creator authors start, checkpoints, finish, traversal order, and rules
  - first implementation is solo only
  - these evolve naturally from the current room-goal / room-run model
- **PvP Challenge Modes**
  - opt-in participation inside the shared world
  - non-opted players remain non-targetable and stay on the normal browse/presence path
  - PvP takes place inside published challenge areas built from version-locked room paths
  - baseline modes:
    - duel / melee
    - last man standing
  - follow-on modes:
    - capture the flag
    - balloon hunt / hide-and-seek
  - PvP uses a real hearts-based health system
- **Stake-Backed Challenges**
  - creator-funded bounty model is the default
  - creator deposits a challenge stake pool
  - player pays entry fee per run/match
  - verified clear/win pays the player from the creator pool plus the configured return/split of entry
  - verified fail/loss routes player entry back toward creator-side economics minus protocol fee
  - every money-backed run/match settles onchain directly once the authoritative result is finalized

### Authority & Anti-Cheat

- Current client-authoritative gameplay is acceptable for casual play and existing leaderboards
- PvP and money-backed challenges are **not** allowed on the current trust model
- Any PvP or stake-backed challenge must run on a **server-authoritative match/challenge server**
- The authoritative server owns:
  - player inputs
  - movement/combat resolution
  - health/damage
  - item/flag state
  - timer/result state
  - canonical match result
- The authoritative server writes canonical result state offchain and produces a signed settlement result for onchain payout
- The contract does **not** read raw Worker/D1 state directly; it verifies an operator-signed settlement payload
- PartyKit ghost presence stays on the current peaceful path; authoritative PvP/stake matches get their own shard/server layer

### Economics

- **Creator bounty escrow**
  - creator sets:
    - challenge stake pool
    - player entry fee
    - success payout
    - optional max winners / stop conditions
    - protocol fee bps
  - challenge only stays open while solvent
  - failed runs replenish creator-side economics
  - successful runs deplete creator pool
- **PvP mode payouts**
  - winner or winning team gets player-side pot plus any configured creator bonus
- **Required operator controls**
  - challenge pause
  - vault shutdown
  - signer rotation
  - settlement replay protection
  - timeout / refund path if a match cannot be settled

### How This Fits The Current Implementation

- Reuse the existing room version model to version-lock course room paths
- Keep current room-goal play as the single-room casual baseline
- Add a new challenge domain parallel to rooms/runs instead of overloading the current room schema
- Do **not** retrofit PvP onto the current client-side combat loop
- Add a separate authoritative match mode where the client becomes:
  - input sender
  - state renderer
  - prediction/interpolation layer only
- Keep browse ghosts on the current PartyKit presence stack
- Add a new authoritative match/challenge shard/server for PvP and stake-backed modes
- Keep the existing `RoomOwnershipToken` contract separate; add challenge vault/settlement contracts instead of overloading room NFTs

### Planned Public Surfaces

- **Challenge authoring/read**
  - `POST /api/challenges`
  - `GET /api/challenges/:id`
  - `POST /api/challenges/:id/publish`
- **Challenge runs**
  - `POST /api/challenges/:id/runs/start`
  - `POST /api/challenge-runs/:attemptId/finish`
  - `GET /api/leaderboards/challenges/:id`
- **Match allocation**
  - `POST /api/matches`
  - `GET /api/matches/:id`
- **Stake flows**
  - `POST /api/challenges/:id/stake/prepare`
  - `POST /api/challenges/:id/entry/prepare`
  - `POST /api/matches/:id/settlement/prepare`
- Current room APIs stay as-is
- Challenge APIs are a new parallel surface
- Money-backed flows require authenticated, wallet-linked users

### Delivery / Acceptance Criteria

- **Cross-room courses**
  - author can publish a challenge that references only owned room versions
  - challenge traversal respects ordered room path, checkpoints, and finish rules
  - challenge stays stable if underlying rooms later change, because referenced versions are locked
  - challenge leaderboard stays separate from room leaderboards
  - updating a challenge creates a new challenge version without corrupting prior results
- **PvP**
  - non-opted players cannot damage or be damaged
  - opted players move onto authoritative match state
  - hearts, damage, death, respawn, and win conditions are server-resolved
  - duel and last-man-standing complete correctly under disconnect, reconnect, and timeout scenarios
  - peaceful overworld presence continues working outside active matches
- **Stakes / anti-cheat**
  - creator can fund a challenge vault
  - player can enter only if the vault is solvent and the challenge version is active
  - successful clear/win settles onchain once and only once
  - failed run/loss settles creator-side economics correctly
  - duplicate settlement, stale signer, stale nonce, and wrong payout all fail
  - match cancellation / server failure resolves via deterministic refund or cancellation paths
  - canonical offchain result is stored before any settlement signature is issued
- **Security / economics**
  - contract replay protection works
  - signer rotation and challenge pause exist
  - vault insolvency is blocked
  - fee accounting is correct
  - creator cannot change economic terms for an active funded challenge version
  - one wallet cannot have multiple concurrent money-backed attempts in the same challenge version by default

### Assumptions & Defaults

- Cross-room challenges are single-owner only
- Challenge layout is an explicit, version-locked room path
- PvP is opt-in inside the shared world; non-participants remain peaceful
- PvP and advanced challenge modes use hearts-based health
- PvP and money-backed modes are server-authoritative
- Staking uses creator bounty escrow
- Settlement is direct per-match onchain
- The intended product direction is broad launch, but implementation still requires operator kill switches, signer controls, and pause paths
- Existing single-room goals/runs remain the live baseline until challenge runtime ships
- Existing room NFT ownership remains separate from challenge/staking contracts

---

## Multiplayer

### v1: Cooperative Ghosts

- All players share the world in real-time via PartyKit
- You see other players as semi-transparent sprites running and jumping
- No player-to-player collision, no damage, no direct interaction
- Presence is the feature — seeing a dozen tiny characters bouncing through a room feels alive
- Player count per room displayed subtly
- Name tags visible above characters
- Global world chat exists today, but it is text-only UI chat, not in-world speech bubbles

### v2+: Interaction (Future)

- Emotes / gestures
- In-world speech bubbles / spatial chat
- Collaborative switches (require 2+ players)
- Opt-in authoritative PvP challenge modes layered onto authored room areas
- Racing (ghost comparison on time trials)
- Team modes like capture the flag and balloon hunt once the authoritative challenge stack exists

---

## Camera & Navigation

### Camera Modes

- **Free-cam (default):** Pan by dragging, zoom with scroll wheel. Works in both editor and play mode. Player character stays in the world but camera is independent
- **Follow-cam (toggle):** Camera locks to player character, room-by-room transitions (Celeste-style). Snaps to the current room's bounds

### Navigation

- **Minimap (planned):** Persistent in corner. Shows room grid topology, your position, other players. Click to teleport
- **Coordinate input:** Type or click coordinates (e.g., `12,-3`) to jump directly to a room
- **Fit to world:** Existing shortcut/button to frame the currently loaded world window
- **Random room:** "Take me somewhere" button for exploration is still future work
- **Current spawn behavior:** The active room's authored spawn marker is used when present, with a terrain-scan fallback when it is not
- **Future spawn UX:** central hub / own room / random spawn selection can still be layered on later

---

## Tech Stack

### Frontend

- **Game Engine:** Phaser 3 (WebGL renderer with Canvas fallback)
  - Current room format is custom snapshot JSON, not Tiled JSON
  - Arcade Physics for platformer mechanics (gravity, velocity, tilemap collision)
  - Camera system with follow, zoom, bounds — supports free-cam/follow-cam toggle
  - Spritesheet / atlas animation for the player, enemies, FX, and pickups
  - Room-preview texture generation plus chunked world streaming for performance
- **Editor:** Custom-built tile editor using Phaser scene + HTML/CSS sidebar overlay
- **Build Tool:** Vite (fast dev server, optimized production builds)
- **Language:** TypeScript
- **Hosting:** Cloudflare Workers static assets + Cloudflare D1 (current). Cloudflare Pages is still optional if the frontend and API are separated later

### Backend

- **API:** Cloudflare Workers (handles auth, rooms, world reads, runs, leaderboards, chat, and mint helpers)
- **Database:** Cloudflare D1 (SQLite — room metadata, versions, users, sessions, API tokens, runs, stats, points, and chat messages)
- **Object Storage:** Cloudflare R2 is still optional / not required yet
- **Real-time:** PartyKit presence only. Persistence stays in Worker + D1; editor collaboration is not implemented

### Planned Competitive Extension

- **Challenge domain:** New Worker + D1 domain parallel to rooms/runs for challenge definitions, versions, leaderboards, match records, and stake state
- **Authoritative runtime:** Separate authoritative match/challenge server layer for PvP and money-backed modes
- **Presence split:** Current PartyKit shard presence remains for peaceful overworld play; competitive modes use dedicated match shards/rooms
- **Current rule:** If a mode is PvP or money-backed, it must not rely on the current client-authoritative scene logic for canonical results

### Blockchain (Base)

- **Contract:** ERC-721 for room NFTs
- **Current onchain scope:** Ownership only. Room content still lives in D1
- **Minting:** Optional action from the editor. Current flow is `prepare` -> wallet transaction -> `confirm`, then edit rights lock to the current token holder
- **Post-mint edits (current):** Token-owner-gated writes still go through the Worker/D1 flow
- **Future blockchain upgrade:** optional fully onchain room-content storage / `tokenURI` export remains a later milestone
- **Network target:** Base Sepolia first, then production Base deployment once the flow is hardened
- **Wallet:** Optional wallet connection via standard connector. Only needed for minting/editing minted rooms

### Planned Challenge Contracts

- Keep room ownership separate from challenge economics
- Add challenge-specific contracts rather than overloading `RoomOwnershipToken`
- Required future contracts:
  - `ChallengeEscrow` / `ChallengeVault`
    - creator deposits bounty
    - player escrows entry fee
    - challenge solvency is tracked onchain
  - `ChallengeSettlement`
    - verifies operator EIP-712 settlement signatures
    - enforces one-time settlement per match/run
    - releases payout directly onchain per verified result
- Direct-onchain settlement default:
  - every money-backed run/match ends with a settlement transaction
  - settlement can be submitted by relayer or claimant
  - contract verifies:
    - challenge version id
    - match/run id
    - participant
    - outcome
    - payout amount
    - nonce / replay guard
    - authorized signer

### API-First Architecture

All game actions are API-driven. The frontend is one client among many. This enables:

- **Agent builders:** AI agents can create rooms via the same API the editor uses
- **Agent players:** AI agents can inspect rooms, submit runs, and interact through the same HTTP APIs; richer real-time agent play remains future work
- **Third-party tools:** Anyone can build alternative editors, bots, visualizations
- The app already publishes `skill.md` and `openapi.json` from the same origin for bot/tool access
- Current public API docs cover auth, rooms, runs, leaderboards, tokens, and minting. Chat exists in the backend/UI but is not yet called out in the public OpenAPI
- No special agent system needed — agents are just another API client with auth tokens

---

## Authentication

### Primary: Email Magic Link

- User enters email, receives a login link
- Simple, accessible, no password to remember
- Account created on first login

### Secondary: Wallet Connect (Optional)

- Connect a wallet (MetaMask, Coinbase Wallet, etc.) to an existing account
- Required today for wallet-linked auth and minting/editing minted rooms
- Never required for core gameplay

### Anonymous / Pre-Auth

- Users can explore and play without any account
- Users can start building without any account
- Current behavior: guest building works, local draft recovery exists, but durable remote save/publish, ranked leaderboard submission, and chat posting require auth
- The future signup prompt at ~20 tiles plus automatic local-to-account sync is still outstanding

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
- Extra room claims / higher claim caps
- Custom tileset uploads (paid feature)
- Sponsored/branded rooms

---

## Moderation

### Approach: Permissive with Guardrails

Current state: chat moderation is now live for owner/delegated admins, including message deletion plus chat ban/unban controls. There is still no public room-flagging flow, review UI, or full moderation system for the broader product.

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
  title: string | null,
  background: string,
  goal: RoomGoal | null,
  spawnPoint: { x: number, y: number } | null,
  tileData: {
    background: number[][],
    terrain: number[][],
    foreground: number[][]
  },
  placedObjects: PlacedObject[],
  version: number,
  status: "draft" | "published",
  createdAt: timestamp,
  updatedAt: timestamp,
  publishedAt: timestamp | null,
  claimerUserId: string | null,
  claimerDisplayName: string | null,
  claimedAt: timestamp | null,
  mintedChainId: number | null,
  mintedContractAddress: string | null,
  mintedTokenId: string | null,
  mintedOwnerWalletAddress: string | null,
  mintedOwnerSyncedAt: timestamp | null
}
```

Current persistence shape around that snapshot:

```
{
  draft: RoomSnapshot,
  published: RoomSnapshot | null,
  versions: RoomVersionRecord[],
  permissions: {
    canSaveDraft: boolean,
    canPublish: boolean,
    canRevert: boolean,
    canMint: boolean
  }
}
```

### User

```
{
  id: string,
  email: string | null,
  walletAddress: string | null,
  displayName: string,
  createdAt: timestamp
}
```

### Leaderboard Entry

```
{
  attempt_id: string,
  room_id: string,
  room_coordinates: { x: number, y: number },
  room_version: number,
  user_id: string,
  result: "completed" | "failed" | "abandoned",
  elapsed_ms: number | null,
  deaths: number,
  score: number,
  collectibles_collected: number,
  enemies_defeated: number,
  checkpoints_reached: number,
  finished_at: timestamp | null
}
```

### Global User Stats

```
{
  userId: string,
  userDisplayName: string,
  totalPoints: number,
  totalScore: number,
  totalRoomsPublished: number,
  completedRuns: number,
  failedRuns: number,
  abandonedRuns: number,
  bestScore: number,
  fastestClearMs: number | null,
  updatedAt: timestamp
}
```

### Challenge / Match / Stake

```
{
  ChallengeDefinition: {
    id: string,
    ownerUserId: string,
    title: string,
    description: string | null,
    kind: "course" | "pvp",
    status: "draft" | "published" | "paused" | "archived",
    latestVersion: number,
    createdAt: timestamp,
    updatedAt: timestamp
  },

  ChallengeVersion: {
    challengeId: string,
    version: number,
    mode: "solo_course" | "duel" | "last_man_standing" | "capture_the_flag" | "balloon_hunt",
    roomPath: ChallengeRoomRef[],
    checkpoints: ChallengeCheckpoint[],
    rules: object,
    stakeConfig: {
      enabled: boolean,
      creatorPoolAmount: string | null,
      playerEntryFee: string | null,
      successPayout: string | null,
      protocolFeeBps: number,
      maxWinners: number | null
    },
    fundedAt: timestamp | null,
    publishedAt: timestamp | null
  }
}
```

- `ChallengeRoomRef`: explicit `{ roomId, roomVersion, order }` reference for each room in a challenge path
- `ChallengeRun`: per-attempt record for a course challenge, parallel to current room runs
- `ChallengeLeaderboard`: version-scoped ranking for one challenge version
- `Match`: authoritative PvP instance bound to one challenge version/ruleset
- `MatchParticipant`: per-player team, hearts, eliminations, disconnect state, and result
- `StakeVault`: creator bounty pool and solvency state for one funded challenge version
- `StakeEntry`: player escrowed entry for one run/match attempt
- `SettlementVoucher`: operator-signed EIP-712 payload used for one-time onchain settlement
- Defaults:
  - challenges are owned by one creator account
  - challenges reference explicit `roomId + roomVersion`
  - updating a challenge creates a new challenge version
  - money-backed challenge versions are immutable once funded

---

## Roadmap

### Next Milestone — Shared-World Hardening

- [ ] Add a minimap / topology view that complements the current coordinate jump flow
- [ ] Surface claim / claimer / minted-owner status more clearly in the world UI
- [ ] Tune the shipped mobile controls, phone/tablet layout density, and touch-target polish
- [ ] Tune chunk streaming / LOD / presence breadth for larger worlds and zoomed-out browse
- [ ] Validate the shared-world loop against larger seeded worlds and more concurrent players
- [ ] Define `ChallengeDefinition` / `ChallengeVersion` foundations for version-locked courses without destabilizing the current room-run model

This is the right bridge between the current working overworld slice and the eventual “endless collaborative world.”

### Competitive Program — Courses, PvP, Stakes

- [ ] **Phase 1: Cross-Room Courses**
  - add challenge definitions, publish/read APIs, and versioned storage
  - ship version-locked room-path authoring for single-owner course challenges
  - add cross-room checkpoints, finish markers, and separate challenge leaderboards
  - keep current room goals/runs intact as the live solo baseline
- [ ] **Phase 2: Authoritative Combat**
  - add hearts/health, damage rules, deaths, and respawns for match play
  - add opt-in PvP participation inside authored challenge areas
  - add authoritative match shards/servers plus reconnect and timeout handling
  - ship duel / melee and last-man-standing
- [ ] **Phase 3: Onchain Stakes**
  - deploy `ChallengeVault` / `ChallengeEscrow` contracts
  - add creator funding, player entry, and solvency checks
  - add operator-signed settlement vouchers with replay protection
  - settle every money-backed run/match onchain with pause, shutdown, and refund paths
- [ ] **Phase 4: Mode Expansion**
  - add capture the flag
  - add balloon hunt / hide-and-seek
  - add team modes
  - add richer social, spectator, and progression surfaces

### v1 — MVP

- [x] Browser-based tile editor with single-tile, rectangle fill, flood fill, eraser, object placement, room title, background, spawn, and goal authoring
- [ ] Tile picker / eyedropper
- [x] Single-room draft save / load / publish / version history
- [x] Rocky Roads launch asset pack integrated
- [x] Room grid system with coordinate addressing, frontier/empty selection, and multi-room traversal
- [x] Playable platformer character with run, jump, ladder climb, crouch/crawl, crate push/pull, and sword/gun combat
- [x] Room publishing, revert flow, and version history
- [x] Multiplayer ghost presence via PartyKit
- [x] Free-cam with zoom + follow-cam toggle
- [ ] Minimap and broader world navigation polish
- [x] Coordinate jump navigation
- [x] Email magic link authentication
- [ ] Anonymous editing with signup prompt at ~20 tiles
- [x] Basic live game objects: collectibles, hazards, bounce pads, ladders, and the first enemy set
- [x] Room goals and runtime tracking
- [x] Per-room and global leaderboards
- [x] Global world chat
- [x] Room titles, publish points, and user stats
- [x] Bot-facing API docs (`skill.md`, `openapi.json`, bearer tokens)
- [x] ERC-721 room ownership contract workspace + mint prepare/confirm flow
- [x] Cloudflare deployment (Workers static assets + D1; R2 not needed yet)
- [x] Desktop browser support
- [x] Landscape-first mobile/touch foundation for world, play, editor, chat, auth, leaderboard, and mint

### v1.5

- [ ] Moderation: flagging system, admin review panel
- [ ] Select/move tool in editor
- [ ] More game objects: moving platforms, switches, doors, readable signs
- [ ] Better goal polish / balancing / creator affordances
- [ ] Challenge authoring UI polish that feeds the Phase 1 course system
- [ ] Room rating / favoriting
- [ ] Better in-world ownership/status UX for claimed vs minted rooms
- [ ] Creator profiles

### v2

- [ ] Avatar customization store (monetization)
- [x] Wallet connect + linked wallet auth
- [ ] Migrate live minting to the hardened claimer-signed contract with mutable price / withdraw / tokenURI controls
- [ ] Onchain tile data in Tiled JSON format via tokenURI
- [ ] Post-mint edit flow via onchain content transactions
- [ ] Secondary market for room NFTs
- [ ] Version history for minted rooms (onchain)
- [ ] More tilesets / themes

### v3+

- [ ] Opt-in authoritative PvP challenge modes and follow-on game types
- [ ] Agent developer portal / richer public docs
- [ ] Collaborative game objects (multi-player switches)
- [ ] Custom tileset uploads
- [ ] Emotes and richer social features
- [ ] Broader mobile polish / touch tuning beyond the current shipped foundation
- [ ] Room templates / prefabs
- [ ] World events (collaborative build challenges)

---

## Open Questions

- ~~Exact room dimensions~~ **DECIDED: 40x22 tiles**
- ~~Specific tileset choice~~ **DECIDED: Rocky Roads asset pack from itch.io** — 6 themes, consistent style
- How room-to-room transitions work when edge terrain doesn't align (hard cut? fade? doorway?)
- How should the current points economy evolve beyond room publishes and run results?
- What minimum replay / audit artifact should authoritative matches store to support anti-cheat review and settlement disputes?
- Should settlement submission default to platform-relayed transactions, claimant-submitted transactions, or both?
- How conservative should launch economics be for creator bounty defaults, fee bps, and max winners so the system is exciting without being trivially farmable?
- What disconnect / reconnect grace rules feel fair across duel, last-man-standing, and asynchronous course challenges?
- What jurisdictional controls or launch gating are required before real-money crypto stakes go live?
- Should there be a world-level metagame (total stars collected unlocks something)?
- Room reclamation — what happens to unminted rooms whose creators go inactive?
- How strict should the room-claim daily cap be, and should it vary by trust level or account age?
- ~~Physics engine choice~~ **DECIDED: Phaser 3 Arcade Physics** — simple, fast, purpose-built for 2D platformers
- ~~Player character sprite~~ **DECIDED: default player atlas is integrated**
