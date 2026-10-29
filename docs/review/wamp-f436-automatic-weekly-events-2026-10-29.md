# F436 — automatic weekly events (draft, 2026-10-29)

Automatic scheduling was approved. The concrete 26-theme Build Prompt bank is
still awaiting owner content approval; PR341 is a draft and must not activate in production
until that approval arrives. F436 remains unchecked.

The existing hourly maintenance handler prefills the current and next UTC week,
so next week's choices are visible in Launch Admin before opening. Manual picks
and edits take ownership. Deleting a week suppresses automatic recreation; a
later manual save clears suppression. The first ranked Rush start and first
prompt entry retain their existing locks. Unlocked stale automatic Rush picks
can refresh; manual and locked weeks remain untouched.

Rush candidates come from public standalone solo rooms, with fair deterministic
rotation, quality, non-staff and builder cooldown weights, a preference for older
stable publications and at least three published neighbours. Ineligible or stale
candidates are skipped. Prompts rotate through the proposed 26-theme bank.
Migration0077 adds attribution, prompt keys, suppression and weekly trace bindings.
Existing configuration remains attributed to admin.

Before automatic weekly rankings launch, signed-in weekly starts now bind a
movement trace to the server nonce and start snapshot. Submission checks the
actual route, coverage, bounds, plausible movement, transitions and terminal
state before consuming the start or saving a score. Legacy unchecked weekly
rows do not enter new verified standings. This is movement plausibility checking
using existing verification policy, not authoritative collision replay. General
Room Rush verification (F203) remains open and is not checked off here.

## Verification

- Final full check (rebased onto main141c9ba2): 725 files, 6,174 passing tests, one existing expected
  failure, two skips; lint, types, DOM, build and asset checks pass, including
  the browser-discovered weekly-start fix.
- Scheduler tests cover repeated/concurrent ticks, next-week prefill, manual
  overrides, persistent deletion, stale automatic repairs, locks, rotation,
  DST/year boundaries and no eligible Rush rooms.
- Trace tests cover real client lifecycle, room crossing, terminal death and
  rejection of wrong bindings, fabricated movement/routes, timing gaps and
  invalid local coordinates. Existing weekly admin/lock/leaderboard tests pass.
- Native workerd/D1 plus real browser: all migrations applied to an isolated
  local fixture; hourly scheduler created two Rush weeks and two prompts, then
  repeated idempotently. A synthetic signed-in player used the actual UI,
  crossed from 0,0 to 1,0 with keyboard input and clicked End Rush. The actual
  API saved two rooms with verification_status=passed and displayed the saved
  weekly leaderboard confirmation. Zero browser page errors. No production
  player/room writes or emails. Local multiplayer was offline.
- This browser flow exposed an existing weekly start problem: preflight loaded
  rooms while still in Browse mode (no collision runtime). Reconcile the window
  again after entering Play, matching regular Rush, so the player actually spawns.
  The empty pre-fix run was correctly refused by the new verifier.

Local evidence: `/tmp/wamp-f436-final-check.log`,
`/tmp/wamp-f436-browser-8.log`, ignored `output/f436-native/` probe/screenshot.
No production migration or deployment has occurred.
