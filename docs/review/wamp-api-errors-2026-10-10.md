# F063 plain API error messages

Delivered 2026-10-10 in [PR #118](https://github.com/songadaymann/wamp/pull/118), merge `f24a383d`, live through the Pages auto-build.

## Behavior

- `apiRequest` unwraps the server's `{ error }` with the shared `readApiErrorMessage`: plain-text bodies pass through and an empty body becomes `Request failed with status N.`.
- It throws `ApiError extends Error { status }`. Room insights checks `ApiError` so server explanations still reach the player.
- Affected surfaces: room comments, the guestbook, email-code sign-in on Jam and School pages, and School admin.

## Evidence

- `npm run check` on Node 22 passes. `src/api/request.test.ts` covers JSON, plain-text and empty bodies; both cases fail against the previous helper.
- Browser (local dev server): with the guestbook API returning `503 {"error":"The guestbook is resting. Try again soon."}`, the guestbook status shows that sentence; no page errors.

## Also shipped alongside

[PR #119](https://github.com/songadaymann/wamp/pull/119) (`f303f71a`, API Worker `8b6cbf12`): anonymous edge-cache hits returned `Cache-Control: public, max-age=14400` instead of the route's `max-age=20`. The route's value now travels on the stored copy and is restored on each hit; production hits return `max-age=20`.

## Left

Merging the nine local `getErrorMessage` copies into one helper.
