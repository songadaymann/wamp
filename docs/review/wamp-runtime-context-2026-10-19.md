# F066 — Gameplay composition and runtime context


## 2026-10-19 — F066 gameplay composition and runtime context

Canonical branch `codex/wamp-runtime-context-2026-10-19` from fully delivered PR250/main2cd27517. F064 is complete; its older pending notes are superseded by the final receipt. F066 remains open/master164/216. Current audit: constructor627–2192 (1,566 lines),48 controller constructions, repeated mode/coordinate/player/body getters; only room audio receives a context getter, and controllers do not receive the context itself.

Plan the complete F066 outcome across reviewable deliveries: (1) extend typed live runtime capabilities and migrate real controller consumers, preserving nullability/lazy access/lifecycle; (2) move world/player/PvP/room-rush/social/UI construction into composition owners with characterized initialization and dependency order, substantially reducing the constructor; (3) declarative frame/profiling stages with exact existing execution and branch semantics; (4) separate full-room Phaser presentation/create/destroy/background ownership from streaming scheduling/lifecycle. Keep F066 unchecked until the complete outcome is proven. Use existing extracted collaborators and frozen old/new behavior/order evidence, then focused/full tests, installed/native browser flows, all exact-source/main gates and guarded appropriate deployments with actual-domain proof. No product changes, optional compatibility end state, or weakened size guard is the intended result. Preserve user primary dirty work, TAS lab, chosen animation and private/decision-gated work. Initial audit is complete; the first implementation and acceptance status is recorded below.

Evidence: constructor audit retained under ignored `output/f064-auth-2026-10-19/next-f066-audit.json`. No F066 push, merge or deployment is claimed.


## 2026-10-19 — First runtime-context delivery

Five existing controllers now require narrow live runtime capabilities: room audio, ghost races, browse realtime startup, player health and player presentation. The scene injects its single context; old duplicated getter ports are removed for these consumers. Raw player/body/avatar/sensor references stay lazy across creation, destruction and respawn; mode/room reads remain live and diagnostics retain their detached serializable shape. Death-masked interaction readers and coordinate-cloning consumers are unchanged.

Local focused acceptance: 32 cases across six files and TypeScript pass. Frozen-main comparison proves all five executable controller classes unchanged after the explicit read mapping; an independent scene audit checks all eleven original provider expressions and required context wiring. Full quality, production-build browser scenarios, exact-source/main hosted gates and guarded Pages-only delivery follow. This is the first F066 delivery; composition ownership, declarative frame stages and room presentation separation remain pending. F066 remains unchecked, master164/216.


First-slice verification: full quality passes554 files/4,076 tests;645.9KB Brotli startup remains below670KB. Six controls and six pause scenarios plus nine Assist cases and all33 WebKit mobile scenarios pass. Installed-client captures and representative phone/menu controls are inspected. Final Chromium, account and leaderboard matrices follow.

The initial leaderboard replay failed when a warped destination disappeared: its recorded negative-coordinate chunk response excluded the requested1,0 window. The fixture now answers both chunk endpoints with requested bounds and the two actual course cells, retaining all ranking/UI/error/stale-reply assertions and timeouts. A previous-release legacy probe passed and is retained as characterization, not proof of a baseline failure. No product workaround or weakened assertion is used. Final nine-case corrected-fixture acceptance remains required.

GitHub Actions run39282321221 is queued during GitHub's official October19 Actions/Pages/Webhooks outage; both Cloudflare preview checks passed. There are no enforced branch checks/rules on main. The release contingency is to execute the identical seven quality/browser jobs locally, then run the unchanged full clean-main deployment guard and actual-domain verification. Hosted statuses remain explicitly pending, never reported as passed. F066 remains open/master164/216.


## 2026-10-19 — First F066 production delivery complete

F066's first slice is merged through PR251/main b4b63234 and deployed to Pages 000d77b8 / https://wamp.land. Five controllers consume required live runtime views; the remaining F066 composition/frame/presentation work stays open (master164/216).

Full quality and the unchanged guarded clean-main Pages-only release pass554 files/4,076 tests. All99 distinct browser scenarios pass locally; the retained Chromium haptic timeout passes its unchanged isolated recheck. Final native account timing coverage passes all three contexts. Startup645.8KB Brotli /670KB.

27 assets byte-match both custom and immutable domains. Actual room -11,-6/version11 passes pause, cold Controls, resume and custom-V jump (-1821 to -1838), with zero application/platform errors;15 actual read paths and5 blocked test writes. API Worker stays cca96be2-13d7-42a2-841e-987b4e65630a at100%; no backend/schema/presence/renderer deployment. Unrelated dirty work, TAS lab and selected background are preserved.

GitHub's official Actions/Pages/Webhooks outage leaves source run39284490152 and main run39285426902 queued. Hosted checks are pending and are not reported as passed; the full local assertions and normal guarded delivery provide the recorded release contingency. Initial fixture/timing diagnostics remain separate from accepted evidence. The broader goal and F066 remain active.


## 2026-10-19 — F066 controller composition

Canonical branch `codex/wamp-controller-composition-2026-10-19` starts at delivered PR251/main `b4b63234`. The preceding production receipt supersedes earlier first-slice pending notes. F066 remains open/master164/216.

Move all52 controller constructions into world, player, PvP, Room Rush, social and UI composition owners; retain an explicit ordered root and typed live private-state adapter. Factories require only the specific capabilities they read, with explicit original controller return types preserving generics. No unchecked scene cast, eager player/controller snapshot, optional compatibility path or changed constructor callback is introduced. Shared numeric settings retain their original values. Scene fields outside construction keep their previous implementation.

Local characterization: constructor1,565→56 lines, scene about1,000 lines shorter. Frozen-main comparison matches all52 executable factory bodies, controller assignment order, guest-run alias arguments and shared settings. Seven committed lifecycle/architecture cases cover all live getters and command forwarders,21 owned writers, missing/create/destroy/replace states, receiver/argument/result identity, async/exception propagation, generic profiling and frozen construction order.39 focused cases across seven files pass. Full quality/build/browser checks, OSS, release gates and guarded deployment remain pending. Prior GitHub Actions source/main runs are still confirmed queued during the official outage; retain the documented local-equivalent contingency if the outage persists. Remaining F066 frame/profiling stages and room presentation/streaming ownership separation stay in scope.


F066 composition source acceptance: full555-file/4,083-test quality passes, startup648.6KB Brotli /670KB. Two installed-client movement/custom-jump iterations pass with inspected airborne captures and no application-error files. Frozen-main comparison matches all52 factory executable ASTs, exact controller construction/assignment order, guest-run alias arguments, numeric settings and100 imported module/export bindings. The temporary print-based comparison was sensitive to object-literal line wrapping; the accepted comparator checks complete transpiled executable ASTs including operators and literal contents while ignoring trivia. No product differences were normalized away beyond the explicit scene-to-live-port access mapping. Native desktop/phone/Safari controls, hosted source/main gates and guarded production delivery follow.

The prior PR251 source run39284490152 and merged-main run39285426902 have now completed successfully after GitHub recovered. Both exact-head hosted matrices pass all99 browser scenarios and4,076 tests; both source Cloudflare checks are successful. Their earlier pending outage notes are historical and superseded by this recovered proof. The current composition revision will use the normal hosted gates before merge. F066 remains open/master164/216.

Native composition acceptance: all six ordinary/Expanded Room desktop,320px phone and WebKit control scenarios pass with zero application errors and fixture misses. Ten remapped actions, physical-key behavior, combat, restart/Stop, focus release, persistence and reset remain intact. Hosted source/main gates, normal guarded Pages delivery and actual-domain verification follow.
