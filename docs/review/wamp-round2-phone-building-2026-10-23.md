# Round 2, step 6: phone building — 2026-10-23

Delivers round-2 items F365 and F371, Expanded Room setup and the Move tool on phones. The room editor's phone dock items (F368, F369, F367) come next.

| Item | PR | What changed |
|---|---|---|
| F365 | [#315](https://github.com/songadaymann/wamp/pull/315) | On phones the Expanded Room setup panel is a bottom sheet you can fold, or a side column in landscape. It scrolls as a whole, so every control is reachable. The map drags with one finger and pinches with two, and only a tap selects a cell. |
| F371 | [#315](https://github.com/songadaymann/wamp/pull/315) | With Move picked, a second finger pinches and pans without losing the selection. Phones get a Fit room button in the More menu. |

## Checks

- Reviewed adversarially, with every finding fixed. The review measured the open sheet's scroll area at 24 px on an iPhone SE in Safari, and 0–2 px in landscape. After the fix it's 169–341 px at eight phone sizes, and Publish scrolls into view at each.
- `npm run check` passed (676 files, 5,721 tests; boot 664.5 KB). The muted default (68 of 68), Expanded Room, map-capture and keyboard smokes passed.
- Live on wamp.land (Pages, main `4b13bafa`): the setup sheet markup and the Fit room button are served.

## Only Jonathan can check

- **F365:** on a phone, open Expanded Room setup, fold and unfold the sheet, and drag and pinch the map. In landscape, scroll the sheet to Publish.
- **F371:** in either editor with Move picked, marquee-select some objects, then pinch. The selection should stay. Tap More, then Fit room.
