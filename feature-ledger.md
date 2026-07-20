# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/performance-code-health-2026-07-17` | Original waves, leaderboard follow-up, selective reads, and the tile-pyramid browse cutover are safety-deployed; rapid zoom-out is fixed and coarse parent tiles now preserve representative room colors, both live-verified at 100% tiled rollout | https://safety-preview.wampland.pages.dev | User-test the fully zoomed-out colors on safety, then continue the 100% soak before provisioning and verifying production prerequisites; production compact/tiled flags remain off |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
