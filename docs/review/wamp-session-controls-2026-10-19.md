# F048: all-device session controls

Canonical branch: `codex/wamp-session-revocation-2026-10-19`, from F243 merged main `bdd2c3ee`. F243's production release runs separately from the clean release clone; this checkout's F048 source is not part of that release. The full checklist remains the objective. Master167/216; F145's collision/art question remains unanswered.

The private review's corrections were read and checked against current source. Email/code verification already creates new sessions; wallet-link rotation is not the intended fix. School password reset already revokes the student's sessions atomically, and hourly maintenance already removes expired sessions in bounded indexed batches. Preserve and verify those implementations.

## Complete outcome and verification plan

1. Add a session-cookie authenticated POST action to revoke every session belonging to that same identity, clear the current cookie, and preserve all other users. Require an explicit trusted browser Origin. A caller cannot supply another user ID. Ordinary logout continues to revoke only its current session; API/agent tokens keep their separate revocation controls.
2. Add a WAMP account-menu action with an all-device confirmation. Cancellation sends no request, failure keeps the user signed in with a useful message, and success clears all identity/quota/moderation state through the existing transition. Both logout choices preserve the classroom-login redirect. A later authenticated session clears a stale logout notice.
3. Verify the actual migrated-database/cookie behavior, authentication, bearer-only denial, method/origin guards, index use, failure and concurrent revocation, other-user isolation, existing school reset and expiry maintenance.
4. Extend the existing strict desktop/phone/WebKit auth matrix: cancel/failure/success,44px targets, state cleanup, both classroom redirects and reauthentication. Preserve every existing sign-in, linking, error and rapid-touch assertion; retain diagnostics separately. Inspect real captures and run the installed movement/jump client after meaningful runtime changes. Physical iOS remains separate.
5. Full quality, exact-source and merged-main hosted gates, OSS, push/attach PR, merge, guarded API+Pages release and actual-domain code/assets/auth/runtime proof. Do not log out real accounts during verification. No new schema, background task, provider credential or financial operation is required.

## Current source status

The new route delegates to a narrow `auth/logoutAll.ts` handler. Its indexed delete uses the cookie's userId; no body is parsed to select a target. The existing auth client owns both logout request paths and state transitions. Existing menu action markup supplies the44px control layout; no CSS override is added.

Twelve new endpoint cases plus the existing state/maintenance suites pass53 tests. Two additional state cases now cover clearing stale logout notices after a verified session returns. Full verification is pending. The initial local test fixture used the token-creation helper incorrectly, and a missing-Origin case exposed the existing general guard's permissive no-Origin policy; the new action now explicitly requires Origin. Both are corrected without weakening assertions. Early desktop captures found the new action below44px; a large-size attribute alone did not resolve it, so the logout choices now use the existing menu action row. Those failed attempts remain diagnostics, not accepted UI proof.

The next native run and remaining acceptance gates are in progress under ignored `output/f048-session-controls-2026-10-19/`. F048 stays unchecked. Preserve unrelated dirty primary/mann.cool checkouts, TAS lab, the selected animated background, declined F061/F118 and all unresolved owner/physical-device decisions.

## Native acceptance and delayed-response correction

All three desktop/phone/WebKit profiles pass every existing flow plus44px action targets, confirmation cancellation without POST, failed revocation preserving identity/quota, successful complete state cleanup, stale notice cleanup, both school redirects and reauthentication. Latest captures were actually inspected, including both logout controls at narrow width.

A controlled old signed-in session response delivered after all-device logout reproduced a UI identity restoration failure. The existing auth request owner now fences session responses across the logout operation; both current-session and all-device delayed responses leave the UI signed out in all three profiles. Later new session refreshes and sign-in/linking still work. The small generation fence stays in the existing auth client because it owns both the request and revocation lifecycle; a second state owner would obscure that ordering. Full quality and final delivery remain pending. Failed diagnostics are retained under ignored output, not counted as accepted proof.

## Source acceptance

Full local quality exits0:564 files/4,717 tests, styles/lint/types/DOM/generated bindings/build/startup and all asset checks. Startup651.0KB Brotli stays within670KB. The same strict three-profile auth matrix also passes against the built production app. Two installed-client movement/jump iterations have inspected captures, active unpaused gameplay and no browser/HTTP errors. OSS reports0 blockers/0 warnings. These proofs do not log out any real account. Exact-source/main hosted checks, merge and guarded API+Pages delivery remain pending.

## Production delivery

[PR259](https://github.com/songadaymann/wamp/pull/259), source `4c0de36f`, is merged as `ac2b8c89` and live on [wamp.land](https://wamp.land) / [immutable Pages](https://c969b57e.wampland.pages.dev). All nine checks on each exact head pass; parsed logs prove99 hosted browser cases per head and full564 files/4,717 tests. The main tree equals the source tree. Source preview10873936 matches its reviewed assets. The clean literal-main full API+Pages guard exits0, with no skipped checks or schema changes. Worker `2b279ba8-6296-49e3-a5f2-f60c25a8b1a4` serves100%; deployed JavaScript exactly matches the clean-main bundle. All37 checked assets match both custom and immutable domains.

The real endpoint denies anonymous all-device logout with401; health/comments and both existing mint prepare authentication gates pass. The actual-domain game starts with the final assets, zero errors and an inspected capture. All three actual-domain desktop/phone/WebKit profiles pass every existing auth flow, cancellation/failure/success,44px controls, both logout delayed-response protections and classroom redirects, using isolated replayed data. No real account/session or API/agent token was revoked. Physical iOS remains separate.

F048 is complete. Existing password-reset revocation and bounded expiry maintenance were verified; no new timer, background task or provider credential was added. The broader checklist stays active. F243's delivered technical fix still has only the conditional historical provider-key owner follow-up; F145 still awaits the collision/art choice. Unrelated dirty checkouts, TAS and selected animation are preserved.
