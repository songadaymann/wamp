# F270: one Expanded Room run backend — 2026-10-26

Shipped in [PR #332](https://github.com/songadaymann/wamp/pull/332), merged
`77bb87d38774df4fec0d9a626bd185408f016545`. This is convergence steps 1–2
from the F270 review; legacy tables and dual writes remain behind the separate
30-day parity/deletion gate in `docs/expanded-room-convergence.md`.

## Changes

- Course run start/finish, leaderboard and rating routes delegate to the canonical
  Expanded Room handlers. The adapters retain legacy JSON fields, rating/start
  parsing and cache headers. The legacy start parser still lets the body select
  a course; native Expanded Room starts retain their URL identity check.
- The game starts and finishes ranked Expanded Room runs through the canonical
  API, including course-backed content. A failed native start no longer creates
  a second legacy attempt. Course-context ratings also use the canonical API.
  Existing legacy leaderboard readers continue through the compatibility route.
- A pre-cutover course-only attempt can be promoted after authentication and
  ownership checks, preserving its goal, nonce, snapshot binding, player, times,
  metrics and outcome. Old settlement markers prevent previously settled clears
  from being rewarded again. Interrupted clears still use the canonical retry
  settlement path.
- If an old Worker wins the legacy row during rollout, reconciliation copies
  that outcome only into a still-active canonical row. It does not replace a
  winning native outcome or award the old finish again. Pinned historical
  attempts can still finish after their creator unpublishes the content.
- Additive migration `0075_course_run_convergence.sql` copies missing historical
  parents, versions, cells, attempts and settlement markers. It never overwrites
  existing native records or drops legacy data. Imported historical runs keep
  null native `finalize_seq`: the two tables' sequence numbers are independent.
  Existing insight triggers replace the legacy insight projection, preventing
  double counting.

## Read-only production preflight

On 2026-10-26, course-only attempts consisted of four abandoned attempts and no
completed or active attempts. Three historical version projections and two
course parents were missing; both missing parents have usable historical anchor
references. Existing run copies have zero outcome/binding mismatches and zero
missing course copies. These reads wrote zero rows. The additive backfill covers these
records before the Worker cutover; no old table or de-duplication reader is
removed in this release.

## Verification

- URL-level Worker tests use real migrated SQLite for cross-route accounting,
  JSON compatibility, boards/ratings, auth rejection, concurrent retries,
  interrupted/settled legacy finishes, unpublished content and a simulated
  pre-cutover Worker winning the finish race.
- Migration tests cover missing unpublished history, idempotency, native-data
  preservation, independent finalize sequences, minted-cell protection, insight
  de-duplication and foreign-key integrity.
- Client tests retain early-finish trace coverage and prove 404/503 native start
  failures do not call the old start method.
- Full `npm run check` passed: 708 files, 6,053 passing tests, 10 expected
  failures and two skips. Lint, dead code, types, DOM, generated bindings, build,
  bundle budget and asset checks passed. Boot JavaScript: 665.3 KB Brotli
  against the 670 KB budget.
- The compiled production Worker passed isolated workerd/native-D1 checks for
  strict verified cross-route finishes/replays, identical boards, legacy rating
  identity fields and mirror, authenticated promotion, concurrent retries,
  nonce preservation, invalid-nonce rejection/replay, an old Worker's winning
  outcome, and one reward per attempt. No production calls were made by this
  probe. Artifacts: ignored `output/f270-native/`; log `/tmp/wamp-f270-native.log`.
- All 18 [PR CI jobs](https://github.com/songadaymann/wamp/actions/runs/40434130537) passed.
- Migration 0075 applied before the guarded production Worker deployment.
  Worker `2a093888-12fc-458a-86e2-7f077855e772` serves 100% of traffic.
  Production smoke passed, including database migration health and World tiles.
- Post-release read-only audit: zero legacy-only attempts, missing parents,
  missing historical versions, or run-copy outcome/binding mismatches.
- Production Pages deployment `a4cbcaf2-9e3c-4670-aa24-ae39969a8218`
  uses merged source `77bb87d`. Public JavaScript verification followed 206
  files and confirmed the removed legacy-start fallback is absent.
- Existing legacy data and dual writes remain available for rollback and the
  separate 30-day parity/deletion gate. F268 and F273 remain open.
