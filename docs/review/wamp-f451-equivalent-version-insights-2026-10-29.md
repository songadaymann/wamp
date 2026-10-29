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

CI, merge and live delivery remain pending; F451 is not yet checked off.

## Initial rollout and query-plan correction

PR346 head0f191440 passed all20 checks in CI40960789523 and merged as e49bc683.
Worker1e630c2d and Pages4dadb291 were published; entry/main/editor/CSS release bytes
match wamp.land. Production smoke passes and public API group/comparison data is
correct. Expanded v5 retains5 exact-version attempts; an Explore card's player
count matches Insights. No schema migration or production room/player/email writes.

A subsequent warm Insights timing check took15.97seconds, so delivery remains open.
EXPLAIN shows the initial join scans all selected facts and expands sibling pairs
before filtering requested target keys. Moving the room-id expression onto the
small requested side permits the existing room/version primary key lookup first.
The corrected production D1 summary query reads951rows in7.0137ms, with0rows written.
A query-plan regression test rejects a global selected-facts scan and requires the
room/version lookup. Matching stats/maps/publisher exclusions are preserved.

The initial deployment first stopped before publishing on transient D1 error7403;
read-only listing and migration checks passed, then the guarded retry succeeded.
The corrective PR's final CI and rollout remain pending. Do not mark F451 delivered
until the correction and live latency are verified.
