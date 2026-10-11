# F168 Escape closes menus without leaving the room

Delivered 2026-10-10 in [PR #120](https://github.com/songadaymann/wamp/pull/120), merge `7242388b`, live through the Pages auto-build (loader `main-EsRHLu10.js`).

## Behavior

- While any dialog (`.history-modal`) is visible, a capture-phase keydown guard marks Escape as handled. The dialog still closes itself, but Phaser skips the key, so it no longer also triggers return-to-world.
- The play-mode return-to-world key (Escape/P) checks for an open dialog first.
- With no dialog open, Escape still returns to the world as before.

## Evidence

- `npm run check` on Node 22 passes (423 files, 3,345 tests).
- Browser, local dev server, room −2,−6 in play mode:
  - Escape with Settings open: Settings closes and the mode stays `play`. Before the fix it became `browse`.
  - P with Settings open: stays in `play`.
  - Escape with no dialog: returns to the world.
- Live: the guard (`{capture:!0}` Escape handler beside the `.history-modal` check) is in wamp.land's `main-9cBmmKAr.js` chunk.

## Left

- The ~15 hand-rolled modal Escape handlers still don't call `preventDefault()` themselves; the global guard covers them.
- Needs a hands-on check in a desktop browser during a real run and a duel.
