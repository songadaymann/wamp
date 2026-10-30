# F262 — avoid hidden Camera Tuner snapshots (in progress)

The mobile UI returns before requesting a camera tuning snapshot when the tuner
panel is absent or hidden. Normal menu/chat/layout changes therefore skip its
layout measurement. The existing URL flags, live developer controls, camera
framing constants, snapshots and mobile CI tuner scenario remain available.
This follows the fact-check: the tuner is active developer/CI tooling.

Native workerd/D1 and a real phone browser verify zero snapshot reads across
menu open/close and an app-mode render while hidden. With cameraTuner=1 the
same renders read the snapshot (two reads) and the actual Zoom + button updates
the displayed value. Both cases have zero page errors. External traffic disabled.
Evidence: /tmp/wamp-f262-native-3.log and /tmp/wamp-f262-native.json.
Full local check passes745files/6276tests, one existing expected failure/two skips,
all stages, boot669.6/670KB. Evidence: /tmp/wamp-f262-check-complete.log.
PR CI and live Pages verification remain.
No production API/room/player writes, emails or wallet transactions.
