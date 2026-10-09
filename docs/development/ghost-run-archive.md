# Completed ghost archive

Every verified, ghost-capable ordinary-room completion is retained, including slower account runs and verified guest runs. Failed, abandoned, invalid or missing recordings are excluded. Course and Expanded Room ghosts are not supported by the existing recorder. Personal-best storage and the automatic room-record rival remain unchanged; the archive is a fallback for a leaderboard recording.

Migration `0063_run_ghost_archive.sql` backfills the best recordings already stored in `run_ghosts`. Older runs without a stored recording cannot be recovered. New completion metadata and a compact, movement-only upload payload are committed together in D1. The private R2 object has a stable attempt key. After a successful write, only the small index remains in D1. Temporary upload failures retain their payload and retry on the existing scheduled checks. Guest recordings survive guest-progress expiry and contain no recovery token or guest identity.

Production binding `RUN_GHOST_BUCKET` uses `everybodys-platformer-run-ghosts`; safety uses `everybodys-platformer-safety-run-ghosts`. Neither bucket has public access enabled. Apply the migration before deploying the Worker that writes the archive.

## Monthly warning

The existing Cloudflare account-wide budget alert is separate. `RUN_GHOST_COST_ALERTS_ENABLED=1` enables an hourly ghost-specific email once the conservative estimated monthly R2 cost exceeds $10. A failed email is retried; a successful email is deduplicated for that billing cycle. Saving stays enabled. Safety alerts default off.

The estimate uses Standard R2 storage, Class A uploads/retries and Class B archive reads, rounded up to Cloudflare billing units. It prices the current archive, including pending uploads, for a full month and excludes shared free allowances, Worker/D1 usage, unrelated services and taxes. It can warn before the actual bill reaches $10. It is an estimate and warning, not a spending cap. Rates were checked against [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) on October 9, 2026.

`RUN_GHOST_BILLING_CYCLE_DAY=5` matches the observed account cycle. Recipient selection is `RUN_GHOST_ALERT_EMAIL`, then the existing world-map/admin alert recipient (currently `jonathan@jonathanmann.net`). Delivery uses the existing Resend credentials in the Cloudflare Worker.

## Operations and verification

These routes require the existing admin key. Reads are private and uncached; mutations require a trusted origin when an Origin header is present:

- `GET /api/admin/run-ghost-archive/status`: bucket/alert configuration, recipient, retained bytes/runs, pending uploads, cycle operation counts and cost breakdown.
- `POST /api/admin/run-ghost-archive/flush`: retry at most 25 pending uploads.
- `POST /api/admin/run-ghost-archive/check-cost`: perform the actual cost check; it sends only above the threshold.

After release, verify configured binding/alerts, the intended recipient and cycle, drained migration backfill, an actual R2 payload, protected routes and unchanged public record selection. Tests use the fully migrated SQLite schema and fake R2/email delivery; actual browser completion checks use an isolated local backend. Evidence and release versions are recorded in `progress.md`.
