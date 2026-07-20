# Feature ledger

| Feature | Canonical branch | Status | Deploy URL | Next action |
| --- | --- | --- | --- | --- |
| Performance and code health | `codex/world-tiles-force-session-hotfix` | Performance/code-health waves are merged; indexed and compact reads are live. Production renderer `production-2026-07-20-box-srgb-b92af8f` is active at a 5% cohort with compact fallback preserved. The forced-QA session override is now sticky across URL rewrites and passed the exact 20-second refresh regression on safety | https://safety-codex-world-tiles-for.wampland.pages.dev | Promote the forced-session hotfix to production, then hold the 5% cohort for at least 24 hours and two clean probe suites before promoting to 25% |
| Music editor workflow | `origin/main` | Already landed; intentionally preserved | Production baseline | Do not reimplement |
| Behavior registry and modal lifecycle foundations | `origin/main` | Already landed; extend incrementally | Production baseline | Reuse for runtime and modal cleanup |
