# F169, F072, F067, and parts of F056, F120, F094

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F169 menus get arrow keys and Space | [#140](https://github.com/songadaymann/wamp/pull/140) | `57dbffd6` | Pages (`main-BG7CxQbp.js`) |
| F056 (part) leaving the editor waits for an autosave | [#141](https://github.com/songadaymann/wamp/pull/141) | `52e0b3ed` | Pages (`EditorScene-BYzFwvT2.js`) |
| F120 (part) Google font no longer blocks the first paint | [#142](https://github.com/songadaymann/wamp/pull/142) | `812227e0` | Pages (`main-CpuxWhyE.css`) |
| F094 (part) backgrounds download as WebP/AVIF | [#143](https://github.com/songadaymann/wamp/pull/143) | `efbff3e2` | Pages (`main-DB6DyBqj.js`); API Worker `0edbab18` |
| F072 DOM contract checks every looked-up ID | [#144](https://github.com/songadaymann/wamp/pull/144) | `10f53337` | Pages / tooling |
| F067 lint and compiler checks, file-size ratchet | [#145](https://github.com/songadaymann/wamp/pull/145) | `8382b61a` | Pages / tooling |

## F169
With a dialog open, or a slider, choice or dropdown focused, the game no longer swallows arrow keys and Space. The Settings volume slider now moves with the arrow keys (100 → 99; it ignored them before). Outside dialogs the game keeps its keys, including when a HUD button has focus.

## F056 (part)
Pressing Back while an autosave was uploading showed "Publish failed. Draft save failed." and stayed in the editor. Leaving now waits for the save, then goes on as usual. Leaving a room that can't be published yet (no exit, no enemies) keeps a draft and says why on the world screen. **Needs your decision:** whether leaving should ever publish (see the checklist line).

## F120 (part)
The Google Fonts stylesheet used to hold up the first paint. On a throttled phone link the loading screen now paints at 752 ms (was 956), and at 256 ms on 4G (was 376). Self-hosting IBM Plex Mono would finish this, but it needs the font files downloaded.

## F094 (part)
Custom backgrounds now download as WebP/AVIF. The 8.3 MB GIF background is 2.8 MB, and normal backgrounds are smaller too. A still, size-capped Cloudflare Images variant would take it to tens of KB; that's a setting in your Cloudflare account.

## F072 and F067
Checks for future changes:
- `npm run check` now fails when code looks up an element ID that no page has (909 lookups checked);
- async event handlers have to be wrapped deliberately;
- the 20 largest files can't grow;
- three more TypeScript strictness flags are on.

## Evidence
`npm run check` on Node 22 passed for each PR. Tests that fail on the previous code: F056 `roomSession.test.ts` (2 cases), F094 `runtime.test.ts` and `backgroundImages/routes.test.ts`. Browser checks: F169 keydown probe; F120 throttled paint timing; F094 production Range GETs. The contract and lint probes are in the details file.

## Left
- F056: the exit-publish policy.
- F120: self-host IBM Plex Mono.
- F094: Cloudflare Images variant, the bad GIF, an upload type check.
- F072: `index.html` partials.
- F067: switch exhaustiveness, Knip.
