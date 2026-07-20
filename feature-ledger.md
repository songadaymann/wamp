# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `main` | Performance/code-health waves are merged; indexed and compact reads are live. Production renderer `production-2026-07-20-box-srgb-b92af8f` is active at a 5% cohort with compact fallback preserved. Forced-QA rollout state is page-session-sticky across URL rewrites, and Pages rejects cacheable HTML fallbacks under hashed asset URLs | https://wamp.land | Verify the production forced-session refresh probe, then hold the 5% cohort for at least 24 hours and two clean probe suites before promoting to 25% |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
