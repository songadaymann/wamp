# Map screenshots (independent Worker)

Daily 4K PNGs of the published WAMP map, stitched from the existing world-tile pyramid.

## What this is

- Separate Cloudflare Worker (`wrangler.map-screenshot.jsonc`) — does not change overworld gameplay or tile generation.
- Stores files in R2 under `screenshots/yyyy_mm_dd_0.png` (manual captures: `yyyy_mm_dd_1.png` … `_9.png`).
- Public gallery and streaming ZIP downloads are served by the map Worker. Manual captures require the existing Launch Admin key through the API Worker service binding; public capture HTTP routes are denied.
- Pretty URL: `https://wamp.land/capture` (Pages proxies to this Worker).
- Gallery can export a 4K H.264 MP4 (MPEG-4) from a date range in-browser (ffmpeg.wasm).
- Tunables live in `src/mapScreenshot/config.ts`.

## One-time setup

```bash
npm run map-screenshot:bucket:create
npm run map-screenshot:deploy:safety
# after QA:
npm run map-screenshot:deploy:production
```

Public gallery: [https://wamp.land/capture](https://wamp.land/capture) (also the Worker URL below after deploy).

Optional custom domain (e.g. `screenshots.wamp.land`) can be attached in the Cloudflare dashboard to the Worker.

## Twitter / X (phase 2)

Collect and store as Worker secrets when ready:

- `TWITTER_API_KEY`
- `TWITTER_API_KEY_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

App needs Read and Write + a posting-capable API tier. See comments in `src/mapScreenshot/twitter.ts`.

## Capture budget and release order

Migration0067 adds one expiring capture lease and indexed attempt records. A reservation is consumed before work: daily slot0 plus manual slots1–9, including failed attempts. Existing filenames are preserved. Only a scheduled daily capture advances the authoritative D1 daily zoom; legacy R2 zoom is a recovery source until the first successful daily commit. Manual captures reuse the latest daily zoom. Capture-time cleanup removes at most100 expired attempt rows, with no idle coordinator.

Deploy the migration to the target database, then this map Worker (including MapScreenshotAdmin), then the matching API Worker service binding and Pages. Safety binds only the safety map Worker. Never roll this Worker back to a version with public capture POST routes if another release stage fails; the gallery remains public and the API action can fail closed. Twitter remains disabled.

Archives preserve all-history and month downloads, streamed with one open R2 reader and backpressure. ZIP32/10,000-file limits are checked before streaming; an oversized selection requires a month. Missing, changed or truncated objects fail the download instead of producing a complete-looking corrupt ZIP.
