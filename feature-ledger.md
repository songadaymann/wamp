# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `main` | Performance/code-health waves are merged; indexed and compact reads are live. Production renderer `production-2026-07-20-box-srgb-b92af8f` is active after 462/462 leaf parity, complete ancestor parity, and 669/669 R2 object verification; the tiled overworld is entering its initial 5% cohort with compact fallback preserved | https://wamp.land | Hold the 5% cohort for at least 24 hours and two clean probe suites, then promote to 25%; retain compact fallback through the staged rollout |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
