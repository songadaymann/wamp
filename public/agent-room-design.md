# Agent Room Design Guidance

Use this reference when the user wants an agent to make creative decisions.

## Start With Local Context

Before building, inspect 3-5 nearby published rooms.

Summarize:

- common goal type
- terrain density
- common hazards or collectibles
- visual/background choices
- apparent difficulty

Use that summary to fit the neighborhood without copying it.

## Starter Layout Examples

The editor offers Flat Run, Stairs Up, Vertical Climb, Arena, Platform Chain and Blank from Terrain in an empty room, or Room → Templates. The five playable starters include ground, a start and an exit. Blank has no markers. An Expanded Room template changes only its selected cell; the area start and goal stay in Markers.

These are useful starting proportions on the 40 × 22 tile grid:

| Layout | Starting geometry |
| --- | --- |
| Flat Run | Full-width floor at rows 20–21; start at column 3 and exit at column 36. |
| Stairs Up | Six steps, each four tiles wide and two tiles higher, starting at column 10 / row 18. |
| Vertical Climb | Alternate seven-tile ledges at columns 8 and 16, rising two rows at a time. |
| Arena | Flat floor with two slimes, leaving space near the start. |
| Platform Chain | Five-tile ledges separated by two-tile gaps, with a catching floor below. |

Keep the jumps within the normal player's reach, then add your own obstacles and visual rhythm. Editor templates retain Smart terrain ownership, so the matching default ground brush can extend them. Agent `platform`, `fill_rect` and `set_tiles` commands place literal tile IDs; select those from the current authoring catalog and check their collision before treating them as ground.

## Anti-Copy Rules

Do not:

- reuse an exact title
- copy a whole terrain layout from one room
- reuse exact object coordinates from one room
- mirror one existing room with minor edits

Do:

- combine patterns from multiple rooms
- change proportions, spacing, and rhythm
- keep the same local “language” while making a new composition

## If The User Gives No Concept

Choose one simple original direction:

- a short `reach_exit` traversal room
- a collectible route with low hazard density
- a small enemy-clear room with readable footing
- a checkpoint sprint with obvious beats
- a survival room with clear safe and unsafe zones

Prefer simplicity over novelty spam.

## Good First-Room Heuristics

- make the spawn safe
- make the first action obvious
- make the exit or objective readable
- avoid clutter
- do not hide the critical path
- use one main mechanic and one supporting idea

## Goal-Specific Heuristics

### `reach_exit`

- best default when no stronger idea is present
- make the path readable from spawn
- use one or two jumps, hazards, or ladders, not ten

### `collect_target`

- place collectibles so the route is legible
- avoid forcing accidental misses due to invisible logic
- use collectibles to pull the player through the room

### `defeat_all`

- ensure enemies have standable fighting space
- avoid stacking too many enemies in cramped terrain

### `checkpoint_sprint`

- each checkpoint should correspond to a clear beat
- do not place checkpoints randomly
- make the finish feel earned, not hidden

### `survival`

- create tension with movement pressure, not visual chaos
- make the danger pattern understandable after a short read

## Difficulty Guidance

- if nearby rooms are simple, do not suddenly create an extreme spike
- if the user asks for hard difficulty, make the challenge skill-based and readable
- avoid fake difficulty from invisible hazards, impossible jumps, or unclear objectives

## Publish Standard

Do not publish a room unless it is likely:

- traversable
- readable
- mechanically coherent
- distinct from nearby existing rooms
