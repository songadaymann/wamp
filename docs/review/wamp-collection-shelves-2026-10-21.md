# Collector attribution and collection shelves — October 21, 2026

User request: add collector attribution and collection shelves, verify, push, merge and deploy.

Plan:
1. Read-only, bounded collection/attribution API using last recorded ownership; public published rooms only. Preserve original builder and fresh edit authorization. No RPC, polling, schema change, wallet migration or transaction.
2. Wallet-gated collector rows in Explore and builder profiles; clickable collectors open their Collection tab. Profile shelf lists collected cells with original builder, Expanded Room context, Play Room and confirmed collectible links. Paginate; handle loading, empty, retry, transfers and gate changes.
3. Verify unit/native D1/API, public cache/credentials, responsive browser flows and both wallet gates; inspect screenshots and gameplay. Run full quality and OSS checks.
4. Push PR, require exact source/main CI, guarded clean-main API/Pages deploy and targeted actual-domain verification. Preserve unrelated work, background, held AI and unsigned artwork.

Status: implemented and local acceptance in progress.607 files/5,190 tests,14 native API checks and8 desktop/320px phone/WebKit phone/tablet wallet-gate cases pass. Transfers preserve builder credit, partial cells are explicit, pagination/retry/gate loss/profile switching/Play Room are covered. Screenshots inspected. Bound20-second public cache validates credentials before hits; capabilities prevent calling an older API. Shelf previews use the existing public snapshot/render cache; no paid captures or chain calls. F246 remains open for the separate actual-price owner reminder. No production changes yet.

Earlier fixture failures are retained in ignored output: the test initially waited for offscreen lazy credit, then lacked neighbor comments/builder-summary fixtures when Play Room was added. The harness now scrolls actual content and supplies isolated public fixtures. No assertions or app safeguards were removed.

Local acceptance complete: full quality/style/lint/type/generated-binding/build/assets checks passed,607 files/5,190 tests; startup659.3KB Brotli below670KB. Final14 native API and8 device/gate cases pass; native fixtures include complete index memberships. Official two-iteration movement/jump checks pass with both gates and inspected captures. OSS check:0 blockers/0 warnings. Source/main hosted checks and coordinated API/Pages release remain.
