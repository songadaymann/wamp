# Restart traps Space — 2026-10-13

Jonathan reports clicking Restart then jumping repeatedly with Space during speedruns can make Space repeatedly restart instead. His screenshot shows Restart with its focus ring.

## Plan

- [x] Reproduce the exact repeated-click and jump sequence on current main.
- [x] Release transport-button focus before their gameplay action and synchronize game keys immediately.
- [x] Verify repeated native Space jumps, activation counts, Tab/Enter and room entry in Chromium/WebKit.
- [ ] Finish release checks and deliver the related follow-up under the existing deployment authorization.

## Root cause

The first mouse click focuses Restart without `:focus-visible`, so game keys still work. Pressing Space makes that same button `:focus-visible` without another focus event. Clicking Restart again retains that state; restart's app-mode synchronization now classifies the button as keyboard-focused and disables game input. Native Space then clicks Restart. Baseline log `output/web-game/restart-focus/baseline-repeat.log` has restart counts 2 → 3 → 4 → 5 on three Space presses and `keyboard:false` throughout.

The existing UI keyboard-passthrough setup now handles gameplay transport clicks in the capture phase. If the activated control has focus, it releases it before gameplay or a new modal begins, then synchronizes keyboard state. Controls remain normal Tab stops and native keyboard activation runs once. The explicit selector includes ordinary, Expanded and sequence Play/Stop/Restart/Next transports, plus their mobile counterparts. Comments, sharing, dialogs, text fields and other menus retain their existing focus behavior. This is independent of the earlier paused-scene restoration fix.

## Validation evidence

The reusable `smoke:room-entry-keyboard` regression now covers three restart/jump cycles within each of six room-entry cases, checks native Space jump displacement, and asserts Space never adds restart clicks. The middle restart uses real Tab/Enter; the surrounding restarts use mouse clicks. Chromium and WebKit are supported using `ROOM_ENTRY_BROWSER=webkit`.

Initial mouse-only passes: 18 restart cycles per browser, six entries each, zero page exceptions. Final Tab/Enter results and release details follow below.

Final native browser runs pass in both engines: six entries and 18 restart/jump cycles each, including six keyboard activations (Tab/Enter in Chromium, Option-Tab/Enter with Safari's default button-navigation setting). Zero accidental Space restart clicks and zero page exceptions. Gameplay screenshots inspected.

`npm run check` passes all 457 files / 3,482 tests, lint, TypeScript, DOM contract, generated bindings, production build, startup budget (637.6 KB brotli) and lossless PNG check. The final browser-test navigation adjustment also passes targeted lint and diff checks.

The standard web-game client ran; its intro click occurred before the room had hydrated, and the final screenshot shows gameplay under the automatic performance prompt. This capture is inconclusive for transport focus; the readiness-aware native regression provides the movement/jump evidence.
