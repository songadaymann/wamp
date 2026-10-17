# F036: cached lifetime standings with private viewer reads

Base: delivered PR237/main `ca82016c`. Branch `codex/wamp-personal-global-cache-2026-10-17`.

## Behavior

All-time global standings now share the existing 20-second public cache with authenticated players. Only public entries, period and server time enter that cache; each authenticated response adds a fresh private viewer entry and the player immediately above. Every signed-in response is `private, no-store`, and authentication/token scope checks run before any cache read.

The private lookup uses a primary-key viewer read and the existing `idx_user_stats_total_points` range index for exact rank counting and the preceding player. It preserves all lifetime tie-breakers and both legacy-generated exclusions. It does not materialize the whole ROW_NUMBER ranking. No migration is required.

If a listed viewer's score, rank, statistics or preceding player's gap no longer match the cached list, the route returns a complete fresh snapshot. A newly listed viewer or one immediately below the requested top list also gets a fresh snapshot. Off-list personal scores and ranks are always read fresh. Explicit Refresh bypasses the public cache; the client also bypasses it for 20 seconds after a saved run/rating/Room Rush write. Weekly standings keep their existing fresh single-snapshot path and Monday UTC rollover behavior. Unavailable edge caching falls back to the original single fresh query.

F036 remains **partial**, master **156/215**. Public room leaderboards and personalized discovery/filter handling remain separate. PR237's public builder/profile lists are already delivered. No ranking awards, school policies, saved room formats or visual styles change.

## Verification

- Full local quality: 530 files / 3,887 tests, including 29 focused cases. A legacy optional points field caught by typechecking now uses the required lifetime total. Style/lint/type/DOM/binding/build/budget/assets checks pass.
- The new private query exactly matches the original full-ranking query for 124 viewers covering every tie-breaker, Unicode names, off-list/absent viewers, zero/negative scores and generated exclusions. Real migrated SQLite/auth/cache tests cover independent users, private cache isolation, invalid/limited tokens, CORS, cache-unavailable fallback, changed scores/ranks/neighbors and explicit freshness.
- A separate 6,000-player SQLite probe matches four full-ranking results and confirms indexed range reads. Nine-sample median private lookups are 2.67–6.76 ms versus 16.13–16.80 ms for the full query on this machine; this is a local SQL measurement, not a production/network performance claim.
- Recorded browser navigation cases now click All-time and Refresh and require the actual `fresh=1` request. Three native production-build cases (desktop Chrome, phone Chrome and phone WebKit) verify normal Start/Stop, the visible Refresh request, updated personal points/gap and modal closure with zero application errors or fixture misses; screenshots are inspected. The installed web-game client passes two movement/jump iterations with inspected screenshots/state and no errors. Hosted source/main gates and guarded delivery follow; final results belong in the PR receipt.

Ten actual-domain baseline checks confirm the previous private-cache bypass, isolated viewer ranks, current score reads, CORS, token rejection and fresh weekly behavior. Two temporary bottom-ranked users and all their stats/sessions/token were removed with zero-row proof; no plays or point events were added. Post-release shared-hit, expiry and freshness checks follow. Native diagnostics initially tried a browse-only button while the normal room intro was open; the corrected test uses Start/Stop and supplies the missing neighbor fixtures. This was a test setup correction, with no application error suppression.

The primary dirty checkouts, selected animated background, closed overnight run and decision-gated work remain preserved. Diagnostics stay ignored under `output/f036-global-2026-10-17/`.
