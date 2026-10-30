# F262 — avoid hidden Camera Tuner snapshots (delivered)

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
No production API/room/player writes, emails or wallet transactions.

## Delivery verified 2026-10-29

PR #352 passed all20 checks on
c8f68797 and merged as8cc89f21. Guarded migration0078/API/Pages release passed;
API14e56a49 is healthy. Read-only production schema confirms all3 retired tables
absent. Renderer deployed after API, then only its unused ADMIN_API_KEY removed;
serving version9b978394 at100%, health200 and all3 retired admin routes404.
Main API admin secret retained; no production R2 deletion test. Public share
GET/HEAD301 ignores redirect input; metadata and PNG/HEAD remain correct.
Pages reconciliation e717be84 serves exact release frontend asset bytes.
Combined full747files/6287tests and all check stages pass; native hidden-tuner,
D1 upgrade preservation, bounded R2 GC and share proofs described above pass.
No production room/player/email/wallet-transaction tests. Production writes were
the authorized schema migration, deployments and renderer-only secret removal.
