# F273: shared progression and rating rules — 2026-10-29

Implementation and local verification in progress. Not delivered yet.

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
  snapshots were captured against baseline `90704d0d`, committed in `5e344fad`.
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
- Initial full check passed: 711 files / 6,070 tests / 10 expected failures /
  two skips, plus lint, types, DOM, dead-code, generated bindings, build and
  asset checks. The additional Protect test is verified separately; a final
  full check follows before PR delivery.

Logs: `/tmp/wamp-f273-check.log`, `/tmp/wamp-f273-protect-baseline.log`,
`/tmp/wamp-f273-protect-shared.log`, `/tmp/wamp-f273-native-room.log`,
`/tmp/wamp-f273-native-course.log`. Ignored native probes: `output/f273-native/`.

No schema migration is required. Production delivery requires merged-source
Worker rollout, production smoke and verification before checking F273 off.
