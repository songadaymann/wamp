# Asset Intake Rules

This doc turns the current PRD and runtime into concrete asset rules for two use cases:

1. finding more art packs to add now
2. defining the normalization target for future user-added assets

The important distinction is:

- hard constraints: what the game code expects today
- intake targets: what we should prefer even when the code is more permissive

## Baseline Constants

- Room size: `40 x 22` tiles
- Native room pixel size: `640 x 352`
- Tile size: `16 x 16`
- Terrain collision: every non-empty terrain tile is a full solid `16 x 16` block
- Background selection is stored as a string id
- Objects are stored as `{ id, x, y }` pixel placements
- Assets are only loaded if they are registered in code. Dropping a file into `public/assets/` does nothing by itself.

## Cross-Cutting Rules

### 1. Treat ids and layouts as permanent data contracts

Once an asset type is used by saved or published rooms, its id and layout become part of persisted room data.

- Tilesets:
  - append new entries to the end of `TILESETS`
  - never reorder existing tilesets
  - never change an existing tileset's tile order or tile count
- Backgrounds:
  - never rename or remove a `BackgroundGroup.id` that rooms already reference
- Objects:
  - never rename or remove an object `id` that rooms already reference
- Player skins:
  - same rule once alternate skins are persisted

### 2. PNG is the default format

- Use PNG for tilesets, backgrounds, objects, and player frames.
- Preserve transparency where needed.
- Avoid JPEG for anything with hard pixel edges or alpha.

### 3. Frame 0 must be a good default pose

Room snapshots and some previews only render the first frame of an object sheet. If frame `0` is blank or transitional, previews will look broken.

### 4. Prefer dimensions in 16 px increments

The engine can handle some non-`16` dimensions, but the content pipeline is cleaner when widths and heights stay on a `16` px grid.

- Preferred: `16`, `32`, `48`, `64`
- Allowed when justified: odd sizes like the current `34 x 34` saw

### 5. If the asset implies new gameplay, it is not "just art"

New art is easy. New behavior is code.

Examples that need gameplay work, not just asset registration:

- slopes
- one-way terrain tiles
- moving platforms
- switches and doors
- key/lock logic
- cannons, projectiles, bombs
- custom enemy AI
- accessory systems for player skins

## Tilesets

### Hard constraints

- Every tile must be `16 x 16`.
- The atlas image width and height must both be divisible by `16`.
- `columns = imageWidth / 16`
- `rows = imageHeight / 16`
- `tileCount = columns * rows`
- New tilesets must be appended, not inserted in the middle of the tileset list.
- Once a tileset is used, its internal tile order is frozen.

### Intake target

- Preferred atlas range: roughly `66` to `105` tiles per theme
- Existing working examples:
  - `176 x 96` = `11 x 6`
  - `192 x 96` = `12 x 6`
  - `240 x 112` = `15 x 7`
- Prefer themes that include:
  - solid fill tiles
  - top/side/bottom edges
  - inner and outer corners
  - a few decorative variants

### Design rule

Because terrain collision is full-block on every non-empty terrain tile, avoid tilesets that rely on:

- slope silhouettes
- half-height collision expectations
- one-way platform terrain art

Those visuals will lie to the player unless collision code changes too.

## Backgrounds

### Hard constraints

- A background is a named `BackgroundGroup`.
- Each group contains `0+` PNG layers.
- Each layer needs:
  - `key`
  - `path`
  - `width`
  - `height`
  - `scrollFactor`
- Layers are horizontally tiled and scaled by height, so the artwork must survive repetition.
- Do not rename or remove background ids after rooms use them.

### Intake target

- Preferred layer count: `3` to `8`
- Preferred aspect ratio: at least the room ratio, about `1.82:1`
- Best target: `16:9` or wider
- Preferred normalized sizes:
  - `960 x 480` for wide scenic layers
  - `576 x 324` is also known-good and matches most current groups
- Keep a consistent height across layers in the same group.
- Order layers from far to near.
- Keep `scrollFactor` in the current band of `0.0` to `0.6`.

### Practical rule

If a layer is too narrow after height-based scaling, the horizontal repeat seam becomes obvious. So when sourcing art, prefer wide panoramic layers over narrow vignettes.

## Objects

### Hard constraints

Every usable object must have a config entry with:

- `id`
- `category`
- `path`
- `frameWidth`
- `frameHeight`
- `frameCount`
- `fps`
- `bodyWidth`
- `bodyHeight`
- `behavior`
- `description`

The asset file must work as a Phaser spritesheet:

- sheet width divisible by `frameWidth`
- sheet height divisible by `frameHeight`
- frame `0` should be the default visible frame

Placement rules:

- objects are placed on the tile grid
- visual anchor is effectively bottom-center
- the asset should "stand" correctly when its feet or base sit on the bottom of a tile

Collision rules:

- decorative objects use `bodyWidth = 0` and `bodyHeight = 0`
- interactive or dangerous objects need explicit body dimensions
- big visual overhang is fine, but gameplay still follows the configured body

### Preferred size buckets

These are the current usable buckets and should be the default search targets:

- `16 x 16`: pickups, spikes, rocks, small hazards
- `16 x 32`: slimes, signs, bounce pads
- `16 x 64`: ladders
- `32 x 16`: short decorative strips or bushes
- `32 x 32`: crates, flags, birds, frogs, medium hazards
- `32 x 48`: tall enemies
- `48 x 48`: trees and large decorations
- `48 x 64`: tall decorations

Try to keep new functional objects at `64 px` or less on either axis unless they are pure decoration.

### Behavior rules today

Generic category behavior already works for:

- `collectible`
- `hazard`
- `platform`
- `decoration`

A brand-new `enemy` id with no extra runtime hook will only behave like a stationary stompable/damaging enemy. It will not patrol, fly, hop, or attack on its own.

Special runtime logic already exists only for:

- `bounce_pad`
- `ladder`
- `bird`
- `snake`
- `penguin`
- `frog`

So a new object can be added with art only if it is:

- a static pickup
- a static hazard
- a static platform
- a static decoration
- a re-skin of one of the existing special behaviors above

Anything beyond that needs code support.

## Player Skins

### Hard target for future-compatible skins

The current runtime only preloads the default skin. Extra skins are a format target right now, not a finished in-game selection system yet.

The current player asset format is not a spritesheet. It is a folder of individual PNG frames with fixed state names and counts:

- `Idle`: `7` frames
- `Run`: `8` frames
- `JumpRise`: `1` frame
- `JumpFall`: `1` frame
- `Land`: `2` frames
- `LadderClimb`: `8` frames

Current frame canvas size:

- `96 x 84` for every frame checked in the default skin

Alignment rules:

- feet must sit on the same bottom-center baseline in every frame
- the sprite origin is bottom-center
- the engine keeps a fixed player collision body of `10 x 14`
- there is a `2` px visual feet offset between the body and sprite

### Intake target

When sourcing skins, prefer:

- side-view platformer characters
- compact silhouettes
- minimal gear that sticks far outside the torso
- packs that already have close equivalents for the six required states

If the source pack comes as a spritesheet, that is still usable, but it should be normalized into the per-frame PNG layout above.

### Practical rule

The art can be much larger than the collision body, but the gameplay body does not widen automatically. So avoid giant capes, wings, tails, or oversized weapons unless we also plan to revisit collision.

## Safe Now vs Needs Code

### Safe now

- new `16 x 16` tilesets
- new multi-layer parallax background groups
- new static decorations
- new pickups and hazards
- re-skinned versions of current special objects
- new player skins that match the current six-state frame contract

### Needs code

- slope-heavy terrain packs
- one-way platform terrain
- doors, locks, buttons, moving platforms
- projectile enemies or enemies with custom AI
- player accessories as separate attachable layers
- arbitrary user uploads without a normalization step

## Source of Truth Files

- `PRD.md`
- `progress.md`
- `src/config.ts`
- `src/scenes/BootScene.ts`
- `src/scenes/EditorScene.ts`
- `src/scenes/OverworldPlayScene.ts`
- `src/player/defaultPlayer.ts`
- `src/visuals/roomSnapshotTexture.ts`
