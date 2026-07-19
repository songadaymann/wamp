# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/performance-code-health-2026-07-17` | Original waves, leaderboard follow-up, and selective reads are safety-deployed; tile-pyramid contracts and the disabled Wave 2 D1/R2/Queue API foundation are safety-deployed with controlled fallback behavior | https://everybodys-platformer-safety.novox-robot.workers.dev | Deploy the isolated safety renderer, backfill an inactive version, verify parity, then enable shadow mode; production compact/tiled flags remain off |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
