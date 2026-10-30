# F451 — matching-version insights and layout comparisons

## Behavior

Ordinary room insights now use the existing leaderboard fingerprint. Unchanged,
title/music-only publishes and reverts keep matching attempts, distinct players,
clear rates, medians and death locations. Each attempt still excludes its own
version publisher and existing generated-user exclusions. Profile and Explore
headlines use the same grouping. Expanded Rooms retain exact-version statistics.

The Insights panel compares the selected version group with the most recent earlier
different layout. Desktop shows two columns; phone stacks them. Builders can switch
the editor death map between those groups, with the chosen version shown in the
legend and coverage text. Closing/reopening preserves the chosen map; editor
identity/lifetime changes clear it. Public profile panels cannot enable editor maps.

Facts are lazy, so cold reads fill missing/stale compact fingerprints using bounded
metadata pages and four snapshot readers. Cache writes preserve the real weighted
change from the immediate predecessor. Invalid snapshots fall back to exact counts;
malformed cached JSON cannot create equivalence. No schema migration is required.
The existing fingerprint includes all tile layers and goal intro; this change does
not broaden the leaderboard definition of equivalence.

## Verification before PR

- Full check: 734 files, 6,222 tests pass, one existing expected failure and two skips;
  lint, dead-code, types, DOM, generated bindings, build and asset checks pass.
- Boot JavaScript 669.0 KB brotli, within the unchanged 670 KB budget.
- Targeted 25 tests cover cold/warm facts, stale/malformed hashes, tile changes,
  reverts, per-version publisher exclusions, group medians, independent death maps,
  bounded 45-room pages, Expanded exact versions and UI lifetime/map behavior.
- Native workerd/D1 returns v3 attempts=1/median=9s and previous v1+v2
  attempts=2/median=2s, with separate death locations. Real desktop and phone browsers
  open Room → Insights, render both groups, switch maps, retain the map on reopen,
  trap keyboard focus and close with Escape; zero page errors. Screenshots inspected.
- Worker safety and strict immutable world-map asset guards pass.
- No production room/player writes or email tests. Native outbound network disabled.

Evidence: `/tmp/wamp-f451-check.log`, `/tmp/wamp-f451-expanded-tests.log`,
`/tmp/wamp-f451-native.log`, `/tmp/wamp-f451-worker-safety.log`,
`/tmp/wamp-f451-map-guard.log`, ignored `output/f451-native/`.

This was the pre-PR verification boundary; final delivery is recorded below.

## Initial rollout and query-plan correction

PR346 head0f191440 passed all20 checks in CI40960789523 and merged as e49bc683.
Worker1e630c2d and Pages4dadb291 were published; entry/main/editor/CSS release bytes
match wamp.land. Production smoke passes and public API group/comparison data is
correct. Expanded v5 retains5 exact-version attempts; an Explore card's player
count matches Insights. No schema migration or production room/player/email writes.

A subsequent warm Insights timing check took15.97seconds, so delivery was held open.
EXPLAIN shows the initial join scans all selected facts and expands sibling pairs
before filtering requested target keys. Moving the room-id expression onto the
small requested side permits the existing room/version primary key lookup first.
The corrected production D1 summary query reads951rows in7.0137ms, with0rows written.
A query-plan regression test rejects a global selected-facts scan and requires the
room/version lookup. Matching stats/maps/publisher exclusions are preserved.

The initial deployment first stopped before publishing on transient D1 error7403;
read-only listing and migration checks passed, then the guarded retry succeeded.
The prior Worker0bada192 was restored at100% while the correction passed CI;
the same read returned200 in0.358s. No bound resource rollback was required.

## Final delivery

PR347 testedheadb122b1ad passed all20 checks in CI40963553664 and merged as
24c6e51a. The final local check passes734files/6223tests, one existing expected
failure/two skips, every lint/type/DOM/generated-binding/build/asset stage and
669.0KB/670KB boot budget. The query-plan regression requires the selected
room/version primary-key lookup. Native workerd/D1 verifies215cold versions
and214matching versions plus the prior changed layout.

Guarded release from clean main24c6e51a passed migration/map guards and production
smoke. MainDB remains0077 and jam0003; no F451 migration. Worker
605d12f7-4982-40a2-92de-503041b553bf is confirmed at100%. Pages7dc29d78,
entrymain-C3yUjQpL.js, runtime, both editors and styles match release bytes.

Final public API verification confirms:

- Room2,1 v215 retains45attempts and compares against v214's matching group
  [9,11,201,211,214]. Three uncached warm reads:566/284/240ms.
- Room0,0 v176 retains6571attempts across [174,175,176] and compares against
  [172,173]. Three uncached warm reads:567/1017/492ms.
- Expanded v5 retains5exact-version attempts, with no lineage comparison.
- An Explore card's player count matches its Insights summary.

These are observed samples, not a latency guarantee. Final aggregation exposes
no player identities. No production room/player writes or live email tests.
Evidence: `/tmp/wamp-f451-query-check.log`, `/tmp/wamp-f451-query-native.log`,
`/tmp/wamp-f451-query-summary-fixed.json`, `/tmp/wamp-f451-rollback.log`,
`/tmp/wamp-f451-indexed-deploy.log`, `/tmp/wamp-f451-final-api.json`,
`/tmp/wamp-f451-live-assets.json`, `/tmp/wamp-f451-final-deployments.json`,
`/tmp/wamp-f451-final-pages.json`. F451 is delivered; the full goal continues.
