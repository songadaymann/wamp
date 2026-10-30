# F261 — retire unused render helpers and legacy share HTML (delivered)

Removed the unused warm-all-art helper and minted-payload PNG data-URL wrapper,
plus imports used only by the warm helper. Live canvas/snapshot render paths stay.
The deliberately tested Ethereum/mainnet unsupported-network branch stays, as
the fact-check requires.

Bare /api/share/rooms/:id links now return a bodyless301 to the canonical frontend
/r/x/y path instead of serving a second HTML page with JavaScript navigation.
Published-target validation stays; query input cannot choose the redirect.
The metadata URL allowlist remains for /meta. Metadata, cached map artwork,
image/image.png bytes and GET/HEAD semantics stay intact. Redirects skip masking,
artwork and rendering work that belongs to the canonical frontend instead.

Full local check passes747files/6287tests, one existing expected failure/two skips,
all stages, boot669.7/670KB. The119 share/Pages metadata/app-shell assertions pass,
including cached artwork dimensions and frontend Open Graph metadata. Legacy HTML
assertions now verify301/canonical location/empty body; no image or metadata
assertion was removed.

Fresh native Worker/D1 verifies GET/HEAD301, both unrelated-host and same-host
query overrides ignored, published metadata preserved, real PNG signature and
1200x630 dimensions matching metadata, image HEAD body empty and zero outbound
requests. Native requests use the production API hostname through Miniflare's
local Fetcher so frontend canonical-origin mapping is exercised; no production
network request is made.

Evidence: /tmp/wamp-f261-check.log, share-final.log, native-2.log/native.json
(same prefix); ignored output/f261-native/. No production writes, emails or
wallet transactions. PR CI and live rollout proof are recorded below. No additional migration beyond parent F264's0078.

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
