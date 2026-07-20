# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/performance-code-health-2026-07-17` | Original waves, leaderboard follow-up, selective reads, and the tile-pyramid browse cutover are safety-deployed; exact D1/R2 parity, two full probes, manual QA, and an ordinary-URL smoke pass with the tiled rollout at 100% | https://safety-preview.wampland.pages.dev | Soak safety at 100% with compact fallback, then provision and verify production prerequisites before the guarded 5% cohort; production compact/tiled flags remain off |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
