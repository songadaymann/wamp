# F019 — remaining dialogs after startup

Authorized checklist continuation after F095, based on main `4895555f`. The primary checkout's unfinished authentication/editor work and pending product/security decisions remain untouched.

## Plan and behavior

1. Complete the remaining rare controller boundary: moderation, Room Rush/results, first-publish, guest builder prompts and guest clear/draft recovery.
2. Preserve synchronous Publish-name acknowledgement, original request data, cancellation, account/scene guards, retries and teardown. Preserve automatic guest recovery rather than making it depend on a menu click.
3. Validate the actual browser flows, unit/quality/build gates, phone CI and hosted checks. Deliver frontend-only through the guarded clean-main path, verify custom/immutable assets and affected live interactions, then record completion.

Five remaining dialogs load on first request. The two guest recovery controllers load after app readiness (200 ms scheduling delay), or immediately for an explicit history action; their existing sync/presentation/retry services then run normally. Startup and core HUD/reward/intro controllers remain available immediately. Recovery code is deferred, not removed from the later session download.

A small first-publish proxy consumes a synchronous name event while the chunk downloads, retaining its resolver. Replacing, closing, changing accounts/scenes, failed downloads and destruction resolve held names with cancellation; only the latest valid prompt opens. The initialized controller owns subsequent events. Moderation-button permissions update without downloading its dialog. Pending menus cancel on real scene transitions; a repeated same-mode readiness notification does not cancel them. Guest prompt permissions are checked again after download.

The build-graph boundary now enforces eighteen deferred controllers (was eleven). Existing stable room-data chunk constraints and the 670 KB budget remain.

## Validation

Native desktop Chrome, phone Chrome and phone WebKit pass all seven flows with zero page exceptions and zero missing fixture responses. Each controller downloads once; all seven remain outside the cold readiness interval. Automatic recovery modules request 209–406 ms after readiness. A saved guest draft reappears after a wake, without an explicit history action. Held publication cancels on transition, then accepts and resolves the retried title; the published-room view retains its title and link. Phone result/publication/recovery screenshots were inspected.

Focused lifecycle and existing publication/guest-recovery tests passed. Native desktop Chrome, phone Chrome and phone WebKit probes use isolated API responses and refuse multiplayer sockets; no publication, chat, account or database writes reach production. First probe attempts exposed a same-mode pending-cancellation edge (fixed and pinned) and probe-only resource-timing-buffer/delay assumptions (corrected). Full quality passes: 492 files / 3,617 tests, lint, TypeScript, DOM contracts, generated bindings, build, bundle and PNG/tree/audio checks. Startup 630.8 KB brotli (was 642.8 KB); eighteen deferred controllers and independent stable data pass the graph check. All thirteen phone/tablet CI scenarios pass, with zero console/page errors, 414 fixture responses and no misses. Installed-client playback passes on a production preview with an explicit remote API base. WebGL and Canvas both reach play in room `1,-1`, collision ready, healthy graphics, and no captured errors; screenshots were inspected. The software renderer shows the existing performance suggestion, so this proves loading rather than FPS. Actual live input proof passes below. F019 remains unticked until delivery verification.

The first complete test pass (3,615 tests, before two added mode tests) was followed by a test-fixture type correction. A subsequent overlapped quality run hit three existing PNG-rendering test timeouts; all twelve renderer tests pass in isolation. The complete final gate then passes without owned browser/scan probes, with no test timeout changes. The development-server installed-client attempt was stopped after it produced no state artifact; subsequent production-build WebGL and Canvas playback both completed successfully. These attempts are not reported as successful release gates.

## Hosted preview and delivery

PR [#200](https://github.com/songadaymann/wamp/pull/200), source `8b1db184`, merged main `77bbd0d6`. All four source checks pass. Six hosted-preview cases (guest/owner API fixtures on desktop Chrome, phone Chrome and phone WebKit) pass first-use/reuse, delayed publish cancellation and title resolution, publication view and moderation with zero app exceptions or fixture misses. API fixtures refuse all sockets and intercept writes.

Headless WebKit reports `/cloudflareinsights.com/cdn-cgi/rum due to access control checks` on both the previous `10049caa` and candidate `92143769` immutable Pages hosts, each with one analytics beacon. With the external beacon stubbed, all six hosted-preview menu cases pass. No analytics/account configuration changed. Actual custom-domain menu tests also pass without the beacon stub.

Clean literal-main Pages-only guarded delivery from `77bbd0d6`, matching origin/main, completes with exit 0. The full 3,617-test gates, eighteen-controller graph, asset checks, production health/smoke and unchanged renderer contract pass. All four reported source and merged-main hosted checks are green. The clean release measures **630.7 KB brotli** across fifteen startup files (previous release 642.8 KB).

Pages [`307dcdd0`](https://307dcdd0.wampland.pages.dev) is live. Thirty-three boot/menu files match the local release SHA-256 on both `wamp.land` and the immutable deployment; both HTML entries reference the current bootstrap. Six custom-domain guest/owner fixture cases pass all affected menus with zero exceptions/missing responses and single-download reuse, without stubbing analytics. These signed UI cases use intercepted APIs, not real account writes.

Actual production room `1,-1` gameplay passes on native desktop Chrome, phone Chrome and phone WebKit: jump displacement −24 / −30 / −17 px, including a real CDP touch hold on phone Chrome; deaths stay unchanged, private game object is absent and page errors are empty. Screenshots inspected. No FPS or real-device Safari claim.

F019 is complete; master **143/215**. Owned QA processes are stopped, and the primary auth lane, selected animation/comparison server and pending decisions are preserved.

Proofs: `/tmp/wamp-f019-remaining-2026-10-14/` (`browser.json`, `preview-menus.json`, `analytics-baseline.json`, `live-menus.json`, `release-proof.json`, `live-gameplay/live-browser.json`, installed-client state/screenshots). Probe sources stay in ignored `output/f019-remaining-2026-10-14/`; build/gate logs are `/tmp/wamp-f019-remaining-{check-isolated,mobile,release}.log`.
