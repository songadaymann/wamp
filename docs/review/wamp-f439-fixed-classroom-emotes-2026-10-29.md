# F439 — fixed guest and classroom emotes (in progress)

Approved vocabulary: wave, heart and GG. Guests and signed-in public players
share public emotes. Students exchange emotes only with their own classroom.
Free-text student/guest chat remains blocked. Bans and suspensions still block
sending. The existing room/play scope, one-second cooldown and six-second
speech-bubble lifetime apply to both packet types.

The identity-token issuer takes classroomId only from authenticated school
context. A distinct signed emotesMuted flag preserves school isolation even when
banned, rather than changing a muted student into a public recipient. Older
school tokens without a classroom claim fail closed. The scope remains private
connection state, never a peer/message field. Server mapping accepts only three
IDs; packet text/classroom claims cannot influence the bubble or audience.

A fixed tray opens through existing T and phone in-room chat controls. Its
44px buttons have accessible names and native keyboard activation. The text
form is hidden for guests/students; signed-in public text chat remains available.
The client uses the existing shared presence connection and fallback transport.

## Current evidence

First full check passes744files/6273tests, one existing expected failure/two skips,
all stages, boot669.6KB/670KB. Server tests exercise signed classroom/public
isolation in both directions, arbitrary text and scope spoof attempts, closed
IDs, legacy/muted school tokens, play/room scope and cooldown. Client shared
transport tests cover guest/student/public emotes, raw-text denial and bans.
Evidence: /tmp/wamp-f439-check-first.log.

Not delivered. Before PR/release: verify real token issuance from school auth,
live moderation rechecks, native workerd WebSockets, actual desktop/phone tray
and bubble rendering, keyboard/focus/lifecycle and reconnect behavior. Check
older durable chat smoke expectations without weakening text restrictions.
No production tests, writes, emails or transactions have been used for F439.

## Native verification and touch corrections

Real SQLite sessions and school membership test token issuance, including spoofed
request scope and both chat-banned and suspended students. Native workerd/D1 and
real WebSockets verify school/public isolation both ways, fixed-ID mapping,
ignored packet text/scope, guest/student raw-text denial, classroom reconnect and
live suspension recheck on an already-connected sender. No production requests.

All8 native browser cases pass desktop/phone/narrow-phone/landscape, guest and
student: real signed tokens and shared presence, text input hidden, 44px tray,
actual transient rendered bubble, Enter/Space/Escape and touch, zero page errors.
Screenshots inspected. The first phone run exposed Say inside the hidden play
HUD. The same entry button now lives outside it; old fixed bottom/right rules
were retired to avoid stretching it across the stage. Bounds checks preserve a
compact on-screen target. Closing the tray explicitly blurs its buttons so T
can reopen immediately after Escape.

The maintained `npm run smoke:room-emotes` fresh-builds the real Worker, runs
native service checks and all8 browser cases with external traffic disabled.
It runs in the existing chat-identity CI job and retains failure artifacts.
A reconnect fixture cleanup now skips already-closed sockets, preserving the
original failure if one occurs. Final fresh native command passes all service and eight browser cases.

Current full check passes745files/6276tests, one existing expected failure/two
skips, all stages, boot669.5/670KB. Separate new-script lint and native command
cover the later CI/harness additions; application code matches that full check.
Evidence: /tmp/wamp-f439-check-head.log, issuance-tests.log, durable-final-2.log
and ignored output/web-game/room-emotes/ (same log prefix).
Still not delivered: PR checks and guarded Worker/Pages rollout remain required.

Native smoke portability: the fresh Worker dry build explicitly uses public
fixture assets, matching its Miniflare ASSETS binding, so a clean checkout does
not need a pre-existing dist directory. Its Vite dependency cache is isolated in
its output directory. This was exposed while preparing the next clean worktree;
the corrected command passes service/reconnect and all8 browser cases again.
Evidence: /tmp/wamp-f439-durable-clean-fixture.log. Application code unchanged.

The maintained smoke is registered in both the CI smoke inventory and Knip's
executable roots. The first next-item full run caught these two missing entries;
all8 inventory/entry checks now pass. The final complete check including the new
harness and registries passes745files/6276tests/all stages, boot669.5/670KB.
Evidence: /tmp/wamp-f439-check-complete.log (terminal0). Native corrected fixture
passes separately. All PR checks must pass again on this final head.
