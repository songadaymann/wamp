# F241: refreshed ownership before editing

Implementation in progress on `codex/wamp-owner-edit-2026-10-20`, from main ba899969 plus F248 receipt checkpoint773439a4. F248 is delivered; master171/216. F241 remains unchecked and the whole checklist goal remains active.

The current fact-check confirms the editing lockout: the HUD caches ownership for a session, its Edit action is hidden from a new wallet holder, and the authenticated ownership/refresh endpoint has no client caller. Builder attribution and Collection shelves are separate product ideas; original builder credit must remain intact. Expanded Room authoring has its own permissions and must be tested without granting course rights from ownership of one cell.

Connect a deliberate Edit/Check ownership action to a strict current-chain refresh. Refresh the HUD cache, then open the editor only if the same selected room, world, mode and signed-in wallet remain current and the server grants edit permission. Check a previously cached owner as well as a different wallet. Ordinary unminted/local edits retain their behavior. Failed/provider checks have a clear retry path. No per-frame or idle polling; pending checks have a bounded lifetime and cleanup. Old summary loads must not overwrite a newer ownership result or a reset context.

Acceptance still required: meaningful repository, handler/database/chain, asynchronous cache/flow and UI tests; buyer success, seller denial, third-wallet denial, auth/classroom gates, failure/retry, cancellation across selection/world/session/disposal, local/unminted and Expanded authoring compatibility. Inspect desktop/phone/WebKit captures and installed game-client movement. Then full quality/OSS, exact-source and merged-main hosted gates, guarded clean-main API/Pages delivery and actual-domain/bundle proof. No production transfer/mint, real-key signature, credential or contract changes.

Preserve unrelated dirty checkouts, user Chrome/TAS4208 and the selected animation. Declined F061/F118, unanswered F145/F243/F167, physical iOS and other financial/product choices remain separate. Ignored evidence: `output/f241-owner-edit-2026-10-20`.

## Current local evidence

Full quality passes583 files /4,861 tests, including lint, TypeScript, DOM, generated bindings, build, size and assets. The combined focused suite passes88 cases in9 files. Real-session/migrated-database/RPC route tests verify buyer rights, seller/third-wallet denial, preserved builder attribution, disabled/missing configuration, wrong local network, absent chain token, private provider errors and retry. A new require-fresh mode prevents this endpoint from presenting stored fallback ownership as a successful refresh; ordinary tolerant saves and existing mint-local behavior remain covered.

The ownership permit is bound to selected room/world/mode/account/wallet and scene activity. It cancels pending fetches on context invalidation or sleep, owns a15-second deadline, and retains a disposable context check through lazy editor loading. The HUD fences earlier summary replies using generation/revision counters. Check ownership is available to a linked wallet with differing cached ownership; cached current holders are rechecked too.

Two installed-client movement/jump captures are healthy and inspected. One actual desktop buyer flow passes with one intercepted refresh POST, no errors/misses and a fully loaded editor exposing the exact buyer address plus Save/Publish permission. Captures inspected. Earlier harness setup/readiness mistakes remain diagnostic only.

Remaining before completion: protected minted cells inside Expanded Rooms must receive room-level access without transferring group authoring rights; complete native seller/third-wallet/failure/retry/context-change and phone/WebKit cases, fresh Workerd API proof, tracked production/CI integration, final quality/OSS and the entire release/live workflow. F241 remains unchecked; master171/216.
