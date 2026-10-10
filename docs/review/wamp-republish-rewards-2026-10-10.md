# F201 republish rewards

Delivered 2026-10-10 in [PR #111](https://github.com/songadaymann/wamp/pull/111), merge `3e397575`, and deployed to the production API Worker (https://api.wamp.land, version `0d53f953`). No migration.

## Behavior

- **Same room across insignificant republishes.** Versions inside one significant-change window (under 10% weighted change, the window builder XP already used) share player rewards. A first clear, personal best, or the creator's per-player points happen once across the window; only a real rework counts as a new room. Expanded Room rank XP ranks the window together, so a republish does not open an empty board.
- **No rewards from your own content.** A room's claimer, a version's publisher, or an Expanded Room's owner earns no clear points, first-clear or personal-best XP, or rank XP from it. Their runs still appear on leaderboards and personal-best ghosts still save.
- **Clear badges** count each room once, accepted runs only, never your own rooms. Earned badges are kept (badge sync only adds).
- Past rewards are not clawed back. Unchanged republishes are still allowed; they simply pay nothing.

## Evidence

- `npm run check` on Node 22: 418 files, 3,319 tests.
- `clearRewardScope.test.ts` on the real-migrations SQLite fixture: unchanged republish shares the window and a terrain rework starts a new one; claimer and version publishers are owners; an earlier clear on an equivalent version prevents a second first clear; the builder is paid once per player across an unchanged republish and again after a rework; no rank XP on your own room while another player still earns it; badge counts once per room, excluding failed runs and your own room. Four of these six fail against the previous code.
- The Worker deploy shipped only this change on top of F198.
