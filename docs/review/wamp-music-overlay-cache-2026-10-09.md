# F226 music grid draw caching

Delivered 2026-10-09 in [PR #105](https://github.com/songadaymann/wamp/pull/105), merge `27095ce6`, live on https://wamp.land through the Pages auto-build (verified in the served `main` loader's chunks). Completes F226 with the first slice from [PR #101](https://github.com/songadaymann/wamp/pull/101) (unchanged label setters, cheap playhead timing). Frontend only.

## Behavior

While the music sequencer is open, `updateOverlay` runs every frame. It used to clear and rebuild the backdrop, ~55 grid lines, note cells, playhead and mix panel, and recompute 22 row labels and two mix labels. Each now has a key of the inputs it draws from and is rebuilt only when that key changes:

- **Backdrop and grid:** workspace origin, tileset theme, active lane.
- **Note cells:** the same, plus the lane's steps/MIDI/ties and the pitch mode, key and octave that map notes to rows.
- **Playhead:** the playing step.
- **Mix panel and mix labels:** volume, pan, legacy lock.
- **Row labels:** pitch mode, key and octave.

Hiding the overlay or recreating its graphics resets every key.

## Evidence

- `npm run check` on Node 22: 412 files / 3,279 tests, lint, types and build. DOM contract 1,003 / 242.
- Unit tests: idle frames redraw nothing; a note edit redraws only cells; a volume change only the mix panel; a lane switch, theme change or hide/show redraws everything; the playhead redraws only on step changes; row labels only on lane/pitch changes.
- Headless Chromium on the safety API, room and Expanded Room editors: after octave, volume/pan, lane and note edits, every layer's Phaser command buffer and all row/mix label text, color, alpha, position and visibility equal a forced fresh redraw. `updateOverlay` cost ≈ 147 µs → 59 µs per frame on desktop Chromium (Apple silicon). Zero page errors.
