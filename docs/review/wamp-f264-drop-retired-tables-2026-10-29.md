# F264 — drop the three retired D1 tables (in progress)

Migration0078 drops room_difficulty_votes, playfun_point_sync and
room_version_attribution. Their runtime read/write removal was a separate earlier
compatibility release (c607b28a), followed by cascade coverage (b32d8513).
Current ratings and per-version change remain in room_ratings and
room_version_facts. No parent room, room version, user or point event is removed.
The operational health expectation moves to0078; apply the migration before the
new Worker. Historical create/backfill migrations remain intact for clean installs.

Read-only production preflight on2026-10-29 found68 difficulty votes,3713 point-sync
rows and3206 attribution rows. A search of table, view and trigger SQL found only the three tables
themselves; no other live table/view/trigger depends on them. Jonathan explicitly
approved dropping all three. No production migration has been applied yet.

The safety refresh retains a compatibility skip for older source snapshots and
excludes those tables from missing-target validation, so a migrated target can
refresh from an older source without recreating/importing retired data. Active
schema validation is preserved.

## Verification so far

- Real SQLite upgrade starts from0077 with all three tables populated, applies
  the actual0078 file, verifies the tables absent and all rows of current ratings,
  version facts, rooms, room versions, users and point events unchanged. A retry
  is safe. Foreign-key check is clean. Current admin clear/reset work after drop.
- Native D1 repeats the populated upgrade and full live-table row comparisons,
  verifies no foreign-key violations, no retired tables and a safe retry.
- Actual safety-refresh dry-run command uses a local SQLite-backed CLI fixture
  with an old source and migrated target: accepted, current rooms included,
  retired tables excluded from reset/import, zero errors and no remote requests.
- Focused retirement/difficulty tests pass11, retirement/health tests pass12.
  Full check passes745files/6277tests, one existing expected failure/two skips,
  all stages, boot669.6/670KB after updating the migration health expectation.

Evidence: /tmp/wamp-f264-production-before.json, native.json/native.log,
refresh-proof.json, focused.log and check-final.log (same prefix). Native fixtures
are ignored under output/f264-native/. No production writes, emails or wallet
transactions. Not delivered: PR CI and guarded migration/Worker/Pages
rollout plus live schema/health/asset verification remain.
