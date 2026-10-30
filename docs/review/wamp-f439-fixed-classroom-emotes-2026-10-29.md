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

## Nightly harness alignment

Final ec864623 Quality run40986563454 passed all18 jobs, including maintained
native emotes. The inventory update also triggered the full nightly matrix.
Completed run40986563437 had exactly two failing smokes (plus its aggregate
report): phone inspector and clear feedback. Other groups passed.

The phone inspector registers a custom sprite through /src imports. Its nightly
entry incorrectly used the built stack, which cannot serve TypeScript source.
Using the existing Vite test server preserves all assertions; the exact nightly
runner now passes all6 portrait/landscape/narrow room/Expanded scenarios (126s).
The clear-feedback smoke clicked Keep Playing and then expected a replay of the
original room, conflicting with delivered F429 navigation. Its desktop replay
case now closes results, waits for Browse, and explicitly replays that room;
phone cases still use Keep Playing. All4 profiles and the original second-clear
celebration count pass (36s). No product assertions were removed.

Evidence: /tmp/wamp-f439-nightly-editor-phone.log, nightly-play.log,
nightly-inspector-local.log and nightly-clear-local.log; ignored nightly results.
Both source/app boundaries remain unchanged. All checks must pass on the new
combined head before release. F439 is still not delivered.

## Delivered

PR351 tested a212bcbf57d348bf252934cfb989c9458e0a4138 passed all28 reported
checks, Quality40988214787 plus Nightly40988214844 attempt2, and merged as
31cd727ea96cdb825f6a2ab1c1bef36b12fa16f9. The remaining Jungle Vines scroll timeout
in the first a212 nightly attempt passed unchanged in the exact local runner
(7s) and then the failed editor-job rerun. Other matrix groups passed. No product
or assertion changes were used for that retry.

Guarded clean-main full rollout passes: Worker c36fbaed-d1be-49d0-9e51-0349c2ebb244
serves100%, Pages6487d3e9. Production smoke and health pass, main migration0077
and JAM0003 unchanged. Entry main-tuvoKYGL.js and served editor/runtime/CSS match
release bytes. Live guest token issuance ignores a spoofed classroom claim.
Actual desktop/phone clients generate all3 named controls outside the collapsed
HUD with zero page errors. Live verification blocks presence transport, analytics
and room/player mutations; no emote is sent to a production player. Complete
native session/D1/WebSocket and eight-browser proof covers actual interactions.

The first release attempt stopped BEFORE API upload at a D1 authorization7403
error. Same-account OAuth identity/scopes were valid, the read-only D1 recheck
succeeded, and the complete guarded retry passed; no guard was bypassed.
Evidence: /tmp/wamp-f439-green-checks.json, release-2.log, assets.log,
live-browser.json, live-api.json and deployments.json (same prefix).
Goal16/28; Round2 88/248. No production room/player/email/wallet transaction tests.
