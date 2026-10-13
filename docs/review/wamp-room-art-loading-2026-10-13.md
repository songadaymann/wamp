# F013 — room art on demand, 2026-10-13

Approved next item after the six smaller fixes. Branch `codex/wamp-room-art-loading-2026-10-13`, based on current main `57a19656`; the primary dirty checkout and private handoff are preserved. Frontend / asset / CI changes only.

## Behavior

Boot retains all gameplay and animated objects, tilesets, player/enemy sheets and effects. Static decorations and built-in background themes load when a room, detailed Browse preview, editor placement or palette selection needs them. Blank transparent placeholders are replaced after loading, without changing sprite position, scale, collision, layer visibility or dormant-room state. A pending request is shared across scenes; its loader continues while the originating scene sleeps. Errors and shutdown release listeners and permit retries; requests cannot enter a stopped loader.

Browse cache signatures include art residency, so a preview drawn before its images arrive is rebuilt. Editor neighbor previews await their required art and reject stale scene responses. Palette images use native lazy loading. Animated palette rendering moved into its own helper; the oversized palette file ratchet is lowered to 1,590 nonblank lines.

All 221 Devkidd trees are packed into 11 trimmed family PNG atlases (plus 11 JSON metadata files), loaded by family. Original source PNGs remain for authored metadata/image rendering and DOM thumbnails. Atlas frame offsets retain every original visible pixel and the same anchors. Generated URLs carry a content hash, preserving the existing immutable cache contract. `assets:trees:build` regenerates them; `assets:trees:check` verifies them locally and in CI.

## Evidence

- Full `npm run check`: 461 files / 3,502 tests, lint, TypeScript, DOM contract, generated types, production build, PNG and atlas checks. Startup JavaScript is 639.9 KB brotli, under 670 KB.
- Twelve production-build phone/tablet scenarios pass; zero fixture misses. Preview-server proxy diagnostics did not affect the browser fixtures or assertions.
- Native desktop and phone Chromium with Metal: all 11 tree families and an ordinary static decoration draw at their original dimensions; delayed loads replace placeholders; rapid background switches do not restore stale themes; a cached Browse preview changes its texture after art arrives; editor → Test preserves the art and real movement/jumping. Zero page exceptions and missing-art warnings. Screenshots inspected.
- Atlas regression reconstructs all 221 original canvases and checks every visible RGBA pixel. The complete family atlas set is 801,147 PNG bytes / 13,180,668 decoded bytes (original tree canvases: 39,010,560 decoded bytes).
- Regression tests cover shared family/background requests, a sleeping source scene, failure/retry, stopped loaders, destroyed sprites and reset previews. The unchanged official game client also reaches Canvas gameplay; its screenshot is inspected. Its two unsupported safety-API HTTP warnings match the earlier baseline. A longer official action burst was stopped after slow RAF progress; the completed shorter run and native real-time flows provide the browser evidence.

Three fresh phone-size Chromium contexts per revision compare unchanged `57a19656` and the candidate production builds, served with brotli, cache disabled, 5 Mbps / 100 ms network emulation and identical recorded API responses. The app-ready timestamp comes from a MutationObserver; PNG counts include all requests started by that timestamp (resource buffer raised to 2,000 entries). These are controlled browser measurements, not a physical-phone benchmark. Timings include local server/runtime work and some concurrent validation load; image counts and sizes are identical across all three runs.

| Build | Startup PNGs | PNG bytes | Decoded RGBA bytes | Median app-ready |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 488 | 1,538,580 | 109,342,200 | 18,775 ms |
| Candidate | 183 | 306,863 | 34,923,004 | 11,531 ms |

This removes 305 startup PNG requests (62.5%), 80.1% of their bytes and 68.1% of their decoded pixel footprint. No tree family or background theme PNG starts before app-ready in this arrival flow. Room-required art starts as the room hydrates. The older ~60-request aspiration is not reached: retaining 111 gameplay/animated objects and all 25 tilesets keeps this change compatible with the existing synchronous physics/tilemap paths. Lazy gameplay sheets/tilesets, asset eviction, audio compression and F021 caching remain separate follow-ups.

Evidence: `/tmp/wamp-art-2026-10-13/`. No API Worker, PartyKit, map renderer or production data changes.

## Delivery

Candidate validated; PR/Pages production verification pending.
