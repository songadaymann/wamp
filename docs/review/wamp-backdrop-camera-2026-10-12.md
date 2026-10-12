# F068 backdrop camera (covers F009)

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F068/F009 overworld: starfield camera renders only its layer | [#181](https://github.com/songadaymann/wamp/pull/181) | `1011f78b` | Pages |
| F068 editor: remove the never-created background camera | [#182](https://github.com/songadaymann/wamp/pull/182) | `7db8ea82` | Pages |

## What changed
- The starry background is drawn by its own camera behind the world. Before, every system that made sprites had to hand them to a list, so that camera would skip them. Anything forgotten was drawn twice; the review found cannon bullets and the brick-break sprite in that state.
- That list was rebuilt about 9 times a second during play (every jump, coin, shot, chat bubble or room change).
- Now the background camera simply draws its own layer and nothing else, so new sprites need no registration. The list, its rebuilds and the plumbing in 20 files are gone.
- The editor had the same plumbing for a background camera it never created. That is gone too.
- 584 lines removed in total.

## Evidence
- `npm run check` passed for both PRs: 3,479 tests, boot JS 637.4 KB.
- CI, including the phone smoke, passed on both.
- **Draw order on `/r/1/-1` (browse and play, two runs each):**
  - Within every room and depth, order matches main. The only object that moves is the player's invisible physics box.
  - Objects at the same depth in different rooms can swap order, but they never overlap.
- **Screenshots against main:**
  - Overworld browse: identical.
  - Overworld play: differs only by animation timing.
  - Desktop editor (synthetic room and police room): identical.
- **Lifecycle:** the background camera renders exactly its own layer through play, Stop and a scene restart, with no page errors.
- **Live:** the production bundle contains the new filter and none of the old code. Browsing wamp.land at 0.17× zoom shows no page errors.

## Left
- Nothing for F068.
- Some `roomComments*` presentation controllers keep a `getIgnoredObjects()` accessor that only tests use.
