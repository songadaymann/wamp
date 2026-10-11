# F200 trust tiers and trust earning

Delivered 2026-10-10 in [PR #114](https://github.com/songadaymann/wamp/pull/114), merge `21c4586a`, and deployed to the production API Worker (https://api.wamp.land, version `37937f8f`). No migration; past trust is not recomputed.

## Policy (chosen by Jonathan)

- **T0:** verified as before.
- **T1:** verified when a run would take the #1 spot or beat #1 by a wide margin; otherwise unverified.
- **T2+:** unverified.
- Runs that would have been checked but were skipped keep their trace in the audit row for later review.

## Trust earning

- Clear trust: once per room and significant-change window, never from your own room or Expanded Room, at most 5 per UTC day; saved to the runner (it was being credited to the room's creator).
- Publish trust: at most 6 per UTC day across rooms and courses.
- Creator completion trust: at most 10 per UTC day.
- Accounts younger than 3 days stay at effective T0 whatever their score; moderation penalties still zero it.

## Evidence

- Before the change: over the previous month, 9 signed-in players finished runs and the 5 at T2+ made 728 of 737 clears.
- `npm run check` on Node 22: 420 files, 3,335 tests.
- `trustEarning.test.ts` on the real-migrations SQLite fixture: tier policy; runner +1 / creator +2 attribution; one clear-trust award per room and none for your own room; the daily cap and its reset; the 3-day hold. Four of five fail against the previous code.
