# Parts of F173, F012, F011, F006, F062

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F173 (part) system reduce-motion in play | [#154](https://github.com/songadaymann/wamp/pull/154) | `a887c044` | Pages |
| F012 (part) skip thrown-away lighting and trace work | [#155](https://github.com/songadaymann/wamp/pull/155) | `134dbbb7` | Pages |
| F011 (part) Battery Saver halves weather, no score text | [#156](https://github.com/songadaymann/wamp/pull/156) | `788bd765` | Pages |
| F006 (part) skip special-tile scans in plain rooms | [#157](https://github.com/songadaymann/wamp/pull/157) | `d1605a85` | Pages |
| F062 (part) scene bridge contract | [#158](https://github.com/songadaymann/wamp/pull/158) | `697d3b4e` | typecheck only |

## What changed for players
- With your phone or computer set to reduce motion, hits no longer shake the screen, PvP hits drop the red flash, lights stop flickering, and reward cards appear without animating.
- Battery Saver now really saves: half the rain, snow and fog, and no floating score numbers.
- Behind the scenes, unlit rooms and rooms without special tiles skip per-frame work they used to throw away.

## For future changes
If a scene method that an HTML button calls is renamed or removed, typecheck now fails, instead of the button silently doing nothing.

## Evidence
`npm run check` on Node 22 passed for each PR.
- F173: browser checks with reduced motion emulated on and off.
- F011, F006: new unit tests.
- F062: a deliberate rename fails typecheck.
- F012: by reading the code; no GC trace was taken.

## Left
- F173: in-game Comfort setting.
- F012: `liveObjects.ts` allocations.
- F011: lighting glow pass.
- F006: bitmask for rooms with special tiles.
- F062: capability interfaces.
