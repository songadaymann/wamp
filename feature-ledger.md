# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/performance-code-health-2026-07-17` | Original waves, leaderboard follow-up, and selective reads are safety-deployed; compact preview batches now merge stably, low-zoom overview payloads are 71% smaller, and the 0.10x zoom regression passes visual/browser verification | https://everybodys-platformer-safety.novox-robot.workers.dev | User-test the stable safety overworld, then promote wave-by-wave with production compact-world flag kept off until the final wave |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
