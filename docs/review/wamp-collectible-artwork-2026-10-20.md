# F244 — collectible artwork and Play Room

## Verified software release — October 20, 2026

[PR #269](https://github.com/songadaymann/wamp/pull/269) is pushed, merged and deployed: source `13b84a152e5d2a0a701d8e11fcc08a0dcc3a650c`, main `adb31c8d673e5f3ac00df0e45f2834e73af3c185`, [immutable Pages9fcad6fe](https://9fcad6fe.wampland.pages.dev) and API `acd77c41-4d14-447f-9caf-34748089dcc1`. The full clean-main API+Pages guard and production smoke exited0. Source and main each pass all16 checks,599 test files/5,062 tests and332 browser cases, including100 interrupted-wallet cases per head. Production boot is657.7KB Brotli under670KB.

The live public viewer has native room detail, WAMP styling, canonical Play Room links and wallet-gated finite owner reads. New artwork uses strict embedded PNG/SVG and a conservative20,000-character complete-URI budget; eight current proposals gain room-image detail, and three retain80×44 sampling with sharp640×352 display. Existing stored NFT images, descriptions and marketplace back-links only change when the11 separately proposed owner transactions are approved and executed. F244/F237 remain unchecked; this is a completed software release, with historic on-chain repairs still pending.

The exact-source preview matches210 main files and its31-file public-entry graph;56 hosted public cases,36 hosted recovery cases and4 actual-chain read pages pass. Actual-domain verification passes56 public cases,12 recovery cases and4 real-chain read pages across the relevant desktop/phone/WebKit/tablet profiles. All61 selected assets and the31-file public-entry graph match both the custom and immutable domains. All3 Worker script hashes and100% deployment identities match the tested bundles; renderer/map remain b7d33c00/099b18fd. Real read-only startup executes the final main assets without errors. Final installed-client movement/jump and both wallet-gate states pass against the production build; current gameplay and real phone-preview captures were inspected. All22 Chrome/WebKit SVG-to-PNG comparisons have zero differing channels. No production player/account/counter mutation, signature or wallet transaction occurred.

Retain the first live Safari recovery failure: the flow completed, with no page errors or unexpected requests, but640 console diagnostics came from a Cloudflare report-only resource-monitoring policy. Cloudflare documents that this [monitoring header is sampled](https://developers.cloudflare.com/client-side-security/reference/csp-header/). The full unchanged12-case recheck passes with response-header diagnostics; none of those12 navigations received the sampled policy. No application code, console-error assertion, security header or production monitoring setting was changed to obtain that result. Both the failed run and successful recheck are retained; this release does not claim to fix Cloudflare's separate monitoring diagnostics.

The11 final unsigned transactions simulate successfully within the observed gas cap, with a captured total fee estimate of0.000442025990329906ETH including L1 data fees. All owner/mapping/URI/published-snapshot state and fees must be rechecked before any human approval or execution. Signing keys and private RPC configuration were not read. The earlier fractional-sampling proposals are superseded, not execution candidates.

The authoring catalog remains authoring-catalog-v1:770f6454b93f4f5f, with unchanged active imagery; no renderer activation/backfill was performed. Existing map-timing, native Safari teardown and physical-iOS follow-ups stay open. AI generation stays on hold and all other declined/decision-gated work, dirty primary/mann.cool files, selected animation and user Chrome/TAS4208 are preserved. Master174/216. The October21 05:00 America/New_York cutoff audit remains armed; the goal panel still reports Paused and requires its human Resume control for automatic continuation. This final receipt is a local documentation checkpoint for the next checklist PR; application code is already merged and deployed.


## Implementation checkpoint (superseded by the release receipt)

Canonical branch: `codex/wamp-room-artwork-2026-10-20`, based on verified main `254eea33` plus its local F239 receipt. Software verification and release are in progress. F244 and F237 remain unchecked until their historical on-chain repairs are separately approved and executed. No owner wallet is accessed, no signing key is read, and no transaction is signed or submitted.

The public preview has a prominent canonical Play Room link, native 640×352 room rendering, WAMP paper/ink styling and responsive details. Owner reads/details require the installed-wallet gate; art and play stay public. Owner failures do not block the preview, and finite reads are fenced across gate changes and page suspension/return. Malformed token IDs fail before contract reads. New metadata includes `external_url` pointing to `https://wamp.land/r/{x}/{y}`; parsed legacy or untrusted metadata derives this link from validated signed-int32 room coordinates rather than trusting a supplied URL.

## Artwork budget and fidelity

Strict 2/4/6/8/16-pixel-per-tile rendering was compared across all 11 current published rooms. Native 640×352 PNG metadata reached 131,881 characters and exceeded the API's 100,000-character limit for two rooms. Even 160×88/240×132/320×176 alternatives exceeded Base's 16,777,216 transaction gas ceiling in public unsigned estimates for the largest blank token. The public RPC's `eth_txGasLimitCap` method was unavailable (HTTP401); exact `eth_estimateGas` failures explicitly reported that ceiling. No transaction was attempted. [EIP-7825](https://eips.ethereum.org/EIPS/eip-7825) describes the cap; the RPC estimates establish the observed constraint here.

The builder renders strict assets at 16,8,4,2 pixels per tile and selects the highest fitting complete metadata URI within 20,000 characters. Power-of-two sampling scales evenly to 640×352. An embedded SVG wraps the PNG with explicit 640×352 dimensions and pixelated rendering; no remote artwork, lossy compression, text-card fallback or omitted room content is used. Oversized artwork metadata fails before its artwork wallet request. The existing strict renderer still fails if an asset is missing.

All 11 final proposals render at 640×352 with zero differing RGBA channels against their PNG scaled with nearest-neighbor sampling. Their underlying PNG widths are 160,80,160,320,80,160,160,320,80,160,160 pixels in token order. Thus eight gain image detail; tokens2,5,9 retain 80×44 sampling with sharp display scaling to remain within the storage budget. The public viewer independently renders all valid embedded rooms at native resolution.

## Historical upgrade proposals — unsigned

Fresh public reads pin the contract owner, consecutive token enumeration1–11/first missing12, all token-to-room mappings, original URI hashes and the current published snapshots. Every exact unsigned `setRoomTokenURI` proposal succeeds in public simulation and fits the observed transaction cap. Initial proposals using fractional sampling are retained as superseded evidence; only `output/f244-artwork-2026-10-20/unsigned/` is the final proposal set.

Final point-in-time execution plus oracle L1 data fees total **0.000442025990329906 ETH** for 11 separate zero-value transactions. Operator fee parameters were both zero at the pinned simulation block. This is an estimate, not permission to spend or a current guaranteed quote. Revalidate owner, mappings, URI/snapshot hashes, exact calldata and all fees before requesting approval for execution. Keep full calldata, public owner records and raw snapshots in ignored output, outside Git.

## Verification and release gates

- Focused metadata, artwork-budget, strict-asset failure and existing mint/recovery tests:46 passing tests initially.
- Final full quality check:599 files/5,062 tests; style/lint/type/DOM/generated bindings/build/assets pass; boot657.7KB Brotli/670KB.
- Public viewer, actual Play Room navigation, malformed identities, owner failures, gate enable/disable races and page suspension/return:56 cases pass across desktop,320px phone,WebKit phone and tablet.
- Installed game-client gate0/1 movement/jump runs pass; latest gameplay/menu captures and text states inspected.
- Exact-source/main CI, immutable preview, existing artwork/ownership/recovery regressions, guarded release and custom-domain proof remain required.

Authoring catalog remains `authoring-catalog-v1:770f6454b93f4f5f`; strict compatibility passes. This changes shared metadata parsing consumed by the API, so use the full clean-main API+Pages release. No new renderer, map backfill or map activation is needed for the unchanged catalog. Preserve existing full-map timing/F089/physical-iOS follow-ups without claiming them fixed.

AI generation F167 remains on hold. Preserve declined F061/F118, F145/F243 decision gates, the selected animated background, dirty primary/mann.cool checkouts and the user's Chrome/TAS4208. The October21 05:00 America/New_York cutoff audit is active. The goal panel still reports Paused; its Resume control must restore automatic continuation.
