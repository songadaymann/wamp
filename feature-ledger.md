# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `main` | Performance/code-health waves are merged; production indexed and compact reads are enabled after a clean 404-target parity backfill. Tile resources and migrations are provisioned, while production tiled reads remain off pending authenticated renderer backfill/activation | https://wamp.land | Complete the guarded production renderer backfill/activation once the production admin credential is available, then start the tiled-overworld `5% -> 25% -> 100%` rollout |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
