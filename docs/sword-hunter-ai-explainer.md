# Sword Hunter AI Explainer

This is a plain-English description of how the current Sword Hunter works.

## The Big Picture

The Sword Hunter is not doing anything "smart" in the machine-learning sense.

It is a custom rule-based platformer planner:

- it looks at the room's terrain
- turns that terrain into a small traversal graph
- picks a short route toward the player
- executes only the first step of that route
- replans again on the next frame

So the AI is really a mix of:

- a finite-state combat loop
- a platform traversal graph
- some short-term memory about failed moves

## The Combat State Machine

At the top level, the enemy has these states:

- `patrol`
- `chase`
- `windup`
- `attack`
- `cooldown`

In practice that means:

- If the player is not nearby, he patrols.
- If the player is in range, he switches to `chase`.
- If the player is close enough to hit, he stops moving, does a short `windup`, then `attack`, then waits in `cooldown`.

The state machine lives in `src/scenes/overworld/liveObjects.ts` inside `updateSwordsmanEnemy(...)`.

## How He Decides Where To Go

When chasing, the AI takes the current room and builds a graph of places he can stand and ways he might move between them.

The graph is built from two kinds of nodes:

- `surface` nodes: flat walkable ledges/floors
- `wall` nodes: exposed wall faces he can jump to and wall-jump from

Then it creates edges between those nodes for moves it thinks are possible:

- `jump-up`
- `jump-gap`
- `drop-down`
- `jump-to-wall`
- `wall-jump`

That logic lives in `src/enemies/swordsmanTraversal.ts`.

## What "Planning" Means Here

Each frame, the planner:

- figures out which surface or wall the hunter is currently on
- guesses which surface or wall the player is effectively on
- searches the graph for a short path from hunter to player
- scores candidate paths
- keeps only the first edge of the best path

Important detail: it does not commit to a full long route and follow it to completion. It replans constantly and mostly acts on the next immediate move.

So if the best path is:

1. walk right to the ledge
2. jump to the wall
3. wall-jump to the upper platform

the runtime usually only turns that into "walk right toward this setup point" or "jump now." Then it recomputes again.

## How Execution Works

Once the planner returns a decision, the runtime converts that into movement:

- `same-platform`: run left or right on the ground
- `drop-down`: walk to an edge and allow stepping off
- `jump-up`: apply a fixed jump impulse
- `wall-jump`: apply a fixed wall-jump impulse
- `air-chase`: while airborne, keep steering horizontally toward the current target point

The actual physics are still Phaser physics. The planner only suggests what move to try.

This is the core source of a lot of the brittleness: the planner is discrete and geometric, but the movement is continuous physics with collider details, momentum, ceilings, and edge cases.

## The Short-Term Memory

The AI also keeps temporary memory so it does not repeat obviously bad moves forever.

It remembers:

- the active traversal edge it is currently trying
- the node it hoped to reach next
- a temporary blocklist of failed edges
- fallback pseudo-edges for "just try dropping off the left/right side"

If a jump clearly fails, that edge can be blocked for a short time so the planner tries something else.

There is also a fallback stall detector: if he keeps trying to walk toward the same fallback drop and is not making progress, that fallback edge gets blocked too.

## Why He Gets Stuck

This is a genuinely hard problem. Platformer pathfinding is much harder than top-down pathfinding because "can I get there?" depends on jump arc, collider shape, momentum, ceilings, wall contact, and exact takeoff points.

The current implementation is also missing a few stabilizing pieces:

- It uses hand-tuned reachability thresholds instead of simulating the real jump arc.
- It searches only a short distance into the future, so complex routes are easy to miss.
- It reasons about terrain surfaces and walls, but not the full set of runtime traversal affordances.
- It replans frequently instead of following a committed route executor, so small state changes can cause indecision.
- Success and failure detection is still heuristic, so some "bad but not obviously bad" attempts can slip through and be retried.

So the answer is: yes, this is a hard problem, and yes, the current architecture is also fairly brittle.

## The Most Useful Mental Model

The easiest way to think about the current AI is:

"Every frame, he asks: what ledge or wall am I on, what ledge is the player on, what is the next plausible move between those two, and did my last move fail badly enough to blacklist for a moment?"

That is basically what the system is doing.

## Useful Debug Fields

`window.get_sword_hunter_debug()` gives the most relevant live snapshot.

The main fields mean:

- `aiState`: patrol/chase/windup/attack/cooldown
- `aiIntent`: the immediate movement intent, like `same-platform`, `jump-up`, `drop-down`, `air-chase`, or `wall-jump`
- `aiCurrentSegmentId`: the surface or wall the AI thinks it is on
- `aiTargetSegmentId`: the surface or wall it thinks the player is on
- `aiTraversalEdgeId`: the current planned edge, if one exists

When he looks confused, these fields usually tell you which layer is wrong:

- wrong `aiTargetSegmentId`: target-surface selection problem
- wrong `aiTraversalEdgeId`: path choice problem
- right edge, bad motion: execution/physics mismatch problem
- no edge at all: graph generation or search-depth problem

## Code Map

- high-level state machine and movement execution: `src/scenes/overworld/liveObjects.ts`
- graph building and path choice: `src/enemies/swordsmanTraversal.ts`
- jump and air-speed tuning constants: `src/enemies/swordsmanTuning.ts`
- animation/state labels: `src/enemies/swordsmanAi.ts`

