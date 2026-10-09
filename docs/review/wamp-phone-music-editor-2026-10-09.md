# F227 — Phone music editor

Original prompt: "ok let's do it", accepting the proposed phone music editor work: larger note targets, compact controls, and touch zoom/pan. F231 phrase audition and Arrange playhead remain separate.

## Plan

- [x] Verify current main and preserve partner changes, the dirty primary checkout and the existing remote API preview.
- [x] Add a shared touch sequencer for ordinary and Expanded room editors, using the existing pattern model and authoring operations.
- [x] Keep cells at least 44 CSS pixels, labels visible, all 32 steps reachable, and the grid clear of the phrase controls. Preserve the WAMP square controls and instrument colors.
- [x] Tap toggles a note; drag pans by default. Explicit Draw enables connected notes; Copy selects a region. A second finger, cancellation, blur or context change discards unfinished edits.
- [x] Verify portrait, landscape and coarse-pointer tablets, desktop behavior, pinch/pan, copying, Undo/Redo, preview and persisted ordinary/Expanded music.
- [x] Run project checks and the official game client, inspect screenshots and save a reviewable draft PR and local preview.
- [x] After Jonathan's acceptance, merge exact-source PR #102, deploy from clean main and verify the actual production domain.

## Design

Use a scrollable, labeled touch grid within the existing Music Editor. Keep instrument selection, transport and mode controls close to the grid. Put pitch, tempo, swing, mix and phrase tools behind Tools. The touch view is presentation and input only: it shares MIDI mapping, ties, clipboard, history, preview and saving with the canvas sequencer. Single taps commit on release; touch strokes are committed together only after release. Pinch and pan never write notes.

## Acceptance

Local candidate accepted. The touch sequencer uses 44–88px cells, pinned pitch/drum labels, previous/next step navigation, anchored pinch zoom and scroll panning. It shares the existing pattern controller's MIDI, ties and clipboard operations. Tap/pan is the default; Draw/Tie, Erase and Copy are explicit. A stroke is one history entry and one audition on release. Second/third fingers, pointer cancellation, capture loss, blur, visibility, resizing and changes of tool/instrument/context discard pending edits.

The full project check passes: 408 files / 3,239 tests, lint, TypeScript, generated bindings and production build. DOM contract checks 1,003 IDs / 242 required IDs; Worker safety passes. Native Chromium acceptance passes ten phone/tablet cases plus the unchanged mouse/canvas desktop sequencer and the local mouse touch-preview option, with zero page exceptions. Actual layouts (without manually changing the camera) pass at 390×844, 320×568, 844×390 and 768×1024, including reachable Tools/Grid controls and no horizontal document overflow. Cells stay at least 44px; measured pinch grows them to about 66px. Ordinary save/reload preserves exact music. Expanded save, Undo/Redo and neighboring-cell isolation pass. Real WebAudio playback, tempo/mix updates, Stop and the sequencer playhead pass. Screenshots of the grid, Tools, Arrange, each layout and both editor types were inspected.

Evidence: `/tmp/wamp-phone-music-2026-10-09/`. The initial Tools pointer-blocking and landscape overlap were fixed before final acceptance. Test helpers were corrected to account for pinned labels, canonical mix quantization, asynchronous saves and the separate local API; this does not change game behavior. Existing portrait Browse entry overlaps Room of the Day/profile controls, so persisted reload acceptance re-enters through the wide layout before returning to the phone grid. That entry issue remains separate from F227. These are browser-emulated touch checks, not physical phone hardware acceptance.

The unmodified official game client ran against the remote safety API. Its 404/405 responses reproduce on the preserved previous frontend against the same safety rooms; these runs are retained as diagnostics rather than claimed as clean gameplay acceptance. The isolated local fixture API has no presence signing key (503) and the synthetic legacy Expanded course lacks its expanded-version foreign-key row at run startup (500); neither endpoint is changed here. Music draft/phrase writes succeed on the isolated local API. Production and safety API data were not modified by the music tests.

Local review frontend: `http://127.0.0.1:3043/r/0/0?welcome=0&musicTouch=1`, connected to the same remote safety API as the preserved 3040 preview. The development-only `musicTouch=1` option lets a mouse user test the touch workspace via Room → Music. In production the touch workspace is selected by the phone/coarse-tablet layout.

Test data is confined to a copy of the local API state at `/tmp/wamp-phone-music-2026-10-09/local-state`. The original `3040` remote safety preview is preserved. The initial review boundary was local-only with the master at 68/215; Jonathan subsequently approved delivery with "ok push that". The release below supersedes that boundary.


## Production delivery — 2026-10-09

Jonathan accepted the local preview and authorized "ok push that". PR [#102](https://github.com/songadaymann/wamp/pull/102), source `23920bb62b791419662ef0f367ec9fefc6e68a42`, merged as `2215edb5cde574d235efbf07d0c69eac5d6668ef`. No intervening partner changes were present; the accepted source and merge trees are identical. Existing partner work and the overnight acceptance bookkeeping are retained.

Exact-source and exact-main hosted Quality and both Pages checks pass. Clean merged main passes all 408 files / 3,239 tests, lint, TypeScript, generated bindings, production build, the 1,003-ID / 242-required-ID DOM contract and Worker safety. The guarded `npm run deploy:prod -- --pages-only` checks clean literal main, exact origin/main and the active map catalog before publishing. Canonical Pages deployment is `a243c20a-6a78-41c1-b999-0b9da477d3b0`; immutable URL: https://a243c20a.wampland.pages.dev. Production smoke passes at https://wamp.land and https://api.wamp.land. No API Worker, D1, PartyKit, room-data or renderer delivery is part of this change; active map renderer/catalog remain `production-2026-10-09-overnight-843f81f7` / `authoring-catalog-v1:843f81f7cad2c688`, available at 100%.

All 184 JS/CSS files, four traversal PNGs and three death-audio formats match the release build, the actual custom domain and the immutable deployment byte for byte. Both HTML responses reference the same current entry/runtime assets and retain the same inline bootstrap. The published touch controls are present.

The actual published frontend passes five browser cases: portrait 390×844, landscape 844×390, coarse tablet 768×1024, touch pan/pinch with unchanged notes, and a separate mouse desktop with the development-only `musicTouch=1` flag ignored. Tools/Grid works; cells stay at least 44px, pinch enlarges them, controls fit and the document does not overflow. Screenshots were inspected. Zero page exceptions, zero real API failures and zero unexpected writes. Guest cloud draft/analytics background writes were intercepted to keep this production probe read-only; the app's POST snapshot queries are reads and were allowed. The first probe used a coarse-pointer context for its desktop assertion and blocked read-only POST queries; the corrected probe uses a separate mouse context and passes. This is browser emulation, without a physical phone claim. Ordinary/Expanded save/history/audio acceptance remains supported by the isolated local tests above.

Primary checkout still has its original 25 dirty entries and exact diff hash `38d3e60660bff00f7db98b65a7342c1945ef3a8b7820621b3e7b299c7d21839b`. Original 3040 remote-safety preview and API 8787 remain running; the accepted 3043 preview remains on source `23920bb6` and its existing branch. Release receipt is saved separately on `codex/checkup-phone-music-delivery-2026-10-09` so the deployed source stays traceable. F227 is complete; master **69/215**. F231 remains next. Physical phone acceptance, existing portrait Browse entry overlap and F229's actual native background-tab check remain separate follow-ups.

Evidence: `/tmp/wamp-phone-music-2026-10-09/` (`main-check.log`, `main-dom.log`, `main-worker-safety.log`, `main-hosted-checks.json`, `deploy.log`, `pages-current.json`, `live-assets.json`, `live-phone/report.json` and inspected captures).
