# F447 — builder recognition notices and republish warnings

Work in progress; not delivered or checked off.

Implemented locally: migration0077 widens private Activity kinds for Featured,
Room of the Day and Build Prompt results, preserving existing rows, ID sequence,
all seven existing triggers, views and indexes. Triggered notices are idempotent;
explicit guards handle outer SQLite upserts that override INSERT OR IGNORE.
A sentinel system actor avoids misrepresenting another player. Recognition is
private, independent of email opt-in, and prompt entrants receive their rank or
the entry total. Existing public Activity does not include these private notices.
Older catalog rows can fall back to the pinned publisher for builder attribution.

Focused migrated-D1 tests:33 pass across recognition, Activity and email suites;
recipient-owned room scoping refinement:4 recognition tests pass. Types pass.
Evidence: `/tmp/wamp-f447-recognition-tests-3.log`,
`/tmp/wamp-f447-recognition-own-room.log`, `/tmp/wamp-f447-types.log`.

Native and legacy Expanded target coverage also passes (five recognition tests).
Evidence: `/tmp/wamp-f447-expanded-recognition.log`.

Still required: recognition result links;
publish warnings for ordinary and Expanded republishing; full check, native browser
verification, CI, guarded rollout and live evidence. Keep reviewed Featured version
pins unchanged. No migration applied remotely. F436 draft also reserves0077;
renumber/rebase that draft before its eventual merge, and audit migration ordering.
