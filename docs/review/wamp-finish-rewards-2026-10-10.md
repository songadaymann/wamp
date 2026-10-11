# F029 run finishes reply before computing rewards

Delivered 2026-10-10 in [PR #123](https://github.com/songadaymann/wamp/pull/123), merge `e0cf72fe`, API Worker `fdf05d00-06e9-4f10-96e5-2aee1e80cb5e` (deployed 02:28 UTC 2026-10-11).

## Behavior

- Finishing a room, course or Expanded Room run replies after the run is recorded, verified and ranked and the personal-best ghost is saved.
- The rest runs in the background, in the same order as before:
  - finalize points;
  - the creator's points and stats;
  - XP, rank XP, trust, creator BXP and badges;
  - activity emails;
  - the player's stats.
- The daily-room clear is still awarded before the reply, because the daily panel re-reads it right after a first clear.
- If background rewards fail, the attempt is logged as `run-rewards-failed`; the saved run stands. Before, the player got an error for a run that was already saved.

## Evidence

- `npm run check` on Node 22: 427 files, 3,354 tests.
- Measured on the real schema, a first clear that takes #1 in someone else's room: 138 sequential D1 round trips before the reply → 36.
- `runs/finishDeferral.test.ts`:
  - the reply arrives before the rewards settle;
  - the run and the daily clear are recorded before the reply;
  - all rewards arrive afterwards, with `total_pxp` equal to the event sum;
  - a background failure keeps the 204 and is logged.
  - Both tests fail on the previous code.

## Production check still to do

No run finished between the deploy and this record; finishes cluster between 12:00 and 22:00 UTC. After the first real finishes, run:

```
npx wrangler d1 execute everybodys-platformer-db --remote --command "SELECT r.attempt_id, r.finished_at, (SELECT COUNT(*) FROM pxp_events p WHERE p.user_id = r.user_id AND p.created_at >= r.finished_at) AS pxp_events_after, (SELECT updated_at FROM user_stats s WHERE s.user_id = r.user_id) AS stats_updated FROM room_runs r WHERE r.finished_at > '2026-10-11T02:28:00Z' AND r.result = 'completed' ORDER BY r.finished_at LIMIT 10"
```

Each completed run should show XP events and a `stats_updated` at or after its `finished_at`. Also check `wrangler tail` for `run-rewards-failed`.

## Left

- Making the rewards work itself cheaper (SQL stats aggregate, SQL ranks, fewer reloads).
- The `room_versions(published_by_user_id)` index.
