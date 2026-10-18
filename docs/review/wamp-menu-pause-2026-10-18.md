# F170 — Solo menu pause

Branch: `codex/wamp-pause-2026-10-18`, based on delivered PR244/main `f89160a8`.

## Behavior

Opening the game menu or a blocking dialog pauses solo room, Expanded Room and regular Room Rush simulation. The player, enemies, hazards, projectiles, scene timers, objective timer and verification recorder stop together. Backgrounding a solo tab also requests a pause. Closing the final blocking surface resumes play; an intro or performance suggestion can continue holding its own pause.

PvP, shared pressure-plate rooms and the five-minute weekly Room Rush stay live. The menu says “Multiplayer keeps running” or “Weekly Rush keeps running.” Report a Bug follows the same policy and cannot release another dialog's pause.

Signed-in room and Expanded Room leaderboard results retain the existing server wall-time floor. Their menu says “Paused. Ranking time includes breaks.” Goal timers and replay traces retain simulation time, so opening a menu cannot grant free Survival/protection progress or introduce a replay breadcrumb gap. Regular Room Rush retains its existing simulation-time policy; the weekly event keeps wall time and cannot pause. Guest progress retains its existing verified simulation-time policy and never enters ranked tables.

## Implementation

- A small UI collaborator observes menu/dialog visibility, lazily inserted dialogs and pending dialog downloads. The lazy-dialog loader retains pause ownership until the dialog appears, releases canceled/failed loads, and transfers ownership before asynchronous data work so Close cannot leave an invisible pause. A game-level callback reevaluates mode changes even while the scene is paused; there is no new timer, network request or polling interval.
- Pause application composes the existing intro and performance-suggestion owners. Paused scenes remain accessible to menu commands; sleeping scenes remain excluded.
- Phaser's `Clock.now` jumps over pauses. A separate gameplay clock advances only on scene frames, preserving attack, health, hazard and enemy deadlines across a break. Network and streaming clocks retain their existing owners.
- Local projectile presentation uses the same gameplay clock as its collision/lifetime owner; remote presentation keeps shared wall time. Real-time hitstop/death callbacks preserve their remaining delay across scene pauses and cancel on restart/teardown. Shutdown clears the feedback controller's pause flag before the scene is reused.
- The held-input predicate moves into the existing input helper. This preserves behavior and keeps the large scene within its existing line-count limit; that limit was not raised.
- Maintained six-case browser coverage runs in a separate `gameplay-pause` CI job. Linux WebKit uses the established Canvas fallback; local macOS WebKit coverage uses WebGL.

## Verification

Local source acceptance is complete; release is pending. Evidence is kept in ignored `output/f170-pause-2026-10-18/`.

- Full project quality check passes: styles, lint, tests, TypeScript, DOM contract, generated Cloudflare bindings, build, bundle budget, PNG/tree/audio checks. The final full test run passes **542 files / 3,993 tests**.
- A resumed trace with a simulated one-minute break passes the real server verifier; the unchanged ranking calculation retains the full server wall time.
- Six production-build scenarios pass: solo and cooperative rooms on desktop Chrome, phone Chrome and phone WebKit, with no application errors or missing API fixtures. They exercise intro/menu ownership, enemies/player/timer/cooldown freeze, deferred Controls, stacked dialogs, ignored gameplay input under dialogs, repeated resume, movement, Restart, Report a Bug and Stop.
- All nine existing Expanded Room leaderboard scenarios pass, including menu-to-board access during Play on both native and legacy rooms.
- The installed web-game client completes two movement/jump bursts on the final preview; player x advances 348 → 368, with no error files. Screenshots and text states are inspected.
- The CI entry point (`--skip-build --pause-only`) is exercised successfully. The full existing mobile regression suite passes 64 cases (32 Chromium, 32 WebKit), with zero console/page errors and missing fixtures. The final loader/projectile fixes additionally pass the six strengthened pause cases and all nine Expanded Room cases on the final preview. Hosted CI remains pending until a push.

No API, database, presence, ranking rule or map-renderer deployment is required. Release remains pending; no commit from this branch has been pushed, merged or deployed.

Accepted evidence: `complete-check.log`, `accepted-browser/report.json`, `accepted-expanded/report.json`, `mobile-proof.json`, `installed-accepted/`, and `preservation.json`. Earlier diagnostic attempts are retained separately. They include a synthetic stacked-dialog setup, absent neighbor fixtures, keyboard Restart while a menu button retained keyboard focus, a development reload/build-readiness race, and an installed-client intro-readiness race. The stronger projectile check caught and fixed both local wall-clock expiry and the deferred-dialog loading gap; phone WebKit now uses the actual touch Shoot control. A test-only TypeScript inference error was fixed before final acceptance.

## Authorized release

Jonathan authorized push, merge and deployment after local acceptance. Delivery proceeds through exact-source/main hosted quality, mobile, Expanded Room, pause and both Pages gates, followed by guarded Pages-only deployment from clean main and actual-domain verification. This supersedes the earlier local-only boundary. Final delivery details are recorded in the linked pull request and ignored release evidence.

Hosted runner follow-up: the first pause job checked a720ms projectile only after a slow automation round trip, allowing it to expire naturally after Close. The maintained check now captures the first resumed frame in the browser, asserts retained projectile/simulation time, and saves both elapsed values in its report. All six native cases pass; the gameplay implementation is unchanged. Fresh hosted gates are required on this observation fix.
