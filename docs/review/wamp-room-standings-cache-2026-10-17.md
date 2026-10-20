# F036: shared room standings with fresh private results

Base: delivered PR238/main `e7d41b5c`. Branch `codex/wamp-room-standings-cache-2026-10-17`.

## Behavior

The public top list for a published WAMP 0 room is shared for 20 seconds across guests and signed-in players. Only public standings enter that cache. Every request still authenticates, checks token scope, loads the current room/access context and resolves its selected version lineage. Ratings, trophies, personal votes and current voting eligibility remain fresh; they load in parallel with standings. Signed-in responses are private/no-store and are never written into the shared cache. Non-prime Worlds bypass this cache, preserving the boundary for future private/school work.

Cache keys are credential-free, bounded SHA-256 signatures of the actual selected room, leaderboard family, goal/ranking policy and requested limit. Changes to publication/family/policy take effect immediately, without waiting for the previous key to expire. Titles and version options remain fresh independently of standings.

A fresh personal best query counts distinct players with any accepted run ahead of the viewer's best. It preserves time, score and protect ordering, all tie-breakers, retries, historical families, verification acceptance and generated-user exclusion, without materializing the full window ranking. If a listed player's result/rank changes, disappears, or a previously off-list player enters the list, the response rebuilds the complete standings. Off-list personal bests/ranks remain fresh. Existing post-run/rating/Room Rush `fresh=1` behavior bypasses both cache reads and writes. Missing cache support retains the original fresh path. No migrations or client/UI changes are required.

F036 remains **partial**, master **156/215**: personalized discovery/filter handling remains. Public builder/profile lists and lifetime global standings are already delivered (PR237/238). The selected animated background, primary dirty checkouts and decision-gated work remain preserved.

## Verification

- 39 focused checks pass, including 315 exact private-vs-full ranking comparisons across time, score and protect goals, retries/ties, 101 historical versions, generated/verification exclusions and absent players. Real migrated SQLite/auth/cache cases cover separate viewers, ratings and voting eligibility changing under warm hits, changed results/ranks, cache-unavailable behavior, family changes, withdrawn publication, CORS and invalid/limited tokens. Non-prime World bypass has a separate route regression.
- A local 3,000-player / 9,000-run query probe matches nine full-query results. Seven-sample medians are 3.80–11.98 ms for the private lookup versus 25.03–43.92 ms for the full window query. These are local SQL timings, not production/network claims. Query plans use existing room-run indexes; no schema migration is required.
- Three recorded native production-UI cases (desktop Chrome, phone Chrome, phone WebKit) verify personal standings, rating selections, Start/Stop and close/reopen with zero application errors/fixture misses; screenshots are inspected. The installed web-game client passes two movement/jump iterations with inspected screenshots/text and no errors. The initial synthetic board omitted its signed-in rating flag; final accepted fixtures include it and are retained separately.
- Eight actual-domain baseline checks confirm the former signed-in bypass, separate private eligibility, guest neutrality, CORS and token rejection. Both temporary principals and their sessions/token were removed with zero-row proof. No plays, runs, ratings or point events were added.

Full local quality, exact-source/main hosted gates and guarded API+Pages delivery are pending. The first local full check was stopped only to run the finalized parallel-read/projected-column implementation from the start; it was not used as release evidence. Final delivery results belong in the PR receipt.

Ignored diagnostics: `output/f036-room-2026-10-17/`.
