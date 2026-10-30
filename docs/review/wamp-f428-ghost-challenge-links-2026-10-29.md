# F428 — share the saved run as a ghost challenge (2026-10-29)

Delivered through PR342, merged a36493f9; all CI, rollout and live verification passed.

A saved time-ranked standalone-room clear can now share `?from=share&vs=<run-id>`.
Signed-in results gain the ID only after successful finish delivery. Guest
results gain it only after verified save, including a later queued-save event;
all share actions read the current save state. Unsupported goals, local-only or
unverified results, Courses and Expanded Rooms retain ordinary room links.

The recipient's goal intro preselects the shared run and shows “Beat <name>” with
the server-confirmed time. Quick Start retains that intent while loading.
Restart fetches the same challenger rather than switching to the latest #1.
The ghost remains presentation-only, with no physics body. A missing, incompatible
or unavailable recording leaves Play usable. Navigating to another room strips
`vs`; restarting the invited room preserves it.

## Public recording boundary

The opaque attempt ID identifies a public completed movement recording, including
non-best clears; it is not an authentication credential. Personal-best lookup
remains session-owned. The existing archive whitelists movement and does not
expose verification bindings, input events, recovery secrets or analytics replay.
Guest challengers remain anonymous as Guest.

Before reading R2, the handler validates the ID, room, compatible version and
unredacted source version. Account runs must still be completed and verification
accepted, exclude generated identities and exclude classroom student identities.
Removing or invalidating an account run disables its invitation. Guest archives
were committed transactionally with passed verification; they intentionally
survive the 14-day temporary-progress cleanup. A retained invalid guest record
is refused. Existing room/version access checks still run before challenge lookup.
Only requested recordings are read; there is no archive listing or migration.

## Verification

- Targeted renderer-independent link, intro, repository, restart, share-modal and
  real-schema archive tests pass. They cover slower non-best challenges, room and
  layout mismatch before R2, invalidated/redacted account runs, anonymous guest
  archives surviving prune, late-save share updates and room-scoped navigation.
- Native workerd/D1: two actual start/finish API flows create a faster record and
  slower verified challenger. The real ghost endpoint returns each separately.
- Real guest browser opens the invitation; intro selects the slower challenger
  and displays its server-confirmed time. Start draws its ghost, and the real
  Restart control retains the same attempt. Debug state confirms visible=true,
  choice=challenge and hasPhysicsBody=false; zero browser page errors.
- Intro and race screenshots visually inspected. Local multiplayer is offline;
  the fixture's optional Worlds list returns404. No production player/room writes,
  emails or external messages.

Local evidence: `/tmp/wamp-f428-targeted.log`, `/tmp/wamp-f428-flow-tests.log`,
`/tmp/wamp-f428-native-browser-2.log`, ignored `output/f428-native/`.
Final full check passed: 722 files, 6,158 tests, one existing expected failure,
two skips; lint, types, DOM, build and all asset checks pass. Boot665.9KB/670KB.
Evidence: `/tmp/wamp-f428-final-check.log`.

## Production delivery

All18 GitHub jobs in40910577476 passed. Guarded full rollout and production
smoke passed. Worker `2eefd05a-072e-4dc8-af7e-1532e2314e00` serves100%;
Pages `1207b5b3` and live entry `main-DaInX8rt.js`, main runtime, editor and
result-modal assets match release bytes. Migration0076 remains current.

Three existing public invitations return the exact requested ghost, including
server-confirmed time and private/no-store responses; personal ghosts stay
unavailable to a signed-out viewer. The public invitation route returns200 and
preserves its challenge parameter. Movement payloads contain no verification
bindings or input events. No production room/player writes or emails were used.
Evidence: `/tmp/wamp-f428-deploy.log`, `/tmp/wamp-f428-deployments.json`,
`/tmp/wamp-f428-live-ghosts.json`, `/tmp/wamp-f428-live-assets.json`.
Goal8/28; Round2 80/248. Remaining goal work stays active.
