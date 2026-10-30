# Round 2, step 5: where features meet — 2026-10-23

Delivers round-2 step 5: F378, F385, F383 and F375 (one way to end a run), then F380, F467 and F406 (dialogs) and F464, F471, F477 and F478 (selected states, announcements, focus and the menu). F319 from the load-time section went with them, to make room under the startup budget.

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

## Second group: dialogs, accessibility and startup size

| Item | PR | What changed |
|---|---|---|
| F380 | [#313](https://github.com/songadaymann/wamp/pull/313) | One page-wide watcher puts every dialog, including ones loaded on demand or built in code, on the shared focus, dimming, game-key and pause handling. |
| F467 | [#313](https://github.com/songadaymann/wamp/pull/313) | The shared pop-up has tones (error, success, choice), only destructive buttons are red, and it takes focus and Escape like a dialog. The wallet-waiting state leaves the wallet window alone. |
| F406 | [#313](https://github.com/songadaymann/wamp/pull/313) | Worlds and the PvP pop-ups are shared dialogs. Duel challenges wait until a run ends, with a status-line notice, and the server limits them (API Worker `3034c796`). |
| F464 | [#312](https://github.com/songadaymann/wamp/pull/312) | Explore, Leaderboard, votes, post-run rating and Room Rush modes show which one is selected (frame, tick and `aria-pressed`). Your own rating stays visible, and the Profile tabs are a real tab list. |
| F471 | [#312](https://github.com/songadaymann/wamp/pull/312) | Error and status lines in 12 menus are announced to screen readers, and a repeated error is announced again. |
| F477 | [#312](https://github.com/songadaymann/wamp/pull/312) | Keyboard focus rings a player name in its own colour instead of fading it. |
| F478 | [#312](https://github.com/songadaymann/wamp/pull/312) | The menu button reports whether the menu is open, and Escape closes the menu without stopping play. |
| F319 | [#311](https://github.com/songadaymann/wamp/pull/311) | Developer tools and the bug report form load only when used: boot JavaScript is 663.5 KB, down from 668.4 KB. |

### Checks

- Each branch had an adversarial review, and every finding was fixed. The dialog review caught three problems: the Worlds panel shrinking, focus being pulled out of the wallet window, and duel challenges interrupting runs.
- On the combined branch, `npm run check` passed (667 files, 5,686 tests; boot 664.7 KB). The muted smokes passed: default (68/68), keyboard, pause, sign-in, approval cost, wallet sign-in, wallet recovery, chat identity, room protection and map capture.
- Release: API Worker `3034c796`, deployed from main `2460b616`. The production smoke passed. Pages deploy `bc685e3d` serves the new build on wamp.land.
- Live, in muted desktop Chromium and iPhone WebKit: the menu button's `aria-expanded` goes false, true, false as the menu opens and Escape closes it, and the page stays on the world view. The live scene chunk has the duel notice, the pop-up tones and the lazy bug report form.

### Only Jonathan can check

- **F406:** signed in, have a friend challenge you mid-run. No pop-up should appear, only a line naming them, and the challenge should be offered again on the world map.
- **F380/F406:** open Worlds on desktop; the panel should be full width. Open a dialog from the menu, then press Escape; only that dialog should close.
- **F467:** during a room approval, type in the wallet's search box, then press Escape. It should close the wallet window and leave the approval waiting.
- **F471:** with VoiceOver, press Sign in the guestbook twice with empty fields. The message should be read both times.
- **F464:** at 320 px with Large text, pick an Explore filter. The tick shouldn't change the button's size.
- **F319:** press Report a bug. The form should open after a short download.

## Only Jonathan can check (first group)

- **F378:** in a Weekly Rush, press Escape, and in another, P. Each should show the result and save the score.
- **F385:** signed in, press T, click the game, then press Escape. The chat should close and you should stay in the room. (Guests can't open room chat, so the live check couldn't cover this.)
- **F383:** during a Rush, open Explore and click a room. The Rush result should show, with "Room Rush ended. Open the room again to play it."
- **F375:** test a room with music, press Stop, and confirm the editor is silent. Test again and the music should play.
