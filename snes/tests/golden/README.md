# Golden physics traces (web game -> SNES port)

Per-step traces of the **real** WAMP player physics, recorded headless from the web game's own code:
`OverworldMovementController`, `OverworldPhysicsCadence`, `OverworldJumpCornerCorrection`,
`OverworldSpecialTilesController` (one-way rule + drop-through) and unmodified Phaser Arcade physics
(`World`, `Body`, `Collider`, tilemap separation) at Phaser **3.90.0** (what `package-lock.json` resolves
`^3.87.0` to). They are the numeric reference for `Player_Integrate` / `Coll_Move*` / `Player_Control`.

* 47 trace files `NN_name.json` (45 scenarios + 2 quirk probes `q*`), one scenario each.
* `_summary.json`: the `events` block of every trace in one file (files starting with `_` are not traces).
* `gen/`: the generator (source only).
* `verify_traces.py`: independent checker (no code shared with the generator), see "Verification".
* `layout_to_room.py`: trace layout -> WAMP RoomSnapshot JSON for `tools/mkrooms.py`.

## Regenerating

```sh
snes/tests/golden/gen/run.sh [SCRATCH_DIR]     # default SCRATCH_DIR = $TMPDIR/sneswamp-golden
```

The script copies `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts` and `src/` into
the scratch directory, runs `npm ci --ignore-scripts` **there** (never in the repo), copies
`gen/snesGolden.gen.test.ts` to `src/scenes/overworld/` of the copy and runs

```sh
GOLDEN_OUT=<repo>/snes/tests/golden npx vitest run src/scenes/overworld/snesGolden.gen.test.ts
```

Output is deterministic (two runs are byte-identical). Node 22, about 2 s after the install.

### What is real and what is stubbed

| Part | Source |
|---|---|
| Movement controller, wall/ladder/stomp state, corner correction, physics cadence | repo code, unmodified |
| Tuning constants | copied from `OverworldPlayScene.ts:417-466` (speed 150, jump -280, gravity 700, ...) and `playerLifecycle.ts:76` (max vy 500) |
| Arcade `World`/`Body`/`Collider`, `SeparateTile`, `TileCheckX/Y`, `Tile`, `LayerData`, `SetCollisionByExclusion`, `CalculateFacesWithin` | `phaser/src/...`, unmodified |
| Collision layer | built like `fullRoomPresenter.ts`: one `Tile` per cell from `getTerrainCollisionTileValue`, `setCollisionByExclusion([-1])`, collider with process callback `specialTiles.shouldCollidePlayerWithTerrainTile` |
| Room | a real `RoomSnapshot` (`createDefaultRoomSnapshot`), terrain gid 29 (forest, solid) for `#`, gid 670 for `=` |
| `isSolidTerrainAtWorldPoint` | copy of `OverworldPlayScene.ts:3437-3453` on top of the real `terrainTileCollidesAtLocalPixel` |
| Player object | plain object with the fields Arcade reads from a `Rectangle` (10x26, origin 0.5/0.5, `getTopLeft`) |
| `phaser` package entry | mocked (needs a browser); only `Geom.Rectangle`, `Intersects.RectangleToRectangle`, `Math.Clamp/Linear` are used and they are the real modules |
| Not present | edge walls, neighbour rooms, room transitions, pit death, objects, enemies, sword, special-tile environment scan (no water/ice/bounce/damage), audio, FX |

Because there are no edge walls and no pit line, every trace keeps the body centre inside x = 82.5..418.667
and the feet at y <= 336 (the generator asserts 32 <= x <= 608), clear of the port's edge walls (`MVO_EDGEWALLS`: x < 12, x >= 628).

## Trace schema

```jsonc
{
 "scenario": "01_jump_held",
 "description": "...",
 "generator": { "phaser": "3.90.0", "step_hz": 60, "gravity_px_s2": 700, "max_velocity_y_px_s": 500, "lead_in_idle_steps": 5 },
 "units": { "position": "px, room-local", "velocity": "px/s", "timers": "ms (rounded)", "step": "1/60 s" },
 "anchor": "x = body centre, y = feet (body bottom)",
 "layout": { "legend": {".":"empty","#":"solid","=":"one-way platform (gid 670)"}, "tile_px": 16,
             "rows": ["<40 chars>", ... 22 rows, row 0 = top], "spawn_feet": {"x":104,"y":320} },
 "events": { ... scenario-specific key numbers ... },
 "inputs": ["", "", "", "", "", "J", "J", ...],          // inputs[i] = buttons held during step i+1
 "steps": [ {"step":0, ...}, {"step":1, ...}, ... ]      // steps[k].step === k
}
```

### Layout and spawn

`layout.rows[y][x]` is the 40x22 collision mask (cell = 16x16 px, origin top-left). `#` = `TC_SOLID`,
`=` = `TC_ONEWAY`, `.` = `TC_EMPTY`. `spawn_feet` is the room `spawnPoint` convention: bottom-centre of
the body. The body is 10 px wide, 26 px tall when standing (14 px airborne / crouched), always
bottom-aligned, so the body rectangle is `[x-5, x+5] x [y-h, y]`. Initial velocity is (0, 0).

### Input script

`inputs[i]` (also `steps[i+1].in`) is the set of buttons **held** during physics step `i+1`, as a string
over `L R U D J` (d-pad and the jump button; `U` is also a jump button in WAMP but is never used here).
Pressed edges are derived exactly like a joypad: `pressed = held_now & ~held_previous_step`
(`steps[k].pressed`). The first 5 steps of every scenario are idle. Some scenarios were produced with a
closed-loop script (wall jumps, one-way); the stored `inputs` are the resolved open-loop buttons, so the
SNES test only has to replay them.

### One step, and when values are sampled

Step `k` (k >= 1) is one Arcade fixed step = one SNES frame in `GS_PLAY`:

1. integrate: `vy += 700/60` (if gravity on), clamp `|vy| <= 500`, `pos += v/60`;
2. tile collision / separation (sets `blocked.*`, zeroes the blocked velocity component);
3. controller (`updateMovement`) with `inputs[k-1]`: corner correction, grounded test, gap assist,
   crouch/hitbox, walls, coyote/buffer, sets the velocity for the **next** step; then the scene's
   `if (down && jumpPressed) beginOneWayDropThrough()`.

Every record is taken **after 3** (end of frame, the same point at which the SNES tests read WRAM).
`steps[0]` is the spawn state before any step.

| Field | Meaning |
|---|---|
| `step` | step number, 0 = spawn state |
| `in`, `pressed` | buttons held / newly pressed on this step |
| `x`, `y` | body centre x and feet y in px (`pl_x`, `pl_y` + subpixel), after collision and controller |
| `vx`, `vy` | velocity in px/s **after the controller** = what the next step will integrate (`pl_vx`, `pl_vy` at end of frame) |
| `pre_vx`, `pre_vy` | velocity after integration + collision, before the controller |
| `grounded` | the controller's `grounded` for this step (`blocked.down` or gap assist) |
| `h` | body height after the controller, 26 or 14 (`pl_h`) |
| `pre_blocked`, `blocked` | Arcade `blocked` flags before / after the controller, letters from `d u l r` (corner correction clears `u`) |
| `crouch` | crouching (held or forced) |
| `coyote_ms`, `jbuf_ms`, `wjbuf_ms`, `prot_ms` | coyote, jump buffer, wall-jump buffer, protected-rise timers after the step (rounded ms; frames = ms / 16.667) |
| `wall_slide`, `wall_side`, `wall_grace_side` | sliding flag, contact side incl. grace (-1 left, +1 right), grace side |
| `wj_active`, `wj_dir`, `wj_chain`, `wj_lock_ms` | wall-jump state; `wj_lock_ms` = remaining input lock |
| `corner_n`, `corner_shift` | number of corner corrections so far, last shift in px (signed) |
| `drop_ms` | remaining one-way drop-through window |
| `stomp`, `stomp_flip_ms`, `stomp_grace_ms` | butt stomp active, remaining flip pause, impact grace |

Floats are rounded to 6 decimals.

### Units and conversion to the port

Positions are px, velocities px/s, 60 steps/s. Port values: `v_8.8 = round(v / 60 * 256)` per frame
(`-280 -> $FB55`, `150 -> $0280`, `500 -> $0855`, `70 -> $012B`, `205 -> $036B`, `-265 -> $FB95`,
`86 -> $016F`, `520 -> $08AB`), gravity `700/3600*256 = 49.78 -> $32`. Because `$32` is 0.45 % strong
the port's `y` drifts from the trace by up to about 0.25 px during a full jump; compare **event steps
exactly or +-1** and positions with a tolerance (suggested: `|dy| <= 1 px`, `|dx| <= 0.5 px`), or compare
against `physmodel.py` exactly and `physmodel.py` against these traces with the tolerance.

## Scenarios and key numbers

Floor top is y = 320 (rows 20-21 solid) unless stated. "press" = step on which the button edge is consumed.

| File | What | Key numbers (web) |
|---|---|---|
| `01_jump_held` | full held jump, standing | press 6; first moving step vy -268.33, dy -4.4722; **apex 53.6667 px at press+23**; airborne steps 7..53 (**47**); y is back at exactly 320 on press+47 but `blocked.down`/`grounded` only on press+48 (step 54) |
| `02_jump_tap` | jump held 1 step | apex **17.9227 px** at press+10; airborne 23 steps, grounded at press+24 |
| `02_jump_hold_NN` | jump held 2/3/4/6/8/12 steps | apex 21.359 / 24.641 / 27.728 / 33.319 / 38.228 / 45.866 px |
| `03_jump_run_right` | full jump while running | press 16 at x=129; feet back at launch height on press+47 at x=246.5 (**117.5 px**); `grounded` on press+48 at x=249 (120 px) |
| `04_ledge_fall` | run off a ledge (top y=224, lip x=192) | last grounded step 24 (x=195, body left 190); first airborne step 25 (x=197.5, body left 192.5) |
| `04_coyote_air1/6/7` | jump on airborne step 1 / 6 / 7 | steps 1 and **6 jump** (`vy=-280`, `prot_ms=70`); **step 7 does not** (coyote 0, buffers 120/240 instead) |
| `04_coyote_air6_tap` | coyote jump, 1-step tap | protected rise: no cut on launch step + 4, first cut value visible on launch+5 |
| `05_buffer_1/7/8_before_landing` | fall 60 px, press N steps before the landing step (25) | N=1 and **N=7 jump on the landing step** (`prot_ms=70`); **N=8 does not** (jbuf 3 ms -> 0) |
| `05_buffer_7_tap` | buffered jump, button already released | launch 25, vy uncut through step 29, cut from step 30; apex 30.62 px |
| `06_wall_slide_jump` | shaft 48 px, 3 wall jumps | ground jump 18; slide starts when vy >= 0; vy ramps by gravity to the 70 cap, then **1.3611 px/step**; wall jumps on 46, 71, 96: `vx=+-205, vy=-265`, lock 240 ms |
| `06_wall_jump_lock` | wall jump, tap, steer back | launch 46; `vx=205` on steps 46..53 (**8 steps**), opposite input wins on **launch+8** (step 54); release cut active from launch+1 (unprotected) |
| `07_corner_01..05px`, `_10px` | head bump at a ceiling corner, overlap N px | N=1..4: corrected by +N px on the bump step (11), apex 51.25 px; **N=5, 10: no correction**, vy=0, apex 18 px |
| `07_corner_left_03px` | mirrored corner | shift -3 |
| `08_fall_terminal` | 296 px free fall | `vy=500` first on **step 43**; 8.3333 px/step; lands on step 57 |
| `09_wall_stop` | run into a wall at x=192 | blocked on step 40 at x=187 (right edge 192); post-controller `vx` stays 150 while pushing, `pre_vx` = 0 |
| `10_one_way` | up through a one-way (top y=272), land, drop through | passes upward untouched; lands step 38; Down+Jump on 49: `vy=86`, no one-way collision on the next 14 steps; floor on 65 |
| `10_one_way_walk_off_and_under` | walk off the end (airborne 18, floor 39), walk back under, jump up through diagonally (press 56), release, land on top | never blocked sideways or from below; lands on the platform on step 88 at x=82.5 (body 77.5..87.5 overhangs the platform edge at 80) |
| `11_crouch_crawl` | 16 px tunnel, x 160..256 | standing body stops at x=155; crouch on the first Down step (h=14, vx=70); forced crouch after releasing Down; Jump ignored; stands up on step 127 at x=261.17 |
| `11_crouch_idle` | crouch, crawl, Down+Jump on flat ground | 1.1667 px/step; Down+Jump never jumps but sets `vy=86` for one step (see findings) |
| `12_gap_assist`, `_left` | run over a 1-tile hole | y stays exactly 320, `grounded` true on every step; `blocked.down` false on steps 25-27 |
| `12_gap_down_held` | crawl (Down+Right) into the hole | assist off, 3 airborne steps, sinks to 321.17, **then lifted onto the far lip - the hole is still crossed** |
| `12_gap_stop_in_hole` | release Right over the hole | falls in (bottom y=336), then blocked by the hole wall at x=203 |
| `12_gap_two_tiles` | 2-tile hole | falls in, wall-slides down the far side |
| `13_butt_stomp` | butt stomp from a jump | start 21; **12 steps with v=0** (21..32); `vy=520` set on 33, integrates as 500; lands 39 |
| `14_gap_7/8_tiles_last_ground` | jump on the last grounded step | 7 tiles (112 px) cleared; **8 tiles (128 px) missed by 3 px** |
| `14_gap_8/9_tiles_coyote6` | jump on the last coyote step | **8 tiles cleared**, 9 tiles (144 px) not |
| `14_step_3/4_tiles` | jump onto a ledge | 48 px ledge reached, 64 px ledge not (max rise 53.67 px) |
| `q1_oneway_hides_solid_face`, `q2_solid_tile_control` | Phaser face quirk, **not a conformance target** | see findings |

Sanity check against research-physics section 18: apex 53.667 px on step 23 after the press - matches;
47 airborne steps - matches; 117.5 px of travel when the feet are back at launch height - matches (the
`grounded` flag comes one step later, at 120 px, because Arcade needs a strict overlap to collide);
tap 17.92 px, holds 21.36 / 24.64 / 27.73 / 33.32 / 38.23 / 45.87 - all match; terminal velocity on step
43 - matches; wall slide 1.361 px/step - matches. "24 steps" for the tap jump is press -> grounded
(23 airborne steps).

## Findings: research-physics section 16 "Not determined" items

Resolved by reading the installed Phaser 3.90.0 source and confirmed by the traces.

### 16.1 Integration order, clamp, flag reset - confirmed

`Body.update(dt)` (`physics/arcade/Body.js`): `prev = position`; `World.computeVelocity`: gravity is added
first (`vy += (world.gravity.y + body.gravity.y) * dt`, only if `allowGravity`), then acceleration/drag
(unused), then `vx = Clamp(vx, -10000, 10000)`, `vy = Clamp(vy, -500, 500)` (symmetric); then
`position += velocity * dt` with the new velocity; `_dx/_dy = position - prev`.
`World.update`: all bodies integrate, then every collider runs once, then the `worldstep` event
(controller). `blocked`/`touching` are reset in `Body.preUpdate` once per rendered frame that will step;
a second catch-up step in the same frame does not reset them. With one step per frame (SNES) that
detail is irrelevant: flags are simply rebuilt every frame.

### 16.2 Tile collision / separation order - determined

`World.collideSpriteVsTilemapLayer` + `tilemap/SeparateTile.js`, `TileCheckX.js`, `TileCheckY.js`:

1. Candidate tiles: the body's rectangle extended by one tile up and left
   (`[x-16, x+w] x [y-16, y+h]`), filtered to `collides && index != -1 && hasInterestingFace`, visited in
   **row-major order (top row first, left to right)**. Each tile is tested against the body position as
   already corrected by the earlier tiles of the same pass.
2. Overlap test is strict: touching edges do not intersect (`body.right <= tile.left` -> no hit).
3. For the player the process callback runs next (one-way rule, section "one-way" below).
4. **Faces**: a tile side is collidable only if the neighbouring tile on that side does not collide
   (`CalculateFacesWithin`). Interior edges between adjacent solid tiles do not exist, so there is no
   snagging on floor or wall seams. Cells outside the 40x22 layer count as empty, so tiles on a room edge
   always have an outward face (each room is its own layer).
5. **Axis order per tile**, with `dx/dy` = the movement of this step's integration:
   * `|dx| > |dy|` or equal: X first; `|dx| < |dy|`: Y first;
   * but if both `dx != 0` and `dy != 0` and the tile has a horizontal **and** a vertical face (a convex
     corner tile): the axis with the **smaller penetration** goes first
     (`minX = min(|body.x - tileRight|, |body.right - tileLeft|)`, `minY` likewise);
   * after the first axis, if the body no longer intersects the tile, the second axis is skipped.
6. An axis is only resolved **against the direction of travel**: moving left (`dx < 0`) checks the tile's
   right face (`ox = body.x - tileRight`), moving right its left face, moving up the bottom face, moving
   down the top face. `dx == 0` -> no X resolution at all (this is why `blocked.left/right` needs the
   player to keep pushing, and why a wall is only "touched" on steps with horizontal motion into it).
7. A penetration larger than `TILE_BIAS = 16` px is ignored (no tunnelling protection beyond that; the
   maximum player speed is 8.33 px/step, so it never triggers).
8. Separation: `position -= overlap`, `blocked.<side> = true`, velocity component `= 0` (bounce 0).

Consequences for an "X then Y" grid collider (ARCHITECTURE 5.3):

* Identical results for axis-aligned contact, flat floors, straight walls and ceilings.
* **Convex-corner step-up.** When the body moves down-and-sideways into the top corner of a tile and its
  feet are less far below the tile top than its side is inside the tile, Arcade resolves Y first and
  lifts the body onto the tile. At run speed the side penetration on the first contact step is at most
  2.5 px (3.42 px during a wall-jump lock), so the web game forgives landing up to about 2.5 px below a
  lip. `12_gap_down_held` shows it: feet at 321.94 (1.94 px low), side 2.33 px in -> lifted, grounded.
  An X-first collider blocks instead and the player falls. To reproduce: when the X move is blocked by a
  cell whose top is `d` px above the feet with `0 < d <= |x penetration|` (both measured after the
  step's full move; on a tie Arcade takes Y first) and the cell above it is empty, and the step moved
  down (`dy > 0`), snap the feet to the cell top, zero `vy`, set `blocked.down`, and do not block X.
* The same rule exists for the head: moving up-and-sideways into a bottom corner resolves the smaller
  penetration first, so a shallow vertical overlap produces a head bump (`vy = 0`, then corner
  correction may apply) rather than a wall stop.
* With sub-pixel x (after crawling or a wall jump) the side penetration at a lip can be smaller than the
  0.194 px gravity sag; Arcade then resolves X first for one step: the body is pushed back by < 0.2 px
  and `vx` is zeroed for that step. Invisible, not worth porting.

### 16.3 Float edge cases - observed values

* Timers decremented by `delta` (coyote 110, buffer 120/240, protected 70) and timers compared with the
  clock (lock 240, steer-back 120, grace 140, flip 190, drop-through 240) are never an exact multiple
  of 16.667 ms, so their frame counts are unambiguous and the traces confirm research section 17:
  coyote **6**, jump buffer **7**, protected rise launch + **4**, wall-jump lock launch + **14**,
  steer-back from launch + **8**, butt-stomp hover **12**, drop-through **14** steps after the press step.
* Exact-tie positions do depend on float noise: the symmetric jump returns to exactly y = 320 on
  press+47 without colliding (strict overlap), so `grounded` is one step later; in `11_crouch_crawl`
  the stand-up test `left + 1 >= 256` is first true one step later than exact arithmetic says. Tests
  should allow +-1 step on such ties (ARCHITECTURE 7.3 already does).

### 16.6 Max-gap / step-height numbers - measured

`14_*` traces: a flat 7-tile gap is cleared without coyote, an 8-tile gap is missed by 3 px without
coyote and cleared with a jump on the last coyote step, a 9-tile gap is not clearable; a 3-tile ledge is
reachable, a 4-tile ledge is not. These match the computed values in research section 18.

### Not resolved here

16.4 (ladder rectangle, swimmable-water objects, enemy stomp, moving platforms) and 16.5 (sprite frame
size) concern objects and art, not Arcade tile physics; they are covered by research-objects.md /
research-art.md. Sword timing runs per render frame in `combatController.ts` and is not traced.

## Other behaviour a port must know (seen in the traces)

1. **Hitbox height timeline.** `h` becomes 14 on the jump press step itself (the controller resizes after
   setting `vy < 0`) and returns to 26 on the landing step if the standing box fits. At spawn the body
   is 14 until the first grounded step. The feet never move on a resize.
2. **Velocity read-back.** `vx` after the controller is +-150 while pushing against a wall (Arcade zeroes
   it during collision, the controller sets it again), so `pl_vx` at end of frame is not 0 at a wall;
   `pre_vx` is. `vy` after the controller is 0 when grounded; gravity sags the body 0.194 px into the
   floor each step and separation puts it back.
3. **Corner correction** happens on the bump step: Arcade has already clamped the body under the ceiling
   and zeroed `vy`; the controller then shifts x by 1..4 px (it tries -1,+1,-2,+2,... when `vx <= 0`,
   +1,-1,... when `vx > 0`) and restores `vy = previous_vy + 11.667` (e.g. -233.33 -> -221.67). The rise
   lost on that one step is not given back (apex 51.25 instead of 53.67 px).
4. **Gap assist** (`12_gap_assist`): over the hole `blocked.down` is false and `pre_vy` is 11.667, the
   controller snaps the feet back to the floor top, sets `vy = 0` and reports grounded; `h` stays 26 and
   coyote stays 110. It needs horizontal input and no Down. **With Down held the assist is off but the
   player still crosses a 1-tile hole** (airborne speed is 150 px/s because crouch ends in the air, then
   the convex-corner step-up lifts him onto the far lip). ARCHITECTURE 7.3 row "gap assist ... with Down
   held the player falls in" does not match the web game; the web behaviour is `12_gap_down_held`.
   A player does fall in when the horizontal input is released over the hole (`12_gap_stop_in_hole`).
5. **Down+Jump always starts the drop-through**, not only on a one-way tile: `vy = max(vy, 86)` and a
   240 ms window without one-way collision. On solid ground this is a one-step blip (`11_crouch_idle`
   step 36: `vy = 86`, next step collides, `vy = 0`).
6. **One-way rule** (`specialTiles.ts:345-383`, evaluated per tile during the collision pass, after
   integration): collide only if `vy >= -12` and `previous_bottom <= tile_top + 6` and
   `bottom <= tile_top + 12`; never during the drop-through window. Sideways and from below it is air.
7. **One-way tiles hide the faces of their neighbours** (`q1_*`): because the one-way tile "collides"
   for face calculation, a solid tile next to it loses the face on that side and a solid tile directly
   below it loses its top face. In `q1` the player sinks about 9 px into the floor under a one-way tile
   that rests on the ground and walks through the solid tile beside it. Authored rooms should not place
   one-way cells orthogonally adjacent to solid cells; `mkrooms.py` could lint for it. The port should
   not reproduce this.
8. **Wall contact needs motion into the wall**: `blocked.left/right` exist only on steps whose integrated
   `dx` points into the wall, i.e. the controller set `vx` toward it on the previous step (input toward
   the wall, or the wall-jump lock). Wall slide starts on the first step with `vy >= 0` and raw contact;
   `vy` is capped to 70 after the controller and gravity is added on top when integrating (81.67 px/s).
9. **Butt stomp**: gravity is switched off during the 12 hover steps (`vy` stays exactly 0); afterwards
   the controller writes 520 every step and Arcade clamps to 500 when integrating.

## Using a trace in a ROM test

```sh
python3 snes/tests/golden/layout_to_room.py snes/tests/golden/09_wall_stop.json -o room.json   # RoomSnapshot
python3 snes/tests/golden/layout_to_room.py --check     # all 47 layouts through mkrooms: coll map == mask
```

`room_from_trace(trace, x, y)` returns the snapshot (`#` = terrain gid 29, `=` = gid 670, `spawnPoint` =
`spawn_feet`, no objects, no goal, `pitsAreDeadly` false). `mkrooms.compile_room` turns every layout into a
blob whose collision plane equals the mask cell for cell (`TC_SOLID` $80, `TC_ONEWAY` $03, `TC_EMPTY` 0) and
whose spawn equals `spawn_feet`. Replay `inputs[i]` on frame `i+1` of `GS_PLAY` (`J` -> `BTN_JUMP`,
`L R D` -> d-pad) and compare with `steps[i+1]`. All spawn positions are integers.

## Verification (independent review)

```sh
python3 snes/tests/golden/verify_traces.py     # 47 traces, 4260 steps, 0 problems
```

* The generator was re-run from a clean scratch copy (`npm ci`, Phaser 3.90.0): output is byte-identical
  to the files here.
* Defect fixed in review: `10_one_way_walk_off_and_under` originally kept holding Left for 150 steps and
  walked out of the room (x = -90, falling below y = 352), which the port cannot follow (edge wall, pit).
  It now releases after the jump and lands on the platform (110 steps); the generator fails if any trace
  leaves x 32..608 or sinks below y 336.
* Generator constants were compared with `OverworldPlayScene.ts:417-466`, `playerLifecycle.ts:63-77` and
  `main.ts:106-112` (world gravity 0 at boot, 700 set by the scene; default 60 Hz fixed step,
  `TILE_BIAS` 16); the collider is built as in `fullRoomPresenter.ts` / `runtimeController.ts:224`.
* `verify_traces.py` checks, for every step of every trace, the schema, the input/pressed derivation,
  the integrator (`vy' = clamp(vy + 700/60)`, `x += vx/60`, `y += vy'/60` unless the trace reports a
  block, in which case the body edge must be on a 16 px boundary), and that the body never ends a step
  inside a solid cell (except `q1`, where that is the quirk being shown).
* It replays the stored inputs of the 19 jump / coyote / buffer / ledge / free-fall traces (`01`-`05`,
  `08`) through a from-scratch exact-rational model of gravity, floor landing, run speed, coyote 110 ms,
  buffer 120 ms, protected rise 70 ms and the x0.85 release cut: `x, y, vx, vy, grounded` agree on every
  step to 2e-6.
* Closed forms: apex `(280*23 - (700/60)*23*24/2)/60 = 53.6667` px at press+23, `y(47) = 0`; 47 steps
  x 2.5 px = 117.5 px; terminal on step `ceil(500/11.667) = 43`; 296 px fall lands on step 57; slide
  `(70 + 11.667)/60 = 1.3611` px/step; head-bump apex 32 - 14 = 18 px; coyote `floor(110/16.667) = 6`,
  buffer `floor(120/16.667) = 7`.
* The Phaser statements of 16.1 / 16.2 were re-read in `World.js`, `Body.js`, `tilemap/SeparateTile.js`
  and `TileCheckX/Y.js` of 3.90.0. One correction was made above: on a corner tie (`minX == minY`)
  Arcade resolves Y first, so the step-up rule is `d <= |x penetration|`.
* `14_gap_8_tiles_coyote6` is a plain landing (the body's leading edge is already over the far floor
  while the feet are above it), it does not depend on the lip step-up. Its `max_y_before_landing` of
  324.08 is the fall during the coyote window before the press.
