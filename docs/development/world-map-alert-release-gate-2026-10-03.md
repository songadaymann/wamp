# World map alerts and release gate

Jonathan authorized a direct alert and a release check after the F003/F010 recovery. Preserve the dirty primary checkout; implement from current main in the existing managed worktree.

- [x] Make asset compatibility a blocking check before any production deployment and in release validation.
- [x] Send direct failure/recovery alerts with durable deduplication using the existing email service and 15-minute Worker schedule.
- [ ] Verify the chosen recipient, alert delivery, retries and the release gate's failure cases.
- [ ] Complete checks, merge, deploy and verify production without changing the active renderer or its compatibility guard.

Implementation checks pass: 276 files / 2,059 tests, lint, TypeScript, generated bindings and production build. The 45 new tests exercise mismatch/incomplete readiness blocking, deployment order, outages, recovery, daily reminders, failed delivery, acknowledgement retry, concurrent claims and expired leases. Only migration 0051 is pending on production. The existing recipient is `jonathan@jonathanmann.net`; live test/deduplication and release verification remain pending.

Initial live delivery exposed same-zone fetch routing: without `global_fetch_strictly_public`, the check bypassed the API Worker and received HTTP 522 from the unused origin. It sent an initial false outage and labelled setup email. The public map itself stayed available. Enable public routing before claiming live alert verification; retain the real delivery records and verify a healthy recovery/test with no duplicate sends. [Cloudflare routing documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).
