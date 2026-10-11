# F005, F116 and F038

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F005 one-pass dark-room lighting | [#132](https://github.com/songadaymann/wamp/pull/132) | `ded5d9cb` | Pages (loader `main-BDinv_oB.js`) |
| F116 Escape closes only the top dialog | [#134](https://github.com/songadaymann/wamp/pull/134) | `61269ba6` | Pages |
| F038 (fix a) replay flags per batch | [#135](https://github.com/songadaymann/wamp/pull/135) | `d5b8e6ef` | API Worker `2c279cb5-245b-4bfa-8a2b-372019474236` |

## F005
Dark rooms erased each light from the darkness, and drew each glow, as a separate GPU pass. Each pass cost a full render-target switch, clear and blit. Now all lights go in one pass per layer with the same look. Dark room 2,1 (38 lights) under SwiftShader with 4× CPU throttle:

| | median frame | p90 |
|---|---|---|
| before | 90.8 ms | 98.4 ms |
| after | 50.0 ms | 58.9 ms |

Screenshots of the dark room match (mean luminance 11.19 vs 11.14). About 10% of published rooms (66 of 684) are dark.

## F116
A profile opened from the leaderboard (or Explore) and one Escape closed both, under two stacked 80% backdrops. Now Escape closes only the top dialog, and the dialog underneath drops its backdrop until it is on top again. Single dialogs behave as before, and Escape still doesn't leave a room while a dialog is open (F168).

## F038 (fix a)
Each guest replay upload recomputed four activity flags by re-reading every stored sample, JPEG included. The flags now come from the incoming batch. Over 150 random sessions they match a full recomputation exactly.

## Evidence
`npm run check` on Node 22 passed for each PR. F005: `src/lighting/controller.test.ts`. F038: the equivalence test in `guestReplay/routes.test.ts`. F116: the browser before/after above and the F168 regression run.

## Left
- F005: light-texture churn from flicker; per-frame emitter rebuilding.
- F116: focus return; migrating dialogs to `createModalLifecycle`.
- F038: scheduled pruning of expired rows (deletes production data, so for review); frames in R2.
