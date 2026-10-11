# F033 profile summaries where only identity and progression are needed

Delivered 2026-10-10 in [PR #125](https://github.com/songadaymann/wamp/pull/125), merge `93740740`, live through the Pages auto-build (loader `main-U0tOURqL.js`).

## Behavior

- These read `GET /api/profiles/:id/summary` (identity, stats and progression) instead of the full profile:
  - the identity chip;
  - the reward-sting catch-up on every signed-in page load;
  - publish feedback (both reads, still fresh);
  - the leaderboard and post-run rating baselines;
  - the room-card builder summary.
- The profile modal still loads the full profile with its room and playlist lists.

## Evidence

- `npm run check` on Node 22: 428 files, 3,358 tests. `publishing/feedback.test.ts` asserts that the fresh read goes to `/summary` with `cache: 'no-store'`.
- Production, anonymous, the builder with the most rooms (two requests each):

  | Endpoint | Size | Server time | TTFB |
  |---|---|---|---|
  | full | 131 KB | 623–1,070 ms | 1.2–1.8 s |
  | `/summary` | 6 KB | 69–86 ms | 0.16–0.18 s |

- Live bundle: `loadProfileSummary` is in `rewardStings-jkDlizM4.js`.

## Left

- The full profile's room list could come from the playable-content index. That would also change which rooms the profile modal lists (Expanded Rooms included), so it is a separate decision.
