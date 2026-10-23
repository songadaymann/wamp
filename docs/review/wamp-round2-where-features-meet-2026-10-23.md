# Round 2, step 5: where features meet — 2026-10-23

Delivers round-2 items F378, F385, F383 and F375, the first group of step 5. Different inputs took different paths to end a run, so they disagreed. Now they share one. The dialog and accessibility regressions (F380, F464, F467, F406) and the small fixes (F471, F478, F477) come next.

| Item | PR | What changed |
|---|---|---|
| F378 | [#309](https://github.com/songadaymann/wamp/pull/309) | Every stop input goes through one path, so P and Escape end a Room Rush with its result and score, like the Stop button. A stop during a Hard Rush's death beat counts the death. Escape leaves play alone while the game menu is open. |
| F385 | [#309](https://github.com/songadaymann/wamp/pull/309) | Escape is handled once, in order. Closing chat or the comment box with Escape no longer ends the run. |
| F383 | [#309](https://github.com/songadaymann/wamp/pull/309) | Jumping to a room from a menu mid-run ends the run first. During a Rush the result takes the jump's place, with a message, and nothing starts behind it. |
| F375 | [#309](https://github.com/songadaymann/wamp/pull/309) | Room music stops when a test run returns to the editor, and the next test plays it again. |

## Checks

- Two adversarial reviews, with every finding fixed. One review re-ran all 526 frozen frame traces: the 44 that changed differ only in the renamed stop call.
- `npm run check` passed (651 files, 5,575 tests; boot 666.9 KB).
- The muted default smoke passed 68 of 68, and the keyboard, pause and assist smokes passed.
- Live on wamp.land (Pages `d8acbc28`, main `e77586d1`), as a guest in a muted browser: Escape behind the open game menu kept the run going, and Escape and P each stopped play.

## Only Jonathan can check

- **F378:** in a Weekly Rush, press Escape, and in another, P. Each should show the result and save the score.
- **F385:** signed in, press T, click the game, then press Escape. The chat should close and you should stay in the room. (Guests can't open room chat, so the live check couldn't cover this.)
- **F383:** during a Rush, open Explore and click a room. The Rush result should show, with "Room Rush ended. Open the room again to play it."
- **F375:** test a room with music, press Stop, and confirm the editor is silent. Test again and the music should play.
