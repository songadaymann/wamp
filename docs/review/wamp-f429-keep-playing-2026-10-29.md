# F429 — Keep playing to another unbeaten room (2026-10-29)

Draft implementation; not delivered until CI, rollout and live verification pass.
F428 is now delivered (PR342/a36493f9, recordefd6d902). This branch builds on
that release; Keep Playing itself remains pending CI and rollout.

Every eligible published ordinary/Expanded Room clear offers a persistent
Keep playing action, including repeat clears that do not produce another rating
prompt. The guest result dialog's existing Keep Playing button uses the same
flow. An active room sequence retains its own controls. New ordinary, Expanded
and Rush starts reset the prior suggestion; cooperative, assisted and draft
clears do not offer a new one. Menus/modals hide the chip without discarding it.

Discovery is requested only on tap. Signed-in players use Unbeaten; guests use
Popular minus local and session clears. Prefer the prior room's known consensus
difficulty, then fall back to any difficulty. Pagination can move past a page
of known clears; skip cooperative and goal-less entries. Select the next target
through the existing room sequence flow, including Expanded target metadata,
with Keep playing as its own source/kicker label. A missing target or request
failure is explained without inventing a destination; the action can retry.
Account, World, run and mode changes cancel stale asynchronous results.

The existing discovery catalog serves Prime. This action stays there rather
than routing private-World/classroom players into Prime; World-context changes
clear its state. No discovery request runs at every clear. No Worker API or
schema change is needed. The phone chip has at least44px targets above the
portrait console, stacked separately from the existing Save/Rate reminder.

## Verification

- Thirteen new unit tests cover lazy requests, signed-in/guest selection, pagination,
  difficulty fallback, current/session/local clears, exhausted catalogs, active
  sequences, stale mode results, new-run reset and retryable failures.
- Existing goal lifecycle, target/type/tick policies, objective, guest playback
  and result-modal regression tests pass.
- Native workerd/D1 plus actual browser: real guest clears are verified and saved.
  Desktop chip, phone chip and the phone guest dialog's Keep Playing action each
  fetch one discovery request on tap, then enter another room with the existing
  sequence and goal intro. No discovery request occurs before tapping. The chip
  hides while the sequence is active. Zero browser page errors.
- Phone chip hit box is at least44x44 and inside the390px viewport; phone chip and
  destination screenshots visually inspected. The fixture uses production's
  PLAYABLE_CONTENT_INDEX_READS=1. No production room/player writes or emails.

Evidence: `/tmp/wamp-f429-context-tests.log`, `/tmp/wamp-f429-regression.log`,
`/tmp/wamp-f429-native-browser-2.log`, `/tmp/wamp-f429-phone-chip.log` and ignored
`output/f429-native/`. Final full check: `/tmp/wamp-f429-final-check.log`.

Final full check passed:725files/6,171tests, one existing expected failure, two
skips; lint, types, DOM, build, bundle budget and assets pass. Boot666.9KB/670KB.
Worker-safety and immutable map-asset contract probes also pass.

Follow-up source audit moved Expanded-start context reset into the shared run-state
creation method, covering regular published playback as well as draft preview.
Both entry modes have regression tests; no discovery/selection behavior changed.

Final check after that correction: `/tmp/wamp-f429-expanded-final-check.log`
passed all stages; published/draft start regression and flow-control tests pass.

CI keyboard navigation exposed a pre-existing background chat read logging the
expected AbortError when the outgoing page closes. Initial/poll reads now ignore
that cancellation while still logging real failures; both paths have regression
tests. No keyboard assertion or console-error check was relaxed.

Final check with cancellation handling: `/tmp/wamp-f429-chat-final-check.log`
passes725files/6,171tests and all check stages. The exact CI keyboard workflow
passes all six desktop/narrow-phone/Safari × ordinary/Expanded scenarios locally
(`/tmp/wamp-f429-keyboard-local.log`), with no relaxed assertions.
