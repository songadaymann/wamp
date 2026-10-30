# F265 — one bounded world-tile admin surface (in progress)

The main API retains world-tile operator controls. Garbage collection keeps
its admin/origin checks, explicit deletion confirmation,30-day floor and
protection for every referenced R2 key. It now also retains the removed renderer
GC's caps:500 deletions/50,000 scanned by default, hard maxima2,000/250,000,
100-key delete batches, and a truncated indicator. Dry runs use the same bounds.

The renderer's unused status/repair/GC HTTP endpoints, duplicate collector,
reference-key helper and admin-key type are removed. Public health, queue-driven
rendering, scheduled repair, leases, image contracts and existing tile pointers
remain. Deploy the authoritative API caps before retiring renderer HTTP routes.

The manual expanded-room migration report stays: the fact-check identifies it as
an active diagnostic during convergence. Launch stats use the local metrics DO
when bound, retaining its internal token and failure reporting; legacy external
presence configuration keeps its existing fallback. PARTYKIT_HOST remains client
configuration. A direct call with no internal token is still rejected.

## Verification

- Full local check passes747files/6284tests, one existing expected failure/two
  skips, all stages, boot669.5/670KB. Focused26 tests include GC caps, auth,
  confirmation/age/reference guards, renderer health/retired routes, render state
  machine and direct metrics behavior without public fetch.
- Fresh real API and renderer bundles run in native workerd. Native D1/R2 prove
  dry-run safety, recent-object protection, referenced-pointer protection, delete
  and scan caps, remaining eligible objects preserved, and renderer health/404s.
  Only the fixture runtime clock advances90days to exercise real R2 object aging;
  production source is unmodified and all deletes are ephemeral fixture objects.
- Actual metrics DO is reachable from the API with zero outbound requests, and
  rejects a direct unauthenticated request with403. Native main and JAM schemas
  match their separate migration sets. The local fixture uses a loopback Origin
  accepted by the native proxy; application origin/auth guards remain tested.
- Production renderer secret-name inspection confirms ADMIN_API_KEY exists. Its
  value was not read. Remove this renderer-only secret AFTER successful API and
  renderer releases; the main API secret remains required.

Evidence: /tmp/wamp-f265-check.log, focused-final.log, native-final.log and
native.json, renderer-secret-names.json (same prefix); ignored output/f265-native/.
No production R2 cleanup, room/player writes, email or wallet transaction tests.
Not delivered: PR CI and guarded main/renderer rollout, secret removal and live
verification remain. F262/F264 are also prepared in the parent cleanup commits.
