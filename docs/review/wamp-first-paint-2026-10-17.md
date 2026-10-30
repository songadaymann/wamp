# F025: first-paint assets

Base: `0d31e476` (delivered F091). Canonical branch:
`codex/wamp-first-paint-2026-10-17`. This is a frontend-only change.

## Result

- The render-blocking game stylesheet is 291,969 bytes, down from 434,020
  (32.7% smaller). Brotli is 32,877 bytes, down from 46,475 (29.3% smaller).
- The four display fonts total 46,240 bytes as WOFF2, down from 372,844 bytes
  as TTF (87.6% smaller). All 2,784 glyph outlines, advance widths and character
  mappings match the originals. No character subset or visual redesign.
- Five rare menu roots (Leaderboard, Explore, Profile, avatar picker and room
  history) remain in inert templates until their existing lazy controller opens.
  Initial live markup has 183 fewer elements (2,572 to 2,389).
- Editor and Expanded Room styles download once on the first builder action.
  A small always-loaded rule set keeps inactive builder controls hidden. The
  sheet is inserted before shared styles so phone and menu overrides retain
  precedence; opening either editor waits for the sheet. Failed or stalled
  downloads are removed and can be retried, with a 20-second timeout.
- Only the splash title font is preloaded. Original TTFs remain available to
  screenshot/export consumers; other pages retain their existing font paths.

## Verification

The 42 settled desktop, phone, narrow-phone and WebKit views compare 111,481
computed style values with the delivered baseline, with zero differences.
This includes ordinary editor menus/Test and Expanded Room editor/setup.
Full-font outline and metric comparison also passes. Screenshots were inspected.

Both engines open deferred Explore/Profile/avatar/history destinations, reopen
history without duplicating its tree, and verify the first screen requests no
editor sheet or original TTF. The production build passes these same probes.
The installed web-game client completes two movement/jump iterations with
inspected screenshots/text and no application errors.

The existing phone/narrow navigation CI cases now assert inert menus before
opening, compressed fonts and exactly one ready editor sheet after opening.
Those two cases use the normal application path (`previewSmoke=0`), because
preview hooks deliberately register editor scenes at startup. Other diagnostic
scenarios keep their hooks. The full matrix remains 64 cases across two engines.

Local full quality passes: 528 files, 3,864 tests, style/lint/type/DOM contracts,
production build, asset checks and 640.2 KB brotli boot JavaScript (670 KB budget).
The four production phone navigation cases pass with zero console/page errors
and fixture misses. A production Chrome outage/retry probe verifies the actual
recoverable stylesheet error and successful second editor request. The three
loader units cover shared readiness, download failure and timeout recovery.
The public-source scan has zero blockers/warnings. Exact-source/main hosted
gates and guarded delivery follow; final evidence will be in the PR receipt.

## Diagnostics and boundaries

The first split exposed unstyled inactive builder controls in Browse; the
always-loaded hiding rules fixed that. The first lazy markup implementation
added a microtask before starting all menu downloads; two existing guest-prompt
ordering tests caught this, and the original synchronous download start was
restored. The font/style comparisons initially differed only because a brief
status toast expired at different times; fresh settled captures are retained.

A synthetic history fixture now supplies its read-only versions response and
waits for the History button to enable. API fixture misses remain fatal. The
local dev-only mobile run reports Vite HMR socket errors because its fixtures
refuse sockets; production-build verification has no HMR client. No application
error filter was added.

No API/schema, room data, rankings, render assets or input behavior changed.
Primary dirty work, the selected background animation, the closed overnight
run and all decision-gated items remain untouched. Diagnostics are ignored
under `output/f025-2026-10-17/`.
