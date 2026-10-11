# F054 and F059 strokes and pans the canvas never saw released

Delivered 2026-10-10 in [PR #126](https://github.com/songadaymann/wamp/pull/126), merge `3496d96e`, live through the Pages auto-build (loader `main-U0tOURqL.js`).

## Behavior

- **Room editor, Expanded Room editor and world map**: a press released over a panel or toolbar (`pointerupoutside`) finishes the stroke, shape, object drag or pan exactly like a release over the canvas. A painted stroke is committed, gets its Undo entry, marks the room changed and autosaves.
- A mouse move reporting no buttons for a press the game still holds is treated as the missed release (for a button let go outside the browser window). Losing window focus does the same.
- The world map reads Alt from the click itself, so an Alt-Tab can no longer leave every click panning. Focus loss clears a held Space.

## Evidence

- `npm run check` on Node 22: 430 files, 3,369 tests.
- `src/scenes/editor/interaction.release.test.ts` and `src/scenes/overworld/inspectInput.test.ts`; all seven behaviour tests fail on the previous code.
- Browser (desktop Chromium, local dev server):

  | Check | Before | After |
  |---|---|---|
  | Middle-drag released over a HUD button, then move | the map keeps following | the map stays put |
  | Alt keydown, blur and focus with no keyup, then a plain drag | pans, selection unchanged | selects room −11,−1, no pan |

- Live: the missed-release helper is in `main-Chbzjj8j.js`.

## Left

- A real-mouse check on Windows (Alt-Tab and back by clicking) and on a Mac trackpad.
