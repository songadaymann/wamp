# F148: standard gamepads and R restart

Jonathan asked for the next checklist item after F108. Branch `codex/wamp-gamepad-restart-2026-10-16` starts at main `461eb21d`. Covers merged F088 and F178.

## Behavior

- A connected standard-mapped gamepad supplies left stick/d-pad movement, directional press edges for ladders/crates, bottom face jump, left face slash, top face/right bumper shoot, Start restart, Select/Back stop and right-stick click camera. The Controls dialog describes physical positions to avoid conflicting controller labels.
- A small native Gamepad API sampler feeds the existing movement cadence and combat actions. Jump hold/release and stomp bounce use the same gameplay paths as keyboard/touch. No unused Phaser gamepad plugin is enabled. Mapping follows the [W3C standard gamepad layout](https://www.w3.org/TR/gamepad/).
- Stick drift is filtered; a diagonal running push does not accidentally trigger downward stomp. Held buttons emit one action. Reconnect, focus, dialogs, menu drawers, Play transitions and scene lifecycle changes require neutral input before actions resume. Shutdown removes all listeners. Unsupported/denied APIs leave keyboard and touch usable; debug state contains only connected/active booleans.
- R uses the existing HUD restart command, only in Play and outside typing/dialogs/menus/browser shortcuts. Repeated keydown and overlapping asynchronous restarts are guarded. Existing ordinary-room, Expanded Room, Room Rush and PvP dispatch remains intact; Expanded Room restart retains its existing busy/loading flow.
- Kept the established input/physics ownership: sampling runs before cadence captures movement, so gamepad edges enter existing ranked trace recording. No new network, API, D1, room-data, background, renderer, PartyKit, remapping or haptic changes.

## Verification

- Full suite: 520 files / 3,822 tests pass, including 19 gamepad sampling/lifecycle tests, 13 R shortcut tests and a keyboard/gamepad handoff test. Existing cadence and expanded-run lifecycle tests also pass.
- One earlier full run hit the unchanged world-streaming teardown frame-budget assertion; its isolated unchanged-main run passed. The final full suite passed with one worker and unchanged assertions. No unrelated timing behavior was modified.
- Native Chrome desktop/phone and desktop WebKit phone production-build audits each pass 15 cases: movement, jump/landing, slash/shoot edges, R and Start restart, typing/modal guards, held Start, disconnect/reconnect, camera policy, Select stop, browse R guard and held Select on Play reentry. No application errors or fixture misses. Screenshots inspected, including the readable Controls layout on phones.
- New `tablet-gamepad-controls` passes in both existing mobile smoke engines and is part of CI: 25 cases per engine, 50 total. Browser inputs override the standard Gamepad API and use normal app controls; they do not call scene internals. Writes/sockets are intercepted; no public messages or rooms are changed.
- Installed web-game client: two native Chrome movement/jump iterations pass; screenshots and text states inspected, no error files. Full quality (lint, tests, types, DOM, generated bindings, build and asset checks) passes. Boot JavaScript is637.4KB brotli against670KB budget. Public source scan passes without blockers/warnings. Hosted gates and final production proof follow.

Physical Xbox/PlayStation/Switch controllers and iOS Safari hardware have not been tested. These browser checks establish API integration and standard mapping, not device-specific Bluetooth/USB compatibility. Custom mappings are not supported in this scope. No claim of a real ranked-server submission is made by replay-fixture checks.

## Delivery

Frontend-only release. Source and merge hosted gates, guarded Pages-only production deployment, custom-domain/immutable asset proof and live input checks must all pass before delivery is reported complete. The final pull-request receipt supersedes this source-time delivery note. The primary dirty checkout and selected animated background are preserved; decision-gated work and the closed overnight goal stay untouched.

Hosted acceptance: initial49/50 mobile cases passed; new Chromium held-shoot check observed86.7ms of remaining game cooldown after its fixed700ms wall-clock sleep. Replaced that assumption with waiting for cooldown drain and asserting no reactivation over400ms more game time; all gameplay code is unchanged. Rerun exact local cases and all hosted gates on final test revision before merge.
