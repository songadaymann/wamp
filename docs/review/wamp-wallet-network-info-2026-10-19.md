# F243: wallet network configuration

Canonical branch: `codex/wamp-wallet-network-info-2026-10-19`, production baseline `adcd47f2`, with the preceding F074-delivery/F145-audit documentation checkpoint `a88bc7f0`. The full checklist goal remains active; F145 still awaits Jonathan's collision/art direction. Preserve the dirty primary/mann.cool checkouts, selected animated background and user TAS lab.

The private review source was successfully read through its browser UI after the web fetch tool could not access it. Its claims are treated as review input and checked against current code; historical production provider credentials were not retrieved or printed.

## Required outcome

1. Mint and metadata prepare responses return only known public Base RPC endpoints for wallet network setup. The server transport remains independent and server-only. Public Base details are verified against [Base documentation](https://docs.base.org/get-started/connect-to-base):8453 uses `https://mainnet.base.org`,84532 uses `https://sepolia.base.org`.
2. Preserve authentication, claim/ownership checks, configured chain/name/explorer, token IDs, exact transaction call data/value, signature inputs, mint price and private server reads. Do not change production chain configuration, mint contracts, prices, wallets or signing keys.
3. Unknown wallet chains fail with a bounded503 before chain reads or signing; no fallback can serialize server configuration. Existing server-only reads remain supported by their original config.
4. Update the shared field documentation, OpenAPI description and development setup. No new binding, variable, dependency or schema migration is required.
5. Verify both response types on both Base networks with a private-URL canary; decode transaction call data; check authentication/ownership denial and unsupported-chain behavior; prove the actual server transport still uses the private endpoint. Run full quality and all exact-source/main hosted gates. Do not weaken existing checks.
6. Push/attach PR, merge and run the normal clean-main API+Pages release (the public OpenAPI document also changes). Verify the actual custom domain, deployed Worker bytes and affected assets/runtime. Keep test writes isolated and submit no wallet transaction.
7. Historical provider-key exposure is conditional and was not established by the review. If a keyed production URL was previously returned, provider-key rotation remains an owner action; do not claim that credentials were rotated or that historical exposure has been disproved.

## Source acceptance

A narrow `mint/walletChainInfo.ts` owner constructs wallet metadata from chain ID/name/explorer only; its input omits the private transport. Both prepare routes use it. The original server transport implementation is untouched. Unknown chains fail closed instead of falling back. Six helper/transport and twelve actual-handler cases are new; all28 focused cases, including the existing confirm and chain-sync suites, pass. Four additional router cases use actual sessions, a fully migrated local SQLite/D1 adapter, ephemeral signing keys and isolated RPC replies on both Base chains and both endpoints. They decode the resulting transactions and confirm no private URL/key appears in JSON; no transaction is submitted. Public endpoints return their expected chain IDs. Full local quality passes563 files/4,703 tests, lint/typecheck, DOM/binding/assets/build gates and startup650.6KB Brotli/670KB. Two installed-client movement/jump iterations run with inspected captures and no browser/HTTP errors. Exact-source/main hosted gates and delivery remain pending. F243 stays open until the release and credential follow-up boundary are accounted for; master remains167/216.

Ignored diagnostics: `output/f243-wallet-network-2026-10-19/`. Current Cloudflare best-practice references and published Workers types5.20261019.1 were retrieved for review; no Worker-specific API or binding type was added.

## Production delivery

PR [258](https://github.com/songadaymann/wamp/pull/258), source `e5ff8f09`, merged main `bdd2c3ee`, is live at [wamp.land](https://wamp.land) and immutable Pages [b65d6ca3](https://b65d6ca3.wampland.pages.dev). All nine checks pass on each exact head; parsed hosted logs prove99 browser cases per head and full4,703 tests. Source preview54d4fc08 passed its matching-asset checks. The clean literal-main full API+Pages guard completed successfully. API Worker `b3ce8a4f-c85e-46c6-931c-f7d9aee4e552` serves100%; its3,484,434 JavaScript bytes exactly match the independently built clean-main Worker (SHA256 `067c75c5bfb65f22669ec291e60cf2825c0bd959bf7e6e6ce457664f9c886acf`). All37 checked assets match on both custom and immutable domains. Live health/comment reads pass and anonymous prepare calls remain401. The actual-domain game starts with the final bundle, zero browser errors and an inspected capture. No transactions, real comments or production credential changes were made.

The technical fix is delivered. Historical keyed-provider use remains unknown; an owner question is pending. F243 remains open only for that conditional follow-up, without claiming key rotation. The full checklist remains active, with F048 proceeding separately. Unrelated checkouts, TAS and selected animation are preserved.
