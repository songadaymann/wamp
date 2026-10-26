# Round 2 handoff follow-ups — 2026-10-26

Closes the three small follow-ups parked in the October 23 handoff, after F333
and F480. These refine delivered work; the Round 2 count remains 70 of 248.

## Changes and findings

- The failed-download card now names the **Explore page**, so the message reads
  "The Explore page couldn't load." Its title and error report use the same name.
- F487's whole-draft conflict todo is now an executable `it.fails` route test.
  Two tabs begin from the same draft timestamp; the stale tab's save must receive
  409 and preserve the newer draft. The current endpoint returns 200 and
  overwrites it. This test documents the existing gap; conflict protection
  still needs implementation during the Expanded Room backend work.
- The read-only production count found **zero** claimed or published rooms
  missing a World claim row. No backfill is needed for the current data. The
  hypothetical legacy-row policy test remains skipped pending that policy
  decision; the count does not implement a new ownership policy.

Production query (2026-10-26):

```sql
SELECT COUNT(*) AS rooms_missing_world_claim
FROM rooms r
WHERE (claimer_user_id IS NOT NULL OR published_json IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM world_room_claims c WHERE c.room_id = r.id
  );
```

D1 returned 0, with 1,473 rows read, zero rows written, and `changed_db: false`.

## Verification

- Focused routes and failed-download tests: 28 passed, one expected failure,
  one skipped legacy-policy test.
- Temporarily removing `.fails` confirms the conflict test fails specifically
  because the stale save returns 200 rather than 409.
- Full `npm run check` passed: 707 files, 6,039 passing tests, 10 expected
  failures and two skipped tests; lint, dead code, types, DOM, build, bundle
  budget and asset checks passed. PR CI pending.
