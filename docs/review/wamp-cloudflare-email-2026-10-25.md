# Cloudflare email migration — 2026-10-25

WAMP now prefers the native Cloudflare Email Service binding for sign-in codes
and links, chat mentions, approved comments, World invitations and grants,
activity/daily notifications, and operational alerts. Email configuration checks
accept the binding without a Resend API key. Existing templates, opt-ins, limits,
notification leases and sent markers remain in place.

The shared adapter preserves each caller's error/result contract, validates the
provider message ID, maps Cloudflare quota errors to 429, and converts formatted
sender names into structured addresses. EMAIL_FROM overrides the old Resend
sender secret, including messages persisted in an alert outbox before cutover.
There is no cross-provider retry on a Cloudflare send failure.

Production configuration binds EMAIL and restricts its sender to
noreply@wamp.land. Cloudflare's dashboard confirmed wamp.land sending Enabled,
DNS Configured, and a shared account quota of 1,000 sends/day on October 25.
Resend remains available only if the EMAIL binding is removed for rollback.
The subscription and secret should be retired after live delivery is confirmed.

Cloudflare has no documented provider idempotency key. The application keeps
its durable leases and sent markers, but a crash between acceptance and saving
the marker can cause a duplicate on retry. This differs from Resend's HTTP
idempotency protection; it does not affect one-time consumption of login codes.

Validation: npm run check passed (styles, lint, dead-code, full tests, typecheck,
DOM contract, renderer types, build, boot budget and asset checks). Additional
native-binding tests cover login content, sender override, notification transport,
quota failures without fallback, missing confirmation, and provider availability.
Wrangler production dry-run accepted the binding and bundled successfully.

## Production verification

[PR #328](https://github.com/songadaymann/wamp/pull/328) merged as
8d7dd388 after all 18 CI jobs passed. A missing generated-bindings refresh was
caught by the first CI run and corrected before merge. The final complete local
check passed with 6,009 passing tests (704 files).

Deployed from a clean checkout at origin/main. Both D1 databases had no pending
migrations; the strict world-map release guard passed. API Worker version:
718f9e4e-bbf9-4951-9e76-fffce778470f. Production smoke verified the frontend,
auth configuration, database health, direct alerts and current world tiles.

With the owner's approval, the live request-link endpoint sent one login email
and returned HTTP 200, ok=true, delivery=email. The message arrived in the owner's
inbox from WAMP <noreply@wamp.land> on October 25. No login code was consumed.
The Resend subscription has not been cancelled; its key remains only for rollback.
