# Round 2, step 3: phone play — 2026-10-22

Delivers round-2 items F350, F355, F351, F358, F354, F304, F307, F352 and F357. Every branch had at least one adversarial review, and every finding was fixed before merge. F351 went through four review rounds.

| Item | PR | What changed |
|---|---|---|
| F350 | [#299](https://github.com/songadaymann/wamp/pull/299) | The next room is predicted from what the jump can reach. Standing on a floor no longer prepares the room below; climbs and holes still get a lead. |
| F355 | [#300](https://github.com/songadaymann/wamp/pull/300) | A "Loading next room…" / "Still loading…" / "Offline…" chip while held at an edge; reconnecting retries at once. |
| F351 | [#301](https://github.com/songadaymann/wamp/pull/301) | Ranked clears that fail to send are resent instead of lost. The server settles each finish's rewards exactly once (migration 0074, API Worker `d1bf600c`). |
| F358 | [#296](https://github.com/songadaymann/wamp/pull/296) | No more low-diagonal crawl on the touch stick; gravity zones jump once per push. |
| F354 | [#295](https://github.com/songadaymann/wamp/pull/295) | Tablets stay in the tablet layout when the keyboard opens. |
| F304, F307, F352, F357 | [#297](https://github.com/songadaymann/wamp/pull/297) | Phone memory: plain image textures, no empty foreground layers, reference-counted custom backgrounds, and a small shared copy for tiled photos. |

Also merged: [#298](https://github.com/songadaymann/wamp/pull/298). Jonathan asked for silent tests, so every browser the smoke and probe scripts launch is now muted (Chromium `--mute-audio`, and a zero-gain init script for WebKit).

## Checks

- `npm run check` passed on each group: 5,433 tests for the F354/F358/memory batch, 5,429 for F350/F355, and 5,464 for F351.
- The default mobile smoke passed 68 of 68, muted, on each group.
- Map capture, Expanded Room, assist and auth smokes passed where relevant.
- For F351, migration 0074 was applied before API Worker `d1bf600c` and backfilled about 64,000 settlement rows. `/api/health` reports 0074.

## Verified on real traffic (2026-10-23)

- F351, read-only production checks. By about 19:30 UTC, 95 room finishes had arrived since API Worker `d1bf600c` went out at 02:47 UTC, Jonathan's two signed-in clears of -17,-5 among them.
  - Every finish has a `finalize_seq`: 1 to 95, with no gaps or repeats.
  - Each finish has exactly one `run_settlements` row.
  - Rewards can't be paid twice. `point_events` is unique on event type and source, and `pxp_events`, `bxp_events` and `cxp_events` are unique on their dedupe key.
- This releases F333 (step 4), which was waiting on this check.

## Only Jonathan can check

- **F350:** on a phone, run along a floor and hop into the next room; there should be no hold at the edge.
- **F355:** on a throttled connection or offline, push into an unloaded room; the chip should appear, and you should check where it sits on screen.
- **F358:** drift your thumb slightly down while running; the hero should keep running and still jump.
- **F354:** on an iPad, type in chat; the layout should stay the tablet one.
- **F352/F357:** walk between photo-background rooms on a phone, then open one in the editor.
- **F351:** finish a ranked run with the connection dropping, and the clear should still count. Normal finishes are verified on real traffic (above); this checks the resend.
