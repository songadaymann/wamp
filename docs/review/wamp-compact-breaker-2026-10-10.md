# F030 compact world breaker

Delivered 2026-10-10 in [PR #116](https://github.com/songadaymann/wamp/pull/116), merge `5ef28c36`; frontend through the Pages auto-build, API Worker `8ba8d713` deployed with the release check, build and production smoke passing.

## Behavior

- The session-wide switch to legacy chunks trips only on a 404, which the server returns when compact reads are disabled.
- A 5xx or network error loads that one window from legacy chunks so the world still appears; the next refresh (8 s in play, 15 s in browse) tries compact reads again, so a session that fell back recovers.
- A failed snapshot query no longer touches the switch.
- `/api/world/chunks` (legacy) uses the same 20 s anonymous edge cache and `Cache-Control` as the compact route; signed-in reads stay private.

## Evidence

- `npm run check` on Node 22: 422 files, 3,342 tests. `worldRepository.compact.test.ts`: 503 and network errors retried, 404 switches once, snapshot-query failure leaves compact on (two of three fail against the previous code).
- Browser (local dev server, safety API) with one injected 503 on the compact route: `summary:503`, `legacy:200` for that window, then `summary:200` at 4 s, 19 s and 34 s; world rendered; no page errors.
- Production after deploy: the second anonymous `/api/world/chunks` request is an edge cache hit.

## Found while verifying

Cache hits on every route using the anonymous edge cache (compact world summaries, leaderboards, legacy chunks) return `Cache-Control: public, max-age=14400` instead of the stored `max-age=20`, so browsers may keep them for hours. Tracked as a follow-up.

## Left

Retiring or capping the legacy route, fallback telemetry, and caching `/api/dashboard/stats`.
