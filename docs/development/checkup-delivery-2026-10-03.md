# WAMP checkup delivery: F014, F032, F027, then F057

Requested work: implement the Android download, API preflight cache, and publisher-index fixes with independent agents, then protect expanded-room edits against tab loss. Base: `008de53c` from freshly fetched `origin/main`. The dirty primary checkout is preserved.

## Plan

- [x] F014: preserve desktop/iOS download concurrency and raise Android's limit; verify cold-cache Android startup.
- [x] F032: cache API preflights while preserving the existing origin policy; verify Worker responses.
- [x] F027: add the missing publisher index using the next free migration number; verify migration replay and query plans locally.
- [x] Review and integrate the three commits, then run the combined repository checks.
- [x] F057: persist expanded-room cell edits and expanded-room settings locally without clearing dirty state; recover them when reopening the editor.
- [x] F057: flush backups on page lifecycle events and warn about unsaved work in both editors; test reload, failed storage, save, and scene transitions.
- [x] Final verification and implementation commits. Checklist items stay unticked until shipped.
- [x] Push the branch and open [draft PR #33](https://github.com/songadaymann/wamp/pull/33) for review.

## Verification notes

Use the detailed checkup's corrections rather than the original proposed fixes. In particular, expanded-room backup must not use `saveSlicesLocally`, which clears dirty flags and reapplies runtime snapshots.

- First-three integration commits: `1f53680b` (F032), `8faa819e` (F027), `5559f10e` (F014). Worker tests: 3 files / 10 passed. Local D1 accepts all 53 migrations; publisher counts use the covering index. Android/iOS/desktop profiles and portrait/landscape browse smoke pass. One cache-disabled emulated Android comparison (150ms latency, 4Mbps) measured asset preload at 19.58s before and 14.96s after; this is a controlled local sample, not a production benchmark.
- F057 stores cell snapshots and expanded-room settings in independent account/guest/course/coordinate keys, with the original remote baseline. Divergent account drafts require an explicit Restore Local or Use Account Draft choice. Recovery retains dirty state, and successful Save clears only the saved revision; newer in-flight edits are rebased and kept. Reverted settings invalidate the owned obsolete backup, and quota failures remain visible.
- The standard editor uses a synchronous lifecycle backup preserving its existing local history. Intentional blank edits recover correctly; delayed Save/Publish responses preserve later title and terrain edits. Shutdown and Test transitions flush before runtime teardown/sleep.
- Browser regression command: `VITE_ENABLE_TEST_RESET=1 VITE_ROOM_API_BASE_URL=https://api.wamp.land npm run dev -- --port 3017 --host 127.0.0.1 --open false`, then `npm run smoke:draft-recovery`. The probe blocks account/room writes and uses synthetic fixtures. Desktop 1440x900 and Android 390x844 pass reload, two-cell terrain/title/setup/goal recovery, partial saves, edits during Save, immediate Save, reverted settings, quota warning, and divergent remote recovery. Ignored evidence is in `output/web-game/draft-recovery/`; screenshots were visually inspected.
- The official game client captured healthy Browse state/screenshots, and the DOM contract passed 787 IDs / 159 required IDs. Full combined repository checks passed 271 files / 2,003 tests, ESLint, TypeScript, generated bindings, and the production build. The final synthetic probe passed 16 scenarios with no page errors or blocked account/room write attempts; it also covers setup handoff with a last-second edit and a delayed multi-cell Save finishing after teardown.
- Browser QA exposed Phaser's display-list destruction before custom SHUTDOWN handlers. Authored exits now flush before stopping/sleeping, shutdown cancels pending cell serialization and only flushes surviving metadata, and delayed Save loops verify workspace membership before and after awaits. Source commits: expanded recovery `6baeb7aa` with review follow-ups; standard lifecycle/in-flight preservation `df787529`; final teardown and transition proof `ee58cacd`.
- [x] Production delivery authorized and complete: PR #33 merged as `8a844ada`; migration 0050 applied; Worker `61393dbf-a3bc-4a66-8534-6819f18c8815` and Pages `ef80fd8e` deployed from clean literal main. Production smoke, live D1 index/query plan, Max-Age 7200/credentialed origin policy, and byte-for-byte custom-domain/immutable Pages entry, runtime, editor and shared-state bundle parity pass. Desktop and Android Browse report healthy graphics with zero console/page errors; screenshots inspected. The official client also captured healthy Browse with Welcome retained after an early close-click timeout. No PartyKit, room-data, or immutable renderer deployment was needed.
- Release evidence: `/tmp/wamp-prod-deploy.log`, `/tmp/wamp-prod-index-proof.json`, `/tmp/wamp-checkup-live-proof.json`, and ignored `output/web-game/checkup-live/` in `/tmp/wamp-checkup-production-20261003`. The old Wrangler 4.71.0 D1 query returned 7403; current 4.147.0 applied the only pending migration successfully.
- Next recommended batch: F010 before/with F003. Live `/api/world/tiles/config` remains unavailable: active contract `authoring-catalog-v1:4b122cb7accc8026`, expected `authoring-catalog-v1:d9d6c8cf7dbb63c3`. Next after the map: F002 plus F138, following their fact-check corrections.
