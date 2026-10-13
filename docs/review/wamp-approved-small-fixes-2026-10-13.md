# Smaller approved checkup fixes — 2026-10-13

Jonathan approved the smaller items in the October 13 handoff. The work is isolated from his uncommitted email-code work.

| Items | PR | Merge | Delivery |
|---|---|---|---|
| F174, F117, F120, F056, F098, F119 | Pending | Pending | Frontend only; Pages delivery pending |
| F118, F061 | Same PR | Pending | Recorded as won't do; remain unticked |

## What changed

- **F174:** the existing signature red keeps its color; controls, badges and error banners use #18161c ink instead of white/cream. This includes Build, active Play, Publish, Mint, editor dangers, phone Stop/Restart and the chat badge. Ink on #ed5f4b has 5.42:1 contrast.
- **F117:** Mario and Game Boy titles/labels use multiples of eight pixels, including phone overrides, adaptive room titles and the canvas Build/Warp labels. Their spacing is whole pixels where explicitly declared, and the browser does not synthesize bold. HomeVideo's 11–12px body sizes remain the documented readability compromise; camera scaling can still land canvas glyphs between physical pixels.
- **F120:** IBM Plex Mono 400/500/600 Latin WOFF2 files (45,216 bytes total) are served locally. The Google stylesheet/preconnects are removed. Fontsource 5.3.0 supplied the font files; the OFL license is shipped beside them. Pixel-font preloads remain omitted because earlier measurements found they slowed first paint.
- **F056:** Back/Escape saves only a private draft, including a recent edit, leaving test play and retrying a failed autosave. It waits for a save already in progress. If a save fails, or edits arrive during the exit save, the editor stays open with the explanation and latest edits retained. Publishing remains an explicit action.
- **F098:** portrait phones shade the view outside a fixed-camera room. The whole room still fits and stays centered above the console; the shading goes away in landscape, follow-camera rooms and Browse. The translucent shade is functional dimming, as explicitly approved.
- **F119:** a shared error helper replaces transport/parse details with plain wording, preserves useful server explanations, and adds actual Try again buttons to profile/explorer/playlist/leaderboard load errors. Empty profile Levels offer Find a spot to build; empty Playlists offer Create a playlist and focus the existing title field. Actions honor existing edit and school-avatar restrictions.
- **F118/F061:** no room-name banner and no public AGENTS.md. Both stay unticked with the declined decisions recorded.

## Evidence

- Full quality gate passed: 459 test files / 3,495 tests, lint, TypeScript, DOM contract, generated types, build, PNG check and startup budget (638.2 KB brotli; limit 670 KB).
- Twelve production-build phone/tablet scenarios: pending final completion.
- Native desktop and iPhone-size browser checks: profile error retry succeeds; empty actions navigate/focus correctly; visitors get no owner actions; local font weights load; no requests go to Google Fonts; the player moves while the fixed camera stays still; portrait shading clears in landscape and Browse. Screenshots were inspected.
- The pixel-font audit checks all current DOM nodes, including hidden dialogs; desktop and phone editor text is on an eight-pixel size grid.
- The unchanged official game client reaches live read-only safety-API gameplay and its screenshot was inspected. Its two HTTP warnings are the safety API's unsupported endpoints; targeted native checks have no page errors.
- Earlier phone-camera smoke expects an obsolete Background sheet. Current editor behavior is covered by the mobile suite and native probe. Running the mobile fixture against Vite development mode also refuses the development socket; production-build fixture checks avoid that development-only warning.
- Evidence stays outside the public repository at `/tmp/wamp-small-fixes-2026-10-13/`. No production database writes, API Worker changes, or PartyKit deployment.

## Delivery

Pending PR, CI, automatic Pages deployment and custom-domain verification.
