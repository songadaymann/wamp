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
