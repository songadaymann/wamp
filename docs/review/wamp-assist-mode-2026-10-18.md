# F172 — Assist mode

Canonical branch: `codex/wamp-assist-mode-2026-10-18`, based on delivered F171/PR246/main `45d3b6f4`.

The renewed overnight goal authorizes one checklist item at a time, with verification and deployment after each unless a material decision needs review. The October15–16 window remains closed and its cutoff automation remains paused.

## Plan

- Add device-local 100%/80%/60% game speed and optional safe respawn controls in Settings, with clear practice-only wording. Defaults remain unchanged.
- Scale solo physics, gameplay clocks, timers, animations and tweened gameplay consistently; retain pause behavior. Disable assistance during PvP, Room Rush and shared co-op play.
- Record safe grounded positions away from hazards; revalidate before use, fall back to authored checkpoints/start, and briefly protect an assisted respawn.
- Latch assistance for the entire ordinary or Expanded Room attempt, including toggling it on during a run and stale network replies. Assisted clears never submit records, guest history/claims, XP, ratings, difficulty, Lost Songs or editor clear-check credit. Switching assistance off cannot qualify that same attempt.
- Verify actual gameplay speed, goal completion, death/respawn, setting changes, competitive exclusions, persistence, and ordinary/Expanded Room behavior in desktop and phone browsers. Run quality, maintained browser coverage and the installed game client; inspect captures.
- Scan public source, push/PR, verify hosted source and main checks, merge, deploy through clean main, and verify the actual domain. Keep unrelated primary/mann.cool work and the chosen animation intact.

Local implementation and acceptance are complete. Hosted source/main checks and production delivery are pending. No push or deployment is claimed by this source-time receipt. Assisted clears remain local with no permanent beaten progress or XP; adding a server record type for that would be a separate product decision.

F171 is fully delivered through PR246: main `45d3b6f4`, Worker `cca96be2-13d7-42a2-841e-987b4e65630a`, Pages `9ecd4fe5`. Source/main six checks, 3,998 unit tests, 66 mobile cases, seven live text profiles, real account API/browser save/reload and 27 matching release assets pass. Source-time pending notes are superseded.

## Local acceptance

- Full quality passes548 files /4,015 tests, lint, styles, types, generated bindings, DOM contracts, production build and asset checks. Startup is644.7KB Brotli under670KB. The existing scene-size guard remains unchanged.
- Nine frozen production-build cases pass: ordinary rooms, Expanded Rooms and co-op exclusions on desktop Chromium, portrait Chromium and portrait WebKit. Two additional Readable/Large cases pass:320px Chromium ordinary room and390px WebKit Expanded Room. All captured browser errors and fixture misses are zero. These are browser/emulation checks; physical iOS acceptance remains separate.
- Tests use real Settings controls, goal entry, normal movement, completions, reloads and falling deaths.60% goal time matches the observed frame-time scale;80% settings survive reload. An assisted attempt stays local after assistance is disabled; a fresh normal attempt can submit again. No assisted finish reaches a run, guest claim or reward API.
- Strict respawn checks require a body back on the304px ground, a completed death beat, active protection and a position later than the328px authored start. All six ordinary/Expanded cases plus both larger-text cases pass, with inspected screenshots. Anchors are resampled at most every150 gameplay ms and revalidated against current static support, standing clearance, special tiles, nearby live objects, room snapshot and attempt ownership. Invalid anchors fall back to authored checkpoints/start. Assist protection lasts1,000 gameplay ms.
- Runtime/attempt tests cover signed and guest completion fences, late ranked/guest start replies, whole-attempt taint, draft clear-check exclusion, clock changes, live-mode/co-op exclusions and subscription/clock teardown. Lost Song context treats current or previously assisted attempts as practice. PvP/Room Rush exclusion uses the existing arena/match/rush state getters and scoped runtime policy; the native co-op cases exercise exclusion through the actual browser.
- The installed gameplay client completes two final movement/jump iterations on the frozen production build (x351→378), Readable/Large and60% Assist, with inspected captures and no captured browser error files.

Evidence is ignored under `output/f172-assist-2026-10-18/`. Initial diagnostics remain separate: scene-size extraction, a missing executable registration, a streaming4ms budget assertion under competing jobs (the unchanged test passes in isolation and the clean full rerun passes), dev hot reloads, changing Play/Stop and deferred-intro races in the harness, a load-sensitive wall-clock assertion, and an initial respawn assertion that could capture the death animation. The final harness waits for actual running goal time and actual grounded protected respawn; prior weaker matrices are retained as diagnostics rather than accepted proof. The Expanded Room pre-Play guest-start ordering defect was fixed before the final build.

## Delivery

This change needs Pages only. Assist settings are device-local and the API Worker settings model is unchanged. No migrations, presence server/protocol, map assets or renderer delivery is needed. A dedicated hosted Assist job runs the nine maintained cases alongside existing quality,66-case mobile, Expanded leaderboard and pause jobs. Source/main checks, OSS scan, merge, guarded release and actual-domain proof follow local acceptance.
