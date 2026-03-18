# Game Backlog

This is the curated working backlog for `everybodys-platformer`.

Use [ideas-inbox.md](/Users/jonathanmann/SongADAO%20Dropbox/Jonathan%20Mann/projects/games/everybodys-platformer/docs/ideas-inbox.md) for rough thoughts, half-formed ideas, screenshots-to-follow, and quick notes.

Use this file for ideas that have been triaged into concrete work.

## How To Use

- Keep raw brainstorming out of this file.
- Move items here only when the goal is clear enough to build or deliberately defer.
- Prefer one item per feature/change.
- Give each item a stable id so we can refer to it in chats and commits.
- Keep acceptance criteria short and testable.

## Status Guide

- `Codex Ready`: clear enough to implement now
- `Now`: currently important, but may still need a decision
- `Next`: good candidate after current work
- `Later`: worthwhile, but not urgent
- `Blocked`: waiting on an external decision, asset, or dependency
- `Done`: shipped or intentionally closed

## Item Template

```md
## G-000 - Short feature name
Status: Codex Ready
Priority: High
Why:
- One or two sentences on why this matters.

Acceptance:
- Concrete outcome 1
- Concrete outcome 2

Notes:
- Constraints, references, links, screenshots, or tradeoffs
```

## Codex Ready

## G-001 - Starter room templates
Status: Codex Ready
Priority: High
Why:
- Starting from an empty room is hard and slows down room creation.
- A few good templates would lower the barrier to making something playable quickly.

Acceptance:
- Builders can start a room from at least a small set of starter layouts instead of only a blank canvas.
- Templates produce valid terrain/object layouts that are easy to modify afterward.

Notes:
- Keep this lightweight for v1.
- Good first templates would be things like `flat challenge`, `stairs`, `vertical climb`, or `platform chain`.

## G-002 - Direct-link instant play affordance
Status: Codex Ready
Priority: High
Why:
- People following a direct room link may not notice the small `Play` button.
- Shared links should make the intended action obvious immediately.

Acceptance:
- A direct room link makes the primary play action obvious on first load.
- The solution works on desktop and mobile without forcing room edit/build flows.

Notes:
- This may be a stronger CTA, an auto-focused room state, or a one-time prompt.

## Now

## Next

## G-005 - Presence-aware chat and teleport to friends
Status: Next
Priority: Medium
Why:
- Chat becomes more useful if player presence is tied to location.
- Players want an easier way to find and join each other.

Acceptance:
- Chat or presence UI exposes where an active player is in the overworld.
- A player can jump to another visible player in a controlled way.

Notes:
- Decide whether this is global, friends-only, proximity-based, or opt-in.

## G-006 - Wall jumping
Status: Next
Priority: Medium
Why:
- Wall jumping would expand the platforming vocabulary significantly.
- It could open up a lot more expressive room design.

Acceptance:
- Player can perform a readable, intentional wall jump.
- Existing rooms do not become trivial or broken unintentionally.

Notes:
- This needs careful feel tuning and probably some level-design guidance.

## Later

## G-007 - Dynamic modular room music
Status: Later
Priority: Medium
Why:
- Per-room audio identity could make the world feel more alive without abrupt music cuts.
- A layered music system could preserve continuity while still making rooms feel distinct.

Acceptance:
- Different room music layers can fade or blend across room transitions.
- Transitions feel coherent rather than like hard audio cuts.

Notes:
- The Luftrausers reference from the inbox is a good starting direction.

## G-008 - Pressure plates and simple trigger mechanics
Status: Later
Priority: High
Why:
- Triggerable interactions would enable more emergent systems and puzzle rooms.
- Even a minimal trigger model could create a lot of player creativity.

Acceptance:
- Builders can place a pressure plate or equivalent trigger.
- Trigger can activate at least one simple target such as a door, spawn, or loot drop.

Notes:
- Keep the first version much simpler than full redstone-style logic.

## G-009 - Friendly NPCs, sign text, and story tools
Status: Later
Priority: Medium
Why:
- Builders want to create lore, guided experiences, and clues between rooms.
- Signs and NPC dialogue are a foundation for narrative rooms.

Acceptance:
- Builders can add readable text through signs or NPCs.
- Players can reliably discover and read that text in-world.

Notes:
- The inbox also mentioned a reveal layer for hidden rooms and storytelling.

## G-010 - Reveal layer / hide-behind foreground layer
Status: Later
Priority: Medium
Why:
- Builders want a way to hide spaces behind art without making the room unreadable.
- This supports secrets, hidden rooms, and more visual depth.

Acceptance:
- A builder can place a layer that occludes the player until they move behind/through it.
- The player remains readable during gameplay.

Notes:
- This should behave differently from the current foreground layer.

## G-011 - Locked traversal between neighboring rooms
Status: Later
Priority: Medium
Why:
- Requiring traversal through adjacent rooms would make geography matter more.
- This could make the overworld feel more like a continuous world rather than a teleport grid.

Acceptance:
- Certain locked rooms cannot be entered directly by teleport/jump.
- Access is gained by reaching them through neighboring rooms.

Notes:
- This has implications for sharing, discovery, and room linking.

## G-012 - Room ratings and comments
Status: Later
Priority: Medium
Why:
- Players want richer feedback tools than leaderboards alone.
- Ratings and comments would improve discovery and creator feedback.

Acceptance:
- Players can leave room feedback beyond clear-time performance.
- Builders can review that feedback in a useful place.

Notes:
- Difficulty voting already exists locally in the leaderboard modal and may overlap with broader ratings.

## G-013 - Player profiles, badges, and progression
Status: Later
Priority: Medium
Why:
- Profiles and progression could reward exploration and challenge completion.
- This creates more identity and longer-term retention loops.

Acceptance:
- Players have a visible profile or progress surface.
- Progress rewards encourage playing other people's rooms rather than farming your own.

Notes:
- The inbox suggested XP, badges, curated selections, seasons, events, and creator history.

## G-014 - Premium room sizes and premium assets
Status: Later
Priority: Medium
Why:
- Premium content could create monetization without relying only on room sales.
- Larger rooms or special assets could feel meaningfully valuable.

Acceptance:
- Premium room capabilities or premium assets are defined clearly.
- The system is fair to free builders and does not fragment the core experience.

Notes:
- Examples from the inbox: larger rooms, boss enemies, premium tilesets, premium avatars, premium music.

## G-015 - UGC marketplace and tipping
Status: Later
Priority: Medium
Why:
- Builders and asset creators may want direct monetization and attribution.
- Tipping and asset sales could support a creator economy around the game.

Acceptance:
- Players can financially support creators in at least one direct way.
- Attribution and revenue splits are defined clearly.

Notes:
- The inbox mentioned room sales, UGC rev-share, tipping, and secondary-market ideas.

## G-016 - Brand / partner asset packs
Status: Later
Priority: Low
Why:
- Partnerships could bring in new audiences and themed content.
- Exclusive avatars or themed asset packs could fit the world if handled carefully.

Acceptance:
- Partner content can be integrated without breaking the art/style rules.
- Access rules for partner assets are defined clearly.

Notes:
- The inbox mentioned NFT-project themed avatars and partnership-specific levels.

## G-017 - Easter eggs and secret codes
Status: Later
Priority: Low
Why:
- Secret inputs and hidden features can add personality and community folklore.

Acceptance:
- A hidden input or secret interaction exists and is deliberate.

Notes:
- Current candidate from the inbox: `up up down down left right left right b a enter`.

## Blocked

## G-018 - Marketplace for minted rooms
Status: Blocked
Priority: Medium
Why:
- Minted room ownership suggests eventual buying/selling behavior.
- A marketplace may become important if minted rooms gain real value.

Acceptance:
- Ownership transfer flow, fees, UI, and marketplace scope are defined.

Notes:
- This is blocked on broader mint/ownership product direction and probably deserves its own PRD section before implementation.

## Done

Use this section for short shipped notes if we want a lightweight project memory outside `progress.md`.

## G-004 - Show other players in the overworld
Status: Done
Priority: High
Why:
- The world wants to feel social, but it is hard to tell where other players are.
- Players want to meet up, spectate, and jump to friends more easily.

Acceptance:
- In browse / LOD mode, players can still tell which rooms currently have active players, either through lightweight moving presence markers or room-level occupancy indicators.
- In play mode, nearby active players are easier to find than the current ghost presentation alone, or the active rooms are clearly marked in a way that still helps navigation.
- The presence solution scales sensibly when there are only a few players and when there are many players active at once.
- The feature does not overwhelm the map, room labels, or play readability.

Notes:
- Implemented on March 18, 2026 as browse-mode moving presence dots plus play-mode stronger ghosts and subtle occupied-room pip markers.
- Kept the existing `BUILDING` editor badges intact and left friend-jump / chat-location work in `G-005`.

## G-003 - Refresh room objects after a completed challenge when re-entering
Status: Done
Priority: High
Why:
- After completing a room challenge, a player can leave and come back to find the room objects still in their completed/consumed state.
- That makes replays and repeat attempts feel broken because the room does not reset cleanly after a finished run.

Acceptance:
- Leaving and re-entering a room after completion restores the challenge room to a consistent playable state.
- Collectibles, keys, doors, enemies, and other consumed objects refresh correctly after a completed run.

Notes:
- Fixed in `src/scenes/OverworldPlayScene.ts` on March 18, 2026 by extending single-room reset handling to completed/failed runs and session resets.

## G-019 - Prevent frontier-room soft lock during normal room play
Status: Done
Priority: High
Why:
- In normal single-room play, the player can currently move into a frontier room that should not be enterable.
- That transition immediately kills the player and leaves the game soft-locked with greyed-out controls until refresh.

Acceptance:
- Frontier rooms are blocked consistently during normal room play, just like they already are during course play.
- Attempting to cross into a frontier room never leaves the player dead or soft-locked.

Notes:
- Fixed in `src/scenes/OverworldPlayScene.ts` on March 18, 2026 by hard-blocking unreachable room transitions in `maybeAdvancePlayerRoom()`.
