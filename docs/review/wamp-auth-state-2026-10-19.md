# F064 — Auth client state and coverage


## 2026-10-19 — F064 auth state and coverage

Canonical branch `codex/wamp-auth-client-state-2026-10-19` from delivered PR249/main1d0a6aca. Finish F064 by extracting pure session/email/link-email/wallet/logout/display-name transitions, characterization and boundary tests, widening coverage to all source and recording the baseline here rather than adding the declined public AGENTS.md. Preserve temporary-refresh-failure behavior; clear stale claim quotas on sign-out and isolate debug snapshots. Plan: focused/full tests and coverage; real UI email/expiry/link-email/school/browser checks with isolated writes; installed-client gameplay; source/main hosted gates, clean guarded Pages-only release and actual-domain proof. No Worker/schema/wallet transaction format changes. F064 remains partial until accepted; master163/216. Preserve unrelated primary work, TAS lab, selected background and product/private decisions.

Delivery pending; no F064 push, merge or deployment is claimed.


## Validation baseline

The widened V8 run covers977 source files and passes552 test files/4,066 tests, including37 account-state cases. All branches, lines, statements and functions in `src/auth/sessionState.ts` are covered. Whole-source baseline:42.30% lines (38,968/92,114),42.80% statements (42,888/100,184),40.96% branches (28,391/69,303),44.13% functions (7,841/17,767). This replaces the three-file report; it is a baseline, not a claim of complete application coverage. Reports are written to ignored `output/coverage`.

Full quality and the646.1KB Brotli startup budget pass. The installed game client completes two movement/custom-jump iterations, with inspected airborne capture and no captured application errors. Browser auth acceptance, hosted source/main gates and delivery remain pending.

Behavior changes are limited to clearing old room-claim quotas at successful sign-out/reset and copying account records in debug/event snapshots. Requests, wallet signing/transactions, server permissions and classroom redirect policy stay in their existing owners. Tests preserve identity on transient refresh failure, recover metadata on the next successful session, and require the verified server session before an email code supplies identity.


## Local source acceptance

F064 is locally verified; master164/216. Full552-file/4,066-test quality and37 auth transition cases pass. All977 source files are included in the coverage report; the extracted state module has100% branch coverage. Three strict native and three production-build browser contexts pass email sign-in, expired-code recovery, transient session failure/recovery, failed/successful sign-out, expired sessions, adding email to the same wallet-linked account, and classroom sign-out. Real touch rechecks cover320px Chromium and390px WebKit; the Safari probe waits for native menu/details transitions before proceeding. Zero unexpected application errors or fixture misses, and captures inspected. Two installed-client movement/jump iterations pass. Startup646.1KB Brotli; no backend/schema/renderer change. Retained earlier diagnostics came from test setup/constraint validation, menu reopen/label casing, omitted background account fixtures, and touch-panel synchronization; they are excluded from acceptance. Exact-source/main gates, authorized merge, guarded Pages-only release and actual-domain proof remain pending.
