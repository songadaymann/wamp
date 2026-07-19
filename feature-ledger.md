# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/performance-code-health-2026-07-17` | Original waves, leaderboard follow-up, and selective reads are safety-deployed; batches merge stably, 0.14x-and-below retains compact overview data, and 0.17-0.18x again renders full foreground/object/custom art | https://everybodys-platformer-safety.novox-robot.workers.dev | User-test detailed safety overworld zooms, then promote wave-by-wave with production compact-world flag kept off until the final wave |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
