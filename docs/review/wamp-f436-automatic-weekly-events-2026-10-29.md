# F436 — automatic weekly events (delivered, 2026-10-30)

Jonathan approved automatic scheduling/manual overrides and, on 2026-10-30,
all 26 proposed prompts as written. PR341 is merged and F436 is delivered. Earlier
pending-review statuses in the verification history below are superseded.

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
Migration0079 adds attribution, prompt keys, suppression and weekly trace bindings.
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

CI quality found the safety probe’s fake database still locating Rush finalization
guard binds by the old column count. It now reads the final three guard binds,
preserving consumed-start/user/attempt checks as inserted metadata grows. The
worker-safety probe passes locally; CI must rerun before any merge.

## Refreshed integration proof — 2026-10-30

Rebased onto the current cleanup integration after F257 delivery. Preserve current
builder recognition, cleared-room and keep-playing behavior. Renumber the pending
weekly migration to0079 after live0077 recognition/0078 retirement; health expects
0079 only in this draft. No F436 migration has been applied to production.

Full check passes749files/6295tests, one existing expected failure/two skips,
all stages, boot662.5/670KB. Five focused weekly/trace files41tests and worker safety
probe pass. Fresh native Worker/D1 populates current+next weeks2+2, then0+0 on retry.
Actual signed-in synthetic browser crosses0,0 to1,0 with keyboard, ends Rush and
saves two rooms with verification_status=passed; result confirms saved weekly
ranking, zero page errors. Local ephemeral fixtures only, no production writes.
Evidence: /tmp/wamp-f436-refresh-check.log, refresh-focused.log, refresh-types.log,
refresh-worker-safety.log and refresh-browser.log; ignored output/f436-native/.

Prompt content review remains pending. The automatic scheduling authorization
already stands; do not re-request it. Keep the PR draft and F436 unchecked until
the content decision and all final CI/live gates are satisfied.

## Final delivery — 2026-10-30

All 20 checks passed on exact cc742769. PR341 merged 13a93bd2. Guarded clean-main
migration0079, API and Pages rollout passes; API7eccabf3-241f-45f2-8e6a-31118513645a
serves100%, health applies/expects0079, initialPages4da535d3. Exact live main/editor/
style asset bytes match release; renderer asset contract and production smoke pass.

Run the approved production scheduler once through an authenticated D1 CLI adapter
using the actual source function and deployed configuration. It creates current/
next weeks2 Rush+2 Prompt rows, then0+0 on repeat. Existing manual/locked metadata
is preserved by the scheduler guards. This initializes weekly configuration only;
no run/entry submission, player/room mutation, test email or wallet transaction.
Hourly scheduling continues through the existing hourly cron at minute 17.

Current week: Vertical parkour (2,0 v21) and One Screen Wonder. Next week begins
2026-11-02 UTC: Rush at -1,2 and Spare Change. Public weekly/current/list APIs return
the current automatic picks; database checks confirm next week is queued. Actual desktop and phone browsers use real weekly GETs,
show the live Rush available and approved prompt text, and have zero page errors;
start/entry buttons were not submitted. Native signed-in verified-run proof above
covers the complete submission flow with ephemeral data.

Evidence: /tmp/wamp-f436-release.log, deployments.txt, activation.json/log,
live-api.json, live-assets.log, live-browser.json/log (same prefix). Ignored rollout
adapter output/f436-activation/seed.ts validates SQL binding with a read-only quote
probe before invoking only the approved scheduler; ignored screenshots under
output/f436-live/. Goal28/28 complete; Round2 100/248. Ledger/progress checks pass.
