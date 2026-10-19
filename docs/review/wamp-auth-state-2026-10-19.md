# F064 — Auth client state and coverage


## 2026-10-19 — F064 auth state and coverage

Canonical branch `codex/wamp-auth-client-state-2026-10-19` from delivered PR249/main1d0a6aca. Finish F064 by extracting pure session/email/link-email/wallet/logout/display-name transitions, characterization and boundary tests, widening coverage to all source and recording the baseline here rather than adding the declined public AGENTS.md. Preserve temporary-refresh-failure behavior; clear stale claim quotas on sign-out and isolate debug snapshots. Plan: focused/full tests and coverage; real UI email/expiry/link-email/school/browser checks with isolated writes; installed-client gameplay; source/main hosted gates, clean guarded Pages-only release and actual-domain proof. No Worker/schema/wallet transaction format changes. F064 remains partial until accepted; master163/216. Preserve unrelated primary work, TAS lab, selected background and product/private decisions.

Delivery pending; no F064 push, merge or deployment is claimed.


## Validation baseline

The widened V8 run covers977 source files and passes552 test files/4,066 tests, including37 account-state cases. All branches, lines, statements and functions in `src/auth/sessionState.ts` are covered. Whole-source baseline:42.30% lines (38,968/92,114),42.80% statements (42,888/100,184),40.96% branches (28,391/69,303),44.13% functions (7,841/17,767). This replaces the three-file report; it is a baseline, not a claim of complete application coverage. Reports are written to ignored `output/coverage`.

Full quality and the646.1KB Brotli startup budget pass. The installed game client completes two movement/custom-jump iterations, with inspected airborne capture and no captured application errors. Browser auth acceptance, hosted source/main gates and delivery remain pending.

Behavior changes clear old room-claim quotas at successful sign-out/reset, copy account records in debug/event snapshots, and preserve native mobile summary taps through the existing zoom guard. Requests, wallet signing/transactions, server permissions and classroom redirect policy stay in their existing owners. Tests preserve identity on transient refresh failure, recover metadata on the next successful session, and require the verified server session before an email code supplies identity.


## Local source acceptance

F064 is locally verified; master164/216. Full552-file/4,066-test quality and37 auth transition cases pass. All977 source files are included in the coverage report; the extracted state module has100% branch coverage. Three strict native and three production-build browser contexts pass email sign-in, expired-code recovery, transient session failure/recovery, failed/successful sign-out, expired sessions, adding email to the same wallet-linked account, and classroom sign-out. Real touch rechecks cover320px Chromium and390px WebKit; the Safari probe waits for native menu/details transitions before proceeding. Zero unexpected application errors or fixture misses, and captures inspected. Two installed-client movement/jump iterations pass. Startup646.1KB Brotli; no backend/schema/renderer change. Retained earlier diagnostics came from test setup/constraint validation, menu reopen/label casing, omitted background account fixtures, and touch-panel synchronization; they are excluded from acceptance. Exact-source/main gates, authorized merge, guarded Pages-only release and actual-domain proof remain pending.


F064 hosted follow-up: source9e99a2f3/run39269843129 passed quality, pause, leaderboards and both Pages builds when inspected; auth desktop/Chromium phone passed, but Linux WebKit exposed a genuine touch bug. The global rapid-touch zoom guard omitted native `summary` controls, so a quick Email & wallet tap could lose its generated click. Add summary to the existing native-click exemption and manipulation CSS, and require two real close/open taps with a sub320ms interval and no cancelled touchend. Existing authorizations include this routine account-flow fix; no decision-gated work changes. Final local/source/main verification and delivery remain pending. The isolated old-production baseline independently proves sign-out retains quotas[5,3,2], while the fix expects[null,0,null].


F064 touch follow-up local acceptance: full552-file/4,066-test quality passes again, with645.9KB Brotli startup. Two final installed-client movement/jump iterations pass with inspected airborne capture. Native summary close/open taps now remain uncancelled, including measured rapid intervals below320ms. WebKit teardown is scoped explicitly: assert no application errors before school logout, require the actual classroom navigation request and final URL, and retain only known old-document SFX/world-tile/blob CORS cancellation messages after that action as separate teardown reports. Earlier errors and all other console/JavaScript exceptions remain fatal; WebKit may emit the bounded resource-cancellation messages through either console or pageerror. An unchanged-production classroom driver reproduces post-navigation world-tile/blob cancellation reports with zero pre-navigation errors; it is characterization evidence, not an accepted feature run. Final exact-source hosted checks and delivery still follow.


F064 final WebKit verification passes with rapid sub320ms summary touches uncancelled, zero account-flow errors and no fixture misses. The synthetic classroom navigation succeeds; bounded old-document cancellation reports are retained separately across both browser reporting channels. The full final matrix is running against the production build before the follow-up push. First source9e99a2f3/run39269843129 is terminal/unaccepted (auth only); its other eight checks pass. No merge or production deployment has occurred.


F064 follow-up accepted locally: the final single production-build matrix passes all three desktop/320px/WebKit cases, with real sub320ms summary taps, zero account-flow errors and no fixture misses. Separate teardown reports are retained in the ignored result. All552 files/4,066 full tests and final lint pass; final installed-client captures were inspected. Full exact-source/main hosted gates, merge, guarded Pages-only release and actual-domain verification remain.
