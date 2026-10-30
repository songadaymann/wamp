# F247 — wallet approval and session safeguards delivered

Delivered through [PR271](https://github.com/songadaymann/wamp/pull/271) and [PR272](https://github.com/songadaymann/wamp/pull/272), final source `009bc9690a10f80c4ed423d7a0443a59a011834f`, main `c25b1f7b2471e7330124313d0f5c46fc612d5d08`. Production [Pages7457cf79](https://7457cf79.wampland.pages.dev) and API `68e74fd6-14ca-4254-a581-26986cd545d5` are verified on wamp.land. Migration `0068_wallet_challenge_intent.sql` is applied. F247 remains unchecked; master175/216.

## Delivered behavior

Wallet proofs are bound to sign-in or linking, with the target account named in the linking signature. Linking requires the original live browser session. Proofs are consumed once, and the final conditional attachment preserves any wallet linked while approval was open. Concurrent valid sign-ins converge on the same wallet account. Classroom/API-token restrictions and legacy signed-out API sign-in remain enforced.

The client checks the actual signer before and after approval, cancels observed account/wallet/gate changes and keeps the action busy until final refresh. Known conflicts and cancellations give readable next steps. Conflicting accounts are preserved; histories are not merged and wallets are not reassociated. The touch action retains its green surface and44px minimum target.

Successful anonymous session refresh clears invalid, expired or revoked cookies. New challenges compare the account expected at the click with the authenticated server identity before requesting a signature. The supplied ID is a condition, never the authority. Stale link screens cannot silently request sign-in instead, and clearing an old cookie cannot turn a link proof into sign-in. Legacy address-only clients retain existing challenge behavior.

## Verification and release

Both final exact-source and merged-main pipelines pass all18 checks,603 test files/5,140 tests and424 browser cases per head. Focused42 proof/client cases,12 native API/D1 cases and12 safety cases pass. The final safety build passes40 controls across desktop,320px phone,WebKit phone andtablet; the automatic source preview passes10 desktop controls. Installed-client gameplay and wallet-gate captures were inspected.

The clean-main coordinated guard (`npm run deploy:prod -- --migrate`) exits0 with no skipped checks. All224 checked JavaScript/CSS/OpenAPI assets match on the custom domain and immutable Pages deployment. Production API bytes match the built Worker; renderer and map Worker bytes and active versions remain unchanged, as do the active map renderer and authoring asset contract.

Actual-domain verification accepts40 strict controls across four profiles, plus5 safe API probes including invalid-cookie recovery. The UI proofs use isolated native API/provider fixtures; no real wallet, production test user/nonce record or blockchain transaction is created. Synthetic safety records are cleaned up. Live captures and preservation checks are inspected/passed.

One initial live WebKit no-wallet run encountered488 sampled Cloudflare report-only warnings, all retained with zero unexpected application errors. The unchanged strict WebKit recheck and tablet suite pass; no policy, response header or assertion was changed. Monitoring writes are intercepted only by the proof harness. Earlier candidate/harness failures remain separate from accepted evidence. Canonical evidence: ignored `output/f247-session-2026-10-20/delivery.json`, `live-combined-proof.json`, native/hosted reports, CI full logs and exact asset/Worker inventories. Original PR271 evidence remains in `output/f247-linking-2026-10-20/`.

## Remaining scope

Unused-account recovery must protect against already-authenticated in-flight writes creating inaccessible source history after a transfer. Zero active sessions at transfer time is insufficient. Linked-wallet replacement and identity consolidation also remain pending. No recovery claim is made by this release.

The broader overnight goal remains active until October21 at05:00 America/New_York (09:00UTC), with no new implementation, tests or deployments at/after cutoff. AI generation stays on hold; historical artwork updates stay unsigned. Dirty primary/mann.cool checkouts, selected animated background and user Chrome/TAS4208 remain preserved.

## Recovery plan after the approval boundary ships

1. Bind wallet proof to its intended sign-in/link action and current session. Consume each proof once. Keep signed-out authentication, email accounts, classroom restrictions and existing app/API credential boundaries intact.
2. Recover a wallet from an unused, logged-out wallet-only profile only after new proof and an explicit in-app confirmation for the current account. Keep the current account's profile, founder number and preferences; retain the previous profile's default records. Do not merge histories or delete users. Any saved activity, authored content, non-default profile, stored permissions, credentials or another active session blocks recovery. Check both configured databases; unknown schema/state fails closed.
3. Make the final ownership change atomic, including confirmation consumption. Conditional eligibility and the actual move must share one database operation; a failed or raced confirmation must not detach either wallet. Preserve existing linked wallets and provide clear next steps for conflicts.
4. Verify with the native D1/SQLite behavior, real ephemeral signature verification, stale sessions, replay/expiry, concurrent claims, rollback, default founder/settings scaffolding, meaningful-record exclusions, and actual app controls/cancellation on four device profiles. No real wallets, production user writes, signing keys or private RPCs.
5. Require exact source/main CI, hosted controls, safety evidence for API/schema changes, a clean-main coordinated guard and actual-domain verification before delivery. Keep the broader F247 item open if this bounded recovery leaves wallet replacement or substantive identity consolidation unresolved.

The currently verified upstream Layers docs support a Vue component island as well as Nuxt, and explicitly leave session persistence, nonce storage and server verification to the application. F247 extends WAMP's backend/domain boundary; it adds no alternative connector stack. F238's Layers wallet migration remains separate, with its migration plan preserved and the direct-Vue option recorded for investigation. The installed-wallet gate remains mandatory.

Evidence starts in ignored `output/f247-linking-2026-10-20/`. Local inspection loaded all67 primary migrations and3 jam migrations into isolated SQLite. A genuinely new wallet profile has only its user row, zero-gameplay progress and automatically derived founder badges; this baseline must not be mistaken for player-created history. Live user records have not been inspected or changed.
