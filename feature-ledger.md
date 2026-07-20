# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `main` | Performance/code-health waves are merged; production indexed and compact reads are enabled after a clean 404-target parity backfill. Production tile resources and migrations are provisioned, and tile generation is being enabled for the authenticated renderer backfill while public tiled reads remain off | https://wamp.land | Backfill, verify, and activate the immutable production renderer, then start the tiled-overworld `5% -> 25% -> 100%` rollout |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
