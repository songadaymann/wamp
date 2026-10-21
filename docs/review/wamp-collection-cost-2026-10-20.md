# F240 — clear collection costs and wallet failures

Canonical branch: `codex/wamp-collection-price-2026-10-20`, from verified main `adb31c8d` with the F244 receipt carried forward. The time-bounded checklist goal is active again; cutoff is October21 at05:00 America/New_York. F244/F237 historical updates remain unsigned and AI generation remains on hold.

## Acceptance plan

- Show the exact prepared collection value and canonical network before opening a wallet. Validate displayed price against the transaction actually sent, and preserve the captured account/room/network.
- Read linked-wallet native balance through a public, wallet-gated, finite and cancellable request. Known insufficient balances offer an explicit balance recheck; unavailable reads are explained honestly. No idle polling, hardcoded USD estimate, fixed gas allowance or new onramp/provider integration.
- Explain the collection network fee and separate artwork transaction/fee. Require separate in-app consent for artwork; its transfer value must be zero. Cancelling consent must not reserve a pending transaction or open a wallet.
- Replace raw developer dumps with actionable rejection, insufficient balance, network-switch, wallet mismatch, price-change/expired-authorization and fallback messages. Offer an explicit retry from a visible dialog when the request is definitely unsent.
- Preserve submitted/unknown intents, finite canonical recovery, Close/Check again, late hashes, reloads and account/signer/room/world fences. No automatic re-prompt, re-send or re-price. Every explicit retry prepares and displays the current cost again.
- Verify pure amount/error boundaries, actual consent controls/focus/Escape/phone fit, cancellation and balance failures, changed prices, all existing collection/ownership/recovery flows, source/main CI and hosted artifacts. Use full guarded delivery only if the actual diff requires the API; otherwise use the documented frontend-only guard. Verify actual-domain runtime and deployed bytes before checking F240.

Reuse the current feedback overlay and extracted room wallet/collection modules. The existing wallet stack and F238 Layers migration remain separate. No real signatures, transactions, production player/account/counter writes, signing keys or private RPC configuration. Preserve dirty primary/mann.cool checkouts, user Chrome/TAS4208 and the selected animated background. Keep previous failures and exact verification provenance.

## Local verification checkpoint

- Full project check passes: 601 test files and 5,095 tests, types, DOM contract, generated Worker types, assets, styles and build. Startup JavaScript is658.6KB Brotli against670KB budget.
- A real viem provider test exposed automatic `wallet_sendTransaction` fallback after an ambiguous/insufficient-funds `eth_sendTransaction` rejection. The extracted guard blocks a second provider send after ambiguous or rejected submissions; an explicit method-not-found/unsupported response may fall back to the supported namespace without a second intent, after another cancellation check; known pre-submission rejections can be retried only through fresh preparation/consent. Receipt failures remain outside that classification.
- Desktop and320px phone consent, funds/price retries and separate artwork cancellation pass actual-control checks. Cost and failure captures were opened and inspected. A touch-hover rule erased the retry background; excluding the two busy-dialog actions preserves their reviewed colors, with a computed-style assertion.
- Preserve earlier development-server fixture failure, provider fallback failure and build-refresh overlap failure. No expected-error suppression or weakened assertions. The full52 cost/100 recovery runs and exact-source/main/hosted/release/live gates remain pending at this checkpoint.
- Installed web-game client runs passed both wallet gates with inspected gameplay captures and no browser-error output. A public dry-run bundle of the API is byte-identical to the preceding production bundle: this is a Pages-only release. No Worker, D1, PartyKit, renderer or room-data delivery.
- Open-source pre-push audit: zero blockers/warnings. No real wallet signatures/transactions or production player/account/counter mutations.


Compatibility review preserved the pre-existing namespace fallback only for explicit JSON-RPC method-not-found (-32601) and method-not-supported (-32004) responses, which prove the first method could not approve a transaction. Invalid-input (-32000), insufficient-funds, user rejection, disconnects and other uncertain results cannot trigger another native send. Real-viem tests cover both safe fallbacks and cancellation before fallback; no second intent callback is permitted. Source acceptance and hosted proofs must use the final compatibility commit.

Cancellation after an explicitly unsupported first method is classified as known-unsent before fallback, so a context change cannot leave a false pending intent. The sender unwraps this internal guard error before the normal RPC classifiers. Focused103 provider/action/cost/flow tests pass; receipt-failure tests assert error shape rather than module-instance identity across isolated imports. Full final acceptance remains required.
