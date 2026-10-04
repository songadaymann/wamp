# World map alerts and release gate

Jonathan authorized a direct alert and a release check after the F003/F010 recovery. Preserve the dirty primary checkout; implement from current main in the existing managed worktree.

- [x] Make asset compatibility a blocking check before any production deployment and in release validation.
- [x] Send direct failure/recovery alerts with durable deduplication using the existing email service and 15-minute Worker schedule.
- [x] Verify the chosen recipient, alert delivery, retries and the release gate's failure cases.
- [x] Complete checks, merge, deploy and verify production without changing the active renderer or its compatibility guard.

Implementation checks pass: 276 files / 2,060 tests, lint, TypeScript, generated bindings and production build. The 46 new tests exercise mismatch/incomplete readiness blocking, deployment order, outages, recovery, daily reminders, failed delivery, acknowledgement retry, concurrent claims and expired leases. Migration 0051 was the only pending production migration and is now applied. The existing recipient is `jonathan@jonathanmann.net`; live test/deduplication and release verification pass.

Initial live delivery exposed same-zone fetch routing: without `global_fetch_strictly_public`, the check bypassed the API Worker and received HTTP 522 from the unused origin. It sent an initial false outage and labelled setup email. The public map itself stayed available. Enable public routing before claiming live alert verification; retain the real delivery records and verify a healthy recovery/test with no duplicate sends. [Cloudflare routing documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).

Delivered in [PR #35](https://github.com/songadaymann/wamp/pull/35), merge `c9f0a02a`, with the routing correction in [PR #36](https://github.com/songadaymann/wamp/pull/36), merge `3c5bf584`. All PR quality and Pages preview checks passed. Production API Worker `595e5708-5b07-4e31-9bd6-19ca2bb65381` enables public fetch routing and the existing email secret; live Cloudflare settings confirm the 15-minute health schedule and separate hourly maintenance.

Live test `setup-20261004-direct-alert-v2` reports healthy, sends recovery and setup messages, and leaves zero pending alerts. Repeating that id sends zero messages. Both healthy emails are confirmed in the recipient's Gmail inbox at 2026-10-04 01:21:37 UTC. Unauthorized requests and foreign-origin mutations return 403. Public config still reports the original compatible renderer at 100%, with equal active/expected asset fingerprints. Strict release verification also passes the renderer's complete readiness/object report.

Guarded full delivery and corrected Worker-only delivery pass the strict production smoke. After the Git builds completed, the final clean-main Pages refresh (`9ea094ca`, source `4b0a130b`) passed exact custom-domain/immutable HTML entry and six-bundle verification. A later Git build can replace the alias, so subsequent releases must repeat this proof after all builds complete. The scheduled monitor independently advanced its healthy check; an October 4 02:06 UTC read confirms healthy status, the intended recipient and zero pending alerts. The dirty primary checkout, renderer identity and compatibility protection are preserved. F002/F138 remain next; checklist count remains 23/214.
