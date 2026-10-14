# F038 — Replay frame storage and hourly cleanup

Candidate for the approved overnight checklist. Release proof will be added after delivery.

New guest replay JPEGs are stored in a private R2 bucket. The database retains activity, timing and a frame key, with `image: null`. The existing admin viewer receives hydrated images through its protected API; recordings with legacy inline images remain playable. Recording budgets, seven-day retention, opt-out and sample deduplication are preserved. Each upload owns unique keys so concurrent retries cannot replace the first frame or delete another upload's committed object. Failed storage prevents metadata writes; confirmed unreferenced uploads are cleaned up. Missing-object reads show the existing unavailable-frame state.

Hourly maintenance deletes up to 5,000 expired sessions, expired magic-link/sign-in tokens, and completed render-outbox rows older than seven days per table. Active sign-ins, unfinished dispatches, rows without a completion timestamp and analytics/verification history are retained. Migration 0065 adds a partial index for completed outbox expiry. Replay cleanup runs hourly rather than on page load; expired recordings are hidden immediately, and up to 100 expired recordings are swept per tick. R2 has a seven-day lifecycle rule as backup for orphan uploads.

Before release, a read-only production query found 307 expired sessions, 472 expired magic links, 16,772 dispatched outbox rows older than seven days and zero expired guest replays. That outbox backlog takes four hourly ticks at the bounded rate, plus anything newly eligible during that time.

Checks cover real SQLite expiry boundaries and backlog limits, active/unfinished records, protected replay reads, legacy inline images, R2 failures, retries, simultaneous conflicting uploads, opt-out during upload, deletion retry and the actual Worker schedule's hourly/health distinction. Full quality gates and real safety upload/view/delete checks are pending.

Private buckets: `everybodys-platformer-guest-replays` and `everybodys-platformer-safety-guest-replays`, binding `GUEST_REPLAY_BUCKET`; lifecycle rule `replay-frames-seven-days`, prefix `guest-replays/`, expiry seven days. No public bucket access was enabled. Safety's pre-existing pending main migrations were applied through 0065; production migration 0065 and Worker publication are pending.
