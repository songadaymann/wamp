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
