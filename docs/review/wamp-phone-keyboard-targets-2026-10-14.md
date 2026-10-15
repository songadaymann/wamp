# F089 automated input coverage and F109 phone controls

Overnight window: October 14 evening through October 15 5am New York. Baseline main `fdb0b142`, master 143/215. Source branch: `codex/wamp-mobile-checks-2026-10-14`. Primary unfinished auth/editor work remains isolated.

## Change

The mobile suite expands from thirteen Chromium scenarios to twenty-one scenarios in both Chromium and desktop WebKit (Canvas for WebKit). CI installs both engines. The existing read-only fixture now has 67 responses, including one new anonymous published-room GET; missing responses fail the smoke. Synthetic signed sessions enable World Chat and room Say typing with refused sockets and no sends.

Keyboard cases shrink only visualViewport, type actual keys, verify portrait orientation, 16px field text, retained text, foreground field visibility and viewport restoration. The game canvas remains stable while the keyboard occludes it. Button audits cover Browse, expanded room details, menu top/bottom, Settings, Chat, Play and each editor library. Recording notices are checked in portrait, 844×390 landscape and 568×320 landscape. The landscape room intro must scroll to Start and accept a real tap.

Phone controls have actual 44px targets; HUD/footer text uses existing 8px pixel type. The default HUD retains its 150px ceiling through a single primary-action row; expanded details use four columns. The creator hit region extends upward without painting over the title. Landscape Play hides the footer while Settings/Chat remain accessible through the existing menu. Stop/Restart remain clear of Room + and fit the portrait console header. The landscape recording notice fits between the whole movement region and action buttons. The room-intro panel scrolls when its actions extend below the screen.

Keyboard occlusion positions chat above the keyboard and scrolls an occluded field within its existing container. Pinch zoom and ordinary resizing do not create keyboard insets. Open World Chat and focused room Say anchor to the viewport, avoiding clipping by their game-canvas parent.

## Local verification

- Full final quality: 493 files / 3,620 tests, lint, typecheck, DOM contract, generated binding check, build, 631.1 KB boot budget and PNG/tree/audio asset checks pass.
- Forty-two mobile cases pass with zero console/page errors and zero missing fixtures. Chromium/WebKit keyboard, landscape Start, HUD and notice screenshots were inspected.
- Native Chrome/Metal portrait and landscape plus desktop WebKit portrait production-build menus, typing/return and actual touch jumps pass. Measured jumps lift the player 12, 12 and 9 pixels; zero page exceptions/missing fixtures. Native screenshots were inspected. This does not measure FPS or prove physical iOS behavior.
- Eight focused device/inset tests, script syntax checks and OSS scan pass (zero blockers/warnings).
- Installed-client Canvas playback loads the production build, reports a ready Play scene/player and no browser errors; screenshot inspected. Its software renderer shows the existing performance suggestion, so this is not FPS proof. Native touch gameplay is verified separately. Hosted source/merge checks and clean-main Pages/live proof pass; see final delivery evidence below.

Audits caught and fixed a tall default HUD, overlapping run controls, narrow expanded buttons, occluded email, an opaque creator hit region, a clipped World Chat panel, a collapsed canvas during keyboard occlusion, notice/control overlap and unreachable landscape Start. Existing layout tolerances were retained. Camera checks wait for the same framing criteria, and WebKit's computed non-selection property is read through its supported prefix. The first full quality attempt exposed an outdated test DOM fixture, now supplying HTMLElement/focus listeners; the final complete run passes.

## Delivery and remaining work

F109 is complete; master is 144/215. F089 remains partial: physical iOS keyboard, toolbar/safe-area and audio behavior need a real device. Desktop WebKit proves engine compatibility and simulated layout only.

Evidence: ignored `output/f089-mobile-2026-10-14/`, `output/web-game/mobile-smoke-ci/{chromium,webkit}/`, and `/tmp/wamp-f089-*.log`.

PR #201 source `83d4a99f` passed all four hosted checks (quality, forty-two mobile cases and both Cloudflare builds) and merged as `a0cab3e4`. Hosted Chrome portrait/landscape and WebKit portrait menu/input/touch flows pass with an isolated analytics request. The immutable-host WebKit analytics access-control error was reproduced on both preceding Pages `307dcdd0` and candidate `ba9061ee`; actual custom-domain verification will run without that isolation. Clean-main guarded Pages-only delivery and merged-main hosted checks subsequently pass, as recorded below.

## Final delivery evidence

PR #201 / source `83d4a99f1a7a67b7202795660d21dba1e4a8e183` / main `a0cab3e446b180ec6fac06deb759baa3da52be18`. All four source checks and all four merged-main checks pass. Both guarded Pages-only runs use clean literal main equal to origin/main and pass full quality, live smoke, API health and renderer-contract checks. Worker, PartyKit, D1 and renderer delivery were not required.

The first Pages deployment (`7404c639`) was overtaken by the automatic merged-main build, observed through a changed live entry and mismatched old dialog path. After all hosted checks finished, final guarded Pages `2b4402d4` was published. An immediate immutable asset request returned a propagation 404; the subsequent proof passes: **34 boot/menu/CSS files exactly match local release bytes on both wamp.land and the immutable deployment**, and both HTML pages name the current entry.

Final actual custom-domain Chrome portrait/landscape and WebKit portrait synthetic-session menu/typing/touch flows pass with **no analytics stub**, zero page errors/missing fixtures and 12px jumps in each case. A separate actual guest run uses **no API fixtures or analytics stub**: real backend loading, Settings/Chat, keyboard email return and 12px touch jump pass with zero errors. Final screenshots were inspected. A 320×568 check has no overflow, a 134px HUD and 40.8×44 primary targets. Physical iOS checks remain manual, and no FPS claim is made.
