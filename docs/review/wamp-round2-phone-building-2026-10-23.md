# Round 2, step 6: phone building — 2026-10-23

Delivers round-2 step 6: F365 and F371 (Expanded Room setup and the Move tool on phones), then F368, F369 and F367 (the room editor's phone dock).

| Item | PR | What changed |
|---|---|---|
| F365 | [#315](https://github.com/songadaymann/wamp/pull/315) | On phones the Expanded Room setup panel is a bottom sheet you can fold, or a side column in landscape. It scrolls as a whole, so every control is reachable. The map drags with one finger and pinches with two, and only a tap selects a cell. |
| F371 | [#315](https://github.com/songadaymann/wamp/pull/315) | With Move picked, a second finger pinches and pans without losing the selection. Phones get a Fit room button in the More menu. |

## Checks

- Reviewed adversarially, with every finding fixed. The review measured the open sheet's scroll area at 24 px on an iPhone SE in Safari, and 0–2 px in landscape. After the fix it's 169–341 px at eight phone sizes, and Publish scrolls into view at each.
- `npm run check` passed (676 files, 5,721 tests; boot 664.5 KB). The muted default (68 of 68), Expanded Room, map-capture and keyboard smokes passed.
- Live on wamp.land (Pages, main `4b13bafa`): the setup sheet markup and the Fit room button are served.

## Second part: the room editor's phone dock

| Item | PR | What changed |
|---|---|---|
| F368 | [#316](https://github.com/songadaymann/wamp/pull/316) | The tile picker scrolls by touch, so every tileset is reachable, including WampOS 95 and Backrooms. A tap picks a tile, a 400 ms hold picks a block, and a tap that stops a fling only stops it. |
| F369 | [#316](https://github.com/songadaymann/wamp/pull/316) | A one-tap Draw/Erase switch floats at the stage's bottom-left while the sheet is folded. It hides under menus and dialogs, and covers no room tiles in either editor. |
| F367 | [#316](https://github.com/songadaymann/wamp/pull/316) | All seven dock buttons, Markers and Room Setup included, fit at 360–390 px. At 320 px or with larger text the row scrolls with an edge cue. |

### Checks

- Reviewed adversarially, with every finding fixed. The review caught the switch covering the open sheet's options and the Account menu, the switch covering floor tiles in landscape, a tap after a fling picking a tile, and a too-short hold catching slow swipes.
- The agent's own probe found the picker's tileset section had shrunk to 16 px at 390 px. All 23 tilesets were checked by touch at 390 and 320 px.
- `npm run check` passed (682 files, 5,755 tests; boot 664.7 KB).
- `smoke_editor_phone_dock.mjs` now also checks that the dock fits without scrolling at 390, 375 and 360, taps the switch both ways, and taps WampOS 95's last row after a swipe. It passed all six scenarios, muted, against a local Worker.
- In landscape the switch covers 0 tiles at 667×375, 740×360 and 844×390 in both editors, at default zoom and after Fit.
- Live on wamp.land (Pages, main `17aa935d`): the switch markup and the new picker hint are served.

### Only Jonathan can check

- **F368:** on a phone, scroll WampOS 95 to its last row and tap a tile; then hold and drag to pick a block. On iOS, check that a hold doesn't also scroll the sheet.
- **F369:** with the sheet folded, switch Draw and Erase; in landscape, check the switch sits beside the room, not on it.
- **F367:** on a 390 px phone, Markers and Room Setup should be visible in the dock without scrolling.

## Only Jonathan can check (first part)

- **F365:** on a phone, open Expanded Room setup, fold and unfold the sheet, and drag and pinch the map. In landscape, scroll the sheet to Publish.
- **F371:** in either editor with Move picked, marquee-select some objects, then pinch. The selection should stay. Tap More, then Fit room.
