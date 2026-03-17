# Agent Room Authoring Reference

Use this reference when you are building or modifying room JSON.

## Preferred Correctness Strategy

Do not hand-author a `RoomSnapshot` from memory.

Preferred order:

1. `GET /api/rooms/{roomId}`
2. Start from the returned `draft` snapshot shape
3. Mutate only the fields you intend to change
4. `PUT /api/rooms/{roomId}/draft`
5. Read it back and verify the result

This preserves fields and structure that are easy to get wrong.

## Required Snapshot Shape

A room snapshot must include:

- `id`
- `coordinates`
- `title`
- `background`
- `goal`
- `spawnPoint`
- `tileData`
- `placedObjects`
- `version`
- `status`
- timestamps

The room id and coordinates must match the target room.

## Terrain Rules

- Empty tile cells are `-1`
- Non-empty tile cells must be encoded positive gids
- `0` does not mean terrain; it is treated as empty
- Do not invent tile values blindly

Safe terrain strategy:

1. Inspect nearby published rooms
2. Reuse real positive terrain cell values that already exist in the local neighborhood
3. Preserve the same tileset vocabulary, but create a new layout

If you do not know what terrain gids to use, do not guess.

## Spawn Rules

- `spawnPoint` is a dedicated room field
- It is not a normal placed object
- Do not rely on placing `spawn_point` inside `placedObjects`

## Goal Rules

Goal markers live inside `goal`, not inside `placedObjects`.

Supported goal types:

- `reach_exit`
  - requires `goal.exit`
  - optional `timeLimitMs`
- `collect_target`
  - requires `requiredCount`
  - optional `timeLimitMs`
- `defeat_all`
  - optional `timeLimitMs`
- `checkpoint_sprint`
  - uses `checkpoints[]`
  - uses `finish`
  - optional `timeLimitMs`
- `survival`
  - requires `durationMs`

Important:

- The visible goal marker for `reach_exit` comes from `goal.exit`
- Do not invent ids like `exit_flag`

## Placed Object Rules

- Every `placedObjects[].id` must be a valid object id
- Unknown object ids are ignored by rendering/runtime
- `layer` is optional; if omitted it defaults to `terrain`

Common valid object ids by category:

- `collectible`:
  - `coin_gold`
  - `coin_silver`
  - `gem`
  - `heart`
  - `key`
  - `apple`
  - `banana`
  - `coin_small_gold`
  - `coin_small_silver`
- `hazard`:
  - `spikes`
  - `saw`
  - `fire`
  - `fireball`
  - `bomb`
  - `wood_stakes`
  - `cannon`
  - `cactus`
  - `tornado`
  - `fire_big`
  - `ice_spikes`
  - `icicle`
  - `lightning`
  - `propeller`
  - `quicksand`
  - `water_surface_a`
  - `water_surface_b`
- `enemy`:
  - `slime_blue`
  - `slime_red`
  - `bat`
  - `crab`
  - `bird`
  - `fish`
  - `frog`
  - `snake`
  - `penguin`
  - `bear_brown`
  - `bear_polar`
  - `chicken`
  - `shark`
- `interactive`:
  - `bounce_pad`
  - `flag`
  - `door_locked`
  - `ladder`
- `platform`:
  - `crate`
  - `brick_box`
  - `treasure_chest`
  - `log_wall`
- `decoration`:
  - `sign`
  - `sign_arrow`
  - `button`
  - `bush`
  - `rock`
  - `tree`
  - `tree_b`
  - `tree_c`
  - `tree_trunk`
  - `sun`
  - `clouds_deco`

## Recommended Safe Build Pattern

For a simple first-pass room:

1. Set a title
2. Set a spawn point
3. Add one clear goal
4. Add readable terrain
5. Add at most 1-3 support objects or hazards
6. Save draft
7. Read draft back
8. Publish
9. Read published room back

## Validation Checklist

Before publish, verify all of these:

- `title` is correct
- `spawnPoint` is non-null and safe
- `goal` is valid for the intended room type
- terrain cells use positive gids or `-1`, never `0`
- all `placedObjects[].id` values are valid ids
- the main route is traversable
- the room is not blank unless the user explicitly asked for blank space
