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


## 2026-10-19 — F066 controller composition production delivery complete

F066 controller composition is delivered through PR252/main ba02037f, production Pages4913a164 / https://wamp.land. All52 constructions now live in six composition owners. Constructor1,565→56 lines; scene6,849→5,801. Required narrow live ports retain lazy fields,21 mutable writers, original generic types and command receiver/argument/result identity. All52 executable factory ASTs, order, alias arguments, constants and100 import bindings match frozen main; all498 existing scene fields/getters/methods outside the constructor remain unchanged.

All nine exact-source and merged-main checks pass, each with555 files/4,083 tests and99 browser scenarios. Local39 focused cases, six complete controls and six pause/cooperative scenarios pass; two installed-client movement/jump captures are inspected. Full guarded clean-main Pages-only retry exits0 with648.9KB Brotli startup /670KB budget. The initial successful upload's transient post-upload main-bundle404 is retained separately; unchanged smoke recheck and27-file custom/immutable comparison passed before the full accepted retry. No check or assertion was skipped or weakened.

Final27 assets match both custom and immutable domains. Actual published room -11,-6/version11 passes pause, cold Controls, resume and custom-V jump (-1821→-1851), with zero application/platform errors. The probe reads15 API paths and blocks6 test writes. API Worker remains cca96be2-13d7-42a2-841e-987b4e65630a at100%; no backend/schema/presence/renderer deployment. Unrelated work, TAS lab and chosen animated background are preserved.

F066 remains open/master164/216. Next: declarative frame/profiling stages with exact branch/order/timing semantics, then full-room Phaser presentation separated from streaming scheduling/lifecycle. A frozen526-case frame/profiling baseline covers all20 controller-profile slots, inputs, missing/replaced players, live mode changes, Assist delta, held/death branches and exceptions; it is baseline characterization only and requires comparison to the future candidate. Resource ownership boundaries are audited separately. The broader goal remains active.

Final browser resource check confirms execution of both current published main bundles: /assets/cache-v2/main-DQT7oWv7.js, /assets/cache-v2/main-r7ydrCOd.js. A fresh actual-API pause/Controls/resume/custom-V probe passes with observed jump -1821 to -1834, zero application/platform errors, and inspected airborne capture.


## 2026-10-19 — F066 frame update pipeline

Canonical branch `codex/wamp-frame-pipeline-2026-10-19` starts from delivered PR252/main ba02037f. The frame planner now owns explicit ordered world, command and actor phases, with named stages, all20 existing profile slots, early returns and finalization. Runtime ports stay lazy, pre-update physics timing remains in the scene, music input is reused, Assist scales only gameplay delta, and nested frames use independent reusable storage with released temporary references. The scene delegates update to the planner; all other existing scene members outside construction/adapter/update remain unchanged.

Frozen old-main comparison matches all526 ordered frame traces, arguments and identity tags, profiling clocks, state writes and exception paths. Permanent529 regression cases include those frozen traces plus pure construction, reentrant/repeated frames and profile-slot rotation. Existing seven composition lifecycle contracts now include the pure frame planner last and24 owned writers. Full quality, native browser verification, hosted exact-source/main gates and guarded Pages-only release follow. F066 remains open/master164/216: full-room presentation ownership separation is still pending.


## 2026-10-19 — F066 frame pipeline production delivery complete

PR253/main3f9389bd is deployed to production Pages fdad411f / https://wamp.land. The ordered frame planner preserves526 frozen traces across all20 profiling slots, input short circuits, early exits, live state, Assist timing, finalization and exception paths. Three additional regression cases cover pure construction, nested/repeated frames and slot rotation. All497 existing scene members outside the constructor, live adapter and update remain unchanged. F066 stays open/master164/216; full-room Phaser presentation ownership separation remains next.

Full quality passes556 files/4,612 tests. All nine exact-source and merged-main checks are green, each covering99 browser scenarios. Local21 native controls/pause/Assist cases and two installed-client movement/jump captures pass; representative gameplay and phone controls are visually inspected. The initial merged-main Safari cooperative pause case completed its functional assertions but reported three connection resets; the unchanged six-case hosted rerun passes. Both raw attempts and accepted-job provenance are retained. No assertion or timeout was weakened.

The first normal clean-main guard exited0, but the automatic main Pages build finished afterward and replaced custom-domain asset references with another build of the same commit. After that build completed, the full guarded Pages-only republish exited0. Final startup649.5KB Brotli /670KB. All27 checked assets match on custom and immutable domains; a fresh actual published-room -11,-6/version11 pause/cold Controls/resume/custom-V jump probe executes both final main bundles, observes jump -1821→-1838 and reports zero application/platform errors. API Worker remains cca96be2-13d7-42a2-841e-987b4e65630a at100%; backend/schema/presence/renderer are unchanged. Earlier race and network diagnostics remain separate from accepted evidence in output/f066-frame-2026-10-19. Wait for automatic wampland main builds before the final guarded upload in future releases. Unrelated dirty checkouts, TAS lab and selected animation remain preserved. The broader goal remains active.


## 2026-10-19 — F066 full-room presentation ownership

Canonical branch `codex/wamp-room-presentation-2026-10-19` starts from fully delivered PR253/main3f9389bd. Previous frame pipeline delivery is complete; its older pending notes are historical. F066 remains open/master164/216 until this last accepted ownership stage is delivered.

Move concrete immediate/prepared room graphics, tilemaps, terrain/inset collision resources, dormant activation/suspension, background creation/synchronization and resource disposal into a required full-room presenter. Keep room membership, cache identity/leases, preparation generations, cancellation, retained-room policy, lifecycle phase changes, batch limits and queue scheduling in the streamer. Preserve execution/observer order, aggregate cleanup attempts, async background destruction checks and all existing lifecycle assertions. Freeze current main before editing; compare extracted executable bodies and scheduling boundaries, migrate test fixtures to explicit presenter dependencies, then focused/full/browser/hosted release gates and guarded Pages-only delivery. Wait for automatic wampland main build before final manual upload. Selected animation and unrelated primary work remain preserved.


Presenter source acceptance:40 direct resource tests and118 existing streaming lifecycle cases pass. The frozen-main audit matches14 complete moved methods, seven extracted creation/activation stages, all199 remaining streaming method bodies after explicit delegation expansion,34 original module/export bindings and both resource interfaces. All712 original matcher expressions/expected values remain intact. The immediate creation result retains captured texture keys independently of callback-mutable runtime fields; background identity remains live across room-origin callbacks. Streamer6,164→5,357 lines; new presenter1,137 lines, below the1,500-line guard. Full4,652 unit cases pass; the final type/build/assets, native controls/background/cold-crossing checks, hosted source/main gates and guarded delivery are in progress. F066 remains unchecked until complete release proof.


## 2026-10-19 — F066 complete and live

PR254/main `969b5f83` is deployed to https://wamp.land / Pages `4b2ce789`. All four accepted F066 stages are complete through PRs251–254: required live runtime views, six composition owners, declarative frame/profiling stages and actual full-room Phaser resource ownership. Full557-file/4,652-test quality, all nine exact-source/main checks and99 browser cases per head pass. Local21 native cases, three animated-background profiles and five functional cold/warm crossings pass. The normal clean-main guard exits0 after automatic builds;27 assets match both domains and actual published-room pause/Controls/resume/custom-V jump passes with zero errors. API stays cca96be2 at100%.

Both unchanged-main and candidate broader performance benchmarks still fail existing timing/clone/long-job targets; no FPS improvement is claimed. The paired reports are retained as a separate performance follow-up. All712 original lifecycle assertions and frozen ownership/order comparisons remain intact. F066 is checked complete; master165/216. Unrelated dirty work and selected animation are preserved. Detailed proof: `output/f066-presentation-2026-10-19/release-receipt.md` and `feature-completion-audit.json`. The broader checklist remains open.

PR [#254](https://github.com/songadaymann/wamp/pull/254), source ab95741bf82573e94f6a5055243cbaa389b95eda, merged main 969b5f83ae8b235b51c6f227dd13d600ccd27471. Production https://wamp.land; final immutable https://4b2ce789.wampland.pages.dev.

The final full-room presenter owns actual graphics, tilemap, terrain/inset/collider/background resources, activation, suspension and destruction. Streaming keeps membership, generations, cache identities/leases, retention, queue scheduling, phases and batching. Frozen executable comparisons match14 whole methods,7 extracted stages,199 streaming methods,70 original fields,22 constants,34 imported bindings and both resource interfaces. All712 original assertion expressions and expected values remain. Streamer6,164→5,357 lines; presenter1,137 lines.40 new direct tests and118 existing streaming lifecycle cases pass.

Full F066 audit accepts all four stages through PRs251–254: required live context in five real consumers, all52 controller constructions in six composition owners, explicit frame/profiling pipeline with526 frozen matching traces and529 permanent regressions, and full-room resource ownership. The final stage leaves prior context/composition/frame source unchanged. See feature-completion-audit.json and prior stage receipts.

Validation:557 files/4,652 tests; all9 exact-source and9 merged-main checks;99 distinct browser cases per head. Local21 native controls/pause/Assist cases,3 animated-background profiles and2 installed-client movement/jump iterations pass, with inspected captures. Both candidate and unchanged-main complete5 cold/warm crossings with collision ready, zero seam hold and zero errors.

Performance limitation: both strict broader benchmark reports remain failed on timing, two snapshot clones and long scheduler jobs. Candidate p95 41.1ms versus baseline43.3ms is one paired five-trial observation, not an FPS improvement claim. Thresholds and assertions are unchanged. transition-comparison.json and both original reports remain as a separate performance follow-up. The source mobile first attempt failed only on two external tile CDN connection resets; the complete unchanged mobile rerun passes. All failed fixture/benchmark/network diagnostics remain separate from accepted evidence.

The normal full clean-main Pages-only guard exited0 after automatic production build completion. No tests/smoke were skipped. Startup649.9KB Brotli/670KB.27 assets byte-match on both custom and immutable domains. Live room-11,-6/version11 executes both final main bundles and passes pause freeze, deferred Controls, resume and custom-V jump (-1821→-1841), errors0/platform reports0;15 read paths and5 blocked writes. API version cca96be2-13d7-42a2-841e-987b4e65630a remains100%; backend/schema/presence/renderer unchanged.

OSS scan before public push:0 blockers/0 warnings. Release checkout clean literal main with HEAD==origin/main, tree identical to accepted source. Owned previews and browsers are stopped. Unrelated primary/mann.cool dirty status and exact selected animation hash are preserved. F066 complete; master165/216. Broader checklist goal is not closed. Final documentation is a local carry-forward checkpoint; no docs-only release is claimed.
