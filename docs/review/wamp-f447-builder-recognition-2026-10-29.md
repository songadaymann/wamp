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

Added exact-version recognition read and cancellable warnings for ordinary
publication, both Expanded publish screens and standalone cell batch publication.
Only currently indexed Featured pins warn; stale anchor-cell pins do not pretend
the standalone room is still featured. Room of the Day warning uses the current
UTC selection. Title/music republishes are explicitly covered. Read failure uses
a truthful conservative confirmation; account/mode/shutdown changes cancel.
No save or publish runs after Cancel. Existing reviewed pins are unchanged.

Prompt-result notices now open the matching results and close Activity, with a
usable result URL for a new tab and readiness-bound opening. Focused UI/helper/API
checks pass:79 tests before link additions,29 result-link/helper/API tests, then14
Expanded publish-boundary/API/helper tests. Types passed before the final Expanded
workspace addition. Preliminary full check passed731files/6205tests andallstages,
boot668.3KB/670KB; it predates the final workspace guards, so is not final proof.
Final full check is running: `/tmp/wamp-f447-final-check.log`.
Native Worker compile: `/tmp/wamp-f447-native-worker.log`; ignored output/f447-native/.

Still required: final full check; native actual desktop/phone recognition inbox,
results links and ordinary/Expanded publish cancellation/acceptance; CI; guarded
migration and rollout; live evidence. No migration applied remotely. F436 draft
also reserves0077; renumber/rebase that draft before its eventual merge, and audit
migration ordering. Keep F447 open until delivery is verified.

Final complete check after workspace/lifetime coverage:732files/6,209passingtests,
one existing expected failure/two skips; all check stages passed. Boot668.6KB/670KB.
Evidence `/tmp/wamp-f447-final-check-3.log`. Worker-safety passes; final native
Worker compile is ready at ignored output/f447-native/worker/worker.js
(`/tmp/wamp-f447-native-worker-final.log`). Earlier final-check attempts stopped
at the workspace file-size guard; warning orchestration was extracted and the
existing sign-text action moved unchanged, with no limit increase. Private
World/classroom and world-seed publication skip public recognition checks.
No native browser verification, remote migration or deployment yet.
