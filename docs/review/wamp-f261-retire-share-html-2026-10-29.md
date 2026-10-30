# F261 — retire unused render helpers and legacy share HTML (in progress)

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
wallet transactions. Not delivered: PR CI and live rollout/redirect/image proof
remain. No additional migration beyond parent F264's0078.
