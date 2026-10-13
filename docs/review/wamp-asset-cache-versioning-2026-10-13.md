# F021 — content versions for public assets, 2026-10-13

Approved next item after F013. Branch `codex/wamp-asset-cache-versioning-2026-10-13` starts from main `c3028866`, retaining PR #189. Primary dirty auth/editor work and the private handoff are preserved.

## Behavior

At build time, SHA-256 of each nonhidden file in `public/assets` produces a 12-hex-character content version (810 current files). URLs receive `?v=<hash>` when files load, leaving authoring registries, GIDs and the world-tile authoring contract unchanged. Ordinary code releases retain the same art versions. No source art or audio bytes changed.

Phaser's public addfile event versions images, sheets and both atlas files while retaining keys and external avatar URLs. Boot and dynamic scene/avatar loaders install the handler, remove it on shutdown/destroy and rebind on scene restart. DOM palette/editor/profile/reward images, avatar previews, mint image rendering and audio loaders use the same helper. Audio assets resolve from the deployment root on deep room links, preserving explicit deployment prefixes and external CDN URLs.

HTML image/preload/data attributes and inline background-card images get content versions. A PostCSS Once hook runs after nested stylesheet imports and before Vite's production URL placeholders, covering all 14 public font/editor-icon CSS references. Vite's public-directory behavior is documented in [its asset guide](https://vite.dev/guide/assets.html); the actual nested-import production path has an integration regression.

The Pages asset handler serves build files in `assets/cache-v2` and public URLs with the current content hash as `public, max-age=31536000, immutable`. Unversioned, unknown-version and obsolete-version URLs get `public, max-age=86400, must-revalidate`; `_headers` uses that fallback too. Conditional 304 responses retain their status/ETag and policy. Missing files or HTML fallbacks stay uncached 404s. Old browser entries cannot be remotely expired, so the new URLs are what bypass an already cached unversioned image.

## Evidence

- Full `npm run check`: 465 files / 3,518 tests, lint, TypeScript, DOM contract, generated types, production build, PNG/atlas checks and 648.3 KB brotli startup under 670 KB.
- All 12 production-build mobile/tablet scenarios pass: zero page/console errors and fixture misses. Existing preview-server proxy diagnostics remain outside the browser assertions.
- A Chromium context with browser caching enabled (no request routing) first caches an unversioned image with the old year-long policy. The new app requests its content version. A second unchanged reload makes no additional image transfer; changing the same file's pixels red → blue changes its URL and fetches the new pixels. The unchanged font keeps its version and remains cached. This uses the actual compiled Pages asset handler with two fixture manifests and the real HTML transform. Screenshot inspected. Fixture files live outside the repository; no production art edit is needed.
- Unit/integration coverage: only changed bytes receive new versions; query parameters/fragments survive; external/data/blob/API URLs are preserved; font filenames with spaces work; both atlas files version without changing keys; loader cleanup/restart works; nested CSS versions survive an actual Vite production build; successful and conditional responses preserve status/ETag while applying cache policy; missing assets stay uncached.
- Native desktop and phone: all 11 tree atlas families and static decorations render, delayed loading and Browse cache redraw work, rapid background switches stay correct, and editor → Test retains movement/jumping. Every observed art/tileset/font/player/enemy request carries its content version. Screenshots inspected; zero page exceptions or missing-art warnings.
- The unchanged official client reaches Canvas gameplay with an inspected capture. Its two safety-API HTTP diagnostics are the same unsupported endpoints as earlier; native browser checks have no page exceptions.

Evidence: `/tmp/wamp-f021-2026-10-13/`. Frontend, generated Pages asset handler and build configuration only; no API Worker, PartyKit, world-map renderer or production data changes. F023 and F094 remain separate.

## Delivery

PR [#190](https://github.com/songadaymann/wamp/pull/190), source `2341b775`, merged as `07f1f8ff`. Quality, mobile smoke and both Cloudflare previews pass. The wampland preview matches 203 game/CSS/font/atlas/sample files to the verified source/static bytes, and its current-version versus unversioned cache headers match the new policy. A real preview phone flow renders art/fonts, moves/jumps and sends only versioned local art requests, with zero page exceptions; capture inspected. Main follows automatic Cloudflare Pages delivery. The final production deployment ID, custom-domain byte/header comparison and live browser postflight are reported in the completing chat. This record changes documentation only.
