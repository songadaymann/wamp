# F031 one-query sign-in lookup

Delivered 2026-10-10 in [PR #124](https://github.com/songadaymann/wamp/pull/124), merge `a2501f2a`, API Worker `5d7ff9d7-f192-48d6-9199-8d1471fd579a`.

## Behavior

- A cookie-authenticated request reads the session, the user's profile fields and their school classroom in one D1 statement (`sessions JOIN users LEFT JOIN school_students LEFT JOIN school_classrooms`).
  - Before, it ran three sequential lookups: session and users, a second users read for profile fields, then the school context.
- A student in a disabled classroom is still signed out, and the session is deleted.
- API-token and agent-token requests are unchanged.

## Evidence

- `npm run check` on Node 22: 428 files, 3,359 tests.
- `src/cloudflare/worker/auth/sessionLookup.test.ts`:
  - 1 statement for a signed-in player with profile fields (the previous code runs 3);
  - 1 statement for a student, with the classroom attached (previous: 3);
  - a disabled classroom still returns no auth and deletes the session.
- Production: deployed and the smoke test passes. Signed-in timing was not measured; this review cannot sign in.

## Left

- Smart Placement: a measured experiment on the safety environment, because it could slow edge-cache hits for anonymous players far from the database.
- `findUserById` and similar helpers still re-read the profile fields with a second query (used by awards, profiles and admin paths).
