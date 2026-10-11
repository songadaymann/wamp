# F080, F017 and F023 (part)

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F080 portrait play canvas ends at the controller panel | [#136](https://github.com/songadaymann/wamp/pull/136) | `3c3b4e58` | Pages (loader `main-BW_UonDA.js`) |
| F017 lossless PNG recompression and check | [#137](https://github.com/songadaymann/wamp/pull/137) | `afb8338a` | Pages |
| F023 (part a) drum samples load in parallel | [#138](https://github.com/songadaymann/wamp/pull/138) | `7b1010e9` | Pages (loader `main-DJo4pM17.js`) |

## F080
In portrait play the canvas filled the whole screen and the opaque controller panel covered the bottom 294 px of it. Now the canvas ends at the panel. On an iPhone 13 that is 370 px of canvas instead of 664. In rooms with a fixed camera the bottom of the room and the player used to sit behind the controls; they are now above them (player at y 274, was 422 under a panel starting at 370). Follow mode looks the same.

## F017
Every PNG in `public/assets` was re-encoded losslessly: 512 files, 6.17 MB → 4.34 MB, pixel-identical (checked with a second decoder) and with the same colour chunks. `npm run check` and CI now fail when new art could shrink by more than 10%, so run `npm run assets:png:optimize` after adding art.

## F023 (part a)
Rooms with pattern or phrase-arrangement music downloaded the 15 drum samples one at a time before the loop could start. They now download together, and the shared kick file downloads once.

## Evidence
`npm run check` on Node 22 passed for each PR. F080: iPhone 13 emulation measurements above, and the mobile smoke play scenarios. F017: PIL comparison of all 512 files; 882 PNG loads in the browser with no failures; `CyberText.png` is 1,226 bytes live (1,946 before). F023: `music/patternKit.drumLoading.test.ts` (fails on the previous code); the per-file fetch cache is in the live `main-DxfimASP.js`.

## Left
- F080: dimming neighbouring rooms around a fixed room camera (F098).
- F017: lossless WebP; splitting the CryptoPunk head atlas.
- F023: compressed pre-baked drum samples, stem re-encode, warming hot sound effects, unused SFX WAVs in the deploy.
