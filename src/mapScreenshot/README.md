# Map screenshots (independent Worker)

Daily 4K PNGs of the published WAMP map, stitched from the existing world-tile pyramid.

## What this is

- Separate Cloudflare Worker (`wrangler.map-screenshot.jsonc`) — does not change overworld gameplay or tile generation.
- Stores files in R2 under `screenshots/yyyy_mm_dd.png` (manual tests: `yyyy_mm_dd_1.png` … `_9.png`).
- Gallery + manual button + ZIP download are served by the Worker itself.
- Tunables live in `src/mapScreenshot/config.ts`.

## One-time setup

```bash
npm run map-screenshot:bucket:create
npm run map-screenshot:deploy:safety
# after QA:
npm run map-screenshot:deploy:production
```

Optional custom domain (e.g. `screenshots.wamp.land`) can be attached in the Cloudflare dashboard to the Worker.

## Twitter / X (phase 2)

Collect and store as Worker secrets when ready:

- `TWITTER_API_KEY`
- `TWITTER_API_KEY_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

App needs Read and Write + a posting-capable API tier. See comments in `src/mapScreenshot/twitter.ts`.
