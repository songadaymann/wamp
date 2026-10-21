# F247 — safe wallet-link recovery

Initial branch: `codex/wamp-wallet-linking-2026-10-20`, from verified main `fc43bc1e` with the final F240 receipt, merged through PR271. Current canonical release branch: `codex/wamp-wallet-session-recovery-2026-10-20` from main `4ca2f98`. Master175/216. The checklist goal stays active until October21 at05:00 America/New_York; no new implementation, tests or deployments at/after09:00UTC. AI generation stays on hold and historic artwork repairs remain unsigned.

## Session-recovery follow-up before production

PR271/main4ca2f98 passed both18-check/420-case pipelines, but pre-release review caught two session edges before the coordinated API release. The follow-up branch `codex/wamp-wallet-session-recovery-2026-10-20` clears invalid/revoked/expired cookies on successful anonymous session refresh, and sends the account expected at the button click as a condition on challenge creation. It never chooses authority from that supplied ID. A stale link screen cannot silently request sign-in instead; clearing an old cookie cannot turn an existing link proof into sign-in. Legacy address-only API clients retain their existing challenge behavior.

Current local evidence:603 files/5,140 tests,42 focused proof/client cases,12 native API/D1 checks and40 controls across four profiles pass. The new sign-in case starts with a stale cookie; a separate case removes the cookie before challenge creation and verifies that no signature or attachment happens. Exact follow-up source/main checks, safety and production guard/live checks are pending. Neither superseded candidate nor this follow-up has been deployed to the production API. New evidence: ignored `output/f247-session-2026-10-20/`; original candidate evidence stays in `output/f247-linking-2026-10-20/`.

Unused-account recovery still needs proof that previously authenticated, in-flight writes cannot create inaccessible source history after a move. Do not equate zero active sessions at the transfer instant with the absence of an in-flight request. Keep recovery and wallet replacement unchecked until that boundary is verified.

## First release — approval boundary and actionable conflicts

The first change binds each proof to sign-in or linking, names the target WAMP account in a linking signature, and permits one proof consumer. A link also requires the original live browser session, and the final conditional write preserves any wallet linked while the approval was open. Signed-out API sign-in still works. Classroom and API-token restrictions stay enforced.

The client checks the actual signer before and after native approval, cancels observed account/wallet/gate changes, and keeps the action busy through its final session refresh. Expected conflicts and cancellations produce readable messages without provider diagnostics. Another-account conflicts explain how to use the wallet account and explicitly preserve the current account's rooms. Existing-wallet conflicts explain that switching the linked wallet is still unavailable.

This phase does not move wallets between accounts. F247 remains unchecked and master175/216; unused-account recovery and wallet replacement are pending. The touch wallet action keeps its green surface after tapping and has a44px minimum target on phones and tablets.

Local evidence:603 test files/5,132 tests passed, including34 new proof/client cases;10 isolated native D1/API checks passed. All36 app-control checks passed across desktop,320px phone,WebKit phone andtablet against the real bundled API/native D1 with ephemeral signatures. Installed-client gameplay and wallet-gate-on/off captures were inspected. Safety, exact source/main CI, coordinated guard and live proof remain pending. Earlier failed candidates and harness setup failures remain in ignored output; no production user records or real wallets have been used.

## Recovery plan after the approval boundary ships

1. Bind wallet proof to its intended sign-in/link action and current session. Consume each proof once. Keep signed-out authentication, email accounts, classroom restrictions and existing app/API credential boundaries intact.
2. Recover a wallet from an unused, logged-out wallet-only profile only after new proof and an explicit in-app confirmation for the current account. Keep the current account's profile, founder number and preferences; retain the previous profile's default records. Do not merge histories or delete users. Any saved activity, authored content, non-default profile, stored permissions, credentials or another active session blocks recovery. Check both configured databases; unknown schema/state fails closed.
3. Make the final ownership change atomic, including confirmation consumption. Conditional eligibility and the actual move must share one database operation; a failed or raced confirmation must not detach either wallet. Preserve existing linked wallets and provide clear next steps for conflicts.
4. Verify with the native D1/SQLite behavior, real ephemeral signature verification, stale sessions, replay/expiry, concurrent claims, rollback, default founder/settings scaffolding, meaningful-record exclusions, and actual app controls/cancellation on four device profiles. No real wallets, production user writes, signing keys or private RPCs.
5. Require exact source/main CI, hosted controls, safety evidence for API/schema changes, a clean-main coordinated guard and actual-domain verification before delivery. Keep the broader F247 item open if this bounded recovery leaves wallet replacement or substantive identity consolidation unresolved.

The currently verified upstream Layers docs support a Vue component island as well as Nuxt, and explicitly leave session persistence, nonce storage and server verification to the application. F247 extends WAMP's backend/domain boundary; it adds no alternative connector stack. F238's Layers wallet migration remains separate, with its migration plan preserved and the direct-Vue option recorded for investigation. The installed-wallet gate remains mandatory.

Evidence starts in ignored `output/f247-linking-2026-10-20/`. Local inspection loaded all67 primary migrations and3 jam migrations into isolated SQLite. A genuinely new wallet profile has only its user row, zero-gameplay progress and automatically derived founder badges; this baseline must not be mistaken for player-created history. Live user records have not been inspected or changed.
