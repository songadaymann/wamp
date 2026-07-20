# Expanded-room convergence and deletion path

Expanded rooms are the canonical multi-room content model. Course and standalone-room APIs remain compatibility surfaces until the gates below are satisfied; new shared runtime/editor behavior belongs in expanded-room code first.

## Convergence sequence

1. Keep the additive playable-content index as the common discovery/profile projection for standalone and expanded targets.
2. Route new run accounting through target identity (`standalone` or `expanded`) and keep course adapters translating existing payloads without changing public formats.
3. Move shared editor operations into expanded-room commands; course editing calls those commands through an adapter while parity tests compare snapshots and published output.
4. Move room/course run validation behind one target-aware pipeline. Preserve the current anti-cheat traces and response schemas at the adapters.
5. Record adapter traffic and parity failures. A legacy adapter can be deleted only after 30 days with zero parity failures and no unsupported production callers.

## Required deletion gates

- Published snapshot parity for create, draft save, membership change, publish, revert, and unpublish.
- Run-start and run-finish parity, including leaderboard, rating, trophies, progression, and anti-cheat outcomes.
- No discovery/profile duplication or suppression regressions in index repair reports.
- A reversible compatibility release in production before removing database tables or public routes.
- Database/table removal occurs in a later destructive migration, never in the convergence release.

The music editor workflow already present on `origin/main` is shared behavior and must be adapted, not reimplemented.
