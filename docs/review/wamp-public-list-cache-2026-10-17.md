# F036: public lists for signed-in browsing

Base main `e493c6e5`; branch `codex/wamp-public-list-cache-2026-10-17`.

## Scope and result

Builder discovery, profile room pages and public profile playlists now share the existing 20-second edge cache for signed-in and anonymous viewers. Their store functions already return viewer-independent public content. Authentication still runs before looking in the cache, and builder discovery still checks token scopes. Public profile playlists retain their existing public-only query; no draft or private content is added.

The existing cache helper creates URL-only GET keys without cookies or authorization headers, strips request-specific CORS before storage and reapplies it for each requesting origin. Filters, pagination and target profile IDs remain separate cache keys. The 20-second lifetime, error handling and cache-unavailable fallback are unchanged.

Self-profile permissions/entitlements, room discovery's personal filters and room/global leaderboards keep their private response handling. F036 is **partial**: splitting those remaining public bases from viewer overlays is a separate step, including immediate freshness after a new record or rating. Master remains **156/215**.

## Verification and delivery

Ten new route/cache regression cases exercise real cache-helper behavior with controlled public loaders: reuse across two signed-in users and an anonymous visitor, credential-free keys, per-request CORS, invalid credentials on warmed entries, insufficient token scopes, independent filters/pages/profiles, failed profile loads and self-profile isolation. Existing cache/CORS/lifetime and fresh-leaderboard tests are included in the 24-case focused run, all passing.

Full local quality passes: 529 test files, 3,874 tests, style/lint/type/DOM checks, generated binding checks, production build/budget and all asset checks. Public-source scan: zero blockers and warnings. Sixteen actual-domain baseline checks confirm signed-in bypasses, request-specific CORS, unchanged public results, invalid-token/scope rejection and private profile summaries; both temporary users, their sessions and limited token were removed with exact zero-row proof. Hosted source/main gates, guarded API-only delivery from clean main and matching post-release cache checks follow. No frontend, schema, PartyKit, ranking or room-data change is needed. The final PR receipt will record the deployed version and live verification. Diagnostic evidence remains ignored under `output/f036-public-lists-2026-10-17/`.

Primary dirty work, the selected animated background and decision-gated work remain preserved.
