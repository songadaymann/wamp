# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `main` | Performance/code-health waves are merged; indexed and compact reads are live. Production renderer `production-2026-07-20-box-srgb-b92af8f` is active at a 25% cohort with compact fallback preserved. The 5% cohort passed renderer/R2 parity, two full browser probe suites, production smoke, and the official web-game client before promotion. Forced-QA rollout state is page-session-sticky across URL rewrites, and Pages rejects cacheable HTML fallbacks under hashed asset URLs | https://wamp.land | Hold the 25% cohort for at least 24 hours and run two clean production probe suites before promoting to 100% |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
