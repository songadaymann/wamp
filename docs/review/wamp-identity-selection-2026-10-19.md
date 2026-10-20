# F045: unambiguous account identity

Canonical branch: `codex/wamp-identity-selection-2026-10-19`, from merged main `ac2b8c89`. F048's full guarded API+Pages release is complete and verified on wamp.land / Pages c969b57e; no F045 change belongs to that release. The full checklist goal remains active. This item is not complete and has not been deployed.

The private review and its fact-checker corrections were read through the rendered browser UI and checked against current source. Display-name duplicates are intentional, and no escaping defect was established. Deleting/banning already targets stable IDs. Preserve those facts rather than imposing a new display-name uniqueness constraint.

## Required outcome

1. A chat owner searches existing accounts and explicitly selects a result showing its unique username. The submitted stable user ID identifies the exact selected account. Changing the input invalidates a prior choice; free text alone cannot grant access. The backend never falls back to an ambiguous display name. Preserve owner-only authorization, self/owner/admin/ban guards and origin enforcement.
2. Show unique usernames alongside display names in the delegated-admin list and relevant chat/comment author and moderation-confirmation surfaces. Preserve profile links by user ID, escaping, existing names, classroom boundaries, legacy records with no username and readable narrow layouts. Avoid per-message network requests and unrelated display-name normalization or migrations.
3. Verify duplicate-name accounts and actual migrated records, search/selection behavior, stale search responses, changed-input rejection, exact grant target, missing/invalid identity, all permission/ban guards, list/author identity and legacy fallbacks. No real account receives a role during verification.
4. Use existing search/identity/store/UI owners; keep account selection logic in a small collaborator if it would widen a mixed controller. Review chat paging/cache and comment target/version semantics before adding identity reads. Preserve the existing polling cadence and idle behavior.
5. Full quality, native desktop/phone/WebKit interactions and inspected captures, installed movement/jump client, OSS, exact-source/main hosted checks, push/attach PR, merge, clean-main guarded deployment and actual-domain code/assets/runtime proof. Keep F045 unchecked until every accepted requirement is verified and delivered.

## Current evidence and next step

An isolated actual-router reproduction uses a fully migrated local database, real generated owner session, two accounts with the same display name and distinct usernames. The current name-based route grants the first namesake while the intended second ID is ignored. All records and roles are ephemeral; production role changes are zero. The accepted probe closes its database and Vite SSR loader. An earlier unavailable-loader attempt is retained as a diagnostic only. Evidence and detailed current-source notes stay ignored under `output/f045-identity-2026-10-19/` until the fix is delivered.

Implementation is next. Preserve unrelated dirty primary/mann.cool work, user TAS lab/Chrome, selected animation, declined F061/F118, F145's unanswered collision/art choice and the conditional F243 provider-key follow-up. Physical iOS and owner-controlled credentials/financial actions remain separate.
