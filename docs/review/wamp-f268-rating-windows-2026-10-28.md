# F268: consistent rating windows — 2026-10-28

Shipped in [PR #333](https://github.com/songadaymann/wamp/pull/333), merged
`b2a56e62177a9b3723b3bb6c327a03eeae3a8894`. Production verified on 2026-10-28.

## Behavior

- Ratings, compatibility mirrors, Explore aggregates, viewer rated state and quality
  trophies use the significant-change bucket, including after a title/hearts/pits-only
  Expanded Room republish or a small standalone-room edit. Display versions, run
  metrics, featured pins and non-quality trophies remain pinned to their actual version.
- The compatibility mirror binds the resolved bucket instead of the raw published
  version. Legacy rating storage remains for the separate convergence rollback and
  30-day deletion gate; this release does not remove tables or dual writes.
- A rating synchronizes one canonical quality trophy and refreshes the owner's
  badges once. The rater has their own badge pass. If a bucket's publisher differs
  from the current owner, each distinct creator is refreshed once. Duplicate quality trophies from
  the old route are removed within that window, including raw-version copies.
- Additive migration `0076_rating_window_keys.sql` adds nullable bucket-key caches to
  room and Expanded Room versions. Index refresh lazily fills these from immutable
  history. Discovery uses compact cached keys; cold standalone histories use compact
  facts or individual snapshot reads, keeping large snapshots out of batch results.
  The index resolves cached keys within its publication SQL snapshot so an older
  deferred refresh cannot restore votes after a significant republish.

## Repair and rollout

1. Apply migration 0076 before deploying the Worker.
2. Preview: `npm run index:ratings:repair -- --remote --confirm-production`.
3. Apply: `npm run index:ratings:repair -- --remote --confirm-production --apply`.
4. Deploy the merged Worker, check production health and read-only rating/index parity.

The repair fills version-key caches, copies missing/older compatibility rating
projections and recomputes only the index's rating fields. It preserves source
ratings, reward events, content versions and unrelated index fields. Repeated runs
are supported; updates guard the index's version against concurrent republishing.
The general `index:repair` command now follows its existing rebuild with this repair.
The default preview performs no writes, including no cache writes.

Read-only production preflight: 588 indexed targets, 387 standalone rating rows,
10 course and 10 Expanded Room rating rows; zero missing/stale compatibility
mirrors and zero quality trophies. No production writes during preflight.

## Verification

- Full Worker URL tests on migrated SQLite cover rating v1, a rename/hearts/pits-only
  v2, a second rater, indexed and legacy discovery, viewer state, boards and
  no repeat rewards; a significant goal change starts a fresh window.
- Standalone small-edit tests cover cold history and compact facts.
- A held deferred index batch proves a newer significant publication keeps zero
  votes even if the old refresh completes last.
- Repair tests cover preview without writes, repeated application, source/reward
  preservation, version pins and foreign-key integrity.
- Trophy tests verify one canonical bucket award, removal of old duplicates and
  correct owner trophy counts. A first-rating test observes exactly one owner
  badge pass and one rater badge pass.
- Compiled Worker on isolated native workerd/D1 passed strict verified cross-route
  runs/retries, reward/binding preservation, and F268 republish/index/viewer checks.
  No live runs or emails were created. Ignored probe: `output/f268-native/`.

Full `npm run check` passed: 709 files, 6,060 passing tests, 10 expected failures
and two skips; lint, dead code, types, DOM contracts, generated bindings, build,
assets and bundle budget passed. Boot JavaScript remains 665.3 KB Brotli / 670 KB.
Logs: `/tmp/wamp-f268-check-final-v2.log`, `/tmp/wamp-f268-native.log`.

## Production delivery

- All 18 [CI jobs](https://github.com/songadaymann/wamp/actions/runs/40739065485)
  passed. Mobile passed on a targeted retry: the first attempt's scenarios and
  WebKit passed, but Chromium recorded four transient connection resets fetching
  world-tile images. Those images returned HTTP 200 on direct checks. Source was
  unchanged for the retry.
- Migration 0076 applied successfully. The first repair resolved 367 retained
  windows across 588 indexed targets. To avoid individual remote snapshot reads
  for 1,369 cold historical versions, the same tested repair/cache helpers ran on
  selected-table exports in local SQLite. The resulting guarded SQL updated
  5,976 bucket-key caches, the compatibility mirror, and 588 index rating fields.
  Source room/course ratings were unchanged in the local plan validation.
- Replayed only these guarded projection statements against D1, preserving the
  source snapshots, content versions and reward records. Plan SHA-256:
  `6c6d414f4bce61cdba0f513d63ee98aaf2f6068bcf10a582f2102e6ee45a52d2`.
  Regular repair commands above can now use the populated key caches.
- Worker `a16a0245-582d-4419-a37c-bf27ab8f8fde` serves 100% of traffic from a
  clean checkout of the merged commit. Its full tracked tree matched the tested
  candidate `bb384a09`; the guarded Worker-only deployment and production smoke
  passed, including migration health, auth configuration and World tiles.
- Post-rollout D1 audit: zero uncached indexed versions, zero quality/difficulty
  vote-count mismatches, and zero missing/stale compatibility mirrors.
- Compared with the pre-repair index export, **181 hidden quality votes across
  123 targets** are visible again. Fresh public Explore results matched all 123
  targets' expected counts. Example: room `0,9`, published v22, rating bucket v18,
  now shows two votes.
- Live checks created no runs or login emails. Legacy tables and rating copies
  remain for the separate convergence deletion gate. F273 remains open.

Delivery logs: `/tmp/wamp-f268-production-deploy.log`,
`/tmp/wamp-f268-post-audit.json`, `/tmp/wamp-f268-restored-counts.json`,
`/tmp/wamp-f268-offline-plan-summary.json` and `/tmp/wamp-f268-apply-plan.log`.
Temporary data exports and the local repair database are removed after delivery.
