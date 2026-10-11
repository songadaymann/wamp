# F012, F018, and parts of F188, F205, F222, F035

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F012 per-frame allocations | [#172](https://github.com/songadaymann/wamp/pull/172) | `4db14ba4` | Pages |
| F018 arrival world prefetch | [#171](https://github.com/songadaymann/wamp/pull/171) | `6f7f8460` | Pages |
| F188 (part) | [#173](https://github.com/songadaymann/wamp/pull/173) | `6f1d8dac` | API Worker `378e20a6` |
| F205 (part) admin room clear on busy rooms | [#174](https://github.com/songadaymann/wamp/pull/174) | `62bdf59b` | API Worker `378e20a6` |
| F222 (part) phrase load failures | [#175](https://github.com/songadaymann/wamp/pull/175) | `88f34e55` | Pages |
| F035 (part) heartbeat throttle | [#176](https://github.com/songadaymann/wamp/pull/176) | `b69ce731` | PartyKit presence server |

## What changed
- **Play loop:** the last per-frame throwaway objects (room list copies, enemy motion, rider callbacks, the music sync input, the weather off path) are reused or skipped.
- **Faster start on phones:** the nearby-rooms request starts while the art downloads instead of after it. That's about 0.1 s faster to app-ready on phones; no change on desktop.
- **Guest drafts:** a limit on how many new guest drafts can start each day. Real use is far below it.
- **Admin room clear:** works on rooms with more than 100 runs (it failed outright before).
- **Arranged music:** one missing or failed phrase no longer silences the whole room, and a failed phrase is retried on the next visit.
- **Multiplayer:** the shared stats room gets at most one forced heartbeat per shard every 3 s and prunes once a minute.

## Evidence
`npm run check` on Node 22 passed for each PR. The new tests fail on the previous code where noted in each PR.
- F012: moving platforms and flyers move in rooms 2,9 and -4,-1.
- F018: 15 alternating app-ready runs per variant.
- API Worker `378e20a6`: production smoke passed, and `/api/health` returned 200.

## Production checks (read-only)
- F029: 5 completed runs since its deploy, all repeat clears with no reward due. Still waiting for a first clear.
- F236: 3 builder draft saves have gone through since its deploy.

## Left
- F018: overlap the arrival snapshot query.
- F188 and F205: the rest of the review's suggestions.
- F222: product decisions.
- F035: preview deltas.
