# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/performance-code-health-2026-07-17` | Original waves, leaderboard follow-up, and selective reads are safety-deployed; tile-pyramid Wave 3 is active on safety with exact 637-row D1/R2 parity while public tiled reads and rollout remain disabled | https://everybodys-platformer-safety.novox-robot.workers.dev | Finish the hardened shadow client, enable safety manifest reads at 0% rollout, run parity/performance probes, then cut over safety; production compact/tiled flags remain off |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
