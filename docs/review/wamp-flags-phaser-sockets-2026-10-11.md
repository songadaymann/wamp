# F179, F020, and parts of F095, F023

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F179 reached checkpoint flags fade | [#159](https://github.com/songadaymann/wamp/pull/159) | `82c34488` | Pages |
| F020 arcade-only Phaser, one licence comment | [#160](https://github.com/songadaymann/wamp/pull/160) | `897b01d3` | Pages |
| F095 (part) sockets close in hidden tabs | [#161](https://github.com/songadaymann/wamp/pull/161) | `976636e4` | Pages |
| F023 (part) sound effects keep their own players | [#162](https://github.com/songadaymann/wamp/pull/162) | `72b4d761` | Pages |

## What changed
- **Checkpoint flags:** reached flags fade to 55%, so they no longer differ from pending ones only by red versus green.
- **Smaller game engine download:** WAMP now ships Phaser without the physics engine it never used, and without 1,476 copies of a licence comment. That's 380 KB less JavaScript to parse and 31 KB less startup download.
- **Background tabs:** after 30 seconds in the background, the game closes its ~50 multiplayer connections and reopens them when you come back.
- **Sound effects:** each sound keeps its own audio player instead of reloading another sound's, and jump, land, footstep, pickup and hurt sounds load right after your first tap, so they shouldn't lag.

## Evidence
`npm run check` on Node 22 passed for each PR.
- F020: build sizes; dev-server boot; mobile smoke play scenarios.
- F095: socket counts with a simulated hidden tab, this branch vs `main`; unit tests.
- F023: a pool test that fails on the previous code.

## Left
- F179: a distinct reached-flag sprite.
- F095: one socket per shard (PartyKit), smaller realtime radius.
- F023: drum pre-bake, stems, WAV hygiene.
