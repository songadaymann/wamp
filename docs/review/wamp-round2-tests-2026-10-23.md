# Round 2, step 8: tests before the big merges — 2026-10-23

Delivers round-2 items F487 and F484: route tests for the riskiest write paths and renderer equivalence tests. They are the safety net for one server path for Expanded Rooms (F270, F268, F273), the shared editor input (F274, F275) and one source for share pictures (F334, F269, F389). F481 (server tests for playlists, Wamp-O-Gram and the guestbook) and F480 (smoke scripts in CI) come next.

| Item | PR | What changed |
|---|---|---|
| F487 | [#323](https://github.com/songadaymann/wamp/pull/323) | 52 route tests for room save and publish, Expanded Room editing, agent and API tokens, and Worlds, run against the whole API Worker. Expanded Room editing goes from 0% to 93% line coverage, agents from 5% to 97% and Worlds routes from 0% to 89%. |
| F484 | [#324](https://github.com/songadaymann/wamp/pull/324) | Every server-side renderer draws the same fixture rooms, and their pixels are compared. The Pages card and the game's texture match the map tile exactly. The API share card gets 34 unit tests. |

## Found by the tests

- **Expanded Room create** now checks ownership, as edit already did (#323). API Worker `d71c2b8e` was deployed from the branch before it was merged. A read-only production check showed no sign of misuse.
- **World limits:** a builder at a World's daily limit now gets the 429 limit message instead of a 500 (#323).
- **Map tiles with blocked sprites:** tiles for rooms that place a blocked community sprite now redraw (#324). The map picks this up with the next renderer release. No sprite is blocked in production.
- **Recorded as `it.fails` with reasons:** the known Pages-card gaps (F389), the API card's skipped back layer (F269), a one-pixel-too-far edge in both cards' per-pixel loops, and the Pages card's fallback shape for a blocked sprite.

## For later

- **World claim rows:** a room claimed before Worlds were switched on may have no World claim row. A test is skipped pending a production count. Query: `SELECT COUNT(*) FROM rooms r WHERE (claimer_user_id IS NOT NULL OR published_json IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM world_room_claims c WHERE c.room_id = r.id)`.
- **Expanded Room whole-draft saves** have no edit-conflict check, unlike cell saves (F379). It's a `todo` test.
- **Timing-sensitive tests:** three Sword Hunter warm-up tests time out under very heavy machine load. They should be made deterministic.

## Checks

- #323: typecheck, lint, the dead-code check, build and size (665.2 KB) passed, and main's CI on the merge passed.
- #324: all 20 CI checks passed. `world-tiles:release:check` passes, so Pages builds aren't blocked.
