# F019 — remaining dialogs after startup

Authorized checklist continuation after F095, based on main `4895555f`. The primary checkout's unfinished authentication/editor work and pending product/security decisions remain untouched.

## Plan and behavior

1. Complete the remaining rare controller boundary: moderation, Room Rush/results, first-publish, guest builder prompts and guest clear/draft recovery.
2. Preserve synchronous Publish-name acknowledgement, original request data, cancellation, account/scene guards, retries and teardown. Preserve automatic guest recovery rather than making it depend on a menu click.
3. Validate the actual browser flows, unit/quality/build gates, phone CI and hosted checks. Deliver frontend-only through the guarded clean-main path, verify custom/immutable assets and affected live interactions, then record completion.

Five remaining dialogs load on first request. The two guest recovery controllers load after app readiness (200 ms scheduling delay), or immediately for an explicit history action; their existing sync/presentation/retry services then run normally. Startup and core HUD/reward/intro controllers remain available immediately. Recovery code is deferred, not removed from the later session download.

A small first-publish proxy consumes a synchronous name event while the chunk downloads, retaining its resolver. Replacing, closing, changing accounts/scenes, failed downloads and destruction resolve held names with cancellation; only the latest valid prompt opens. The initialized controller owns subsequent events. Moderation-button permissions update without downloading its dialog. Pending menus cancel on real scene transitions; a repeated same-mode readiness notification does not cancel them. Guest prompt permissions are checked again after download.

The build-graph boundary now enforces eighteen deferred controllers (was eleven). Existing stable room-data chunk constraints and the 670 KB budget remain.

## Validation in progress

Native desktop Chrome, phone Chrome and phone WebKit pass all seven flows with zero page exceptions and zero missing fixture responses. Each controller downloads once; all seven remain outside the cold readiness interval. Automatic recovery modules request 209–406 ms after readiness. A saved guest draft reappears after a wake, without an explicit history action. Held publication cancels on transition, then accepts and resolves the retried title; the published-room view retains its title and link. Phone result/publication/recovery screenshots were inspected.

Focused lifecycle and existing publication/guest-recovery tests passed. Native desktop Chrome, phone Chrome and phone WebKit probes use isolated API responses and refuse multiplayer sockets; no publication, chat, account or database writes reach production. First probe attempts exposed a same-mode pending-cancellation edge (fixed and pinned) and probe-only resource-timing-buffer/delay assumptions (corrected). Full quality passes: 492 files / 3,617 tests, lint, TypeScript, DOM contracts, generated bindings, build, bundle and PNG/tree/audio checks. Startup 630.8 KB brotli (was 642.8 KB); eighteen deferred controllers and independent stable data pass the graph check. All thirteen phone/tablet CI scenarios pass, with zero console/page errors, 414 fixture responses and no misses. Installed-client playback and release proof remain pending. F019 remains unticked until delivery verification.

The first complete test pass (3,615 tests, before two added mode tests) was followed by a test-fixture type correction. A subsequent overlapped quality run hit three existing PNG-rendering test timeouts; all twelve renderer tests pass in isolation. The complete final gate then passes without owned browser/scan probes, with no test timeout changes. The installed virtual-time client stalled during development-module loading and was stopped; production-build playback remains to be checked. These attempts are not reported as successful release gates.
