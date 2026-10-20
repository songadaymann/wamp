# F036: personalized discovery with shared public inputs

Base: delivered PR239/main `b2a6447b`. Branch `codex/wamp-personal-discovery-cache-2026-10-18`.

## Behavior

Room discovery now shares only public input data for 20 seconds across authenticated and anonymous requests: indexed candidate pages, their public enrichment, and the complete public candidate pool used by legacy/personal sorts. Authentication and token scopes are checked first; personal sorts still require sign-in. Credential-free keys hash the public read kind/parameters plus index/Expanded Room/World feature flags. Packages over 4 MiB bypass storage and preserve the existing fresh path; missing/disabled index results are not cached.

Private run/rating history is always queried separately. Unvisited, unbeaten and unrated filters still run before sorting and pagination; unrated totals count the full filtered set and exclude the builder. Current room versions, Expanded Room assembly versions, legacy grouping and historical-state rules are preserved. Only metrics matching public candidate versions enter the public package. Insights, co-op flags and legacy Expanded Room trophy enrichment keep their existing fresh path. This does not change world visibility or introduce private/school policies.

Personalized responses are private/no-store. Browser discovery calls bypass both memory and HTTP caching, so a request after an account switch cannot reuse the previous user's viewer states. Saved runs, room ratings/difficulty votes and Room Rush writes also bypass the public discovery cache for 20 seconds; explicit API `fresh=1` bypasses reads and writes. No schema or visual changes are required.

Private history queries and their key/state helpers were extracted verbatim into `discoveryViewerStates.ts`, reducing the mixed difficulty module. No verification acceptance or history semantics change.

## Verification

- 32 focused checks pass, including real migrated DB/cache/auth cases for independent viewers, private-state exclusion, warm history changes, filter-before-page behavior, unrated counts/owner exclusion, current/Expanded versions, feature partitions, auth/CORS/cursor rejection, expiry, oversize bypass, and the optional-index-metrics fallback.
- 504 frozen comparisons against delivered main cover every sort, three viewer states, two difficulty filters, pages, index on/off and Expanded Rooms on/off. The extracted private history block is byte-identical after removing export keywords. In the same local fixture, warm personal discovery uses 7 DB queries versus 20 originally; an indexed public-page overlay uses 6 versus 10. These are local query counts, not production latency claims.
- Three native recorded production-build profiles (desktop Chrome, phone Chrome, phone WebKit) exercise history filters, repeated Newest reads and difficulty changes with zero application errors/fixture misses; screenshots are inspected. Four maintained phone/narrow navigation cases across Chromium/WebKit now require actual requests through personal filters and a repeated public sort. The installed web-game client passes two movement/jump iterations with inspected screenshots/text and no errors.
- Twelve actual-domain baseline checks pass, including separate users, neutral guest state, auth/scope/cursor rejection and CORS. The first remote setup command failed before any cases; cleanup showed zero owned rows. A read check and retry succeeded without credential changes. Both accepted temporary users and all owned sessions/token are removed; no runs, plays, ratings or point events are added.

A first full local quality run passes 532 files/3,919 tests; final full quality is running after tightening cached run metrics to public candidate versions. Typechecking caught an overly narrow inferred Map key type; its explicit string key type fixes that without changing runtime behavior. Exact-source/main hosted gates and guarded API+Pages release/live proof follow. Final accepted delivery results belong in the PR receipt and supersede these source-time pending notes.

F036 completes the corrected public-base caching target; master 157/215. Weekly standings, private summaries and deferred decision-gated work stay outside this change. Primary dirty files, the selected animation and the closed overnight run remain preserved. Diagnostics stay ignored under `output/f036-discovery-2026-10-18/`.
