# F185 and F192

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F185 client error reports and safe 500 replies (also F071) | [#139](https://github.com/songadaymann/wamp/pull/139) | `22c237a8` | API Worker `12c631b5`; Pages (loader `main-DJo4pM17.js`) |
| F192 `/api/health` checks the database | [#139](https://github.com/songadaymann/wamp/pull/139) | `22c237a8` | API Worker `12c631b5` |

## F185
Errors on players' devices only reached their own browser console. They are now sent home, redacted and rate-limited, and show up in Workers Logs as `client_error` lines (search for `"kind":"client_error"`). Server errors that escape a route are logged as `api_error` with the route and request id. Players see "Something went wrong on our side. Reference: …" instead of raw database text, and the reference matches the log line.

## F192
`/api/health` used to answer OK without checking anything. It now checks that the database answers and has every migration the code expects, and returns 503 otherwise. That catches a Worker deployed before its migrations. It also reports the world-tile outbox backlog. The post-deploy smoke test requires the database check.

## Evidence
- `npm run check` on Node 22: 434 files, 3,387 tests. New `ops/ops.test.ts` and `clientErrorReporter.test.ts`.
- Production health: database ok, latest applied `0064_room_version_facts.sql` = expected, outbox pending 0. `node scripts/smoke_prod.mjs` passes.
- Production client report: a test report with an email and a query string returned 204 and appeared in `wrangler tail` with the email replaced by `[email]` and the query string removed.
- The client reporter (`/api/client-errors`) is in the live `main-DxfimASP.js`.

## Left
- An outside uptime monitor on `https://wamp.land/api/health` and `https://wamp.land/` (needs your account).
- The hourly alert digest email; the user id in error logs; an admin view of top client errors; a PartyKit probe.
