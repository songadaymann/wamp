# F019 — more dialogs on demand and stable room data

Seven more controllers now download on first use: About, Controls, Guestbook, Playlist, Sign text, Wamp-O-Gram and Run rating. Together with Profile, Leaderboard, Explore and History, eleven menu controllers stay out of startup. The builder UI remains deferred with its scenes. Startup JavaScript falls from 650.8 to 641.0 KB brotli (15 files; existing 670 KB limit retained).

The first-use bridge preserves button and event arguments, shared-playlist autoplay and every queued post-run prompt. Guest save acknowledgements arriving during the download are restored before the prompts. Closing or switching away cancels a pending open; subsequent opens reuse one initialized controller. A failed rating download retains its waiting requests for a later retry. The rating bridge is destroyed with the game.

Room catalogs, room normalization and autotiling model/registry now form a self-contained `room-data` chunk: 43.1 KB brotli, no other runtime chunk imports and no UI/scene modules. A real guestbook-copy variant changed the guestbook chunk while the room-data URL and SHA-256 stayed identical; the exact original source/build were restored. New build-graph checks enforce the eleven deferred controllers and the stable-data boundary in the existing startup gate.

## Validation

- Full quality: 477 files / 3,553 tests; lint, TypeScript, 1,024 DOM IDs / 242 required IDs, generated bindings, production build and asset checks pass.
- All thirteen phone/tablet CI scenarios pass with the 66-response read-only fixture and no misses or browser errors.
- Native desktop Chrome, phone Chrome and phone WebKit: cold boot excludes all seven new chunks; each loads exactly once; repeated Controls/Guestbook opens work; a held About download stays closed after switching to Settings; first sign/playlist event data survives; two results remain queued during Play and display in order afterward; an in-flight guest acknowledgement changes the claim to verified. Postcard rendering opens through the existing action used after first publish. No production writes or multiplayer joins.
- Shared-playlist cold start: desktop Chrome and phone WebKit enter the playlist introduction automatically, with Welcome hidden and zero errors/missing fixtures.
- Screenshots of queued phone results and rendered desktop postcard inspected. Guarded production delivery and installed-client gameplay proof pass (details below).

Proof: `/tmp/wamp-f019-2026-10-13/` (`browser.json`, `share-link.json`, `cache-proof.json`, screenshots and build graph). Supporting logs `/tmp/wamp-f019-{check,mobile,native}-2026-10-13.log`. Probe sources stay in ignored `output/f019-lazy-2026-10-13/`.

## Remaining scope

F019 remains partial: moderation, Room Rush and its result dialog, first-publish and guest claim/recovery controllers remain eager. First-visit, room/playlist introductions, Comfort settings and core HUD/reward services remain immediately available. The master count stays 138/215 until the remaining rare-controller scope is completed; this delivery is a measured slice, not a full F019 completion.

## Production delivery

PR [#195](https://github.com/songadaymann/wamp/pull/195), source `c7211e5f`, merge `189a2153`, Pages [`c9e761fb`](https://c9e761fb.wampland.pages.dev). All four source checks and all three reported merge checks pass. The clean literal-main release checkout matches origin/main and passes the complete 3,553-test gates. Guarded Pages-only delivery, health, production smoke and the unchanged renderer contract pass. The clean release measures 641.1 KB startup brotli.

All 15 startup files and seven new menu files (22 total) match the local release SHA-256 on both `wamp.land` and the immutable host. Live Chrome desktop/phone and WebKit phone open About, Controls and Guestbook twice, each downloading its menu chunk once; the private game object stays absent. No application exceptions. The installed client completes the published Welcome room with a verified guest clear and zero runtime errors; screenshot inspected. Its software renderer displays the existing performance suggestion, so this is gameplay proof rather than an FPS claim.

**WebKit limitation:** Guestbook's Cloudflare challenge produces cross-origin frame errors in headless WebKit. The identical message and challenge-only stacks reproduce with the prior `b1e7c86d` release served under the same custom-domain origin (three errors), and the current release (three errors). The final menu pass records two matching widget errors separately and zero application errors. Local WebKit's isolated API fixture passes every new menu behavior with zero exceptions. A real iOS Guestbook challenge check remains a follow-up; no challenge/account configuration was changed. Evidence `turnstile-baseline.json`, `live-browser.json`, `release-proof.json` and `official-client/`.
