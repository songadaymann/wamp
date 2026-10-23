# Round 2, step 4: speed — 2026-10-23

Delivers round-2 items F301, F306, F363, F305, F302, F329, F331, F330, F332 and F348. Every branch had an adversarial review, and every finding was fixed before merge; F302 took five rounds. F333 waits until F351 has been seen on real ranked finishes.

| Item | PR | What changed |
|---|---|---|
| F301 | [#302](https://github.com/songadaymann/wamp/pull/302) | Custom tile lookups clean a room's custom tile list once instead of on every lookup. |
| F306 | [#303](https://github.com/songadaymann/wamp/pull/303) | The world-map tile planner reuses its plans while nothing on screen changes (241 rebuilds to 0 in 30 still frames). |
| F363 | [#304](https://github.com/songadaymann/wamp/pull/304) | A pinch-zoom step reuses the publish checklist while its inputs are unchanged. |
| F305 | [#308](https://github.com/songadaymann/wamp/pull/308) | Chasing enemies list their jump routes only when they reach a new node, and pick the same route as before (about 0.008 ms a frame instead of 0.5–1 ms in a dense room). |
| F302 | [#310](https://github.com/songadaymann/wamp/pull/310) | A coin-collecting Sword Hunter's jumps are warmed ahead of its first plan (in spare frame time, and on the spot at run start or a portal), so that plan no longer freezes the game. It picks exactly the same route as before. |
| F329 | [#305](https://github.com/songadaymann/wamp/pull/305) | The ghost lookup reads only the needed room version (0–1 reads instead of one per saved version). |
| F331 | [#306](https://github.com/songadaymann/wamp/pull/306) | Room of the Day is cached at the edge for 30 s, with no per-user data, and the game stops reloading it after guest runs and tab returns. |
| F330 | [#307](https://github.com/songadaymann/wamp/pull/307) | Guest attempts store a version reference and hash instead of a copy of the room. Forward-only. |
| F332 | [#314](https://github.com/songadaymann/wamp/pull/314) | Share preview PNGs are compressed: 3 MB down to 5–144 KB with identical pixels, and about 4 times less CPU per render. |
| F348 | [#314](https://github.com/songadaymann/wamp/pull/314) | Wamp-O-Gram previews are drawn once per datacenter and cached. A visibility check runs first, so deleted grams and hidden versions leave at once. Blocked art is masked and refreshed within an hour, and browsers re-check after an hour. |

## Release

- API Worker `4d03ca81` carries F329, F331 and F330. No migration. F332 and F348 went out in API Worker `1f1fdef2` (main `4d6003b3`).
- Pages production deploy `8cbe97c1` is main `07848a0f`, with every item above except F302, which went live in Pages deploy `40556218` (main `96addc6`).

## Checks

- `npm run check` passed on the combined batch (646 files, 5,542 tests), and again with F305 and F302 together (645 files, 5,549 tests). Boot JavaScript is 667.7 KB against the 670 KB budget.
- The muted default mobile smoke passed 68 of 68 on both. Auth, assist, Expanded Room, map capture and artwork smokes passed on the batch.
- F305 was compared with main's planner on 24,000 random cases across 60 rooms: 0 mismatches.
- Live: wamp.land boots clean on desktop Chromium and iPhone WebKit (ready in about 2.4 s), and `/api/daily` answers `x-wamp-cache: hit` with `private, no-store`.
- F302: five adversarial review rounds; `npm run check` passed (650 files, 5,593 tests; boot 668.4 KB), and so did the muted default (68/68), Expanded Room and map-capture smokes. Live, desktop Chromium and iPhone WebKit played a room without errors, and the warm-up chunk loaded. The mobile runtime trace needs a populated world, so it wasn't run locally.
- F332/F348: `npm run check` passed (670 files, 5,699 tests), and the preview cache was exercised in workerd with D1 and the Cache API. Live, a room share image is 15.8 KB and the Pages room image 108 KB. A gram preview is 26 KB with `max-age=3600`, HEAD returns its length, a missing gram returns 404, and the gram page's og:image carries `?renderer=1`.
- The police-enemies and physics-cadence smokes are out of date with the current editor dock and production build (not in CI), so they were not used.

## Only Jonathan can check

- **F306:** on a phone, stand still on the world map; it should feel no heavier than moving.
- **F363:** pinch-zoom in the editor of a big room; zoom should stay smooth.
- **F305:** play a room with police or Sword Hunters that chase you across ledges; they should chase exactly as before.
- **F302:** on a phone, start a run in a dense coin-race room with Sword Hunters. The start should not hitch more than the room load itself, and the hunters should chase as before.
- **F332/F348:** paste a room link and a Wamp-O-Gram link into Discord or iMessage; both previews should appear.
- **F331:** finish Room of the Day as a guest, then as a signed-in player; the panel should update after the signed-in finish.
