# F113 — Shared WAMP UI values

Source base: `ed1965fde7c1f4e1486c731cee0a48e3d755ff75` (delivered F114/PR231). Canonical branch: `codex/wamp-shared-palette-2026-10-17`.

## Result

`src/styles/tokens.css` loads first. It owns the core retro palette, RGB channels, six exact font stacks, four hard shadows and the existing legacy root theme. Ordinary rooms, Expanded Rooms, account dialogs, HUDs and phone styles consume those shared values. Existing scoped aliases remain, pointing to the shared palette, so their public names and overrides continue to work.

The migration replaces 1,306 core hex occurrences, 124 RGB color occurrences, 266 exact font stacks and 153 hard shadows. It preserves the previous colors, fallbacks, transparency, geometry, type sizes, layering, selectors and state behavior. Specialty colors, encoded artwork and different fallback stacks stay with their owning surfaces. This is a maintainability change; it does not redesign the interface. Spacing and z-index cleanup remain outside F113.

`npm run styles:check` rejects repeated shared hex/RGB values, font stacks and redefinitions of shared tokens; it also requires the token import first. The check runs in `npm run check` and hosted quality. The checker is included in ESLint and the explicit Knip executable registry. No dependency was added.

## Verification

- Full quality: 522 files / 3,834 tests, typecheck, lint, DOM contract, generated bindings, production build and all asset checks pass. Startup JavaScript: 637.9 KB brotli / 670 KB budget.
- Frozen baseline: every selector, at-rule and all 10,868 expanded declarations across 71 stylesheets match the source base. All 31 moved root declarations retain their exact expanded values.
- Nine guard probes exercise rejection of repeated hex, RGB, modern RGB, font-family and font shorthand, plus token redefinitions; legitimate aliases, specialty values, comments and URL/string content pass.
- Native Chrome desktop, 390px/320px phones and desktop WebKit phone layouts exercise Browse, Play, account/profile, settings, controls and editor Test/return. Expanded Room editor/setup passes wide desktop, phone and narrow WebKit. Independent unchanged-base pages use the same fixture responses and interactions. All 42 settled browser states / 111,412 computed-style comparisons match exactly, with zero application errors or fixture misses. Three ordinary production-build profiles (desktop, phone and desktop WebKit phone) also pass. Reports are retained in ignored evidence.
- Two installed develop-web-game movement/jump iterations pass with inspected screenshots and text state, without application errors.

Diagnostics are in ignored `output/f113-2026-10-17/`. Early diagnostic attempts that swapped stylesheets inside one page invalidated loaded font faces and serialized shorthand values differently; those results were discarded in favor of independent pages. Initial cross-page sampling caught the existing 200ms hamburger transition; final sampling waits for it. The first full quality run correctly requested the new checker in Knip's entry registry; the corrected full run passes. The first development client run blocked Vite's development socket through the fixture harness; the corrected client explicitly passes that socket through and finishes without errors.

## Delivery boundary

Source acceptance is complete; exact-source and merged-main hosted gates, public-source scan, merge, guarded Pages-only release and custom-domain/immutable asset proof follow. Their final receipt and pull-request description supersede this source-time pending note.

No API Worker, D1 migration, PartyKit, room data, world renderer, money flow, selected animation or decision-gated work changes. No publishing, account linking or destructive action is submitted by the browser checks. The dirty primary checkout remains untouched. Physical iOS behavior remains a separate manual F089 follow-up. The overnight goal stays closed and its cutoff heartbeat stays paused.
