# F028 chat polling while the panel is closed

Delivered 2026-10-10 in [PR #121](https://github.com/songadaymann/wamp/pull/121), merge `56c712c4`. API Worker `97079932-2e92-4edf-b470-c310cd021763`; frontend through the Pages auto-build.

## Behavior

- Chat panel closed: one check about every 30 s, enough for the unread badge (was every 3 s in every world, play and editor tab).
- Chat panel open: every 3 s as before, and opening the panel checks at once.
- `GET /api/chat/messages` loads messages and the viewer's moderation state in parallel.
- Readers without a session cookie are served from a 3 s edge cache (`public, max-age=3`). Up-to-date readers share the same `after=` URL. Signed-in readers get `private, no-store` and never touch the cache.

## Evidence

- `npm run check` on Node 22: 426 files, 3,352 tests.
  - `src/cloudflare/worker/chat/routes.test.ts`: anonymous miss then hit; signed-in bypass with the banned viewer and nothing stored. Both tests fail on the previous route.
  - `src/ui/chat/pollSchedule.test.ts`: 20 polls a minute while open, two while closed.
- Browser (local dev server, 65 s with the panel closed): polls at 3.7 s, 33.7 s and 63.6 s, against about 22 before. Opening the panel polled at once, then every 3 s.
- Production after deploy:

  | Request | Cache-Control | X-WAMP-Cache |
  |---|---|---|
  | anonymous | `public, max-age=3` | miss |
  | anonymous | `public, max-age=3` | hit |
  | anonymous | `public, max-age=3` | hit |
  | anonymous, 4 s later | `public, max-age=3` | miss |
  | with a session cookie | `private, no-store` | bypass |

## Left

- Signed-in polls still resolve the session and moderation state on every request. Skipping those on `after` polls would delay ban and role changes until reload.
- Pushing a `chat:new` event over the PartyKit sockets would remove polling entirely.
