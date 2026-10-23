# Round 2, step 4: speed — 2026-10-23

Delivers round-2 items F301, F306, F363, F305, F329, F331 and F330. Every branch had an adversarial review, and every finding was fixed before merge. F302, F332 and F333 are still open: F302 is in its fourth review round, F332 is in progress, and F333 waits until F351 has been seen on real ranked finishes.

| Item | PR | What changed |
|---|---|---|
| F301 | [#302](https://github.com/songadaymann/wamp/pull/302) | Custom tile lookups clean a room's custom tile list once instead of on every lookup. |
| F306 | [#303](https://github.com/songadaymann/wamp/pull/303) | The world-map tile planner reuses its plans while nothing on screen changes (241 rebuilds to 0 in 30 still frames). |
| F363 | [#304](https://github.com/songadaymann/wamp/pull/304) | A pinch-zoom step reuses the publish checklist while its inputs are unchanged. |
| F305 | [#308](https://github.com/songadaymann/wamp/pull/308) | Chasing enemies list their jump routes only when they reach a new node, and pick the same route as before (about 0.008 ms a frame instead of 0.5–1 ms in a dense room). |
| F329 | [#305](https://github.com/songadaymann/wamp/pull/305) | The ghost lookup reads only the needed room version (0–1 reads instead of one per saved version). |
| F331 | [#306](https://github.com/songadaymann/wamp/pull/306) | Room of the Day is cached at the edge for 30 s, with no per-user data, and the game stops reloading it after guest runs and tab returns. |
| F330 | [#307](https://github.com/songadaymann/wamp/pull/307) | Guest attempts store a version reference and hash instead of a copy of the room. Forward-only. |

## Release

- API Worker `4d03ca81` carries F329, F331 and F330. No migration.
- Pages production deploy `8cbe97c1` is main `07848a0f`, with every item above.

## Checks

- `npm run check` passed on the combined batch (646 files, 5,542 tests), and again with F305 and F302 together (645 files, 5,549 tests). Boot JavaScript is 667.7 KB against the 670 KB budget.
- The muted default mobile smoke passed 68 of 68 on both. Auth, assist, Expanded Room, map capture and artwork smokes passed on the batch.
- F305 was compared with main's planner on 24,000 random cases across 60 rooms: 0 mismatches.
- Live: wamp.land boots clean on desktop Chromium and iPhone WebKit (ready in about 2.4 s), and `/api/daily` answers `x-wamp-cache: hit` with `private, no-store`.
- The police-enemies and physics-cadence smokes are out of date with the current editor dock and production build (not in CI), so they were not used.

## Only Jonathan can check

- **F306:** on a phone, stand still on the world map; it should feel no heavier than moving.
- **F363:** pinch-zoom in the editor of a big room; zoom should stay smooth.
- **F305:** play a room with police or Sword Hunters that chase you across ledges; they should chase exactly as before.
- **F331:** finish Room of the Day as a guest, then as a signed-in player; the panel should update after the signed-in finish.
