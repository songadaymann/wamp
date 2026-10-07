# Traversal pack artwork — 2026-10-07

Final game assets:

| Asset | File | Shape |
| --- | --- | --- |
| Jump Feather | `public/assets/objects/jump-feather-v1.png` | 16×16 transparent pickup |
| Sideways Spring | `public/assets/objects/spring-side-v1.png` | Two 16×16 transparent frames |
| Diagonal Spring | `public/assets/objects/spring-diagonal-v1.png` | Two 24×24 transparent frames |
| Special terrain atlas | `public/assets/tilesets/special-traversal-v1.png` | 128×128; crumbling block in slot 18 |

The feather and cracked stone were generated with the OpenAI image tool and prepared with Sharp. The feather is trimmed, reduced with nearest-neighbor sampling to fit 14×14, then padded to 16×16. The stone is reduced to 16×16 and packed into special slot 18 at (32,32). All 16,128 pixels outside that slot match the original atlas exactly; existing artwork, including reserved Portal A/B slots 16/17, is preserved. Both spring sheets reuse the existing two bounce-pad frames, rotated 90° and 45° respectively. Original bounce-pad art is unchanged.

The final assets are versioned paths so previously cached atlas/object bytes cannot replace the new art. These catalog changes require coordinated map renderer, API and frontend publication. The current nonstrict release check reports new contract `authoring-catalog-v1:020c7c1d1777764e` against production `authoring-catalog-v1:31d8d3ff3504cf17`; the strict release gate must pass after matching imagery is prepared.

## Generation prompts

Feather (`transparent_background: true`):

> Create one tiny 16-bit pixel-art platformer pickup icon: a single luminous pale cream / light cyan feather with a dark navy one-pixel outline, its quill pointing down-left and feather tip up-right. Compact silhouette readable at 16 by 16 logical pixels, four-color restrained palette, no text, no shadow outside silhouette, no other objects, no frame, no gradients or antialiasing. This will be used as an in-game double-jump pickup. Draw on a strict coarse 16x16 pixel grid, enlarged with exact nearest-neighbor blocks to fill a square image, with 1 logical pixel of transparent padding. Actual transparent background. Save as PNG.

Crumbling stone (`transparent_background: false`):

> One square crumbling stone block tile for a colorful 16-bit pixel-art platformer. Strict 16 by 16 logical pixel grid enlarged with nearest-neighbor crisp square blocks. Entire tile filled edge to edge: warm light sandstone face, thin dark navy/brown border, pale upper rim, three visibly deep jagged dark cracks converging through center. Readable cracked/fragile stone even at 16x16, restrained five-color palette. Single tile only, orthographic front view, no surrounding scene, no text, no drop shadow, no perspective, no antialiasing, no gradients. The square stone fills the image exactly, flat opaque background because this is a solid terrain tile.

Original generated sources on this machine:

- `/Users/jonathanmann/.codex/generated_images/01a10381-8f4c-7c51-b777-38e797e73bc5/exec-f6011cd6-b295-4cf3-85a1-17a2b5972b27.png`
- `/Users/jonathanmann/.codex/generated_images/01a10381-8f4c-7c51-b777-38e797e73bc5/exec-3f515bd9-f0f0-4838-bbe3-0a25a2060345.png`

The native ordinary/expanded editor and desktop/portrait gameplay screenshots were inspected. Accepted local screenshots and the preparation script are retained under `/tmp/wamp-f143-2026-10-07/`; the final prepared PNGs above are the production inputs.

## Verified production delivery

PR #79 / merge `d1210e01` delivers this exact artwork through immutable renderer origin `https://5893c1dd.wampland.pages.dev`, active map `production-2026-10-07-traversal-020c7c1d`, matching catalog `authoring-catalog-v1:020c7c1d1777764e`, API `30732882` and canonical Pages `37ca7e04`. All four prepared PNGs match the custom-domain and immutable final release bytes. Complete 994-tile/681-room readiness, all 974 nonempty object keys and public pixel/gutter/parent parity pass before frontend publication. Published-frontend desktop/portrait native gameplay is inspected using explicitly isolated local API fixtures; no production fixture rooms are created.
