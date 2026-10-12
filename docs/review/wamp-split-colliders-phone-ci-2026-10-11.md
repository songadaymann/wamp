# Parts of F019, F008 and F089

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F019 (part) editor UI loads with the editor | [#177](https://github.com/songadaymann/wamp/pull/177) | `a875f7cd` | Pages |
| F019 (part) four pop-ups load on first open | [#178](https://github.com/songadaymann/wamp/pull/178) | `76fd3792` | Pages |
| F008 (part) colliders only for nearby rooms | [#179](https://github.com/songadaymann/wamp/pull/179) | `86f103da` | Pages |
| F089 (part) phone and tablet smoke in CI | [#180](https://github.com/songadaymann/wamp/pull/180) | `6712a66c` | CI only |

## What changed
- **Startup download:** the level editor's tool panels (palette, dock, course composer, music controls, sprite editor) now download with the editor. The profile, leaderboard, explore and history pop-ups download the first time they open. Startup JavaScript went from 718 KB to 638 KB brotli, and the CI budget is now 670 KB.
- **Physics:** a moving object (penguin, bird, crate, slime and so on) used to be linked to the terrain and every solid in every loaded room. Now it is only linked to the rooms it's near, and picks up more as it travels. In a busy 9-room area, links dropped from about 1,860 to about 900 and the physics step from about 1.6 ms to 1.3 ms on a Mac. Phones should save proportionally more.
- **Phone and tablet checks in CI:** every pull request now builds the game and runs all 12 phone and tablet layout scenarios. The API responses are recorded, so CI never touches production, and the job takes about 3 minutes. Refresh the recording with `npm run smoke:mobile:ci -- --record`; chat messages and the multiplayer server address are scrubbed before saving.

## Evidence
- `npm run check` passed for each PR. PR #179 adds `interactionCoordinator.reach.test.ts`.
- F019:
  - The editor's palette, music and sprite tabs match main.
  - Mobile smoke passed 12/12.
  - On wamp.land, the leaderboard and explore chunks download on first open, with no page errors.
- F008, busy area `/r/1/-1`, same scripted walk, two runs each on main and the branch:
  - Colliders: 1,858/1,895 → 895/911.
  - Collider work per step: 0.61/0.56 → 0.37/0.39 ms.
  - Physics step: 1.61/1.57 → 1.27/1.35 ms.
  - The per-frame reach check costs 0.02 ms.
  - Behaviour matches main: no out-of-bounds resets, nothing fell below its room, and 30–31 of 31 moving objects grounded in both.
  - The physics cadence smoke passes (63 comparisons).
  - The live bundle contains the change, and play in the busy area has no page errors.
- F089:
  - Replay passed 12/12 twice locally (392 and 394 responses served, no misses, no console or page errors).
  - It passed again in CI on the PR.

## Left
- F019: the other rarely opened pop-ups, and stable chunk groups so routine deploys invalidate less.
- F008: category-group colliders, so Phaser's tree finds nearby solids instead of checking every same-room pair.
- F089: keyboard and tap-target scenarios. iOS Safari behaviour still needs a real device.
- These smokes are stale on main and should be fixed or retired:
  - `smoke_editor_dock`: 9 tools vs the 8 it expects.
  - `smoke_editor_history`: the Back button covers Undo on narrow phones.
  - `smoke_police_enemies`: the editor's Objects tab is hidden.
