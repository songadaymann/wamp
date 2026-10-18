# Cloudflare presence: idle fixes and pre-deployment verification

**October 18, 2026: sleep and cost fixes verified locally. Deployment remains on hold.** The migration and these changes have not been pushed, merged or deployed. This receipt supersedes the earlier failed visible-idle audit; F037 delivery remains incomplete and F250 remains open.

## Changes

- Presence metrics use a persisted alarm every minute instead of a repeating JavaScript interval. Joins, room/mode changes and departures retain three-second coalescing. The final departure reports zero and removes the metrics row; empty shards do not re-arm an alarm.
- Idle player positions refresh in shared 12-second windows rather than every five seconds. Shared windows group stationary updates so clients can let a shard sleep together. Movement retains its 200 ms throttle, PvP movement its 25 ms throttle, and room/mode/action changes publish immediately.
- A completely silent client was rejected during verification: existing ghosts, rosters and cooperative plates expire after 15 seconds. The final cadence preserves that expiry and keeps stationary helpers valid. This is deliberately a sparse refresh, not a promise of zero idle messages.
- Worker log sampling is configured at 1%, including the API because sampling is Worker-wide. Existing tracing stays at 5%. This configuration was validated locally; production log ingestion has not been measured.
- The Cloudflare adapter uses native hibernating sockets, socket attachments and the existing signed-identity application core. Bounded background preview/metrics work uses the Durable Object event lifetime, and internal metrics response bodies are drained. No secrets or canonical room/run/leaderboard data moved.

Cloudflare stops charging duration once an object is eligible to hibernate, including before eviction. Stored alarms allow it to sleep between brief events. [Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Verification

- Full checks: **535 files / 3,959 tests**, lint, typecheck, DOM contract, generated bindings, production frontend build, size and asset checks pass. The focused presence/controller set passes **123 cases**. Worker build dry run passes; it did not deploy anything.
- Real local workerd recreates all nine subscribed shards while sockets remain connected during the foreground idle window. Actual constructor/instance identifiers establish hibernation beyond simulated rehydration. Empty test shards have no recurring alarms after their bounded departure drain.
- The full game sends **8 idle updates in 95.25 seconds**, with no reconnect or interest-message churn in that window. Before this work it sent 7 updates in 35 seconds (about 19 over a comparable 95 seconds).
- A stationary second player remains rendered and eligible for cooperative plates in all **19 five-second samples**. Its departure removes the ghost promptly. Both the idle screenshot showing the helper and the resumed gameplay screenshot were inspected.
- A real native tab switch backgrounds WAMP. All nine connections close **30,005–30,019 ms** later; there are no frames after the pause. All nine objects are recreated on return, connections restore and movement publishes. Browser errors and fixture misses are zero.
- Cold-start protocol checks retain a stationary ghost, deliver chat after both peers establish room context, preserve near/far interest updates and deliver the final far position (4004). Minute alarms keep online counts accurate beyond two minutes. No live API writes or public fake-player traffic were used.
- The 300-player local probe connects all 300 and sends **12,300 movement messages**, with a successful result. The diagnostic collector remains stable after replacing its initial unbounded snapshot writer with a streaming trace. Earlier writer, cross-socket probe-order and window-visibility diagnostics are retained separately and excluded from acceptance.
- The installed web-game client runs two movement/action iterations with inspected screenshots and no reported application error files. The screenshots show grounded movement; no airborne-jump claim is made.

## Updated cost scenarios

These are hypothetical 30-day paid-plan workloads with the full shared allowances available, **not an account invoice or a spending cap**. All-month means 24 hours/day for 30 days. Nearby players can share shards; saved D1 rooms do not each run a Durable Object. Actual remaining allowances and production traffic were not queried.

The comparison below covers compute and DO requests; the last column is a **minimum** additional write charge. Local alarm/metrics handlers took at most 7 ms in the trace. The ordinary estimate budgets at least 100 ms per handler, and the slower estimate budgets at least 500 ms. Both include 80 ms position-batch tails. A separate JSON scenario includes 1,080 ms far/crowd tails; high latency or other workloads can exceed these assumptions.

| Workload | Previous compute + requests/month | Updated ordinary–slower handlers | Minimum extra writes/month |
| --- | ---: | ---: | ---: |
| No connected players | $0.00 | $0.00–$0.00 | $0.00 |
| 1 stationary tab, 1 hour/day | $0.00 | $0.00–$0.00 | $0.00 |
| 1 stationary tab, 4 hours/day | $12.50 | $0.00–$0.00 | $0.00 |
| 1 stationary tab, all month | $37.65 | $0.00–$0.00 | $0.00 |
| 10 stationary tabs sharing the same 9 shards, all month | $37.65 | $0.00–$0.00 | $0.00 |
| 10 stationary tabs in disjoint areas, all month | $377.25 | $1.05–$13.55 | $0.00 |
| 100 stationary tabs in disjoint areas, all month | $3761.20 | $24.20–$74.20 | $27.76 |
| 100 moving players sharing 9 shards, 1 hour/day | $0.30 | $0.30–$0.30 | $0.00 |
| 300 moving players sharing 9 shards, 1 hour/day | $1.20 | $1.20–$1.20 | $0.00 |

Each occupied shard now makes one alarm invocation and one metrics post per minute; previously it made four metrics posts per minute. Alarms and metrics KV writes count separately. The 100-disjoint-idle-tab example projects at least 77.76 million writes/month, including about $27.76 beyond the full write allowance, before metadata/index amplification.

Rates and official request/compute rounding come from [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Logs are projected at 1% using [Worker/log pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [invocation-log sampling](https://developers.cloudflare.com/workers/observability/logs/workers-logs/). Modeled log charges fit the full included allowance in these examples. Logging prices change December 1, 2026.

Excluded: the existing account-wide $5 minimum; auth/upgrade/session churn and API Worker CPU/requests; SQL read, retained-data and metadata/index charges; editor preview leases; and unrelated account usage. The model records alternatives with no remaining allowances and a far/crowd-tail case. Old cached clients can still send five-second frames until reloaded. Underlying shared allocations or real latency can change the bill.

## Evidence and remaining release work

Ignored evidence: `output/presence-sleep-fix-2026-10-18/` — `summary.json`, `browser-report.json`, `visible-report.json`, `protocol-report.json`, `runtime-events.jsonl`, `final-stats.json`, `costs.json`, `load-300/summary.json`, `check-accepted.log`, `focused-final.log`, `worker-build.log`, and the inspected native/official screenshots. Local workerd uses the installed March 1 compatibility runtime; API configuration remains March 8. Platform billing and production sampling require later live observation.

The selected animation retains SHA-256 `0ef66e862b4a83d5db1df88655a140ba39c5f77858c45ff7eba884bec185ed26`. Unrelated primary checkouts, the user's TAS lab and decision-gated work were left untouched.

Before production delivery, finish any remaining migration-specific real-runtime preview/PvP checks, then the source/main release gates and guarded deployment with actual-domain verification. This request authorized local fixes and verification; it did not lift the deployment hold. The existing PartyKit host and canonical D1 data remain untouched. The old hosted service retirement is documented in the [official migration guide](https://docs.partykit.io/guides/migrate-to-partyserver/).
