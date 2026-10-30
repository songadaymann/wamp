# F273: shared progression and rating rules — 2026-10-29

Delivered in [PR #335](https://github.com/songadaymann/wamp/pull/335), squash
merge `229df2c66dfbdc2fb91643190dc30796c9e5341e`.

## Shared behavior

- Room and course-backed Expanded Room finishes delegate their lane awards to
  one progression pipeline. Each adapter retains its rank loader, leaderboard
  family, comparator, reward values and stored identity prefix.
- Both rating submissions share normalization, accepted-clear eligibility,
  first-vote/retry handling, rater and creator rewards, trophies and badge work.
  Storage adapters retain their tables, error labels and response fields. The
  F268 compatibility mirror, bucket identity and canonical trophy handling stay
  intact, including each distinct publisher/owner/rater's badge pass.
- Creator-completion points and ownership/equivalent-version clear scope share
  their respective implementations. The bucket loop is shared, while room and
  course change algorithms and lineage-key construction remain separate.
- Room and Expanded Room finish handlers share stored leaderboard-row mapping
  for verification triggers. Their existing kind-specific comparators and
  verification policy remain in place.
- Publish progression/points algorithms and change metrics are intentionally
  unchanged: the fact-check identified genuine differences there.

## Compatibility invariants

Room/course base values remain: clear XP 20/40, creator completion BXP 10/16
(before trust weighting), rating CXP 5/7 and creator completion trust 2/3.
Existing event types, source types/IDs and dedupe keys remain byte-for-byte.
Room Protect ranking still includes accepted failed attempts, while failed or
rejected/timed-out clears earn no completion progression or rating eligibility.
Room ranking families and explicitly supplied Expanded Room rank versions stay
separate from significant-change rating windows.

## Verification

- Before changing the pipeline, persisted reward/event and creator-point
  snapshots were captured against baseline `90704d0d`, committed in `e794f4b8`.
  The snapshots remain unchanged after consolidation. They cover both kinds,
  reward amounts, source/dedupe keys, point breakdowns and no duplicate rewards
  after replay. Rejected and timed-out clears cannot open rating eligibility.
- The Protect rank-selection test passed against the original award function
  and against the shared implementation: accepted failed legacy attempts still
  affect ranking without earning clear progression themselves.
- Trigger mapping tests cover string D1 ranks, null viewer ranks, entry into the
  top ten and point-gain verification independently of rank improvement.
- Existing finalization-verification contracts, F268 rating-window integration
  and cross-route adapter tests pass with the new core.
- Isolated compiled Worker probes on native workerd/D1 pass for room and Expanded
  Room verified clears, retries, rating submissions/replays, preserved 20/40
  clear XP and 5/7 rating CXP, strict binding rejection, compatibility promotion
  and one reward per attempt. Room Rush concurrent duplicate handling also
  passes. No production runs or emails are created by these probes.
- Final full check passed: 711 files / 6,071 tests / 10 expected failures /
  two skips, plus lint, types, DOM, dead-code, generated bindings, build and
  asset checks. Boot JavaScript: 665.4 KB Brotli / 670 KB. Approximately 300
  duplicated runtime lines are removed, with baseline contracts added.

Logs: `/tmp/wamp-f273-check-final.log`, `/tmp/wamp-f273-protect-baseline.log`,
`/tmp/wamp-f273-protect-shared.log`, `/tmp/wamp-f273-native-room.log`,
`/tmp/wamp-f273-native-course.log`. Ignored native probes: `output/f273-native/`.

## Production delivery

All 18 jobs passed in [CI run 40881492786](https://github.com/songadaymann/wamp/actions/runs/40881492786).
The clean merged tree matched tested candidate `0cc3beb2` exactly. Guarded API
Worker deployment completed successfully; production smoke passed. Version
`29b0b3e2-41b8-425d-97e6-78f64c875473` is confirmed at 100% traffic. Previous
version: `a16a0245-582d-4419-a37c-bf27ab8f8fde`. No schema migration: health
confirmed latest applied/expected migration `0076_rating_window_keys.sql`,
healthy database and map assets, zero pending tile outbox entries, email
configured, debug links/test reset disabled. No real-player runs or email tests
were submitted for this rollout.

The first deployment attempt stopped before any write on a transient Cloudflare
D1 API 7403 authorization response. Account/D1 listing and a repeated migration
check succeeded; the guarded retry and smoke exited 0. Deployment evidence:
`/tmp/wamp-f273-deploy-retry.log`, `/tmp/wamp-f273-deployments.json`.
