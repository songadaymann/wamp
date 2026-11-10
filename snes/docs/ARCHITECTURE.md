# SNESWAMP architecture contract (milestone 1)

Binding for every engineer. The machine-readable half of this contract is
`src/constants.inc` (all numbers) and `src/wram.inc` (every shared WRAM address);
where this text and those files disagree, the include files win and this file
gets fixed. Research references: `research-physics.md` (RP), `research-rooms.md`
(RR), `research-objects.md` (RO), `research-art.md` (RA), cited as `RP §3`.

Global rules (repeated where they matter):

- **ONE register convention: every exported routine is entered and exited with
  A 8-bit, X/Y 16-bit (`A8` + `I16`), D = `$0000`, DB = `$00`, decimal off, and
  is called with `JSR` / returns with `RTS`.** All code lives in bank 0. A routine
  may switch widths internally (only with the `A8/A16/I8/I16` macros) but must
  restore A8/I16 on every exit path. A, X, Y, flags and scratch `$20-$2F` are
  clobbered unless the routine's row says otherwise. Booleans return in carry
  (C=1 true), bytes in A, words in X (second word in Y).
- Shared RAM is declared only in `wram.inc`. `.res` in `ZEROPAGE`/`BSS`/`BSS7E`
  is for module-private variables only (linker pools, section 1.2).
- The NMI handler uses DMA channel 1; main-thread code uses channel 0. Main-thread
  code touches PPU registers/VRAM only under force blank with `nmi_ready = 0`.
  The single exception is the write that enters force blank: `Room_Load` step 0
  sets `nmi_ready = 0` and then writes `INIDISP = $80` directly (3.5).
- One simulation step per NTSC frame. No PAL support.

---------------------------------------------------------------------------

## 1. ROM and RAM layout

### 1.1 ROM banks (LoROM, 1 MiB, bank N at `$NN:8000-$NN:FFFF`)

| Bank | ld65 segment(s) | Content | Est. size |
|---|---|---|---|
| 0 | `CODE`, `RODATA`, `HEADER`, `VECTORS` | all engine code, jump tables, small tables, strings | < 28 KB |
| 1 | `DATA1` | font + HUD chr, palettes, `TileLibPal`, player frame/anim tables, object gfx tables, `WorldIndex` | ~7 KB |
| 2-5 | `TILELIB0`..`TILELIB3` | tile library chr: 256 tiles x 128 B per bank; tile id `t` is at bank `2 + (t >> 8)`, address `$8000 + (t & $FF) * 128` | 73 KB (`TILELIB_COUNT` = 573 ids incl. blank id 0, 3 banks) |
| 6-9 | `PLAYERGFX0`..`3` | player frame chr strips (no frame crosses a bank) | ~55 KB |
| 10-11 | `OBJGFX0`..`1` | object sprite strips (no strip crosses a bank) | ~30 KB |
| 12-15 | `ROOMS0`..`3` | room blobs (no blob crosses a bank) | 12 rooms ~ 15 KB |
| 16-31 | `BANK16`..`BANK31` | free | |

`lorom.cfg` has been extended with exactly these segments (all `optional`); the
generic `BANKn` segments remain and map to the same memory areas (the pipeline
demo still uses `BANK1`). The demo builds and `tests/test_harness.py` passes
11/11 after the change. If bank 0 overflows, ld65 fails the link; the escape
hatch is moving string/table data to `DATA1`, not far code.

### 1.2 RAM (see `wram.inc` for every variable)

| Range | Owner | Content |
|---|---|---|
| `$00-$1F` | linker `ZEROPAGE` | module-private direct page pool (32 bytes total, be frugal) |
| `$20-$2F` | contract | `tmp0-5`, `ptr0`, `tmp6`: main-thread scratch |
| `$30-$33` | nmi.s | `nmi_tmp` |
| `$34-$4F` | contract | frame/input (`input_keep`), game state, PPU shadows, camera, `oam_ptr` |
| `$50-$5F` | collision.s | mover block `mv_*` |
| `$60-$9F` | player.s | player block `pl_*` |
| `$A0-$A7` | player.s/nmi.s | player chr upload request `plchr_*` |
| `$0200-$08FF` | linker `BSS` | module-private low RAM pool |
| `$0900-$0B1F` | oam.s | `oam_shadow` (512) + `oam_shadow_hi` (32) |
| `$0B20-$0BFF` | room/goal/hud/main | room, goal, stats, HUD, debug, crumble table (24 entries), `room_keys_taken` |
| `$0C00-$0CFF` | hud.s/ppu.s | `hud_buf`, `hud_msg_buf`, VRAM write queue |
| `$0D00-$14FF` | objects.s | `obj_table`: 64 slots x 32 bytes |
| `$1500-$186F` | room.s | `coll_map`: 880 bytes |
| `$1870-$18C1` | objects.s, oam.s | `objgfx_base`, draw rotation, `band_load` |
| `$18C2-$193D` | room.s (collision.s reads) | `nbr_edge_l/r/u/d`: neighbour collision edge strips (4.6) |
| `$1A00-$1AFF` | hud.s | `hud_intro_buf` (BG3 rows 11-14) |
| `$1F00-$1FFF` | - | stack |
| `$7E2000-$7E3FFF` | linker `BSS7E` | module-private high pool |
| `$7E4000-$7E68DF` | room.s | `bg1_map_buf`, `bg2_map_buf`, `slot_attr`, `slot_char`, `plane_tile`, `plane_attr` |
| `$7F0000-` | - | free (future downloaded-room cache) |

`src/wram.s` (already written; 3 lines) exports all `wram.inc` names so they
appear in `build/sneswamp.lbl`. It must be added to `SRCS` in the Makefile in the
same change that replaces the demo `main.s` (the demo defines its own
`frame_counter`, `joy1`, `oam_shadow`, so the two cannot be linked together).

### 1.3 Build integration and the room pipeline

Owner of the build integration: **(B)**, as the FIRST engine commit, so that A,
C, D and F can link: `Makefile` `SRCS` = all modules of 4.1 (including `wram`
and `assets`; stub modules that only export their 4.1 symbols with `rts` are
fine), `-I build` added to the ca65 flags, `assets.o` depends on
`build/gen/*.inc`, the asset rules below, removal of the demo `main.s`.
`make test` runs every `tests/test_*.py`. **`make` needs python3 + cc65 only;
no Node.**

- Art (owner A): `tools/mkassets.py` reads `/home/user/wamp/public/assets`
  -> `gen/tilelib.*`, `gen/gfxsys.inc`, `gen/player.*`, `gen/objects.*`.
- Rooms (owner F, all of the following):
  - `snes/rooms/*.json`: genuine WAMP RoomSnapshot JSON, **checked in**. They
    are produced offline with `tools/buildrooms.mts` (the repo's own template /
    command / autotile builders, RR §9.6) run with `npx tsx` on a scratch copy
    of `/home/user/wamp/src` (RR §9.1; nothing is written outside `snes/`).
    The script is checked in for reproducibility but is not part of `make`.
  - `snes/rooms/world.json`: the world manifest
    `{"start": "<file>", "rooms": [{"file": "forest_1.json", "x": 0, "y": 0}, ...]}`.
    List order = world index order = room index. The manifest coordinates
    OVERRIDE the snapshot's own coordinates (template-built snapshots are all
    0,0). Test rooms are listed last, at x >= 100, never adjacent to anything
    except where 7.2 says so.
  - `snes/tools/tilemeta.json`: **checked in**; `{"<gid>": {"solid": bool,
    "kind": string|null}}` for every gid of the 2.1 table, dumped once by
    `tools/dump_tilemeta.mts` from the repo's `getTerrainCollisionProfileForGid`
    and `getSpecialTileKindForGid` (same scratch-copy procedure). It is the only
    source of collision truth for the converter.
  - `tools/mkrooms.py`: `rooms/world.json` + `rooms/*.json` + `tilemeta.json` +
    `gen/tilelib_map.json` -> `gen/rooms/*.bin`, `gen/rooms.inc`,
    `gen/rooms.json`. Tile values are decoded per RR §3.

### 1.4 VRAM, PPU registers, CGRAM (values in `constants.inc`)

| VRAM words | Use | Register |
|---|---|---|
| `$0000-$3FFF` | BG1+BG2 4bpp chr: 256 16x16 tile slots | `BG12NBA=$00` |
| `$4000-$4BFF` | BG3 2bpp chr: font tiles 0-95, HUD icons 96-111, rest free | `BG34NBA=$04` |
| `$4C00-$4FFF` | BG3 map 32x32 | `BG3SC=$4C` |
| `$5000-$57FF` | BG1 map 64x32 (terrain + foreground) | `BG1SC=$51` |
| `$5800-$5FFF` | BG2 map 64x32 (background) | `BG2SC=$59` |
| `$6000-$7FFF` | OBJ chr, 512 chars: char rows 0-3 player (streamed), rows 4-31 per-room object strips | `OBSEL=$63` (small 16x16 / large 32x32) |

`BGMODE=$39` (mode 1, BG3 priority, BG1/BG2 16x16 tiles), `TM=$17`. Scroll:
BG1 and BG2 `HOFS = cam_x`, `VOFS = cam_y - 1`; BG3 `HOFS = 0`, `VOFS = -1`
(harness convention: tilemap row 0 = screen row 0; OAM Y = n is screen row n).

Tile slot `s` (0..255) occupies chars `c, c+1, c+16, c+17` with
`c = (s & 7) * 2 + (s >> 3) * 32`; the tilemap tile number is `c`. Slot 0 is the
empty tile (chars 0, 1, 16, 17 stay zero forever).

Layer priority (mode 1, front to back): BG3 (all HUD tiles have the priority
bit) > OBJ prio 3 > BG1 prio-1 tiles (foreground cells) > OBJ prio 2 (player,
objects) > BG1 prio 0 (terrain) > BG2 (background) > OBJ prio 1. Objects on the
WAMP foreground layer (`OF_FG`) use OBJ prio 3, objects on the WAMP background
layer (`OF_BG`) OBJ prio 1 (behind all tiles, RR §8), everything else prio 2.
Within OBJ, lower OAM index is in front: the player is always first.

| CGRAM | Use |
|---|---|
| 0 | backdrop = room header colour |
| 1-31 | BG3 sub-palettes (`bg3pal.bin`): 0 text (1 white, 2 shadow, 3 yellow), 1 dim text, 2 heart, 3 icons, 4-7 free |
| 32-127 | BG palettes 2-7, fixed for the whole ROM (`bgpal.bin`) |
| 128-143 | OBJ palette 0: player |
| 144-223 | OBJ palettes 1-5: objects, packed by the converter |
| 224-255 | OBJ palette 6 = gold recolour of the exit-flag palette, 7 = green recolour of the checkpoint-flag palette (same colour indices as the originals) |

---------------------------------------------------------------------------

## 2. Generated-asset interface

Everything generated lives in `build/gen/`. The Makefile must pass `-I build`
and `--bin-include-dir build` to ca65 so sources say `.include "gen/x.inc"` /
`.incbin "gen/x.bin"`. Each `gen/*.inc` is complete ca65 source: it selects its
own segments, `.incbin`s its binaries and defines the labels listed below.
`src/assets.s` is nothing but `.include` of the five files plus `.export`s.
16-bit pointers inside generated tables point into bank `$01` (`DATA1`).

Graphics binaries are standard SNES planar chars (4bpp: 32 bytes = rows of
planes 0/1 then rows of planes 2/3; 2bpp: 16 bytes). Colour 0 is transparent;
pixels with alpha < 128 are transparent; colours are `>>3` per channel.

| File | Segment | Labels / symbols | Layout |
|---|---|---|---|
| `gen/tilelib.inc` | `TILELIB0..3`, `DATA1` | `TILELIB_COUNT`, `TILELIB_VERSION` (constants); `TileLibPal` | see 2.1 |
| `gen/gfxsys.inc` | `DATA1` | `FontChr` (1536 B: 96 2bpp tiles, ASCII `$20-$7F`, from `tools/mkfont.py`), `HudChr` (256 B: 16 2bpp tiles = BG3 tiles 96-111, order `HT_*`), `Bg3Palettes` (64 B -> CGRAM 0), `BgPalettes` (192 B -> CGRAM 32), `ObjPalettes` (256 B -> CGRAM 128) | raw |
| `gen/player.inc` | `PLAYERGFX0..3`, `DATA1` | `PLAYER_FRAME_COUNT`; `PlayerFrameTable`, `PlayerAnimTable`, `PlayerAnimFrames` | see 2.2 |
| `gen/objects.inc` | `OBJGFX0..1`, `DATA1` | `ObjGfxTable` | see 2.3 |
| `gen/rooms.inc` | `ROOMS0..3`, `DATA1` | `ROOM_COUNT`; `WorldIndex`; one label `Room_<i>` per blob | see 3 |
| `gen/tilelib_map.json` | (tooling) | `{"<gid>": libraryId}` used by the room converter | |
| `gen/rooms.json` | (tests) | `[{"index":0,"name":"...","x":0,"y":0,"file":"...","checksum":12345}]`; `checksum` = expected `dbg_checksum` (16-bit byte sum of the decoded collision plane) | |

### 2.1 Tile library

- Library tile = 128 bytes: the four 8x8 chars of the 16x16 tile in the order
  TL, TR, BL, BR. `tilelib.bin` is `TILELIB_COUNT * 128` bytes; the `.inc` puts
  bytes `[k*32768, (k+1)*32768)` in `TILELIBk`. Loader: two 64-byte DMAs per tile
  (bytes 0-63 to the slot's char `c`, bytes 64-127 to char `c + 16`).
- `TILELIB_COUNT` = highest library id + 1 = **573** (ids 0..572).
  `TileLibPal`: `TILELIB_COUNT` bytes indexed by library id, BG palette number
  2..7 of each tile (0 for id 0 and for blank atlas cells). One palette per 16x16 tile; the converter fails the build
  if a tile needs more than 15 colours or the set does not pack into 6 palettes.
- Library ids are stable (they are part of the room wire format); `TILELIB_VERSION`
  (currently 1) changes whenever an id changes meaning. id 0 = blank.

| Library id | Source | WAMP gid |
|---|---|---|
| 0 | blank | <= 0 |
| 1-72 | forest | 1-72 |
| 73-144 | desert | 73-144 |
| 145-249 | lava | 217-321 |
| 250-315 | snow | 322-387 |
| 316-387 | water | 388-459 |
| 388-432 | essentials | 492-536 |
| 433-496 | special (art quantised to the BG palettes) | 669-732 |
| 497-500 | autotile-edge-cases-desert | 2073-2076 |
| 501-572 | autotile-artist-extras (`rr_extras.png`) | 2077-2148 |

  A gid outside this table is a converter error (the room is outside ruleset v0).

### 2.2 Player frames (streamed)

- Source: `PlayerSheet.json/png` (and the combat sheet for the two slash
  animations); frames looked up by name; canvas anchor (48, 84) is
  (body centre x, feet + 2) (RA §2.4).
- Each frame is cut into `n <= PL_MAX_CELLS` (12) 16x16 cells. Base-sheet
  frames use the fixed grid of RA §2.5 (at most 6 cells). The slash frames are
  covered with freely placed cells (greedy row cover: best y offset 0..15, then
  per 16-px band cells placed left to right at the first uncovered opaque
  column). Measured on `PlayerCombatActionsSheet` (alpha >= 128): frames 89-93
  need 7, 10, 11, 8, 4 cells; 107-112 need 5, 7, 12, 8, 4, 5; at most 5 cells
  share a scanline. **The converter fails the build if a frame needs more than
  12 cells or has more than `PL_MAX_LINE_CELLS` (5) cells on one scanline**; it
  never crops art.
- Cells are split into group A (cells 0..7) and group B (cells 8..11); with
  `a = min(n, 8)`, `b = n - a` the frame chr is `a*64` bytes of A top halves
  (per cell: TL, TR), `a*64` bytes of A bottom halves (BL, BR), `b*64` bytes of
  B top halves, `b*64` bytes of B bottom halves (`n*128` bytes, contiguous).
  NMI upload = 2 DMAs (A top -> OBJ char 0, A bottom -> char 16) plus, when
  `b > 0`, 2 more (B top -> char 32, B bottom -> char 48). Cell `k` is the
  16x16 sprite with tile number `2k` for `k < 8` and `$20 + 2(k-8)` for `k >= 8`.
  The player owns OBJ char rows 0-3.
- `PlayerFrameTable`: `PLAYER_FRAME_COUNT` x `.addr` -> frame record:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `n` cells (1..12) |
| 1 | 1 | bank index (add `BANK_PLAYERGFX`) |
| 2 | 2 | chr address `$8000-$FFFF` (`n*128` bytes, layout above) |
| 4 | 2n | per cell: `dx`, `dy` (signed bytes) = top-left of the cell relative to the feet point (`pl_x`, `pl_y`), facing right, the +2 px art offset already included |

  Draw: facing right `sx = pl_x - cam_x + dx`; facing left `sx = pl_x - cam_x - dx - 16`
  with `OBJ_HFLIP`; `sy = pl_y - cam_y + dy`; palette 0, prio 2, size SMALL
  (16x16; `tmp3 = 0` for `Oam_Add`; with `OBSEL = $63` "large" is 32x32).
- `PlayerAnimTable`: `PA_COUNT` x 4 bytes `{count, hold, flags(bit0 loop), first}`;
  the animation's frames are `PlayerAnimFrames[first .. first+count-1]` (bytes,
  indices into `PlayerFrameTable`). `hold` = 60 Hz ticks per frame: idle 8,
  run 5, land 4, wall-slide 6, wall-jump 4, stomp-flip 2, ladder 6, crouch 6,
  crawl 5, slash 3 (5 frames, combat 89-93), slash-down 3 (6 frames, combat
  107-112). Loop flag: idle, run, rise, fall, wall-slide, wall-jump, ladder,
  crawl loop; land, stomp-flip, crouch, slash, slash-down hold their last frame.
  Selection and stepping: 5.10.

### 2.3 Object graphics (loaded per room)

Per type one strip: `rows` (2 or 4) char rows of 16 chars (`rows * 512` bytes),
DMA'd in one piece to the next free OBJ char row. `objgfx_base[type]` = first
char number of the strip. Art is stored facing RIGHT (the converter mirrors
slimes and crab, which face left in WAMP).

Allocation (`Obj_SpawnAll`; the room converter runs the identical algorithm and
**fails the build if a room needs more than `OBJ_GFX_ROWS` = 28 rows**):
`objgfx_next_row = OBJ_GFX_FIRST_ROW` (4); pass 1 over `OT_*` ascending loads
every type present in the room whose strip has 4 rows, pass 2 the 2-row strips.
Each distinct strip is loaded once. Because 4-row strips therefore start on
multiples of 4 and 2-row strips on even rows, **no sprite straddles the char
row 15/16 boundary** (the PPU adds to the X and Y nibbles of the tile number
without carry into the name-table bit, so a 32x32 sprite starting in row 13-15
would fetch its lower chars from rows 0-2, the player's). An entry with
`OG_ROWS = OG_ALIAS | t` has no strip of its own: type `t`'s strip is loaded (if
not already) and `objgfx_base[type] = objgfx_base[t]`. `OT_SPRINT_CP` aliases
`OT_CHECKPOINT_FLAG` (same `flag.png`).

The 28-row budget is a CONTENT RULE for room authors (the converter prints the
row count per room): e.g. all six collectibles + spikes + fire + pad + ladder +
two slimes + crab = 26 rows; saw + checkpoint + door + bat + frog + exit = 24.

`ObjGfxTable`: `OT_COUNT` x 12 bytes, indexed by `OT_*` (entry 0 unused):

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | bank index (add `BANK_OBJGFX`) |
| 1 | 2 | strip address |
| 3 | 1 | `rows` 2 or 4; 0 = no graphics; `OG_ALIAS \| t` = uses type `t`'s strip |
| 4 | 1 | OBJ palette 1..5 |
| 5 | 1 | `stride`: char distance between consecutive strip frames (2 or 4) |
| 6 | 1 | `seq_len` 1..8 |
| 7 | 1 | `hold`: 60 Hz ticks per sequence step (0 = frame chosen by code) |
| 8 | 2 | -> `seq_len` bytes: strip frame number per step |
| 10 | 2 | -> piece list: `count`, then `count` x `{dx, dy, char, flags}` |

Piece: `dx, dy` signed = top-left relative to the object anchor (body
bottom-centre), facing right; `char` = offset from `objgfx_base` for strip frame
0; `flags` bit0 = 32x32. Drawn tile = `objgfx_base + char + frame * stride`
(9 bits: bit 8 goes to the OAM attribute name bit). Facing left:
`dx' = -dx - size`, `OBJ_HFLIP`. Constraint: all strip frames of a type sit side
by side in the strip (`frame0_width_chars + (frames-1) * stride <= 16`).

Piece offsets (converter): the WAMP frame top-left relative to the anchor is
`(-frameW/2 - ax, -frameH/2 - ay)` with `ax, ay` from 6.2; pieces tile the
frame's opaque bounding box from there. Exceptions: saw = the 34x34 frame
cropped by 1 px on every side, one large piece at `(-16, -28)`; ladder = art
rows 13..63 only, four small pieces stacked at `dx = -8`, `dy = -51, -35, -19,
-3`; goal markers (`OT_EXIT`, `OT_SPRINT_CP`) = one large piece at `(-16, -30)`
(RO §7.3); door = large at `(-18, -52)` + smalls at `(-18, -20)`, `(-2, -20)`.

| Type | WAMP sheet, frame | Strip frames (sequence) | hold | Pieces | Rows |
|---|---|---|---|---|---|
| coin_gold, coin_silver, star, heart, key | 16x16 | 8 (0..7) | 6 / 6 / 8 / 8 / 8 | 1 small | 2 |
| gem | 16x16 | 5 | 8 | 1 small | 2 |
| spikes | 16x16 | 4 | 8 | 1 small | 2 |
| fire | 16x16 | 6 | 6 | 1 small | 2 |
| saw | 34x34 cropped to 32x32 | 3 (seq 0,1,2,1 = sheet 0,2,3,2) | 8 | 1 large | 4 |
| bounce_pad | 16x32 | 2 (code driven: 0 idle, 1 active) | 0 | 2 small (stacked on screen; side by side in the strip) | 2 |
| ladder | 16x64 (art rows 13-63) | 1 | 0 | 4 small (stacked on screen; side by side in the strip) | 2 |
| checkpoint_flag (sprint checkpoint = alias, own piece list) | 32x32 `flag.png` | 4 (sheet 0,2,4,6) | 15 | 1 large | 4 |
| exit / finish | 32x32 `flag-checkered.png` | 4 (sheet 0,2,4,6) | 15 | 1 large | 4 |
| door_locked | 32x48 | 1 | 0 | 1 large + 2 small | 4 |
| slime_blue, slime_red | 16x16, top row | 5 | 10 | 1 small | 2 |
| bat | 32x32 | 4 (seq 0,1,2,3,2,1 = sheet 4,5,6,7,6,5) | 8 | 1 large | 4 |
| crab | 32x16 | 3 (seq 0,1,2,1) | 8 | 2 small | 2 |
| frog | 32x32 | 4 | 10 | 1 large | 4 |

---------------------------------------------------------------------------

## 3. Room blob v1 and world index

Self-contained except for tile library ids (guarded by `RB_LIB_VERSION`) and
object type ids (guarded by `RB_RULESET`). Little endian. Offsets are from the
start of the blob. This is the future wire format.

### 3.1 Header (64 bytes; `RB_*` in `constants.inc`)

| Off | Size | Field | Notes |
|---|---|---|---|
| `$00` | 4 | magic | `"WSR1"` = `57 53 52 31` |
| `$04` | 1 | version | 1 |
| `$05` | 1 | ruleset | 0 = SNES ruleset v0 |
| `$06` | 2 | size | total blob bytes |
| `$08` | 1 | room x | signed grid coordinate (-128..127) |
| `$09` | 1 | room y | signed |
| `$0A` | 1 | flags | bit0 `pitsAreDeadly`, bit1 `cameraMode == 'room'` (recorded, ignored by the engine), bits 2-7 zero |
| `$0B` | 1 | hearts | `playerHearts` 1..3 |
| `$0C` | 2 | backdrop | BGR555 (RA §4 table; `none` = `#050505`) |
| `$0E` | 2 | spawn x | feet point, room px (resolved by the converter if `spawnPoint` is null, RP §4.3) |
| `$10` | 2 | spawn y | |
| `$12` | 1 | goal type | `GOAL_*` |
| `$13` | 1 | goal param | collect: `requiredCount`; defeat_all: number of enemy objects; sprint: number of checkpoints; else 0 |
| `$14` | 2 | time limit | whole seconds (`ceil(timeLimitMs/1000)`), 0 = none, max 1092 |
| `$16` | 1 | N | tile count 0..255 |
| `$17` | 1 | M | object count 0..64 |
| `$18` | 1 | library version | must equal `TILELIB_VERSION` |
| `$19` | 1 | reserved | 0 |
| `$1A` | 2 | -> tile list | N x 2 bytes |
| `$1C` | 2 | -> BG1 slot plane | RLE, 880 bytes decoded |
| `$1E` | 2 | -> BG1 attr plane | RLE, 880 bytes; 0 = all zero |
| `$20` | 2 | -> BG2 slot plane | RLE; 0 = layer empty (this IS the "BG2 present" test) |
| `$22` | 2 | -> BG2 attr plane | RLE; 0 = all zero |
| `$24` | 2 | -> collision plane | RLE, 880 bytes |
| `$26` | 2 | -> object list | M x 6 bytes |
| `$28` | 24 | title | ASCII `$20-$7E`, space padded (`title ?? "ROOM x,y"`, truncated) |

Neighbours are not stored; they come from the world index.

### 3.2 Sections

**Tile list**: N little-endian words; entry `i` is the library id loaded into
tile slot `i + 1`. Ids are unique within the list.

**Planes** are 880 bytes, row-major (`index = row * 40 + col`, row 0 = top).

- Slot plane: tile slot per cell (0 = empty).
- Attr plane: `$80` V flip, `$40` H flip, `$20` priority; other bits 0. These are
  the tilemap high-byte bits verbatim.
- BG1 = WAMP `terrain` merged with `foreground`: where the foreground cell is
  non-empty it replaces the terrain cell visually and gets `$20` (collision still
  comes from terrain). BG2 = WAMP `background`, attr priority always 0.
- Collision plane: `TC_*` per cell, computed by `mkrooms.py` from
  `tools/tilemeta.json` (1.3; RR §5-6). With `T` = the terrain gid of the cell,
  `D` = "a 677 (damage) is on any layer of the cell", `W` = "a 682 (water) is on
  any layer", first match:

  | Terrain cell | Class |
  |---|---|
  | `T` is ice / bounce / crumbling / conveyor | `TC_ICE`, `TC_BOUNCE`, `TC_CRUMBLE`, `TC_CONV_L/R` (a `D` or `W` on another layer is dropped with a warning) |
  | `T` is any other solid gid | `TC_SOLID_DAMAGE` if `D` (RR §6.1: standing on it hurts), else `TC_SOLID` |
  | `T` is 670 | `TC_DAMAGE` if `D` (warning), `TC_ONEWAY_WATER` if `W`, else `TC_ONEWAY` |
  | `T` empty or non-solid | `TC_DAMAGE` if `D`, else `TC_WATER` if `W`, else `TC_EMPTY` |

  Special kinds outside ruleset v0 (brick, sticky, gravity, wind) are converter
  errors. The smart-background one-way rule (RR §5.3) is NOT supported: a
  snapshot whose `smartTerrain` contains any `background:` semantic cell is a
  converter error.

**RLE ("RLE1")**, used for all five planes. Decode until exactly 880 bytes have
been produced; there is no terminator; runs may cross rows; a run must not
overrun 880 (decoder may trap).

| Control byte `c` | Meaning |
|---|---|
| `$00-$7F` | literal: copy the next `c + 1` bytes (1..128) |
| `$80-$FF` | run: repeat the next byte `(c & $7F) + 2` times (2..129) |

Example: `83 00 01 05 09 FF 11` = 5 x `00`, `05 09`, 129 x `11`. Encoder: greedy,
runs of >= 3 equal bytes become runs. Raw was rejected: 5 planes x 880 = 4.4 KB
per room, against ~0.5-1 KB with RLE1 for typical autotiled rooms.

**Object list**: M records of 6 bytes, in WAMP `placedObjects` order followed by
goal markers. Slot index = record index.

| Off | Size | Field |
|---|---|---|
| 0 | 1 | type `OT_*` |
| 1 | 2 | bits 0-9 anchor x (0..1023); bits 10-12 zero; bits 13-14 layer (0 background -> `OF_BG`, 1 terrain, 2 foreground -> `OF_FG`); bit 15 facing left (`facing ?? (x <= 320 ? right : left)` resolved by the converter) |
| 3 | 2 | anchor y (signed, -128..511) |
| 5 | 1 | param: `OT_EXIT` 0 = reach_exit exit, 1 = sprint finish; `OT_SPRINT_CP` order index 0..; else 0 |

Anchor = bottom-centre of the collision body (table in 6.2 gives the conversion
from WAMP's frame-centre x,y). Goal markers are emitted as objects: `reach_exit`
exit -> `OT_EXIT`(0), sprint checkpoints -> `OT_SPRINT_CP`(i), sprint finish ->
`OT_EXIT`(1), anchor = the marker point itself. Objects outside ruleset v0 are
dropped with a warning (`triangle_piece`, NPCs, `crate`: id 14 stays reserved,
...) or fail the build if the goal depends on them. WAMP accepts object
positions up to 128 px outside the room (RR §9.2): an anchor with x outside
0..1023 or y outside -128..511 is a converter error.

### 3.3 Size

Header 64 + tiles 2N (typ. 30-60 B) + BG1 slots (typ. 250-500 B) + BG1 attr
(typ. 2-40 B) + BG2 (0-400 B) + collision (typ. 100-250 B) + objects 6M
(typ. 60-240 B) = **0.6-1.5 KB typical, 5.5 KB worst case** (all planes
incompressible: 5 x 887, N = 255, M = 64). 12 rooms fit in half a bank.

### 3.4 World index (`WorldIndex` in `DATA1`, emitted by `gen/rooms.inc`)

| Off | Size | Field |
|---|---|---|
| 0 | 4 | `"WSW1"` |
| 4 | 1 | room count R (1..64) |
| 5 | 1 | start room index |
| 6 | 2 | 0 |
| 8 | 6R | per room: x (s8), y (s8), blob address lo, hi, bank, flags (0) |

Room index = position in this list = position in `rooms/world.json` (1.3),
which also supplies the coordinates and the start room. Neighbour of (x, y) on a side = the entry
with coordinates (x-1,y) / (x+1,y) / (x,y-1) / (x,y+1) (y grows downward, like
WAMP); linear search at room load, result cached in `room_nbr[4]`. Test rooms
are ordinary entries placed at coordinates with no neighbours (x >= 100).

### 3.5 Loader (`Room_Load`, force blank, NMI uploads off)

0. `nmi_ready = 0`, then write `INIDISP = $80` directly and set
   `ppu_inidisp = $80` (the one sanctioned main-thread PPU write with the screen
   on; it is what makes the debug warp and any other un-faded entry legal).
   From here to step 9 the NMI only counts frames and reads the pad.
1. Look up `room_next` in `WorldIndex` -> `room_ptr`; check magic, version,
   ruleset, library version (mismatch: `dbg_last_death = $FF`, red backdrop,
   screen on, endless loop).
2. Copy header fields to `room_*`; CGRAM 0 = backdrop.
3. For `i` in 0..N-1: DMA the library tile into slot `i+1`;
   `slot_char[s] = c & $FF`, `slot_attr[s] = (TileLibPal[id] << 2) | (c >> 8)`.
   `slot_char[0] = slot_attr[0] = 0`.
4. For BG1 then BG2: clear the 4096-byte map buffer; decode slot plane to
   `plane_tile` and attr plane to `plane_attr` (or zero-fill); for each cell with
   slot `s != 0` store the word `slot_char[s] | ((slot_attr[s] | attr) << 8)` at
   buffer byte offset `((col & 31) + row * 32) * 2 + (col >= 32 ? $800 : 0)`;
   DMA the 4096 bytes to the layer's map base (the buffer is the VRAM image:
   word address = base + offset / 2).
5. Decode the collision plane straight into `coll_map`; `dbg_checksum` = 16-bit
   byte sum of `coll_map`.
6. `Obj_SpawnAll` (also loads the object strips, resets `objgfx_base`).
7. Neighbour search -> `room_nbr`. Then the neighbour edge strips (4.6): for
   each side with a neighbour, `Rle_Decode` that neighbour blob's collision
   plane into `plane_tile` (free scratch at this point) and copy its facing
   strip: left neighbour column 39 -> `nbr_edge_l[row]`, right neighbour column
   0 -> `nbr_edge_r[row]`, upper neighbour row 21 -> `nbr_edge_u[col]`, lower
   neighbour row 0 -> `nbr_edge_d[col]`; `TC_CRUMBLE` is stored as `TC_SOLID`.
   A side without a neighbour is filled with `TC_EMPTY`.
8. Place the player per `room_entry` (4.6), `Goal_Init` (also settles the keys,
   6.5), `Hud_Reset`; clear the crumble table; `room_index = room_next`.
9. Build the first frame so that no stale shadow is ever shown: `Camera_Snap`,
   `Player_Animate`, `Oam_Begin`, `Player_Draw`, `Obj_DrawAll`, `Oam_Finish`,
   `Hud_Update` (steps 8-10 of 4.3). `pl_frame_loaded = $FF` beforehand so the
   player chr is re-requested. `room_load_count += 1`. The caller then starts
   `Fade_In`; the first NMI with `nmi_ready = 1` uploads OAM, player chr, HUD
   and scroll of the NEW room together with the brightness.

Every room entry reloads the room from the blob (objects, collectibles and
crumbled tiles reset). `score` and `pl_hearts` carry over (hearts clamped to
the new room's maximum; refilled on `RE_SPAWN`); `keys` carry over minus the
keys taken in the room being left (6.5).

---------------------------------------------------------------------------

## 4. Engine modules

### 4.1 Files and exports

All routines follow the global convention (A8/I16 in and out, JSR/RTS).

| File | Owns (WRAM) | Exported routines |
|---|---|---|
| `header.s`, `init.s` | - | `Reset` (existing; ends with `jmp Main`) |
| `wram.s` | - | exports the `wram.inc` names |
| `assets.s` | - | includes `gen/*.inc`, exports their labels |
| `main.s` | `game_state`, `input_keep`, `state_timer`, `game_frame`, `hitstop`, `dbg_*` | `Main`; `Game_SetState` (A = `GS_*`); `WaitFrame` |
| `nmi.s` | `frame_counter`, `nmi_ready`, `lag_frames`, `joy1_raw`, `nmi_tmp` | `NMI` |
| `input.s` | `joy1`, `joy1_prev`, `joy1_pressed` | `Input_Update` (4.4; `joy1_pressed` is latched, cleared by `Main`) |
| `ppu.s` | `ppu_inidisp`, `vq_*` | `Ppu_Init` (registers of 1.4, font/HUD chr, palettes; force blank); `Ppu_DmaVram` (X = VRAM word addr, `ptr0` = source, Y = byte count; force blank only); `Ppu_SetCgram` (A = index, X = colour); `VQ_Push` (X = VRAM word addr, Y = data word; C=1 if queue full, caller retries next frame); `Fade_Out`, `Fade_In` (start an 8-frame fade), `Fade_Update` (called every frame by main), `Fade_Busy` (C); `Math_MulFrac` (X = unsigned word, A = factor -> X = (X * A) >> 8) |
| `oam.s` | `oam_shadow*`, `oam_ptr`, `band_load` | `Oam_Begin` (`oam_ptr = 0`, zero all 32 bytes of `oam_shadow_hi`, zero `band_load[0..13]`); `Oam_Add` (`tmp0` = screen x signed word, `tmp1` = screen y signed word, `tmp2` = tile word (9 bits), A = attr `vhoopppN` without the name bit, `tmp3` low byte = 0 small (16x16) / 2 large (32x32); culls off-screen; ORs its 2 bits into `oam_shadow_hi`; C=1 if not added); `Oam_AddLimited` (same + sprite-band limiter, 6.4); `Oam_Finish` (writes Y = 240 to every unused entry; their high-table bits are already 0, so no parked entry can be 32 px tall and wrap onto lines 0-15) |
| `room.s` | `room_*` (not `room_keys_taken`), `coll_map`, `nbr_edge_*`, `bg*_map_buf`, `slot_*`, `plane_*`, `crumble_*` | `Room_Load`; `Rle_Decode` (`ptr0` = source, X = dest offset in bank `$7E`, always 880 bytes); `Room_SetCell` (X = cell index 0..879, A = `TC_*`, Y = BG1 tilemap word: writes `coll_map` and queues the VRAM write; does NOT touch `bg1_map_buf`, which always holds the as-loaded image; C=1 if the queue was full and nothing changed); `Room_CellWord` (X = cell index -> Y = as-loaded BG1 word from `bg1_map_buf`); `Room_CheckEdges`; `Room_StartCrumble` (X = cell index; 5.8); `Room_UpdateTiles` (crumble timers) |
| `collision.s` | `mv_*` | `Coll_GetClass` (X = room px x, Y = room px y, signed -> A = `TC_*`; cells of the one-cell ring outside the room come from `nbr_edge_*`, everything further out is `TC_EMPTY` (4.6); preserves X, Y); `Coll_SolidAt` (same in -> C); `Coll_MoveX`, `Coll_MoveY` (mover block, 5.3); `Coll_BoxFree` (`tmp0..tmp3` = x0, y0, x1, y1 inclusive px -> C=1 if no solid cell and inside the room) |
| `player.s` | `pl_*`, `plchr_*` | `Player_Spawn` (X, Y = feet point; full state reset, hearts refilled); `Player_Place` (X, Y: position only, velocity kept); `Player_Integrate`; `Player_ScanTiles`; `Player_Control`; `Player_Sword`; `Player_Damage` (A = `MSG_*` reason; hearts absorb); `Player_Kill` (A = reason; bypasses hearts); `Player_Animate`; `Player_Draw` |
| `objects.s` (+ optional `enemies.s`) | `obj_table`, `objgfx_*`, `obj_draw_start`, `enemies_left`, `collect_left`, `needkey_timer` | `Obj_SpawnAll`; `Obj_UpdateAll`; `Obj_InteractPlayer`; `Obj_DrawAll`; `Obj_SolidX`, `Obj_SolidY` (called by `Coll_Move*` when `MVO_SOLIDOBJ`; operate on the mover block; the door-unlock and ladder-top rules run only when `MVO_PLAYER`, 6.3); `Obj_FindLadder` (-> `pl_ladder`, C=1 if overlapping); `Obj_SwordHit` (`tmp0..tmp3` = rect x0, y0, x1, y1 exclusive -> A = enemies defeated, at most `SWORD_MAX_HITS` minus those already hit this swing) |
| `goal.s` | `goal_*`, `score`, `keys`, `room_keys_taken`, `deaths` | `Goal_Init`; `Goal_Update`; `Goal_OnCollect` (A = `OT_*`); `Goal_OnDefeat`; `Goal_OnMarker` (X = slot offset; C=1 if the marker was consumed); `Goal_OnDoor` (a door consumed a key: `keys -= 1`, `room_keys_taken` -= 1 floor 0); `Score_Add` (A = points) |
| `hud.s` | `hud_*` | `Hud_Reset` (full redraw request); `Hud_Update` (renders `hud_redraw` fields into `hud_buf`, runs the message timer); `Hud_ShowMsg` (A = `MSG_*`); `Hud_DrawIntro`, `Hud_ClearIntro` (render / zero `hud_intro_buf` and set `HUD_DIRTY_INTRO`; legal with the screen on); `Hud_DrawTitle` (direct VRAM, force blank only) |
| `camera.s` | `cam_x`, `cam_y` | `Camera_Update`, `Camera_Snap` (identical in M1): `cam_x = clamp(pl_x - 128, 0, 384)`, `cam_y = clamp(pl_y - 13 - 112, 0, 128)` |
| `title.s` | - | `Title_Enter`, `Title_Update` |

Ownership: (A) `tools/mkassets.py` + `assets.s`; (B) build integration (1.3,
first commit), `main`, `nmi`, `ppu`, `oam`, `input`, `camera`, `title`, `room`;
(C) `collision`, `player`; (D) `objects`, `goal`, `hud`; (E) tests + Python
reference model (E specifies what each test room must contain); (F) the room
pipeline and ALL room content: `tools/mkrooms.py`, `tools/dump_tilemeta.mts` +
`tools/tilemeta.json`, `tools/buildrooms.mts`, `rooms/world.json`, the ~12
world rooms and the test rooms of 7.2.

### 4.2 Game states (`game_state`)

`Main` loop, every frame: `WaitFrame` (WAI until `frame_counter` changes) ->
`Input_Update` -> debug warp check (7.2) -> state handler via jump table ->
`Fade_Update` -> clear the latched edges (`if input_keep: input_keep = 0 else
joy1_pressed = 0`) -> `nmi_ready = 1`. A pressed edge therefore lives until the
end of the first frame whose handler could consume it; only a `GS_PLAY` hitstop
frame (4.3 step 2) sets `input_keep` and carries it over (RP §2.3).

| State | On entry | Every frame | Leaves to |
|---|---|---|---|
| `GS_BOOT` | `Ppu_Init`, clear state | - | `GS_TITLE` |
| `GS_TITLE` | BG3 text "SNESWAMP" / "PRESS START", TM = BG3 | wait for START (or `DBG_SKIP_INTRO`) | `score = keys = room_keys_taken = deaths = 0`, `room_next` = start room, `RE_SPAWN` -> `GS_ROOM_LOAD` |
| `GS_ROOM_LOAD` | - | `Room_Load` (one call; takes several frames; enters force blank itself and builds the first frame's shadows, 3.5 steps 0 and 9) | `Fade_In`; `GS_ROOM_INTRO` if `RE_SPAWN` and goal != none and not `DBG_SKIP_INTRO`, else `GS_PLAY` |
| `GS_ROOM_INTRO` | `Hud_DrawIntro` (6.6), `state_timer = T_ROOM_INTRO` | draw only (step 8-10 of 4.3) | jump/START pressed or timer 0: `Hud_ClearIntro`, `Hud_ShowMsg(MSG_GOAL_START)` -> `GS_PLAY` |
| `GS_PLAY` | - | 4.3 | `GS_PAUSE` (START), `GS_DYING`, `GS_TRANSITION`, `GS_GOAL` |
| `GS_DYING` | `pl_dead = 1`, `pl_visible = 0`, `state_timer = T_DEATH_BEAT`, `Hud_ShowMsg(dbg_last_death)` | draw only | timer 0: `Player_Spawn(pl_respawn)`, `Camera_Snap`, `pl_dead = 0`, `pl_visible = 1` -> `GS_PLAY` (no respawn fade/blink in M1) |
| `GS_TRANSITION` | `Fade_Out` | nothing until `Fade_Busy` clears | `GS_ROOM_LOAD` |
| `GS_GOAL` | `Hud_ShowMsg(MSG_GOAL_DONE)`, `state_timer = T_GOAL_BEAT` | draw only | timer 0 -> `GS_PLAY` (free play continues, `goal_result = GR_COMPLETE`) |
| `GS_PAUSE` | `Hud_ShowMsg(MSG_PAUSED)` | START -> `GS_PLAY`; SELECT -> `room_next = room_index`, `RE_SPAWN`, `GS_TRANSITION` | |

### 4.3 `GS_PLAY` frame order (matches Phaser: integrate -> collide -> objects/overlaps -> controller, RP §2.2)

| # | Call | Notes |
|---|---|---|
| 1 | START pressed -> `GS_PAUSE` | |
| 2 | `hitstop > 0`: decrement, `input_keep = 1`, skip to 8 | enemy kill sets `hitstop = T_HITSTOP`; presses made during hitstop are consumed by the first step 6 after it |
| 3 | `Player_Integrate` | gravity, clamp, X move + collide, Y move + collide -> `pl_blocked` |
| 4 | `Obj_UpdateAll` | enemy AI + physics, animation, object timers |
| 5 | `Obj_InteractPlayer`; `Player_ScanTiles`; `Room_UpdateTiles` | pickups, hazards, stomp, pad, markers; tile contact/overlap effects |
| 6 | `Player_Control`; `Player_Sword` | sets velocity for the NEXT frame's integrate |
| 7 | `Room_CheckEdges`; `Goal_Update`; `game_frame += 1` | pit death, room change, timer |
| 8 | `Camera_Update` | |
| 9 | `Player_Animate`; `Oam_Begin`; `Player_Draw`; `Obj_DrawAll`; `Oam_Finish` | |
| 10 | `Hud_Update` | |

If a step changes `game_state` (death, transition, goal), the remaining
simulation steps of that frame are skipped; steps 8-10 still run.

### 4.4 NMI

```
save registers, D = 0, DB = 0, ack RDNMI
if nmi_ready:
    OAMADDL = OAMADDH = 0        ; the PPU does not reload the OAM address in force blank
    OAM DMA: oam_shadow (544 bytes)
    if plchr_req: src = plchr_bank:plchr_addr
                  DMA plchr_len bytes  -> OBJ char 0,  next plchr_len bytes  -> OBJ char 16
                  if plchr_len2 != 0:
                  DMA plchr_len2 bytes -> OBJ char 32, next plchr_len2 bytes -> OBJ char 48
                  pl_frame_loaded = pl_frame; plchr_req = 0
    if hud_dirty & 1: DMA hud_buf (128 B) -> BG3 map row 1, col 0
    if hud_dirty & 2: DMA hud_msg_buf (64 B) -> BG3 map row 25
    if hud_dirty & 4: DMA hud_intro_buf (256 B) -> BG3 map row 11, col 0
    hud_dirty = 0
    VRAM queue: vq_count word writes; vq_count = 0
    BG1/BG2 HOFS = cam_x, VOFS = cam_y - 1;  INIDISP = ppu_inidisp
    nmi_ready = 0
else if game_state == GS_PLAY: lag_frames += 1
joypad (EVERY path): poll HVBJOY bit 0 until it reads 1, at most 40 polls (auto-read
    may not have started yet on the short not-ready path); then poll until it
    reads 0; joy1_raw = JOY1L/H
frame_counter += 1
restore, rti
```

`Input_Update` (main thread): `joy1_prev = joy1; joy1 = joy1_raw;
joy1_pressed |= joy1 & ~joy1_prev` (latched; cleared by `Main`, 4.2). Because OAM and the player's chr are uploaded
in the same NMI, a frame's pieces and pixels always match.

### 4.5 VBlank budget

NTSC vblank = 37 lines ~ 50,000 master cycles; DMA costs 8 cycles per byte.

| Upload | Bytes (max) |
|---|---|
| OAM | 544 |
| Player frame (only when the frame changes, <= 20 times/s) | 1536 (12 cells, one slash-down frame), typical 384-768 |
| HUD rows (only when dirty) | 128 + 64 |
| **DMA total during play** | **2272** = 18,176 cycles ~ 13.3 lines |
| Intro box (only in `GS_ROOM_INTRO`, where nothing simulates and no slash frame can be requested) | 256 |
| VRAM queue | <= 15 word writes (~1 line) |
| Hard cap for any future upload: | `NMI_DMA_BUDGET` = 2560 bytes per vblank |

No object chr is streamed (object strips are resident per room). Tilemap changes
during play go through `VQ_Push` only.

### 4.6 Room edges and transitions (`Room_CheckEdges`, after `Player_Control`)

Tests use the body centre: `cx = pl_x`, `cy = pl_y - 13`. First match wins:

| Condition | Action |
|---|---|
| `RF_PITS_DEADLY` and `pl_y >= 351` and `pl_vy >= 0` and `0 <= cx < 640` | `Player_Kill(MSG_YOU_FELL)` |
| `cx < 0` and left neighbour | `room_next` = neighbour, `room_entry = RE_FROM_RIGHT`, `GS_TRANSITION` |
| `cx >= 640` and right neighbour | `RE_FROM_LEFT` |
| `cy < 0` and upper neighbour | `RE_FROM_BOTTOM` |
| `cy >= 352` and lower neighbour | `RE_FROM_TOP` |

On load the player is placed with `Player_Place`: `RE_FROM_LEFT x -= 640`,
`RE_FROM_RIGHT x += 640`, `RE_FROM_TOP y -= 352`, `RE_FROM_BOTTOM y += 352`;
velocity and all movement state are preserved; `pl_respawn` = the new room's
spawn. `RE_SPAWN` uses `Player_Spawn(room_spawn)`.

Edges without a neighbour are invisible walls 12 px inside the room, applied by
`Coll_MoveX/Y` when `MVO_EDGEWALLS` (5.3): left wall `[0,12)`, right `[628,640)`,
ceiling `[0,12)`, floor top at y = 340. The floor wall is omitted when
`RF_PITS_DEADLY`.

**Seams collide like the continuous web world** (RP §15.1): the transition
fires on the body CENTRE, so the body reaches up to 5 px (sides), 13 px + one
frame of travel (bottom) or 14 px + one frame (top) into the neighbour before
it. `Coll_GetClass` therefore answers for the one-cell ring around the room from
`nbr_edge_l/r/u/d` (loaded in 3.5 step 7): cell column -1 / 40 with row 0..21,
cell row -1 / 22 with column 0..39; the four ring corners and everything further
out are `TC_EMPTY`. One ring is enough (all reaches are < 16 px before the
centre crosses). A floor in row 0 of the lower room is thus stood on at
y = 352, a wall in column 0 of the right-hand room blocks at x = 640 - 5, and a
solid row 21 of the upper room bumps the head; none of them triggers a
transition. Ring cells take part in every collision and tile scan like room
cells, with one exception: they never start crumbling (no cell index).
Enemies never use the ring (they are clamped inside the room, 6.2).

---------------------------------------------------------------------------

## 5. Physics and collision

### 5.1 Representation

- Position: 16.8 fixed point per axis, stored as 3 bytes `[sub][px lo][px hi]`
  (`pl_xsub` + `pl_x`). The pixel word is signed room px. Collision uses the
  pixel word only (floor).
- Velocity: signed 8.8 px/frame word. Integration: 24-bit add of the
  sign-extended velocity.
- Player body: `[pl_x - 5, pl_x + 5) x [pl_y - pl_h, pl_y)`, i.e. pixel columns
  `x-5 .. x+4`, pixel rows `y-h .. y-1`; `pl_h` = 26 or 14 (RP §4.2). `pl_y` is
  the feet. A body standing on a tile whose top is `T` has `pl_y = T`.
- Multiply by a fraction (`JUMP_CUT_MUL` etc.): negate if negative,
  `Math_MulFrac`, negate back (never arithmetic-shift a negative velocity).

### 5.2 `Player_Integrate`

```
if pl_dead: return
if not PF_CLIMB and pl_stomp_flip == 0:  pl_vy += V_GRAVITY
pl_vy = clamp(pl_vy, -$0855, +$0855)
mover <- player (hw 5, h pl_h, opts ONEWAY|EDGEWALLS|SOLIDOBJ|PLAYER, + DROPTHRU if pl_drop > 0)
mv_blocked = 0;  Coll_MoveX;  Coll_MoveY
player <- mover;  pl_blocked = mv_blocked
```

Consequence to preserve (RP §2.2): the controller sets velocity at the end of
frame N and gravity is added before it moves the body in frame N+1 (first jump
frame moves `(-$04AB + $32) / 256 = -4.47 px`).

### 5.3 `Coll_MoveX`, `Coll_MoveY` (X first, then Y)

A cell is solid if its class has bit 7. Each probe iterates EVERY cell index
from the first to the last inclusive (`(y-h)>>4 .. (y-1)>>4` rows in X,
`(x-hw)>>4 .. (x+hw-1)>>4` columns in Y): 2 cells for the 10 px player, up to 3
for the 24 px wide enemies and the 24/26 px tall bodies. Never sample only the
two ends.

```
Coll_MoveX:
  x(16.8) += vx
  vx > 0: px = x + hw                      ; first pixel column right of the body
          if any row r in (y-h)>>4 .. (y-1)>>4 has solid(px>>4, r):
              x = (px & $FFF0) - hw; xsub = 0; vx = 0; blocked |= BLK_RIGHT
          EDGEWALLS and no right neighbour and x + hw > 628:
              x = 628 - hw; xsub = 0; vx = 0; blocked |= BLK_RIGHT
  vx < 0: px = x - hw                      ; leftmost body pixel column
          if any row ... solid(px>>4, r):
              x = (px | 15) + 1 + hw; xsub = 0; vx = 0; blocked |= BLK_LEFT
          EDGEWALLS and no left neighbour and x - hw < 12:
              x = 12 + hw; xsub = 0; vx = 0; blocked |= BLK_LEFT
  vx == 0: no probe, no flags
  SOLIDOBJ: Obj_SolidX (same rule against OF_SOLID object boxes)

Coll_MoveY:
  mv_prev_y = y;  y(16.8) += vy
  vy < 0: py = y - h                       ; top pixel row of the body
          if any column c in (x-hw)>>4 .. (x+hw-1)>>4 has solid(c, py>>4):
              y = ((py>>4) + 1) * 16 + h; ysub = 0; vy = 0; blocked |= BLK_UP
          EDGEWALLS and no upper neighbour and y - h < 12:
              y = 12 + h; ysub = 0; vy = 0; blocked |= BLK_UP
  vy >= 0: py = y                          ; pixel row just below the body
          T = py & $FFF0
          for the same columns, cell class k at (c, py>>4) supports the body if
              k is solid, or
              k is TC_ONEWAY or TC_ONEWAY_WATER, and ONEWAY and not DROPTHRU
                  and mv_prev_y <= T + ONEWAY_PREV_TOL and y <= T + ONEWAY_CUR_TOL
          supported: y = T; ysub = 0; vy = 0; blocked |= BLK_DOWN
          EDGEWALLS and no lower neighbour and not RF_PITS_DEADLY and y > 340:
              y = 340; ysub = 0; vy = 0; blocked |= BLK_DOWN
  SOLIDOBJ: Obj_SolidY (solid objects; with MVO_PLAYER also ladder tops when vy >= 0, 6.3)
```

`Obj_SolidX/Y` apply the same push-out rules against the body boxes of
`OF_SOLID`, non-hidden objects (in M1 only `door_locked`; `OF_SOLID` objects
never move, so there is no self-collision case). The mover carries no identity
except `MVO_PLAYER`: only when it is set do the door-unlock rule and the
ladder-top support (6.3) run.

Notes: (1) flags are set only on a frame in which the body moved into the
surface, like Arcade; a standing body gets `BLK_DOWN` every frame because gravity
makes `vy > 0`. (2) One-way cells and ladder tops never block in X or upward.
**Normative: they are tested only in the `vy >= 0` branch**; WAMP's `vy >= -12`
/ `vy >= -4 px/s` thresholds (< 0.2 px/frame of upward speed, at most one frame
of difference) are deliberately not reproduced and have no constants.
(3) The player uses `opts = ONEWAY | EDGEWALLS | SOLIDOBJ | PLAYER`; enemies
`ONEWAY | SOLIDOBJ`.

### 5.4 `Player_ScanTiles` (special tiles; RR §6.1)

| Scan | Cells | Effect |
|---|---|---|
| contact (only if `BLK_DOWN`) | classes at `(x-3, y)`, `(x, y)`, `(x+3, y)` -> `pl_contact` bits (`TC_SOLID_DAMAGE` and `TC_DAMAGE` -> `CT_DAMAGE`; `TC_ONEWAY`/`TC_ONEWAY_WATER` -> `CT_ONEWAY`) | `CT_BOUNCE` and `pl_vy >= V_BOUNCE_MIN_NEG` and `pl_bounce_grace == 0`: `pl_vy = V_BOUNCE_NEG`, `pl_bounce_grace = T_BOUNCE_GRACE`. `CT_CRUMBLE`: `Room_StartCrumble` for each touched in-room crumble cell (5.8). `CT_DAMAGE`: `Player_Damage(MSG_HIT)`. Ice and conveyors are consumed by `Player_Control`. |
| overlap | every cell intersecting the body shrunk by 1 px: columns `x-4 .. x+3`, rows `y-h+1 .. y-2` | any `TC_WATER` or `TC_ONEWAY_WATER` -> `PF_WATER` (else clear); any `TC_DAMAGE` -> `Player_Damage(MSG_HIT)` |

### 5.5 `Player_Control` (normative; this is RP §3 restricted to milestone 1)

`held(b)` = `joy1 & b`, `pressed(b)` = `joy1_pressed & b`; `inputX` = right - left
(both = 0); `jumpHeld = held(BTN_JUMP | BTN_UP)`.

```
C0  tick (decrement if > 0): pl_jumpbuf, pl_wjbuf, pl_protect, pl_wall_grace,
    pl_wj_lock, pl_stomp_flip, pl_kb_timer, pl_invuln, pl_drop, pl_bounce_grace
C1  corner correction (5.7) unless PF_WATER | PF_CLIMB | PF_STOMP
C2  ladder: L = Obj_FindLadder; v = down - up (held)
    stay = L and not pressed(BTN_JUMP) and (v != 0 or (PF_CLIMB and inputX == 0))
    if stay:
        entering (PF_CLIMB was clear): pl_vy = 0, clear PF_STOMP, pl_stomp_flip = 0
        set PF_CLIMB; clear PF_GROUNDED, PF_CROUCH; reset wall state (C7);
        pl_coyote = pl_jumpbuf = pl_wjbuf = pl_protect = 0
        d = ladder.x - pl_x;  pl_vx = sign(d) * min(|d| * $33, V_LADDER_CENTER)
        pl_vy = v * V_LADDER;  pl_h = 14;  goto C17
    leftLadderByJump = PF_CLIMB and pressed(BTN_JUMP);  clear PF_CLIMB
C3  if PF_WATER: pl_jumpbuf = pl_wjbuf = pl_protect = 0
C4  grounded = pl_blocked & BLK_DOWN  -> PF_GROUNDED
C4b single-tile gap assist (RP §8.4; rooms may rely on running over 1-tile holes):
    if inputX != 0 and not held(BTN_DOWN) and not pressed(BTN_JUMP | BTN_UP)
       and (grounded or pl_coyote > 0) and pl_vy >= V_GAP_ASSIST_MIN_NEG:
        T = ((pl_y + 1) >> 4) << 4;  r = T >> 4
        if -1 <= pl_y - T <= GAP_ASSIST_SINK_MAX:
            for each cell column c covering pixel columns pl_x-6 .. pl_x+5:
                if not solid(c, r) and solid(c-1, r) and solid(c+1, r):
                    pl_y = T; pl_ysub = 0; if pl_vy > 0: pl_vy = 0
                    grounded = true (set PF_GROUNDED); break
    (pl_coyote here is the value left by the previous frame's C8; pl_vx untouched)
C5  butt stomp:
    grounded and PF_STOMP: clear PF_STOMP, pl_stomp_flip = 0
    PF_WATER: clear PF_STOMP, pl_stomp_flip = 0
    else if not grounded and not PF_STOMP and pressed(BTN_DOWN):
        set PF_STOMP, pl_stomp_flip = T_STOMP_FLIP, clear PF_CROUCH, reset wall
        state, pl_coyote = pl_jumpbuf = pl_wjbuf = pl_protect = 0
C6  fits = not grounded or pl_h == 26 or Fits26()
        Fits26: no solid at pixel row y-25, columns x, x-4, x+4
    crouch = (grounded and held(BTN_DOWN)) or (grounded and not fits)
             or (PF_CROUCH and not fits)                 -> PF_CROUCH
    pl_h = (grounded and pl_vy >= 0 and not crouch and fits) ? 26 : 14
C7  wall state.  canAttach = not grounded and not crouch and not PF_STOMP
    raw = BLK_LEFT only -> DIR_LEFT; BLK_RIGHT only -> DIR_RIGHT; else 0
    contact = 0 if not canAttach or raw == 0
            = raw if inputX == raw or inputX == 0 or PF_JUMPCHAIN, else 0
    pl_wall_side = contact
    if contact: pl_wall_grace = T_WALL_GRACE, pl_wall_grace_side = contact
    contactSide = contact, else pl_wall_grace_side if pl_wall_grace > 0, else 0
    grounded: reset wall state = pl_wall_grace = pl_wj_lock = pl_wj_dir = 0,
              clear PF_JUMPCHAIN | PF_WJ_ACTIVE | PF_WALLSLIDE, contactSide = 0
    PF_WALLSLIDE = contact != 0 and pl_vy >= 0   (also clears PF_WJ_ACTIVE when set)
    if PF_WJ_ACTIVE and pl_vy >= 0: clear PF_WJ_ACTIVE
    if pl_wj_lock > 0 and pl_wj_lock <= T_WALLJUMP_STEER and inputX == -pl_wj_dir:
        pl_wj_lock = 0
    if pl_wj_lock == 0 and not PF_WJ_ACTIVE: pl_wj_dir = 0
C8  coyote: grounded ? pl_coyote = T_COYOTE : decrement if > 0
C9  horizontal velocity, first match:
    pl_stomp_flip > 0                 -> 0
    pl_kb_timer > 0                   -> pl_kb_vx
    pl_wj_lock > 0 and pl_wj_dir != 0 -> pl_wj_dir * V_WALL_JUMP_X
    else speed = crouch ? V_CRAWL : V_RUN   (PF_WATER: V_WATER_CRAWL : V_WATER_RUN)
         target = inputX * speed
         grounded and (pl_contact & CT_ICE):
             inputX == 0: pl_vx = pl_vx * ICE_COAST_MUL/256
             else:        gap = target - pl_vx   (raw 8.8 units)
                          |gap| < ICE_SNAP: pl_vx = target
                          else pl_vx += sign(gap) * ((|gap| * k) >> 8), k = ICE_LERP_RUN /
                               _CRAWL / _WATER_RUN / _WATER_CRAWL for the speed chosen above
         otherwise: pl_vx = target
    if inputX != 0: pl_facing = inputX   (PF_WALLSLIDE: face the wall)
C10 jumpPressed = not crouch and not PF_STOMP
                  and (pressed(BTN_JUMP) or (pressed(BTN_UP) and not L))
    jumpV = PF_WATER ? V_SWIM_KICK_NEG : V_JUMP_NEG
C11 if leftLadderByJump: pl_vy = jumpV; pl_jumpbuf = pl_wjbuf = 0; pl_coyote = 0;
                         reset wall state
    else:
      if jumpPressed:
          PF_WATER:          pl_vy = jumpV; pl_jumpbuf = pl_wjbuf = 0; pl_coyote = 0
          contactSide != 0:  WallJump(buffered = 0)
          else:              pl_jumpbuf = T_JUMP_BUFFER; pl_wjbuf = T_WALLJUMP_BUFFER
      if pl_wjbuf > 0 and contactSide != 0:  WallJump(buffered = 1)
      else if pl_jumpbuf > 0 and pl_coyote > 0:
          pl_protect = (not jumpPressed or not grounded) ? T_PROTECT : 0
          pl_vy = jumpV; pl_jumpbuf = pl_wjbuf = 0; pl_coyote = 0;
          clear PF_JUMPCHAIN | PF_WJ_ACTIVE
      release cut: if not jumpHeld and pl_protect == 0 and pl_vy < 0
                      and pl_bounce_grace == 0:   pl_vy = -((-pl_vy * $DA) >> 8)
    WallJump(buffered): dir = -contactSide; pl_vx = dir * V_WALL_JUMP_X;
        pl_vy = V_WALL_JUMP_Y_NEG; pl_jumpbuf = pl_wjbuf = 0; pl_coyote = 0;
        pl_protect = buffered ? T_PROTECT : 0; pl_wall_grace = 0;
        pl_wj_lock = T_WALLJUMP_LOCK; pl_wj_dir = dir; contactSide = 0;
        set PF_WJ_ACTIVE | PF_JUMPCHAIN; clear PF_WALLSLIDE
C12 if PF_WALLSLIDE and pl_vy > V_WALL_SLIDE: pl_vy = V_WALL_SLIDE
C13 if PF_STOMP: pl_stomp_flip > 0 ? (pl_vx = 0, pl_vy = 0)
                                   : (if pl_vy < V_STOMP: pl_vy = V_STOMP)
C14 if PF_WATER and pl_vy > V_WATER_SINK: pl_vy = V_WATER_SINK
C15 if grounded: CT_CONV_L -> pl_vx -= V_CONVEYOR; CT_CONV_R -> pl_vx += V_CONVEYOR
C16 if held(BTN_DOWN) and pressed(BTN_JUMP | BTN_UP):
        pl_drop = T_DROP_THROUGH; if pl_vy < V_DROP_THROUGH: pl_vy = V_DROP_THROUGH
C17 pl_h = rule of C6 with the final pl_vy (14 while PF_CLIMB);  pl_prev_vy = pl_vy
```

Out of milestone 1 (do not implement, rooms must not rely on them): crates
(the object is dropped by the converter), quicksand, sticky, wind, gravity
zones, springs, feather air jump, moving platforms, gun, breakable bricks and
the butt-stomp impact grace (in WAMP it only breaks bricks/crates; enemies are
stomped by the plain 6.3 rule).

### 5.6 Timer semantics

All timers are byte frame counters, "active" while > 0. Player timers are
decremented in C0 only (so they freeze during hitstop, pause and death). The
`T_*` values already account for where each timer is set and tested:

| Timer | Set by (value) | Tested by | Net behaviour (RP §17) |
|---|---|---|---|
| `pl_coyote` | C8 (7) | C11 | jump accepted on airborne frames 1..6 |
| `pl_jumpbuf` | C11 (8) | C11 | press frame + next 7 |
| `pl_wjbuf` | C11 (15) | C11 | press frame + next 14 |
| `pl_protect` | C11 (5) | C11 | launch frame + next 4 uncut |
| `pl_wall_grace` | C7 (9) | C7 | wall jump up to 8 frames after last contact |
| `pl_wj_lock` | C11 (15) | C9, C7 | vx forced 14 frames; steer-back from frame 8 |
| `pl_stomp_flip` | C5 (12) | C13, Integrate | hover 12 frames, 12 integrations without gravity |
| `pl_kb_timer` | `Player_Damage` (13), `Player_Sword` (6) | C9 | hurt: 12 forced frames; weapon: 5 |
| `pl_invuln` | `Player_Damage` (60) | `Player_Damage` | immune on the next 59 frames |
| `pl_drop` | C16 (14) | Integrate | one-way ignored for the next 14 integrations |
| `pl_bounce_grace` | ScanTiles / bounce pad (12) | C11, ScanTiles | no release cut for 11 frames |
| `pl_sword_*` | `Player_Sword` | `Player_Sword` | ticked at the start of `Player_Sword`, 5.9 |
| `pl_land_timer` | `Player_Animate` (7) | `Player_Animate` | ticked at the start of `Player_Animate`, 5.10; visual only |

### 5.7 Corner correction (RP §9)

Trigger in C1: `pl_prev_vy < 0` and `pl_blocked & BLK_UP` and `pl_vy <= 0`.

```
pref = pl_vx > 0 ? +1 : -1
for d = 1..4: for s in (pref, -pref):
    dx = s * d
    if Coll_BoxFree(x-5+dx, y-pl_h-1, x+4+dx, y-1):       ; body shifted, 1 px taller
        pl_x += dx;  pl_vy = min(0, pl_prev_vy + V_GRAVITY);  clear BLK_UP;  done
```

### 5.8 Crumbling cells (RR §6.2)

`crumble_tab` holds `CRUMBLE_MAX` = 24 entries `{cell index (w), timer, phase}`
(a running player starts a new cell every 6.4 frames and a cell lives >= 144
frames, i.e. ~22 concurrent). `Room_StartCrumble` (called by the contact scan
every frame the player stands on the cell): a cell already in the table is not
added twice; if the table is full nothing happens and the next frame's contact
scan retries. Phase 1 (shake,
`T_CRUMBLE_SHAKE` frames, no visual shake in M1) -> `Room_SetCell(cell,
TC_EMPTY, 0)` -> phase 2 (`T_CRUMBLE_RETURN` frames) -> when the timer is 0 and
the player's body does not intersect the cell: `Room_SetCell(cell, TC_CRUMBLE,
Room_CellWord(cell))` and the entry is freed. Room reload clears the table.

### 5.9 Sword, damage, death (RP §14-15, RO §8)

`Player_Sword` (runs after `Player_Control`): tick `pl_sword_cd`,
`pl_sword_active`, `pl_sword_anim`. If `pressed(BTN_SLASH)` and `pl_sword_cd == 0`:
`pl_sword_cd = 14`, `pl_sword_active = 6`, `pl_sword_anim = 11`, flags =
downward if (not grounded and `held(BTN_DOWN)`), facing latched in
`pl_sword_flags` bit 2 (hitbox and sprite use it while `pl_sword_anim > 0`); downward:
`if pl_vy < V_SLASH_DOWN_MIN: pl_vy = V_SLASH_DOWN_MIN`. While
`pl_sword_active > 0`: `Obj_SwordHit(rect)` with the rects in `constants.inc`
(`SWORD_*`, mirrored for facing left, relative to (`pl_x`, `pl_y`)). On the first
connect of a swing: forward -> `pl_kb_vx = clamp(pl_vx + facing * V_SLASH_LUNGE,
+-V_WEAPON_KB_MAX)`, `pl_kb_timer = T_WEAPON_KB`; downward -> `pl_vy = V_POGO_NEG`.

`Player_Damage(reason)`: ignored if `pl_dead`, `DBG_GODMODE` or `pl_invuln > 0`.
`pl_hearts -= 1`; if 0 -> `Player_Kill`. Else hurt: `pl_invuln = T_INVULN`,
`pl_kb_vx = -pl_facing * V_HURT_X`, `pl_kb_timer = T_HURT_KNOCKBACK`,
`pl_vy = V_HURT_Y_NEG`, clear `PF_STOMP | PF_CLIMB`, `pl_stomp_flip = 0` (else
the hover would cancel gravity and the knockback), `pl_coyote = pl_jumpbuf =
pl_wjbuf = 0`, `Hud_ShowMsg(MSG_LOST_HEART)`, `dbg_last_death = reason`. While `pl_invuln > 0` the sprite is hidden on
frames where `(pl_invuln & 4) != 0`.

`Player_Kill(reason)`: ignored if `pl_dead` or `DBG_GODMODE`; `deaths += 1`,
`dbg_last_death = reason`, `Game_SetState(GS_DYING)` (which shows the reason,
`MSG_YOU_FELL` or `MSG_HIT`). Respawn (4.2): feet at `pl_respawn`, zero
velocity, movement state cleared, hearts refilled. Objects are NOT reset by a
death; the goal run and timer continue.

### 5.10 `Player_Animate` (source: `playerPresentation.ts:218-306`)

```
tick pl_land_timer (decrement if > 0)
if PF_GROUNDED and not pl_was_grounded: pl_land_timer = T_LAND_ANIM
pl_was_grounded = PF_GROUNDED
want = first match:
  pl_sword_anim > 0                 -> pl_sword_flags bit 0 ? PA_SLASH_DOWN : PA_SLASH
  PF_CLIMB                          -> PA_LADDER
  PF_WALLSLIDE                      -> PA_WALL_SLIDE
  PF_WJ_ACTIVE                      -> PA_WALL_JUMP
  PF_STOMP                          -> pl_stomp_flip > 0 ? PA_STOMP_FLIP : PA_CROUCH
  not PF_GROUNDED                   -> pl_vy < V_ANIM_RISE_NEG ? PA_JUMP_RISE : PA_JUMP_FALL
  PF_CROUCH                         -> |pl_vx| > V_ANIM_CRAWL_MIN ? PA_CRAWL : PA_CROUCH
  pl_land_timer > 0                 -> PA_LAND
  inputX == 0 and pl_contact & (CT_ICE | CT_CONV_L | CT_CONV_R) -> PA_IDLE
  inputX != 0                       -> PA_RUN
  |pl_vx| > V_ANIM_RUN_MIN          -> PA_RUN
  else                              -> PA_IDLE
if want != pl_anim: pl_anim = want; pl_anim_pos = 0; pl_anim_timer = hold
else: pl_anim_timer -= 1; at 0: pl_anim_timer = hold;
      pl_anim_pos += 1; at count: loop ? 0 : count - 1
pl_frame = PlayerAnimFrames[first + pl_anim_pos]
if pl_frame != pl_frame_loaded:
    plchr_req = 0;  r = PlayerFrameTable[pl_frame]
    plchr_bank = BANK_PLAYERGFX + r.bank;  plchr_addr = r.addr
    plchr_len = min(r.n, 8) * 64;  plchr_len2 = max(r.n - 8, 0) * 64
    plchr_req = 1                       ; set LAST (the NMI may fire in between)
```

`Player_Spawn` sets `pl_anim = PA_IDLE`, `pl_anim_pos = 0`, `pl_land_timer = 0`,
`pl_was_grounded = 1`, `pl_visible = 1`. `Player_Draw` draws the cells of
`pl_frame` (2.2) unless `pl_visible == 0` or the invulnerability blink hides it;
while `pl_sword_anim > 0` it uses the latched facing.

---------------------------------------------------------------------------

## 6. Objects, goals, HUD

### 6.1 Slot table

64 slots x 32 bytes at `obj_table`; X = slot offset (`slot << 5`); field offsets
`OBJ_*` in `wram.inc`. Slot `i` holds blob record `i`; unused slots have
`OBJ_TYPE = 0`. Position = anchor = body bottom-centre, 16.8 like the player:
body = `[x - hw, x + hw) x [y - h, y)`. Removed objects keep their slot with
`OF_HIDDEN` (no draw, no interaction, not solid).

`objects.s` holds three tables indexed by `OT_*`: `ObjTypeTable` (4 bytes per
type, `OTT_*`: hw, h, initial `OF_*`, 0; `Obj_SpawnAll` adds `OF_LEFT`, `OF_FG`,
`OF_BG` from the record), `ObjUpdateTable` (`.addr`, called with X = slot offset, may clobber
everything but must return X), `ObjTouchTable` (`.addr`, called when the
interaction test of 6.3 passes). Drawing is generic (`ObjGfxTable`, 2.3).

### 6.2 Types

Body from RO §2.2; anchor = WAMP `(x + ax, y + ay)`.

| Type | hw, h | ax, ay | Update | Touch (6.3 test) |
|---|---|---|---|---|
| coin_gold, coin_silver, gem, star, heart, key | 6, 12 | 0, +6 | animate | sensor: collect |
| spikes | 7, 10 | 0, +8 | animate | body: `Player_Damage` |
| saw (static) | 12, 24 | 0, +12 | animate | body: `Player_Damage` |
| fire | 6, 14 | 0, +7 | animate | body: `Player_Damage` |
| bounce_pad | 8, 8 | 0, +16 | timer | body: launch |
| ladder | 8, 51 | 0, +32 | - | none (`Obj_FindLadder`, ladder top) |
| checkpoint_flag | 6, 28 | 0, +16 | animate | body: activate |
| door_locked | 16, 48 | +2, +28 | - | solid (`OF_SOLID`); unlock on push (player only) |
| slime_blue, slime_red | 6, 10 | 0, +8 | patrol `V_SLIME` | body: enemy |
| crab | 12, 10 | 0, +8 | patrol `V_CRAB` | body: enemy |
| bat | 12, 20 | 0, +10 | fly | body: enemy |
| frog | 12, 24 | 0, +16 | hop | body: enemy |
| exit (`OT_EXIT`) | - | marker point | animate | marker: `Goal_OnMarker` |
| sprint checkpoint (`OT_SPRINT_CP`) | - | marker point | animate | marker: `Goal_OnMarker` |

Enemy behaviours (RO §6). All: `dir` = `OF_LEFT`; gravity `V_GRAVITY` and clamp
`V_MAX_Y` except the bat; move with `Coll_MoveX/Y` (`ONEWAY | SOLIDOBJ`);
`OF_ONFLOOR` = `BLK_DOWN`. After every enemy move x is clamped to
`[hw + 2, 640 - hw - 2]`: enemies never leave the room and never read the
neighbour ring.

| Behaviour | Per frame |
|---|---|
| reverse test (patrol; frog EVERY frame, airborne included) | reverse `dir` if (a) blocked in the travel direction last move, or (b) `x <= hw + 2` moving left / `x >= 640 - hw - 2` moving right, or (c) ONLY while on the floor: no ground ahead: with `px = x + dir * (hw + 4)`, ground exists if `solid(px, y + 2)` or `solid(px, y + 17)` (one-way counts as solid here) |
| patrol | reverse test; `vx = dir * speed` |
| fly (bat) | `vx = dir * V_BAT`; reverse if blocked or `x` outside `[14, 626]` (clamp); no gravity; `OBJ_PHASE += 1`; `vy = clamp((OBJ_HOME_Y + BatSine[OBJ_PHASE & 31] - y) << 8, -V_BAT_MAX_Y, +V_BAT_MAX_Y)` (target minus the current pixel y); then `Coll_MoveX`, `Coll_MoveY` like every enemy, so a bat pinned by a floor or ceiling stops (vy zeroed by the collision) instead of entering it; `BatSine[i] = round(6 * sin(2*pi*i/32))` |
| hop (frog) | `OBJ_TIMER` starts at `T_FROG_FIRST`, decrements every frame (floor 0). Every frame first the reverse test ((a), (b) always, (c) on the floor). On floor: `vx = 0`; if timer == 0: `vx = dir * V_FROG_X`, `vy = V_FROG_HOP_NEG`, timer = `T_FROG_DELAY`. Airborne: `vx = dir * V_FROG_X` (so a mid-air reversal turns the frog around at once) |
| fall-out | an enemy with `y > 352 + 64` is respawned at `OBJ_HOME` with its initial direction |

### 6.3 Player-object interactions (`Obj_InteractPlayer`, skipped while `pl_dead`)

Rectangles (strict overlap, touching edges do not count):
body = `[pl_x-5, pl_x+5) x [pl_y-pl_h, pl_y)`; sensor = `[pl_x-5, pl_x+5) x
[pl_y-pl_h-15, pl_y)`; marker = `|dx| <= 18 and |dy| <= 18 and |dx| + |dy| <= 25`
with (dx, dy) = feet point minus marker point (octagon for the 18 px radius;
`GOAL_TOUCH_R`, `GOAL_TOUCH_DIAG`).

| Object | Rule |
|---|---|
| collectible | `OF_HIDDEN`; `collect_left -= 1`; `Score_Add`; `Goal_OnCollect`; heart: if `0 < pl_hearts < pl_hearts_max`: `pl_hearts += 1`, `MSG_HEART`; key: `keys += 1`, `room_keys_taken += 1`, `MSG_KEY`. Every collectible type counts for `collect_target` |
| hazard | `Player_Damage(MSG_HIT)` every frame of overlap (invulnerability gates it) |
| enemy | stomp if `pl_vy > V_STOMP_MIN` and `pl_y <= (obj_y - obj_h) + ENEMY_STOMP_TOL`: `pl_vy = jumpHeld ? V_JUMP_NEG : V_STOMP_BOUNCE_NEG`, defeat. Else `Player_Damage(MSG_HIT)` |
| defeat (stomp or sword) | `OF_HIDDEN`, `Score_Add(10)`, `enemies_left -= 1`, `hitstop = T_HITSTOP`, `Goal_OnDefeat` |
| bounce_pad | if `OBJ_TIMER == 0` and `pl_vy >= V_BOUNCE_MIN_NEG` and `pl_y <= pad_top + PAD_TOP_TOL`: `pl_vy = V_BOUNCE_NEG`, `pl_bounce_grace = T_BOUNCE_GRACE`, `OBJ_TIMER = T_PAD_COOLDOWN`; strip frame 1 while `OBJ_TIMER > T_PAD_COOLDOWN - T_PAD_ACTIVE` |
| checkpoint_flag | first touch: `OF_ACTIVE`, `pl_respawn = (obj_x, obj_y)`, `MSG_CHECKPOINT`; drawn with `OBJPAL_ALT_GREEN` once active |
| door_locked | `OF_SOLID` for every mover. When `Obj_SolidX/Y` blocks a mover with `MVO_PLAYER` on it: `keys > 0` -> `Goal_OnDoor`, `OF_HIDDEN`, `MSG_UNLOCKED`; else `MSG_NEED_KEY` at most every `T_NEED_KEY_MSG` frames (`needkey_timer`, ticked in `Obj_UpdateAll`) |
| ladder | `Obj_FindLadder`: nearest ladder (Manhattan distance of centres) whose body intersects the player body. Ladder top (in `Obj_SolidY`, only with `MVO_PLAYER`, only in the `vy >= 0` branch): a one-way surface `2 * LADDER_TOP_HW` = 18 px wide centred on the ladder at `top = obj_y - 51 + LADDER_TOP_INSET`; it supports the player (`y = top`, `vy = 0`, `BLK_DOWN`) if not `PF_CLIMB`, not `held(BTN_DOWN)`, not `MVO_DROPTHRU`, and `top <= y <= top + LADDER_TOP_TOL` (current bottom, RO §5.4; `mv_prev_y` is not used) |
| exit / sprint markers | 6.5 |

### 6.4 Sprite budget and OAM allocation

- OAM is rebuilt every frame with a bump allocator (`oam_ptr`): `Oam_Begin`
  (which also zeroes the whole high table, so no entry keeps last frame's size
  or x-bit-8), player pieces first (<= 12 entries, drawn with `Oam_Add`), then
  objects with `Oam_AddLimited`; `Oam_Finish` parks the rest at y = 240 (16x16,
  x bit 8 clear: fully off-screen). If all 128 entries are used further sprites
  are dropped.
- Hardware limit: 34 8-px slivers and 32 sprites per scanline, and on overflow
  the PPU drops the LOWEST-index sprites first, i.e. the player. Rule: the player
  has 10 slivers reserved on every line (at most 5 cells per scanline, enforced
  by the converter, 2.2); objects may use at most `BAND_OBJ_MAX` = 24.
  `band_load[b]` counts object slivers per 16-px screen band; a piece of width
  `w` (2 or 4 slivers) at screen y `sy` and height `hgt` touches bands
  `b0 = max(sy >> 4, 0) .. b1 = min((sy + hgt - 1) >> 4, OAM_BANDS - 1)`
  (arithmetic shift; partly off-screen sprites are clamped, never indexed
  outside 0..13) and is drawn only if `band_load[b] + w <= 24` for each of them,
  then added to each.
- **All objects, including static collectibles, are sprites, and they are cycled:**
  `Obj_DrawAll` starts at slot `obj_draw_start` and wraps;
  `obj_draw_start = (obj_draw_start + 7) & 63` every frame. When a band is
  over budget, different objects are skipped on different frames (flicker
  instead of permanent dropout); the player never flickers.
- Converter: more than 64 objects in a room, or more than `OBJ_GFX_ROWS` strip
  rows (2.3), is an ERROR. Sprite density is only a WARNING (the limiter turns
  it into flicker; interaction is unaffected): any 256-px window of a 16-px row
  band containing more than 12 objects of 16 px width (32x32 counts 2, in both
  of its bands).

### 6.5 Goals (RO §7; `goal.s`)

`Goal_Init` (every room load): `keys = max(0, keys - room_keys_taken)`,
`room_keys_taken = 0` (the room being left is reset, so the keys it handed out
go back with it, RO §5.7; `room_keys_taken` counts key pickups and is reduced,
floor 0, when a door of the same room consumes a key; `GS_TITLE` zeroes both);
fields from the header; `goal_ticks = 0`,
`goal_limit = seconds * 60`, `goal_result = GR_ACTIVE`, `goal_progress = 0`,
`goal_cp_next = 0`. `Goal_Update` (step 7): while `GR_ACTIVE` and goal != none:
`goal_ticks += 1` (saturating; not during hitstop/pause/death beat/intro); if
`goal_limit != 0` and `goal_ticks >= goal_limit`: `GR_FAILED`, `MSG_TIME_UP`.

| Goal | `goal_target` | Completes when |
|---|---|---|
| `GOAL_REACH_EXIT` | - | player touches `OT_EXIT` (marker test) |
| `GOAL_COLLECT_TARGET` | param | `goal_progress` (collectibles picked up in this room) `>=` param |
| `GOAL_DEFEAT_ALL` | param | `goal_progress` (enemies defeated) `>=` param; param 0 completes at once |
| `GOAL_CHECKPOINT_SPRINT` | param | `OT_SPRINT_CP` markers touched in order (`OBJ_PARAM == goal_cp_next`: `goal_cp_next += 1`, `goal_progress += 1`, marker gets `OF_ACTIVE` + green palette, `pl_respawn` = marker point), then `OT_EXIT`(1) touched with `goal_cp_next == param` |

Completion: `goal_result = GR_COMPLETE`, exit flags switch to `OBJPAL_ALT_GOLD`,
`Game_SetState(GS_GOAL)`. Nothing auto-advances. After `GR_COMPLETE`/`GR_FAILED`
markers are inert and the timer is frozen.

Deliberate deviations from WAMP: no "practice run until the spawn is touched"
after walking in (the run and timer start on every room entry); a room is always
reset when re-entered, goal or not (WAMP keeps goal-less rooms as they were);
the pickup `score` is the only score, it is cosmetic and is NOT reset with the
room (WAMP zeroes it on a challenge reset), so re-entering a room can farm it;
keys cannot be farmed (above); no respawn fade-in; `MSG_GOAL_START` is shown
only after the intro box, not on walk-in entries.

### 6.6 HUD (BG3, 8x8 cells, 32x28 visible; `HUD_*` in `constants.inc`)

| BG3 row | Cols | Content | Example |
|---|---|---|---|
| 1 | 1-16 | room title, upper-cased, 16 chars | `ALL THAT GLITTER` |
| 1 | 18-20 | hearts: `HT_HEART_FULL` / `HT_HEART_EMPTY` x `pl_hearts_max`; blank when max is 1 | |
| 1 | 23-30 | `HT_CLOCK` + `MM:SS.t` elapsed, or remaining when `goal_limit != 0`; blank when goal = none | `01:07.3` |
| 2 | 1-12 | goal icon + text: `EXIT`, `nn/mm` (collect: `HT_COIN`, defeat: `HT_ENEMY`, sprint: `HT_FLAG`); `CLEAR!` when complete, `TIME UP` when failed | `03/05` |
| 2 | 14-16 | `HT_KEY` `x` digit; blank when `keys == 0` | |
| 2 | 20-30 | `SCORE` + 5 digits | `SCORE 00042` |
| 25 | 0-31 | transient status message, centred, `T_STATUS_MSG` frames | `NEED A KEY` |
| 11-14 | 0-31 (text in 4-27) | room intro box in `GS_ROOM_INTRO` only: row 11 title (upper-cased, centred), row 12 goal line, row 13 blank, row 14 `PRESS B` | |

`hud_buf` is the tilemap image of rows 1-2 (2 x 32 words), `hud_msg_buf` row 25,
`hud_intro_buf` rows 11-14 (4 x 32 words; `Hud_DrawIntro` renders it,
`Hud_ClearIntro` zero-fills it, both set `HUD_DIRTY_INTRO`; one 256-byte NMI
DMA, so the box appears and disappears in a single frame without the VRAM
queue). Goal line (RO §10.1): `REACH THE EXIT`, `COLLECT nn`, `DEFEAT nn
ENEMIES`, `REACH nn CHECKPOINTS`. The HUD icons `HT_*` have no WAMP source:
they are 8x8 bitmaps drawn inside `tools/mkassets.py`.

Status messages (`MsgTable` in hud.s, upper case, <= 30 chars) and who shows them:

| Id | Text | Shown by |
|---|---|---|
| `MSG_GOAL_START` | `GO!` | leaving `GS_ROOM_INTRO` |
| `MSG_GOAL_DONE` | `GOAL COMPLETE!` | `GS_GOAL` entry |
| `MSG_TIME_UP` | `TIME UP` | `Goal_Update` |
| `MSG_CHECKPOINT` | `CHECKPOINT` | checkpoint flag, sprint checkpoint |
| `MSG_NEED_KEY` | `NEED A KEY` | door (throttled) |
| `MSG_UNLOCKED` | `UNLOCKED THE DOOR` | door |
| `MSG_LOST_HEART` | `YOU LOST A HEART` | `Player_Damage` |
| `MSG_HEART` | `HEART RESTORED` | heart pickup that healed |
| `MSG_KEY` | `KEY COLLECTED` | key pickup |
| `MSG_YOU_FELL` | `YOU FELL` | `GS_DYING` entry (reason) |
| `MSG_HIT` | `YOU WERE HIT` | `GS_DYING` entry (reason) |
| `MSG_PAUSED` | `PAUSED - SELECT: RESTART` | `GS_PAUSE` entry |

`Hud_Update` re-renders only the fields flagged in `hud_redraw` (owners of the
underlying values set the `HUD_RD_*` bit when they change them; the timer field
is refreshed by `Hud_Update` itself when the displayed tenth changes) and sets
`hud_dirty`. Tenths: `t = goal_ticks / 6`.

---------------------------------------------------------------------------

## 7. Test strategy

### 7.1 Observability

Tests use `tools/emu.py` and read WRAM by label (all `wram.inc` names are in
`build/sneswamp.lbl`). The stable test surface:

| Purpose | Labels |
|---|---|
| frame sync | `frame_counter`, `game_frame`, `lag_frames`, `game_state`, `room_load_count` |
| player | `pl_x`, `pl_xsub`, `pl_y`, `pl_ysub`, `pl_vx`, `pl_vy`, `pl_h`, `pl_state`, `pl_blocked`, `pl_contact`, `pl_facing`, `pl_hearts`, `pl_invuln`, `pl_dead`, `pl_anim`, `pl_frame`, timers `pl_coyote`.. |
| input | `joy1`, `joy1_pressed` |
| room | `room_index`, `room_x`, `room_y`, `room_nbr`, `room_flags`, `coll_map`, `nbr_edge_l/r/u/d`, `dbg_checksum`, `bg1_map_buf` |
| objects | `obj_table + slot*32 + OBJ_*`, `enemies_left`, `collect_left`, `objgfx_base` |
| goal/HUD | `goal_type`, `goal_result`, `goal_progress`, `goal_ticks`, `score`, `keys`, `room_keys_taken`, `deaths`, `hud_buf`, `hud_msg_id`, `hud_intro_buf` |
| rendering | `cam_x`, `cam_y`, `oam_shadow`, `oam_shadow_hi`, `pl_frame_loaded`, `emu.vram()`, screenshots |

### 7.2 Debug hooks

| Hook | Behaviour |
|---|---|
| `dbg_warp_room` | checked by `Main` every frame in every state: if non-zero, `room_next = value - 1`, `room_entry = RE_SPAWN`, clear the byte, go to `GS_ROOM_LOAD` (no fade; legal because `Room_Load` step 0 enters force blank itself). A test pokes it any time after ~30 frames, then waits for `room_load_count` to change and `game_state == GS_PLAY` |
| `dbg_flags` | `DBG_GODMODE`, `DBG_FREEZE_OBJ`, `DBG_SKIP_INTRO` (also auto-starts the title), `DBG_NO_TIMER`; poked by tests, zero in normal play |
| `dbg_last_death` | last `MSG_*` reason passed to `Player_Damage`/`Player_Kill` |
| `dbg_checksum` | byte sum of `coll_map`; the room converter writes the expected value per room to `gen/rooms.json` (`checksum`) |
| pokes | tests may poke `pl_x`, `pl_y`, `pl_vx`, `pl_vy`, `keys`, `pl_hearts` between frames to set up scenarios |

Dedicated test rooms (ordinary blobs built from `snes/rooms/test_*.json` by
owner F to E's specification, isolated coordinates, indices published in
`gen/rooms.json`): `test_flat` (floor at row 20, walls at both ends, a
3-tile and a 4-tile-high step, a ledge, a 1-tile hole in the floor for the gap
assist), `test_walls` (shaft 3 tiles wide, 1-tile ceiling notch for corner
correction, low tunnel), `test_tiles` (one-way, bounce, damage, damage on the
background layer over solid ground, ice, a 10-cell crumbling bridge, water,
conveyors), `test_objects_a` (coin_gold, coin_silver, gem, heart, key, star,
spikes, fire, bounce_pad, ladder, slime_blue, slime_red, crab: 26 strip rows;
`collect_target`), `test_objects_b` (saw, checkpoint_flag, door_locked + key,
bat, frog, exit: 26 rows with the key; `reach_exit`), `test_edge_a/b` (two
horizontal neighbours for transitions; `a`: `defeat_all` with two slimes;
`b`: `pitsAreDeadly`, `checkpoint_sprint` with two checkpoints, and a solid
block in column 0 at floor level facing an open column 39 of `a`, for the seam
collision test).

### 7.3 Golden physics targets

`tests/physmodel.py` (to be written by the test engineer) is the integer
reference: per frame `vy = clamp(vy + 50, -2133, 2133); y24 += vy; x24 += vx`,
then the controller rules of 5.5. On `test_flat` the ROM must match it
**exactly, frame by frame** (`pl_y`, `pl_ysub`, `pl_vy`). Closed-form checks
(RP §18; pixel values are `floor`):

| Scenario | Expected |
|---|---|
| run right 60 frames | `pl_x` advances exactly 150 px; `pl_vx = $0280` |
| crawl 256 frames | 299 px |
| full held jump | first moving frame `pl_vy = $FB87`; apex 53.46 px (`pl_y` minimum = start - 54); `PF_GROUNDED` clear for 47 frames (+-1); horizontal travel while holding right 117.5 px (+-3) |
| 1-frame tap jump | apex 17.96 px (`pl_y` minimum = start - 18), 24 frames (+-1) |
| free fall from rest | `pl_vy` reaches `$0855` on frame 43 and stays |
| wall slide | `pl_vy = $012B` after `Player_Control`; descent 349/256 px per frame |
| wall jump | launch `pl_vx = +-$036B`, `pl_vy = $FB95`; vx forced for 14 frames; opposite input ignored until frame 8 |
| coyote | jump press on airborne frame 6 jumps; on frame 7 it only buffers |
| jump buffer | press 7 frames before landing jumps on the landing frame; 8 frames does not |
| butt stomp | 12 frames at v = 0, then `pl_vy = $0855` |
| bounce tile / pad | `pl_vy = $F977` on launch; apex 106.5 px (+-2) with jump held; no release cut during the first 11 frames when not held |
| enemy stomp | read at the end of the frame (after step 6): `pl_vy = $FDB2` when jump is not held (the `$FD4B` bounce is release-cut in the same frame: `-((693 * $DA) >> 8)`), `$FB55` when held; `score += 10`; `hitstop = 3`. Likewise the hurt pop reads `$FE4C` (`$FE00` cut once) when jump is not held; the down-slash pogo reads `$FC80` (set after `Player_Control`) and is cut from the next frame on |
| water | sink speed `$01F7 + $32` per frame; kick sets `$FD33` |
| crouch tunnel | `pl_h = 14`, forced crouch under a 1-tile ceiling, jump ignored |
| step height | a 3-tile ledge is reachable, a 4-tile ledge is not |
| deadly pit / edge wall | death at `pl_y >= 351`; with no neighbour `pl_x` stops at 17 / 623, `pl_y` at 340 |
| transition | walking off the right edge: `room_index` = neighbour, `pl_x` = old - 640, `pl_vx` unchanged; `keys` reduced by `room_keys_taken` |
| seam | a solid cell in column 0 of the right neighbour stops the player at `pl_x = 635` with no transition (`room_load_count` unchanged) |
| gap assist | running over a 1-tile hole: `pl_y` constant, `PF_GROUNDED` stays set; with Down held the player falls in |
| hitstop input | a jump pressed (and released) during the 3 hitstop frames after a stomp still jumps on the first simulated frame |
| first frame | on the first frame with `INIDISP != $80` after a load, `oam_shadow` holds the new room's objects and `pl_frame_loaded == pl_frame` |
| performance | `lag_frames == 0` after 600 frames in the busiest room, on both cores |

Every test runs on snes9x and bsnes-mercury (`CORES` in the existing harness).
The pipeline-demo tests are replaced when `main.s` is; `test_rom_header`,
`test_labels`, `test_input_script_parser` and `test_cli` stay.
