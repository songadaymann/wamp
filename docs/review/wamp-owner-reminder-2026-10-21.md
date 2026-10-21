# F246 — owner collection reminder

Canonical branch `codex/wamp-owner-reminder-2026-10-21`, isolated from verified main `a9dabba8`.

Original prompt: "ok let’s do the next one" — finish the remaining actual-price owner reminder, verify, push, merge and deploy.

Plan:
1. Add a bounded read-only contract-price GET; no mint authorization, signing key, wallet/account reads, room writes or polling.
2. Show a wallet-gated reminder only in Browse for the selected published, uncollected room’s claimer. Expanded wording applies to this cell. Open the existing editor; existing explicit prepare, cost consent and wallet approval remain authoritative.
3. Verify real native Worker/RPC reads, failure/network/privacy bounds, owner eligibility, gate cancellation, device UI, existing wallet consent/recovery and gameplay; run full quality and OSS checks.
4. Push a focused PR, accept source/main CI and previews, guarded API+Pages release and custom-domain/code/price proof; record delivery.

AI generation stays on hold, historical artwork upgrades unsigned, Layers prototype separate. Preserve unrelated primary/mann.cool edits, selected animation, user Chrome/TAS4208 and frozen proof lanes. No production test accounts, plays or transactions.

Status: implementation in progress. F246 remains partial until acceptance.

## Implemented behavior and local acceptance

The reminder sits below the existing room actions so Play Room remains first. Only a wallet-present, signed-in current claimer viewing a published, uncollected public-world cell sees it. It distinguishes one Expanded cell from the whole room and uses the real configured contract price/network, with fees and final editor confirmation explicit. An unavailable quote never substitutes a guessed value.

The credential-free GET `/api/collections/price` validates its configured network and makes two read-only RPC calls on a cache miss. It has finite waits, zero retries and the shared20-second edge cache, with query parameters rejected. No signer, wallet accounts, mint authorization, room mutation, migration, new polling or recurring work. Existing prepare/consent reads the final price afresh.

The reminder opens the individual selected cell through the existing fresh edit permit, even inside an Expanded Room; normal Edit Expanded Room retains its area-editor route. It does not click the editor’s collection control. Unit coverage preserves permission checks, stale-permit fencing, deduplication and explicit retry intent. Actual desktop/phone checks confirm the collection control is reachable and enabled.

Native Worker/RPC/D1 acceptance passes32 cases, including both supported networks, read-only quotes with unchanged room rows, disabled/missing configuration and mismatched networks. The four-device16-case reminder matrix passes owner price/no-wallet/Expanded/unavailable scenarios, gate loss/return and cell-editor entry; targets are reachable and at least44px. Desktop, narrow-phone and Safari Expanded screenshots inspected. Installed gameplay client movement/jump and wallet gates both pass, with screenshots/state inspected. Test writes/plays/presence/telemetry are intercepted; no real accounts, signatures or transactions.

Safari exposed a same-cell Expanded-membership arrival that restarted the quote. The controller now keeps that in-flight read and updates the cell wording; regression coverage passes. Initial test-helper typing and an incorrect existing Expanded button-label expectation were fixed. One full-suite source audit timed out during overlapping builds; unchanged audit subsequently passed. Raw attempts remain in ignored output/owner-reminder and /tmp logs; no assertions were removed.

Final local `npm run check` passes609 files/5,232 tests, styles/lint/types/DOM/generated bindings/build/assets and660.6KB/670KB startup budget. Staged OSS check has0 blockers/0 warnings. Hosted source/main acceptance, safety and production delivery pending. Source F246 remains partial until release; the local final receipt will record completion and update the master count.
